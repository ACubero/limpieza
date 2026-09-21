import { db, uid, WEEKDAYS, dayCls } from '../store.js';
import { h, toast, openSheet, closeSheet, confirmSheet, switchRow, chipChoice, stepper, iconBtn } from '../ui.js';
import { icon } from '../icons.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function tasksView(root, rerender) {
  if (!db.tasks.length) {
    root.append(h('div', { class: 'empty', html: icon('clipboard') },
      h('div', {}, 'Sin tareas. Crea la primera con el botón +')));
  }

  db.tasks.forEach((task, i) => {
    const badges = h('div', { class: 'badges' });
    for (const d of task.days) {
      badges.append(h('span', { class: `day-badge day-badge-${dayCls(d)}` }, cap(WEEKDAYS[d])));
    }
    if (task.days.length === 0) badges.append(h('span', { class: 'badge' }, 'Sin día'));
    badges.append(h('span', { class: 'badge' }, `${task.needed} vol.`));
    if (task.requiresEmpty) badges.append(h('span', { class: 'badge danger', html: icon('warning') }, 'Salón vacío'));
    if (task.gender === 'F') badges.append(h('span', { class: 'badge gender-female', html: icon('female') }, 'Solo mujeres'));
    if (task.gender === 'M') badges.append(h('span', { class: 'badge gender-male', html: icon('male') }, 'Solo hombres'));

    root.append(h('div', { class: 'card tappable', onclick: () => taskForm(task, rerender) },
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'title', style: 'font-size:15px' }, task.name)),
        iconBtn('back', 'Subir', e => { e.stopPropagation(); db.moveTask(task.id, -1); rerender(); },
          i === 0 ? 'hide-disabled' : ''),
        iconBtn('chevR', 'Bajar', e => { e.stopPropagation(); db.moveTask(task.id, 1); rerender(); }),
      ),
      badges,
    ));
    // rotate arrows vertically
    const btns = root.lastChild.querySelectorAll('.icon-btn');
    btns[0].style.transform = 'rotate(90deg)';
    btns[1].style.transform = 'rotate(90deg)';
    if (i === 0) btns[0].style.visibility = 'hidden';
    if (i === db.tasks.length - 1) btns[1].style.visibility = 'hidden';
  });

  root.append(h('button', { class: 'fab', 'aria-label': 'Nueva tarea', html: icon('plus'), onclick: () => taskForm(null, rerender) }));
}

function taskForm(task, rerender) {
  const isNew = !task;
  const t = task ? structuredClone(task) : {
    id: uid(), name: '', days: [...db.settings.days], requiresEmpty: false, needed: 1, gender: 'any',
  };

  const nameInput = h('input', { class: 'input', value: t.name, placeholder: 'Ej. Vaciar papeleras', maxlength: 200 });

  const dayChips = h('div', { class: 'choice-row' },
    db.settings.days.map(d => chipChoice(cap(WEEKDAYS[d]), t.days.includes(d), on => {
      t.days = on ? [...new Set([...t.days, d])] : t.days.filter(x => x !== d);
    }, null, `day-${dayCls(d)}`)),
  );

  const genderChips = (() => {
    const opts = [['any', 'Cualquiera', null, ''], ['F', 'Solo mujeres', 'female', 'gender-female'], ['M', 'Solo hombres', 'male', 'gender-male']];
    const row = h('div', { class: 'choice-row' });
    for (const [val, label, ic, cls] of opts) {
      const btn = chipChoice(label, t.gender === val, () => {
        t.gender = val;
        row.querySelectorAll('.chip-choice').forEach(b => b.classList.toggle('on', b === btn));
      }, ic, cls);
      row.append(btn);
    }
    return row;
  })();

  const neededCtl = stepper(t.needed, 1, 9, v => { t.needed = v; });
  const waitRow = switchRow('Esperar salón vacío', 'No se puede empezar hasta que el salón quede libre', t.requiresEmpty, on => { t.requiresEmpty = on; });

  openSheet(isNew ? 'Nueva tarea' : 'Editar tarea',
    h('div', { class: 'field' }, h('label', {}, 'Nombre'), nameInput),
    h('div', { class: 'field' }, h('label', {}, 'Días que se hace'), dayChips),
    h('div', { class: 'field' }, h('label', {}, 'Voluntarios necesarios'), neededCtl),
    h('div', { class: 'field' }, h('label', {}, 'Restricción de sexo'), genderChips),
    h('div', { class: 'field' }, waitRow),
    h('div', { class: 'btn-row' },
      !isNew ? h('button', { class: 'btn danger', html: icon('trash'), onclick: async () => {
        closeSheet();
        if (await confirmSheet({ title: 'Eliminar tarea', message: `Se eliminará "${t.name}". Los plannings existentes dejarán de mostrarla.` })) {
          db.deleteTask(t.id); rerender(); toast('Tarea eliminada', 'trash');
        }
      } }, 'Eliminar') : null,
      h('button', { class: 'btn primary', html: icon('check'), onclick: () => {
        t.name = nameInput.value.trim();
        if (!t.name) { toast('El nombre es obligatorio', 'warning'); return; }
        if (!t.days.length) { toast('Selecciona al menos un día', 'warning'); return; }
        db.upsertTask(t);
        closeSheet();
        rerender();
        toast(isNew ? 'Tarea creada' : 'Tarea guardada');
      } }, 'Guardar'),
    ),
  );
}
