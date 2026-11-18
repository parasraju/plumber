#!/usr/bin/env node

/**
 * Plumber MCP stdio server.
 *
 * Tools:
 *   plumber_scan          scan a local directory or file
 *   plumber_list_rules    list every inspection rule
 *   plumber_scan_text     scan a pasted snippet
 *   plumber_scan_config   pass/fail verdict for one pipeline config
 *
 * Each tool accepts an optional rulesFile path to one local JSON rule pack.
 * plumber_scan also reads .plumber-rules.json in the target when rulesFile is omitted.
 * Packs are never fetched from a URL.
 *
 * Only JSON-RPC goes to stdout. Diagnostics go to stderr.
 */

const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} = require('@modelcontextprotocol/sdk/types.js');
const { RULES, SCANNABLE_EXTS, scanLocalDirectory, scanText, scanConfig, loadRulePack, resolveScanPack } = require('../src/engine.js');

// v1.0.1 fix: read the version from package.json so serverInfo never drifts.
// Repro (v1.0.0): initialize -> serverInfo.version was hardcoded to "1.0.0".
const SERVER_INFO = { name: 'plumber-mcp', version: require('../package.json').version };

const TOOLS = [
  {
    name: 'plumber_scan',
    description: 'Scan a local directory or file for leaked secrets, dead code, and AI slop. Returns a score and fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Directory or file path to scan (default ".")' },
        rulesFile: { type: 'string', description: 'Optional path to a local JSON rule pack. When omitted, .plumber-rules.json is loaded from the scan target if that file exists.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'plumber_list_rules',
    description: 'List all Plumber inspection rules with severity, title, and recommended fix.',
    inputSchema: {
      type: 'object',
      properties: {
        rulesFile: { type: 'string', description: 'Optional path to a local JSON rule pack. Pack rules are listed after the built-in rules and marked as custom.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'plumber_scan_text',
    description: 'Scan a pasted code or config snippet for leaked secrets, dead code, and AI slop.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Code or config snippet to scan' },
        filename: { type: 'string', description: 'Optional filename used to select applicable rules (e.g. app.js)' },
        rulesFile: { type: 'string', description: 'Optional path to a local JSON rule pack applied to this snippet. Pasted snippets do not auto-load a pack.' }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'plumber_scan_config',
    description: 'Scan one local pipeline config file or pasted config and return a pass/fail verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        configPath: { type: 'string', description: 'Path to one local pipeline config file. Provide this or configText, not both. URLs are rejected.' },
        configText: { type: 'string', description: 'Pasted pipeline config. Provide this or configPath, not both.' },
        configType: {
          type: 'string',
          enum: ['github-actions', 'gitlab-ci', 'dockerfile', 'auto'],
          description: 'Config type. One of github-actions, gitlab-ci, dockerfile, or auto (default auto).'
        },
        rulesFile: { type: 'string', description: 'Optional path to a local JSON rule pack. When omitted and configPath is set, .plumber-rules.json is loaded from the directory that contains that file if it exists. Pasted configText does not auto-load a pack.' },
        failOn: {
          type: 'string',
          enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
          description: 'Verdict fails at this severity or higher: CRITICAL, HIGH, MEDIUM, or LOW (default HIGH).'
        }
      },
      additionalProperties: false
    }
  }
];

function packLoadedLine(pack) {
  const count = Array.isArray(pack.rules) ? pack.rules.length : 0;
  const label = count === 1 ? 'pack rule' : 'pack rules';
  return `Pack: ${pack.path} (${count} ${label} loaded)`;
}

function formatPackBanner(pack) {
  if (!pack) return '';
  const lines = [packLoadedLine(pack)];
  const errors = Array.isArray(pack.errors) ? pack.errors : [];
  for (let i = 0; i < errors.length; i++) {
    lines.push(`Pack error: ${errors[i]}`);
  }
  return lines.join('\n');
}

function formatListedRule(rule) {
  const severity = rule.sev || rule.severity;
  const line = `${rule.id} [${severity}] ${rule.title} (${rule.fix})`;
  if (rule.source === 'pack') return `${line} source: pack`;
  return line;
}

function formatReport(report) {
  const header = [
    `Plumber Health Report for ${report.repo_name}`,
    report.total_files === 0 ? 'Score: n/a' : `Score: ${report.score}/100 (Grade ${report.grade})`,
    `Files: ${report.total_files} | Issues: ${report.issues.length}`
  ].join('\n');
  const banner = formatPackBanner(report.pack);
  const top = banner ? `${header}\n${banner}` : header;

  // v1.0.1 fix: do not report "No issues found." when nothing was scanned.
  // Repro (v1.0.0): plumber_scan { target: ".github/workflows/ci.yml" } (or a
  //   Dockerfile, or an empty dir) -> "Score: 100/100 (Grade A) ... No issues found."
  if (report.total_files === 0) {
    return `${top}\n\nNo scannable files found, so nothing was checked. Supported: ${SCANNABLE_EXTS.join(' ')} and .env* files.`;
  }

  if (report.issues.length === 0) {
    return `${top}\n\nNo issues found.`;
  }

  const locations = new Map();
  for (const file of report.file_reports) {
    for (const issue of file.issues) {
      locations.set(issue, `${file.path}:${issue.line}`);
    }
  }

  const lines = report.issues.map((issue) => {
    const location = locations.get(issue);
    const suffix = location ? ` — ${location}` : '';
    return `- [${issue.severity}] ${issue.title} (${issue.fix})${suffix}`;
  });

  return `${top}\n\n${lines.join('\n')}`;
}

function requireString(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, `'${name}' must be a non-empty string`);
  }
  return value;
}

function requireText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, "'text' must be a non-empty string");
  }
  return text;
}

function runScanTool(args) {
  const target = requireString(args.target, 'target') || '.';
  const rulesFile = requireString(args.rulesFile, 'rulesFile');
  const absolute = path.resolve(target);

  if (!fs.existsSync(absolute)) {
    throw new McpError(ErrorCode.InvalidParams, `Target path does not exist: ${absolute}`);
  }

  let pack = null;
  try {
    pack = resolveScanPack(absolute, rulesFile);
  } catch (err) {
    pack = {
      path: rulesFile || absolute,
      rules: [],
      errors: [`Pack failed to load: ${err.message}`],
      broken: true
    };
  }

  try {
    return formatReport(scanLocalDirectory(absolute, pack ? { pack } : undefined));
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `Scan failed: ${err.message}`);
  }
}

function runScanTextTool(args) {
  const text = requireText(args.text);
  const filename = requireString(args.filename, 'filename');
  const rulesFile = requireString(args.rulesFile, 'rulesFile');
  let pack = null;
  if (rulesFile) {
    try {
      pack = loadRulePack(rulesFile);
    } catch (err) {
      pack = {
        path: rulesFile,
        rules: [],
        errors: [`Pack ${rulesFile} failed to load: ${err.message}`],
        broken: true
      };
    }
  }

  try {
    return formatReport(scanText(text, filename, pack ? { pack } : undefined));
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `Scan failed: ${err.message}`);
  }
}

const CONFIG_TYPES = ['github-actions', 'gitlab-ci', 'dockerfile', 'auto'];
const FAIL_ON_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function readChoice(value, name, allowed) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || allowed.indexOf(value.trim()) === -1) {
    throw new McpError(ErrorCode.InvalidParams, `'${name}' must be one of: ${allowed.join(', ')}`);
  }
  return value.trim();
}

function isUrlPath(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function readConfigFile(configPath) {
  if (isUrlPath(configPath)) {
    throw new McpError(ErrorCode.InvalidParams, `Config path must be a local file, not a URL: ${configPath}`);
  }
  const absolute = path.resolve(configPath);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new McpError(ErrorCode.InvalidParams, `Config file does not exist: ${absolute}`);
    }
    throw new McpError(ErrorCode.InvalidParams, `Config file could not be read: ${absolute} (${err.message})`);
  }
  if (!stat.isFile()) {
    throw new McpError(ErrorCode.InvalidParams, `Config path must be a file: ${absolute}`);
  }
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch (err) {
    throw new McpError(ErrorCode.InvalidParams, `Config file could not be read: ${absolute} (${err.message})`);
  }
}

function loadConfigPack(configPath, rulesFile) {
  if (rulesFile) {
    try {
      return loadRulePack(rulesFile);
    } catch (err) {
      return {
        path: rulesFile,
        rules: [],
        errors: [`Pack ${rulesFile} failed to load: ${err.message}`],
        broken: true
      };
    }
  }
  if (!configPath) return null;
  try {
    return resolveScanPack(path.resolve(configPath));
  } catch (err) {
    return {
      path: configPath,
      rules: [],
      errors: [`Pack failed to load: ${err.message}`],
      broken: true
    };
  }
}

function requireNamedText(text, name) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, `'${name}' must be a non-empty string`);
  }
  return text;
}

function runScanConfigTool(args) {
  const hasPath = args.configPath !== undefined;
  const hasText = args.configText !== undefined;
  if (!hasPath && !hasText) {
    throw new McpError(ErrorCode.InvalidParams, "Provide 'configPath' or 'configText'.");
  }
  if (hasPath && hasText) {
    throw new McpError(ErrorCode.InvalidParams, "Provide 'configPath' or 'configText', not both.");
  }
  const configPath = hasPath ? requireString(args.configPath, 'configPath') : undefined;
  const configText = hasText ? requireNamedText(args.configText, 'configText') : undefined;
  const configType = readChoice(args.configType, 'configType', CONFIG_TYPES);
  const failOn = readChoice(args.failOn, 'failOn', FAIL_ON_LEVELS);
  const rulesFile = requireString(args.rulesFile, 'rulesFile');
  const text = configPath ? readConfigFile(configPath) : configText;
  const pack = loadConfigPack(configPath, rulesFile);
  let result;
  try {
    result = scanConfig(text, configPath, {
      configType: configType,
      failOn: failOn,
      pack: pack || undefined
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err instanceof TypeError) {
      throw new McpError(ErrorCode.InvalidParams, err.message);
    }
    throw new McpError(ErrorCode.InternalError, `Scan failed: ${err.message}`);
  }
  return JSON.stringify(result, null, 2);
}

function runListRulesTool(args) {
  const rulesFile = requireString(args && args.rulesFile, 'rulesFile');
  let pack = null;
  if (rulesFile) {
    try {
      pack = loadRulePack(rulesFile);
    } catch (err) {
      pack = {
        path: rulesFile,
        rules: [],
        errors: [`Pack ${rulesFile} failed to load: ${err.message}`],
        broken: true
      };
    }
  }
  const lines = RULES.map((rule) => formatListedRule(rule));
  if (!pack) return lines.join('\n');
  for (let i = 0; i < pack.rules.length; i++) {
    lines.push(formatListedRule(pack.rules[i]));
  }
  lines.push(packLoadedLine(pack));
  const errors = pack.errors || [];
  for (let i = 0; i < errors.length; i++) {
    lines.push(`Pack error: ${errors[i]}`);
  }
  return lines.join('\n');
}

async function main() {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    let text;

    if (name === 'plumber_scan') {
      text = runScanTool(args);
    } else if (name === 'plumber_list_rules') {
      text = runListRulesTool(args);
    } else if (name === 'plumber_scan_text') {
      text = runScanTextTool(args);
    } else if (name === 'plumber_scan_config') {
      text = runScanConfigTool(args);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return { content: [{ type: 'text', text }] };
  });

  server.onerror = (error) => {
    process.stderr.write(`[plumber-mcp] ${error.message}\n`);
  };

  await server.connect(new StdioServerTransport());
  process.stderr.write('Plumber MCP stdio server started\n');
}

main().catch((error) => {
  process.stderr.write(`[plumber-mcp] Failed to start: ${error.stack || error.message}\n`);
  process.exit(1);
});
