import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyDGeFlm93CEj4ZZBckdSY41t1lq4gw2Sss',
  authDomain: 'robocup-home.firebaseapp.com',
  projectId: 'robocup-home',
  storageBucket: 'robocup-home.firebasestorage.app',
  messagingSenderId: '581379577493',
  appId: '1:581379577493:web:4ab4f7b5ba8fb5ea17ad9c',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const auth = getAuth(app);

// ── EMULATOR (localhost only) ── KEEP IN SYNC with public/assets/referee-tool/js/firebase.js ──
// localhost → local emulator, deployed → real DB. Decided automatically by hostname so
// production builds (johaq.github.io) are never affected. Also guarded against the static
// build step (no `window`), since this module runs at build time via teams.astro / LiveBanner.astro.
if (typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export async function ensureAuth() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}
