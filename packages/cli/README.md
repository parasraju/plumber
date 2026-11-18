# Plumber

CI/CD pipeline linter that flags hardcoded secrets, leaked credentials, and dead code — with fixes in plain English, plus SARIF output for GitHub code scanning, workflow YAML scanning for GitHub Actions, and GitLab CI rules for .gitlab-ci.yml.

[![npm version](https://img.shields.io/npm/v/plumber-linter.svg)](https://www.npmjs.com/package/plumber-linter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/parasraju/plumber/blob/main/LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/plumber-linter.svg)](https://www.npmjs.com/package/plumber-linter)
[![Node.js](https://img.shields.io/node/v/plumber-linter.svg)](https://www.npmjs.com/package/plumber-linter)
[![CI](https://img.shields.io/github/actions/workflow/status/parasraju/plumber/plumber.yml?branch=main)](https://github.com/parasraju/plumber/actions/workflows/plumber.yml)

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

# Export report as Markdown, JSON, or SARIF 2.1.0
npx plumber-linter scan . --format md
npx plumber-linter scan . --format json
npx plumber-linter scan . --format sarif

# View all 36 inspection rules
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

### SARIF output for GitHub code scanning

`plumber scan . --format sarif` writes SARIF 2.1.0 JSON to stdout. The file contains one run for `plumber-linter` 1.5.0, every inspection rule (id, name, description, and the plain-English fix in `help.text`), and one result per finding. Each result's `message.text` repeats that finding's explanation and fix. Paths are relative to the scanned directory, and the line is included when the engine recorded one.

```bash
npx plumber-linter scan . --format sarif > results.sarif
```

Upload `results.sarif` with GitHub's `upload-sarif` action. The action name, the `sarif_file` input, and the `security-events: write` permission below are taken from GitHub's [Uploading a SARIF file to GitHub](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file) guide. `partialFingerprints` is left unset; that same action calculates it when the repository contains both the SARIF file and the scanned source.

```yaml
name: Plumber code scanning
on:
  push:
jobs:
  plumber:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      actions: read
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
      - name: Run Plumber
        run: npx plumber-linter scan . --format sarif > results.sarif
      - name: Upload SARIF file
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: results.sarif
```

### Workflow YAML scanning — scan .github/workflows/*.yml

Workflow YAML scanning checks GitHub Actions files under `.github/workflows` with the same `scan` command. Use it to scan GitHub Actions workflows for structural risks. A repository with no workflow files is unchanged: no new findings and no YAML errors.

```bash
npx plumber-linter scan .
npx plumber-linter scan .github/workflows/review.yml
```

- `sec/pull-request-target` — flags a `pull_request_target` workflow that checks out untrusted PR code or grants write permissions (`CRITICAL`).
- `sec/expression-injection` — flags `${{ github.event.* }}`, `${{ github.head_ref }}`, or another attacker-controlled context interpolated into a `run:` command (`CRITICAL`).
- `pipe/action-unpinned` — flags a `uses:` step that references a third-party action by branch or version tag instead of a full commit SHA (`MEDIUM`).
- `sec/job-permissions` — flags a job that pushes, releases, or deploys with no `permissions:` block, or with `contents: write` where a narrower scope would do (`HIGH`).
- `sec/secret-to-untrusted` — flags a secret in `env:` or an argument of a step that runs a third-party action (`HIGH`).

`.github/workflows/review.yml`:

```yaml
name: review
on:
  pull_request_target:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
```

```text
  [FILE] .github/workflows/review.yml
    L10   [CRITICAL] Untrusted pull_request_target Checkout or Write Permission
           Found: ref: ${{ github.event.pull_request.head.sha }}
           Fix:   Use pull_request, or check out the base ref read-only with no secrets.
```

### GitLab CI rules — .gitlab-ci.yml scanning

`plumber scan` checks `.gitlab-ci.yml` and `.gitlab-ci.yaml` in any directory. These five rules are a gitlab-ci.yml linter for gitlab ci security issues that the generic YAML checks do not cover. A repository with no GitLab CI file is unchanged.

| Rule | Severity | What it catches | Fix |
| --- | --- | --- | --- |
| `pipe/gitlab-include-unpinned` | MEDIUM | An `include` with a `remote` URL, or a `project` and `file` and no `ref` | Pin ref: to a full commit SHA or a tag. |
| `sec/gitlab-artifact-secret` | CRITICAL | `artifacts: paths` lists `.env`, `.env.*`, `*.pem`, `*.key`, or `id_rsa*` | Remove the file from artifacts: paths: and pass secrets via CI/CD variables. |
| `sec/gitlab-cache-shared` | MEDIUM | A `cache` with no `key`, or a key that is the same on every branch | Set an explicit per-branch key, e.g. key: $CI_COMMIT_REF_SLUG. |
| `sec/gitlab-allow-failure-gate` | MEDIUM | A job whose name contains scan, test, lint, audit, sast, secret, or security, with `allow_failure: true` | Remove allow_failure: true from the gate job (or set it false). |
| `sec/gitlab-deploy-unprotected` | HIGH | A job whose `environment` name contains `prod` and that has no `rules`, `only`, or `except` | Add rules: restricting the job to protected branches or tags (e.g. rules: - if: $CI_COMMIT_BRANCH == "main"). |

`.gitlab-ci.yml`:

```yaml
include:
  - remote: https://example.com/ci/base.yml
job:
  script:
    - echo ok
```

```text
  [FILE] .gitlab-ci.yml
    L2    [MEDIUM] Unpinned GitLab CI Include
           Found: - remote: https://example.com/ci/base.yml
           Fix:   Pin ref: to a full commit SHA or a tag.
```

A `remote` include has no `ref`. Pin the included file with `project` and a commit SHA.

```yaml
include:
  - project: group/ci-templates
    ref: 0123456789abcdef0123456789abcdef01234567
    file: /ci/base.yml
```

A scan of that pinned include reports no findings.

---

## Before / after — what plumber catches

Use this github actions workflow security example as the ci cd pipeline linter before after for one deploy job. The job commits an API key, sets permissions to write-all, and tags a third-party action.

The file in this repo is `packages/cli/examples/.github/workflows/deploy-before.yml`.

```yaml
name: deploy
on: push
permissions: write-all
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: example/action@v1
        env:
          OPENAI_API_KEY: sk-live1234567890abcdef1234567890
```

```bash
node packages/cli/bin/plumber.js scan packages/cli/examples/.github/workflows/deploy-before.yml
```

```text
  [FILE] deploy-before.yml
    L10   [CRITICAL] Leaked OpenAI / Model API Key
           Found: OPENAI_API_KEY: sk-live1234567890abcdef1234567890
           Fix:   Extract secret to .env file immediately.
    L3    [HIGH] Overly Broad Workflow Write Permissions
           Found: permissions: write-all
           Fix:   Use least-privilege permissions (e.g., permissions: { contents: read }).
    L8    [MEDIUM] Unpinned Third-Party Action
           Found: - uses: example/action@v1
           Fix:   Pin the action to a full commit SHA.
```

The fixed workflow pins that action to a 40-character SHA, moves the key to `${{ secrets.OPENAI_API_KEY }}`, and sets permissions to `contents: read`.

```yaml
name: deploy
on: push
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: example/action@0123456789abcdef0123456789abcdef01234567
      - name: publish
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: echo "$OPENAI_API_KEY"
```

A second scan of the fixed workflow exits 0 and reports no findings.

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

## 1.5.0
GitLab CI rules pack — 5 new rules for .gitlab-ci.yml (unpinned includes, artifact secrets, shared cache, allow-failure gates, unprotected deploys).

## 1.4.2
README adds a before/after GitHub Actions workflow scan and badges for monthly npm downloads, the Node.js engine, and the CI workflow on main.

## 1.4.1
`plumber scan` skips symlinks, including dangling links such as a `README.md` that points at a missing file, instead of crashing.

## 1.4.0
Workflow YAML scanning (plumber scan on .github/workflows/*.yml) — 5 workflow rules (audit-gated, see Step 1).

## 1.3.0
SARIF output (`--format sarif`) for GitHub code scanning.

## 1.2.0
- `pipe/docker-unpinned`: Flag unpinned Docker images (no tag or `:latest`) in CI jobs and Dockerfiles (`MEDIUM`).
- `sec/curl-pipe-shell`: Flag `curl | bash` and `wget | sh` remote script execution in CI run steps (`CRITICAL`).
- `sec/permissions-write-all`: Flag overly broad workflow write permissions (`permissions: write-all`, `contents: write`) (`HIGH`).
- `leak/slack-webhook`: Flag hardcoded Slack and tokenized webhook URLs in workflows and code (`CRITICAL`).
- `pipe/npm-unpinned`: Flag `npm install` in CI steps without `--save-exact` or `npm ci` lockfile enforcement (`MEDIUM`).
