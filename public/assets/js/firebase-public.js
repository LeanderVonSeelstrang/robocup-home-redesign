// Lightweight Firebase module for public-facing pages (competition, history, team).
// Uses in-memory cache instead of IndexedDB so there is no multi-tab lock acquisition
// on cold start — the main cause of minute-long initial loads on the competition page.
// Trade-off: data is not persisted across page reloads, but a clean network fetch for
// a few hundred documents is always faster than waiting for a stale IndexedDB lock.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  initializeFirestore,
  memoryLocalCache,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDGeFlm93CEj4ZZBckdSY41t1lq4gw2Sss",
  authDomain: "robocup-home.firebaseapp.com",
  projectId: "robocup-home",
  storageBucket: "robocup-home.firebasestorage.app",
  messagingSenderId: "581379577493",
  appId: "1:581379577493:web:4ab4f7b5ba8fb5ea17ad9c"
};

const app = initializeApp(firebaseConfig, 'public');

const USE_EMULATOR =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  ...(USE_EMULATOR ? { experimentalForceLongPolling: true } : {})
});

export const auth = getAuth(app);

if (USE_EMULATOR) {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export async function ensureAuth() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}
