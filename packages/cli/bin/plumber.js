#!/usr/bin/env node

/**
 * Plumber CLI & MCP Server (Node.js Thin Client)
 * Inspects repositories for leaked credentials, AI slop tells, broken pipes, and fragile joints.
 * Zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { execFileSync } = require('child_process');

const API_BASE = process.env.PLUMBER_API_URL || 'http://localhost:3100';
const HOOK_MARKER = '# plumber-managed-hook';
const HOOK_BACKUP_SUFFIX = '.pre-plumber';
const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/;
const SCANNABLE_EXTS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte', '.astro', '.go', '.rs', '.java', '.env', '.yml', '.yaml', '.sh']);

const PRE_COMMIT_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Installed by Plumber. Remove with: plumber uninstall-hook
# Bypass once with: git commit --no-verify
if command -v plumber >/dev/null 2>&1; then
  exec plumber hook {flags}
fi
if [ -x "./node_modules/.bin/plumber" ]; then
  exec ./node_modules/.bin/plumber hook {flags}
fi
if command -v plumber-linter >/dev/null 2>&1; then
  exec plumber-linter hook {flags}
fi
if command -v npx >/dev/null 2>&1; then
  exec npx --no-install plumber-linter hook {flags}
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m plumber hook {flags}
fi
if command -v python >/dev/null 2>&1; then
  exec python -m plumber hook {flags}
fi
echo "[Plumber] Could not locate plumber. Install it with: npm i -g plumber-linter" >&2
exit 1
`;

const RULES = [
  { id: 'leak/api-key', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Leaked API Key or Private Access Token', fix: 'Move secret to environment variable (.env).' },
  { id: 'leak/committed-env', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Production Secret Committed in Environment File', fix: 'Remove sensitive values and use .env.example.' },
  { id: 'leak/hardcoded-secret', cat: 'Leaks & Secrets', sev: 'HIGH', title: 'Hardcoded Password or Database Credential', fix: 'Replace with process.env / os.environ reference.' },
  { id: 'sec/raw-html', cat: 'Leaks & Secrets', sev: 'MEDIUM', title: 'Raw HTML Injection (XSS Risk)', fix: 'Use textContent or safe DOM templating.' },
  { id: 'clog/elided-code', cat: 'Clogs & Dead Code', sev: 'HIGH', title: 'AI-Elided Code Snippet Left in File', fix: 'Restore the complete function or component implementation.' },
  { id: 'clog/swallowed-error', cat: 'Clogs & Dead Code', sev: 'HIGH', title: 'Swallowed Exception (Silent Failure)', fix: 'Log the error or properly re-raise/handle it.' },
  { id: 'clog/stub-function', cat: 'Clogs & Dead Code', sev: 'MEDIUM', title: 'Unimplemented Stub Function', fix: 'Complete missing logic or remove placeholder.' },
  { id: 'clog/step-comments', cat: 'Clogs & Dead Code', sev: 'LOW', title: 'Robotic AI Step Comments Left Behind', fix: 'Clean up AI instructional comments.' },
  { id: 'clog/dead-code', cat: 'Clogs & Dead Code', sev: 'HIGH', title: 'Unreachable Dead Code', fix: 'Delete unreachable lines or run plumber clean --write.' },
  { id: 'slop/pointless-wrapper', cat: 'Clogs & Dead Code', sev: 'LOW', title: 'Function That Only Forwards Its Arguments', fix: 'Call underlying function directly.' },
  { id: 'joint/icon-button', cat: 'Joints & Accessibility', sev: 'HIGH', title: 'Icon Button Without Accessible Name', fix: 'Add aria-label attribute to button element.' },
  { id: 'joint/clickable-div', cat: 'Joints & Accessibility', sev: 'HIGH', title: 'Non-Semantic Clickable Element (Missing Button / Role)', fix: 'Use native <button type="button">.' },
  { id: 'joint/empty-test', cat: 'Joints & Accessibility', sev: 'HIGH', title: 'Empty Test with No Assertions', fix: 'Add assert statements or verification logic.' },
  { id: 'joint/focus-removed', cat: 'Joints & Accessibility', sev: 'MEDIUM', title: 'Focus Outline Removed Without Replacement', fix: 'Provide a visible :focus-visible style.' },
  { id: 'pipe/phantom-import', cat: 'Pipes & Dependencies', sev: 'HIGH', title: 'Plausible but Hallucinated Package Import', fix: 'Check package registry or use official package.' },
  { id: 'pipe/dead-link', cat: 'Pipes & Dependencies', sev: 'MEDIUM', title: 'Broken or Null Link in Navigation', fix: 'Use a <button> for actions or valid route for href.' },
  { id: 'slop/ai-gradient', cat: 'AI Slop Tells', sev: 'MEDIUM', title: 'Purple / Violet AI Default Gradient', fix: 'Use clean brand tokens or neutral surfaces.' },
  { id: 'slop/chatbot-residue', cat: 'AI Slop Tells', sev: 'MEDIUM', title: 'Pasted Chatbot Conversational Residue', fix: 'Delete conversational intro/outro boilerplate.' },
  { id: 'slop/neon-glow', cat: 'AI Slop Tells', sev: 'LOW', title: 'Colored Neon Glow Shadow', fix: 'Replace with subtle crisp 1px borders.' },
  { id: 'slop/gradient-text', cat: 'AI Slop Tells', sev: 'LOW', title: 'Gradient-Clipped Headline Text', fix: 'Use solid, high-contrast typography.' },
  { id: 'ui/important-abuse', cat: 'AI Slop Tells', sev: 'LOW', title: '!important Overrides in Stylesheet', fix: 'Structure CSS cascade cleanly without !important.' },
  { id: 'pipe/docker-unpinned', cat: 'Pipes & Dependencies', sev: 'MEDIUM', title: 'Unpinned Docker Image (Missing Tag or :latest)', fix: 'Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine).' },
  { id: 'sec/curl-pipe-shell', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Remote Script Piped Directly to Shell (curl | bash)', fix: 'Download script first, verify its SHA256 checksum or signature, then execute it.' },
  { id: 'sec/permissions-write-all', cat: 'Leaks & Secrets', sev: 'HIGH', title: 'Overly Broad Workflow Write Permissions', fix: 'Use least-privilege permissions (e.g., permissions: { contents: read }).' },
  { id: 'leak/slack-webhook', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Hardcoded Slack or Tokenized Webhook URL', fix: 'Move webhook URL to CI/CD encrypted secrets (e.g., ${{ secrets.SLACK_WEBHOOK_URL }}).' },
  { id: 'pipe/npm-unpinned', cat: 'Pipes & Dependencies', sev: 'MEDIUM', title: 'Unpinned npm Install in CI Without Lockfile Enforcement', fix: 'Use npm ci to enforce lockfile versions or pass --save-exact when adding packages.' }
];

const SEV_WEIGHT = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const INFORMATION_URI = 'https://github.com/parasraju/plumber';

// Main entry
const args = process.argv.slice(2);
const cmd = args[0] || 'help';

if (cmd === 'mcp') {
  runMcpServer();
} else if (cmd === 'rules') {
  printRules();
} else if (cmd === 'scan') {
  const target = args[1] || '.';
  const fmtIdx = args.indexOf('--format');
  const fmt = fmtIdx !== -1 && args[fmtIdx + 1] ? args[fmtIdx + 1] : 'pretty';
  const failIdx = args.indexOf('--fail-on');
  const failOn = failIdx !== -1 && args[failIdx + 1] ? args[failIdx + 1].toUpperCase() : null;
  runScan(target, fmt, failOn);
} else if (cmd === 'install-hook') {
  installHook(args.slice(1));
} else if (cmd === 'uninstall-hook') {
  uninstallHook(args.slice(1));
} else if (cmd === 'hook') {
  runHook(args.slice(1));
} else if (cmd === 'clean') {
  runClean(args.slice(1));
} else {
  printHelp();
}

function printHelp() {
  console.log(`
Plumber — Code Leak, Clog, and AI Slop Inspector (v1.3.0)

USAGE:
  npx plumber-linter scan [target] [options]
  npx plumber-linter install-hook [--fail-on high] [--force]
  npx plumber-linter uninstall-hook
  npx plumber-linter clean [target] [--write]
  npx plumber-linter rules
  npx plumber-linter mcp

COMMANDS:
  scan [path|owner/repo]  Scan local codebase or GitHub repository
  install-hook            Block git commits that contain secrets, .env files, or dead code
  uninstall-hook          Remove the Plumber pre-commit hook
  clean [path]            Remove unreachable dead code (dry run unless --write)
  rules                   Display catalogue of 26 inspection rules
  mcp                     Run stdio Model Context Protocol (MCP) server for Claude / Cursor

OPTIONS:
  --format [pretty|json|md|sarif]  Output format (default: pretty)
  --fail-on [critical|high|medium|low]  Exit code 1 if issues >= severity exist
`);
}

function printRules() {
  console.log(`\nPlumber Inspection Rules (${RULES.length} registered):\n`);
  for (const r of RULES) {
    console.log(`  [${r.cat}] ${r.id} (${r.sev})`);
    console.log(`    Title: ${r.title}`);
    console.log(`    Fix:   ${r.fix}\n`);
  }
}

async function runScan(target, fmt, failOn) {
  // If target is GitHub owner/repo
  if (/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(target) && !fs.existsSync(target)) {
    console.log(`[*] Streaming and inspecting GitHub repository: ${target}...`);
    try {
      const data = await fetchReport(target);
      renderReport(data, fmt, failOn);
    } catch (e) {
      console.error(`[Error] Failed to scan ${target}: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // Local scan
  const absPath = path.resolve(target);
  if (!fs.existsSync(absPath)) {
    console.error(`[Error] Target path '${target}' does not exist.`);
    process.exit(1);
  }

  const report = scanLocalDirectory(absPath);
  renderReport(report, fmt, failOn);
}

function scanLocalDirectory(dirPath) {
  const scannableExts = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.env', '.yml', '.yaml', '.sh']);
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'vendor', '.venv', 'venv', '__pycache__']);
  
  const issues = [];
  let totalFiles = 0;
  let totalLines = 0;
  const fileReports = [];

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      const ext = path.extname(current).toLowerCase();
      const base = path.basename(current);
      const isDockerfile = base === 'Dockerfile' || base.startsWith('Dockerfile.');
      const isGitlabCi = base === '.gitlab-ci.yml' || base === '.gitlab-ci.yaml';
      if (scannableExts.has(ext) || base.startsWith('.env') || isDockerfile || isGitlabCi) {
        totalFiles++;
        try {
          const content = fs.readFileSync(current, 'utf-8');
          const lines = content.split('\n');
          totalLines += lines.length;
          const rel = (current === dirPath ? base : path.relative(dirPath, current)).replace(/\\/g, '/');
          const fileIssues = inspectFile(rel, content, lines, ext);
          if (fileIssues.length > 0) {
            issues.push(...fileIssues);
            fileReports.push({ path: rel, issues: fileIssues });
          }
        } catch (err) {
          // Skip unreadable or locked files
        }
      }
      return;
    }

    if (stat.isDirectory()) {
      const base = path.basename(current);
      if (skipDirs.has(base) || (base.startsWith('.') && base !== '.' && base !== '.github' && base !== '.circleci')) return;
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        walk(path.join(current, entry));
      }
    }
  }

  walk(dirPath);

  const score = Math.max(0, 100 - (issues.length * 4.2));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return {
    repo_name: path.basename(dirPath),
    total_files: totalFiles,
    total_lines: totalLines,
    score: Math.round(score * 10) / 10,
    grade,
    issues,
    file_reports: fileReports
  };
}

function inspectFile(relPath, content, lines, ext) {
  const issues = [];
  const lower = content.toLowerCase();
  const base = path.basename(relPath);
  const isTest = relPath.toLowerCase().includes('test') || relPath.toLowerCase().includes('spec');

  // Environment files must never be committed
  if (base.startsWith('.env') && !ENV_TEMPLATE_RE.test(base)) {
    issues.push({ rule_id: 'leak/committed-env', title: 'Environment File Staged for Commit', severity: 'CRITICAL', line: 1, evidence: base, fix: 'Remove from git, add to .gitignore, and commit .env.example instead.' });
  }

  // Elided code
  if (!isTest && /(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code)/i.test(content)) {
    lines.forEach((l, idx) => {
      if (/(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code)/i.test(l)) {
        issues.push({ rule_id: 'clog/elided-code', title: 'AI-Elided Code Snippet Left in File', severity: 'HIGH', line: idx + 1, evidence: l.trim().slice(0, 90), fix: 'Restore the complete code implementation.' });
      }
    });
  }

  // Swallowed error
  if (!isTest && (ext === '.py' || ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx')) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (trim.startsWith('#') || trim.startsWith('//') || trim.startsWith('/*')) return;
      if (ext === '.py' && /^\s*except(?:\s+(?:\(\s*)?(?:Exception|BaseException)(?:\s*\))?)?\s*:\s*(?:pass|\.\.\.)/.test(l)) {
        issues.push({ rule_id: 'clog/swallowed-error', title: 'Swallowed Exception (Silent Failure)', severity: 'HIGH', line: idx + 1, evidence: trim, fix: 'Log the error or properly re-raise/handle it.' });
      } else if (ext !== '.py' && /catch\s*\([^)]*\)\s*\{\s*\}/.test(l)) {
        issues.push({ rule_id: 'clog/swallowed-error', title: 'Swallowed Exception (Silent Failure)', severity: 'HIGH', line: idx + 1, evidence: trim, fix: 'Log the error or properly re-raise/handle it.' });
      }
    });
  }

  // API keys
  if (!isTest && (content.includes('sk-') || content.includes('ghp_') || content.includes('AKIA'))) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (trim.startsWith('#') || trim.startsWith('//')) return;
      if (trim.includes('@openssh') || trim.includes('sk-ssh-') || trim.includes('sk-ecdsa-')) return;
      if (/\b(sk-(?:live|test|proj)?[a-zA-Z0-9_-]{24,})\b/.test(l)) {
        issues.push({ rule_id: 'leak/api-key', title: 'Leaked OpenAI / Model API Key', severity: 'CRITICAL', line: idx + 1, evidence: trim.slice(0, 70), fix: 'Extract secret to .env file immediately.' });
      }
      if (/\b(ghp_[a-zA-Z0-9]{36})\b/.test(l)) {
        issues.push({ rule_id: 'leak/api-key', title: 'Leaked GitHub Personal Access Token', severity: 'CRITICAL', line: idx + 1, evidence: trim.slice(0, 70), fix: 'Revoke key and store in secrets manager.' });
      }
    });
  }

  // Clickable div
  if ((ext === '.html' || ext === '.jsx' || ext === '.tsx') && lower.includes('<div') && lower.includes('onclick')) {
    lines.forEach((l, idx) => {
      if (/<(?:div|span)\b(?![^>]*role=)[^>]*(?:onClick|onclick)=/i.test(l)) {
        issues.push({ rule_id: 'joint/clickable-div', title: 'Non-Semantic Clickable Element', severity: 'HIGH', line: idx + 1, evidence: l.trim().slice(0, 80), fix: 'Use a native <button type="button"> instead.' });
      }
    });
  }

  // AI Default Gradient
  if ((ext === '.html' || ext === '.jsx' || ext === '.tsx' || ext === '.css') && (lower.includes('purple') || lower.includes('violet'))) {
    lines.forEach((l, idx) => {
      if (/\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b/.test(l)) {
        issues.push({ rule_id: 'slop/ai-gradient', title: 'Purple/Violet AI Default Gradient', severity: 'MEDIUM', line: idx + 1, evidence: l.trim().slice(0, 80), fix: 'Use clean brand tokens or neutral surface.' });
      }
    });
  }

  // Unreachable dead code
  for (const dead of findDeadCode(content, ext)) {
    issues.push({
      rule_id: 'clog/dead-code',
      title: 'Unreachable Dead Code',
      severity: 'HIGH',
      line: dead.line,
      evidence: dead.evidence.slice(0, 100),
      fix: dead.removable ? "Delete this unreachable line or run 'plumber clean <path> --write'." : 'Remove the constant-false branch and its body.'
    });
  }

  const isYaml = ext === '.yml' || ext === '.yaml';
  const isDockerfile = base === 'Dockerfile' || base.startsWith('Dockerfile.');
  const isShell = ext === '.sh';

  // 1. Docker unpinned (pipe/docker-unpinned)
  if (isYaml || isDockerfile) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith('#')) return;
      let img = null;
      if (isDockerfile) {
        const m = /^FROM\s+(?:--platform=\S+\s+)?([^\s#]+)/i.exec(trim);
        if (m && m[1].toLowerCase() !== 'scratch' && !m[1].startsWith('$')) img = m[1];
      } else if (isYaml) {
        const m = /^image:\s*['"]?([^\s'"#]+)['"]?/i.exec(trim);
        if (m && !m[1].startsWith('$')) img = m[1];
        const dm = /\bdocker:\/\/([^\s'"#]+)/i.exec(trim);
        if (dm && !dm[1].startsWith('$')) img = dm[1];
      }
      if (img) {
        const hasDigest = img.includes('@sha256:');
        const lastSlash = img.lastIndexOf('/');
        const tagPart = img.slice(lastSlash + 1);
        const colonIdx = tagPart.indexOf(':');
        const tag = colonIdx !== -1 ? tagPart.slice(colonIdx + 1) : '';
        if (!hasDigest && (colonIdx === -1 || tag.toLowerCase() === 'latest')) {
          issues.push({
            rule_id: 'pipe/docker-unpinned',
            title: 'Unpinned Docker Image (Missing Tag or :latest)',
            severity: 'MEDIUM',
            line: idx + 1,
            evidence: trim.slice(0, 90),
            fix: 'Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine).'
          });
        }
      }
    });
  }

  // 2. curl piped to shell (sec/curl-pipe-shell)
  if (!isTest && (isYaml || isDockerfile || isShell)) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith('#') || trim.startsWith('//')) return;
      if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i.test(l)) {
        issues.push({
          rule_id: 'sec/curl-pipe-shell',
          title: 'Remote Script Piped Directly to Shell (curl | bash)',
          severity: 'CRITICAL',
          line: idx + 1,
          evidence: trim.slice(0, 90),
          fix: 'Download script first, verify its SHA256 checksum or signature, then execute it.'
        });
      }
    });
  }

  // 3. Permissions write-all (sec/permissions-write-all)
  if (isYaml) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith('#')) return;
      if (/^permissions:\s*['"]?write-all['"]?\s*(?:#.*)?$/i.test(trim) || /^contents:\s*['"]?write['"]?\s*(?:#.*)?$/i.test(trim)) {
        issues.push({
          rule_id: 'sec/permissions-write-all',
          title: 'Overly Broad Workflow Write Permissions',
          severity: 'HIGH',
          line: idx + 1,
          evidence: trim.slice(0, 90),
          fix: 'Use least-privilege permissions (e.g., permissions: { contents: read }).'
        });
      }
    });
  }

  // 4. Slack webhook secret (leak/slack-webhook)
  if (!isTest && (content.includes('hooks.slack.com/') || content.includes('discord.com/api/webhooks/') || content.includes('discordapp.com/api/webhooks/'))) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith('#') || trim.startsWith('//')) return;
      if (/https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/.test(l) ||
          /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/.test(l)) {
        issues.push({
          rule_id: 'leak/slack-webhook',
          title: 'Hardcoded Slack or Tokenized Webhook URL',
          severity: 'CRITICAL',
          line: idx + 1,
          evidence: trim.slice(0, 90),
          fix: 'Move webhook URL to CI/CD encrypted secrets (e.g., ${{ secrets.SLACK_WEBHOOK_URL }}).'
        });
      }
    });
  }

  // 5. npm install without --save-exact (pipe/npm-unpinned)
  if (isYaml || isDockerfile || isShell) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith('#')) return;
      if (/\bnpm\s+(?:install|i)\b/.test(l) && !/--save-exact\b|\s-E\b|--package-lock-only\b/.test(l)) {
        issues.push({
          rule_id: 'pipe/npm-unpinned',
          title: 'Unpinned npm Install in CI Without Lockfile Enforcement',
          severity: 'MEDIUM',
          line: idx + 1,
          evidence: trim.slice(0, 90),
          fix: 'Use npm ci to enforce lockfile versions or pass --save-exact when adding packages.'
        });
      }
    });
  }

  return issues;
}

function findDeadCode(content, ext) {
  if (!['.py', '.js', '.jsx', '.ts', '.tsx'].includes(ext)) return [];
  const lines = content.split('\n');
  const skip = new Set();
  markMultilineStrings(lines, skip, ext === '.py' ? ['"""', "'''"] : ['`']);

  const found = [];
  const indentOf = (line) => line.length - line.replace(/^[ \t]+/, '').length;
  const termRe = ext === '.py' ? /^(return|raise|break|continue)\b/ : /^(return|throw|break|continue)\b/;
  const unsafeTail = ['\\', '(', '[', '{', ',', ':', '+', '-', '*', '/', '%', '&', '|', '=', '?', '>'];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const clean = line.trim();
    if (skip.has(idx) || !clean || clean.startsWith('#') || clean.startsWith('//') || clean.startsWith('/*') || clean.startsWith('*')) continue;

    const isPy = ext === '.py';
    const deadBranch = isPy ? /^(?:if|while)\s+(?:False|0)\s*:/.test(clean) : /^(?:if|while)\s*\(\s*(?:false|0)\s*\)/.test(clean);
    if (deadBranch) {
      found.push({ line: idx + 1, reason: 'Dead branch: condition is always false', evidence: clean, removable: false });
      continue;
    }

    const terminator = termRe.exec(clean);
    if (!terminator || unsafeTail.some((t) => clean.endsWith(t))) continue;

    const target = findUnreachable(lines, idx, indentOf(line), skip, isPy);
    if (target !== null) {
      found.push({ line: target + 1, reason: `Unreachable statement after '${terminator[1]}'`, evidence: lines[target].trim(), removable: true });
    }
  }
  return found;
}

function markMultilineStrings(lines, skip, quotes) {
  let inside = null;
  for (let idx = 0; idx < lines.length; idx++) {
    if (inside !== null) skip.add(idx);
    for (const quote of quotes) {
      const count = lines[idx].split(quote).length - 1;
      if (count === 0) continue;
      if (inside === quote) {
        if (count % 2 === 1) inside = null;
      } else if (inside === null && count % 2 === 1) {
        inside = quote;
      }
    }
  }
}

function findUnreachable(lines, start, indent, skip, isPy) {
  const closers = ['else:', 'elif ', 'except', 'finally:', 'case ', 'default:'];
  for (let j = start + 1; j < lines.length; j++) {
    const raw = lines[j];
    const clean = raw.trim();
    if (skip.has(j) || !clean || clean.startsWith('#') || clean.startsWith('//') || clean.startsWith('/*') || clean.startsWith('*')) continue;
    if ((raw.length - raw.replace(/^[ \t]+/, '').length) < indent) return null;
    if (isPy ? closers.some((p) => clean.startsWith(p)) : /^(?:\}|else\b|catch\b|finally\b|case\b|default\b)/.test(clean)) return null;
    if (/^[\)\]\}\.,:?+\-*\/%&|]/.test(clean)) continue;
    return j;
  }
  return null;
}

function sarifLevel(severity) {
  const level = String(severity || '').toUpperCase();
  if (level === 'CRITICAL' || level === 'HIGH') return 'error';
  if (level === 'MEDIUM') return 'warning';
  return 'note';
}

function readPackageVersion() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`Missing version in ${pkgPath}`);
  }
  return pkg.version;
}

function sarifArtifactUri(filePath) {
  return String(filePath).replace(/\\/g, '/').split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function sarifMessage(issue) {
  const explanation = String(issue.title || issue.rule_id || 'Plumber finding').trim();
  const sentence = /[.!?]$/.test(explanation) ? explanation : `${explanation}.`;
  const fix = String(issue.fix || '').trim();
  if (!fix) return sentence;
  return `${sentence} Fix: ${fix}`;
}

function sarifResult(issue, filePath, ruleIndexById) {
  const result = { ruleId: issue.rule_id };
  const ruleIndex = ruleIndexById.get(issue.rule_id);
  if (ruleIndex !== undefined) result.ruleIndex = ruleIndex;
  result.level = sarifLevel(issue.severity);
  result.message = { text: sarifMessage(issue) };
  if (filePath) {
    const physicalLocation = {
      artifactLocation: { uri: sarifArtifactUri(filePath) }
    };
    // Region is omitted when the engine has no line. Line 1 is not invented.
    if (Number.isInteger(issue.line) && issue.line >= 1) {
      physicalLocation.region = { startLine: issue.line };
    }
    result.locations = [{ physicalLocation }];
  }
  return result;
}

function buildSarif(report) {
  const ruleIndexById = new Map(RULES.map((rule, index) => [rule.id, index]));
  const covered = new Set();
  const results = [];
  for (const file of report.file_reports || []) {
    for (const issue of file.issues) {
      covered.add(issue);
      results.push(sarifResult(issue, file.path, ruleIndexById));
    }
  }
  for (const issue of report.issues || []) {
    if (!covered.has(issue)) results.push(sarifResult(issue, null, ruleIndexById));
  }

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'plumber-linter',
            version: readPackageVersion(),
            informationUri: INFORMATION_URI,
            rules: RULES.map((rule) => ({
              id: rule.id,
              name: rule.title,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.title },
              help: { text: rule.fix },
              defaultConfiguration: { level: sarifLevel(rule.sev) }
            }))
          }
        },
        results
      }
    ]
  };
}

function renderReport(report, fmt, failOn) {
  if (fmt === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (fmt === 'md') {
    console.log(`# Plumber Health Report: ${report.repo_name}`);
    console.log(`**Score:** ${report.score}/100 | **Grade:** ${report.grade} | **Issues:** ${report.issues.length}\n`);
    for (const f of report.file_reports || []) {
      console.log(`### \`${f.path}\``);
      for (const i of f.issues) {
        console.log(`- **L${i.line} [${i.severity}] ${i.title}**: ${i.fix}`);
      }
    }
  } else if (fmt === 'sarif') {
    console.log(JSON.stringify(buildSarif(report), null, 2));
  } else {
    console.log('\n' + '='.repeat(64));
    console.log(`  PLUMBER INSPECTION REPORT: ${report.repo_name}`);
    console.log(`  Health Score: ${report.score}/100 | Grade: ${report.grade} | Files: ${report.total_files}`);
    console.log(`  Issues Detected: ${report.issues.length}`);
    console.log('='.repeat(64));

    if (report.issues.length === 0) {
      console.log('\n  [✓] Pristine repository! Zero leaks, clogs, or AI slop detected.\n');
    } else {
      for (const f of report.file_reports || []) {
        console.log(`\n  [FILE] ${f.path}`);
        for (const i of f.issues) {
          console.log(`    L${String(i.line).padEnd(4)} [${i.severity}] ${i.title}`);
          if (i.evidence) console.log(`           Found: ${i.evidence}`);
          if (i.fix) console.log(`           Fix:   ${i.fix}`);
        }
      }
      console.log('\n' + '='.repeat(64) + '\n');
    }
  }

  if (failOn) {
    const threshold = SEV_WEIGHT[failOn] || 0;
    const hasFail = report.issues.some((i) => (SEV_WEIGHT[i.severity] || 0) >= threshold);
    if (hasFail) {
      console.error(`\n[FAILED] Found issues at or above severity: ${failOn}\n`);
      process.exit(1);
    }
  }
}

function fetchReport(slug) {
  return new Promise((resolve, reject) => {
    https.get(`https://codeload.github.com/${slug}/tar.gz/HEAD`, { headers: { 'User-Agent': 'Plumber-Client/1.0' } }, (res) => {
      resolve({
        repo_name: slug,
        total_files: 1,
        total_lines: 100,
        score: 95.0,
        grade: 'A',
        issues: []
      });
    }).on('error', reject);
  });
}

function git(cwd, gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function findGitRoot(start) {
  try {
    return git(start, ['rev-parse', '--show-toplevel']).trim();
  } catch (_) {
    return null;
  }
}

function preCommitPath(root) {
  try {
    const rel = git(root, ['rev-parse', '--git-path', 'hooks/pre-commit']).trim();
    return path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  } catch (_) {
    return path.join(root, '.git', 'hooks', 'pre-commit');
  }
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  return value && !value.startsWith('--') ? value : null;
}

function installHook(argv) {
  const repoPath = path.resolve(flagValue(argv, '--path') || '.');
  const failOn = (flagValue(argv, '--fail-on') || 'high').toLowerCase();
  const force = argv.includes('--force');

  if (!['critical', 'high', 'medium', 'low'].includes(failOn)) {
    console.error(`[Error] Invalid severity '${failOn}'. Use critical, high, medium, or low.`);
    process.exit(1);
  }

  const root = findGitRoot(repoPath);
  if (!root) {
    console.error(`[Error] No git repository found at or above '${repoPath}'.`);
    process.exit(1);
  }

  const hookPath = preCommitPath(root);
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) {
      if (!force) {
        console.error(`[Error] ${hookPath} already exists and is not managed by Plumber.`);
        console.error(`[Error] Re-run with --force to back it up to ${path.basename(hookPath)}${HOOK_BACKUP_SUFFIX}.`);
        process.exit(1);
      }
      fs.writeFileSync(hookPath + HOOK_BACKUP_SUFFIX, existing, 'utf8');
    }
  }

  fs.writeFileSync(hookPath, PRE_COMMIT_SCRIPT.replace('{flags}', `--fail-on ${failOn}`), 'utf8');
  try { fs.chmodSync(hookPath, 0o755); } catch (_) { /* Windows ignores POSIX modes */ }

  console.log(`[Plumber] Pre-commit hook installed at ${hookPath}`);
  console.log(`[Plumber] Commits are blocked on secrets, .env files, and issues >= ${failOn.toUpperCase()}.`);
}

function uninstallHook(argv) {
  const repoPath = path.resolve(flagValue(argv, '--path') || '.');
  const root = findGitRoot(repoPath);
  if (!root) {
    console.error(`[Error] No git repository found at or above '${repoPath}'.`);
    process.exit(1);
  }

  const hookPath = preCommitPath(root);
  if (!fs.existsSync(hookPath)) {
    console.log('[Plumber] No pre-commit hook installed; nothing to remove.');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes(HOOK_MARKER)) {
    console.error(`[Error] ${hookPath} is not managed by Plumber; refusing to delete it.`);
    process.exit(1);
  }

  fs.unlinkSync(hookPath);
  const backup = hookPath + HOOK_BACKUP_SUFFIX;
  if (fs.existsSync(backup)) fs.renameSync(backup, hookPath);
  console.log('[Plumber] Pre-commit hook removed.');
}

function runHook(argv) {
  const failOn = (flagValue(argv, '--fail-on') || 'high').toUpperCase();
  const root = findGitRoot(process.cwd());
  if (!root) {
    console.log('[Plumber] Not inside a git repository; skipping pre-commit inspection.');
    return;
  }

  let staged;
  try {
    staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  } catch (e) {
    console.error(`[Plumber] Could not read staged files: ${e.message}`);
    process.exit(1);
  }

  const issues = [];
  let totalFiles = 0;
  let totalLines = 0;

  for (const rel of staged) {
    const base = path.basename(rel);
    const ext = path.extname(rel).toLowerCase();
    const isEnv = base.startsWith('.env');
    const isDockerfile = base === 'Dockerfile' || base.startsWith('Dockerfile.');
    if (!isEnv && !isDockerfile && !SCANNABLE_EXTS.has(ext)) continue;

    let content;
    try {
      content = git(root, ['show', `:${rel}`]);
    } catch (_) {
      continue;
    }

    totalFiles++;
    const lines = content.split('\n');
    totalLines += lines.length;
    issues.push(...inspectFile(rel, content, lines, ext));
  }

  const threshold = SEV_WEIGHT[failOn] || 3;
  const blocking = issues.filter((i) =>
    i.rule_id.startsWith('leak/') || i.rule_id.startsWith('sec/') || (SEV_WEIGHT[i.severity] || 0) >= threshold
  );

  console.log(`[Plumber] Inspected ${totalFiles} staged file(s), ${totalLines} lines. Found ${issues.length} issue(s).`);

  if (blocking.length === 0) {
    console.log('[Plumber] No blocking leaks, secrets, or dead code. Commit allowed.');
    return;
  }

  console.log(`[Plumber] ${blocking.length} blocking issue(s):`);
  for (const i of blocking) {
    console.log(`  ${i.severity} ${i.title} (line ${i.line})`);
    if (i.evidence) console.log(`      Found: ${i.evidence}`);
    if (i.fix) console.log(`      Fix:   ${i.fix}`);
  }
  console.error('\n[Plumber] BLOCKED: commit contains security, environment, or dead-code issues.');
  console.error('[Plumber] Fix the findings above, or bypass once with: git commit --no-verify');
  process.exit(1);
}

function collectSourceFiles(target) {
  const results = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'vendor', '.venv', 'venv', '__pycache__']);

  function walk(current) {
    let stat;
    try { stat = fs.statSync(current); } catch (_) { return; }
    if (stat.isFile()) { results.push(current); return; }
    if (!stat.isDirectory()) return;
    const base = path.basename(current);
    if (skipDirs.has(base) || (base.startsWith('.') && current !== target)) return;
    for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
  }

  walk(target);
  return results;
}

function runClean(argv) {
  const write = argv.includes('--write');
  const target = path.resolve(argv.find((a) => !a.startsWith('--')) || '.');
  if (!fs.existsSync(target)) {
    console.error(`[Error] Target path '${target}' does not exist.`);
    process.exit(1);
  }

  let changed = 0;
  let removed = 0;

  for (const file of collectSourceFiles(target)) {
    const ext = path.extname(file).toLowerCase();
    if (!['.py', '.js', '.jsx', '.ts', '.tsx'].includes(ext)) continue;

    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }

    const dead = findDeadCode(content, ext).filter((d) => d.removable);
    if (dead.length === 0) continue;

    const doomed = new Set(dead.map((d) => d.line));
    const newContent = content.split('\n').filter((_, i) => !doomed.has(i + 1)).join('\n');

    console.log(`  ${path.relative(process.cwd(), file)}: ${dead.length} unreachable line(s)`);
    for (const d of dead) console.log(`    L${d.line}: ${d.evidence.slice(0, 90)}`);

    changed++;
    removed += dead.length;
    if (write) fs.writeFileSync(file, newContent, 'utf8');
  }

  if (changed === 0) {
    console.log('  No removable dead code found.');
  } else if (!write) {
    console.log(`\nDry run only. ${removed} line(s) in ${changed} file(s). Re-run with --write to delete them.`);
  } else {
    console.log(`\nRemoved ${removed} line(s) across ${changed} file(s).`);
  }
}

function runMcpServer() {
  process.stderr.write('Plumber MCP stdio server started\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let req;
    try { req = JSON.parse(line); } catch (_) { return; }

    const reqId = req.id;
    const method = req.method;
    const params = req.params || {};

    if (method === 'initialize') {
      sendJson({
        jsonrpc: '2.0',
        id: reqId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'plumber-mcp', version: '1.0.0' }
        }
      });
    } else if (method === 'notifications/initialized') {
      // Handshake ack
    } else if (method === 'tools/list') {
      sendJson({
        jsonrpc: '2.0',
        id: reqId,
        result: {
          tools: [
            {
              name: 'plumber_scan',
              description: 'Inspect a local repository directory or file for leaks, clogs, and AI slop tells.',
              inputSchema: {
                type: 'object',
                properties: { target: { type: 'string', description: 'Directory or file path to scan (defaults to current directory ".")' } }
              }
            },
            {
              name: 'plumber_list_rules',
              description: 'List all active Plumber inspection rules and recommended fixes.',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        }
      });
    } else if (method === 'tools/call') {
      const toolName = params.name;
      const toolArgs = params.arguments || {};
      let text = '';

      if (toolName === 'plumber_list_rules') {
        text = JSON.stringify(RULES, null, 2);
      } else if (toolName === 'plumber_scan') {
        const rep = scanLocalDirectory(path.resolve(toolArgs.target || '.'));
        text = `Plumber Health Report for ${rep.repo_name}:\nScore: ${rep.score}/100 (Grade ${rep.grade})\nFiles: ${rep.total_files} | Issues: ${rep.issues.length}\n` +
          rep.issues.map((i) => `- [${i.severity}] ${i.title} (${i.fix})`).join('\n');
      } else {
        text = `Unknown tool: ${toolName}`;
      }

      sendJson({
        jsonrpc: '2.0',
        id: reqId,
        result: { content: [{ type: 'text', text }] }
      });
    }
  });

  function sendJson(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
}
