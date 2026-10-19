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
