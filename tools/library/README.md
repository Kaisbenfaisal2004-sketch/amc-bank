# Reading app (library/) tools

The reading app lives in `/library/` beside the question bank app: same Firebase project and account,
its own icon, offline copy (`library/sw.js`, scope `/amc-bank/library/`) and settings.
No book text or pictures are ever stored in this public repository — they live in Firestore under `library/...`.

## Add a novel
1. Convert the scanned PDF into `book.json` (chapters → blocks `{k:'p'|'d'|'img'}`, glossary words linked as
   `<b class="gl" data-g="gN">`) plus `cover.jpg` and the pictures, all in one folder.
2. `python3 make_import.py FOLDER "Title - import.json" --order N --added YYYY-MM-DD --blurb "..."`
3. In the app: sign in → «إضافة رواية أو تحديثها» → choose the import file. Re-importing the same id updates the book.

## Firestore rules
`../firestore.rules` covers both apps (`users/{uid}/reading/state` and `library/**` were added for this app).
