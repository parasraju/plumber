"""
Git pre-commit hook integration.

Installs a hook that inspects staged files only (reading blobs from the git
index, so partially staged changes are honored) and blocks the commit when a
leak, secret, environment file, or other HIGH/CRITICAL issue is present.
"""
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

from plumber.core.engine import PlumberEngine, SCANNABLE_EXTS, SKIP_DIRS
from plumber.core.models import (
    Issue, FileReport, ScanReport, CRITICAL, HIGH, MEDIUM, LOW, INFO, CAT_LEAKS
)
from plumber.rules.clogs import find_dead_code

HOOK_MARKER = "# plumber-managed-hook"
HOOK_BACKUP_SUFFIX = ".pre-plumber"
SEV_ORDER = {CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0}
ENV_TEMPLATE_SUFFIXES = (".example", ".sample", ".template", ".dist")

PRE_COMMIT_SCRIPT = """#!/bin/sh
{marker}
# Installed by Plumber. Remove with: plumber uninstall-hook
# Bypass once with: git commit --no-verify
if command -v plumber >/dev/null 2>&1; then
  exec plumber hook {flags}
fi
if [ -x "./node_modules/.bin/plumber" ]; then
  exec ./node_modules/.bin/plumber hook {flags}
fi
if command -v plumber-linter >/dev/null 2>&1; then
  exec plumber-linter hook {flags}
fi
if command -v npx >/dev/null 2>&1; then
  exec npx --no-install plumber-linter hook {flags}
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m plumber hook {flags}
fi
if command -v python >/dev/null 2>&1; then
  exec python -m plumber hook {flags}
fi
echo "[Plumber] Could not locate plumber. Install it with: npm i -g plumber-linter" >&2
exit 1
"""


class HookError(Exception):
    """Raised when a git hook cannot be installed or removed."""


def _git(args: List[str], cwd: Path, text: bool = True) -> str:
    kwargs = {"capture_output": True, "check": False}
    if text:
        kwargs.update(text=True, encoding="utf-8", errors="ignore")
    result = subprocess.run(["git", *args], cwd=str(cwd), **kwargs)
    if result.returncode != 0:
        stderr = result.stderr if text else result.stderr.decode("utf-8", "ignore")
        raise HookError(stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def find_git_root(start: Path = None) -> Optional[Path]:
    """Return the repository root, or None when the path is not inside git."""
    cwd = Path(start or Path.cwd())
    try:
        return Path(_git(["rev-parse", "--show-toplevel"], cwd).strip())
    except (HookError, OSError):
        return None


def pre_commit_path(root: Path) -> Path:
    """Resolve the hook path, honoring worktrees and core.hooksPath."""
    try:
        rel = _git(["rev-parse", "--git-path", "hooks/pre-commit"], root).strip()
        path = Path(rel)
        return path if path.is_absolute() else (root / path)
    except (HookError, OSError):
        return root / ".git" / "hooks" / "pre-commit"


def install_pre_commit(root: Path, fail_on: str = "high", force: bool = False) -> Path:
    """Write the Plumber pre-commit hook. Returns the hook path."""
    if fail_on.upper() not in SEV_ORDER:
        raise HookError(f"Invalid severity '{fail_on}'. Use critical, high, medium, or low.")

    hook_path = pre_commit_path(root)
    hook_path.parent.mkdir(parents=True, exist_ok=True)

    if hook_path.exists():
        existing = hook_path.read_text(encoding="utf-8", errors="ignore")
        if HOOK_MARKER not in existing:
            if not force:
                raise HookError(
                    f"{hook_path} already exists and is not managed by Plumber. "
                    f"Re-run with --force to back it up to {hook_path.name}{HOOK_BACKUP_SUFFIX}."
                )
            backup = hook_path.with_name(hook_path.name + HOOK_BACKUP_SUFFIX)
            backup.write_text(existing, encoding="utf-8")

    flags = f"--fail-on {fail_on.lower()}"
    script = PRE_COMMIT_SCRIPT.format(marker=HOOK_MARKER, flags=flags)
    hook_path.write_text(script, encoding="utf-8", newline="\n")

    try:
        hook_path.chmod(hook_path.stat().st_mode | 0o111)
    except OSError as exc:
        print(f"[Plumber] Could not mark {hook_path} executable: {exc}", file=sys.stderr)

    return hook_path


def uninstall_pre_commit(root: Path) -> bool:
    """Remove the Plumber pre-commit hook. Returns True when a hook was removed."""
    hook_path = pre_commit_path(root)
    if not hook_path.exists():
        return False

    content = hook_path.read_text(encoding="utf-8", errors="ignore")
    if HOOK_MARKER not in content:
        raise HookError(f"{hook_path} is not managed by Plumber; refusing to delete it.")

    hook_path.unlink()

    backup = hook_path.with_name(hook_path.name + HOOK_BACKUP_SUFFIX)
    if backup.exists():
        backup.replace(hook_path)
    return True


def staged_files(root: Path) -> List[str]:
    """List added/copied/modified/renamed paths in the git index."""
    output = _git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root)
    return [p for p in output.split("\0") if p.strip()]


def staged_content(root: Path, rel_path: str) -> Optional[str]:
    """Read a file exactly as it is staged in the index."""
    try:
        return _git(["show", f":{rel_path}"], root)
    except HookError:
        return None


def _is_env_file(name: str) -> bool:
    return name.startswith(".env") and not name.endswith(ENV_TEMPLATE_SUFFIXES)


def scan_staged(root: Path) -> ScanReport:
    """Scan only the files staged for the next commit."""
    engine = PlumberEngine()
    items: List[Tuple[str, str]] = []
    env_issues: List[Issue] = []

    for rel_path in staged_files(root):
        name = Path(rel_path).name
        ext = Path(rel_path).suffix.lower()
        is_env = _is_env_file(name)
        if not is_env and ext not in SCANNABLE_EXTS:
            continue

        content = staged_content(root, rel_path)
        if content is None:
            continue

        items.append((rel_path, content))

        if is_env:
            env_issues.append(Issue(
                rule_id="leak/committed-env",
                title=f"Environment File Staged for Commit ({name})",
                severity=CRITICAL,
                category=CAT_LEAKS,
                file_path=rel_path.replace("\\", "/"),
                line=1,
                evidence=name,
                fix="Run 'git restore --staged <file>', add it to .gitignore, and commit a .env.example instead.",
                description="Environment files frequently contain live credentials and must never enter git history."
            ))

    report = engine.scan_files(items, repo_name=root.name)
    if env_issues:
        reports = {fr.path: fr for fr in report.file_reports}
        for issue in env_issues:
            report.issues.insert(0, issue)
            fr = reports.get(issue.file_path)
            if fr is None:
                fr = FileReport(path=issue.file_path)
                reports[issue.file_path] = fr
                report.file_reports.insert(0, fr)
            fr.issues.insert(0, issue)
    return report


def blocking_issues(report: ScanReport, fail_on: str = "high") -> List[Issue]:
    """Leaks and security findings always block; other rules block at the threshold."""
    threshold = SEV_ORDER.get(fail_on.upper(), SEV_ORDER[HIGH])
    return [
        issue for issue in report.issues
        if issue.category == CAT_LEAKS or SEV_ORDER.get(issue.severity, 0) >= threshold
    ]


def render_hook_report(report: ScanReport, blocking: List[Issue]) -> None:
    total = len(report.issues)
    print(f"[Plumber] Inspected {report.total_files} staged file(s), {report.total_lines} lines. "
          f"Found {total} issue(s).")

    if not blocking:
        print("[Plumber] No blocking leaks, secrets, or dead code. Commit allowed.")
        return

    print(f"[Plumber] {len(blocking)} blocking issue(s):")
    for issue in blocking:
        print(f"  {issue.file_path}:{issue.line}  [{issue.severity}] {issue.title}")
        if issue.evidence:
            print(f"      Found: {issue.evidence}")
        if issue.fix:
            print(f"      Fix:   {issue.fix}")

    print("\n[Plumber] BLOCKED: commit contains security, environment, or dead-code issues.")
    print("[Plumber] Fix the findings above, or bypass once with: git commit --no-verify")


def run_hook(start: Optional[Path] = None, fail_on: str = "high") -> int:
    """Entry point used by the pre-commit hook. Returns a process exit code."""
    root = find_git_root(start)
    if root is None:
        print("[Plumber] Not inside a git repository; skipping pre-commit inspection.")
        return 0

    try:
        report = scan_staged(root)
    except HookError as exc:
        print(f"[Plumber] Could not inspect staged files: {exc}", file=sys.stderr)
        return 1

    blocking = blocking_issues(report, fail_on)
    render_hook_report(report, blocking)
    return 1 if blocking else 0


def _iter_source_files(target: Path):
    if target.is_file():
        yield target
        return
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            path = Path(root) / name
            ext = path.suffix.lower()
            if ext in SCANNABLE_EXTS or _is_env_file(name):
                yield path


def clean_dead_code(target: Path, write: bool = False) -> Tuple[int, int]:
    """Remove unreachable lines. Returns (files_changed, lines_removed)."""
    target = Path(target)
    files_changed = 0
    lines_removed = 0

    for path in _iter_source_files(target):
        ext = path.suffix.lower()
        if ext not in (".py", ".js", ".jsx", ".ts", ".tsx"):
            continue
        try:
            with path.open("r", encoding="utf-8", errors="ignore", newline="") as fh:
                content = fh.read()
        except OSError:
            continue

        dead = [d for d in find_dead_code(content, ext) if d.removable]
        if not dead:
            continue

        doomed = {d.line for d in dead}
        lines = content.splitlines(keepends=True)
        new_content = "".join(line for i, line in enumerate(lines, 1) if i not in doomed)

        print(f"  {path}: {len(dead)} unreachable line(s)")
        for item in dead:
            print(f"    L{item.line}: {item.evidence[:90]}")

        files_changed += 1
        lines_removed += len(dead)

        if write:
            try:
                with path.open("w", encoding="utf-8", newline="") as fh:
                    fh.write(new_content)
            except OSError as exc:
                print(f"    Could not write {path}: {exc}", file=sys.stderr)

    if files_changed and not write:
        print("\nDry run only. Re-run with --write to delete these lines.")
    elif not files_changed:
        print("  No removable dead code found.")
    else:
        print(f"\nRemoved {lines_removed} line(s) across {files_changed} file(s).")

    return files_changed, lines_removed
