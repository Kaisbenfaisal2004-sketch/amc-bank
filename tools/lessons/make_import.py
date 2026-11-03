"""Turn one self-contained lesson page (HTML with its pictures inside as data: URLs) into an import file
for the lessons app (lessons/). The text is copied as it is, never retyped; the result is checked by rebuilding it.

python3 make_import.py LESSON.html "OUT - import.json" --subject Obstetrics --title "Part 2 Early Pregnancy & Bleeding" [--order 2] [--id obstetrics-part-2]
"""
import argparse, datetime, hashlib, json, re, sys

FS_DOC_LIMIT = 1_000_000        # Firestore: 1 MiB per document (a little room left for field names)
PART_BYTES = 700_000

ap = argparse.ArgumentParser()
ap.add_argument('html'); ap.add_argument('out')
ap.add_argument('--subject', required=True); ap.add_argument('--title', required=True)
ap.add_argument('--order', type=int, default=0); ap.add_argument('--id')
ap.add_argument('--added', default=datetime.date.today().isoformat())
a = ap.parse_args()

src = open(a.html, encoding='utf-8').read()
html = src
# web fonts from outside cannot load inside the app (and are not needed: the app supplies its own font)
html = re.sub(r'<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>\s*', '', html)
html = re.sub(r'<link href="https://fonts\.googleapis\.com/[^"]*" rel="stylesheet">\s*', '', html)

images = {}
def take(m):
    name = 'i%02d' % (len(images) + 1)
    images[name] = m.group(1)
    return 'src="lesson-img:' + name + '"'
html = re.sub(r'src="(data:image/[a-z+]+;base64,[A-Za-z0-9+/=]+)"', take, html)

big = [n for n, d in images.items() if len(d.encode()) > FS_DOC_LIMIT]
if big: sys.exit('picture too large for one Firestore document: ' + ', '.join(big))
if 'data:image' in html: sys.exit('a picture was left inside the text (unexpected format)')

# split the page into pieces by size in bytes, without cutting a character
parts, cur, size = [], [], 0
for ch in html:
    b = len(ch.encode())
    if size + b > PART_BYTES: parts.append(''.join(cur)); cur, size = [], 0
    cur.append(ch); size += b
if cur: parts.append(''.join(cur))

# check: rebuilding gives back exactly the original page (apart from the removed font links)
rebuilt = re.sub(r'lesson-img:(i\d\d)', lambda m: images[m.group(1)], ''.join(parts))
expect = re.sub(r'<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>\s*', '', src)
expect = re.sub(r'<link href="https://fonts\.googleapis\.com/[^"]*" rel="stylesheet">\s*', '', expect)
assert rebuilt == expect, 'rebuild check failed'

lid = a.id or re.sub(r'[^a-z0-9]+', '-', (a.subject + '-' + a.title).lower()).strip('-')[:60]
sections = len(re.findall(r'<label class="done"><input[^>]*data-sec=', html))
meta = {'title': a.title, 'subject': a.subject, 'order': a.order, 'added': a.added,
        'version': hashlib.sha1(src.encode()).hexdigest()[:12], 'parts': len(parts),
        'images': list(images), 'sections': sections}
json.dump({'type': 'kais-lesson', 'id': lid, 'meta': meta, 'parts': parts, 'images': images},
          open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{lid}: {len(parts)} text piece(s), {len(images)} pictures, {sections} sections, '
      f'{sum(len(p.encode()) for p in parts)//1024} KB text, {sum(len(d) for d in images.values())//1024} KB pictures — rebuild check OK')
