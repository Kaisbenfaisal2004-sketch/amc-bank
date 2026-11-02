"""Combine several import files (from make_import.py) into one bundle the app imports in one go.
    python3 make_bundle.py OUT.json A-import.json B-import.json ...
"""
import json, sys, os
out, files = sys.argv[1], sys.argv[2:]
books = [json.load(open(f)) for f in files]
assert all(b.get('type') == 'kais-library-book' for b in books)
json.dump({'type': 'kais-library-bundle', 'books': books}, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(out, len(books), 'books', round(os.path.getsize(out) / 1e6, 1), 'MB')
