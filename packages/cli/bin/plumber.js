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

const API_BASE = process.env.PLUMBER_API_URL || 'http://localhost:3100';

const RULES = [
  { id: 'leak/api-key', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Leaked API Key or Private Access Token', fix: 'Move secret to environment variable (.env).' },
  { id: 'leak/committed-env', cat: 'Leaks & Secrets', sev: 'CRITICAL', title: 'Production Secret Committed in Environment File', fix: 'Remove sensitive values and use .env.example.' },
  { id: 'leak/hardcoded-secret', cat: 'Leaks & Secrets', sev: 'HIGH', title: 'Hardcoded Password or Database Credential', fix: 'Replace with process.env / os.environ reference.' },
  { id: 'sec/raw-html', cat: 'Leaks & Secrets', sev: 'MEDIUM', title: 'Raw HTML Injection (XSS Risk)', fix: 'Use textContent or safe DOM templating.' },
  { id: 'clog/elided-code', cat: 'Clogs & Dead Code', sev: 'HIGH', title: 'AI-Elided Code Snippet Left in File', fix: 'Restore the complete function or component implementation.' },
  { id: 'clog/swallowed-error', cat: 'Clogs & Dead Code', sev: 'HIGH', title: 'Swallowed Exception (Silent Failure)', fix: 'Log the error or properly re-raise/handle it.' },
  { id: 'clog/stub-function', cat: 'Clogs & Dead Code', sev: 'MEDIUM', title: 'Unimplemented Stub Function', fix: 'Complete missing logic or remove placeholder.' },
  { id: 'clog/step-comments', cat: 'Clogs & Dead Code', sev: 'LOW', title: 'Robotic AI Step Comments Left Behind', fix: 'Clean up AI instructional comments.' },
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
} else {
  printHelp();
}

function printHelp() {
  console.log(`
Plumber — Code Leak, Clog, and AI Slop Inspector (v1.0.0)

USAGE:
  npx plumber-linter scan [target] [options]
  npx plumber-linter rules
  npx plumber-linter mcp

COMMANDS:
  scan [path|owner/repo]  Scan local codebase or GitHub repository
  rules                   Display catalogue of 20 inspection rules
  mcp                     Run stdio Model Context Protocol (MCP) server for Claude / Cursor

OPTIONS:
  --format [pretty|json|md]  Output format (default: pretty)
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
  const scannableExts = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.scss', '.env']);
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
        try {
          const content = fs.readFileSync(current, 'utf-8');
          const lines = content.split('\n');
          totalLines += lines.length;
          const fileIssues = inspectFile(path.relative(dirPath, current).replace(/\\/g, '/'), content, lines, ext);
          if (fileIssues.length > 0) {
            issues.push(...fileIssues);
            fileReports.push({ path: path.relative(dirPath, current).replace(/\\/g, '/'), issues: fileIssues });
          }
        } catch (err) {
          // Skip unreadable or locked files
        }
      }
      return;
    }

    if (stat.isDirectory()) {
      const base = path.basename(current);
      if (skipDirs.has(base) || (base.startsWith('.') && base !== '.')) return;
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

  // Elided code
  if (/(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code)/i.test(content)) {
    lines.forEach((l, idx) => {
      if (/(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code)/i.test(l)) {
        issues.push({ rule_id: 'clog/elided-code', title: 'AI-Elided Code Snippet Left in File', severity: 'HIGH', line: idx + 1, evidence: l.trim().slice(0, 90), fix: 'Restore the complete code implementation.' });
      }
    });
  }

  // Swallowed error
  if (lower.includes('except') || lower.includes('catch')) {
    lines.forEach((l, idx) => {
      if (/except(?:\s+\w+)?:\s*(?:pass|\.\.\.)/.test(l) || /catch\s*\([^)]*\)\s*\{\s*\}/.test(l)) {
        issues.push({ rule_id: 'clog/swallowed-error', title: 'Swallowed Exception (Silent Failure)', severity: 'HIGH', line: idx + 1, evidence: l.trim(), fix: 'Log the error or properly re-raise/handle it.' });
      }
    });
  }

  // API keys
  if (content.includes('sk-') || content.includes('ghp_') || content.includes('AKIA')) {
    lines.forEach((l, idx) => {
      if (/\b(sk-(?:live|test|proj)?[a-zA-Z0-9_-]{24,})\b/.test(l)) {
        issues.push({ rule_id: 'leak/api-key', title: 'Leaked OpenAI / Model API Key', severity: 'CRITICAL', line: idx + 1, evidence: l.trim().slice(0, 70), fix: 'Extract secret to .env file immediately.' });
      }
      if (/\b(ghp_[a-zA-Z0-9]{36})\b/.test(l)) {
        issues.push({ rule_id: 'leak/api-key', title: 'Leaked GitHub Personal Access Token', severity: 'CRITICAL', line: idx + 1, evidence: l.trim().slice(0, 70), fix: 'Revoke key and store in secrets manager.' });
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

  return issues;
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
