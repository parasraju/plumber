"""
Vercel serverless function: GET /api/scan?repo=owner/repo -> JSON Report.
"""
import sys
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from plumber.core.fetcher import parse_repo_slug, scan_github_repo, FetchError


def get_scan_response(query: dict):
    """Answers /api/scan with (status, headers, body)."""
    repo_param = query.get("repo", "")

    headers_base = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
        "X-Content-Type-Options": "nosniff"
    }

    try:
        owner, repo = parse_repo_slug(repo_param)
        report = scan_github_repo(owner, repo)
        body = json.dumps(report.to_dict()).encode("utf-8")
        return 200, headers_base, body
    except FetchError as err:
        err_data = json.dumps({"error": err.message, "hint": err.hint}).encode("utf-8")
        return err.status, headers_base, err_data
    except Exception as e:
        err_data = json.dumps({"error": str(e)}).encode("utf-8")
        return 500, headers_base, err_data


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        status, headers, body = get_scan_response(query)
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
