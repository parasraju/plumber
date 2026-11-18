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
| `plumber_scan` | Scan a local directory or file. Returns a score, grade, file count, and one line per issue with its fix. Optional `rulesFile`, or `.plumber-rules.json` in the target, adds a rule pack. |
| `plumber_list_rules` | List all 26 inspection rules with id, severity, title, and fix. Optional `rulesFile` appends pack rules marked `source: pack`. |
| `plumber_scan_text` | Scan a pasted code or config snippet. `filename` is optional and only selects the applicable rules. Optional `rulesFile` adds a rule pack. |
| `plumber_scan_config` | Scan one pipeline config, from a path or pasted text, and return a pass/fail verdict at `failOn` (default `HIGH`) with findings and severity counts. |

Tool inputs are deliberately small so they cost few tokens:

- `plumber_scan`: `target` (string, default `"."`), `rulesFile` (string, optional)
- `plumber_list_rules`: `rulesFile` (string, optional)
- `plumber_scan_text`: `text` (string, required), `filename` (string, optional), `rulesFile` (string, optional)
- `plumber_scan_config`: `configPath` or `configText` (string, exactly one), `configType` (string, optional, default `auto`), `rulesFile` (string, optional), `failOn` (string, optional, default `HIGH`)

### Scan one config — plumber_scan_config

`plumber_scan` reads a whole tree and `plumber_scan_text` reads a generic snippet. `plumber_scan_config` answers the question those two do not: is this one pipeline config safe to commit? To scan a config file, pass `configPath`. To check text the agent just wrote, pass `configText`. Exactly one of those is required. The tool reads local files and pasted text only. It does not fetch a URL, and it does not return a rewritten config.

`configType` is `github-actions`, `gitlab-ci`, `dockerfile`, or `auto` (the default). `auto` reads the path first: `.github/workflows/*.yml` and `*.yaml` are `github-actions`, `.gitlab-ci.yml` is `gitlab-ci`, and a name starting with `Dockerfile` is `dockerfile`. If the path does not say, the contents are checked: a line `on:` together with a line `jobs:` is `github-actions`, a `stages:` or `script:` line is `gitlab-ci`, and a first instruction of `FROM` is `dockerfile`. If that also fails, `configType` is `unknown`, `detectedBy` is `failed`, and the result says the full rule set ran. Rules stay the same 26: workflow rules run on GitHub Actions configs, and the other rules run the way they already do for that file type.

`failOn` is the CI gate. It is `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`. The default is `HIGH`, the same bar as the CLI `--fail-on high`. `verdict` is `fail` when any finding is at that severity or above. Lower findings are still listed. A clean config returns `"verdict": "pass"` and `"findings": []`. A missing rule pack is not an error.

`rulesFile` is the same local JSON pack the other tools take. With `configPath` and no `rulesFile`, `.plumber-rules.json` in the directory that contains that file is loaded when it exists. `configText` does not auto-load a pack. Pack globs match `configPath` when you pass a path. Pasted text has no path, so globs match the detected name the scanner uses for that type.

> **Agent:** *(calls `plumber_scan_config` with `{ "configPath": ".github/workflows/pr.yml" }` before committing a workflow that checks out pull request code from `pull_request_target` and uses `example/deploy@v1`)*

```json
{
  "configType": "github-actions",
  "detectedBy": "path",
  "verdict": "fail",
  "failOn": "HIGH",
  "counts": {
    "CRITICAL": 1,
    "HIGH": 0,
    "MEDIUM": 1,
    "LOW": 0
  },
  "findings": [
    {
      "rule_id": "sec/pull-request-target",
      "severity": "CRITICAL",
      "title": "Untrusted pull_request_target Checkout or Write Permission",
      "file": ".github/workflows/pr.yml",
      "line": 9,
      "evidence": "ref: ${{ github.event.pull_request.head.sha }}",
      "fix": "Use pull_request, or check out the base ref read-only with no secrets."
    },
    {
      "rule_id": "pipe/action-unpinned",
      "severity": "MEDIUM",
      "title": "Unpinned Third-Party Action",
      "file": ".github/workflows/pr.yml",
      "line": 10,
      "evidence": "- uses: example/deploy@v1",
      "fix": "Pin the action to a full commit SHA."
    }
  ]
}
```

> **Agent:** The verdict is fail. I will not commit `.github/workflows/pr.yml`. The untrusted checkout is `sec/pull-request-target`: Use pull_request, or check out the base ref read-only with no secrets. The unpinned action is `pipe/action-unpinned`: Pin the action to a full commit SHA.

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

### Custom rule packs — bring your own rules

Bring rule packs when you need custom rules the built-in set does not ship: an internal secret format, a banned pattern, or a house naming rule. A pack is one local JSON file. This release does not read YAML packs, and it does not download a pack from a URL.

The file is a top-level object `{ "rules": [...] }`. Each rule uses these fields:

- `id` (string, required) — must start with `custom/`, for example `custom/no-internal-api-key`. Any other id is rejected. An id that matches a built-in rule, or another rule in the same pack, is rejected. The built-in rule is left unchanged.
- `severity` (string, required) — one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Anything else is rejected.
- `title` (string, required) — short name, for example `Internal API key format`.
- `pattern` (string, required) — a JavaScript regular expression, matched against the file text. A pattern that does not compile rejects that rule.
- `files` (array of glob strings, optional) — for example `["**/*.js", "**/*.ts"]`. The rule runs only on files that match one of these globs. Omit it to use every file Plumber already scans. Globs support `*`, `?`, and `**`. `*` does not cross a `/`; use `**/*.js` to match JavaScript in any directory.
- `fix` (string, required) — the plain-English fix, in the same voice as the built-in rules. A rule with no fix is rejected.

On `plumber_scan`, globs only filter files the scanner already opens: `.py`, `.js`, `.jsx`, `.ts`, `.tsx`, `.html`, `.htm`, `.css`, `.scss`, `.env*`, and GitHub Actions workflow YAML. `plumber_scan_text` applies the same globs to the `filename` you pass.

A bad rule is dropped. The tool result includes a `Pack error:` line that names the rule and the problem (invalid JSON names the pack file, because there is no rule yet). The 26 built-in rules still run. A broken pack does not wipe the report and does not stop the server.

One pack is loaded, in this order:

1. `rulesFile`, when the tool call includes it. A relative path is resolved from the server's working directory.
2. Auto-load, only for `plumber_scan`, and for `plumber_scan_config` when the call passes `configPath`. Both only auto-load when `rulesFile` is omitted. Plumber reads `.plumber-rules.json` in the directory passed as `target`, or in the directory that contains `configPath`. A file target uses the directory that contains that file. Parent folders and subfolders are not searched. `plumber_scan_text`, `plumber_list_rules`, and `plumber_scan_config` with `configText` do not auto-load.
3. When both are present, `rulesFile` is the pack that runs. The two files are not merged.

The scan result names the pack on one line: the file path and how many pack rules loaded, for example `Pack: /repo/.plumber-rules.json (2 pack rules loaded)`.

`plumber_list_rules` with no `rulesFile` returns the 26 built-in rules. With `rulesFile`, the pack rules follow the built-ins and each one ends with `source: pack`.

Save this file as `.plumber-rules.json` in the directory you scan, or pass the path as `rulesFile`. The same example ships at `examples/custom-rules.example.json`.

```json
{
  "rules": [
    {
      "id": "custom/no-internal-api-key",
      "severity": "CRITICAL",
      "title": "Internal API key format",
      "pattern": "\\bINT_[A-Z0-9]{16}\\b",
      "files": ["**/*.js", "**/*.ts"],
      "fix": "Move the internal key to an environment variable and rotate it."
    },
    {
      "id": "custom/no-banned-marker",
      "severity": "MEDIUM",
      "title": "Banned ship marker",
      "pattern": "\\bDO_NOT_SHIP\\b",
      "files": ["**/*.js", "**/*.py"],
      "fix": "Remove the banned marker before committing this file."
    }
  ]
}
```

Three ways to run that pack:

1. Auto-load: write it to `.plumber-rules.json`, then call `plumber_scan` with `{ "target": "." }`.
2. `rulesFile` on `plumber_scan`: `{ "target": ".", "rulesFile": "examples/custom-rules.example.json" }`. This is the pack that runs when `.plumber-rules.json` is also present.
3. `rulesFile` on `plumber_scan_text`: `{ "text": "const internal = \"INT_ABCDEFGHIJ123456\";\n", "filename": "src/config.js", "rulesFile": "examples/custom-rules.example.json" }`. A snippet that does not match the pattern produces no pack finding.

`src/config.js` containing `INT_ABCDEFGHIJ123456` then reports:

```
- [CRITICAL] Internal API key format (Move the internal key to an environment variable and rotate it.) — src/config.js:1
```

The secret-format rule above does not check Python files. The banned-marker rule does, because its `files` list says so.

## Links

- CLI: [plumber-linter](https://www.npmjs.com/package/plumber-linter)
- Repository: [github.com/parasraju/plumber](https://github.com/parasraju/plumber)
- Model Context Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- MCP TypeScript SDK: [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)

## Changelog

## 1.3.0
New tool plumber_scan_config: scan one pipeline config file with a pass/fail verdict.

## 1.2.0
- Custom rule packs: load your own rules from `.plumber-rules.json` or a `rulesFile`, ids under `custom/`.

## 1.1.0
- Workflow YAML rules: sec/pull-request-target, sec/expression-injection, pipe/action-unpinned, sec/job-permissions, sec/secret-to-untrusted.

## 1.0.1
- Fix false-positive test path matching that skipped secrets in files containing "test" or "spec" substrings (e.g. `latest.js`, `inspector.js`).
- Fix directory scan skipping target path when root directory name matches skip list or begins with a dot (e.g. `dist`, `.hidden`).
- Fix misleading 100/A score when target contains zero scannable files by reporting unverified status.
- Fix MCP initialize handshake reporting static version by reading dynamically from `package.json`.
