"""
Rules for detecting leaked secrets, API keys, and credentials.
"""
import re
from typing import List
from plumber.core.models import Issue, CRITICAL, HIGH, MEDIUM, LOW, CAT_LEAKS
from plumber.rules import register_rule, FileContext

API_KEY_PATTERNS = [
    (re.compile(r'\b(sk-(?:live|test|proj)?[a-zA-Z0-9_-]{24,})\b'), "OpenAI / Model API Key"),
    (re.compile(r'\b(ghp_[a-zA-Z0-9]{36})\b'), "GitHub Personal Access Token"),
    (re.compile(r'\b(gho_[a-zA-Z0-9]{36})\b'), "GitHub OAuth Token"),
    (re.compile(r'\b(AKIA[0-9A-Z]{16})\b'), "AWS Access Key ID"),
    (re.compile(r'\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b'), "Slack API Token"),
    (re.compile(r'\b(sq0csp-[0-9A-Za-z_-]{32})\b'), "Square / Payment Secret"),
    (re.compile(r'(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["\']([a-zA-Z0-9_\-]{24,})["\']', re.IGNORECASE), "Generic Hardcoded Secret"),
]

API_KEY_HINTS = ("sk-", "ghp_", "gho_", "akia", "xox", "sq0csp", "api_key", "apikey", "secret_key", "access_token")

PASSWORD_PATTERN = re.compile(
    r'(?:password|passwd|db_pass|secret)\s*[:=]\s*["\']([^"\'\s]{6,})["\']',
    re.IGNORECASE
)

RAW_HTML_RE = re.compile(r'(?:\.innerHTML\s*=|dangerouslySetInnerHTML|\|\s*safe\b|document\.write\()')


@register_rule(
    "leak/api-key",
    "Leaked API Key or Private Access Token",
    CRITICAL,
    CAT_LEAKS,
    "Real API keys, cloud provider tokens, or access credentials are hardcoded in source code.",
    "Move this secret to an environment variable (.env / secret manager) and immediately revoke this exposed key."
)
def check_api_keys(ctx: FileContext) -> List[Issue]:
    if ctx.is_test:
        return []

    # Fast substring pre-check on whole content
    lower_content = ctx.content.lower()
    if not any(h in lower_content for h in API_KEY_HINTS):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        lower = line.lower()
        if any(w in lower for w in ("your_", "insert_", "<key>", "example", "dummy", "placeholder", "fake", "redact", "mask", "assert", "monkeypatch", "pattern", "regex", "@openssh", "sk-ssh-", "sk-ecdsa-")):
            continue

        for pattern, label in API_KEY_PATTERNS:
            match = pattern.search(line)
            if match:
                val = match.group(1)
                masked = val[:4] + "..." + val[-4:] if len(val) > 8 else "***"
                issues.append(Issue(
                    rule_id="leak/api-key",
                    title=f"Leaked {label}",
                    severity=CRITICAL,
                    category=CAT_LEAKS,
                    file_path=ctx.path,
                    line=line_num,
                    evidence=f"{line.strip()[:100]} (Token: {masked})",
                    fix="Extract the key to an environment variable and add this file to .gitignore if necessary.",
                    description=f"Found potential active credential matching {label}."
                ))
                break
    return issues


@register_rule(
    "sec/raw-html",
    "Raw HTML Injection / XSS Risk",
    MEDIUM,
    CAT_LEAKS,
    "Raw HTML injected via innerHTML, dangerouslySetInnerHTML, or template unescaped filters.",
    "Use textContent, safe DOM creation, or framework auto-escaping instead of raw HTML insertion."
)
def check_raw_html(ctx: FileContext) -> List[Issue]:
    if ctx.is_test or not (ctx.is_markup or ctx.is_script):
        return []

    if not ("innerHTML" in ctx.content or "dangerouslySetInnerHTML" in ctx.content or "safe" in ctx.content or "document.write" in ctx.content):
        return []
    if not RAW_HTML_RE.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if RAW_HTML_RE.search(line):
            issues.append(Issue(
                rule_id="sec/raw-html",
                title="Raw HTML Injection (XSS Risk)",
                severity=MEDIUM,
                category=CAT_LEAKS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Use textContent or safe DOM templating to avoid cross-site scripting vulnerabilities.",
                description="Assigning unescaped strings directly to innerHTML bypasses HTML sanitization."
            ))
    return issues


@register_rule(
    "leak/hardcoded-secret",
    "Hardcoded Password or Database Credential",
    HIGH,
    CAT_LEAKS,
    "Hardcoded plaintext passwords or connection strings found in source code.",
    "Replace hardcoded credential with process.env / os.environ reference."
)
def check_hardcoded_passwords(ctx: FileContext) -> List[Issue]:
    if ctx.is_test:
        return []

    lower_content = ctx.content.lower()
    if not any(k in lower_content for k in ("password", "passwd", "db_pass", "secret")):
        return []
    if not PASSWORD_PATTERN.search(ctx.content):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        if "EXAMPLE" in line.upper() or "PLACEHOLDER" in line.upper() or "DUMMY" in line.upper():
            continue
        match = PASSWORD_PATTERN.search(line)
        if match:
            pwd = match.group(1)
            # Filter obvious false positives like empty or standard variable types
            if pwd.lower() in ("string", "password", "true", "false", "null", "none"):
                continue
            issues.append(Issue(
                rule_id="leak/hardcoded-secret",
                title="Hardcoded Password or Secret",
                severity=HIGH,
                category=CAT_LEAKS,
                file_path=ctx.path,
                line=line_num,
                evidence=line.strip()[:100],
                fix="Use environment variables or secrets vault instead of inline string literals.",
                description="Plaintext secret assigned directly to a credential variable."
            ))
    return issues


@register_rule(
    "leak/committed-env",
    "Production Secret Committed in Environment File",
    CRITICAL,
    CAT_LEAKS,
    ".env file containing actual secret values rather than placeholder templates is tracked in git.",
    "Remove sensitive values, add .env to .gitignore, and provide .env.example with dummy values."
)
def check_env_file(ctx: FileContext) -> List[Issue]:
    if not (ctx.filename.startswith(".env") and not ctx.filename.endswith((".example", ".sample", ".template"))):
        return []

    issues = []
    for line_num, line in enumerate(ctx.lines, 1):
        clean = line.strip()
        if not clean or clean.startswith("#"):
            continue
        if "=" in clean:
            key, val = clean.split("=", 1)
            val = val.strip().strip("'\"")
            # If value looks like an actual live secret
            if len(val) >= 12 and not val.startswith(("your_", "insert_", "dummy", "sample", "localhost")):
                if any(s in key.lower() for s in ("secret", "key", "token", "password", "auth", "private")):
                    issues.append(Issue(
                        rule_id="leak/committed-env",
                        title=f"Committed Secret in {ctx.filename} ({key.strip()})",
                        severity=CRITICAL,
                        category=CAT_LEAKS,
                        file_path=ctx.path,
                        line=line_num,
                        evidence=f"{key.strip()}={val[:4]}...",
                        fix="Do not commit real secret values to git. Use .env.example instead.",
                        description=f"Found sensitive configuration key '{key.strip()}' populated in committed env file."
                    ))
    return issues
