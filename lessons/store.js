// Firebase layer for the lessons app (الشروح). Same project and account as the question bank app and the reading app.
// Private content lives in Firestore only (never in these public site files):
//   lessons/{lessonId}               → { title, subject, order, version, added, parts, images:[names], sections }
//   lessons/{lessonId}/parts/{NN}    → { index, html }          (the lesson page, split into pieces under Firestore's size limit)
//   lessons/{lessonId}/images/{name} → { data: "data:image/...;base64,..." }
//   users/{uid}/lessons/state        → { v, items: { lessonId: { done:{sectionId:true}, total, last, pos } } }
// Firestore keeps a copy on the device (persistent cache), so lessons and progress work offline.
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
  const stateRef = uid => fb.doc(db, 'users', uid, 'lessons', 'state');
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

  return {
    onUser(cb) { return fb.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
    signIn: (e, p) => fb.signInWithEmailAndPassword(auth, e, p),
    resetPassword: e => fb.sendPasswordResetEmail(auth, e),
    signOut() { if (unsub) { unsub(); unsub = null; } return fb.signOut(auth); },

    async listLessons() {
      const s = await readDocs(fb.collection(db, 'lessons'), false);
      return s.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    async loadParts(meta, preferCache) {
      const s = await readDocs(fb.collection(db, 'lessons', meta.id, 'parts'), preferCache);
      const parts = s.docs.map(d => d.data()).sort((a, b) => a.index - b.index);
      if (parts.length !== meta.parts) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
      return parts.map(p => p.html).join('');
    },
    async loadImages(meta, preferCache) {
      const out = {};
      if (!meta.images || !meta.images.length) return out;
      const s = await readDocs(fb.collection(db, 'lessons', meta.id, 'images'), preferCache);
      s.docs.forEach(d => { out[d.id] = d.data().data; });
      if (meta.images.some(n => !out[n])) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });
      return out;
    },
    // one lesson = pieces of the page + one document per picture; the header goes last,
    // so a half-finished import never shows up as a lesson
    async importLesson(L, onStep) {
      const id = L.id;
      for (let i = 0; i < L.parts.length; i++) {
        const bt = fb.writeBatch(db);
        bt.set(fb.doc(db, 'lessons', id, 'parts', String(i).padStart(2, '0')), { index: i, html: L.parts[i] });
        onStep && onStep('النص ' + (i + 1) + '/' + L.parts.length);
        await Promise.race([bt.commit(), timeout(120000)]);
      }
      const names = Object.keys(L.images || {});
      let i = 0;
      while (i < names.length) {
        // keep each batch well under Firestore's 10 MB request limit
        const bt = fb.writeBatch(db); let size = 0, n = 0;
        while (i < names.length && (n === 0 || size + L.images[names[i]].length < 6e6)) {
          bt.set(fb.doc(db, 'lessons', id, 'images', names[i]), { data: L.images[names[i]] });
          size += L.images[names[i]].length; n++; i++;
        }
        onStep && onStep('الصور ' + i + '/' + names.length);
        await Promise.race([bt.commit(), timeout(120000)]);
      }
      await Promise.race([fb.setDoc(fb.doc(db, 'lessons', id), L.meta), timeout(60000)]);
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
