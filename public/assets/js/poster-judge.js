import { db, ensureAuth } from './firebase-public.js';
import {
  doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const params   = new URLSearchParams(window.location.search);
const compId   = params.get('comp');
const slotId   = params.get('slot');
const myTeamId = params.get('team');

let myTeamName  = '';
let allTeams    = [];
let myScores    = {};
let pendingSave = false;
let saveTimeout = null;

async function init() {
  await ensureAuth();

  if (!compId || !slotId || !myTeamId) {
    return showError('Invalid link — missing comp, slot, or team parameter.');
  }

  const [compSnap, slotSnap] = await Promise.all([
    getDoc(doc(db, 'competitions', compId)),
    getDoc(doc(db, 'competitions', compId, 'slots', slotId)),
  ]);

  if (!compSnap.exists()) return showError('Competition not found.');
  if (!slotSnap.exists() || slotSnap.data().type !== 'poster')
    return showError('Poster session not found.');

  const comp   = compSnap.data();
  allTeams     = comp.participatingTeams || [];
  const myTeam = allTeams.find(t => t.teamId === myTeamId);
  if (!myTeam) return showError('Your team was not found in this competition.');

  myTeamName = myTeam.teamName;
  document.getElementById('pj-event-name').textContent = comp.name || '';
  document.getElementById('pj-team-name').textContent  = myTeamName;

  // Listen to own scores document; skip remote updates while a local save is pending
  // to avoid overwriting scores the user just entered.
  onSnapshot(
    doc(db, 'competitions', compId, 'slots', slotId, 'posterScores', myTeamId),
    snap => {
      if (!pendingSave) {
        myScores = snap.exists() ? (snap.data().scores || {}) : {};
        renderTeams();
      }
    }
  );

  document.getElementById('pj-loading').hidden = true;
  document.getElementById('pj-page').hidden    = false;
}

function renderTeams() {
  const otherTeams = allTeams.filter(t => t.teamId !== myTeamId);
  const container  = document.getElementById('pj-teams');
  container.innerHTML = '';

  for (const team of otherTeams) {
    const score = myScores[team.teamId];
    const card  = document.createElement('div');
    card.className = 'pj-team-card';
    card.innerHTML = `
      <div class="pj-card-name">${team.teamName}</div>
      <div class="pj-score-btns" role="group" aria-label="Score for ${team.teamName}">
        ${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
          <button class="pj-score-btn${score === n ? ' selected' : ''}"
                  data-score="${n}" aria-pressed="${score === n}">${n}</button>
        `).join('')}
      </div>
    `;
    card.querySelectorAll('.pj-score-btn').forEach(btn => {
      btn.addEventListener('click', () => onScore(team.teamId, Number(btn.dataset.score)));
    });
    container.appendChild(card);
  }
}

function onScore(presenterTeamId, score) {
  myScores = { ...myScores, [presenterTeamId]: score };
  renderTeams();
  queueSave();
}

function queueSave() {
  pendingSave = true;
  clearTimeout(saveTimeout);
  setStatus('Saving…', 'saving');
  saveTimeout = setTimeout(async () => {
    const snapshot = { ...myScores };
    try {
      await setDoc(
        doc(db, 'competitions', compId, 'slots', slotId, 'posterScores', myTeamId),
        { judgeTeamId: myTeamId, judgeTeamName: myTeamName, scores: snapshot }
      );
      setStatus('Saved ✓', 'saved');
    } catch {
      setStatus('Save failed — check your connection', 'error');
    } finally {
      pendingSave = false;
    }
  }, 500);
}

function setStatus(text, cls) {
  const el = document.getElementById('pj-status');
  el.textContent = text;
  el.className   = `pj-status ${cls}`;
}

function showError(msg) {
  document.getElementById('pj-loading').hidden = true;
  const el = document.getElementById('pj-error');
  el.textContent = msg;
  el.hidden      = false;
}

init();
