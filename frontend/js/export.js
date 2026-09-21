import {
  db, WEEKDAYS, fmtDM, planningDatesSorted, tasksForDay, slotKey,
} from './store.js';

const volName = id => db.volunteers.find(v => v.id === id)?.name || '¿?';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- WhatsApp text ---------- */

export function whatsappText(p) {
  const days = planningDatesSorted(p);
  const lines = [`🧹 *${db.settings.groupTitle}*`];
  lines.push(`📅 ${days.map(d => `${cap(WEEKDAYS[d.weekday])} ${fmtDM(d.iso)}`).join(' y ')}`);
  lines.push('');

  // volunteer -> [{day, task}]
  const byVol = new Map();
  for (const { weekday } of days) {
    for (const task of tasksForDay(weekday)) {
      for (const vid of p.assignments[slotKey(task.id, weekday)] || []) {
        if (!byVol.has(vid)) byVol.set(vid, []);
        byVol.get(vid).push({ weekday, task });
      }
    }
  }

  const sorted = [...byVol.entries()].sort((a, b) =>
    volName(a[0]).localeCompare(volName(b[0]), 'es'));

  let hasWait = false;
  for (const [vid, items] of sorted) {
    lines.push(`*${volName(vid)}*`);
    for (const { weekday, task } of items) {
      const wait = task.requiresEmpty ? ' ⚠️' : '';
      if (task.requiresEmpty) hasWait = true;
      lines.push(`• ${cap(WEEKDAYS[weekday])}: ${task.name}${wait}`);
    }
    lines.push('');
  }
  if (!sorted.length) lines.push('_Sin voluntarios asignados_', '');
  if (hasWait) lines.push('⚠️ _Esperar a que el salón esté vacío antes de empezar_');
  return lines.join('\n').trim();
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/* ---------- Image (canvas, mimics the printed sheet) ---------- */

const C = {
  headerBg: '#29abe2',
  dayBg: '#a8d8f0',
  xBg: '#e8231a',
  xText: '#ffe92a',
  border: '#1a1a1a',
  text: '#1a1a1a',
};

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function renderImage(p) {
  const scale = 2;
  const W = 1000;
  const M = 36;
  const colDay = 64, colX = 44, colAsg = 250;
  const colTask = W - M * 2 - colDay - colX - colAsg;
  const lineH = 26, padY = 10;
  const taskFont = '17px system-ui, sans-serif';

  const days = planningDatesSorted(p);

  // measure pass
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = taskFont;
  const rows = [];
  for (const { weekday } of days) {
    for (const task of tasksForDay(weekday)) {
      const nameLines = wrapText(meas, task.name, colTask - 24);
      const vols = (p.assignments[slotKey(task.id, weekday)] || []).map(volName);
      const asgLines = wrapText(meas, vols.join(' / ') || '—', colAsg - 24);
      const h = Math.max(nameLines.length, asgLines.length) * lineH + padY * 2;
      rows.push({ weekday, task, nameLines, asgLines, h });
    }
  }

  const headH = 44;
  const titleH = 110;
  const footH = 70;
  const tableH = headH + rows.reduce((s, r) => s + r.h, 0);
  const H = titleH + tableH + footH;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  // title
  ctx.fillStyle = C.text;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(db.settings.groupTitle, W / 2, 56);
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText(days.map(d => `${cap(WEEKDAYS[d.weekday])} ${fmtDM(d.iso)}`).join('  ·  '), W / 2, 92);
  ctx.textAlign = 'left';

  const x0 = M, x1 = M + colDay, x2 = x1 + colX, x3 = x2 + colTask, x4 = W - M;
  let y = titleH;

  // header row
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(x0, y, x4 - x0, headH);
  ctx.fillStyle = C.text;
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('DÍA', x0 + 8, y + headH / 2);
  ctx.fillText('TAREA', x2 + 12, y + headH / 2);
  ctx.fillText('ASIGNADO', x3 + 12, y + headH / 2);
  y += headH;

  // group rows by day to draw the day band
  const dayStart = {};
  const dayEnd = {};
  let yy = y;
  for (const r of rows) {
    if (!(r.weekday in dayStart)) dayStart[r.weekday] = yy;
    dayEnd[r.weekday] = yy + r.h;
    yy += r.h;
  }

  for (const { weekday } of days) {
    if (!(weekday in dayStart)) continue;
    const ys = dayStart[weekday], ye = dayEnd[weekday];
    ctx.fillStyle = C.dayBg;
    ctx.fillRect(x0, ys, colDay, ye - ys);
    ctx.save();
    ctx.translate(x0 + colDay / 2, (ys + ye) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.fillText(WEEKDAYS[weekday].toUpperCase(), 0, 0);
    ctx.restore();
  }

  // rows
  for (const r of rows) {
    if (r.task.requiresEmpty) {
      ctx.fillStyle = C.xBg;
      ctx.fillRect(x1, y, colX, r.h);
      ctx.fillStyle = C.xText;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('X', x1 + colX / 2, y + r.h / 2);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = C.text;
    ctx.font = taskFont;
    const nameY0 = y + r.h / 2 - (r.nameLines.length - 1) * lineH / 2;
    r.nameLines.forEach((ln, i) => ctx.fillText(ln, x2 + 12, nameY0 + i * lineH));
    const asgY0 = y + r.h / 2 - (r.asgLines.length - 1) * lineH / 2;
    r.asgLines.forEach((ln, i) => ctx.fillText(ln, x3 + 12, asgY0 + i * lineH));

    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y, colX, r.h);
    ctx.strokeRect(x2, y, colTask, r.h);
    ctx.strokeRect(x3, y, colAsg, r.h);
    y += r.h;
  }
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, titleH, x4 - x0, tableH);

  // footer
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#444';
  ctx.fillText('Las tareas marcadas con una X requieren esperar a que el salón esté vacío.', x0, y + 36);

  return canvas;
}

export async function shareOrDownloadImage(p, filename) {
  const canvas = renderImage(p);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: db.settings.groupTitle });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

/* ---------- PDF (print view) ---------- */

export function printPDF(p) {
  const host = document.getElementById('print-host');
  const days = planningDatesSorted(p);
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let rowsHtml = '';
  for (const { weekday } of days) {
    const tasks = tasksForDay(weekday);
    tasks.forEach((task, i) => {
      const vols = (p.assignments[slotKey(task.id, weekday)] || []).map(volName).join(' / ') || '—';
      const dayCell = i === 0
        ? `<td class="p-day" rowspan="${tasks.length}"><span>${esc(WEEKDAYS[weekday].toUpperCase())}</span></td>`
        : '';
      const xCell = task.requiresEmpty ? '<td class="p-x">X</td>' : '<td class="p-x-empty"></td>';
      rowsHtml += `<tr>${dayCell}${xCell}<td class="p-task">${esc(task.name)}</td><td class="p-asg">${esc(vols)}</td></tr>`;
    });
  }

  host.innerHTML = `
    <style>
      .p-doc { font-family: system-ui, sans-serif; color: #1a1a1a; padding: 10mm; }
      .p-doc h1 { text-align: center; font-size: 26pt; margin: 0 0 4mm; }
      .p-doc .p-sub { text-align: center; color: #555; margin: 0 0 8mm; font-size: 12pt; }
      .p-doc table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
      .p-doc th { background: #29abe2; text-align: left; padding: 2.5mm; border: 1px solid #1a1a1a; }
      .p-doc td { border: 1px solid #1a1a1a; padding: 2mm 2.5mm; vertical-align: middle; }
      .p-day { background: #a8d8f0; width: 12mm; text-align: center; }
      .p-day span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 700; font-size: 13pt; letter-spacing: 2px; }
      .p-x { background: #e8231a; color: #ffe92a; font-weight: 700; text-align: center; width: 8mm; }
      .p-x-empty { width: 8mm; }
      .p-asg { width: 45mm; }
      .p-note { margin-top: 8mm; font-size: 10pt; }
      .p-note b { background: #e8231a; color: #ffe92a; padding: 0 1.5mm; }
      @page { size: A4 portrait; margin: 8mm; }
    </style>
    <div class="p-doc">
      <h1>${esc(db.settings.groupTitle)}</h1>
      <p class="p-sub">${days.map(d => `${cap(WEEKDAYS[d.weekday])} ${fmtDM(d.iso)}`).join(' · ')}</p>
      <table>
        <tr><th style="width:12mm">DÍA</th><th style="width:8mm"></th><th>TAREA</th><th style="width:45mm">ASIGNADO</th></tr>
        ${rowsHtml}
      </table>
      <p class="p-note"><strong>MUY IMPORTANTE:</strong> las tareas marcadas con una <b>X</b> requieren esperar un tiempo prudencial a que el salón esté vacío.</p>
    </div>`;
  window.print();
}
