// Firebase layer for ميزان الحجج. Same project and account as the question bank, the reading app and the lessons app.
// Private content lives in Firestore only (never in these public site files):
//   mizan/content                 → { version, j }   j = JSON text: { args, books, glossary, an:{id:version} }
//   mizan/content/analyses/a{id}  → { version, j }   j = JSON text of one argument's examination
//   users/{uid}/mizan/state       → { v, items:{id:{read,conv,note,at}}, beliefs:{…,at}, history:[…] }
// Firestore keeps a copy on the device (persistent cache), so everything works offline once it was opened online.
import { firebaseConfig } from '../config.js';

export async function createStore() {
  if (!firebaseConfig) return null;
  const fb = await import('../vendor/firebase.js');
  const app = fb.initializeApp(firebaseConfig);
  const auth = fb.getAuth(app);
  let db;
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager(), cacheSizeBytes: fb.CACHE_SIZE_UNLIMITED }) });
  } catch (e) {
    db = fb.initializeFirestore(app, {});
  }
  let unsub = null;
  const stateRef = uid => fb.doc(db, 'users', uid, 'mizan', 'state');
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  const denied = e => e && /permission-denied|unauthenticated/.test(e.code || '');
  // server first when online (with a time limit), device copy otherwise
  async function readDocs(ref, preferCache) {
    if (!auth.currentUser) throw Object.assign(new Error('signed out'), { code: 'unauthenticated' });
    if (preferCache || !navigator.onLine) {
      try { const s = await fb.getDocsFromCache(ref); if (!s.empty || !navigator.onLine) return s; } catch (e) { if (!navigator.onLine) throw e; }
    }
    try { return await Promise.race([fb.getDocs(ref), timeout(20000)]); }
    catch (e) { if (denied(e)) throw e; return fb.getDocsFromCache(ref); }
  }
  const parse = d => { try { return JSON.parse(d.j); } catch (e) { return null; } };

  return {
    onUser(cb) { return fb.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
    signIn: (e, p) => fb.signInWithEmailAndPassword(auth, e, p),
    resetPassword: e => fb.sendPasswordResetEmail(auth, e),
    signOut() { if (unsub) { unsub(); unsub = null; } return fb.signOut(auth); },

    // the map, the books and the glossary, plus every examination that the map lists
    async loadContent(preferCache) {
      const s = await readDocs(fb.collection(db, 'mizan'), preferCache);
      const d = s.docs.find(x => x.id === 'content');
      if (!d) return null;
      const head = d.data(), c = parse(head);
      if (!c) return null;
      c.version = head.version;
      c.analyses = {};
      const want = c.an || {};
      if (Object.keys(want).length) {
        const a = await readDocs(fb.collection(db, 'mizan', 'content', 'analyses'), preferCache);
        a.docs.forEach(x => { const id = x.id.replace(/^a/, ''); if (want[id]) { const v = parse(x.data()); if (v) c.analyses[id] = v; } });
      }
      return c;
    },
    // examinations first, the map last, so a half-finished upload never shows up
    async importContent(B, onStep) {
      const ids = Object.keys(B.analyses || {});
      for (let i = 0; i < ids.length; i += 50) {
        const bt = fb.writeBatch(db);
        ids.slice(i, i + 50).forEach(id => bt.set(fb.doc(db, 'mizan', 'content', 'analyses', 'a' + id), { version: B.version, j: JSON.stringify(B.analyses[id]) }));
        onStep && onStep('الفحوص ' + Math.min(i + 50, ids.length) + '/' + ids.length);
        await Promise.race([bt.commit(), timeout(120000)]);
      }
      const an = {}; ids.forEach(id => { an[id] = B.version; });
      const head = { args: B.args, books: B.books, glossary: B.glossary, an };
      onStep && onStep('الخريطة');
      const bt = fb.writeBatch(db);
      bt.set(fb.doc(db, 'mizan', 'content'), { version: B.version, j: JSON.stringify(head) });
      await Promise.race([bt.commit(), timeout(60000)]);
    },

    watchState(cb) {
      if (unsub) { unsub(); unsub = null; }
      const u = auth.currentUser; if (!u) return;
      unsub = fb.onSnapshot(stateRef(u.uid), { includeMetadataChanges: true }, snap => {
        cb(snap.exists() ? snap.data() : null, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      }, err => cb(undefined, { error: err && err.code }));
    },
    writeState(data) {
      const u = auth.currentUser; if (!u) return Promise.resolve();
      return fb.setDoc(stateRef(u.uid), data);
    },
  };
}
