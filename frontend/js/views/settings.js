import { db, WEEKDAYS, toISO, dayCls } from '../store.js';
import { h, toast, chipChoice, confirmSheet } from '../ui.js';
import { icon } from '../icons.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function settingsView(root, rerender) {
  root.append(h('div', { class: 'section-label' }, 'General'));

  const titleInput = h('input', {
    class: 'input', value: db.settings.groupTitle, maxlength: 60,
    onchange: e => { db.saveSettings({ groupTitle: e.target.value.trim() || 'Limpieza' }); toast('Título guardado'); },
  });
  root.append(h('div', { class: 'card' },
    h('div', { class: 'field', style: 'margin-bottom:0' },
      h('label', {}, 'Título del grupo (aparece en exportaciones)'), titleInput),
  ));

  const daysCard = h('div', { class: 'card' },
    h('div', { class: 'field', style: 'margin-bottom:0' },
      h('label', {}, 'Días de limpieza'),
      h('div', { class: 'choice-row' },
        [1, 2, 3, 4, 5, 6, 0].map(d => chipChoice(cap(WEEKDAYS[d]), db.settings.days.includes(d), on => {
          const days = on
            ? [...new Set([...db.settings.days, d])]
            : db.settings.days.filter(x => x !== d);
          if (!days.length) { toast('Debe haber al menos un día', 'warning'); rerender(); return; }
          db.saveSettings({ days });
          toast('Días guardados');
        }, null, `day-${dayCls(d)}`)),
      ),
      h('p', { style: 'font-size:12.5px;color:var(--text-soft);margin:10px 0 0' },
        'Los plannings existentes no cambian; afecta a plannings nuevos, tareas y disponibilidad.'),
    ),
  );
  root.append(daysCard);

  root.append(h('div', { class: 'section-label' }, 'Copia de seguridad'));
  root.append(h('div', { class: 'card' },
    h('button', { class: 'btn block', style: 'margin-bottom:10px', html: icon('download'), onclick: exportBackup },
      'Exportar backup (JSON)'),
    h('button', { class: 'btn block', html: icon('upload'), onclick: importBackup }, 'Restaurar backup'),
    h('p', { style: 'font-size:12.5px;color:var(--text-soft);margin:10px 0 0' },
      'Los datos viven solo en este dispositivo. Exporta el backup para compartirlos o moverlos a otro móvil.'),
  ));

  root.append(h('div', { class: 'section-label' }, 'Datos'));
  root.append(h('div', { class: 'card' },
    h('button', { class: 'btn danger block', html: icon('trash'), onclick: async () => {
      if (await confirmSheet({
        title: 'Borrar todos los datos',
        message: 'Se eliminarán plannings, voluntarios y tareas, y se restaurarán las tareas de ejemplo. Esta acción no se puede deshacer.',
        okLabel: 'Borrar todo',
      })) { db.reset(); rerender(); toast('Datos restablecidos', 'trash'); }
    } }, 'Restablecer aplicación'),
  ));

  root.append(h('p', { style: 'text-align:center;color:var(--text-soft);font-size:12px;margin-top:20px' },
    'Limpieza · PWA · v1.0.0'));

  function exportBackup() {
    const blob = new Blob([db.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `limpieza-backup-${toISO(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup exportado', 'download');
  }

  function importBackup() {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text); // validate before asking
        if (await confirmSheet({
          title: 'Restaurar backup',
          message: 'Se reemplazarán TODOS los datos actuales por los del backup.',
          okLabel: 'Restaurar',
        })) {
          db.importJSON(text);
          rerender();
          toast('Backup restaurado');
        }
      } catch (e) {
        toast(`Backup inválido: ${e.message}`, 'warning');
      }
    };
    input.click();
  }
}
