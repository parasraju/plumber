# Plumber: Code Leak, Clog, and AI Slop Inspector

[![Plumber grade](http://localhost:3000/badge/pallets/flask)](http://localhost:3000/r/pallets/flask)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-black.svg)](https://python.org)

**Plumber** is a deterministic, offline-capable code quality and anti-slop linter for the AI-agent era. Crafted with the **Vercel Design System**, it inspects any public GitHub repository (or local codebase) in milliseconds without requiring an LLM.

---

## What Plumber Catches

| Category | Tells & Anti-Patterns | Severity |
| :--- | :--- | :--- |
| **Leaks & Secrets** | Hardcoded OpenAI/Claude keys, AWS access IDs, committed `.env` secrets | `CRITICAL` |
| **Clogs & Dead Code** | AI-elided comments (`// ... existing code ...`), empty stub functions, swallowed errors (`except: pass`, `catch {}`), unreachable statements after `return` | `HIGH` |
| **AI Slop Tells** | Purple/violet default gradients, heavy neon blur shadows, chatbot conversational residue | `MEDIUM` |
| **Pipes & Dependencies**| Hallucinated package imports, undeclared dependencies, dead `href="#"` links | `HIGH` / `MEDIUM` |
| **Joints & Accessibility** | Clickable `<div>` without roles/keys, stripped focus outlines, empty tests lacking assertions | `HIGH` / `MEDIUM` |

---

## 30-Second Quick Start

### 1. Run the Local Web App (Vercel-Style Dev Server)
```bash
python dev.py
# Opens at http://localhost:3100 (or http://localhost:3000)
```
Features:
- **Instant GitHub Scans**: Type any `owner/repo` or paste a GitHub URL to stream tarballs directly from GitHub CDN.
- **Dynamic SVG Badges**: Add `[![Plumber grade](https://<your-domain>/badge/owner/repo)](https://<your-domain>/r/owner/repo)` to your README.
- **Interactive Reports**: Filter by severity/category, full-text search, collapsible file cards.
- **Exporting**: Download results as **Markdown**, **JSON**, **CSV**, or **Print/PDF**.
- **AI Agent Fix Briefs**: Single-click copyable prompt for Claude Code, Codex, or Cursor to resolve all findings.

### 2. Run the Terminal CLI
Install Plumber in editable mode to use the `plumber` command directly from any terminal:
```bash
pip install -e .

# Inspect the current repository
plumber scan .

# Stream and inspect any public GitHub repo directly in your terminal
plumber scan pallets/flask
plumber scan fastapi/fastapi

# Export report in JSON, Markdown, or CSV
plumber scan . --format json
plumber scan . --format md

# Enforce in CI (exits with code 1 if issues >= HIGH exist)
plumber scan . --fail-on high

# Block git commits containing secrets, .env files, or dead code
plumber install-hook

# Remove the hook again
plumber uninstall-hook

# Preview and then remove unreachable dead code
plumber clean .
plumber clean . --write

# View registered rule catalogue
plumber rules
```

The pre-commit hook inspects only staged files (reading them from the git index, so partially staged changes are respected). It always blocks leaks and `.env` files, and blocks other findings at or above `--fail-on` (default `HIGH`). Bypass a single commit with `git commit --no-verify`.

### 3. Integrations (Claude Code & Cursor)

#### 🤖 Claude Code
Plumber includes [`CLAUDE.md`](CLAUDE.md) at the repository root. Claude Code will automatically detect it and adhere to Plumber's anti-slop, secret leak, and code quality standards. You can instruct Claude:
> *"Run `npx plumber-linter scan . --fail-on high` and resolve all findings."*

#### ⚡ Cursor
Plumber includes [`.cursorrules`](.cursorrules) and [`.cursor/rules/plumber.mdc`](.cursor/rules/plumber.mdc). Cursor will automatically prevent AI code elisions (`// ... existing code ...`), swallowed exceptions, and inaccessible UI components. Run `npx plumber-linter scan .` in terminal to audit your changes.

### 4. Deploy to Vercel
The repository includes a ready-to-deploy [`vercel.json`](vercel.json) and serverless handlers in [`api/`](api/):
```bash
npm i -g vercel
vercel deploy --prod
```

---

## Architecture

- **`plumber/core/`**:
  - `models.py`: Strongly typed dataclasses for `Issue`, `FileReport`, and `ScanReport`.
  - `scoring.py`: Density-weighted score algorithm (0.0 to 100.0) and letter grades (A through F).
  - `fetcher.py`: Memory-safe `.tar.gz` stream parser connecting directly to GitHub CDN without git binaries or API tokens.
  - `engine.py`: Multi-language traversal and AST/regex rule coordinator.
  - `hooks.py`: Git pre-commit hook installer, staged-file inspector, and dead-code cleaner.
  - `badges.py` & `html_report.py`: High-contrast Vercel-style SVG badge and HTML dashboard generators.
- **`plumber/rules/`**:
  - `leaks.py`, `clogs.py`, `slop.py`, `pipes.py`, `joints.py`.
- **`public/`**:
  - `index.html`: Clean semantic frontend following the Vercel Design System.
  - `site.css`: Monochrome dark/light theme tokens and layout styling.
  - `site.js`: Client-side tab controller, theme toggle, and scan triggers.
- **`api/`**:
  - `report.py`, `badge.py`, `scan.py` (Vercel serverless handlers).

---

## License
MIT License.
