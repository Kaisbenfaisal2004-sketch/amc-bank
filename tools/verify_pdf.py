"""Independent check: extract the PDF with a second engine (pdfplumber), remove all
whitespace, and confirm every question's stem + options + answer appear verbatim, in order."""
import json, re, sys, pdfplumber

pdf_path, bank_path = sys.argv[1:3]
chs = None if len(sys.argv) < 4 else {int(x) for x in sys.argv[3].split(',')}
bank = json.load(open(bank_path))
with pdfplumber.open(pdf_path) as pdf:
    full = ''.join((p.extract_text() or '') for p in pdf.pages[2:])
squash = lambda s: re.sub(r'\s+', '', s)
F = squash(full)
pos, ok, bad = 0, 0, []
for q in bank:
    seq = 'Q%d.' % q['n'] + q['stem'] + ''.join('%s)%s' % (k, q['options'][k]) for k in 'abcde') \
        + 'ANSWER:%s)%s' % (q['answer'], q['answer_text'])
    S = squash(seq)
    i = F.find(S, pos)
    if i < 0:
        bad.append((q['chapter_index'] + 1, q['n']))
    else:
        pos = i + len(S)
        ok += 1
print('verbatim-in-order:', ok, 'missing:', len(bad), bad[:20])
# whitespace sanity
sp = [(q['chapter_index'] + 1, q['n']) for q in bank
      if re.search(r'  |\s$|^\s', q['stem'] + '|'.join(q['options'].values()))]
print('odd whitespace:', sp[:20])
