#!/usr/bin/env node
// Grant or revoke the `admin` custom claim on a user account.
// The `admin` claim is what firestore.rules isAdmin() checks — without it a
// user can only write runs/inspections (referee), not teams/competitions.
//
// Against the EMULATOR (no credentials needed):
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 node set-admin-claim.js <email>
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 node set-admin-claim.js <email> --revoke
//
// Against PRODUCTION (requires scripts/service-account.json):
//   node set-admin-claim.js <email>
//   node set-admin-claim.js <email> --revoke
//
// The user must sign out / back in (or refresh their ID token) for the change
// to take effect, since custom claims are baked into the ID token at sign-in.

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const email  = process.argv[2];
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('Usage: node set-admin-claim.js <email> [--revoke]');
  process.exit(1);
}

const usingEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (usingEmulator) {
  admin.initializeApp({ projectId: 'robocup-home' });
} else {
  const saPath = join(__dirname, 'service-account.json');
  if (!existsSync(saPath)) {
    console.error('Missing scripts/service-account.json (required for production).');
    console.error('Either point at the emulator (FIREBASE_AUTH_EMULATOR_HOST=localhost:9099)');
    console.error('or download a service-account key: Firebase Console → Project Settings → Service Accounts.');
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
}

const target = usingEmulator ? 'EMULATOR' : 'PRODUCTION';

async function main() {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, revoke ? {} : { admin: true });
  console.log(`[${target}] ${revoke ? 'revoked admin from' : 'granted admin to'} ${email} (uid ${user.uid}).`);
  console.log('The user must sign out and back in for the new token to take effect.');
}

main().catch(err => {
  if (err.code === 'auth/user-not-found') {
    console.error(`No account found for ${email} on the ${target}.`);
  } else {
    console.error('Failed:', err.message || err);
  }
  process.exit(1);
});
