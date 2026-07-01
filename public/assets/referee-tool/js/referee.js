// Referee Tool landing page: pick a competition once, then every destination
// card links to that competition (dashboard/display/queue via ?competition=,
// results via ?id=). The chosen competition is remembered in localStorage.
// Signing in with an admin account (the `admin` custom claim) reveals the
// admin navigation; referees and anonymous visitors never see it.
import { db, ensureAuth, ensureRefereeAuth, signOut, auth, onAuthStateChanged } from './firebase.js';
import { collection, doc, getDocs, getDocsFromCache, setDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const base       = window.__siteBase || '';
const LS_KEY     = 'referee.lastCompetition';
const DEFAULT_FINAL_SECS = 20;
const selectEl   = document.getElementById('comp-select');
const gridEl     = document.getElementById('ref-landing-grid');
const cards      = [...document.querySelectorAll('.ref-landing-grid .ref-landing-card[data-page]')];

const statusEl   = document.getElementById('ref-auth-status');
const signinBtn  = document.getElementById('ref-signin-btn');
const signoutBtn = document.getElementById('ref-signout-btn');
const adminEl    = document.getElementById('ref-admin-section');

const finalSecsEl   = document.getElementById('final-secs');
const finalStatusEl = document.getElementById('final-secs-status');

const DEFAULT_OCCUPANCY = 100;
const occupancyEl       = document.getElementById('stream-occupancy');
const occupancyStatusEl = document.getElementById('stream-occupancy-status');

const DEFAULT_PILL_OPACITY = 72;
const pillOpacityEl        = document.getElementById('stream-pill-opacity');
const pillOpacityStatusEl  = document.getElementById('stream-pill-opacity-status');

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

// Show the selected competition's configured stream overlay size (defaults to 100%).
function showStreamOccupancy(compId) {
  const occ = compsById[compId]?.streamOccupancy;
  occupancyEl.value = Number.isFinite(occ) ? occ : DEFAULT_OCCUPANCY;
}

async function saveStreamOccupancy() {
  if (!isAdminUser) return;
  const compId = selectEl.value;
  if (!compId) return;

  let occ = parseFloat(occupancyEl.value);
  if (!Number.isFinite(occ)) occ = DEFAULT_OCCUPANCY;
  occ = Math.min(100, Math.max(30, occ));
  occupancyEl.value = occ;                  // reflect the clamped value

  occupancyStatusEl.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'competitions', compId), { streamOccupancy: occ }, { merge: true });
    if (compsById[compId]) compsById[compId].streamOccupancy = occ;
    occupancyStatusEl.textContent = 'Saved ✓';
    setTimeout(() => {
      if (occupancyStatusEl.textContent === 'Saved ✓') occupancyStatusEl.textContent = '';
    }, 2000);
  } catch (err) {
    console.error(err);
    occupancyStatusEl.textContent = 'Save failed';
  }
}

occupancyEl.addEventListener('change', saveStreamOccupancy);

// Show the selected competition's info-pill opacity (defaults to 72%).
function showStreamPillOpacity(compId) {
  const op = compsById[compId]?.streamPillOpacity;
  pillOpacityEl.value = Number.isFinite(op) ? op : DEFAULT_PILL_OPACITY;
}

async function saveStreamPillOpacity() {
  if (!isAdminUser) return;
  const compId = selectEl.value;
  if (!compId) return;

  let op = parseFloat(pillOpacityEl.value);
  if (!Number.isFinite(op)) op = DEFAULT_PILL_OPACITY;
  op = Math.min(100, Math.max(30, op));
  pillOpacityEl.value = op;                  // reflect the clamped value

  pillOpacityStatusEl.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'competitions', compId), { streamPillOpacity: op }, { merge: true });
    if (compsById[compId]) compsById[compId].streamPillOpacity = op;
    pillOpacityStatusEl.textContent = 'Saved ✓';
    setTimeout(() => {
      if (pillOpacityStatusEl.textContent === 'Saved ✓') pillOpacityStatusEl.textContent = '';
    }, 2000);
  } catch (err) {
    console.error(err);
    pillOpacityStatusEl.textContent = 'Save failed';
  }
}

pillOpacityEl.addEventListener('change', saveStreamPillOpacity);

signinBtn.addEventListener('click', () => {
  // ensureRefereeAuth drives the #referee-login-overlay; onAuthStateChanged updates the UI.
  ensureRefereeAuth().catch(() => { /* cancelled / no overlay */ });
});

signoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  await ensureAuth();   // back to an anonymous session so the competition list stays readable
});

// ── COMPETITION PICKER ──────────────────────────────────────────────────────

// Populate the dropdown from a raw list of competition docs. Called twice by
// loadCompetitions (cache paint, then server refresh); idempotent.
function buildPicker(comps) {
  comps = comps
    .filter(c => c.name)
    .sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;   // active first
      return (b.year || 0) - (a.year || 0);                      // newest first
    });

  compsById = Object.fromEntries(comps.map(c => [c.id, c]));
  gridEl.removeAttribute('aria-busy');

  if (!comps.length) {
    selectEl.innerHTML = '<option>No competitions found</option>';
    applyCompetition(null);
    return;
  }

  selectEl.innerHTML = '';
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
  applyCompetition(initial);
  showFinalSecs(initial);
  showStreamOccupancy(initial);
  showStreamPillOpacity(initial);
}

async function loadCompetitions() {
  // Attach the change handler once, before any paint.
  selectEl.addEventListener('change', () => {
    applyCompetition(selectEl.value);
    showFinalSecs(selectEl.value);
    showStreamOccupancy(selectEl.value);
    showStreamPillOpacity(selectEl.value);
  });

  const compsRef = collection(db, 'competitions');

  // Paint instantly from the IndexedDB cache if we have it (from a prior visit, or from
  // another page that already fetched competitions), then refresh from the server. On a
  // cold cache this just falls through to the server read.
  try {
    const cached = await getDocsFromCache(compsRef);
    if (!cached.empty) buildPicker(cached.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (_) { /* no cache yet */ }

  const fresh = await getDocs(compsRef);
  buildPicker(fresh.docs.map(d => ({ id: d.id, ...d.data() })));
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
