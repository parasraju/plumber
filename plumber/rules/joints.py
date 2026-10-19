"""
Rules for detecting fragile joints: accessibility flaws, missing focus, and empty tests.
"""
import re
from typing import List
from plumber.core.models import Issue, HIGH, MEDIUM, LOW, CAT_JOINTS
from plumber.rules import register_rule, FileContext

CLICKABLE_DIV = re.compile(
    r'<(?:div|span)\b(?![^>]*role=)[^>]*(?:onClick|onclick)=',
    re.IGNORECASE
)

OUTLINE_NONE = re.compile(
    r'(?:outline\s*:\s*(?:none|0)|class(?:Name)?=["\'][^"\']*\boutline-none\b)',
    re.IGNORECASE
)

ICON_BUTTON_EMPTY = re.compile(
    r'<button(?![^>]*aria-label)[^>]*>\s*(?:<svg[^>]*>.*?</svg>|<i\b[^>]*>\s*</i>)\s*</button>',
    re.IGNORECASE
)

TEST_FUNC_RE = re.compile(r'^\s*def\s+(test_\w+)\s*\([^)]*\):')


@register_rule(
    "joint/icon-button",
    "Icon Button Without Accessible Name",
    HIGH,
    CAT_JOINTS,
    "Button contains only an icon (<svg>, <i>) without an aria-label or accessible text.",
    "Add an aria-label attribute describing the action for screen readers."
)
def check_icon_button(ctx: FileContext) -> List[Issue]:
    # Buttons only occur in markup or JSX/TSX templates
    if not ctx.is_markup:
        return []
    if "<button" not in ctx.content.lower():
        return []
    if not ICON_BUTTON_EMPTY.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if "<button" in line.lower() and ICON_BUTTON_EMPTY.search(line):
            issues.append(Issue(
                rule_id="joint/icon-button",
                title="Icon Button Without Accessible Name",
                severity=HIGH,
                category=CAT_JOINTS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Add aria-label='...' to the button element.",
                description="Buttons containing only graphics without accessible text are invisible to assistive tech."
            ))
    return issues


@register_rule(
    "joint/clickable-div",
    "Non-Semantic Clickable Element (Missing Button / Role)",
    HIGH,
    CAT_JOINTS,
    "<div onClick=...> or <span onClick=...> without role='button' or keyboard handlers.",
    "Use a native <button type='button'> instead of a clickable div or span."
)
def check_clickable_div(ctx: FileContext) -> List[Issue]:
    if not ctx.is_markup:
        return []
    lower = ctx.content.lower()
    if ("<div" not in lower and "<span" not in lower) or "onclick" not in lower:
        return []
    if not CLICKABLE_DIV.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if "onclick" in line.lower() and CLICKABLE_DIV.search(line):
            issues.append(Issue(
                rule_id="joint/clickable-div",
                title="Clickable <div> or <span> Without Semantic Role",
                severity=HIGH,
                category=CAT_JOINTS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Convert element to a native <button> so it receives focus and keyboard Enter/Space activation.",
                description="Custom click handlers on divs are inaccessible to screen readers and keyboard users."
            ))
    return issues


@register_rule(
    "joint/focus-removed",
    "Focus Outline Removed Without Replacement",
    MEDIUM,
    CAT_JOINTS,
    "CSS or class removes focus indicators (outline: none, outline-none) without defining a visible focus ring.",
    "Provide a visible :focus-visible style with sufficient contrast (e.g., focus-visible:ring-2)."
)
def check_focus_removed(ctx: FileContext) -> List[Issue]:
    if not (ctx.is_style or ctx.is_markup):
        return []
    if "outline" not in ctx.content.lower():
        return []
    if not OUTLINE_NONE.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if "outline" in line.lower() and OUTLINE_NONE.search(line):
            # Check if focus ring is also added on the same line
            if "focus:" in line or "focus-visible:" in line or "box-shadow" in line:
                continue
            issues.append(Issue(
                rule_id="joint/focus-removed",
                title="Focus Outline Removed (outline: none)",
                severity=MEDIUM,
                category=CAT_JOINTS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Retain outline or use :focus-visible { outline: 2px solid var(--accent); }.",
                description="Removing focus outlines renders forms and buttons unusable for keyboard navigators."
            ))
    return issues


@register_rule(
    "joint/empty-test",
    "Empty Test with No Assertions",
    HIGH,
    CAT_JOINTS,
    "Unit test function that contains no assert, expect(), or verification logic.",
    "Add assertions verifying state, response, or output."
)
def check_empty_tests(ctx: FileContext) -> List[Issue]:
    if not ctx.is_test or ctx.ext != ".py":
        return []
    if "def test_" not in ctx.content:
        return []

    issues = []
    current_test = None
    current_line = 0
    has_assert = False

    for line_num, line in enumerate(ctx.lines, 1):
        m = TEST_FUNC_RE.match(line)
        if m:
            if current_test and not has_assert:
                issues.append(Issue(
                    rule_id="joint/empty-test",
                    title=f"Test '{current_test}' Has No Assertions",
                    severity=HIGH,
                    category=CAT_JOINTS,
                    file_path=ctx.path,
                    line=current_line,
                    evidence=f"def {current_test}(...)",
                    fix="Add assert statements or remove this placeholder test.",
                    description="Tests without assertions always pass, creating false confidence."
                ))
            current_test = m.group(1)
            current_line = line_num
            has_assert = False
        elif current_test:
            if "assert " in line or "AssertionError" in line or "self.assert" in line or "pytest.raises" in line:
                has_assert = True

    if current_test and not has_assert:
        issues.append(Issue(
            rule_id="joint/empty-test",
            title=f"Test '{current_test}' Has No Assertions",
            severity=HIGH,
            category=CAT_JOINTS,
            file_path=ctx.path,
            line=current_line,
            evidence=f"def {current_test}(...)",
            fix="Add assert statements or remove this placeholder test.",
            description="Tests without assertions always pass, creating false confidence."
        ))

    return issues
