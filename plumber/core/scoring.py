"""
Scoring and brief generation logic for Plumber.
"""
from typing import List, Dict, Tuple
from plumber.core.models import (
    Issue, FileReport, CRITICAL, HIGH, MEDIUM, LOW, INFO,
    ALL_SEVERITIES, ALL_CATEGORIES
)

import math

SEVERITY_WEIGHTS = {
    CRITICAL: 10.0,
    HIGH: 5.0,
    MEDIUM: 2.0,
    LOW: 0.75,
    INFO: 0.1,
}

GRADE_COLORS = {
    "A": "#067647",
    "B": "#4d7c0f",
    "C": "#a15c07",
    "D": "#c4320a",
    "F": "#b42318",
}


def calculate_score(issues: List[Issue], total_lines: int) -> float:
    """Calculates penalty score from 0.0 (pristine) to 100.0 (maximum slop/leak)."""
    if not issues:
        return 0.0
    weight = sum(SEVERITY_WEIGHTS.get(i.severity, 1.0) for i in issues)
    # Calibrated density per 1k lines
    density = ((weight / max(total_lines, 200)) * 1000.0) * 0.8463
    return round(100.0 * (1.0 - math.exp(-density / 40.0)), 1)


def calculate_grade(score: float) -> str:
    """Computes letter grade for a given score."""
    if score < 10.0:
        return "A"
    if score < 25.0:
        return "B"
    if score < 45.0:
        return "C"
    if score < 65.0:
        return "D"
    return "F"


def summarize_counts(issues: List[Issue]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """Calculates counts by severity and category."""
    sev_counts = {s: 0 for s in ALL_SEVERITIES}
    cat_counts = {c: 0 for c in ALL_CATEGORIES}

    for issue in issues:
        if issue.severity in sev_counts:
            sev_counts[issue.severity] += 1
        if issue.category in cat_counts:
            cat_counts[issue.category] += 1

    return sev_counts, cat_counts


def generate_agent_brief(project_name: str, score: float, grade: str, files: List[FileReport]) -> str:
    """Generates an actionable fix prompt for AI coding agents (Claude, Codex, Cursor, Gemini)."""
    files_with_issues = [f for f in files if f.issues]
    if not files_with_issues:
        return f"# Plumber Inspection Brief for {project_name}\n\nNo leaks, clogs, or slop found! Repository scored 0/100 (Grade A).\n"

    lines = [
        f"# Plumber Inspection Brief: {project_name}",
        f"**Health Score:** {score:.1f}/100 | **Grade:** {grade} | **Files with Issues:** {len(files_with_issues)}",
        "",
        "## Agent Instructions",
        "Please fix the following detected code leaks, clogs, dead code, and AI slop tells. Follow each specific fix instruction carefully while preserving functional behavior.",
        ""
    ]

    for file_rep in files_with_issues:
        lines.append(f"### `{file_rep.path}` ({len(file_rep.issues)} issues)")
        for issue in file_rep.issues:
            lines.append(f"- **L{issue.line} [{issue.severity}] {issue.title}** (`{issue.rule_id}`)")
            if issue.evidence:
                clean_evidence = issue.evidence.replace("\n", " ").strip()
                lines.append(f"  - **Found:** `{clean_evidence[:140]}`")
            if issue.fix:
                lines.append(f"  - **Fix:** {issue.fix}")
        lines.append("")

    return "\n".join(lines)
