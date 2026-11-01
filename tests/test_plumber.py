"""
Unit tests for Plumber scanner and rule engine.
"""
import io
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from plumber.core.engine import PlumberEngine
from plumber.core.scoring import calculate_score, calculate_grade
from plumber.core.models import Issue, CRITICAL, HIGH, MEDIUM, LOW
from plumber.core.fetcher import parse_repo_slug, FetchError
from plumber.core.badges import generate_badge_svg
from plumber.core.hooks import (
    HOOK_MARKER, blocking_issues, clean_dead_code, install_pre_commit,
    run_hook, scan_staged, uninstall_pre_commit
)


class TestPlumberCore(unittest.TestCase):
    def setUp(self):
        self.engine = PlumberEngine()

    def test_scoring_grades(self):
        self.assertEqual(calculate_grade(0.0), "A")
        self.assertEqual(calculate_grade(8.5), "A")
        self.assertEqual(calculate_grade(15.0), "B")
        self.assertEqual(calculate_grade(35.0), "C")
        self.assertEqual(calculate_grade(55.0), "D")
        self.assertEqual(calculate_grade(75.0), "F")

    def test_repo_slug_parsing(self):
        self.assertEqual(parse_repo_slug("owner/repo"), ("owner", "repo"))
        self.assertEqual(parse_repo_slug("https://github.com/pallets/flask"), ("pallets", "flask"))
        self.assertEqual(parse_repo_slug("https://github.com/pallets/flask.git"), ("pallets", "flask"))
        with self.assertRaises(FetchError):
            parse_repo_slug("invalid-slug")

    def test_detect_leak_api_key(self):
        code = 'client = OpenAI(api_key="sk-live1234567890abcdef1234567890")'
        rep = self.engine.scan_file_content("app.py", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("leak/api-key", rule_ids)

    def test_detect_elided_code(self):
        code = """def calculate_total(cart):
    # ... existing code ...
    return total"""
        rep = self.engine.scan_file_content("cart.py", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("clog/elided-code", rule_ids)

    def test_detect_swallowed_error(self):
        code = """try:
    do_something()
except:
    pass"""
        rep = self.engine.scan_file_content("worker.py", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("clog/swallowed-error", rule_ids)

    def test_detect_ai_gradient(self):
        code = '<div class="h-64 bg-gradient-to-r from-purple-600 via-violet-500 to-pink-500"></div>'
        rep = self.engine.scan_file_content("Hero.jsx", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("slop/ai-gradient", rule_ids)

    def test_detect_clickable_div(self):
        code = '<div onClick="submitForm()">Submit</div>'
        rep = self.engine.scan_file_content("form.html", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("joint/clickable-div", rule_ids)

    def test_svg_badge_generation(self):
        svg = generate_badge_svg("plumber", "grade A · 0.0", "A")
        self.assertIn("<svg", svg)
        self.assertIn("grade A · 0.0", svg)
        self.assertIn("#067647", svg)

    def test_detect_dead_code_python(self):
        code = """def total(items):
    return sum(items)
    print("never runs")"""
        rep = self.engine.scan_file_content("cart.py", code)
        dead = [i for i in rep.issues if i.rule_id == "clog/dead-code"]
        self.assertEqual(len(dead), 1)
        self.assertEqual(dead[0].line, 3)

    def test_detect_dead_code_js(self):
        code = """function total(items) {
  return items.length;
  console.log("never runs");
}"""
        rep = self.engine.scan_file_content("cart.js", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertIn("clog/dead-code", rule_ids)

    def test_dead_code_ignores_multiline_strings(self):
        code = 'code = """\n    return total\n"""\nrep = 1\n'
        rep = self.engine.scan_file_content("sample.py", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertNotIn("clog/dead-code", rule_ids)

    def test_dead_code_not_flagged_after_branch(self):
        code = """def sign(x):
    if x > 0:
        return 1
    else:
        return -1"""
        rep = self.engine.scan_file_content("sign.py", code)
        rule_ids = [i.rule_id for i in rep.issues]
        self.assertNotIn("clog/dead-code", rule_ids)


class TestGitHook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.root, check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _stage(self, name, content):
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        subprocess.run(["git", "add", name], cwd=self.root, check=True)
        return path

    def test_install_and_uninstall_hook(self):
        hook_path = install_pre_commit(self.root)
        self.assertTrue(hook_path.exists())
        self.assertIn(HOOK_MARKER, hook_path.read_text(encoding="utf-8"))
        self.assertIn("plumber hook", hook_path.read_text(encoding="utf-8"))
        self.assertTrue(uninstall_pre_commit(self.root))
        self.assertFalse(hook_path.exists())

    def test_install_refuses_foreign_hook_without_force(self):
        hook_path = install_pre_commit(self.root)
        hook_path.write_text("#!/bin/sh\necho custom\n", encoding="utf-8")
        from plumber.core.hooks import HookError
        with self.assertRaises(HookError):
            install_pre_commit(self.root)
        install_pre_commit(self.root, force=True)
        self.assertIn(HOOK_MARKER, hook_path.read_text(encoding="utf-8"))

    def test_scan_staged_blocks_secrets(self):
        self._stage("app.py", 'client = OpenAI(api_key="sk-live1234567890abcdef1234567890")\n')
        report = scan_staged(self.root)
        self.assertTrue(any(i.rule_id == "leak/api-key" for i in report.issues))
        self.assertTrue(blocking_issues(report))

    def test_scan_staged_blocks_env_files(self):
        self._stage(".env", "API_URL=http://localhost\n")
        report = scan_staged(self.root)
        self.assertTrue(any(i.rule_id == "leak/committed-env" for i in report.issues))
        self.assertTrue(blocking_issues(report))

    def test_scan_staged_allows_clean_code(self):
        self._stage("app.py", "def add(a, b):\n    return a + b\n")
        report = scan_staged(self.root)
        self.assertEqual(blocking_issues(report), [])

    def test_run_hook_returns_failure_code(self):
        self._stage("app.py", 'PASSWORD = "hunter2hunter2"\n')
        out = io.StringIO()
        with redirect_stdout(out):
            code = run_hook(self.root)
        self.assertEqual(code, 1)
        self.assertIn("BLOCKED", out.getvalue())

    def test_clean_removes_unreachable_lines(self):
        path = self.root / "dead.py"
        path.write_text("def f():\n    return 1\n    x = 2\n", encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out):
            files_changed, lines_removed = clean_dead_code(path, write=True)
        self.assertEqual(files_changed, 1)
        self.assertEqual(lines_removed, 1)
        self.assertEqual(path.read_text(encoding="utf-8"), "def f():\n    return 1\n")


if __name__ == "__main__":
    unittest.main()
