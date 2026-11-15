"""Report XSS escaping and dangling-symlink scan behavior."""
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from plumber.core.engine import PlumberEngine
from plumber.core.html_report import content_security_policy, escape_json_for_script, render_html_report

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "xss-breakout.js"
PAYLOAD = "</script><script>alert(1)</script>"
NONCE = "0123456789abcdef0123456789abcdef"


class TestReportXss(unittest.TestCase):
    def setUp(self):
        self.engine = PlumberEngine()

    def test_scanned_fixture_is_escaped_in_the_report_page(self):
        content = FIXTURE.read_text(encoding="utf-8")
        self.assertIn(PAYLOAD, content)

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "xss-breakout.js"
            shutil.copyfile(FIXTURE, target)
            report = self.engine.scan_directory(Path(tmp), repo_name="xss", owner="fixture")

        page = render_html_report(report, NONCE)
        self.assertNotIn(PAYLOAD, page)
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertIn(r"\u003c/script\u003e\u003cscript\u003ealert(1)\u003c/script\u003e", page)
        self.assertEqual(page.lower().count("</script>"), 2)
        self.assertIn(f'<script nonce="{NONCE}">', page)
        self.assertNotIn("sky_bg", page)
        self.assertNotIn("night_sky", page)

        match = re.search(
            r'<script id="data" type="application/json">(.*?)</script>',
            page,
            re.S,
        )
        self.assertIsNotNone(match)
        self.assertNotIn("<", match.group(1))
        self.assertNotIn(">", match.group(1))
        self.assertNotIn("&", match.group(1))
        data = json.loads(match.group(1))
        evidence = "\n".join(
            issue.get("evidence", "")
            for file_report in data["files"]
            for issue in file_report["issues"]
        )
        self.assertIn(PAYLOAD, evidence)

        script_src = next(
            part for part in content_security_policy(NONCE).split(";")
            if "script-src" in part
        )
        self.assertIn(f"'nonce-{NONCE}'", script_src)
        self.assertNotIn("unsafe-inline", script_src)

    def test_json_script_escape_covers_markup_and_line_separators(self):
        encoded = escape_json_for_script({"note": "a<b>c&d\u2028e\u2029f"})
        self.assertNotIn("<", encoded)
        self.assertNotIn(">", encoded)
        self.assertNotIn("&", encoded)
        self.assertNotIn("\u2028", encoded)
        self.assertNotIn("\u2029", encoded)
        self.assertEqual(json.loads(encoded)["note"], "a<b>c&d\u2028e\u2029f")


class TestDanglingSymlink(unittest.TestCase):
    def test_scan_directory_skips_dangling_symlink(self):
        engine = PlumberEngine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ok.js").write_text("const value = 1;\n", encoding="utf-8")
            link = root / "README.md"
            try:
                os.symlink(root / "missing-target.md", link)
            except OSError as exc:
                self.fail(f"could not create dangling symlink fixture: {exc}")
            report = engine.scan_directory(root, repo_name="symlink-fixture")
        self.assertGreaterEqual(report.total_lines, 1)
