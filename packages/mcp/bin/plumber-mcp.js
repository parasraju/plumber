#!/usr/bin/env node

/**
 * Plumber MCP stdio server.
 *
 * Tools:
 *   plumber_scan        scan a local directory or file
 *   plumber_list_rules  list the 21 inspection rules
 *   plumber_scan_text   scan a pasted snippet
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
const { RULES, SCANNABLE_EXTS, scanLocalDirectory, scanText } = require('../src/engine.js');

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
        target: { type: 'string', description: 'Directory or file path to scan (default ".")' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'plumber_list_rules',
    description: 'List all Plumber inspection rules with severity, title, and recommended fix.',
    inputSchema: {
      type: 'object',
      properties: {},
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
        filename: { type: 'string', description: 'Optional filename used to select applicable rules (e.g. app.js)' }
      },
      required: ['text'],
      additionalProperties: false
    }
  }
];

function formatReport(report) {
  const header = [
    `Plumber Health Report for ${report.repo_name}`,
    report.total_files === 0 ? 'Score: n/a' : `Score: ${report.score}/100 (Grade ${report.grade})`,
    `Files: ${report.total_files} | Issues: ${report.issues.length}`
  ].join('\n');

  // v1.0.1 fix: do not report "No issues found." when nothing was scanned.
  // Repro (v1.0.0): plumber_scan { target: ".github/workflows/ci.yml" } (or a
  //   Dockerfile, or an empty dir) -> "Score: 100/100 (Grade A) ... No issues found."
  if (report.total_files === 0) {
    return `${header}\n\nNo scannable files found, so nothing was checked. Supported: ${SCANNABLE_EXTS.join(' ')} and .env* files.`;
  }

  if (report.issues.length === 0) {
    return `${header}\n\nNo issues found.`;
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

  return `${header}\n\n${lines.join('\n')}`;
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
  const absolute = path.resolve(target);

  if (!fs.existsSync(absolute)) {
    throw new McpError(ErrorCode.InvalidParams, `Target path does not exist: ${absolute}`);
  }

  try {
    return formatReport(scanLocalDirectory(absolute));
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `Scan failed: ${err.message}`);
  }
}

function runScanTextTool(args) {
  const text = requireText(args.text);
  const filename = requireString(args.filename, 'filename');

  try {
    return formatReport(scanText(text, filename));
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, `Scan failed: ${err.message}`);
  }
}

function runListRulesTool() {
  return RULES.map((rule) => `${rule.id} [${rule.sev}] ${rule.title} (${rule.fix})`).join('\n');
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
      text = runListRulesTool();
    } else if (name === 'plumber_scan_text') {
      text = runScanTextTool(args);
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
