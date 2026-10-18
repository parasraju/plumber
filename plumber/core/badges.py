"""
SVG Badge and multi-format exporters (Markdown, JSON, CSV, HTML report).
"""
import html
import json
from plumber.core.models import ScanReport
from plumber.core.scoring import GRADE_COLORS


def generate_badge_svg(label: str, value: str, grade: str) -> str:
    color = GRADE_COLORS.get(grade, "#6b7280")

    def calc_width(text: str) -> int:
        return int(len(text) * 6.8 + 14)

    left_w = calc_width(label)
    right_w = calc_width(value)
    total_w = left_w + right_w

    esc_label = html.escape(label)
    esc_val = html.escape(value)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="20" role="img" aria-label="{esc_label}: {esc_val}">
  <title>{esc_label}: {esc_val}</title>
  <clipPath id="r"><rect width="{total_w}" height="20" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{left_w}" height="20" fill="#18181b"/>
    <rect x="{left_w}" width="{right_w}" height="20" fill="{color}"/>
  </g>
  <g fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="500" font-size="11">
    <text x="{left_w / 2}" y="14">{esc_label}</text>
    <text x="{left_w + right_w / 2}" y="14">{esc_val}</text>
  </g>
</svg>"""


def export_markdown(report: ScanReport) -> str:
    lines = [
        f"# Plumber Health Report: {report.owner}/{report.repo_name}" if report.owner else f"# Plumber Health Report: {report.repo_name}",
        f"**Grade: {report.grade}** | **Score: {report.score:.1f}/100** | **Issues Found: {len(report.issues)}**",
        f"*Scanned {report.total_files} files ({report.total_lines:,} lines) in {report.duration_seconds:.2f}s*",
        "",
        "## Severity Breakdown",
        f"- Critical: {report.counts_by_severity.get('CRITICAL', 0)}",
        f"- High: {report.counts_by_severity.get('HIGH', 0)}",
        f"- Medium: {report.counts_by_severity.get('MEDIUM', 0)}",
        f"- Low: {report.counts_by_severity.get('LOW', 0)}",
        f"- Info: {report.counts_by_severity.get('INFO', 0)}",
        "",
        "## Detailed Findings"
    ]

    for file_rep in report.file_reports:
        if not file_rep.issues:
            continue
        lines.append(f"### `{file_rep.path}` ({len(file_rep.issues)} issues)")
        for issue in file_rep.issues:
            lines.append(f"- **L{issue.line}** `[{issue.severity}]` {issue.title} (`{issue.rule_id}`)")
            if issue.evidence:
                clean_evidence = issue.evidence.replace("\n", " ").strip()
                lines.append(f"  > `{clean_evidence[:140]}`")
            if issue.fix:
                lines.append(f"  *Fix:* {issue.fix}")
        lines.append("")

    return "\n".join(lines)


def export_json(report: ScanReport) -> str:
    return json.dumps(report.to_dict(), indent=2)


def export_csv(report: ScanReport) -> str:
    import csv
    import io

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Severity", "File", "Line", "Category", "Rule", "Title", "Evidence", "Fix"])

    for issue in report.issues:
        clean_evidence = issue.evidence.replace("\n", " ").strip()
        writer.writerow([
            issue.severity,
            issue.file_path,
            issue.line,
            issue.category,
            issue.rule_id,
            issue.title,
            clean_evidence,
            issue.fix
        ])

    return output.getvalue()
