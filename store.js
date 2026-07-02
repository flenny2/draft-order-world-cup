// =============================================================================
// store.js — THE FIREBASE BOUNDARY (the only file that knows Firebase).
// =============================================================================
// Realtime Database + Email/Password auth via the modular CDN SDK (no build step).
// Exposes the SAME interface the localStorage mock did, so app.js / engine.js are
// untouched:
//   getState() · subscribe(cb) · isAdmin() · onAuthChanged(cb) · signIn · signOut
//   setAssignment · setMatch · loadDemo · resetAll
//
// SECURITY: firebaseConfig below is NOT a secret — safe to commit. Protection is
// the database security rule (public read; writes only from the admin UID). Reads
// are public because all data is meant to be seen; writes are gated so bots that
// find the DB can't wipe it.
// =============================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';

import { seed, bracketTopology } from './data.js';
import { resolveBracket } from './engine.js';
import { demoState } from './demo.js';

// --- Firebase init ---------------------------------------------------------
const firebaseConfig = {
  apiKey: 'AIzaSyCU231lzJjoqcUo4r8Isxw8AHT-InlieqQ',
  authDomain: 'draft-order-world-cup-26.firebaseapp.com',
  databaseURL: 'https://draft-order-world-cup-26-default-rtdb.firebaseio.com',
  projectId: 'draft-order-world-cup-26',
  storageBucket: 'draft-order-world-cup-26.firebasestorage.app',
  messagingSenderId: '170673928301',
  appId: '1:170673928301:web:15c2b5af9956d678c22764',
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const STATE_PATH = 'state'; // the whole app state lives under this one node

// --- helpers ---------------------------------------------------------------
const clone = (x) => JSON.parse(JSON.stringify(x)); // also strips `undefined` (RTDB rejects it)
// RTDB may hand arrays back as objects keyed 0,1,2…; normalize to real arrays.
const asArray = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
// RTDB drops null fields on the way out; the engine treats undefined as null
// (it checks `== null`), so we don't need to restore them.
function normalize(s) {
  return {
    teams: asArray(s?.teams),
    members: asArray(s?.members),
    matches: asArray(s?.matches),
    meta: s?.meta ?? { rulesLockedDate: null, lastUpdated: null },
  };
}

// --- in-memory mirror + pub/sub (same shape as the old mock) ---------------
let state = clone(seed); // shown until the first server snapshot arrives / is seeded
const dataListeners = new Set();
const authListeners = new Set();
const emitData = () => { for (const cb of dataListeners) cb(state); };
const emitAuth = () => { for (const cb of authListeners) cb(isAdmin()); };

// Realtime read (public). Fires immediately with the current server value, and
// again on every change — cross-DEVICE now, not just cross-tab. If the DB is
// still empty (no admin write yet), fall back to the local seed for display.
// `synced` gates all writes: until the first server snapshot lands, the mirror
// is just the local seed, and a whole-state write() then would clobber the live
// DB with it (the write path is read-modify-write of the mirror).
let synced = false;
onValue(ref(db, STATE_PATH), (snap) => {
  synced = true; // a "doesn't exist" answer is still a server answer — first-ever seeding write stays allowed
  state = snap.exists() ? normalize(snap.val()) : clone(seed);
  emitData();
}, (err) => console.error('Live read failed — check the DB read rule:', err));
onAuthStateChanged(auth, () => emitAuth());

// --- public API ------------------------------------------------------------
export function getState() { return state; }

export function subscribe(cb) {
  dataListeners.add(cb);
  cb(state); // fire immediately, like onValue
  return () => dataListeners.delete(cb);
}

// Only the admin account exists (no public sign-up), so "signed in" == admin. The
// database rule is the real enforcement; this just gates the admin UI.
export function isAdmin() { return !!auth.currentUser; }

export function onAuthChanged(cb) {
  authListeners.add(cb);
  cb(isAdmin());
  return () => authListeners.delete(cb);
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
    .then(() => {})
    .catch((e) => { throw new Error(friendlyAuthError(e)); });
}
export function signOut() { return fbSignOut(auth); }

function requireAdmin() {
  if (!isAdmin()) throw new Error('Admin only.');
  if (!synced) throw new Error('Still syncing with the live database — try again in a second.');
}

// Write the WHOLE state (single admin, ~KB payload). Optimistically update the
// local mirror for a snappy UI; the server echo confirms it moments later.
function write(next) {
  const withStamp = { ...next, meta: { ...next.meta, lastUpdated: new Date().toISOString() } };
  state = normalize(withStamp);
  emitData();
  return set(ref(db, STATE_PATH), clone(withStamp));
}

export function setAssignment(memberId, { teamId, tiebreakNumber }) {
  requireAdmin();
  const members = state.members.map((m) =>
    m.id === memberId ? { ...m, teamId: teamId || null, tiebreakNumber: tiebreakNumber ?? null } : m);
  return write({ ...state, members });
}

export function setMatch(matchId, patch) {
  requireAdmin();
  let matches = state.matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m));
  matches = resolveBracket(matches, bracketTopology); // auto-feed winners downstream
  return write({ ...state, matches });
}

export function loadDemo() { requireAdmin(); return write(clone(demoState)); }
export function resetAll() { requireAdmin(); return write(clone(seed)); }

// Map Firebase auth error codes to human messages for the sign-in form.
function friendlyAuthError(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Wrong email or password.';
  if (c.includes('too-many-requests')) return 'Too many attempts — wait a minute and try again.';
  if (c.includes('network')) return 'Network error — check your connection.';
  return e?.message || 'Sign-in failed.';
}
