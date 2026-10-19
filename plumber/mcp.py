"""
Model Context Protocol (MCP) stdio server for Plumber.
Allows Claude Desktop, Cursor, Claude Code, Windsurf, and Zed to invoke Plumber as an AI tool.
Zero external dependencies (pure Python standard library).
"""
import sys
import json
import logging
from pathlib import Path
from typing import Dict, Any, List

from plumber.core.engine import PlumberEngine
from plumber.core.fetcher import parse_repo_slug, scan_github_repo, FetchError
from plumber.core.badges import export_markdown, export_json
from plumber.rules import load_all_rules

TOOLS = [
    {
        "name": "plumber_scan",
        "description": "Inspect a local directory, file, or public GitHub repository ('owner/repo') for leaked credentials, AI slop tells, broken pipes, and fragile joints. Returns grade, score, and issues.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "Local directory/file path (e.g. '.' or './src') or public GitHub repo slug (e.g. 'pallets/flask')."
                },
                "format": {
                    "type": "string",
                    "enum": ["markdown", "json", "summary"],
                    "default": "markdown",
                    "description": "Report output format."
                }
            },
            "required": ["target"]
        }
    },
    {
        "name": "plumber_scan_file",
        "description": "Inspect a single code file's contents directly for instant deterministic leak, clog, and slop detection.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Virtual or relative path of the file (e.g. 'app/main.py' or 'components/Button.tsx')."
                },
                "content": {
                    "type": "string",
                    "description": "The exact source code text of the file."
                }
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "plumber_list_rules",
        "description": "List all registered Plumber inspection rules, including rule IDs, categories, severities, and recommended fixes.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "plumber_get_agent_brief",
        "description": "Generate an actionable AI Agent Fix Brief with prioritized instructions for resolving all discovered issues in a codebase.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "Local directory path or GitHub repo slug."
                }
            },
            "required": ["target"]
        }
    }
]


def handle_scan(args: Dict[str, Any]) -> str:
    target = args.get("target", ".")
    fmt = args.get("format", "markdown")
    path_obj = Path(target)

    if path_obj.exists():
        engine = PlumberEngine()
        if path_obj.is_file():
            content = path_obj.read_text(encoding="utf-8", errors="ignore")
            rep = engine.scan_file_content(str(path_obj), content)
            from plumber.core.models import ScanReport
            from plumber.core.scoring import calculate_score, calculate_grade, summarize_counts, generate_agent_brief
            score = calculate_score(rep.issues, rep.line_count)
            grade = calculate_grade(score)
            s_c, c_c = summarize_counts(rep.issues)
            report = ScanReport(
                repo_name=path_obj.name,
                total_files=1,
                total_lines=rep.line_count,
                score=score,
                grade=grade,
                issues=rep.issues,
                file_reports=[rep],
                counts_by_severity=s_c,
                counts_by_category=c_c,
                brief=generate_agent_brief(path_obj.name, score, grade, [rep])
            )
        else:
            report = engine.scan_directory(path_obj.resolve())
    else:
        try:
            owner, repo = parse_repo_slug(target)
            report = scan_github_repo(owner, repo)
        except FetchError as err:
            return f"Error scanning '{target}': {err.message} ({err.hint})"

    if fmt == "json":
        return export_json(report)
    elif fmt == "summary":
        return f"Plumber Scan for {report.repo_name}:\nHealth Score: {report.score:.1f}/100 (Grade {report.grade})\nFiles: {report.total_files} | Lines: {report.total_lines:,}\nIssues: {len(report.issues)}"
    else:
        return export_markdown(report)


def handle_scan_file(args: Dict[str, Any]) -> str:
    path = args.get("path", "file.py")
    content = args.get("content", "")
    engine = PlumberEngine()
    rep = engine.scan_file_content(path, content)

    if not rep.issues:
        return f"File '{path}' is pristine. No leaks, clogs, or slop detected."

    lines = [f"Found {len(rep.issues)} issue(s) in {path}:"]
    for i in rep.issues:
        lines.append(f"- Line {i.line} [{i.severity}] {i.title}: {i.description}")
        if i.evidence:
            lines.append(f"    Evidence: {i.evidence.strip()}")
        if i.fix:
            lines.append(f"    Fix: {i.fix}")
    return "\n".join(lines)


def handle_list_rules(args: Dict[str, Any]) -> str:
    rules = load_all_rules()
    data = []
    for r in sorted(rules, key=lambda x: (x.category, x.severity)):
        data.append({
            "rule_id": r.rule_id,
            "category": r.category,
            "severity": r.severity,
            "title": r.title,
            "description": r.description,
            "fix": r.fix
        })
    return json.dumps(data, indent=2)


def handle_get_agent_brief(args: Dict[str, Any]) -> str:
    target = args.get("target", ".")
    path_obj = Path(target)
    if path_obj.exists():
        engine = PlumberEngine()
        report = engine.scan_directory(path_obj.resolve())
    else:
        owner, repo = parse_repo_slug(target)
        report = scan_github_repo(owner, repo)

    return report.brief or "No issues found! No agent brief needed."


def run_mcp_server():
    """Main stdio loop for Model Context Protocol."""
    sys.stderr.write("Plumber MCP server started (stdio mode)\n")
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except Exception:
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "plumber-mcp",
                        "version": "0.2.0"
                    }
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "notifications/initialized":
            # Handshake notification, no response required
            pass

        elif method == "tools/list":
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": TOOLS
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})

            try:
                if tool_name == "plumber_scan":
                    text = handle_scan(tool_args)
                elif tool_name == "plumber_scan_file":
                    text = handle_scan_file(tool_args)
                elif tool_name == "plumber_list_rules":
                    text = handle_list_rules(tool_args)
                elif tool_name == "plumber_get_agent_brief":
                    text = handle_get_agent_brief(tool_args)
                else:
                    text = f"Unknown tool '{tool_name}'."

                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": text
                            }
                        ]
                    }
                }
            except Exception as e:
                res = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32603,
                        "message": str(e)
                    }
                }

            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif req_id is not None:
            # Fallback for unhandled method
            res = {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"Method '{method}' not found."
                }
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    run_mcp_server()
