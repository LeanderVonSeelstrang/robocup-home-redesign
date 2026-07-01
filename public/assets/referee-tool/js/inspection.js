import { db, ensureRefereeAuth } from './firebase.js';
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const p             = new URLSearchParams(window.location.search);
const competitionId = p.get('competition');
const teamId        = p.get('team');
const teamName      = p.get('teamName') || 'Unknown Team';
const slotId        = p.get('slot');
// Teams may bring 1 or 2 robots. Robot 1 is the original per-team inspection
// (doc id = teamId, backward-compatible); robot 2 lives in a separate doc.
const robot         = p.get('robot') === '2' ? 2 : 1;
const inspDocId     = robot === 2 ? `${teamId}_2` : teamId;
const runDocId      = robot === 2 ? `${slotId}_${teamId}_2` : `${slotId}_${teamId}`;

const UNLOCK_DELAY_MS = 5000; // matches the scoresheet's reopen delay

// Doc refs are created inside init() to avoid module-level crash on missing params

// ── STATE ─────────────────────────────────────────────────────────────────────

const checks = { collisionAvoidance: false, loudnessOfVoice: false, appearanceCheck: false };
const texts  = { externalDevices: '', startButton: '', customContainers: '', emergencyButton: '', notes: '' };
let result   = null; // 'pass' | 'fail' | null
let saveTimer = null;
let submitted = false;
let inspRef   = null;
let runRef    = null;
let unlockTimeout = null;

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  await ensureRefereeAuth();

  if (!competitionId || !teamId) {
    document.getElementById('loading').textContent = 'Missing competition or team parameter.';
    return;
  }

  inspRef = doc(db, 'competitions', competitionId, 'inspections', inspDocId);
  runRef  = slotId ? doc(db, 'competitions', competitionId, 'runs', runDocId) : null;

  document.getElementById('insp-team-name').textContent = teamName;
  if (robot === 2) document.getElementById('insp-subtitle').textContent = 'Robot Inspection · Robot 2';

  // Robot switcher: probe whether a second robot's inspection exists to decide
  // between the "Robot 2" tab and the "+ Add robot" affordance.
  let hasRobot2 = robot === 2;
  if (robot === 1) {
    try {
      const r2 = await getDoc(doc(db, 'competitions', competitionId, 'inspections', `${teamId}_2`));
      hasRobot2 = r2.exists();
    } catch { /* ignore — default to no second robot */ }
  }
  renderRobotSwitch(hasRobot2);

  if (p.get('back')) {
    document.getElementById('back-link').href = p.get('back');
  }

  // Build prev/next nav if we have a slot context
  if (slotId) {
    const slotSnap = await getDoc(doc(db, 'competitions', competitionId, 'slots', slotId));
    if (slotSnap.exists()) {
      const slotTeams = slotSnap.data().teams || [];
      const idx = slotTeams.findIndex(t => String(t.teamId) === String(teamId));
      const prev = slotTeams[idx - 1];
      const next = slotTeams[idx + 1];

      const makeNavUrl = t => {
        const np = new URLSearchParams(p);
        np.set('team', t.teamId);
        np.set('teamName', t.teamName);
        return `${window.__siteBase || ''}/inspection?${np}`;
      };

      const navEl = document.getElementById('insp-nav');
      if (navEl) {
        if (prev) { const a = document.createElement('a'); a.className = 'sheet-nav-link'; a.href = makeNavUrl(prev); a.textContent = '← Prev'; navEl.appendChild(a); }
        const pos = document.createElement('span'); pos.className = 'sheet-nav-link'; pos.style.cursor = 'default'; pos.textContent = `${idx + 1} / ${slotTeams.length}`; navEl.appendChild(pos);
        if (next) { const a = document.createElement('a'); a.className = 'sheet-nav-link'; a.href = makeNavUrl(next); a.textContent = 'Next →'; navEl.appendChild(a); }
      }
    }
  }

  // Load existing data
  const snap = await getDoc(inspRef);
  if (snap.exists()) {
    const d = snap.data();
    Object.assign(checks, {
      collisionAvoidance: !!d.collisionAvoidance,
      loudnessOfVoice:    !!d.loudnessOfVoice,
      appearanceCheck:    !!d.appearanceCheck,
    });
    Object.assign(texts, {
      externalDevices:  d.externalDevices  || '',
      startButton:      d.startButton      || '',
      customContainers: d.customContainers || '',
      emergencyButton:  d.emergencyButton  || '',
      notes:            d.notes            || '',
    });
    result    = d.result || null;
    submitted = d.submitted || false;
  }

  renderAll();
  wireOneTimeButtons();

  if (submitted) lockForm();

  document.getElementById('loading').hidden = true;
  document.getElementById('app').hidden     = false;
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function renderAll() {
  // Checkboxes
  document.querySelectorAll('.insp-check-item').forEach(el => {
    const field = el.dataset.field;
    el.classList.toggle('checked', !!checks[field]);
    el.onclick = () => {
      if (submitted) return;
      checks[field] = !checks[field];
      el.classList.toggle('checked', checks[field]);
      updateSubmitBtn();
      scheduleSave();
    };
  });

  // Text fields
  for (const [key, val] of Object.entries(texts)) {
    const el = document.getElementById(`field-${key}`);
    if (el) {
      el.value = val;
      el.oninput = () => {
        texts[key] = el.value;
        scheduleSave();
      };
    }
  }

  // Result buttons (re-assigned each render; safe because onclick replaces)
  renderResult();
  document.getElementById('btn-pass').onclick   = () => setResult('pass');
  document.getElementById('btn-fail').onclick   = () => setResult('fail');
  document.getElementById('submit-btn').onclick = submitInspection;

  updateSubmitBtn();
}

function wireOneTimeButtons() {
  document.getElementById('reset-btn').onclick = () => {
    document.getElementById('reset-confirm').hidden = false;
  };
  document.getElementById('reset-confirm-cancel').onclick = () => {
    document.getElementById('reset-confirm').hidden = true;
  };
  document.getElementById('reset-confirm-ok').onclick = async () => {
    document.getElementById('reset-confirm').hidden = true;
    await resetInspection();
  };
}

function renderResult() {
  document.getElementById('btn-pass').classList.toggle('active', result === 'pass');
  document.getElementById('btn-fail').classList.toggle('active', result === 'fail');
}

function setResult(r) {
  if (submitted) return;
  result = result === r ? null : r; // toggle off if same
  renderResult();
  updateSubmitBtn();
  scheduleSave();
}

function updateSubmitBtn() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = submitted || result === null;
}

// ── ROBOT SWITCHER ──────────────────────────────────────────────────────────────

function buildRobotUrl(n) {
  const np = new URLSearchParams(p);
  if (n === 1) np.delete('robot'); else np.set('robot', String(n));
  return `${window.__siteBase || ''}/inspection?${np}`;
}

function renderRobotSwitch(hasRobot2) {
  const el = document.getElementById('insp-robot-switch');
  if (!el) return;
  el.innerHTML = '';

  const tab = (label, n, active, extraClass = '') => {
    const node = document.createElement(active ? 'span' : 'a');
    node.className = 'insp-robot-tab' + (active ? ' active' : '') + (extraClass ? ` ${extraClass}` : '');
    node.textContent = label;
    if (!active) node.href = buildRobotUrl(n);
    return node;
  };

  el.appendChild(tab('Robot 1', 1, robot === 1));
  if (hasRobot2) {
    el.appendChild(tab('Robot 2', 2, robot === 2));
  } else {
    el.appendChild(tab('+ Add robot', 2, false, 'add'));
  }
}

// ── SAVE ──────────────────────────────────────────────────────────────────────

function scheduleSave() {
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await save('draft');
    saveTimer = null;
  }, 1200);
}

async function save(status) {
  if (!inspRef) return;
  try {
    const payload = {
      teamId, teamName, competitionId, slotId, robot,
      ...checks,
      ...Object.fromEntries(Object.entries(texts).filter(([k]) => k !== 'notes')),
      notes: texts.notes,
      result,
      submitted: status === 'submitted',
      updatedAt: serverTimestamp(),
      ...(status === 'submitted' ? { submittedAt: serverTimestamp() } : {})
    };
    await setDoc(inspRef, payload, { merge: true });
    if (runRef) {
      await setDoc(runRef, { status, teamId, teamName, slotId, updatedAt: serverTimestamp() }, { merge: true });
    }
    setSaveStatus(status === 'submitted' ? '' : 'Saved');
    if (status !== 'submitted') setTimeout(() => setSaveStatus(''), 2000);
  } catch (err) {
    setSaveStatus('Save failed');
    console.error(err);
  }
}

async function submitInspection() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  clearTimeout(saveTimer);
  await save('submitted');
  submitted = true;
  lockForm();
}

function lockForm() {
  const btn = document.getElementById('submit-btn');
  btn.textContent = result === 'pass' ? 'Passed ✓' : 'Failed ✗';
  btn.disabled = true;
  btn.onclick = null;
  btn.classList.add('submitted-btn');
  btn.classList.remove('unlock-btn');
  document.querySelectorAll('.insp-check-item').forEach(el => el.classList.add('locked'));
  document.querySelectorAll('.insp-textarea').forEach(el => el.disabled = true);
  document.getElementById('btn-pass').disabled = true;
  document.getElementById('btn-fail').disabled = true;
  setSaveStatus('Inspection submitted.');

  // After a short delay, offer a reopen affordance (mirrors the scoresheet).
  if (unlockTimeout) clearTimeout(unlockTimeout);
  unlockTimeout = setTimeout(() => {
    btn.textContent = '🔓 Unlock';
    btn.disabled = false;
    btn.classList.remove('submitted-btn');
    btn.classList.add('unlock-btn');
    btn.onclick = () => {
      if (window.confirm('Reopen this inspection for editing?')) unlockForm();
    };
  }, UNLOCK_DELAY_MS);
}

async function unlockForm() {
  submitted = false;
  if (unlockTimeout) { clearTimeout(unlockTimeout); unlockTimeout = null; }

  const btn = document.getElementById('submit-btn');
  btn.classList.remove('submitted-btn', 'unlock-btn');
  btn.textContent = 'Submit Inspection';
  btn.onclick = submitInspection;
  document.querySelectorAll('.insp-check-item').forEach(el => el.classList.remove('locked'));
  document.querySelectorAll('.insp-textarea').forEach(el => { el.disabled = false; });
  document.getElementById('btn-pass').disabled = false;
  document.getElementById('btn-fail').disabled = false;
  updateSubmitBtn();
  setSaveStatus('Inspection reopened.');
  setTimeout(() => setSaveStatus(''), 2000);

  // Persist the reopen so it survives reload.
  try {
    await setDoc(inspRef, { submitted: false, updatedAt: serverTimestamp() }, { merge: true });
    if (runRef) await setDoc(runRef, { status: 'draft', updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    setSaveStatus('Reopen failed to save');
    console.error(err);
  }
}

async function resetInspection() {
  // Clear local state
  Object.assign(checks, { collisionAvoidance: false, loudnessOfVoice: false, appearanceCheck: false });
  Object.assign(texts,  { externalDevices: '', startButton: '', customContainers: '', emergencyButton: '', notes: '' });
  result    = null;
  submitted = false;
  if (unlockTimeout) { clearTimeout(unlockTimeout); unlockTimeout = null; }

  // Re-enable and re-render the whole form
  document.querySelectorAll('.insp-check-item').forEach(el => el.classList.remove('locked'));
  document.querySelectorAll('.insp-textarea').forEach(el => { el.disabled = false; el.value = ''; });
  document.getElementById('btn-pass').disabled = false;
  document.getElementById('btn-fail').disabled = false;
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.classList.remove('submitted-btn', 'unlock-btn');
  submitBtn.textContent = 'Submit Inspection';
  submitBtn.onclick = submitInspection;
  renderAll();
  setSaveStatus('Reset.');
  setTimeout(() => setSaveStatus(''), 2000);
  try {
    if (inspRef) await deleteDoc(inspRef);
    if (runRef)  await deleteDoc(runRef);
  } catch (err) { console.error('Failed to delete inspection:', err); }
}

function setSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

// ── GO ────────────────────────────────────────────────────────────────────────

init().catch(err => {
  document.getElementById('loading').textContent = `Error: ${err.message}`;
  console.error(err);
});
