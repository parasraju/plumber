"""
Rules for detecting clogs: elided code, stubs, swallowed errors, and AI step comments.
"""
import re
from typing import List
from plumber.core.models import Issue, HIGH, MEDIUM, LOW, CAT_CLOGS
from plumber.rules import register_rule, FileContext

ELIDED_PATTERN = re.compile(
    r'(?://|#|/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code|remaining\s+code|code\s+remains\s+unchanged|code\s+here)',
    re.IGNORECASE
)

SWALLOWED_EXCEPT_PY = re.compile(r'except(?:\s+\w+)?:\s*(?:pass|\.\.\.)')
SWALLOWED_CATCH_JS = re.compile(r'catch\s*\([^)]*\)\s*\{\s*\}')

STEP_COMMENT_PATTERN = re.compile(
    r'(?://|#)\s*(?:Step\s+\d+|Phase\s+\d+|TODO:\s*Step\s+\d+)\s*[:\-]',
    re.IGNORECASE
)

STUB_PATTERN = re.compile(
    r'(?:throw\s+new\s+Error\(["\']not\s+implemented["\']\)|TODO:?\s*(?:implement|add logic|fill in))',
    re.IGNORECASE
)

WRAPPER_RE = re.compile(r'def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*[^:]+)?:\s*return\s+([A-Za-z0-9_.]+)\([^)]*\)')


@register_rule(
    "clog/elided-code",
    "AI-Elided Code Snippet Left in File",
    HIGH,
    CAT_CLOGS,
    "The code contains comments like '// ... existing code ...' where an AI agent elided code during a diff/edit.",
    "Restore the complete function or component implementation. Elided snippets often accidentally delete working logic."
)
def check_elided_code(ctx: FileContext) -> List[Issue]:
    if not ELIDED_PATTERN.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if ELIDED_PATTERN.search(line):
            issues.append(Issue(
                rule_id="clog/elided-code",
                title="AI-Elided Code Comment",
                severity=HIGH,
                category=CAT_CLOGS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip(),
                fix="Replace the elision with the actual complete source code.",
                description="Coding assistants often use placeholder comments when answering; pasting them truncates codebase logic."
            ))
    return issues


@register_rule(
    "clog/swallowed-error",
    "Swallowed Exception (Silent Failure)",
    HIGH,
    CAT_CLOGS,
    "An exception or catch block is empty or contains only 'pass', causing unexpected failures to fail silently.",
    "Log the error or properly re-raise/handle it with user notification."
)
def check_swallowed_exceptions(ctx: FileContext) -> List[Issue]:
    if not ctx.is_script:
        return []
    if "except" not in ctx.content and "catch" not in ctx.content:
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        clean = line.strip()
        next_clean = ctx.lines[line_num].strip() if line_num < len(ctx.lines) else ""

        # Python: single line "except: pass" or multiline "except:\n    pass"
        if ctx.ext in (".py",):
            is_swallowed = False
            if SWALLOWED_EXCEPT_PY.search(clean):
                is_swallowed = True
            elif clean.startswith("except") and clean.endswith(":") and next_clean in ("pass", "..."):
                is_swallowed = True

            if is_swallowed:
                evidence = clean if not next_clean else f"{clean} {next_clean}"
                issues.append(Issue(
                    rule_id="clog/swallowed-error",
                    title="Silent Error Catch (except: pass)",
                    severity=HIGH,
                    category=CAT_CLOGS,
                    file_path=ctx.path,
                    line=line_num,
                    evidence=evidence,
                    fix="Log the exception with details or raise a descriptive domain error.",
                    description="Silent error swallowing masks critical runtime crashes and corrupts state."
                ))
        # JS / TS
        elif ctx.ext in (".js", ".ts", ".jsx", ".tsx"):
            is_swallowed = False
            if SWALLOWED_CATCH_JS.search(clean):
                is_swallowed = True
            elif re.search(r'catch\s*\([^)]*\)\s*\{', clean) and next_clean == "}":
                is_swallowed = True

            if is_swallowed:
                evidence = clean if not next_clean else f"{clean} {next_clean}"
                issues.append(Issue(
                    rule_id="clog/swallowed-error",
                    title="Empty catch () {} Block",
                    severity=HIGH,
                    category=CAT_CLOGS,
                    file_path=ctx.path,
                    line=line_num,
                    evidence=evidence,
                    fix="Handle the error or log it with console.error/monitoring.",
                    description="Empty catch blocks prevent debugging and swallow critical API or network errors."
                ))
    return issues


@register_rule(
    "clog/stub-function",
    "Unimplemented Stub Function",
    MEDIUM,
    CAT_CLOGS,
    "Function contains 'not implemented' or TODO stub markers left behind by an AI agent.",
    "Implement the required logic or remove the dead placeholder."
)
def check_stub_functions(ctx: FileContext) -> List[Issue]:
    if not STUB_PATTERN.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if STUB_PATTERN.search(line):
            issues.append(Issue(
                rule_id="clog/stub-function",
                title="Unimplemented Stub Function",
                severity=MEDIUM,
                category=CAT_CLOGS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Complete the missing logic or remove the incomplete stub.",
                description="Placeholder stubs cause runtime errors when called by users."
            ))
    return issues


@register_rule(
    "clog/step-comments",
    "Robotic AI Step Comments Left Behind",
    LOW,
    CAT_CLOGS,
    "Sequential step comments like '// Step 1: Initialize ... // Step 2: ...' left in source code.",
    "Remove procedural step comments or replace with concise architectural documentation."
)
def check_step_comments(ctx: FileContext) -> List[Issue]:
    if not STEP_COMMENT_PATTERN.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if STEP_COMMENT_PATTERN.search(line):
            issues.append(Issue(
                rule_id="clog/step-comments",
                title="Robotic Step-by-Step AI Comment",
                severity=LOW,
                category=CAT_CLOGS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Clean up AI instructional comments; let clean code document itself.",
                description="Robotic numbered comments clutter the codebase without adding domain value."
            ))
    return issues


@register_rule(
    "slop/pointless-wrapper",
    "Function That Only Forwards Its Arguments",
    LOW,
    CAT_CLOGS,
    "Function that only immediately calls another function with forwarded arguments without adding behavior.",
    "Call the target function directly and eliminate unnecessary wrapper abstraction layers."
)
def check_pointless_wrapper(ctx: FileContext) -> List[Issue]:
    if not ctx.is_script or ctx.is_test:
        return []
    if "def " not in ctx.content or "return " not in ctx.content:
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if not line.startswith("def "):
            continue
        clean = line.strip()
        next_clean = ctx.lines[line_num].strip() if line_num < len(ctx.lines) else ""
        combined = f"{clean} {next_clean}" if clean.endswith(":") else clean
        m = WRAPPER_RE.search(combined)
        if m and m.group(1) != m.group(2):
            issues.append(Issue(
                rule_id="slop/pointless-wrapper",
                title=f"Function '{m.group(1)}' Only Forwards to '{m.group(2)}'",
                severity=LOW,
                category=CAT_CLOGS,
                file_path=ctx.path,
                line=line_num,
                evidence=clean[:100],
                fix="Call the underlying function directly or delete the wrapper.",
                description="Layers of trivial forwarders are a hallmark of over-abstracted AI code."
            ))
    return issues
