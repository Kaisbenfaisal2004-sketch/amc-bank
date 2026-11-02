// Firebase layer for the reading app. Same project and account as the question bank app.
// Private content lives in Firestore only (never in these public site files):
//   library/{bookId}                 → { title, author, series, level, words, order, version, blurb, cover, chapters:[{n,title,words}], gloss }
//   library/{bookId}/parts/{NN}      → { index, n, title, words, blocks:[...] }
//   library/{bookId}/images/{name}   → { data: "data:image/jpeg;base64,..." }
//   users/{uid}/reading/state        → { v, goal, goalAt, days:{date:secs}, books:{id:{...}}, prefs }
// Firestore keeps a copy on the device (persistent cache), so books and progress work offline.
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
  const stateRef = uid => fb.doc(db, 'users', uid, 'reading', 'state');
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  const denied = e => e && /permission-denied|unauthenticated/.test(e.code || '');
  // server first when online (with a time limit), device copy otherwise
  async function readDocs(ref, preferCache) {
    if (!auth.currentUser) throw Object.assign(new Error('signed out'), { code: 'unauthenticated' });
    if (preferCache || !navigator.onLine) {
      try { const s = await fb.getDocsFromCache(ref); if (!s.empty || !navigator.onLine) return s; } catch (e) { if (!navigator.onLine) throw e; }
    }
    try { return await Promise.race([fb.getDocs(ref), timeout(15000)]); }
    catch (e) { if (denied(e)) throw e; return fb.getDocsFromCache(ref); }
  }

  return {
    onUser(cb) { return fb.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
    signIn: (e, p) => fb.signInWithEmailAndPassword(auth, e, p),
    resetPassword: e => fb.sendPasswordResetEmail(auth, e),
    signOut() { if (unsub) { unsub(); unsub = null; } return fb.signOut(auth); },

    async listBooks() {
      const s = await readDocs(fb.collection(db, 'library'), false);
      return s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.added || '').localeCompare(String(b.added || '')));
    },
    async loadParts(meta, preferCache) {
      const s = await readDocs(fb.collection(db, 'library', meta.id, 'parts'), preferCache);
      const parts = s.docs.map(d => d.data()).sort((a, b) => a.index - b.index);
      if (parts.length !== meta.chapters.length) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
      return parts;
    },
    async loadImages(meta, preferCache) {
      const out = {};
      if (!meta.images || !meta.images.length) return out;
      const s = await readDocs(fb.collection(db, 'library', meta.id, 'images'), preferCache);
      s.docs.forEach(d => { out[d.id] = d.data().data; });
      return out;
    },
    // one book = header + one document per chapter + one per picture; written in a few batches
    async importBook(b, onStep) {
      const id = b.id;
      const batch1 = fb.writeBatch(db);
      b.parts.forEach((p, i) => batch1.set(fb.doc(db, 'library', id, 'parts', String(i).padStart(2, '0')), p));
      onStep && onStep('النص');
      await Promise.race([batch1.commit(), timeout(90000)]);
      const names = Object.keys(b.images || {});
      for (let i = 0; i < names.length; i += 4) {
        const bt = fb.writeBatch(db);
        names.slice(i, i + 4).forEach(n => bt.set(fb.doc(db, 'library', id, 'images', n), { data: b.images[n] }));
        onStep && onStep('الصور ' + Math.min(names.length, i + 4) + '/' + names.length);
        await Promise.race([bt.commit(), timeout(90000)]);
      }
      // the header goes last, so a half-finished import never shows up as a book
      await Promise.race([fb.setDoc(fb.doc(db, 'library', id), b.meta), timeout(60000)]);
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
