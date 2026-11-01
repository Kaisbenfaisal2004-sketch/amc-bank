// Test stand-in for vendor/firebase.js: same exports the app uses, backed by /__mock on the test server.
// Like Firestore offline: reads fall back to a device cache, writes apply locally at once and queue until online.
const LS = k => JSON.parse(localStorage.getItem(k) || '{}');
const cache = LS('__mockcache');            // path -> data
const pending = LS('__mockpending');        // path -> merge-object
const save = () => { localStorage.setItem('__mockcache', JSON.stringify(cache)); localStorage.setItem('__mockpending', JSON.stringify(pending)); };
let current = null; const authCbs = []; const listeners = {};
const saved = localStorage.getItem('__mockuser'); if (saved) current = { uid: 'u-' + saved, email: saved };
const deepMerge = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object') ? deepMerge(o[k], b[k]) : b[k]; return o; };
const view = p => pending[p] ? deepMerge(cache[p] || {}, pending[p]) : cache[p];
const snapDoc = (p, fromCache) => { const d = view(p); return { id: p.split('/').pop(), exists: () => !!d, data: () => d, metadata: { fromCache, hasPendingWrites: !!pending[p] } }; };
function emit(p, fromCache) { (listeners[p] || new Set()).forEach(cb => cb(snapDoc(p, fromCache))); }
async function flush() {
  for (const p of Object.keys(pending)) {
    try {
      await fetch('/__mock/set?doc=' + encodeURIComponent(p), { method: 'POST', body: JSON.stringify(pending[p]) });
      cache[p] = deepMerge(cache[p] || {}, pending[p]); delete pending[p]; save();
    } catch (e) { return; }
  }
}
async function pull(p) {
  try { const r = await (await fetch('/__mock/get?doc=' + encodeURIComponent(p))).json(); if (r) cache[p] = r; save(); emit(p, false); }
  catch (e) { emit(p, true); }
}
setInterval(async () => { if (!navigator.onLine) return; await flush(); for (const p of Object.keys(listeners)) if (listeners[p].size) pull(p); }, 500);
const offlineErr = () => Object.assign(new Error('offline'), { code: 'unavailable' });

export const initializeApp = cfg => ({ cfg });
export const getAuth = () => ({ get currentUser() { return current; } });
export const onAuthStateChanged = (a, cb) => { authCbs.push(cb); setTimeout(() => cb(current), 0); return () => {}; };
const login = email => { current = { uid: 'u-' + email, email }; localStorage.setItem('__mockuser', email); authCbs.forEach(cb => cb(current)); return { user: current }; };
export const signInWithEmailAndPassword = async (a, e, p) => { if (p !== 'secret1') throw { code: 'auth/invalid-credential' }; return login(e); };
export const createUserWithEmailAndPassword = async (a, e) => login(e);
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => { current = null; localStorage.removeItem('__mockuser'); authCbs.forEach(cb => cb(null)); };
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const CACHE_SIZE_UNLIMITED = -1;
export const terminate = async () => {};
export const clearIndexedDbPersistence = async () => { localStorage.removeItem('__mockcache'); localStorage.removeItem('__mockpending'); for (const k in cache) delete cache[k]; };
export const doc = (db, ...parts) => parts.join('/');
export const collection = (db, ...parts) => ({ col: parts.join('/') });
const docsOf = (col, src) => { const pre = col + '/'; return Object.keys(src).filter(p => p.startsWith(pre) && !p.slice(pre.length).includes('/')).sort(); };
const qsnap = (paths, fromCache) => { const docs = paths.map(p => snapDoc(p, fromCache)).filter(d => d.exists()); return { empty: !docs.length, docs }; };
export const getDocsFromCache = async ref => qsnap(docsOf(ref.col, cache), true);
export const getDocs = async ref => {
  if (!navigator.onLine) throw offlineErr();
  if (ref.col.startsWith('banks') && (!current || current.email !== 'kais@test.com')) throw { code: 'permission-denied' };
  const list = await (await fetch('/__mock/list?col=' + encodeURIComponent(ref.col))).json();
  list.forEach(([p, d]) => { cache[p] = d; }); save();
  return qsnap(list.map(x => x[0]), false);
};
export const onSnapshot = (p, opts, cb) => { (listeners[p] = listeners[p] || new Set()).add(cb); setTimeout(() => { emit(p, true); if (navigator.onLine) pull(p); }, 0); return () => listeners[p].delete(cb); };
export const setDoc = async (p, data, opt) => { pending[p] = (opt && opt.merge) ? deepMerge(pending[p] || {}, data) : data; if (!(opt && opt.merge)) cache[p] = undefined; save(); emit(p, true); if (navigator.onLine) await flush(); };
export const writeBatch = () => { const ops = []; return { set: (p, d) => ops.push([p, d]), commit: async () => {
  if (current.email !== 'kais@test.com') throw { code: 'permission-denied' };
  for (const [p, d] of ops) { await fetch('/__mock/put?doc=' + encodeURIComponent(p), { method: 'POST', body: JSON.stringify(d) }); cache[p] = d; } save(); } }; };
