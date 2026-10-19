"""
Rules for detecting broken pipes: hallucinated imports, undeclared dependencies, and broken scripts.
"""
import re
from typing import List
from plumber.core.models import Issue, HIGH, MEDIUM, CAT_PIPES
from plumber.rules import register_rule, FileContext

IMPORT_PY = re.compile(r'^\s*(?:from|import)\s+([a-zA-Z0-9_]+)')
IMPORT_JS = re.compile(r'^\s*(?:import\s+.*?\s+from\s+["\']|require\(["\'])([@a-zA-Z0-9_\-\/]+)["\']')

KNOWN_HALLUCINATIONS = {
    "react-icons-plus", "flask-cors-extended", "express-validator-v2",
    "axios-retry-advanced", "next-auth-v5-helpers", "crypto-js-browser",
    "tailwind-colors-extended", "python-dotenv-safe-v2"
}

STANDARD_BUILTINS_PY = {
    "sys", "os", "re", "json", "time", "datetime", "math", "random", "pathlib",
    "typing", "urllib", "http", "io", "shutil", "tempfile", "hashlib", "subprocess",
    "collections", "itertools", "functools", "logging", "asyncio", "unittest",
    "dataclasses", "contextlib", "traceback", "threading", "multiprocessing",
    "copy", "socket", "struct", "base64", "uuid", "abc", "inspect", "csv"
}

DEAD_LINK_RE = re.compile(r'<a\s+[^>]*href=["\'](?:#|javascript:void\(0\);?)["\']', re.IGNORECASE)


@register_rule(
    "pipe/phantom-import",
    "Plausible but Hallucinated / Phantom Package Import",
    HIGH,
    CAT_PIPES,
    "Imports a package name known to be frequently hallucinated by LLM coding assistants.",
    "Verify whether this package actually exists on npm/PyPI or replace with standard library/official package."
)
def check_phantom_imports(ctx: FileContext) -> List[Issue]:
    if not ctx.is_script:
        return []

    # Fast pre-check: skip if neither known hallucinations nor pytest appear
    has_hallucination = any(h in ctx.content for h in KNOWN_HALLUCINATIONS)
    has_pytest_in_test = ctx.is_test and "pytest" in ctx.content
    if not (has_hallucination or has_pytest_in_test):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        clean = line.strip()
        # Python
        match_py = IMPORT_PY.match(clean)
        if match_py:
            pkg = match_py.group(1).lower()
            if pkg in KNOWN_HALLUCINATIONS or (pkg == "pytest" and ctx.is_test):
                issues.append(Issue(
                    rule_id="pipe/phantom-import",
                    title=f"Package Not Declared in Manifest '{pkg}'",
                    severity=HIGH,
                    category=CAT_PIPES,
                    file_path=ctx.path,
                    line=line_num,
                    evidence=clean,
                    fix=f"Declare '{pkg}' in requirements.txt / pyproject.toml or use standard library.",
                    description="Imported dependency is not declared in repository manifests."
                ))

        # JS/TS
        match_js = IMPORT_JS.match(clean)
        if match_js:
            pkg = match_js.group(1).lower()
            if pkg in KNOWN_HALLUCINATIONS:
                issues.append(Issue(
                    rule_id="pipe/phantom-import",
                    title=f"Potential Hallucinated Package '{pkg}'",
                    severity=HIGH,
                    category=CAT_PIPES,
                    file_path=ctx.path,
                    line=line_num,
                    evidence=clean,
                    fix=f"Check npm registry for '{pkg}'. Replace with official library if hallucinated.",
                    description="AI assistants frequently invent compound library names."
                ))
    return issues


@register_rule(
    "pipe/dead-link",
    "Broken or Null Link in Navigation",
    MEDIUM,
    CAT_PIPES,
    "Anchor tag has href='#' or 'javascript:void(0)', creating a broken link that fails accessibility.",
    "Replace dummy href with a valid route or convert the element to a semantic <button>."
)
def check_dead_links(ctx: FileContext) -> List[Issue]:
    if not ctx.is_markup:
        return []

    lower = ctx.content.lower()
    if "<a" not in lower:
        return []
    if "href=\"#\"" not in lower and "href='#'" not in lower and "javascript:void" not in lower:
        return []
    if not DEAD_LINK_RE.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if "<a" in line.lower() and DEAD_LINK_RE.search(line):
            issues.append(Issue(
                rule_id="pipe/dead-link",
                title="Dead Link (href='#' or 'javascript:void(0)')",
                severity=MEDIUM,
                category=CAT_PIPES,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="If this element triggers an action, use a <button type='button'>. If a link, provide a real href.",
                description="Anchor tags with '#' reset scroll position, break keyboard navigation, and fail a11y."
            ))
    return issues
