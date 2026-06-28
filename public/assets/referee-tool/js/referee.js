// Referee Tool landing page: pick a competition once, then every destination
// card links to that competition (dashboard/display/queue via ?competition=,
// results via ?id=). The chosen competition is remembered in localStorage.
// Signing in with an admin account (the `admin` custom claim) reveals the
// admin navigation; referees and anonymous visitors never see it.
import { db, ensureAuth, ensureRefereeAuth, signOut, auth, onAuthStateChanged } from './firebase.js';
import { collection, doc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const base       = window.__siteBase || '';
const LS_KEY     = 'referee.lastCompetition';
const DEFAULT_FINAL_SECS = 10;
const selectEl   = document.getElementById('comp-select');
const gridEl     = document.getElementById('ref-landing-grid');
const cards      = [...document.querySelectorAll('.ref-landing-grid .ref-landing-card[data-page]')];

const statusEl   = document.getElementById('ref-auth-status');
const signinBtn  = document.getElementById('ref-signin-btn');
const signoutBtn = document.getElementById('ref-signout-btn');
const adminEl    = document.getElementById('ref-admin-section');

const finalSecsEl   = document.getElementById('final-secs');
const finalStatusEl = document.getElementById('final-secs-status');

// Competition data by id (kept so the final-result field can show each comp's value).
let compsById   = {};
let isAdminUser = false;

function applyCompetition(compId) {
  if (compId) localStorage.setItem(LS_KEY, compId);
  for (const card of cards) {
    const { page, param } = card.dataset;
    if (compId) {
      card.href = `${base}/${page}?${param}=${encodeURIComponent(compId)}`;
      card.classList.remove('is-disabled');
      card.removeAttribute('aria-disabled');
    } else {
      card.removeAttribute('href');
      card.classList.add('is-disabled');
      card.setAttribute('aria-disabled', 'true');
    }
  }
}

// ── AUTH / ADMIN GATING ─────────────────────────────────────────────────────
async function updateAuthUI(user) {
  const isEmailUser = !!user?.email;
  let isAdmin = false;
  if (isEmailUser) {
    try { isAdmin = (await user.getIdTokenResult()).claims.admin === true; } catch { /* ignore */ }
  }
  statusEl.textContent   = isEmailUser ? `Signed in as ${user.email}` : 'Not signed in';
  signinBtn.hidden       = isEmailUser;
  signoutBtn.hidden      = !isEmailUser;
  adminEl.hidden         = !isAdmin;

  // The final-result duration lives in the admin section (only shown to admins),
  // and the competition doc is admin-only write.
  isAdminUser = isAdmin;
}

// Show the selected competition's configured duration (defaults to 10s).
function showFinalSecs(compId) {
  const secs = compsById[compId]?.finalResultSecs;
  finalSecsEl.value = Number.isFinite(secs) ? secs : DEFAULT_FINAL_SECS;
}

async function saveFinalSecs() {
  if (!isAdminUser) return;
  const compId = selectEl.value;
  if (!compId) return;

  let secs = parseFloat(finalSecsEl.value);
  if (!Number.isFinite(secs)) secs = DEFAULT_FINAL_SECS;
  secs = Math.min(120, Math.max(0, secs));
  finalSecsEl.value = secs;                 // reflect the clamped value

  finalStatusEl.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'competitions', compId), { finalResultSecs: secs }, { merge: true });
    if (compsById[compId]) compsById[compId].finalResultSecs = secs;
    finalStatusEl.textContent = 'Saved ✓';
    setTimeout(() => {
      if (finalStatusEl.textContent === 'Saved ✓') finalStatusEl.textContent = '';
    }, 2000);
  } catch (err) {
    console.error(err);
    finalStatusEl.textContent = 'Save failed';
  }
}

finalSecsEl.addEventListener('change', saveFinalSecs);

signinBtn.addEventListener('click', () => {
  // ensureRefereeAuth drives the #referee-login-overlay; onAuthStateChanged updates the UI.
  ensureRefereeAuth().catch(() => { /* cancelled / no overlay */ });
});

signoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  await ensureAuth();   // back to an anonymous session so the competition list stays readable
});

// ── COMPETITION PICKER ──────────────────────────────────────────────────────
async function loadCompetitions() {
  const snap  = await getDocs(collection(db, 'competitions'));
  const comps = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.name)
    .sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;   // active first
      return (b.year || 0) - (a.year || 0);                      // newest first
    });

  compsById = Object.fromEntries(comps.map(c => [c.id, c]));

  selectEl.innerHTML = '';

  if (!comps.length) {
    selectEl.innerHTML = '<option>No competitions found</option>';
    gridEl.removeAttribute('aria-busy');
    applyCompetition(null);
    return;
  }

  for (const c of comps) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.year ? `${c.name} (${c.year})` : c.name;
    selectEl.appendChild(opt);
  }

  const remembered = localStorage.getItem(LS_KEY);
  const initial    = comps.some(c => c.id === remembered) ? remembered : comps[0].id;
  selectEl.value    = initial;
  selectEl.disabled = false;
  gridEl.removeAttribute('aria-busy');
  applyCompetition(initial);
  showFinalSecs(initial);

  selectEl.addEventListener('change', () => {
    applyCompetition(selectEl.value);
    showFinalSecs(selectEl.value);
  });
}

async function init() {
  // React to any auth change (persisted admin session, sign-in, sign-out).
  onAuthStateChanged(auth, updateAuthUI);
  await ensureAuth();          // anonymous session is enough to read the public competition list
  await loadCompetitions();
}

init().catch(err => {
  console.error(err);
  selectEl.innerHTML = '<option>Failed to load competitions</option>';
  gridEl.removeAttribute('aria-busy');
});
