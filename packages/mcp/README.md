# @parasraju/plumber-mcp

Plumber as an MCP server. Give your AI coding agent a deterministic, offline scanner for leaked secrets, dead code, and AI slop — with plain-English fixes it can apply immediately.

No API keys, no network calls. The server reads files locally and returns findings over stdio.

## Run

```bash
npx -y @parasraju/plumber-mcp
```

## Configure

### Claude Code

```json
{
  "mcpServers": {
    "plumber": {
      "command": "npx",
      "args": ["-y", "@parasraju/plumber-mcp"]
    }
  }
}
```

Or from the CLI:

```bash
claude mcp add plumber -- npx -y @parasraju/plumber-mcp
```

### Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "plumber": {
      "command": "npx",
      "args": ["-y", "@parasraju/plumber-mcp"]
    }
  }
}
```

### opencode

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "plumber": {
      "type": "local",
      "command": ["npx", "-y", "@parasraju/plumber-mcp"],
      "enabled": true
    }
  }
}
```

### VS Code Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "plumber": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@parasraju/plumber-mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `plumber_scan` | Scan a local directory or file. Returns a score, grade, file count, and one line per issue with its fix. |
| `plumber_list_rules` | List all 26 inspection rules with id, severity, title, and fix. |
| `plumber_scan_text` | Scan a pasted code or config snippet. `filename` is optional and only selects the applicable rules. |

Tool inputs are deliberately small so they cost few tokens:

- `plumber_scan`: `target` (string, default `"."`)
- `plumber_list_rules`: none
- `plumber_scan_text`: `text` (string, required), `filename` (string, optional)

## Example session

> **You:** Scan this repo for leaked credentials and fix anything you find.
>
> **Agent:** *(calls `plumber_scan` with `target: "."`)*
>
> Found 1 issue in `src/config.js:14` — `[CRITICAL] Leaked OpenAI / Model API Key (Extract secret to .env file immediately.)`
>
> **Agent:** I moved the key into `.env`, replaced it with `process.env.OPENAI_API_KEY`, and added `.env` to `.gitignore`. You should revoke the exposed key.

### Scan GitHub Actions workflows

`plumber_scan` reads `.github/workflows/*.yml` and `*.yaml`. `plumber_scan_text` applies the same rules when the filename is under a `workflows` path, or when the snippet parses as a workflow (`on:` and `jobs:`).

- `sec/pull-request-target` (CRITICAL) — a `pull_request_target` workflow checks out untrusted pull request code or grants write permissions.
- `sec/expression-injection` (CRITICAL) — `${{ github.event.* }}`, `${{ github.head_ref }}`, or `${{ inputs.* }}` is interpolated into a `run` script.
- `pipe/action-unpinned` (MEDIUM) — a third-party `uses:` action is pinned to a branch or version tag instead of a full commit SHA.
- `sec/job-permissions` (HIGH) — a job that pushes, releases, or deploys has no permissions block, uses `write-all`, or sets `contents: write` where a narrower scope would do.
- `sec/secret-to-untrusted` (HIGH) — a secret is passed through `env` or an argument to a third-party action.

> **Agent:** *(calls `plumber_scan` with `target: "."` on a repo whose `.github/workflows/pr.yml` checks out the pull request head from `pull_request_target`)*
>
> `- [CRITICAL] Untrusted pull_request_target Checkout or Write Permission (Use pull_request, or check out the base ref read-only with no secrets.) — .github/workflows/pr.yml:9`

### Workflow YAML rules

- `sec/pull-request-target` [CRITICAL] Untrusted pull_request_target Checkout or Write Permission (Use pull_request, or check out the base ref read-only with no secrets.)
- `sec/expression-injection` [CRITICAL] Expression Injection in Workflow run Step (Pass the value through an env: variable and reference that variable in the script.)
- `pipe/action-unpinned` [MEDIUM] Unpinned Third-Party Action (Pin the action to a full commit SHA.)
- `sec/job-permissions` [HIGH] Job Writes Without Least-Privilege Permissions (Set least-privilege permissions on the job.)
- `sec/secret-to-untrusted` [HIGH] Secret Passed to Untrusted Step (Scope the secret to the trusted step that needs it.)

## Links

- CLI: [plumber-linter](https://www.npmjs.com/package/plumber-linter)
- Repository: [github.com/parasraju/plumber](https://github.com/parasraju/plumber)
- Model Context Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- MCP TypeScript SDK: [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)

## Changelog

## 1.1.0
- Workflow YAML rules: sec/pull-request-target, sec/expression-injection, pipe/action-unpinned, sec/job-permissions, sec/secret-to-untrusted.

## 1.0.1
- Fix false-positive test path matching that skipped secrets in files containing "test" or "spec" substrings (e.g. `latest.js`, `inspector.js`).
- Fix directory scan skipping target path when root directory name matches skip list or begins with a dot (e.g. `dist`, `.hidden`).
- Fix misleading 100/A score when target contains zero scannable files by reporting unverified status.
- Fix MCP initialize handshake reporting static version by reading dynamically from `package.json`.
