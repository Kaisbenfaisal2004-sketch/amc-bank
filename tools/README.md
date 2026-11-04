# Build tools

The public site (repo root) contains **no questions**. Questions live in Firebase
(`banks/{id}` + `banks/{id}/chapters/{NN}`), readable only by the owner account.

## Make an import file for a subject
1. `pdftotext -layout BANK.pdf raw_layout.txt`
2. `python3 parse.py raw_layout.txt RATIONALES.json bank.json` - text taken from the PDF, never retyped.
3. `python3 verify_pdf.py BANK.pdf bank.json` - second PDF engine; every question must be verbatim and in order (missing: 0).
4. `python3 build_app.py bank.json RATIONALES.json .. all` - writes `out/<Subject>_App_Import.json` and rebuilds `../app.css`.
   (`build_app.py` currently has the subject id/title for Women's Health; change them for a new subject.)
   `images.json` and `corrections.json` are keyed by question id (from the rationales file), so re-dividing a bank into new chapters keeps every image and fix on its own question, and saved answers keep working.
5. In the app: sign in → "Add or update a subject…" → choose the import file.

## Tests
`test/test_app2.js` runs the app against a stand-in for Firebase (`mock-firebase.js` + `server.py`):
verbatim display/copy, offline use, two-device sync, owner-only import.

## Firebase bundle
`npm ci --ignore-scripts` (pinned in package.json + package-lock.json), then
`./node_modules/.bin/esbuild fb-entry.js --bundle --format=esm --minify --target=es2019 --outfile=../vendor/firebase.js`
Expected sha256 of vendor/firebase.js (firebase 13.1.0, esbuild 0.28.2): `5131532e99cb4ca3ff91354ef7f9efa6d7868676435de4e37b0704350aecaffb`

## Keep content out of this repo
Subject files (PDF text, bank.json, rationales, images, import files) live OUTSIDE this folder.
`.gitignore` blocks *.json/*.csv/*.txt/*.pdf and a pre-commit hook refuses content-like files; neither replaces keeping them elsewhere.

## Firestore rules
See `firestore.rules` (paste into Firebase console → Firestore → Rules).
