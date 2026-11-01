"""
Command Line Interface (CLI) for Plumber.
"""
import sys
import os
import argparse
from pathlib import Path

from plumber.core.engine import PlumberEngine
from plumber.core.fetcher import parse_repo_slug, scan_github_repo, FetchError
from plumber.core.badges import export_markdown, export_json, export_csv
from plumber.core.hooks import (
    HookError, clean_dead_code, find_git_root, install_pre_commit,
    run_hook, uninstall_pre_commit
)
from plumber.core.models import CRITICAL, HIGH, MEDIUM, LOW, INFO
from plumber.rules import load_all_rules

SEV_ORDER = {CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0}


def main():
    parser = argparse.ArgumentParser(
        prog="plumber",
        description="Deterministic Code Leak, Clog, and AI Slop Inspector"
    )
    subparsers = parser.add_subparsers(dest="command")

    # scan command
    scan_p = subparsers.add_parser("scan", help="Scan a directory or GitHub repository")
    scan_p.add_argument("target", nargs="?", default=".", help="Local path or GitHub 'owner/repo'")
    scan_p.add_argument("-f", "--format", choices=["pretty", "json", "md", "csv"], default="pretty", help="Output format")
    scan_p.add_argument("--fail-on", choices=["critical", "high", "medium", "low"], help="Exit with error code 1 if issues at or above this severity exist")

    # rules command
    subparsers.add_parser("rules", help="List all registered inspection rules")

    # server command
    srv_p = subparsers.add_parser("server", help="Start the local Vercel-style web server")
    srv_p.add_argument("-p", "--port", type=int, default=3000, help="Port to bind to")

    # mcp command
    subparsers.add_parser("mcp", help="Run the Model Context Protocol (MCP) server over stdio")

    # install-hook command
    install_p = subparsers.add_parser("install-hook", help="Install a git pre-commit hook that blocks leaks and dead code")
    install_p.add_argument("--path", default=".", help="Repository path (defaults to current directory)")
    install_p.add_argument("--fail-on", choices=["critical", "high", "medium", "low"], default="high", help="Block at this severity (default: high)")
    install_p.add_argument("--force", action="store_true", help="Back up and replace an existing non-Plumber hook")

    # uninstall-hook command
    uninstall_p = subparsers.add_parser("uninstall-hook", help="Remove the Plumber git pre-commit hook")
    uninstall_p.add_argument("--path", default=".", help="Repository path (defaults to current directory)")

    # hook command (invoked by git)
    hook_p = subparsers.add_parser("hook", help="Inspect staged files (used internally by the pre-commit hook)")
    hook_p.add_argument("--fail-on", choices=["critical", "high", "medium", "low"], default="high", help="Block at this severity (default: high)")

    # clean command
    clean_p = subparsers.add_parser("clean", help="Remove unreachable dead code (dry run unless --write)")
    clean_p.add_argument("target", nargs="?", default=".", help="File or directory to clean")
    clean_p.add_argument("--write", action="store_true", help="Apply removals to disk")

    args = parser.parse_args()

    if not args.command or args.command == "scan":
        target = getattr(args, "target", ".")
        fmt = getattr(args, "format", "pretty")
        fail_on = getattr(args, "fail_on", None)
        run_scan_cli(target, fmt, fail_on)
    elif args.command == "rules":
        list_rules_cli()
    elif args.command == "server":
        from dev import run_server
        run_server(args.port)
    elif args.command == "mcp":
        from plumber.mcp import run_mcp_server
        run_mcp_server()
    elif args.command == "install-hook":
        install_hook_cli(args.path, args.fail_on, args.force)
    elif args.command == "uninstall-hook":
        uninstall_hook_cli(args.path)
    elif args.command == "hook":
        sys.exit(run_hook(fail_on=args.fail_on))
    elif args.command == "clean":
        clean_cli(args.target, args.write)


def run_scan_cli(target: str, fmt: str, fail_on: str = None):
    target_path = Path(target)
    is_local = target_path.exists() and (target_path.is_dir() or target_path.is_file())

    if is_local:
        engine = PlumberEngine()
        if target_path.is_file():
            content = target_path.read_text(encoding="utf-8", errors="ignore")
            rep = engine.scan_file_content(str(target_path), content)
            from plumber.core.models import ScanReport
            from plumber.core.scoring import calculate_score, calculate_grade, summarize_counts, generate_agent_brief
            score = calculate_score(rep.issues, rep.line_count)
            grade = calculate_grade(score)
            s_c, c_c = summarize_counts(rep.issues)
            report = ScanReport(
                repo_name=target_path.name,
                total_files=1,
                total_lines=rep.line_count,
                score=score,
                grade=grade,
                issues=rep.issues,
                file_reports=[rep],
                counts_by_severity=s_c,
                counts_by_category=c_c,
                brief=generate_agent_brief(target_path.name, score, grade, [rep])
            )
        else:
            report = engine.scan_directory(target_path.resolve())
    else:
        try:
            owner, repo = parse_repo_slug(target)
            print(f"[*] Streaming and inspecting {owner}/{repo} from GitHub CDN...")
            report = scan_github_repo(owner, repo)
        except FetchError as e:
            print(f"\n[Error] {e.message}\n{e.hint}", file=sys.stderr)
            sys.exit(1)

    if fmt == "json":
        print(export_json(report))
    elif fmt == "md":
        print(export_markdown(report))
    elif fmt == "csv":
        print(export_csv(report))
    else:
        render_pretty_cli(report)

    if fail_on:
        threshold = SEV_ORDER.get(fail_on.upper(), 0)
        has_failure = any(SEV_ORDER.get(i.severity, 0) >= threshold for i in report.issues)
        if has_failure:
            print(f"\n[FAILED] Found issues at or above severity: {fail_on.upper()}", file=sys.stderr)
            sys.exit(1)


def render_pretty_cli(report):
    print("\n" + "=" * 65)
    print(f"  PLUMBER INSPECTION REPORT: {report.owner + '/' if report.owner else ''}{report.repo_name}")
    print(f"  Health Score: {report.score:.1f}/100 | Grade: {report.grade} | Duration: {report.duration_seconds:.2f}s")
    print(f"  Files: {report.total_files} | Lines: {report.total_lines:,} | Issues Found: {len(report.issues)}")
    print("=" * 65)

    if not report.issues:
        print("\n  [✓] Pristine repository! No leaks, clogs, or slop detected.\n")
        return

    print("\n  Severity Counts:")
    for sev in [CRITICAL, HIGH, MEDIUM, LOW, INFO]:
        cnt = report.counts_by_severity.get(sev, 0)
        if cnt > 0:
            print(f"    - {sev:<9}: {cnt}")

    print("\n" + "-" * 65)
    for f in report.file_reports:
        if not f.issues:
            continue
        print(f"\n  [FILE] {f.path} ({len(f.issues)} issues)")
        for issue in f.issues:
            print(f"    L{issue.line:<4} [{issue.severity}] {issue.title}")
            print(f"           Rule: {issue.rule_id}")
            if issue.evidence:
                ev = issue.evidence.replace("\n", " ").strip()[:90]
                print(f"           Found: {ev}")
            if issue.fix:
                print(f"           Fix: {issue.fix}")

    print("\n" + "=" * 65 + "\n")


def install_hook_cli(path: str, fail_on: str, force: bool):
    root = find_git_root(Path(path))
    if root is None:
        print(f"[Error] No git repository found at or above '{path}'.", file=sys.stderr)
        sys.exit(1)
    try:
        hook_path = install_pre_commit(root, fail_on=fail_on, force=force)
    except HookError as e:
        print(f"[Error] {e}", file=sys.stderr)
        sys.exit(1)
    print(f"[Plumber] Pre-commit hook installed at {hook_path}")
    print(f"[Plumber] Commits are blocked on secrets, .env files, and issues >= {fail_on.upper()}.")


def uninstall_hook_cli(path: str):
    root = find_git_root(Path(path))
    if root is None:
        print(f"[Error] No git repository found at or above '{path}'.", file=sys.stderr)
        sys.exit(1)
    try:
        removed = uninstall_pre_commit(root)
    except HookError as e:
        print(f"[Error] {e}", file=sys.stderr)
        sys.exit(1)
    if removed:
        print("[Plumber] Pre-commit hook removed.")
    else:
        print("[Plumber] No pre-commit hook installed; nothing to remove.")


def clean_cli(target: str, write: bool):
    target_path = Path(target)
    if not target_path.exists():
        print(f"[Error] Target path '{target}' does not exist.", file=sys.stderr)
        sys.exit(1)
    print(f"\n[Plumber] Dead code scan: {target_path.resolve()}")
    files_changed, lines_removed = clean_dead_code(target_path, write=write)
    if write and lines_removed:
        print(f"[Plumber] Removed {lines_removed} unreachable line(s) in {files_changed} file(s).")
    print()


def list_rules_cli():
    rules = load_all_rules()
    print(f"\nPlumber Registered Inspection Rules ({len(rules)} total):\n")
    for r in sorted(rules, key=lambda x: (x.category, x.severity)):
        print(f"  [{r.category}] {r.rule_id} ({r.severity})")
        print(f"    Title: {r.title}")
        print(f"    Why:   {r.description}")
        print(f"    Fix:   {r.fix}\n")


if __name__ == "__main__":
    main()
