/* Limpieza PWA — store.js (API-backed, with offline cache)
 *
 * Strategy:
 *   - Server (SQLite) is the source of truth.
 *   - localStorage is the offline cache + pending-changes queue.
 *   - Every mutation: optimistic update locally + PUT to server (queued if offline).
 *   - On load: read cache, fetch fresh from server in background.
 *   - Last-wins per section, tracked by version counters.
 */

const CACHE_KEY = 'aca_limpieza_v1';          // backwards-compat with old key name
const PENDING_KEY = 'aca_limpieza_v1_pending';
const AUTH_KEY = 'aca_limpieza_v1_auth';
const API_BASE = '/api/limpieza';

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** CSS class suffix for a JS weekday index (0=Sun..6=Sat). */
export const dayCls = (d) => String(((d % 7) + 7) % 7);

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---------- default data (used when no cache and no server) ---------- */

function seedTasks() {
  const t = (name, requiresEmpty = false) => ({
    id: uid(), name, days: [4, 6], requiresEmpty, needed: 1, gender: 'any',
  });
  return [
    t('Quitar polvo de las sillas'),
    t('Quitar polvo mobiliario general (pasamanos, barandillas, caja donaciones, sonido, publicaciones, etc.)'),
    t('Quitar polvo plataforma (atril, mesa y sillas)'),
    t('Vaciar papeleras'),
    t('Rellenar vasos, papel higiénico, secamanos y jabón'),
    t('Baño hombres (limpiar y desinfectar lavamanos, inodoros y suelo)', true),
    t('Baño mujeres (limpiar y desinfectar lavamanos, inodoros y suelo)', true),
    t('Lavar las bayetas en casa'),
    t('Barrer entrada salón'),
    t('Barrer entrada vivienda'),
    t('Aspirar plataforma'),
    t('Aspirar auditorio', true),
  ];
}

function defaultData() {
  return {
    version: 1,
    settings: { groupTitle: 'Tareas limpieza G2', days: [4, 6] },
    tasks: seedTasks(),
    volunteers: [],
    plannings: [],
  };
}

/* ---------- in-memory state + cache ---------- */

let data = loadCache() || defaultData();
let versions = loadVersions() || { settings: 0, tasks: 0, volunteers: 0, plannings: 0 };
let pending = loadPending();
let auth = loadAuth();
let isOnline = navigator.onLine;
let syncListeners = [];

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !Array.isArray(p.tasks)) return null;
    return p;
  } catch { return null; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}
function loadVersions() {
  try {
    const raw = localStorage.getItem(CACHE_KEY + '_versions');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveVersions() {
  try { localStorage.setItem(CACHE_KEY + '_versions', JSON.stringify(versions)); } catch {}
}
function loadPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function savePending() {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch {}
}
function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveAuth(a) {
  auth = a;
  try {
    if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else localStorage.removeItem(AUTH_KEY);
  } catch {}
}

/* ---------- API helpers ---------- */

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `http_${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/* ---------- online / offline detection ---------- */

window.addEventListener('online', () => { isOnline = true; flushPending().catch(() => {}); });
window.addEventListener('offline', () => { isOnline = false; notifySync(); });

export function onSyncStateChange(cb) {
  syncListeners.push(cb);
  return () => { syncListeners = syncListeners.filter(l => l !== cb); };
}
function notifySync() {
  for (const cb of syncListeners) {
    try { cb({ online: isOnline, pending: pending.length, authed: !!auth?.token }); } catch {}
  }
}

/* ---------- sync engine ---------- */

async function flushPending() {
  if (!auth?.token || !isOnline) return;
  if (!pending.length) return;
  // Snapshot to avoid mutation during iteration
  const queue = [...pending];
  for (const item of queue) {
    try {
      const r = await api('PUT', `/data/${item.section}`, { payload: item.payload, version: item.version });
      if (r.applied) {
        versions[item.section] = r.version;
        pending = pending.filter(p => !(p.section === item.section && p.version <= r.version));
        savePending();
        saveVersions();
      } else {
        // Server has newer version → fetch it and drop our pending for this section
        pending = pending.filter(p => p.section !== item.section);
        savePending();
        await refreshFromServer();
        break; // refresh changed all data, restart queue
      }
    } catch (e) {
      if (e.status === 401) { logout(); break; }
      if (e.status >= 500 || e.status === 0) break; // server down → keep queued
      // 4xx other than 401: bad request → drop to avoid poison-pill loop
      pending = pending.filter(p => !(p.section === item.section && p.version === item.version));
      savePending();
    }
  }
  notifySync();
}

async function refreshFromServer() {
  if (!auth?.token || !isOnline) return;
  try {
    const r = await api('GET', '/data');
    // Merge server payload with local defaults so missing fields (e.g. an
    // empty settings object from a fresh server install) don't break code
    // that does [...db.settings.days]. Server is authoritative for values
    // it DOES provide; defaults fill gaps.
    const def = defaultData();
    data = {
      version: 1,
      settings: { ...def.settings, ...(r.settings || {}) },
      tasks: r.tasks ?? def.tasks,
      volunteers: r.volunteers ?? [],
      plannings: r.plannings ?? [],
    };
    versions = r.versions;
    saveCache();
    saveVersions();
    notifySync();
  } catch (e) {
    if (e.status === 401) logout();
  }
}

/* ---------- internal save helper ---------- */

function bumpVersion(section) {
  versions[section] = (versions[section] || 0) + 1;
  saveVersions();
}

async function pushSection(section) {
  saveCache();
  if (!auth?.token || !isOnline) {
    pending.push({ section, payload: data[section], version: versions[section], ts: Date.now() });
    savePending();
    notifySync();
    return;
  }
  try {
    const r = await api('PUT', `/data/${section}`, { payload: data[section], version: versions[section] });
    if (r.applied) {
      versions[section] = r.version;
      saveVersions();
    } else {
      // Server newer → grab it
      await refreshFromServer();
    }
  } catch (e) {
    if (e.status === 401) { logout(); return; }
    if (e.status >= 500 || e.status === 0) {
      pending.push({ section, payload: data[section], version: versions[section], ts: Date.now() });
      savePending();
    }
  }
  notifySync();
}

/* ---------- auth ---------- */

export async function login(username, password) {
  const r = await api('POST', '/auth/login', { username, password });
  saveAuth({ token: r.token, user: r.user });
  // Pull fresh data from server
  await refreshFromServer();
  // After login, flush any pending changes that were queued while offline
  await flushPending();
  notifySync();
  return r.user;
}

/** Rotate the current session token (sliding session).
 *
 *  Calls POST /auth/refresh with the current token; on success the new token
 *  + user are saved to localStorage. The old token is invalidated server-side
 *  atomically with the new one being issued. If the call fails (offline,
 *  expired token), we keep the existing token — `isAuthenticated()` continues
 *  to work as long as the old token is still valid server-side.
 *
 *  Always fire-and-forget from the caller — never block user-facing flows on it.
 */
export async function refreshAuth() {
  if (!auth?.token) return;
  try {
    const r = await api('POST', '/auth/refresh', {});
    saveAuth({ token: r.token, user: r.user });
  } catch (e) {
    if (e.status === 401) {
      // Token rejected server-side (expired or rotated elsewhere) — drop it.
      saveAuth(null);
    }
    // Any other error: keep current token, will retry on next boot.
  }
}

export function logout() {
  if (auth?.token && isOnline) {
    api('POST', '/auth/logout').catch(() => {});
  }
  saveAuth(null);
  data = defaultData();
  versions = { settings: 0, tasks: 0, volunteers: 0, plannings: 0 };
  pending = [];
  saveCache();
  saveVersions();
  savePending();
  notifySync();
}

export function currentUser() { return auth?.user || null; }
export function isAuthenticated() { return !!auth?.token; }

/* ---------- db facade (interface preserved from v1) ---------- */

export const db = {
  get settings() { return data.settings; },
  get tasks() { return data.tasks; },
  get volunteers() { return data.volunteers; },
  get plannings() { return data.plannings; },

  saveSettings(patch) {
    Object.assign(data.settings, patch);
    bumpVersion('settings');
    pushSection('settings');
  },

  upsertTask(task) {
    const i = data.tasks.findIndex(t => t.id === task.id);
    if (i >= 0) data.tasks[i] = task; else data.tasks.push(task);
    bumpVersion('tasks');
    pushSection('tasks');
  },
  deleteTask(id) {
    data.tasks = data.tasks.filter(t => t.id !== id);
    bumpVersion('tasks');
    pushSection('tasks');
  },
  moveTask(id, dir) {
    const i = data.tasks.findIndex(t => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= data.tasks.length) return;
    [data.tasks[i], data.tasks[j]] = [data.tasks[j], data.tasks[i]];
    bumpVersion('tasks');
    pushSection('tasks');
  },

  upsertVolunteer(vol) {
    const i = data.volunteers.findIndex(v => v.id === vol.id);
    if (i >= 0) data.volunteers[i] = vol; else data.volunteers.push(vol);
    bumpVersion('volunteers');
    pushSection('volunteers');
  },
  deleteVolunteer(id) {
    data.volunteers = data.volunteers.filter(v => v.id !== id);
    for (const p of data.plannings) {
      for (const k of Object.keys(p.assignments)) {
        p.assignments[k] = p.assignments[k].filter(vid => vid !== id);
      }
    }
    bumpVersion('volunteers');
    bumpVersion('plannings');
    pushSection('volunteers');
    pushSection('plannings');
  },

  upsertPlanning(p) {
    p.updatedAt = new Date().toISOString();
    const i = data.plannings.findIndex(x => x.id === p.id);
    if (i >= 0) data.plannings[i] = p; else data.plannings.push(p);
    bumpVersion('plannings');
    pushSection('plannings');
  },
  deletePlanning(id) {
    data.plannings = data.plannings.filter(p => p.id !== id);
    bumpVersion('plannings');
    pushSection('plannings');
  },
  getPlanning(id) { return data.plannings.find(p => p.id === id); },

  exportJSON() { return JSON.stringify(data, null, 2); },
  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Formato inválido');
    for (const k of ['settings', 'tasks', 'volunteers', 'plannings']) {
      if (!(k in parsed)) throw new Error(`Falta la clave "${k}"`);
    }
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.volunteers) || !Array.isArray(parsed.plannings)) {
      throw new Error('Estructura inválida');
    }
    data = parsed;
    for (const s of ['tasks', 'volunteers', 'plannings']) bumpVersion(s);
    pushSection('tasks');
    pushSection('volunteers');
    pushSection('plannings');
  },
  reset() {
    data = defaultData();
    for (const s of ['settings', 'tasks', 'volunteers', 'plannings']) bumpVersion(s);
    pushSection('settings');
    pushSection('tasks');
    pushSection('volunteers');
    pushSection('plannings');
  },

  /** Pull fresh data from server. Safe to call anytime. */
  async refresh() {
    await refreshFromServer();
  },
  /** Push any queued offline changes. Returns when done. */
  async sync() {
    await flushPending();
  },
  /** Current sync state for UI indicators. */
  syncState() {
    return { online: isOnline, pending: pending.length, authed: !!auth?.token };
  },
};

/* ---------- migration: localStorage → server ---------- */

/** Returns true if there is data in localStorage that hasn't been uploaded. */
export function hasLocalData() {
  if (!auth?.token) return false;
  const versions_raw = loadVersions();
  // If we already have versions > 0, we've uploaded before
  if (versions_raw && Object.values(versions_raw).some(v => v > 0)) return false;
  // Otherwise check if there's meaningful data (volunteers or non-default tasks/plannings)
  if (data.volunteers.length > 0) return true;
  if (data.plannings.length > 0) return true;
  return false;
}

/** Push current local data to the server as an initial migration. */
export async function migrateFromLocal() {
  if (!auth?.token) throw new Error('Not authenticated');
  // Make sure we have the latest local data loaded
  data = loadCache() || defaultData();
  for (const section of ['settings', 'tasks', 'volunteers', 'plannings']) {
    versions[section] = 1; // claim version 1 since this is a fresh server
    saveVersions();
    await pushSection(section);
  }
  await refreshFromServer();
}

/* ---------- date helpers (unchanged from v1) ---------- */

export function toISO(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function fmtShort(iso) {
  const d = fromISO(iso);
  return `${d.getDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()]}`;
}
export function fmtDM(iso) {
  const d = fromISO(iso);
  const z = n => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}`;
}

export function weekDates(dateISO, weekdays) {
  const d = fromISO(dateISO);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out = {};
  for (const w of [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + ((w + 6) % 7));
    out[w] = toISO(dd);
  }
  return out;
}

export function planningDatesSorted(p) {
  return Object.entries(p.dates)
    .map(([w, iso]) => ({ weekday: Number(w), iso }))
    .sort((a, b) => a.iso.localeCompare(b.iso));
}
export function planningLabel(p) {
  const ds = planningDatesSorted(p);
  return ds.map(d => `${WEEKDAYS_SHORT[d.weekday]} ${fmtShort(d.iso)}`).join(' · ');
}
export function planningMinDate(p) {
  return planningDatesSorted(p)[0]?.iso ?? '';
}
export function tasksForDay(weekday) {
  return db.tasks.filter(t => t.days.includes(weekday));
}
export function slotKey(taskId, weekday) {
  return `${taskId}|${weekday}`;
}
export function previousPlanning(p) {
  const min = planningMinDate(p);
  return db.plannings
    .filter(x => x.id !== p.id && planningMinDate(x) < min)
    .sort((a, b) => planningMinDate(b).localeCompare(planningMinDate(a)))[0] || null;
}
export function didTaskInPrevious(p, taskId, volId) {
  const prev = previousPlanning(p);
  if (!prev) return false;
  return Object.entries(prev.assignments).some(
    ([k, vols]) => k.split('|')[0] === taskId && vols.includes(volId)
  );
}
export function timesDidTask(p, taskId, volId) {
  const min = planningMinDate(p);
  let n = 0;
  for (const x of db.plannings) {
    if (x.id === p.id || planningMinDate(x) >= min) continue;
    for (const [k, vols] of Object.entries(x.assignments)) {
      if (k.split('|')[0] === taskId && vols.includes(volId)) n++;
    }
  }
  return n;
}
export function planningProgress(p) {
  let need = 0, have = 0;
  for (const [w] of Object.entries(p.dates)) {
    for (const t of tasksForDay(Number(w))) {
      need += t.needed;
      have += Math.min((p.assignments[slotKey(t.id, Number(w))] || []).length, t.needed);
    }
  }
  return { need, have };
}
export function newPlanning(dates) {
  return {
    id: uid(),
    status: 'draft',
    dates,
    assignments: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
