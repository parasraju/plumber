# Plumber — Claude Code Instructions

## Overview
Plumber is a deterministic, offline-capable code quality, security leak, and AI slop inspector for the AI-agent era. It inspects local codebases and public GitHub repositories without requiring an LLM.

## CLI Commands
```bash
# Run local inspection
plumber scan .

# Run with strict CI threshold (fail if HIGH or CRITICAL issues exist)
plumber scan . --fail-on high

# Export report in JSON or Markdown
plumber scan . --format json
plumber scan . --format md

# List all 21 registered inspection rules
plumber rules

# Install a git pre-commit hook that blocks secrets, .env files, and dead code
plumber install-hook

# Remove unreachable dead code (preview, then apply)
plumber clean .
plumber clean . --write

# Run Model Context Protocol (MCP) server
plumber mcp

# Start local web dashboard
plumber server -p 3100
```

## Quality Standards & Slop Prevention Rules
When editing or generating code in this repository, Claude Code must adhere to these rules:

1. **No Elided Code (`clog/elided-code`)**:
   - Never leave comments like `// ... existing code ...`, `# ... remaining code ...`, or `/* code remains unchanged */`.
   - Always output complete, working functions and components.

2. **No Swallowed Exceptions (`clog/swallowed-error`)**:
   - Never write `except: pass`, `except Exception: pass`, or `catch () {}`.
   - Always log errors or raise explicit domain exceptions.

3. **No Visual AI Slop (`slop/ai-gradient`, `slop/neon-glow`)**:
   - Never use generic purple/violet-to-pink gradients (`from-purple-600 to-pink-500`, `#667eea`).
   - Use crisp monochromatic neutrals (Vercel-style ivory/dark) or project brand tokens.
   - Avoid heavy neon glow blur box-shadows; use crisp 1px borders instead.

4. **Accessible Joints (`joint/clickable-div`, `joint/icon-button`, `joint/focus-removed`)**:
   - Use `<button type="button">` instead of clickable `<div onClick=...>` or `<span onClick=...>`.
   - Always provide `aria-label` on buttons that contain only icons or SVGs.
   - Never strip focus outlines with `outline: none` without providing a visible `:focus-visible` replacement.

5. **Secrets & Leaks (`leak/api-key`, `leak/hardcoded-secret`, `leak/committed-env`)**:
   - Never hardcode API keys (OpenAI `sk-...`, GitHub `ghp_...`, AWS `AKIA...`) or plaintext passwords.
   - Use environment variables (`os.environ` or `process.env`).

## Automated Verification Workflow
Before completing any task, run:
```bash
plumber scan . --fail-on high
```
Ensure all detected issues are resolved and unit tests pass:
```bash
python -m unittest discover tests
```
