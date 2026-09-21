import { icon } from './icons.js';
import { WEEKDAYS_SHORT, toISO } from './store.js';

/** Hyperscript-style element builder. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function toast(msg, icName = 'check') {
  const host = document.getElementById('toast-host');
  const t = h('div', { class: 'toast', html: icon(icName) }, msg);
  host.append(t);
  setTimeout(() => t.remove(), 2600);
}

/**
 * Two-letter avatar initials from a full name.
 * - "Ana López"           -> "AL"
 * - "Roberto Hernández"   -> "RH"
 * - "Polina de Pérez"     -> "Po"   (because P+P collide, fall back to first 2 letters of given name)
 * - "Yuri"                -> "YU"   (single token: first two letters)
 * - "" or null            -> "?"
 */
export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0].charAt(0);
  if (parts.length === 1) {
    return (parts[0].substring(0, 2) || '?').toUpperCase();
  }
  const last = parts[parts.length - 1].charAt(0);
  if (first.toLowerCase() === last.toLowerCase()) {
    return (parts[0].substring(0, 2) || '?').toUpperCase();
  }
  return (first + last).toUpperCase();
}

/* ---------- bottom sheet ---------- */

const sheet = () => document.getElementById('sheet');

export function openSheet(title, ...content) {
  const dlg = sheet();
  dlg.innerHTML = '';
  dlg.append(
    h('div', { class: 'sheet-inner' },
      h('div', { class: 'sheet-handle' }),
      title ? h('h2', {}, title) : null,
      ...content,
    )
  );
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  return dlg;
}

export function closeSheet() { sheet().close(); }

export function confirmSheet({ title, message, okLabel = 'Eliminar', danger = true }) {
  return new Promise(resolve => {
    let settled = false;
    const settle = (val) => { if (!settled) { settled = true; resolve(val); } };
    const dlg = openSheet(title,
      h('p', { style: 'color:var(--text-soft);margin:0 0 4px' }, message),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { dlg.close(); settle(false); } }, 'Cancelar'),
        h('button', {
          class: `btn ${danger ? 'danger' : 'primary'}`,
          onclick: () => { dlg.close(); settle(true); },
        }, okLabel),
      ),
    );
    dlg.addEventListener('close', () => settle(false), { once: true });
  });
}

/* ---------- form controls ---------- */

export function switchCtl(initial, onChange) {
  const b = h('button', {
    type: 'button',
    class: `switch ${initial ? 'on' : ''}`,
    role: 'switch',
    'aria-checked': String(!!initial),
    onclick: () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-checked', String(on));
      onChange?.(on);
    },
  });
  b.value = () => b.classList.contains('on');
  return b;
}

export function switchRow(label, sub, initial, onChange) {
  const sw = switchCtl(initial, onChange);
  const row = h('div', { class: 'switch-row' },
    h('div', { class: 'lbl' }, label, sub ? h('small', {}, sub) : null),
    sw,
  );
  row.sw = sw;
  return row;
}

export function chipChoice(label, on, onToggle, icName = null, extraCls = '') {
  return h('button', {
    type: 'button',
    class: `chip-choice ${extraCls} ${on ? 'on' : ''}`.trim(),
    html: icName ? icon(icName) : '',
    onclick: e => {
      const btn = e.currentTarget;
      btn.classList.toggle('on');
      onToggle?.(btn.classList.contains('on'));
    },
  }, label);
}

export function stepper(initial, min, max, onChange) {
  let val = initial;
  const span = h('span', {}, String(val));
  const set = v => { val = Math.min(max, Math.max(min, v)); span.textContent = String(val); onChange?.(val); };
  const ctl = h('div', { class: 'stepper' },
    h('button', { type: 'button', onclick: () => set(val - 1) }, '−'),
    span,
    h('button', { type: 'button', onclick: () => set(val + 1) }, '+'),
  );
  ctl.value = () => val;
  return ctl;
}

export function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, 'aria-label': label, title: label, html: icon(name), onclick });
}

/* ---------- calendar ---------- */

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/**
 * Month calendar; only `selectableWeekdays` are clickable.
 * onPick(iso) is called with the chosen date.
 */
export function calendar({ selectableWeekdays, onPick }) {
  const today = new Date();
  let year = today.getFullYear(), month = today.getMonth();
  const root = h('div', { class: 'cal' });

  function render() {
    root.innerHTML = '';
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const head = h('div', { class: 'cal-head' },
      iconBtn('back', 'Mes anterior', () => { month--; if (month < 0) { month = 11; year--; } render(); }),
      h('div', { class: 'mon' }, `${MONTHS[month]} ${year}`),
      iconBtn('chevR', 'Mes siguiente', () => { month++; if (month > 11) { month = 0; year++; } render(); }),
    );

    const grid = h('div', { class: 'cal-grid' });
    for (let i = 1; i <= 7; i++) grid.append(h('div', { class: 'dow' }, WEEKDAYS_SHORT[i % 7]));
    for (let i = 0; i < startOffset; i++) grid.append(h('div'));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const selectable = selectableWeekdays.includes(date.getDay());
      const isToday = toISO(date) === toISO(today);
      grid.append(h('button', {
        type: 'button',
        class: `cal-day ${selectable ? 'selectable' : ''} ${isToday ? 'today' : ''}`,
        disabled: !selectable,
        onclick: () => onPick(toISO(date)),
      }, String(d)));
    }
    root.append(head, grid);
  }
  render();
  return root;
}
