# Plumber — Code Leak, Clog, and AI Slop Inspector

[![npm version](https://img.shields.io/npm/v/plumber-linter.svg)](https://npmjs.com/package/plumber-linter)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)

**Plumber** is a deterministic, offline-capable code quality and anti-slop linter for the AI-agent era. It inspects codebases in milliseconds without requiring an LLM.

---

## Quick Start

No global installation required:
```bash
# Scan current repository
npx plumber-linter scan .

# Enforce quality gate (exit 1 on HIGH or CRITICAL issues)
npx plumber-linter scan . --fail-on high

# Export report as Markdown or JSON
npx plumber-linter scan . --format md
npx plumber-linter scan . --format json

# View all active inspection rules
npx plumber-linter rules
```

---

## Block Bad Commits

Install a git pre-commit hook that blocks any commit containing API keys, hardcoded
secrets, `.env` files, or unreachable dead code:

```bash
npx plumber-linter install-hook
```

The hook inspects only staged files (read from the git index, so partially staged
changes are honored). Leaks and `.env` files always block; other findings block at
`HIGH` by default. Tune the threshold or remove the hook:

```bash
npx plumber-linter install-hook --fail-on critical
npx plumber-linter uninstall-hook
git commit --no-verify   # bypass once
```

---

## Remove Dead Code

```bash
# Preview unreachable lines (no writes)
npx plumber-linter clean .

# Delete them
npx plumber-linter clean . --write
```

---

## Claude Code & Cursor

### Claude Code
Add to your project's `CLAUDE.md`:
```bash
npx plumber-linter scan . --fail-on high
```

### Cursor
Add to `.cursorrules` and run from the integrated terminal:
```bash
npx plumber-linter scan .
```

---

## License
MIT License.
