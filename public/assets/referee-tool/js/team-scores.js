// Per-team score breakdown for a competition: every run (score sheet) the team has,
// grouped by test, with the competition total = best SUBMITTED run per test, summed.
// Running (draft) sheets are shown but don't count, and are styled differently.
// Reached from the /results standings; each sheet opens the live editable /scoresheet
// (referees/admins only) — submitted sheets load locked but can be unlocked there.
import { db, ensureAuth } from './firebase.js';
import {
  doc, collection, getDoc, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const base          = window.__siteBase || '';
const params        = new URLSearchParams(window.location.search);
const compId        = params.get('competition');
const teamId        = params.get('team');
const teamNameParam = params.get('teamName') || '';
const backUrl       = params.get('back') || `${base}/results?id=${compId}`;

let comp  = null;
let tests = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  await ensureAuth();

  if (!compId || !teamId) { showError('Missing competition or team.'); return; }

  const compSnap = await getDoc(doc(db, 'competitions', compId));
  if (!compSnap.exists()) { showError('Competition not found.'); return; }
  comp = { id: compId, ...compSnap.data() };

  const testsSnap = await getDocs(collection(db, 'competitions', compId, 'tests'));
  tests = testsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  document.getElementById('ts-back-link').href      = backUrl;
  document.getElementById('ts-comp-name').textContent = comp.name || compId;
  document.getElementById('ts-loading').hidden = true;
  document.getElementById('ts-page').hidden    = false;

  onSnapshot(collection(db, 'competitions', compId, 'runs'), snap => {
    const teamRuns = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => String(r.teamId) === String(teamId));
    render(teamRuns);
  });
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function testName(testId) {
  return tests.find(t => t.id === testId)?.name || testId || '—';
}

function scoresheetUrl(run) {
  return `${base}/scoresheet?` + new URLSearchParams({
    competition: compId,
    slot:        run.slotId || '',
    team:        teamId,
    teamName:    run.teamName || teamNameParam,
    test:        run.testId || '',
    back:        window.location.href,
  });
}

// ── RENDER ──────────────────────────────────────────────────────────────────────
function render(teamRuns) {
  const displayName = teamRuns[0]?.teamName || teamNameParam || teamId;
  document.getElementById('ts-team-name').textContent = displayName;
  document.title = `${displayName} — Team Scores`;

  // Group runs by test
  const byTest = {};
  for (const r of teamRuns) {
    const tid = r.testId || '—';
    (byTest[tid] ||= []).push(r);
  }

  // Best submitted run per test → competition total
  let total = 0;
  const bestRunId = {};   // testId → run.id that counts
  for (const [tid, list] of Object.entries(byTest)) {
    const submitted = list.filter(r => r.status === 'submitted');
    if (!submitted.length) continue;
    const best = submitted.reduce((a, b) => (b.totalScore || 0) > (a.totalScore || 0) ? b : a);
    bestRunId[tid] = best.id;
    total += best.totalScore || 0;
  }
  document.getElementById('ts-total').textContent = total;

  const body = document.getElementById('ts-body');
  const tids = Object.keys(byTest).sort((a, b) => testName(a).localeCompare(testName(b)));

  if (!tids.length) {
    body.innerHTML = '<div class="ts-empty">No score sheets for this team yet.</div>';
    return;
  }

  body.innerHTML = tids.map(tid => {
    const list = byTest[tid].slice().sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    const bestScore = bestRunId[tid] != null
      ? (list.find(r => r.id === bestRunId[tid])?.totalScore || 0)
      : null;

    const rows = list.map(run => {
      const isRunning   = run.status !== 'submitted';
      const counts      = bestRunId[tid] === run.id;
      const statusClass = isRunning ? 'status-draft' : 'status-submitted';
      const statusText  = isRunning ? 'Running' : 'Submitted';
      return `
        <a class="ts-run ${isRunning ? 'is-running' : 'is-submitted'}" href="${scoresheetUrl(run)}">
          <span class="ts-run-status ${statusClass}">${statusText}</span>
          <span class="ts-run-score">${run.totalScore ?? 0}<span class="ts-run-pts"> pts</span></span>
          ${counts ? '<span class="ts-run-counts">counts toward total</span>' : ''}
          <span class="ts-run-open">›</span>
        </a>`;
    }).join('');

    return `
      <section class="ts-test">
        <div class="ts-test-head">
          <h2 class="ts-test-name">${testName(tid)}</h2>
          <span class="ts-test-best">${bestScore != null ? `${bestScore} pts` : '—'}</span>
        </div>
        <div class="ts-runs">${rows}</div>
      </section>`;
  }).join('');
}

function showError(msg) {
  document.getElementById('ts-loading').textContent = msg;
}

init().catch(err => {
  showError(`Error: ${err.message}`);
  console.error(err);
});
