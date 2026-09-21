import { db, tasksForDay, slotKey, didTaskInPrevious, timesDidTask } from './store.js';

export function isEligible(vol, task, weekday) {
  if (vol.active === false) return { ok: false, why: 'Inactivo' };
  if (task.gender === 'F' && vol.gender !== 'F') return { ok: false, why: 'Solo mujeres' };
  if (task.gender === 'M' && vol.gender !== 'M') return { ok: false, why: 'Solo hombres' };
  if (vol.days?.length && !vol.days.includes(weekday)) return { ok: false, why: 'No disponible este día' };
  if (task.requiresEmpty && !vol.canWait) return { ok: false, why: 'No puede esperar al salón vacío' };
  return { ok: true };
}

/**
 * Fill empty slots of the planning, avoiding the task each volunteer
 * did in the previous planning and balancing load. Mutates p.assignments.
 * Returns the number of slots left unfilled.
 */
export function autoAssign(p) {
  const counts = {}; // volId -> total this planning
  const dayCounts = {}; // volId|weekday -> count that day
  for (const [k, vols] of Object.entries(p.assignments)) {
    const w = k.split('|')[1];
    for (const v of vols) {
      counts[v] = (counts[v] || 0) + 1;
      dayCounts[`${v}|${w}`] = (dayCounts[`${v}|${w}`] || 0) + 1;
    }
  }

  // Pending slots, hardest-to-fill first (fewest eligible volunteers).
  const slots = [];
  for (const w of Object.keys(p.dates).map(Number)) {
    for (const task of tasksForDay(w)) {
      const key = slotKey(task.id, w);
      const assigned = p.assignments[key] || [];
      const missing = task.needed - assigned.length;
      if (missing <= 0) continue;
      const eligible = db.volunteers.filter(v => isEligible(v, task, w).ok);
      for (let i = 0; i < missing; i++) slots.push({ task, weekday: w, key, eligibleCount: eligible.length });
    }
  }
  slots.sort((a, b) => a.eligibleCount - b.eligibleCount);

  let unfilled = 0;
  for (const slot of slots) {
    const { task, weekday, key } = slot;
    const already = p.assignments[key] || [];
    const candidates = db.volunteers
      .filter(v => !already.includes(v.id) && isEligible(v, task, weekday).ok)
      .map(v => ({
        vol: v,
        score:
          (didTaskInPrevious(p, task.id, v.id) ? 100 : 0) +
          timesDidTask(p, task.id, v.id) * 10 +
          (dayCounts[`${v.id}|${weekday}`] || 0) * 6 +
          (counts[v.id] || 0) * 3 +
          Math.random(), // tiebreak
      }))
      .sort((a, b) => a.score - b.score);

    const pick = candidates[0];
    if (!pick) { unfilled++; continue; }
    p.assignments[key] = [...already, pick.vol.id];
    counts[pick.vol.id] = (counts[pick.vol.id] || 0) + 1;
    dayCounts[`${pick.vol.id}|${weekday}`] = (dayCounts[`${pick.vol.id}|${weekday}`] || 0) + 1;
  }
  return unfilled;
}
