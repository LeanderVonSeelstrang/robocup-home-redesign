#!/usr/bin/env node
// Seed the LOCAL Firebase emulator with demo data + referee/admin auth users.
//
// Usage:
//   1. Start the emulator in another terminal:  npm run emulator   (from repo root)
//   2. Run this script:                         npm run seed       (from repo root)
//
// The Admin SDK bypasses firestore.rules, so it can write teams/competitions even
// though those collections are admin-only. It connects to the emulator purely via
// the *_EMULATOR_HOST env vars below — no service-account key, and it can NEVER reach
// production (no credentials are ever loaded).

import admin from 'firebase-admin';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── EMULATOR TARGET ─────────────────────────────────────────────────────────
process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

admin.initializeApp({ projectId: 'robocup-home' });
const db   = admin.firestore();
const auth = admin.auth();

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

const AUTH_USERS = [
  { email: 'referee@local', password: 'referee123' },
  { email: 'admin@local',   password: 'admin123'   },
];

// ── HELPERS ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function deleteCollection(ref) {
  const snap = await ref.get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

// ── SEED STEPS ──────────────────────────────────────────────────────────────
async function seedTeams() {
  const teams = TEAM_NAMES.map((name, i) => ({ id: String(100 + i), name }));
  const batch = db.batch();
  for (const t of teams) {
    batch.set(db.collection('teams').doc(t.id), {
      id: t.id, name: t.name,
      institution: '', country: '', city: '', lat: null, lng: null,
      website: '', tdp: '', video: '', contact: '', altNames: [], parentTeams: [],
    });
  }
  await batch.commit();
  console.log(`  ✓ ${teams.length} teams`);
  return teams;
}

async function seedCompetition() {
  await db.collection('competitions').doc(COMP_ID).set({
    id: COMP_ID, name: COMP_NAME, year: 2027,
    city: 'TBD', country: 'TBD',
    timezone: 'Asia/Tokyo', adminCreated: true, active: true,
  });
  console.log(`  ✓ competition ${COMP_NAME} (${COMP_ID})`);
}

async function seedTests() {
  const index = JSON.parse(readFileSync(join(TESTS_DIR, 'index.json'), 'utf8'));
  for (const { id } of index) {
    const def = JSON.parse(readFileSync(join(TESTS_DIR, `${id}.json`), 'utf8'));
    await db.collection('competitions').doc(COMP_ID).collection('tests').doc(id).set(def);
  }
  console.log(`  ✓ ${index.length} test definitions`);
}

async function seedSlots(teams) {
  await deleteCollection(db.collection('competitions').doc(COMP_ID).collection('slots'));
  const slotsRef = db.collection('competitions').doc(COMP_ID).collection('slots');
  let count = 0;
  for (const day of SCHEDULE) {
    const shuffled    = shuffle(teams);
    const arenaTeams  = ARENAS.map((_, i) => shuffled.slice(i * 9, (i + 1) * 9));
    for (const slotDef of day.slots) {
      for (let a = 0; a < ARENAS.length; a++) {
        const slotTeams = arenaTeams[a].map((t, i) => ({ teamId: t.id, teamName: t.name, order: i + 1 }));
        await slotsRef.add({
          testId: slotDef.testId, date: day.date, time: slotDef.time,
          arena: ARENAS[a], league: 'OPL', teams: slotTeams, status: 'pending',
        });
        count++;
      }
    }
  }
  console.log(`  ✓ ${count} slots`);
}

async function seedAuthUsers() {
  for (const { email, password } of AUTH_USERS) {
    try {
      await auth.createUser({ email, password });
      console.log(`  ✓ auth user ${email} / ${password}`);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        console.log(`  • auth user ${email} already exists`);
      } else {
        throw err;
      }
    }
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding emulator at firestore=${process.env.FIRESTORE_EMULATOR_HOST} auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST}\n`);
  const teams = await seedTeams();
  await seedCompetition();
  await seedTests();
  await seedSlots(teams);
  await seedAuthUsers();
  console.log('\nDone. Sign in with referee@local / referee123.');
}

main().catch(err => {
  if (err.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(err.message || '')) {
    console.error('\n✗ Could not reach the emulator. Start it first:  npm run emulator');
  } else {
    console.error('\n✗ Seed failed:', err);
  }
  process.exit(1);
});
