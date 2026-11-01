"""Build the PWA data + css. Usage: build_app.py bank.json rationales.json APPDIR chapters(0|all)"""
import json, sys, os, hashlib
bank_p, rat_p, app, which = sys.argv[1:5]
bank = json.load(open(bank_p)); rat = json.load(open(rat_p))
titles = []
for r in rat:
    if r['chapter'] not in titles: titles.append(r['chapter'])
live = set(range(len(titles))) if which == 'all' else {int(x) for x in which.split(',')}
images = json.load(open('images.json')) if os.path.exists('images.json') else {}
chapters = [dict(title=t, count=sum(1 for r in rat if r['chapter'] == t)) for t in titles]
assets = []
for q, r in zip(bank, rat):
    assert q['chapter'] == r['chapter'] and q['n'] == r['q']
    c = q['chapter_index']
    if c not in live: continue
    item = dict(id=r['id'], n=q['n'], stem=q['stem'], options=q['options'], answer=q['answer'],
                rule=r['rule'], source=r['source'], quote=r['evidence_quote'], url=r['evidence_url'],
                recall=r['recall_count'], caution=r['caution'])
    key = '%d-%d' % (c, q['n'])
    if key in images: item['image'] = images[key]; assets.append(images[key])
    chapters[c].setdefault('questions', []).append(item)
data = dict(id='womens-health', title="Women's Health", order=1, pilot=which != 'all', chapters=chapters)
raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
data['version'] = hashlib.sha1(raw.encode()).hexdigest()[:10]
os.makedirs('out', exist_ok=True)
out_name = 'out/Womens_Health_App_Import.json'
open(out_name, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
print('import file', out_name)
fonts = '''@font-face{font-family:"Atkinson Hyperlegible";font-weight:400;font-style:normal;font-display:swap;src:url(fonts/atkinson-hyperlegible-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Atkinson Hyperlegible";font-weight:700;font-style:normal;font-display:swap;src:url(fonts/atkinson-hyperlegible-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"Atkinson Hyperlegible";font-weight:400;font-style:italic;font-display:swap;src:url(fonts/atkinson-hyperlegible-latin-400-italic.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-weight:500;font-style:normal;font-display:swap;src:url(fonts/ibm-plex-mono-latin-500-normal.woff2) format("woff2")}
'''
css = fonts + open('src/base.css').read() + open('src/extra.css').read()
open(app + '/app.css', 'w').write(css)
print('live', sorted(live), 'questions', sum(len(c.get('questions', [])) for c in chapters), 'KB', len(raw.encode()) // 1024, 'version', data['version'])
