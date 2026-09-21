import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { planningListView, planningEditorView } from './views/plannings.js';
import { tasksView } from './views/tasks.js';
import { volunteersView } from './views/volunteers.js';
import { settingsView } from './views/settings.js';
import { login as apiLogin, logout as apiLogout, currentUser, isAuthenticated, db, hasLocalData, migrateFromLocal, onSyncStateChange, refreshAuth } from './store.js';

const NAV = [
  { hash: '#/plannings', label: 'Plannings', ic: 'calendar' },
  { hash: '#/tasks', label: 'Tareas', ic: 'clipboard' },
  { hash: '#/volunteers', label: 'Voluntarios', ic: 'users' },
  { hash: '#/settings', label: 'Ajustes', ic: 'gear' },
];

const view = () => document.getElementById('view');

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function syncBadge() {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  const s = db.syncState();
  if (!s.authed) { badge.hidden = true; return; }
  badge.hidden = false;
  if (!s.online) { badge.textContent = '⏸ offline'; badge.className = 'sync-badge offline'; }
  else if (s.pending > 0) { badge.textContent = `↻ ${s.pending}`; badge.className = 'sync-badge pending'; }
  else { badge.textContent = '✓'; badge.className = 'sync-badge ok'; }
}

function renderLogin() {
  const root = view();
  root.innerHTML = '';
  document.getElementById('page-title').textContent = 'Acceso';
  document.getElementById('btn-back').hidden = true;

  const wrap = h('div', { class: 'login-wrap' });
  wrap.append(h('div', { class: 'login-logo', html: icon('users') }));
  wrap.append(h('h1', { class: 'login-title' }, 'Limpieza'));
  wrap.append(h('p', { class: 'login-sub' }, 'Accede con tu usuario'));

  const userInput = h('input', { class: 'input', type: 'text', placeholder: 'Usuario', autocomplete: 'username' });
  const passInput = h('input', { class: 'input', type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' });
  // Eye toggle — keeps focus, doesn't reset value
  let showingPass = false;
  const eyeBtn = h('button', {
    class: 'eye-toggle',
    type: 'button',
    'aria-label': 'Mostrar contraseña',
    html: icon('eye'),
    onclick: () => {
      showingPass = !showingPass;
      passInput.type = showingPass ? 'text' : 'password';
      eyeBtn.innerHTML = icon(showingPass ? 'eyeOff' : 'eye');
      eyeBtn.setAttribute('aria-label', showingPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
      passInput.focus();
    },
  });
  const passWrap = h('div', { class: 'pass-wrap' }, passInput, eyeBtn);
  const errMsg = h('div', { class: 'login-err', hidden: true });
  const submitBtn = h('button', { class: 'btn block primary', type: 'button', html: icon('check') + ' Entrar' });

  async function doLogin() {
    submitBtn.disabled = true;
    errMsg.hidden = true;
    const u = userInput.value.trim();
    const p = passInput.value;
    if (!u || !p) {
      errMsg.hidden = false;
      errMsg.textContent = 'Introduce usuario y contraseña.';
      submitBtn.disabled = false;
      return;
    }
    try {
      const user = await apiLogin(u, p);
      // Sliding session: rotate the token so it expires 1 year from now.
      // Fire-and-forget — if it fails we keep the freshly-issued token from login.
      refreshAuth().catch(() => {});
      toast(`Hola, ${user.display_name}`);
      // Force navigation + render
      if (location.hash !== '#/plannings') location.hash = '#/plannings';
      else render();
      // If local data exists, prompt to migrate
      if (hasLocalData()) {
        setTimeout(() => showMigrationPrompt(), 100);
      }
    } catch (e) {
      errMsg.hidden = false;
      if (e.status === 401) errMsg.textContent = 'Usuario o contraseña incorrectos.';
      else if (e.status === 0) errMsg.textContent = 'Sin conexión al servidor.';
      else errMsg.textContent = `Error: ${e.message}`;
      submitBtn.disabled = false;
    }
  }

  userInput.onkeydown = passInput.onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  submitBtn.onclick = doLogin;

  wrap.append(h('div', { class: 'login-fields' }, userInput, passWrap, errMsg, submitBtn));
  root.append(wrap);
}

function showMigrationPrompt() {
  const root = view();
  root.innerHTML = '';
  root.append(h('div', { class: 'migrate-wrap' },
    h('div', { class: 'migrate-icon', html: icon('upload') }),
    h('h2', {}, 'Datos locales detectados'),
    h('p', {}, 'Hemos encontrado voluntarios y plannings guardados en este dispositivo. ¿Quieres subirlos al servidor para sincronizarlos con tu ayudante?'),
    h('p', { class: 'migrate-warn' }, 'Tu localStorage se conservará como copia de seguridad offline.'),
    h('button', { class: 'btn block primary', html: icon('upload') + ' Subir al servidor',
      onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Subiendo…';
        try {
          await migrateFromLocal();
          toast('Datos sincronizados', 'check');
          if (location.hash !== '#/plannings') location.hash = '#/plannings';
          else render();
        } catch (err) {
          toast('Error al migrar: ' + err.message, 'warning');
          e.target.disabled = false;
          e.target.innerHTML = icon('upload') + ' Reintentar';
        }
      } }),
    h('button', { class: 'btn block', onclick: () => {
      if (location.hash !== '#/plannings') location.hash = '#/plannings';
      else render();
    } }, 'No subir, empezar de cero en el servidor'),
  ));
}

function render() {
  if (!isAuthenticated()) { renderLogin(); syncBadge(); return; }

  const hash = location.hash || '#/plannings';
  const root = view();
  root.innerHTML = '';
  document.getElementById('sheet').close?.();

  const title = document.getElementById('page-title');
  const back = document.getElementById('btn-back');
  back.innerHTML = icon('back');
  back.onclick = () => navigate('#/plannings');

  const editorMatch = hash.match(/^#\/planning\/(.+)$/);
  if (editorMatch) {
    title.textContent = 'Planning';
    back.hidden = false;
    setActiveNav('#/plannings');
    planningEditorView(root, editorMatch[1]);
    window.scrollTo(0, 0);
    syncBadge();
    return;
  }

  back.hidden = true;
  const route = NAV.find(n => n.hash === hash) || NAV[0];
  title.textContent = route.label;
  setActiveNav(route.hash);

  const rerender = () => render();
  if (route.hash === '#/plannings') planningListView(root);
  else if (route.hash === '#/tasks') tasksView(root, rerender);
  else if (route.hash === '#/volunteers') volunteersView(root, rerender);
  else settingsView(root, rerender);
  window.scrollTo(0, 0);
  syncBadge();
}

function setActiveNav(hash) {
  document.querySelectorAll('.navitem').forEach(b =>
    b.classList.toggle('active', b.dataset.hash === hash));
}

function buildHeader() {
  const user = currentUser();
  if (!user) return;
  // Add logout button to header — must go INSIDE .topbar-actions so it
  // sits in the same flex row as the sync-badge. Appending to <header>
  // directly drops it on a second line below the topbar.
  const header = document.querySelector('header');
  if (!header || header.querySelector('.logout-btn')) return;
  const actions = header.querySelector('.topbar-actions');
  if (!actions) return; // bail rather than break the layout
  const btn = h('button', { class: 'icon-btn logout-btn', 'aria-label': 'Cerrar sesión', title: 'Cerrar sesión', html: icon('logout'),
    onclick: () => {
      if (confirm('¿Cerrar sesión?')) { apiLogout(); render(); }
    }
  });
  actions.append(btn);
}

function buildNav() {
  const nav = document.getElementById('bottomnav');
  for (const item of NAV) {
    nav.append(h('button', {
      class: 'navitem',
      dataset: { hash: item.hash },
      html: icon(item.ic),
      onclick: () => navigate(item.hash),
    }, h('span', {}, item.label)));
  }
}

buildNav();
buildHeader();
window.addEventListener('hashchange', render);
onSyncStateChange(() => { syncBadge(); });
render();

// Try to sync on startup if we have a token.
// IMPORTANT: await refreshAuth() before db.refresh() to avoid a race where
// refreshAuth rotates the token while db.refresh is mid-flight using the old
// one — the old one returns 401, db.refresh calls logout(), and the fresh
// token (which was just saved) gets invalidated server-side. Sliding session
// is preserved by the subsequent db.refresh call using the new token.
(async () => {
  if (isAuthenticated()) {
    await refreshAuth().catch(() => {});
    if (isAuthenticated()) {
      db.refresh().catch(() => {});
    }
  }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
