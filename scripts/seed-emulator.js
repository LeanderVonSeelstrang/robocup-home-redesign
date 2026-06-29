#!/usr/bin/env node
// Seed the LOCAL Firebase emulator with demo data + referee/admin auth users.
//
// Usage:
//   1. Start the emulator in another terminal:  npm run emulator   (from repo root)
//   2. Run this script:                         npm run seed       (from repo root)
//
// This talks to the emulators over plain HTTP (Node's built-in fetch) and uses
// ZERO npm dependencies — it does not need `npm install` and is immune to the
// firebase-admin install issues. The Firestore emulator grants full access (rules
// bypassed) to requests carrying `Authorization: Bearer owner`, and the Auth
// emulator exposes REST endpoints for creating users and setting custom claims.
// It only ever reaches localhost, so it can never touch production.
//
// Re-running resets to a known state: it clears the auth accounts and rc2027 slots.
//
/*
  Role       Email            Password     Role/claim
  Referee    referee@local    referee123   referee (covers Arena A & C)
  Referee    referee2@local   referee123   referee (covers Arena B)
  Admin      admin@local      admin123     admin:true claim
*/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT   = 'robocup-home';
const FS_HOST   = process.env.FIRESTORE_EMULATOR_HOST     || 'localhost:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const FS   = `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const IDT  = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const AUTH = `http://${AUTH_HOST}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, '..', 'public', 'assets', 'referee-tool', 'tests');

// ── DEMO DATA (mirrors src/pages/seed.astro) ────────────────────────────────
const COMP_ID   = 'rc2027';
const COMP_NAME = 'RoboCup 2027';

const TEAM_NAMES = [
  "NimbRo@Home", "LAR@Home", "FBOT@Home", "Hibikino-Musashi@Home",
  "SOBITS", "SKUBA", "RoboFEI@Home", "SocRob@Home", "FAMBOT",
  "PUMAS", "LASR", "rUNSWeep+", "EIC Chula", "eR@sers & Re@dy",
  "Inha United", "LisTex United", "PyLot Robotics", "RoboCanes-VISAGE",
  "RoBorregos", "TIDbots", "Tidyboy", "Tinker", "UT Austin Villa At Home",
  "WrightEagle.AI", "TJArk-OPL", "Pequi Mecânico", "Happy Robot"
];

const SCHEDULE = [
  { date: "2027-07-09", slots: [
    { testId: "hri_challenge",  time: "10:00" },
    { testId: "pick_and_place", time: "12:00" },
    { testId: "doing_laundry",  time: "14:00" },
    { testId: "gpsr",           time: "16:00" },
  ]},
  { date: "2027-07-10", slots: [
    { testId: "hri_challenge",  time: "10:00" },
    { testId: "pick_and_place", time: "13:00" },
    { testId: "doing_laundry",  time: "15:00" },
    { testId: "gpsr",           time: "17:00" },
  ]},
  { date: "2027-07-11", slots: [
    { testId: "hri_challenge",  time: "10:00" },
    { testId: "pick_and_place", time: "11:00" },
    { testId: "doing_laundry",  time: "13:00" },
    { testId: "gpsr",           time: "14:00" },
  ]},
];

const ARENAS = ["Arena A", "Arena B", "Arena C"];

// Which referee covers which arena — gives the dashboard's "filter by referee"
// something to filter on, and ties slots to the test referee accounts below.
const ARENA_REFEREE = {
  "Arena A": "referee@local",
  "Arena B": "referee2@local",
  "Arena C": "referee@local",
};

const AUTH_USERS = [
  { email: 'referee@local',  password: 'referee123', claims: null },
  { email: 'referee2@local', password: 'referee123', claims: null },
  { email: 'admin@local',    password: 'admin123',   claims: { admin: true } },
];

// ── FIRESTORE REST (Bearer owner bypasses security rules) ───────────────────
function toValue(v) {
  if (v === null || v === undefined)     return { nullValue: null };
  if (typeof v === 'boolean')            return { booleanValue: v };
  if (typeof v === 'number')             return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')             return { stringValue: v };
  if (v instanceof Date)                 return { timestampValue: v.toISOString() };
  if (Array.isArray(v))                  return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object')             return { mapValue: { fields: toFields(v) } };
  throw new Error(`unsupported value: ${v}`);
}
function toFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) fields[k] = toValue(val);
  return fields;
}

async function fsSet(path, data) {
  const res = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore write ${path} failed: ${res.status} ${await res.text()}`);
}

async function fsClearCollection(collPath) {
  const res = await fetch(`${FS}/${collPath}?pageSize=500`, { headers: { 'Authorization': 'Bearer owner' } });
  if (!res.ok) return;
  const { documents = [] } = await res.json();
  await Promise.all(documents.map(d =>
    fetch(`${FS}/${d.name.split('/documents/')[1]}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer owner' } })
  ));
}

// ── AUTH EMULATOR REST ──────────────────────────────────────────────────────
async function authWipe() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer owner' },
  });
}
async function authCreate(email, password) {
  const res = await fetch(`${IDT}/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`signUp ${email} failed: ${JSON.stringify(j)}`);
  return j.localId;
}
async function authSetClaims(localId, claims) {
  const res = await fetch(`${IDT}/accounts:update`, {
    method: 'POST', headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId, customAttributes: JSON.stringify(claims) }),
  });
  if (!res.ok) throw new Error(`set claims failed: ${res.status} ${await res.text()}`);
}

// ── HELPERS ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let demoTarget    = null;  // { slotId, team } for the Arena A HRI slot, captured during seedSlots
let day1TestSlots = [];    // [{ slotId, testId, teams }] for day 1's test slots → used to seed scored runs

// ── SEED STEPS ──────────────────────────────────────────────────────────────
async function seedTeams() {
  const teams = TEAM_NAMES.map((name, i) => ({ id: String(100 + i), name }));
  await Promise.all(teams.map(t => fsSet(`teams/${t.id}`, {
    id: t.id, name: t.name,
    institution: '', country: '', city: '', lat: null, lng: null,
    website: '', tdp: '', video: '', contact: '', altNames: [], parentTeams: [],
  })));
  console.log(`  ✓ ${teams.length} teams`);
  return teams;
}

async function seedCompetition(teams) {
  await fsSet(`competitions/${COMP_ID}`, {
    id: COMP_ID, name: COMP_NAME, year: 2027,
    city: 'TBD', country: 'TBD',
    timezone: 'Asia/Tokyo', adminCreated: true, active: true,
    arenas: ARENAS,   // the display/scoreboard reads arenas off the competition doc
    finalResultSecs: 10,   // display/streaming hold the post-submit "Final" card this long
    publicScoresheets: true,  // allow non-referees to open score sheets read-only (admin flag)
    showResultsQr: true,      // show a /results QR slide in the display rotation (admin flag)
    // the dashboard's inspection panel lists participatingTeams (not slot teams)
    participatingTeams: teams.map(t => ({ teamId: t.id, teamName: t.name })),
  });
  console.log(`  ✓ competition ${COMP_NAME} (${COMP_ID})`);
}

async function seedTests() {
  const index = JSON.parse(readFileSync(join(TESTS_DIR, 'index.json'), 'utf8'));
  for (const { id } of index) {
    const def = JSON.parse(readFileSync(join(TESTS_DIR, `${id}.json`), 'utf8'));
    await fsSet(`competitions/${COMP_ID}/tests/${id}`, def);
  }
  console.log(`  ✓ ${index.length} test definitions`);
}

async function seedSlots(teams) {
  await fsClearCollection(`competitions/${COMP_ID}/slots`);
  let n = 0;
  for (const day of SCHEDULE) {
    const shuffled   = shuffle(teams);
    const arenaTeams = ARENAS.map((_, i) => shuffled.slice(i * 9, (i + 1) * 9));
    for (const slotDef of day.slots) {
      for (let a = 0; a < ARENAS.length; a++) {
        const slotId    = `slot_${String(++n).padStart(3, '0')}`;
        const slotTeams = arenaTeams[a].map((t, i) => ({ teamId: t.id, teamName: t.name, order: i + 1 }));
        await fsSet(`competitions/${COMP_ID}/slots/${slotId}`, {
          testId: slotDef.testId, date: day.date, time: slotDef.time,
          arena: ARENAS[a], referee: ARENA_REFEREE[ARENAS[a]] || '',
          league: 'OPL', teams: slotTeams, status: 'pending',
        });
        if (day === SCHEDULE[0]) day1TestSlots.push({ slotId, testId: slotDef.testId, teams: slotTeams });
        if (!demoTarget && ARENAS[a] === 'Arena A' && slotDef.testId === 'hri_challenge' && slotTeams[0]) {
          demoTarget = { slotId, team: slotTeams[0] };
        }
      }
    }
  }

  // Inspection slots (first morning) — a `type:'inspection'` slot is what makes the
  // dashboard surface its Robot Inspection panel + schedule row.
  const inspShuffled   = shuffle(teams);
  const inspArenaTeams = ARENAS.map((_, i) => inspShuffled.slice(i * 9, (i + 1) * 9));
  for (let a = 0; a < ARENAS.length; a++) {
    const slotId    = `slot_${String(++n).padStart(3, '0')}`;
    const slotTeams = inspArenaTeams[a].map((t, i) => ({ teamId: t.id, teamName: t.name, order: i + 1 }));
    await fsSet(`competitions/${COMP_ID}/slots/${slotId}`, {
      type: 'inspection', date: SCHEDULE[0].date, time: '09:00',
      arena: ARENAS[a], referee: ARENA_REFEREE[ARENAS[a]] || '',
      league: 'OPL', teams: slotTeams, status: 'pending',
    });
  }
  console.log(`  ✓ ${n} slots (incl. ${ARENAS.length} inspection)`);
}

// A few inspection records so the dashboard panel shows varied statuses out of the box.
async function seedInspections(teams) {
  await fsClearCollection(`competitions/${COMP_ID}/inspections`);
  const sample = [
    { result: 'pass', submitted: true },
    { result: 'pass', submitted: true },
    { result: 'pass', submitted: true },
    { result: 'fail', submitted: true },
    { result: null,   submitted: false },   // in progress
  ];
  for (let i = 0; i < sample.length; i++) {
    const { id } = teams[i];
    const s = sample[i];
    await fsSet(`competitions/${COMP_ID}/inspections/${id}`, {
      collisionAvoidance: s.result !== null,
      loudnessOfVoice:    s.result !== null,
      appearanceCheck:    s.submitted,
      externalDevices: '', startButton: 'Top, center', customContainers: '', emergencyButton: 'Red, rear panel',
      notes: s.result === 'fail' ? 'Emergency stop not within easy reach.' : '',
      result: s.result, submitted: s.submitted,
      updatedAt: new Date(),
      ...(s.submitted ? { submittedAt: new Date() } : {}),
    });
  }
  console.log(`  ✓ ${sample.length} inspection records (3 passed, 1 failed, 1 in progress)`);
}

// Submitted runs for day 1's test slots, so the standings (/results) and the per-team
// breakdown (/team-scores) have real data. Every scheduled team gets one submitted run
// per day-1 test, with a plausible random score.
// Generate plausible per-item scores for a test, and the total computed exactly the
// way the scoresheet's itemPts() does — so opening a seeded run in /scoresheet shows
// the same total it shows in the standings (no 0-vs-N mismatch).
function generateScores(testDef) {
  const scores = {};
  let total = 0;
  for (const section of testDef?.sections || []) {
    for (const item of section.items || []) {
      if (item.type === 'boolean') {
        if (Math.random() < 0.55) { scores[item.id] = true; total += item.points || 0; }
      } else if (item.type === 'count') {
        const k = Math.floor(Math.random() * ((item.maxCount || 1) + 1));
        if (k > 0) {
          // Count items with per-instance sub-scores (penalties/modifiers) store an
          // array of instance objects; plain counters store a number. The scoresheet
          // does scores[id].forEach(...) on the former, so the shape must match.
          const hasSubs = (item.penalties?.length || 0) + (item.modifiers?.length || 0) > 0;
          scores[item.id] = hasSubs ? Array.from({ length: k }, () => ({})) : k;
          total += k * (item.points || 0);   // empty instances each score item.points
        }
      } else if (item.type === 'standalone_penalty') {
        if (Math.random() < 0.2) { scores[item.id] = 1; total -= item.points || 0; }
      }
      // fixed/percentage are sub-items (penalties/modifiers); info is non-scoring → skip
    }
  }
  return { scores, total };
}

function loadTestDefs() {
  const index = JSON.parse(readFileSync(join(TESTS_DIR, 'index.json'), 'utf8'));
  return {
    name: Object.fromEntries(index.map(t => [t.id, t.name])),
    def:  Object.fromEntries(index.map(t => [t.id, JSON.parse(readFileSync(join(TESTS_DIR, `${t.id}.json`), 'utf8'))])),
  };
}

async function seedScoredRuns() {
  await fsClearCollection(`competitions/${COMP_ID}/runs`);  // reset all runs
  const { name, def } = loadTestDefs();
  let count = 0;
  for (const slot of day1TestSlots) {
    await Promise.all(slot.teams.map(team => {
      const { scores, total } = generateScores(def[slot.testId]);
      count++;
      return fsSet(`competitions/${COMP_ID}/runs/${slot.slotId}_${team.teamId}`, {
        competitionId: COMP_ID, slotId: slot.slotId,
        teamId: team.teamId, teamName: team.teamName,
        testId: slot.testId, testName: name[slot.testId] || slot.testId,
        status: 'submitted', totalScore: total, scores,
        updatedAt: new Date(), submittedAt: new Date(),
      });
    }));
  }
  console.log(`  ✓ ${count} submitted runs (day 1, ${day1TestSlots.length} slots) with item-level scores`);
}

// A demo in-progress (draft) run so the live Display screen shows "Scoring Activity"
// without anyone having to score by hand. Lives in Arena A's HRI Challenge slot — it
// overwrites that team's submitted HRI run, so they show one running + the rest submitted.
async function seedDemoRun() {
  if (!demoTarget) { console.log('  • demo run skipped (no Arena A slot)'); return; }
  const { slotId, team } = demoTarget;

  const now = Date.now();
  const feedEvents = [
    { label: 'Detect the doorbell sound',          delta:  30, t: now - 90000, elapsed: 12 },
    { label: 'Open the entrance door for a guest', delta: 200, t: now - 60000, elapsed: 40 },
    { label: 'Offer a free seat to the new guest', delta: 100, t: now - 30000, elapsed: 75 },
    { label: 'Operator intervention',              delta: -50, t: now - 15000, elapsed: 95 },
  ].map((e, i) => ({ ...e, id: `seed_${i}`, writer: 'referee@local' }));

  // Real item-level scores so this running sheet opens coherently in /scoresheet too.
  const { def } = loadTestDefs();
  const { scores, total } = generateScores(def['hri_challenge']);

  const runId = `${slotId}_${team.teamId}`;
  await fsSet(`competitions/${COMP_ID}/runs/${runId}`, {
    competitionId: COMP_ID, slotId, teamId: team.teamId, teamName: team.teamName,
    testId: 'hri_challenge', testName: 'HRI Challenge',
    status: 'draft', totalScore: total, scores,
    timerState: { initialSecs: 360, startedAt: null, elapsedBeforePause: 95 },  // paused at 4:25 left
    restartTaken: false, updatedAt: new Date(),
  });

  // Scoring activity lives in the runs/{id}/feed subcollection — one doc per event
  // (keyed by its stable id), matching how /scoresheet writes it.
  for (const { id, ...rest } of feedEvents) {
    await fsSet(`competitions/${COMP_ID}/runs/${runId}/feed/${id}`, rest);
  }
  console.log(`  ✓ demo in-progress run for ${team.teamName} (Arena A) — ${feedEvents.length} feed entries, ${total} pts`);
}

async function seedAuthUsers() {
  await authWipe();  // reset to a known set
  for (const { email, password, claims } of AUTH_USERS) {
    const localId = await authCreate(email, password);
    if (claims) await authSetClaims(localId, claims);
    console.log(`  ✓ auth user ${email} / ${password} — ${claims?.admin ? 'admin (admin:true claim)' : 'referee (no claim)'}`);
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding emulator at firestore=${FS_HOST} auth=${AUTH_HOST}\n`);
  const teams = await seedTeams();
  await seedCompetition(teams);
  await seedTests();
  await seedSlots(teams);
  await seedScoredRuns();
  await seedDemoRun();
  await seedInspections(teams);
  await seedAuthUsers();
  console.log('\nDone. Sign in with referee@local / referee123.');
}

main().catch(err => {
  if (/ECONNREFUSED|fetch failed/i.test(err.message || '')) {
    console.error('\n✗ Could not reach the emulator. Start it first:  npm run emulator');
  } else {
    console.error('\n✗ Seed failed:', err.message || err);
  }
  process.exit(1);
});
