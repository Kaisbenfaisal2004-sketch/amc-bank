"""Parse the Women's Health bank PDF text (pdftotext -layout) into structured JSON.
No question text is typed by hand: everything comes from the PDF text layer."""
import json, re, sys

raw_path, rat_path, out_path = sys.argv[1:4]
rat = json.load(open(rat_path))
chapters = []
for r in rat:
    if r['chapter'] not in chapters:
        chapters.append(r['chapter'])

lines = open(raw_path, encoding='utf-8').read().replace('\f', '\n').split('\n')
# start after contents (first chapter heading followed by Q1)
start = next(i for i, l in enumerate(lines) if l.strip() == chapters[0] and i > 40)

qre = re.compile(r'^\s*Q(\d+)\.\s+(.*)$')
ore = re.compile(r'^\s{2,}([a-e])\)\s+(.*)$')
are = re.compile(r'^\s*ANSWER:\s+([a-e])\)\s+(.*)$')
page_re = re.compile(r'^\s*Page \d+ / \d+\s*$')

out = []
cur_ch = -1
q = None
mode = None  # 'stem' | 'opt' | 'ans'
page = 0


def flush():
    global q
    if q:
        out.append(q)
    q = None


for i in range(start, len(lines)):
    l = lines[i]
    s = l.strip()
    m = page_re.match(l)
    if m:
        page += 1
        continue
    if not s:
        continue
    if s in chapters and not l.startswith(' ') and mode in (None, 'ans'):
        flush()
        cur_ch = chapters.index(s)
        mode = None
        continue
    m = qre.match(l)
    if m and mode in (None, 'ans'):
        flush()
        q = dict(chapter_index=cur_ch, chapter=chapters[cur_ch], n=int(m.group(1)),
                 stem=[m.group(2).strip()], options={}, answer=None, answer_text=None)
        mode = 'stem'
        continue
    m = are.match(l)
    if m and q:
        q['answer'] = m.group(1)
        q['answer_text'] = [m.group(2).strip()]
        mode = 'ans'
        continue
    m = ore.match(l)
    if m and q and mode in ('stem', 'opt'):
        q['options'][m.group(1)] = [m.group(2).strip()]
        q['_last'] = m.group(1)
        mode = 'opt'
        continue
    # continuation line
    if q is None:
        print('ORPHAN line', i, repr(l)); continue
    if mode == 'stem':
        q['stem'].append(s)
    elif mode == 'opt':
        q['options'][q['_last']].append(s)
    elif mode == 'ans':
        q['answer_text'].append(s)
flush()

def join(parts):
    # Chromium wraps after an in-word hyphen/dash ("first-|trimester"): rejoin with no space.
    s = parts[0]
    for p in parts[1:]:
        if re.search(r'\S[-–—]$', s):
            s += p
        else:
            s += ' ' + p
    return s


for q in out:
    q.pop('_last', None)
    q['stem'] = join(q['stem'])
    q['options'] = {k: join(v) for k, v in q['options'].items()}
    q['answer_text'] = join(q['answer_text']) if q['answer_text'] else None

json.dump(out, open(out_path, 'w'), ensure_ascii=False, indent=1)
print('parsed', len(out))
