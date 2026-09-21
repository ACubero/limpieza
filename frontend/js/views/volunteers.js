import { db, uid, WEEKDAYS, dayCls } from '../store.js';
import { h, toast, openSheet, closeSheet, confirmSheet, switchRow, chipChoice, initials } from '../ui.js';
import { icon } from '../icons.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Filter state: 'active' (default) | 'inactive' | 'all'. Persisted in localStorage. */
const FILTER_KEY = 'aca_limpieza_v1_volunteerFilter';

function getFilter() {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return (v === 'inactive' || v === 'all') ? v : 'active';
  } catch { return 'active'; }
}
function setFilter(v) {
  try { localStorage.setItem(FILTER_KEY, v); } catch {}
}

export function volunteersView(root, rerender) {
  const all = [...db.volunteers].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const active = all.filter(v => v.active !== false);
  const inactive = all.filter(v => v.active === false);

  const filter = getFilter();
  const vols = filter === 'inactive' ? inactive : filter === 'all' ? all : active;

  // Filter chips: count + current selection
  const filterRow = h('div', { class: 'filter-row' });
  for (const [val, label] of [
    ['active', `Activos (${active.length})`],
    ['inactive', `Inactivos (${inactive.length})`],
    ['all', `Todos (${all.length})`],
  ]) {
    const btn = h('button', {
      class: `chip-choice ${filter === val ? 'on' : ''}`,
      type: 'button',
      onclick: () => { if (filter !== val) { setFilter(val); rerender(); } },
    }, label);
    filterRow.append(btn);
  }
  root.append(filterRow);

  if (!all.length) {
    root.append(h('div', { class: 'empty', html: icon('users') },
      h('div', {}, 'Sin voluntarios. Añade el primero con el botón +')));
  } else if (!vols.length) {
    const msg = filter === 'inactive'
      ? 'No hay voluntarios inactivos.'
      : 'No hay voluntarios activos. Cambia el filtro para verlos.';
    root.append(h('div', { class: 'empty', html: icon('users') }, h('div', {}, msg)));
  }

  for (const vol of vols) {
    const genderClass = vol.gender === 'F' ? 'gender-female' : 'gender-male';
    const badges = h('div', { class: 'badges' },
      h('span', { class: `badge ${genderClass}`, html: icon(vol.gender === 'F' ? 'female' : 'male') },
        vol.gender === 'F' ? 'Mujer' : 'Hombre'),
    );
    if (vol.canWait) badges.append(h('span', { class: 'badge accent', html: icon('clock') }, 'Puede esperar'));
    const avail = vol.days?.length ? vol.days : db.settings.days;
    for (const d of avail) {
      badges.append(h('span', { class: `day-badge day-badge-${dayCls(d)}` }, cap(WEEKDAYS[d])));
    }
    if (vol.active === false) badges.append(h('span', { class: 'badge danger' }, 'Inactivo'));

    root.append(h('div', { class: 'card tappable', onclick: () => volForm(vol, rerender) },
      h('div', { class: 'row' },
        h('span', { class: `avatar ${genderClass}` }, initials(vol.name)),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, vol.name)),
        h('button', {
          class: 'icon-btn vol-del',
          'aria-label': `Eliminar a ${vol.name}`,
          title: 'Eliminar',
          html: icon('trash'),
          onclick: async (e) => {
            e.stopPropagation();
            if (await confirmSheet({ title: 'Eliminar voluntario', message: `Se eliminará "${vol.name}" y sus asignaciones en todos los plannings.` })) {
              db.deleteVolunteer(vol.id); rerender(); toast('Voluntario eliminado', 'trash');
            }
          },
        }),
      ),
      badges,
    ));
  }

  root.append(h('button', { class: 'fab', 'aria-label': 'Nuevo voluntario', html: icon('plus'), onclick: () => volForm(null, rerender) }));
}

function volForm(vol, rerender) {
  const isNew = !vol;
  const v = vol ? structuredClone(vol) : {
    id: uid(), name: '', gender: 'M', canWait: true, days: [...db.settings.days], active: true,
  };
  if (!Array.isArray(v.days)) v.days = [...db.settings.days];

  const nameInput = h('input', { class: 'input', value: v.name, placeholder: 'Nombre', maxlength: 80 });

  const genderRow = (() => {
    const row = h('div', { class: 'choice-row' });
    for (const [val, label, ic, cls] of [['M', 'Hombre', 'male', 'gender-male'], ['F', 'Mujer', 'female', 'gender-female']]) {
      const btn = chipChoice(label, v.gender === val, () => {
        v.gender = val;
        row.querySelectorAll('.chip-choice').forEach(b => b.classList.toggle('on', b === btn));
      }, ic, cls);
      row.append(btn);
    }
    return row;
  })();

  const dayChips = h('div', { class: 'choice-row' },
    db.settings.days.map(d => chipChoice(cap(WEEKDAYS[d]), v.days.includes(d), on => {
      v.days = on ? [...new Set([...v.days, d])] : v.days.filter(x => x !== d);
    }, null, `day-${dayCls(d)}`)),
  );

  const waitRow = switchRow('Puede esperar al salón vacío', 'Apto para tareas que requieren esperar', v.canWait, on => { v.canWait = on; });
  const activeRow = switchRow('Activo', 'Los inactivos no aparecen al asignar', v.active !== false, on => { v.active = on; });

  openSheet(isNew ? 'Nuevo voluntario' : 'Editar voluntario',
    h('div', { class: 'field' }, h('label', {}, 'Nombre'), nameInput),
    h('div', { class: 'field' }, h('label', {}, 'Sexo'), genderRow),
    h('div', { class: 'field' }, h('label', {}, 'Disponibilidad'), dayChips),
    h('div', { class: 'field' }, waitRow, activeRow),
    h('div', { class: 'btn-row' },
      !isNew ? h('button', { class: 'btn danger', html: icon('trash'), onclick: async () => {
        closeSheet();
        if (await confirmSheet({ title: 'Eliminar voluntario', message: `Se eliminará "${v.name}" y sus asignaciones en todos los plannings.` })) {
          db.deleteVolunteer(v.id); rerender(); toast('Voluntario eliminado', 'trash');
        }
      } }, 'Eliminar') : null,
      h('button', { class: 'btn primary', html: icon('check'), onclick: () => {
        v.name = nameInput.value.trim();
        if (!v.name) { toast('El nombre es obligatorio', 'warning'); return; }
        if (!v.days.length) { toast('Selecciona al menos un día de disponibilidad', 'warning'); return; }
        db.upsertVolunteer(v);
        closeSheet();
        rerender();
        toast(isNew ? 'Voluntario creado' : 'Voluntario guardado');
      } }, 'Guardar'),
    ),
  );
}
