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
# IT SERVES ITS OWN REPO ROOT, NOT THE WORKING DIRECTORY.
#
# That is right for normal use — `python3 galaxy_collisions/bench/devserver.py`
# from anywhere serves the project — and it is a TRAP for browser mutation
# testing. `cd /tmp/copy-of-tree && python3 $REAL/bench/devserver.py 8801` serves
# $REAL, so the mutated copy is never sent, every mutation appears to survive,
# and the conclusion is "the guard is inert" when the guard was never tested.
#
# Round 7 lost twenty minutes to exactly that and nearly recorded a false result
# in the DEVLOG. The tell: `curl`-ing the served file appeared to CONFIRM the
# mutation, because the string being grepped for also occurs in a comment.
#
# To mutation-test the browser suite, copy the WHOLE tree (bench/ included) and
# run the copy's OWN devserver:  python3 $COPY/bench/devserver.py 8801
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), NoCacheHandler) as s:
    print(f'serving {os.getcwd()} on {port} with no-store', flush=True)
    s.serve_forever()
