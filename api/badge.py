"""
Vercel serverless function: GET /badge/:owner/:repo -> Dynamic SVG Badge.
"""
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from plumber.core.fetcher import parse_repo_slug, scan_github_repo, FetchError
from plumber.core.badges import generate_badge_svg


def get_badge_response(query: dict):
    """Answers /badge/:owner/:repo with (status, headers, body)."""
    repo_param = query.get("repo", "")

    try:
        owner, repo = parse_repo_slug(repo_param)
        report = scan_github_repo(owner, repo)
        body = generate_badge_svg(
            "plumber",
            f"grade {report.grade} · {report.score:g}",
            report.grade
        ).encode("utf-8")
        status = 200
    except FetchError as err:
        body = generate_badge_svg(
            "plumber",
            "not found" if err.status == 404 else "unavailable",
            "F"
        ).encode("utf-8")
        status = 200
    except Exception:
        body = generate_badge_svg("plumber", "error", "F").encode("utf-8")
        status = 200

    headers = {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff"
    }
    return status, headers, body


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        status, headers, body = get_badge_response(query)
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
