"""Turn a converted novel (book.json + its pictures) into one import file for the reading app.

    python3 make_import.py BOOK_DIR OUT.json [--order N] [--blurb "..."]

BOOK_DIR holds book.json (chapters, glossary) + cover.jpg + the pictures named in the chapters.
The import file carries everything; the app writes it to the owner's private Firestore (library/...).
Nothing from a book is ever stored in this public repository.
"""
import base64, hashlib, io, json, sys, os, argparse
from PIL import Image

def data_url(path, width, q):
    im = Image.open(path).convert('RGB')
    if im.width > width: im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('out')
ap.add_argument('--order', type=int, default=0); ap.add_argument('--blurb', default=''); ap.add_argument('--added', default='')
a = ap.parse_args()
book = json.load(open(os.path.join(a.dir, 'book.json')))
parts, names = [], []
for i, c in enumerate(book['chapters']):
    for x in c['blocks']:
        if x['k'] == 'img': names.append(x['src'])
    parts.append({'index': i, 'n': c['n'], 'title': c['title'], 'words': c['words'], 'blocks': c['blocks']})
images = {n: data_url(os.path.join(a.dir, n), 1000, 78) for n in names}
for n, d in images.items():
    assert len(d) < 900_000, (n, len(d))          # Firestore document limit is 1 MiB
version = hashlib.sha256(json.dumps([parts, book['gloss']], sort_keys=True).encode() + ''.join(images.values()).encode()).hexdigest()[:12]
meta = {'title': book['title'], 'author': book['author'], 'series': book.get('series', ''), 'level': book.get('level', ''),
        'words': book['words'], 'order': a.order, 'added': a.added, 'version': version, 'blurb': a.blurb,
        'cover': data_url(os.path.join(a.dir, 'cover.jpg'), 360, 80),
        'chapters': [{'n': p['n'], 'title': p['title'], 'words': p['words']} for p in parts],
        'gloss': book['gloss'], 'images': names}
out = {'type': 'kais-library-book', 'id': book['id'], 'meta': meta, 'parts': parts, 'images': images}
json.dump(out, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(a.out, round(os.path.getsize(a.out) / 1e6, 2), 'MB', len(parts), 'chapters', len(images), 'pictures', 'version', version)
