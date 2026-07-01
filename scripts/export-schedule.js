#!/usr/bin/env node
/**
 * export-schedule.js
 * Fetches the current competition schedule from Firestore and prints a
 * GitHub-flavoured markdown table (hourly rows × day columns).
 *
 * Usage:
 *   node export-schedule.js [compId]
 *
 * If compId is omitted, picks the most recently started active competition.
 */

import admin from 'firebase-admin';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sa = require('./service-account.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// ── HELPERS ───────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }
function hhmm(totalMin) { return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`; }
function toMin(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const dm = pad2(d.getUTCDate());
  return `${wd} ${dm}`;
}

function slotLabel(slot, tests) {
  const type = slot.type || 'test';
  let name;
  if (type === 'inspection') name = 'Robot Inspection';
  else if (type === 'poster')    name = 'Poster Session';
  else if (type === 'mapping')   name = 'Arena Mapping';
  else if (type === 'other')     name = slot.label || 'Other Event';
  else name = tests[slot.testId]?.name || slot.testId || '?';

  const startMin = toMin(slot.time);
  const m = startMin % 60;

  // Include time range only when the slot doesn't land on a 30-min boundary
  if (m % 30 !== 0) {
    const endMin = startMin + (slot.durationMinutes || 60);
    return `${name}: ${hhmm(startMin)}–${hhmm(endMin)}`;
  }
  return name;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

const [,, argCompId] = process.argv;

const compsSnap = await db.collection('competitions').get();
const comps = compsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

let comp;
if (argCompId) {
  comp = comps.find(c => c.id === argCompId);
  if (!comp) { console.error(`Competition "${argCompId}" not found.`); process.exit(1); }
} else {
  // Pick the most recently started competition
  comp = comps
    .filter(c => c.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!comp) { console.error('No competitions found.'); process.exit(1); }
}

console.error(`Competition: ${comp.name} (${comp.id})`);

const [testsSnap, slotsSnap] = await Promise.all([
  db.collection('competitions').doc(comp.id).collection('tests').get(),
  db.collection('competitions').doc(comp.id).collection('slots').get(),
]);

const tests = {};
testsSnap.docs.forEach(d => { tests[d.id] = d.data(); });

const slots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

if (!slots.length) { console.error('No slots found.'); process.exit(1); }

// ── BUILD DAY LIST ────────────────────────────────────────────────────────────

const days = [];
const d0 = new Date(comp.startDate + 'T12:00:00Z');
const d1 = new Date(comp.endDate   + 'T12:00:00Z');
for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}

// ── DETERMINE HOUR RANGE ──────────────────────────────────────────────────────

let minSlot = Infinity, maxSlot = 0;  // in minutes, snapped to 30-min grid
for (const s of slots) {
  const start = toMin(s.time);
  const end   = start + (s.durationMinutes || 60);
  minSlot = Math.min(minSlot, Math.floor(start / 30) * 30);
  maxSlot = Math.max(maxSlot, Math.floor((end - 1) / 30) * 30);
}

// ── POPULATE GRID ─────────────────────────────────────────────────────────────
// grid[day][slotMin] = ordered array of label strings (slotMin in 30-min steps)

const grid = {};
for (const day of days) {
  grid[day] = {};
  for (let m = minSlot; m <= maxSlot; m += 30) grid[day][m] = [];
}

// Sort slots by time so they appear in order within a cell
slots.sort((a, b) => a.time.localeCompare(b.time));

for (const slot of slots) {
  const day = slot.date;
  if (!grid[day]) continue;

  const startMin = toMin(slot.time);
  const endMin   = startMin + (slot.durationMinutes || 60);
  const label    = slotLabel(slot, tests);

  // Fill every 30-min row the slot spans
  for (let m = Math.floor(startMin / 30) * 30; m < endMin; m += 30) {
    if (grid[day][m] === undefined) continue;
    if (!grid[day][m].includes(label)) grid[day][m].push(label);
  }
}

// ── RENDER TABLE ──────────────────────────────────────────────────────────────

const dayLabels = days.map(dayLabel);
const colWidth  = days.map((day, i) => {
  let w = dayLabels[i].length;
  for (let m = minSlot; m <= maxSlot; m += 30) {
    for (const lbl of grid[day][m]) w = Math.max(w, lbl.length);
  }
  return Math.max(w, 7);
});

function cell(text, width) { return text.padEnd(width); }

const timeColW = 5;
const header  = `| ${cell('', timeColW)} | ${dayLabels.map((l, i) => cell(l, colWidth[i])).join(' | ')} |`;
const divider = `| ${'-'.repeat(timeColW)} | ${colWidth.map(w => '-'.repeat(w)).join(' | ')} |`;

const rows = [];
for (let m = minSlot; m <= maxSlot; m += 30) {
  const timeStr = hhmm(m);
  const cells = days.map((day, i) => {
    const entries = grid[day][m] || [];
    return cell(entries.join(' / '), colWidth[i]);
  });
  rows.push(`| ${timeStr} | ${cells.join(' | ')} |`);
}

console.log([header, divider, ...rows].join('\n'));
