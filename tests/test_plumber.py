"""
Unit tests for Plumber scanner and rule engine.
"""
import unittest
from pathlib import Path

from plumber.core.engine import PlumberEngine
from plumber.core.scoring import calculate_score, calculate_grade
from plumber.core.models import Issue, CRITICAL, HIGH, MEDIUM, LOW
from plumber.core.fetcher import parse_repo_slug, FetchError
from plumber.core.badges import generate_badge_svg


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


if __name__ == "__main__":
    unittest.main()
