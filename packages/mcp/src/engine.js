/**
 * Plumber inspection engine.
 *
 * Ported from plumber-linter v1.1.2
 * (packages/cli/bin/plumber.js, commit bde61c5), with two additions:
 *   - leak/api-key now matches AWS access key IDs (AKIA...).
 *   - leak/hardcoded-secret now matches quoted password/token assignments.
 * Both rule IDs already exist in the CLI's RULES table; the CLI declares them
 * but does not detect them. The CLI itself is left untouched.
 *
 * This is a copy rather than a shared import because the published CLI package
 * ships only `bin/` and `README.md`, so a relative import from the MCP package
 * would break `plumber-linter` for npm consumers. The CLI is intentionally left
 * untouched; keep the detection rules in this file in sync with the CLI.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/;

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
  // v1.1.0 structural GitHub Actions checks. Not the CLI text rules
  // pipe/docker-unpinned, sec/curl-pipe-shell, sec/permissions-write-all,
  // leak/slack-webhook, or pipe/npm-unpinned — those are not in this engine.
  // sec/job-permissions does not flag a least-privilege contents: write on a
  // job that pushes or releases.
  { id: 'sec/pull-request-target', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Untrusted pull_request_target Checkout or Write Permission', fix: 'Use pull_request, or check out the base ref read-only with no secrets.' },
  { id: 'sec/expression-injection', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Expression Injection in Workflow run Step', fix: 'Pass the value through an env: variable and reference that variable in the script.' },
  { id: 'pipe/action-unpinned', cat: 'Pipes & Dependencies', sev: 'MEDIUM', title: 'Unpinned Third-Party Action', fix: 'Pin the action to a full commit SHA.' },
  { id: 'sec/job-permissions', cat: 'Leaks & Secrets', sev: 'HIGH', title: 'Job Writes Without Least-Privilege Permissions', fix: 'Set least-privilege permissions on the job.' },
  { id: 'sec/secret-to-untrusted', cat: 'Leaks & Secrets', sev: 'HIGH', title: 'Secret Passed to Untrusted Step', fix: 'Scope the secret to the trusted step that needs it.' }
];

const SEV_WEIGHT = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

function gradeFor(score) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

function scoreFor(issueCount) {
  return Math.max(0, 100 - (issueCount * 4.2));
}

const SCANNABLE_EXTS = ['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.env'];

function scanLocalDirectory(dirPath) {
  const scannableExts = new Set(SCANNABLE_EXTS);
  const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'vendor', '.venv', 'venv', '__pycache__']);

  const issues = [];
  let totalFiles = 0;
  let totalLines = 0;
  const fileReports = [];

  function walk(current, onlyWorkflows) {
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      const ext = path.extname(current).toLowerCase();
      const base = path.basename(current);
      const relRaw = path.relative(dirPath, current).replace(/\\/g, '/') || base;
      const rel = canonicalWorkflowPath(current, relRaw);
      const workflowFile = isGitHubWorkflowPath(rel);
      // Dot directories other than a specially opened .github stay skipped.
      // Files under that .github walk are workflow YAML only, so a repo with
      // no workflow files keeps the previous file set.
      if (onlyWorkflows && !workflowFile) return;
      if (scannableExts.has(ext) || base.startsWith('.env') || workflowFile) {
        totalFiles++;
        try {
          const content = fs.readFileSync(current, 'utf-8');
          const lines = content.split('\n');
          totalLines += lines.length;
          const fileIssues = inspectFile(rel, content, lines, ext, false);
          if (fileIssues.length > 0) {
            issues.push(...fileIssues);
            fileReports.push({ path: rel, issues: fileIssues });
          }
        } catch (err) {
          // Unreadable or locked file: skip it, matching the CLI's behavior.
          void err;
        }
      }
      return;
    }

    if (stat.isDirectory()) {
      const base = path.basename(current);
      // v1.0.1 fix: the skip list applies to subdirectories only, never to the
      // directory the user asked to scan.
      // Repro (v1.0.0): plumber_scan { target: "proj/dist" } or { target: "~/.dotfiles" }
      //   with an AKIA key inside -> "Files: 0 | Issues: 0 ... No issues found."
      if (current !== dirPath && (skipDirs.has(base) || base.startsWith('.'))) {
        if (base !== '.github' || onlyWorkflows) return;
        const entries = fs.readdirSync(current);
        for (const entry of entries) {
          walk(path.join(current, entry), true);
        }
        return;
      }
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        walk(path.join(current, entry), onlyWorkflows);
      }
    }
  }

  walk(dirPath, false);

  const score = scoreFor(issues.length);
  const grade = gradeFor(score);

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

function scanText(text, filename) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  const name = filename && typeof filename === 'string' ? filename.replace(/\\/g, '/') : 'snippet.js';
  const ext = path.extname(name).toLowerCase();
  const content = text.replace(/\r\n?/g, '\n');
  const lines = content.split('\n');
  const issues = inspectFile(name, content, lines, ext, true);
  const score = scoreFor(issues.length);

  return {
    repo_name: name,
    total_files: 1,
    total_lines: lines.length,
    score: Math.round(score * 10) / 10,
    grade: gradeFor(score),
    issues,
    file_reports: issues.length > 0 ? [{ path: name, issues }] : []
  };
}

// v1.0.1 fix: match "test"/"spec" as a path segment or filename part, not as a
// substring. The old substring check treated latest.js, inspector.js, special.js,
// contest/, respect.py ... as test files and skipped secret detection in them.
// Repro (v1.0.0): plumber_scan_text { text: 'const k = "AKIAIOSFODNN7EXAMPLE";',
//   filename: "src/latest.js" } -> "No issues found."
function isTestPath(relPath) {
  const base = path.basename(relPath);
  return /(?:^|[\/._-])(?:__tests__|tests?|specs?|testing)(?:[\/._-]|$)/i.test(relPath)
    || /[a-z0-9](?:Tests?|Specs?)\.\w+$/.test(base)
    || base.toLowerCase() === 'conftest.py';
}

function inspectFile(relPath, content, lines, ext, detectWorkflowContent) {
  const issues = [];
  const lower = content.toLowerCase();
  const base = path.basename(relPath);
  const isTest = isTestPath(relPath);

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
      // Added in the MCP package: AWS access key IDs.
      if (/\b(AKIA[0-9A-Z]{16})\b/.test(l)) {
        issues.push({ rule_id: 'leak/api-key', title: 'Leaked AWS Access Key ID', severity: 'CRITICAL', line: idx + 1, evidence: trim.slice(0, 70), fix: 'Revoke key and store in secrets manager.' });
      }
    });
  }

  // Hardcoded password or token assignment.
  // Added in the MCP package: the CLI declares leak/hardcoded-secret but has no match.
  if (!isTest && !ENV_TEMPLATE_RE.test(base) && /(?:password|passwd|pwd|secret|api[_-]?key|token)/i.test(content)) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (trim.startsWith('#') || trim.startsWith('//') || trim.startsWith('/*')) return;
      const match = /(?:password|passwd|pwd|secret|api[_-]?key|token)\w*\s*[:=]\s*['"]([^'"]{4,})['"]/i.exec(l);
      if (match && !match[1].includes('${') && !/^(?:sk-|ghp_|AKIA)/.test(match[1])) {
        issues.push({ rule_id: 'leak/hardcoded-secret', title: 'Hardcoded Password or Database Credential', severity: 'HIGH', line: idx + 1, evidence: trim.slice(0, 90), fix: 'Replace with process.env / os.environ reference.' });
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

  if (shouldInspectWorkflow(relPath, content, detectWorkflowContent)) {
    issues.push(...inspectWorkflow(content, lines));
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

const FULL_SHA = /^[0-9a-f]{40}$/i;
const FIRST_PARTY_OWNERS = new Set(['actions', 'github']);
const INJECTED_EXPR = /\$\{\{\s*(?:github\.event\.|github\.head_ref\b|inputs\.)/;
const SECRET_REF = /\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/;
const UNTRUSTED_CHECKOUT = /github\.event\.pull_request|github\.head_ref|refs\/pull\//;
const CONTENTS_WRITE_RUN = /\bgit\s+push\b|\bgh\s+release\b|\bgh\s+pr\s+merge\b/;
const DEPLOY_RUN = /\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+npm\s+publish\b|\bdocker\s+push\b|\btwine\s+upload\b/;
const CONTENTS_ACTIONS = new Set([
  'softprops/action-gh-release',
  'peaceiris/actions-gh-pages',
  'ncipollo/release-action'
]);

function isGitHubWorkflowPath(filePath) {
  return /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(String(filePath || '').replace(/\\/g, '/'));
}

function canonicalWorkflowPath(absPath, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (isGitHubWorkflowPath(rel)) return rel;
  const abs = String(absPath || '').replace(/\\/g, '/');
  const marker = '.github/workflows/';
  const idx = abs.toLowerCase().lastIndexOf(marker);
  if (idx === -1) return rel;
  const suffix = abs.slice(idx);
  return isGitHubWorkflowPath(suffix) ? suffix : rel;
}

function looksLikeWorkflowSource(content) {
  return /^(?:"on"|'on'|on)\s*:/m.test(content) && /^jobs\s*:/m.test(content);
}

function shouldInspectWorkflow(relPath, content, detectWorkflowContent) {
  if (isGitHubWorkflowPath(relPath)) return true;
  if (!detectWorkflowContent) return false;
  const norm = String(relPath || '').replace(/\\/g, '/');
  if (/(?:^|\/)workflows\/[^/]+\.ya?ml$/i.test(norm)) return true;
  return looksLikeWorkflowSource(content);
}

function ruleById(id) {
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i].id === id) return RULES[i];
  }
  throw new Error('Unknown Plumber rule: ' + id);
}

function makeIssue(ruleId, line, evidence) {
  const rule = ruleById(ruleId);
  const text = evidence === undefined || evidence === null ? '' : String(evidence).trim();
  return {
    rule_id: rule.id,
    title: rule.title,
    severity: rule.sev,
    line: line > 0 ? line : 1,
    evidence: text.slice(0, 90),
    fix: rule.fix
  };
}

function loadWorkflow(content) {
  let doc;
  try {
    // DEFAULT_SCHEMA resolves anchors, aliases, and merge keys. js-yaml 4
    // speaks YAML 1.2, so the workflow key "on" stays a string.
    doc = yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
  } catch (err) {
    if (!err || err.name !== 'YAMLException') throw err;
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (doc.on === undefined || doc.on === null) return null;
  if (!doc.jobs || typeof doc.jobs !== 'object' || Array.isArray(doc.jobs)) return null;
  return doc;
}

function inspectWorkflow(content, lines) {
  const doc = loadWorkflow(content);
  if (!doc) return [];
  const found = [];
  const seen = new Set();
  function add(ruleId, line, evidence) {
    const issue = makeIssue(ruleId, line, evidence);
    const key = issue.rule_id + '\n' + issue.line + '\n' + issue.evidence;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(issue);
  }
  collectPullRequestTarget(doc, lines, add);
  collectExpressionInjection(doc, lines, add);
  collectUnpinnedActions(doc, lines, add);
  collectJobPermissions(doc, lines, add);
  collectSecrets(doc, lines, add);
  return found;
}

function triggerNames(onValue) {
  if (typeof onValue === 'string' || typeof onValue === 'number' || typeof onValue === 'boolean') {
    return [String(onValue)];
  }
  if (Array.isArray(onValue)) {
    const names = [];
    for (let i = 0; i < onValue.length; i++) {
      if (typeof onValue[i] === 'string') names.push(onValue[i]);
    }
    return names;
  }
  if (onValue && typeof onValue === 'object') return Object.keys(onValue);
  return [];
}

function eachJob(doc, visit) {
  const names = Object.keys(doc.jobs);
  for (let i = 0; i < names.length; i++) {
    const job = doc.jobs[names[i]];
    if (!job || typeof job !== 'object' || Array.isArray(job)) continue;
    visit(names[i], job);
  }
}

function eachStep(job, visit) {
  if (!Array.isArray(job.steps)) return;
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    visit(step, i);
  }
}

function scalarText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function parseActionRef(uses) {
  if (typeof uses !== 'string') return null;
  const spec = uses.trim();
  if (!spec || spec.startsWith('./') || spec.startsWith('docker://')) return null;
  const at = spec.lastIndexOf('@');
  const name = (at === -1 ? spec : spec.slice(0, at)).trim();
  const ref = at === -1 ? '' : spec.slice(at + 1).trim();
  if (!name.includes('/')) return null;
  const owner = name.split('/')[0];
  if (!owner) return null;
  return {
    spec: spec,
    name: name,
    owner: owner,
    ref: ref,
    thirdParty: !FIRST_PARTY_OWNERS.has(owner),
    pinned: FULL_SHA.test(ref)
  };
}

function permissionsGrantWrite(perms) {
  if (typeof perms === 'string') return perms.trim().toLowerCase() === 'write-all';
  if (!perms || typeof perms !== 'object' || Array.isArray(perms)) return false;
  const keys = Object.keys(perms);
  for (let i = 0; i < keys.length; i++) {
    if (String(perms[keys[i]]).trim().toLowerCase() === 'write') return true;
  }
  return false;
}

function jobEffectivePerms(doc, job) {
  if (job && job.permissions !== undefined && job.permissions !== null) return job.permissions;
  if (doc.permissions !== undefined && doc.permissions !== null) return doc.permissions;
  return undefined;
}

function valueHasSecret(value, depth) {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') return SECRET_REF.test(value);
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (valueHasSecret(value[i], depth + 1)) return true;
    }
    return false;
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (valueHasSecret(value[keys[i]], depth + 1)) return true;
  }
  return false;
}

function collectPullRequestTarget(doc, lines, add) {
  if (triggerNames(doc.on).indexOf('pull_request_target') === -1) return;
  let cursor = 0;
  eachJob(doc, function (name, job) {
    eachStep(job, function (step) {
      if (!checkoutRefIsUntrusted(step)) return;
      const ref = scalarText(step.with && step.with.ref);
      const snippet = ref || scalarText(step.uses);
      const line = lineContainingFrom(lines, snippet.slice(0, 80), cursor);
      cursor = line;
      add('sec/pull-request-target', line, lines[line - 1] || snippet);
    });
    if (permissionsGrantWrite(jobEffectivePerms(doc, job))) {
      const line = lineOfAppliedPermissions(lines, name, jobEffectivePerms(doc, job));
      add('sec/pull-request-target', line, lines[line - 1] || 'permissions');
    }
  });
}

function checkoutRefIsUntrusted(step) {
  if (typeof step.uses !== 'string' || !/^actions\/checkout(?:@|\/|\s|$)/.test(step.uses.trim())) return false;
  const withBlock = step.with;
  if (!withBlock || typeof withBlock !== 'object' || Array.isArray(withBlock)) return false;
  const ref = scalarText(withBlock.ref);
  const repository = scalarText(withBlock.repository);
  if (ref && UNTRUSTED_CHECKOUT.test(ref)) return true;
  if (repository && /github\.event\.pull_request\.head/.test(repository)) return true;
  return false;
}

function collectExpressionInjection(doc, lines, add) {
  let cursor = 0;
  eachJob(doc, function (name, job) {
    eachStep(job, function (step) {
      const run = scalarText(step.run);
      if (!run) return;
      const match = INJECTED_EXPR.exec(run);
      if (!match) return;
      const located = lineOfInjectedRun(lines, match[0], cursor);
      cursor = located.next;
      add('sec/expression-injection', located.line, lines[located.line - 1] || run);
    });
  });
}

function collectUnpinnedActions(doc, lines, add) {
  let cursor = 0;
  eachJob(doc, function (name, job) {
    cursor = flagUnpinned(lines, job.uses, cursor, add);
    eachStep(job, function (step) {
      cursor = flagUnpinned(lines, step.uses, cursor, add);
    });
  });
}

function flagUnpinned(lines, uses, cursor, add) {
  const action = parseActionRef(uses);
  if (!action || !action.thirdParty || action.pinned) return cursor;
  const line = lineOfUses(lines, action.spec, cursor);
  add('pipe/action-unpinned', line, lines[line - 1] || action.spec);
  return line;
}

function collectJobPermissions(doc, lines, add) {
  eachJob(doc, function (name, job) {
    const kinds = jobWriteKinds(job);
    if (!kinds.contents && !kinds.deploy) return;
    const hasJobPerms = job.permissions !== undefined && job.permissions !== null;
    const hasWorkflowPerms = doc.permissions !== undefined && doc.permissions !== null;
    const perms = hasJobPerms ? job.permissions : (hasWorkflowPerms ? doc.permissions : undefined);
    const info = describePermissions(perms);
    let reason = '';
    if (!info) reason = 'missing';
    else if (info.writeAll) reason = 'write-all';
    else if (info.contentsWrite && kinds.deploy && !kinds.contents) reason = 'contents-write';
    else return;
    const line = lineForJobPermission(lines, name, reason);
    add('sec/job-permissions', line, lines[line - 1] || name);
  });
}

function jobWriteKinds(job) {
  const kinds = { contents: false, deploy: false };
  eachStep(job, function (step) {
    const run = scalarText(step.run);
    if (CONTENTS_WRITE_RUN.test(run)) kinds.contents = true;
    if (DEPLOY_RUN.test(run)) kinds.deploy = true;
    const action = parseActionRef(step.uses);
    if (!action) return;
    if (CONTENTS_ACTIONS.has(action.name)) kinds.contents = true;
    if (action.name === 'actions/deploy-pages') kinds.deploy = true;
    if (action.name === 'docker/build-push-action') {
      const push = step.with && step.with.push;
      if (push === true || String(push).toLowerCase() === 'true') kinds.deploy = true;
    }
  });
  return kinds;
}

function describePermissions(perms) {
  if (perms === undefined || perms === null) return null;
  if (typeof perms === 'string') {
    const value = perms.trim().toLowerCase();
    return { writeAll: value === 'write-all', contentsWrite: value === 'write-all' };
  }
  if (typeof perms !== 'object' || Array.isArray(perms)) return null;
  const contents = perms.contents === undefined || perms.contents === null ? '' : String(perms.contents).trim().toLowerCase();
  return { writeAll: false, contentsWrite: contents === 'write' };
}

function collectSecrets(doc, lines, add) {
  let cursor = 0;
  eachJob(doc, function (name, job) {
    const inherited = valueHasSecret(doc.env, 0) || valueHasSecret(job.env, 0);
    const jobAction = parseActionRef(job.uses);
    if (jobAction && jobAction.thirdParty && (job.secrets === 'inherit' || valueHasSecret(job.secrets, 0) || inherited)) {
      const line = lineOfUses(lines, jobAction.spec, cursor);
      cursor = line;
      add('sec/secret-to-untrusted', line, lines[line - 1] || jobAction.spec);
    }
    eachStep(job, function (step) {
      const action = parseActionRef(step.uses);
      if (!action || !action.thirdParty) return;
      const onStep = valueHasSecret(step.env, 0) || valueHasSecret(step.with, 0);
      if (!onStep && !inherited) return;
      const line = onStep
        ? lineContainingFrom(lines, 'secrets.', cursor)
        : lineOfUses(lines, action.spec, cursor);
      cursor = line;
      add('sec/secret-to-untrusted', line, lines[line - 1] || action.spec);
    });
  });
}

function lineContainingFrom(lines, snippet, start) {
  const needle = String(snippet);
  const from = start > 0 ? start : 0;
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  for (let i = 0; i < from; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return 1;
}

function lineOfUses(lines, spec, cursor) {
  const from = cursor > 0 ? cursor : 0;
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(spec) && /uses\s*:/.test(lines[i])) return i + 1;
  }
  return lineContainingFrom(lines, spec, 0);
}

function lineOfInjectedRun(lines, snippet, cursor) {
  const runKey = /^\s*(?:-\s+)?run\s*:/;
  const start = cursor > 0 ? cursor : 0;
  for (let i = start; i < lines.length; i++) {
    if (!runKey.test(lines[i])) continue;
    const indent = lines[i].search(/\S/);
    if (lines[i].includes(snippet)) return { line: i + 1, next: i + 1 };
    let found = 0;
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (lines[j].search(/\S/) <= indent) break;
      end = j + 1;
      if (!found && lines[j].includes(snippet)) found = j + 1;
    }
    if (found) return { line: found, next: end };
    if (/\*[A-Za-z0-9_-]+/.test(lines[i])) {
      return { line: lineContainingFrom(lines, snippet, 0), next: i + 1 };
    }
  }
  return { line: lineContainingFrom(lines, snippet, 0), next: lines.length };
}

function findJobLine(lines, jobName) {
  const pattern = new RegExp('^  ' + escapeRegExp(jobName) + '\\s*:');
  let seenJobs = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^jobs\s*:/.test(lines[i])) {
      seenJobs = true;
      continue;
    }
    if (seenJobs && pattern.test(lines[i])) return i + 1;
  }
  return 1;
}

function nextJobBoundary(lines, jobLine) {
  for (let i = jobLine; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+\s*:/.test(lines[i])) return i;
  }
  return lines.length;
}

function findLineMatching(lines, pattern, start, end) {
  const from = Math.max(0, start);
  const to = Math.min(lines.length, end);
  for (let i = from; i < to; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 0;
}

function lineOfAppliedPermissions(lines, jobName, perms) {
  const jobAt = findJobLine(lines, jobName);
  const regionEnd = nextJobBoundary(lines, jobAt);
  if (typeof perms === 'string' && perms.trim().toLowerCase() === 'write-all') {
    return findLineMatching(lines, /permissions\s*:\s*['"]?write-all['"]?/, jobAt - 1, regionEnd)
      || findLineMatching(lines, /permissions\s*:\s*['"]?write-all['"]?/, 0, lines.length)
      || jobAt;
  }
  return findLineMatching(lines, /^\s*.+:\s*['"]?write['"]?\s*(?:#.*)?$/, jobAt - 1, regionEnd)
    || findLineMatching(lines, /^\s*permissions\s*:/, jobAt - 1, regionEnd)
    || findLineMatching(lines, /^permissions\s*:/, 0, lines.length)
    || jobAt;
}

function lineForJobPermission(lines, jobName, reason) {
  const jobAt = findJobLine(lines, jobName);
  const regionEnd = nextJobBoundary(lines, jobAt);
  if (reason === 'write-all') {
    return findLineMatching(lines, /permissions\s*:\s*['"]?write-all['"]?/, 0, lines.length) || jobAt;
  }
  if (reason === 'contents-write') {
    return findLineMatching(lines, /contents\s*:\s*['"]?write['"]?/, jobAt - 1, regionEnd)
      || findLineMatching(lines, /contents\s*:\s*['"]?write['"]?/, 0, lines.length)
      || jobAt;
  }
  return findLineMatching(
    lines,
    /git\s+push|gh\s+release|gh\s+pr\s+merge|npm\s+publish|pnpm\s+publish|docker\s+push|twine\s+upload|action-gh-release|actions-gh-pages|release-action|deploy-pages|build-push-action/,
    jobAt - 1,
    regionEnd
  ) || jobAt;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  RULES,
  SEV_WEIGHT,
  SCANNABLE_EXTS,
  scanLocalDirectory,
  scanText
};
