// Firebase layer. Everything private lives in Firestore (never in the public site files):
//   banks/{bankId}                  → { title, order, count, version, chapters:[{title,count}] }
//   banks/{bankId}/chapters/{NN}    → { index, title, questions:[...] }
//   users/{uid}/progress/{bankId}   → { answers: { <questionId>: { p, t } } }
// Firestore keeps a copy on the device (persistent cache), so banks and answers work offline.
import { firebaseConfig } from './config.js';

export async function createSync() {
  if (!firebaseConfig) return null;
  const fb = await import('./vendor/firebase.js');
  const app = fb.initializeApp(firebaseConfig);
  const auth = fb.getAuth(app);
  let db;
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager(), cacheSizeBytes: fb.CACHE_SIZE_UNLIMITED }) });
  } catch (e) {
    db = fb.initializeFirestore(app, {});
  }
  let unsub = null;
  const progRef = (uid, bankId) => fb.doc(db, 'users', uid, 'progress', bankId);
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
  // server first when online (with a time limit), device copy otherwise
  // A refusal from the server (wrong account / signed out) is final: never fall back to the device copy then.
  const denied = e => e && /permission-denied|unauthenticated/.test(e.code || '');
  async function readDocs(ref, preferCache) {
    if (!auth.currentUser) throw Object.assign(new Error('signed out'), { code: 'unauthenticated' });
    if (preferCache || !navigator.onLine) {
      try { const s = await fb.getDocsFromCache(ref); if (!s.empty || !navigator.onLine) return s; } catch (e) { if (!navigator.onLine) throw e; }
    }
    try { return await Promise.race([fb.getDocs(ref), timeout(12000)]); }
    catch (e) { if (denied(e)) throw e; return fb.getDocsFromCache(ref); }
  }
  return {
    onUser(cb) { return fb.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
    signIn: (e, p) => fb.signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => fb.createUserWithEmailAndPassword(auth, e, p),
    resetPassword: e => fb.sendPasswordResetEmail(auth, e),
    signOut: () => fb.signOut(auth),
    // sign out AND remove every copy this device keeps (Firestore's on-device cache included)
    async signOutAndWipe() {
      if (unsub) { unsub(); unsub = null; }
      try { await fb.signOut(auth); } catch (e) {}
      try { await fb.terminate(db); } catch (e) {}
      try { await fb.clearIndexedDbPersistence(db); } catch (e) {}
    },

    async listBanks() {
      const s = await readDocs(fb.collection(db, 'banks'), false);
      return s.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.order || 0) - (b.order || 0));
    },
    async loadBank(meta, haveVersion) {
      const s = await readDocs(fb.collection(db, 'banks', meta.id, 'chapters'), haveVersion === meta.version);
      const chapters = meta.chapters.map(c => Object.assign({}, c));
      s.docs.forEach(d => { const x = d.data(); if (chapters[x.index]) chapters[x.index].questions = x.questions; });
      return { id: meta.id, title: meta.title, version: meta.version, pilot: !!meta.pilot, chapters };
    },
    async importBank(b) {
      // one batch: subject header + one document per chapter
      const batch = fb.writeBatch(db);
      batch.set(fb.doc(db, 'banks', b.id), {
        title: b.title, order: b.order || 0, version: b.version, pilot: !!b.pilot,
        count: b.chapters.reduce((s, c) => s + c.count, 0),
        chapters: b.chapters.map(c => ({ title: c.title, count: c.count })),
      });
      b.chapters.forEach((c, i) => {
        if (c.questions) batch.set(fb.doc(db, 'banks', b.id, 'chapters', String(i).padStart(2, '0')), { index: i, title: c.title, questions: c.questions });
      });
      return Promise.race([batch.commit(), timeout(60000)]);
    },

    watch(bankId, cb) {
      if (unsub) { unsub(); unsub = null; }
      const u = auth.currentUser; if (!u) return;
      unsub = fb.onSnapshot(progRef(u.uid, bankId), { includeMetadataChanges: true }, snap => {
        const d = snap.exists() ? snap.data() : {};
        cb(d.answers || {}, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
      }, err => cb(null, { error: err && err.code }));
    },
    stop() { if (unsub) { unsub(); unsub = null; } },
    write(bankId, entries) {
      const u = auth.currentUser; if (!u) return Promise.resolve();
      return fb.setDoc(progRef(u.uid, bankId), { answers: entries }, { merge: true });
    },
  };
}
