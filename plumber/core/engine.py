"""
Plumber core inspection engine.
"""
import os
import time
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from plumber.core.models import (
    Issue, FileReport, ScanReport
)
from plumber.core.scoring import (
    calculate_score, calculate_grade, summarize_counts, generate_agent_brief
)
from plumber.rules import load_all_rules, FileContext, Rule

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".nuxt", "vendor",
    ".venv", "venv", "__pycache__", "coverage", ".turbo", ".svelte-kit",
    ".output", ".vercel", "target", "bin", "obj", ".idea", ".vscode"
}

SCANNABLE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss",
    ".less", ".vue", ".svelte", ".astro", ".go", ".rs", ".java", ".env"
}


class PlumberEngine:
    def __init__(self):
        self.rules: List[Rule] = load_all_rules()

    def _create_context(self, rel_path: str, content: str) -> FileContext:
        path_obj = Path(rel_path)
        ext = path_obj.suffix.lower()
        if path_obj.name.startswith(".env"):
            ext = ".env"

        filename = path_obj.name.lower()
        lines = content.splitlines()

        is_test = any(t in filename for t in ("test", "spec")) or "tests/" in rel_path.replace("\\", "/").lower()
        is_markup = ext in (".html", ".htm", ".vue", ".svelte", ".astro", ".jsx", ".tsx")
        is_style = ext in (".css", ".scss", ".less")
        is_script = ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java")
        is_doc = ext in (".md", ".mdx", ".txt")

        return FileContext(
            path=rel_path.replace("\\", "/"),
            filename=path_obj.name,
            ext=ext,
            content=content,
            lines=lines,
            is_test=is_test,
            is_markup=is_markup,
            is_style=is_style,
            is_script=is_script,
            is_doc=is_doc
        )

    def scan_file_content(self, rel_path: str, content: str) -> FileReport:
        ctx = self._create_context(rel_path, content)
        issues: List[Issue] = []

        for r in self.rules:
            detected = r.check(ctx)
            if detected:
                issues.extend(detected)

        return FileReport(path=ctx.path, issues=issues, line_count=len(ctx.lines))

    def scan_files(
        self,
        file_items: List[Tuple[str, str]],
        repo_name: str = "",
        owner: str = "",
        commit: str = "",
        started_time: Optional[float] = None
    ) -> ScanReport:
        """Inspects in-memory list of (rel_path, content) using a thread pool."""
        started = started_time if started_time is not None else time.monotonic()
        file_reports: List[FileReport] = []
        all_issues: List[Issue] = []
        total_lines = 0

        # Scan files concurrently across threads
        max_workers = min(32, (os.cpu_count() or 4) * 2)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            reports = list(executor.map(lambda item: self.scan_file_content(item[0], item[1]), file_items))

        for rep in reports:
            total_lines += rep.line_count
            if rep.issues:
                file_reports.append(rep)
                all_issues.extend(rep.issues)

        duration = time.monotonic() - started
        score = calculate_score(all_issues, total_lines)
        grade = calculate_grade(score)
        sev_counts, cat_counts = summarize_counts(all_issues)
        brief = generate_agent_brief(repo_name, score, grade, file_reports)

        return ScanReport(
            repo_name=repo_name,
            owner=owner,
            commit=commit,
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M"),
            total_files=len(file_reports),
            total_lines=total_lines,
            duration_seconds=duration,
            score=score,
            grade=grade,
            issues=all_issues,
            file_reports=file_reports,
            counts_by_severity=sev_counts,
            counts_by_category=cat_counts,
            brief=brief
        )

    def scan_directory(self, root_dir: Path, repo_name: str = "", owner: str = "", commit: str = "") -> ScanReport:
        started = time.monotonic()
        root_dir = Path(root_dir)
        if not repo_name:
            repo_name = root_dir.name

        file_items: List[Tuple[str, str]] = []

        for root, dirs, files in os.walk(root_dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]

            for file in files:
                file_path = Path(root) / file
                ext = file_path.suffix.lower()
                if file.startswith(".env"):
                    ext = ".env"

                if ext not in SCANNABLE_EXTS and not file.startswith(".env"):
                    continue

                # Skip files larger than 1.5MB
                try:
                    if file_path.stat().st_size > 1.5 * 1024 * 1024:
                        continue
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                try:
                    rel = str(file_path.relative_to(root_dir))
                except ValueError:
                    rel = file_path.name

                file_items.append((rel, content))

        return self.scan_files(file_items, repo_name=repo_name, owner=owner, commit=commit, started_time=started)
