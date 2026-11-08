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
  { id: 'ui/important-abuse', cat: 'AI Slop Tells', sev: 'LOW', title: '!important Overrides in Stylesheet', fix: 'Structure CSS cascade cleanly without !important.' }
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

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      const ext = path.extname(current).toLowerCase();
      const base = path.basename(current);
      if (scannableExts.has(ext) || base.startsWith('.env')) {
        totalFiles++;
        const rel = path.relative(dirPath, current).replace(/\\/g, '/') || path.basename(current);
        try {
          const content = fs.readFileSync(current, 'utf-8');
          const lines = content.split('\n');
          totalLines += lines.length;
          const fileIssues = inspectFile(rel, content, lines, ext);
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
      if (current !== dirPath && (skipDirs.has(base) || base.startsWith('.'))) return;
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        walk(path.join(current, entry));
      }
    }
  }

  walk(dirPath);

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
  const issues = inspectFile(name, content, lines, ext);
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

function inspectFile(relPath, content, lines, ext) {
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
      if (ext === '.py' && /^\s*except(?:\s+\w+)?:\s*(?:pass|\.\.\.)/.test(l)) {
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

module.exports = {
  RULES,
  SEV_WEIGHT,
  SCANNABLE_EXTS,
  scanLocalDirectory,
  scanText
};
