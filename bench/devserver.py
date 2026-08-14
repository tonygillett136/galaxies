"""Dev server with caching disabled.

Chrome caches ES modules aggressively. An edited module silently not reloading
costs a confusing debugging round every time it happens, and it already cost one:
an added export appeared absent because the browser served the cached file.
"""
import http.server, socketserver, sys, os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), NoCacheHandler) as s:
    print(f'serving {os.getcwd()} on {port} with no-store', flush=True)
    s.serve_forever()
