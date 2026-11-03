# Lessons app (lessons/) tools

The lessons app («شروح قيس») lives in `/lessons/` beside the question bank app and the reading app: same Firebase
project and account, its own icon, offline copy (`lessons/sw.js`, scope `/amc-bank/lessons/`).
No lesson text or pictures are ever stored in this public repository — they live in Firestore under `lessons/...`.

## Add a lesson
1. Make the lesson as one self-contained HTML page (pictures, short videos (MP4/H.264) and sounds (AAC) inside it as `data:` URLs; each section ends with
   `<label class="done"><input data-sec="sN" type="checkbox">` so the app can save which sections are finished).
2. `python3 make_import.py LESSON.html "Title - import.json" --subject Obstetrics --title "Part 2 …" --order 2`
   (splits the page into pieces under Firestore's 1 MiB limit, one document per picture; a video or sound over ~0.9 MB
   is split into numbered pieces that the app joins back; then it checks the rebuild).
3. In the app: sign in → «إضافة شرح أو تحديثه» → choose the import file. Re-importing the same id updates the lesson.

## Firestore rules
`../firestore.rules` covers all three apps (`users/{uid}/lessons/state` and `lessons/**` were added for this app).
