"""Static server for the app + a tiny in-memory 'cloud' used by the mock Firebase in tests."""
import http.server, json, sys, urllib.parse
ROOT = sys.argv[1]; PORT = int(sys.argv[2])
DB = {}
def merge(a, b):
    o = dict(a or {})
    for k, v in b.items():
        o[k] = merge(o.get(k), v) if isinstance(v, dict) and isinstance(o.get(k), dict) else v
    return o
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def _json(self, obj):
        b = json.dumps(obj).encode(); self.send_response(200)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _q(self): return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__mock/get': return self._json(DB.get(self._q()['doc'][0]))
        if u.path == '/__mock/list':
            col = self._q()['col'][0] + '/'
            return self._json(sorted([[p, d] for p, d in DB.items() if p.startswith(col) and '/' not in p[len(col):]]))
        return super().do_GET()
    def do_POST(self):
        u = urllib.parse.urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        d = self._q()['doc'][0]
        if u.path == '/__mock/set': DB[d] = merge(DB.get(d), body); return self._json({'ok': True})
        if u.path == '/__mock/put': DB[d] = body; return self._json({'ok': True})
        self.send_response(404); self.end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
