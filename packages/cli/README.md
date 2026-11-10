# Plumber

CI/CD pipeline linter that flags hardcoded secrets, leaked credentials, and dead code — with fixes in plain English.

[![npm version](https://img.shields.io/npm/v/plumber-linter.svg)](https://www.npmjs.com/package/plumber-linter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/parasraju/plumber/blob/main/LICENSE)

Plumber inspects codebases and git repositories in milliseconds without requiring an LLM. It enforces quality and security gates in CI/CD pipelines and git pre-commit hooks, exiting with non-zero status when critical or high-severity issues are found.

---

## Installation

```bash
# Local project dependency
npm install --save-dev plumber-linter

# Global installation
npm install -g plumber-linter
```

---

## Quick Start

Run instantly with `npx` (no install required):

```bash
# Scan current repository
npx plumber-linter scan .

# Enforce quality gate in CI (exit 1 on HIGH or CRITICAL issues)
npx plumber-linter scan . --fail-on high

# Export report as Markdown or JSON
npx plumber-linter scan . --format md
npx plumber-linter scan . --format json

# View all 26 inspection rules
npx plumber-linter rules
```

### In GitHub Actions

```yaml
- name: Run Plumber Linter
  run: npx plumber-linter scan . --fail-on high
```

### In GitLab CI

```yaml
plumber-lint:
  image: node:18
  script:
    - npx plumber-linter scan . --fail-on high
```

### Git Pre-Commit Hook

Install a pre-commit hook that blocks commits containing secrets, `.env` files, or dead code:

```bash
# Install hook (blocks staged secrets and issues >= HIGH)
npx plumber-linter install-hook --fail-on high

# Uninstall hook
npx plumber-linter uninstall-hook
```

---

## What It Checks

### 1. Leaked Secrets & API Keys (`leak/api-key`, `leak/hardcoded-secret`)
Detects exposed OpenAI (`sk-...`), GitHub (`ghp_...`), AWS (`AKIA...`), Slack tokens, and database credentials.
- **Vulnerable:** `const client = new OpenAI({ apiKey: "sk-live1234567890abcdef1234567890" });`
- **Fixed:** `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`

### 2. Committed Environment Files (`leak/committed-env`)
Prevents committing `.env` files containing live secrets to version control.
- **Vulnerable:** `.env` committed with production credentials.
- **Fixed:** Add `.env` to `.gitignore` and commit `.env.example` with blank placeholders.

### 3. Swallowed Exceptions (`clog/swallowed-error`)
Flags silent failure blocks that swallow exceptions and hide failures in CI/CD pipelines.
- **Vulnerable:** `try { doWork(); } catch (err) {}`
- **Fixed:** `try { doWork(); } catch (err) { logger.error(err); throw err; }`

### 4. Unreachable Dead Code (`clog/dead-code`)
Detects unreachable statements following returns or inside constant-false branches.
- **Vulnerable:** `return result; console.log("Done");`
- **Fixed:** Delete unreachable statement (or run `npx plumber-linter clean . --write`).

### 5. AI-Elided Code Snippets (`clog/elided-code`)
Flags lazy AI elision comments like `// ... existing code ...` left behind in source files.
- **Vulnerable:** `// ... existing code ...`
- **Fixed:** Restore the full function or component implementation.

### 6. Non-Semantic / Inaccessible Elements (`joint/clickable-div`)
Identifies non-semantic clickable elements lacking accessible keyboard and screen-reader controls.
- **Vulnerable:** `<div onClick={handleClick}>Submit</div>`
- **Fixed:** `<button type="button" onClick={handleClick}>Submit</button>`

### 7. Hallucinated / Undeclared Dependencies (`pipe/phantom-import`)
Spots hallucinated library imports invented by LLMs or packages missing from project manifests.
- **Vulnerable:** `import { useFeature } from "next-auth-v5-helpers";`
- **Fixed:** Use standard verified libraries and declare dependencies in manifests.

### 8. CI/CD Supply-Chain & Pipeline Rules (v1.2.0)
- `pipe/docker-unpinned` — Flags unpinned Docker images (missing tag or `:latest`) in CI jobs or Dockerfiles (`MEDIUM`).
- `sec/curl-pipe-shell` — Flags `curl ... | bash` / `wget ... | sh` remote script execution in run steps (`CRITICAL`).
- `sec/permissions-write-all` — Flags overly broad workflow permissions (`permissions: write-all` or top-level `contents: write`) (`HIGH`).
- `leak/slack-webhook` — Flags hardcoded Slack or tokenized webhook URLs in workflow and source files (`CRITICAL`).
- `pipe/npm-unpinned` — Flags `npm install` steps in CI without `--save-exact` or `npm ci` lockfile enforcement (`MEDIUM`).

---

## Example Output

```text
================================================================
  PLUMBER INSPECTION REPORT: my-service
  Health Score: 87.4/100 | Grade: B | Files: 18
  Issues Detected: 2
================================================================

  [FILE] src/config.ts
    L14  [CRITICAL] Leaked OpenAI / Model API Key
           Found: const key = "sk-live9876543210..."
           Fix:   Move secret to environment variable (.env).

  [FILE] src/pipeline.ts
    L58  [HIGH] Swallowed Exception (Silent Failure)
           Found: catch (e) {}
           Fix:   Log the error or properly re-raise/handle it.

================================================================

[FAILED] Found issues at or above severity: HIGH
```

---

## Links

- **npm Package:** [https://www.npmjs.com/package/plumber-linter](https://www.npmjs.com/package/plumber-linter)
- **Website & Documentation:** [https://plumber-7dv.pages.dev/](https://plumber-7dv.pages.dev/)
- **GitHub Repository:** [https://github.com/parasraju/plumber](https://github.com/parasraju/plumber)

---

## Changelog

## 1.2.0
- `pipe/docker-unpinned`: Flag unpinned Docker images (no tag or `:latest`) in CI jobs and Dockerfiles (`MEDIUM`).
- `sec/curl-pipe-shell`: Flag `curl | bash` and `wget | sh` remote script execution in CI run steps (`CRITICAL`).
- `sec/permissions-write-all`: Flag overly broad workflow write permissions (`permissions: write-all`, `contents: write`) (`HIGH`).
- `leak/slack-webhook`: Flag hardcoded Slack and tokenized webhook URLs in workflows and code (`CRITICAL`).
- `pipe/npm-unpinned`: Flag `npm install` in CI steps without `--save-exact` or `npm ci` lockfile enforcement (`MEDIUM`).
