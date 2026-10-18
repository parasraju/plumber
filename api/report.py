"""
Vercel serverless function: GET /r/:owner/:repo -> HTML report or export.
"""
import sys
import json
import html
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from plumber.core.fetcher import parse_repo_slug, scan_github_repo, FetchError
from plumber.core.html_report import render_html_report
from plumber.core.badges import export_markdown, export_json, export_csv

HEADERS_BASE = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY"
}


def get_report_response(query: dict):
    """Answers /r/:owner/:repo with (status, headers, body)."""
    repo_param = query.get("repo", "")
    fmt = (query.get("format") or "html").lower()

    try:
        owner, repo = parse_repo_slug(repo_param)
        report = scan_github_repo(owner, repo)

        if fmt == "html":
            body = render_html_report(report).encode("utf-8")
            content_type = "text/html; charset=utf-8"
            disp = "inline"
        elif fmt == "md":
            body = export_markdown(report).encode("utf-8")
            content_type = "text/markdown; charset=utf-8"
            disp = f'attachment; filename="plumber-{owner}-{repo}.md"'
        elif fmt == "json":
            body = export_json(report).encode("utf-8")
            content_type = "application/json; charset=utf-8"
            disp = f'attachment; filename="plumber-{owner}-{repo}.json"'
        elif fmt == "csv":
            body = export_csv(report).encode("utf-8")
            content_type = "text/csv; charset=utf-8"
            disp = f'attachment; filename="plumber-{owner}-{repo}.csv"'
        else:
            raise FetchError(400, f"Unsupported format '{fmt}'.", "Choose html, md, json, or csv.")

        headers = {
            **HEADERS_BASE,
            "Content-Type": content_type,
            "Content-Disposition": disp,
            "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
        }
        return 200, headers, body

    except FetchError as err:
        err_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Scan Failed — Plumber</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    body {{
      background: #F4F3EF;
      background-image: radial-gradient(#D6D4CD 1.2px, transparent 1.2px);
      background-size: 20px 20px;
      color: #111111;
      font-family: -apple-system, BlinkMacSystemFont, "Lucida Grande", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }}
    .dialog {{
      background: #FFFFFF;
      border: 1px solid #C9C8C3;
      border-radius: 6px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.1), 0 0 0 1px #C9C8C3;
      width: 100%;
      max-width: 440px;
      overflow: hidden;
    }}
    .titlebar {{
      height: 26px;
      background: #E8E7E2;
      border-bottom: 1px solid #D3D2CC;
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      color: #858585;
    }}
    .content {{
      padding: 24px;
    }}
    h1 {{
      font-size: 16px;
      font-weight: 700;
      color: #C83B3B;
      margin: 0 0 8px;
    }}
    p {{
      font-size: 13px;
      color: #858585;
      line-height: 1.5;
      margin: 0 0 20px;
    }}
    a.btn {{
      display: inline-block;
      text-decoration: none;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      font-weight: 600;
      background: #FFFFFF;
      border: 1px solid #C9C8C3;
      color: #111111;
      padding: 6px 14px;
      border-radius: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      transition: all 0.1s ease;
    }}
    a.btn:hover {{
      background: #F8F7F3;
      border-color: #858585;
    }}
  </style>
</head>
<body>
  <div class="dialog">
    <div class="titlebar">alert.log</div>
    <div class="content">
      <h1>{html.escape(err.message)}</h1>
      <p>{html.escape(err.hint)}</p>
      <a href="/" class="btn">Return to Plumber</a>
    </div>
  </div>
</body>
</html>""".encode("utf-8")

        headers = {
            **HEADERS_BASE,
            "Content-Type": "text/html; charset=utf-8",
            "X-Plumber-Error": json.dumps({"message": err.message, "hint": err.hint})
        }
        return err.status, headers, err_body

    except Exception as e:
        err_body = f"Server error: {str(e)}".encode("utf-8")
        headers = {**HEADERS_BASE, "Content-Type": "text/plain"}
        return 500, headers, err_body


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        status, headers, body = get_report_response(query)
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
