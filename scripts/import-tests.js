#!/usr/bin/env node
// Import the static test definitions (public/assets/referee-tool/tests/*.json, indexed
// by index.json) into a competition's Firestore `tests` subcollection. Use this to push
// corrected score sheets to a LIVE competition — the scoresheet reads the Firestore test
// doc first and only falls back to the static JSON if it's absent, so editing the JSON
// alone does NOT update a competition whose tests were already imported.
//
// Against the EMULATOR (no credentials needed):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node import-tests.js <competitionId>
//
// Against PRODUCTION (requires scripts/service-account.json):
//   node import-tests.js <competitionId>
//
// Optionally pass specific test ids to import only those (default: all in index.json):
//   node import-tests.js rc2027 hri_challenge doing_laundry

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const compId = process.argv[2];
if (!compId) {
  console.error('Usage: node import-tests.js <competitionId> [testId ...]');
  process.exit(1);
}
const onlyIds = process.argv.slice(3);

const TESTS_DIR = join(__dirname, '..', 'public', 'assets', 'referee-tool', 'tests');

if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: 'robocup-home' });
  console.log(`Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
} else {
  const saPath = join(__dirname, 'service-account.json');
  if (!existsSync(saPath)) {
    console.error('Missing scripts/service-account.json (required for production).');
    console.error('Download a service-account key: Firebase Console → Project Settings → Service Accounts,');
    console.error('or run against the emulator with FIRESTORE_EMULATOR_HOST=localhost:8080.');
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
  console.log('Using PRODUCTION Firestore (service-account.json)');
}

const db = admin.firestore();

async function main() {
  const index = JSON.parse(readFileSync(join(TESTS_DIR, 'index.json'), 'utf8'));
  const ids = (onlyIds.length ? index.filter(t => onlyIds.includes(t.id)) : index).map(t => t.id);
  if (!ids.length) { console.error('No matching tests in index.json.'); process.exit(1); }

  for (const id of ids) {
    const def = JSON.parse(readFileSync(join(TESTS_DIR, `${id}.json`), 'utf8'));
    await db.doc(`competitions/${compId}/tests/${id}`).set(def);
    console.log(`  ✓ ${id}`);
  }
  console.log(`\nImported ${ids.length} test(s) into competitions/${compId}/tests`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
