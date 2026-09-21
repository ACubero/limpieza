import {
  db, WEEKDAYS, weekDates, newPlanning, planningLabel, planningMinDate,
  planningDatesSorted, tasksForDay, slotKey, didTaskInPrevious, planningProgress, fmtDM, uid, dayCls,
} from '../store.js';
import { h, toast, openSheet, closeSheet, confirmSheet, calendar, iconBtn, initials } from '../ui.js';
import { icon } from '../icons.js';
import { isEligible, autoAssign } from '../autoassign.js';
import { whatsappText, copyToClipboard, shareOrDownloadImage, printPDF } from '../export.js';
import { navigate } from '../app.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ================= list ================= */

export function planningListView(root) {
  const sorted = [...db.plannings].sort((a, b) =>
    planningMinDate(b).localeCompare(planningMinDate(a)));

  if (!sorted.length) {
    root.append(h('div', { class: 'empty', html: icon('calendar') },
      h('div', {}, 'Sin plannings todavía.'),
      h('div', { style: 'font-size:13px' }, 'Crea el primero con el botón +'),
    ));
  }

  for (const p of sorted) {
    const { need, have } = planningProgress(p);
    const done = p.status === 'final';
    root.append(h('div', { class: 'card tappable', onclick: () => navigate(`#/planning/${p.id}`) },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, planningLabel(p)),
          h('div', { class: 'subtitle' }, `${have}/${need} asignaciones`),
        ),
        h('span', { class: `badge ${done ? 'ok' : 'warn'}` }, done ? 'Finalizado' : 'Borrador'),
        iconBtn('duplicate', 'Clonar', e => { e.stopPropagation(); clonePlanning(p); }),
        iconBtn('trash', 'Eliminar', async e => {
          e.stopPropagation();
          if (await confirmSheet({ title: 'Eliminar planning', message: `Se eliminará "${planningLabel(p)}".` })) {
            db.deletePlanning(p.id);
            navigate('#/plannings');
            toast('Planning eliminado', 'trash');
          }
        }),
      ),
      h('div', { class: `progress ${have >= need && need > 0 ? 'done' : ''}` },
        h('i', { style: `width:${need ? Math.round(have / need * 100) : 0}%` })),
    ));
  }

  root.append(h('button', { class: 'fab', 'aria-label': 'Nuevo planning', html: icon('plus'), onclick: () => pickWeek() }));
}

function pickWeek(clone = null) {
  const days = db.settings.days;
  if (!days.length) { toast('Configura los días de limpieza en Ajustes', 'warning'); return; }
  openSheet(clone ? 'Clonar planning: elige semana' : 'Nuevo planning: elige día',
    h('p', { style: 'color:var(--text-soft);font-size:13.5px;margin:0 0 10px' },
      `Días de limpieza: ${days.map(d => WEEKDAYS[d]).join(' y ')}. Al elegir uno se crea el planning de esa semana.`),
    calendar({
      selectableWeekdays: days,
      onPick: iso => {
        const dates = weekDates(iso, days);
        const dup = db.plannings.find(p => planningMinDate(p) === Object.values(dates).sort()[0]);
        if (dup) { toast('Ya existe un planning para esa semana', 'warning'); return; }
        const p = newPlanning(dates);
        if (clone) p.assignments = structuredClone(clone.assignments);
        db.upsertPlanning(p);
        closeSheet();
        navigate(`#/planning/${p.id}`);
        toast(clone ? 'Planning clonado' : 'Planning creado');
      },
    }),
  );
}

function clonePlanning(p) { pickWeek(p); }

/* ================= editor ================= */

export function planningEditorView(root, id) {
  const p = db.getPlanning(id);
  if (!p) { navigate('#/plannings'); return; }

  const render = () => { root.innerHTML = ''; build(); };

  function build() {
    const { need, have } = planningProgress(p);
    const done = p.status === 'final';

    root.append(h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, planningLabel(p)),
          h('div', { class: 'subtitle' }, `${have}/${need} asignaciones`),
        ),
        h('span', { class: `badge ${done ? 'ok' : 'warn'}` }, done ? 'Finalizado' : 'Borrador'),
      ),
      h('div', { class: `progress ${have >= need && need > 0 ? 'done' : ''}` },
        h('i', { style: `width:${need ? Math.round(have / need * 100) : 0}%` })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', html: icon('auto'), onclick: () => {
          if (!db.volunteers.length) { toast('Añade voluntarios primero', 'warning'); return; }
          const unfilled = autoAssign(p);
          db.upsertPlanning(p);
          render();
          toast(unfilled ? `Auto-asignado · ${unfilled} huecos sin candidato` : 'Auto-asignado', unfilled ? 'warning' : 'sparkle');
        } }, 'Auto-asignar'),
        done
          ? h('button', { class: 'btn', html: icon('edit'), onclick: () => {
              p.status = 'draft'; db.upsertPlanning(p); render(); toast('Planning reabierto');
            } }, 'Reabrir')
          : h('button', { class: 'btn primary', html: icon('check'), onclick: () => {
              p.status = 'final'; db.upsertPlanning(p); render(); exportSheet(p);
            } }, 'Finalizar'),
      ),
      done ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn', html: icon('whatsapp'), onclick: async () => {
          await copyToClipboard(whatsappText(p));
          toast('Texto copiado al portapapeles', 'whatsapp');
        } }, 'WhatsApp'),
        h('button', { class: 'btn', html: icon('image'), onclick: async () => {
          const r = await shareOrDownloadImage(p, `limpieza-${planningMinDate(p)}.png`);
          if (r === 'downloaded') toast('Imagen descargada', 'image');
        } }, 'Imagen'),
        h('button', { class: 'btn', html: icon('pdf'), onclick: () => printPDF(p) }, 'PDF'),
      ) : null,
    ));

    for (const { weekday, iso } of planningDatesSorted(p)) {
      const section = h('div', { class: 'day-section' },
        h('div', { class: `day-header day-${dayCls(weekday)}`, html: icon('calendar') },
          h('span', {}, ` ${cap(WEEKDAYS[weekday])} `),
          h('small', {}, fmtDM(iso)),
        ),
      );
      const tasks = tasksForDay(weekday);
      if (!tasks.length) {
        section.append(h('div', { class: 'card subtitle' }, 'No hay tareas configuradas para este día.'));
      }
      for (const task of tasks) section.append(taskRow(p, task, weekday, render));
      root.append(section);
    }
  }

  build();
}

function taskRow(p, task, weekday, render) {
  const key = slotKey(task.id, weekday);
  const assigned = p.assignments[key] || [];
  const missing = Math.max(0, task.needed - assigned.length);

  const flags = h('span', { class: 'task-flags' });
  if (task.requiresEmpty) flags.append(h('span', { class: 'flag-wait', title: 'Esperar salón vacío', html: icon('warning') }));
  if (task.gender === 'F') flags.append(h('span', { class: 'flag-gender', title: 'Solo mujeres', html: icon('female') }));
  if (task.gender === 'M') flags.append(h('span', { class: 'flag-gender', title: 'Solo hombres', html: icon('male') }));

  const chips = h('div', { class: 'assignees' });
  let anyRepeat = false;
  for (const vid of assigned) {
    const vol = db.volunteers.find(v => v.id === vid);
    const repeat = didTaskInPrevious(p, task.id, vid);
    if (repeat) anyRepeat = true;
    const genderCls = vol?.gender === 'F' ? 'gender-female' : 'gender-male';
    chips.append(h('button', {
      class: `vol-chip ${genderCls} ${repeat ? 'repeat' : ''}`,
      title: repeat ? 'Hizo esta tarea la vez anterior · toca para quitar' : 'Toca para quitar',
      onclick: () => {
        p.assignments[key] = assigned.filter(x => x !== vid);
        db.upsertPlanning(p);
        render();
      },
    }, repeat ? h('span', { html: icon('warning') }) : null, vol?.name || '¿?', h('span', { html: icon('x') })));
  }
  chips.append(h('button', {
    class: `add-chip ${missing ? 'missing' : ''}`,
    html: icon('plus'),
    onclick: () => volPicker(p, task, weekday, render),
  }, missing ? `Faltan ${missing}` : 'Añadir'));

  return h('div', { class: 'card task-row' },
    h('div', { class: 'task-name' }, task.name, flags),
    chips,
    anyRepeat ? h('div', { class: 'repeat-note', html: icon('warning') },
      'Repite la misma tarea que la vez anterior') : null,
  );
}

function volPicker(p, task, weekday, render) {
  const key = slotKey(task.id, weekday);
  const assigned = p.assignments[key] || [];
  const list = h('div');

  const vols = [...db.volunteers]
    .filter(v => !assigned.includes(v.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (!vols.length) list.append(h('p', { class: 'subtitle' }, 'No quedan voluntarios disponibles.'));

  for (const vol of vols) {
    const elig = isEligible(vol, task, weekday);
    if (!elig.ok && (task.gender === 'F' || task.gender === 'M') && vol.gender !== task.gender) continue; // hard block: hide
    const repeat = elig.ok && didTaskInPrevious(p, task.id, vol.id);
    list.append(h('button', {
      class: 'vol-option',
      disabled: !elig.ok,
      onclick: () => {
        p.assignments[key] = [...assigned, vol.id];
        db.upsertPlanning(p);
        closeSheet();
        render();
        if (repeat) toast('Aviso: hizo esta tarea la vez anterior', 'warning');
      },
    },
      h('span', { class: `avatar ${vol.gender === 'F' ? 'gender-female' : 'gender-male'}` }, initials(vol.name)),
      h('span', { class: 'grow' },
        h('span', { class: 'nm', style: 'display:block' }, vol.name),
        !elig.ok ? h('span', { class: 'why' }, elig.why)
          : repeat ? h('span', { class: 'why warn' }, '⚠ Hizo esta tarea la vez anterior') : null,
      ),
      repeat ? h('span', { style: 'color:var(--warn)', html: icon('warning') }) : null,
    ));
  }

  openSheet(`Asignar · ${task.name}`, list);
}

function exportSheet(p) {
  openSheet('Planning finalizado',
    h('p', { style: 'color:var(--text-soft);font-size:14px;margin:0 0 12px' }, 'Genera y comparte el resultado:'),
    h('button', { class: 'btn block', style: 'margin-bottom:10px', html: icon('whatsapp'), onclick: async () => {
      await copyToClipboard(whatsappText(p));
      toast('Texto copiado al portapapeles', 'whatsapp');
      closeSheet();
    } }, 'Texto WhatsApp (copia al portapapeles)'),
    h('button', { class: 'btn block', style: 'margin-bottom:10px', html: icon('image'), onclick: async () => {
      const r = await shareOrDownloadImage(p, `limpieza-${planningMinDate(p)}.png`);
      if (r === 'downloaded') toast('Imagen descargada', 'image');
      closeSheet();
    } }, 'Imagen (PNG)'),
    h('button', { class: 'btn block', html: icon('pdf'), onclick: () => { closeSheet(); printPDF(p); } }, 'Exportar PDF'),
  );
}
