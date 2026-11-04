"""Build the PWA data + css. Usage: build_app.py bank.json rationales.json APPDIR chapters(0|all)"""
import json, sys, os, hashlib
bank_p, rat_p, app, which = sys.argv[1:5]
bank = json.load(open(bank_p)); rat = json.load(open(rat_p))
titles = []
for r in rat:
    if r['chapter'] not in titles: titles.append(r['chapter'])
live = set(range(len(titles))) if which == 'all' else {int(x) for x in which.split(',')}
images = json.load(open('images.json')) if os.path.exists('images.json') else {}
# explicit text corrections approved by Kais (each must match the PDF text exactly before it is applied)
corrections = json.load(open('corrections.json')) if os.path.exists('corrections.json') else []
for fx in corrections:
    # keyed by question id (survives re-dividing chapters); old ch/n entries still accepted
    if 'id' in fx: hit = [q for q, r in zip(bank, rat) if r['id'] == fx['id']]
    else: hit = [q for q in bank if q['chapter_index'] == fx['ch'] - 1 and q['n'] == fx['n']]
    assert len(hit) == 1, fx
    q = hit[0]
    if fx['field'] == 'stem':
        assert q['stem'] == fx['from'], fx; q['stem'] = fx['to']
    else:
        assert q['options'][fx['field']] == fx['from'], fx; q['options'][fx['field']] = fx['to']
        if q['answer'] == fx['field']: q['answer_text'] = fx['to']
print('corrections applied:', len(corrections))
assert all(len(set(r['id'] for r in rat)) == len(rat) for _ in [0]), 'duplicate question ids'
chapters = [dict(title=t, count=sum(1 for r in rat if r['chapter'] == t)) for t in titles]
assets = []
for q, r in zip(bank, rat):
    assert q['chapter'] == r['chapter'] and q['n'] == r['q']
    c = q['chapter_index']
    if c not in live: continue
    item = dict(id=r['id'], n=q['n'], stem=q['stem'], options=q['options'], answer=q['answer'],
                rule=r['rule'], source=r['source'], quote=r['evidence_quote'], url=r['evidence_url'],
                recall=r['recall_count'], caution=r['caution'])
    key = r['id'] if r['id'] in images else '%d-%d' % (c, q['n'])  # image keyed by question id (or old ch-n)
    if key in images: item['image'] = images[key]; assets.append(images[key])
    chapters[c].setdefault('questions', []).append(item)
data = dict(id='womens-health', title="Women's Health", order=1, pilot=which != 'all', chapters=chapters)
raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
data['version'] = hashlib.sha1(raw.encode()).hexdigest()[:10]
os.makedirs('out', exist_ok=True)
out_name = 'out/Womens_Health_App_Import.json'
open(out_name, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
print('import file', out_name)
css = open('src/app-b.css').read()
open(app + '/app.css', 'w').write(css)
print('live', sorted(live), 'questions', sum(len(c.get('questions', [])) for c in chapters), 'KB', len(raw.encode()) // 1024, 'version', data['version'])
