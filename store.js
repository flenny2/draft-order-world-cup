// =============================================================================
// store.js — THE FIREBASE BOUNDARY (the only file that knows Firebase).
// =============================================================================
// Realtime Database + Email/Password auth via the modular CDN SDK (no build step).
// Exposes the SAME interface the localStorage mock did, so app.js / engine.js are
// untouched:
//   getState() · subscribe(cb) · isAdmin() · onAuthChanged(cb) · signIn · signOut
//   setAssignment · setMatch · loadDemo · resetAll
// Plus onWriteStatus(cb) — pending/error state of admin writes, for the admin UI.
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
const BACKUP_PATH = 'backup'; // one-slot safety copy of whatever each write replaces

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
    // "2026 so far" texts for the sticker cards, keyed by teamId. Lives in the
    // DB (not the repo) so a summary edit goes live like a score does — no
    // deploy. RTDB drops the node entirely when it's empty; default it back.
    summaries: s?.summaries ?? {},
  };
}

// --- in-memory mirror + pub/sub (same shape as the old mock) ---------------
let state = clone(seed); // shown until the first server snapshot arrives / is seeded
const dataListeners = new Set();
const authListeners = new Set();
const emitData = () => { for (const cb of dataListeners) cb(state); };
const emitAuth = () => { for (const cb of authListeners) cb(isAdmin()); };

// Write status for the admin UI. `pending` counts writes awaiting server ack —
// while OFFLINE the RTDB queues writes and the promise stays unsettled, so
// pending never drops: a lingering "Saving…" is itself the offline signal.
// `error` is the last failed/blocked write's message, cleared by the next success.
let writeStatus = { pending: 0, error: null };
const writeListeners = new Set();
const emitWrite = () => { for (const cb of writeListeners) cb(writeStatus); };

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

export function onWriteStatus(cb) {
  writeListeners.add(cb);
  cb(writeStatus);
  return () => writeListeners.delete(cb);
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
// Failures don't reject to the caller — they're reported via onWriteStatus (the
// admin UI's one error surface), and a DENIED write is rolled back by the SDK,
// whose onValue echo then restores the true state in the mirror.
function write(next) {
  const prev = clone(state); // what this write replaces — see backup below
  const withStamp = { ...next, meta: { ...next.meta, lastUpdated: new Date().toISOString() } };
  state = normalize(withStamp);
  emitData();
  writeStatus = { pending: writeStatus.pending + 1, error: null };
  emitWrite();
  // Best-effort one-slot backup of the replaced state. Makes an accidental
  // Reset / demo-load recoverable from the Firebase console (copy
  // /backup/state back over /state). Failures ignored: if this can't land,
  // the main write below fails too and surfaces via onWriteStatus.
  set(ref(db, BACKUP_PATH), { savedAt: withStamp.meta.lastUpdated, state: prev }).catch(() => {});
  return set(ref(db, STATE_PATH), clone(withStamp))
    .then(() => { writeStatus = { pending: writeStatus.pending - 1, error: null }; emitWrite(); })
    .catch((e) => { writeStatus = { pending: writeStatus.pending - 1, error: friendlyWriteError(e) }; emitWrite(); });
}

// The sync guards (not admin / first snapshot not in yet) throw synchronously —
// route them into the same status channel so every write failure surfaces the
// same way. The blocked change is simply dropped; the admin redoes it.
function guardedWrite(build) {
  try { requireAdmin(); } catch (e) {
    writeStatus = { ...writeStatus, error: e.message };
    emitWrite();
    return Promise.resolve();
  }
  return write(build());
}

export function setAssignment(memberId, { teamId, tiebreakNumber }) {
  return guardedWrite(() => {
    const members = state.members.map((m) =>
      m.id === memberId ? { ...m, teamId: teamId || null, tiebreakNumber: tiebreakNumber ?? null } : m);
    return { ...state, members };
  });
}

export function setMatch(matchId, patch) {
  return guardedWrite(() => {
    let matches = state.matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m));
    matches = resolveBracket(matches, bracketTopology); // auto-feed winners downstream
    return { ...state, matches };
  });
}

// Sticker-card summary for one team. Rides the same whole-/state admin write
// as everything else, so no security-rules change is needed. Empty text
// deletes the entry (the card simply omits its "2026 so far" section).
export function setSummary(teamId, text) {
  return guardedWrite(() => {
    const summaries = { ...state.summaries };
    if (text) summaries[teamId] = text; else delete summaries[teamId];
    return { ...state, summaries };
  });
}

export function loadDemo() { return guardedWrite(() => clone(demoState)); }
export function resetAll() { return guardedWrite(() => clone(seed)); }

// Human message for a failed database write (shown in the admin save toast).
function friendlyWriteError(e) {
  const msg = e?.message || String(e);
  if (/permission[ _-]?denied/i.test(msg)) return 'the database rejected it — are you signed in as the admin account?';
  return msg;
}

// Map Firebase auth error codes to human messages for the sign-in form.
function friendlyAuthError(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Wrong email or password.';
  if (c.includes('too-many-requests')) return 'Too many attempts — wait a minute and try again.';
  if (c.includes('network')) return 'Network error — check your connection.';
  return e?.message || 'Sign-in failed.';
}
