"""
Local development server for Plumber.
Mimics Vercel rewrites and serverless function execution locally on localhost:3100.
"""
import sys
import re
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.report import get_report_response
from api.badge import get_badge_response
from api.scan import get_scan_response

RE_REPORT = re.compile(r"^/r/([^/?#]+)/([^/?#]+)")
RE_BADGE = re.compile(r"^/badge/([^/?#]+)/([^/?#]+)")


class PlumberDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _serve_api(self, view_fn, query):
        status, headers, body = view_fn(query)
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        # 1. Rewrite: /r/:owner/:repo -> get_report_response
        m_rep = RE_REPORT.match(path)
        if m_rep:
            owner, repo = m_rep.group(1), m_rep.group(2)
            qs["repo"] = f"{owner}/{repo}"
            self._serve_api(get_report_response, qs)
            return

        # 2. Rewrite: /badge/:owner/:repo -> get_badge_response
        m_bdg = RE_BADGE.match(path)
        if m_bdg:
            owner, repo = m_bdg.group(1), m_bdg.group(2)
            qs["repo"] = f"{owner}/{repo}"
            self._serve_api(get_badge_response, qs)
            return

        # 3. Direct API routes
        if path.startswith("/api/report"):
            self._serve_api(get_report_response, qs)
            return
        elif path.startswith("/api/badge"):
            self._serve_api(get_badge_response, qs)
            return
        elif path.startswith("/api/scan"):
            self._serve_api(get_scan_response, qs)
            return

        # 4. Static files from public/
        if path == "/":
            self.path = "/index.html"

        return super().do_GET()

    def do_HEAD(self):
        return self.do_GET()



def run_server(port=3100):
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, PlumberDevHandler)
    print(f"\n=======================================================")
    print(f"  Plumber Dev Server running at: http://localhost:{port}")
    print(f"  Vercel rewrites: /r/:owner/:repo and /badge/:owner/:repo")
    print(f"=======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3100
    run_server(port)
