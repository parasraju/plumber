const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RULES, scanLocalDirectory, scanText, loadRulePack, resolveScanPack } = require('../src/engine.js');

const EXAMPLE = path.join(__dirname, '../examples/custom-rules.example.json');
const KEY_FIX = 'Move the internal key to an environment variable and rotate it.';
const BAN_FIX = 'Remove the banned marker before committing this file.';
const KEY_LINE = 'const internal = "INT_ABCDEFGHIJ123456";\n';
const AWS_LINE = 'const k = "AKIAIOSFODNN7EXAMPLE";\n';

const BUILTIN_LINES = [
  'leak/api-key [CRITICAL] Leaked API Key or Private Access Token (Move secret to environment variable (.env).)',
  'leak/committed-env [CRITICAL] Production Secret Committed in Environment File (Remove sensitive values and use .env.example.)',
  'leak/hardcoded-secret [HIGH] Hardcoded Password or Database Credential (Replace with process.env / os.environ reference.)',
  'sec/raw-html [MEDIUM] Raw HTML Injection (XSS Risk) (Use textContent or safe DOM templating.)',
  'clog/elided-code [HIGH] AI-Elided Code Snippet Left in File (Restore the complete function or component implementation.)',
  'clog/swallowed-error [HIGH] Swallowed Exception (Silent Failure) (Log the error or properly re-raise/handle it.)',
  'clog/stub-function [MEDIUM] Unimplemented Stub Function (Complete missing logic or remove placeholder.)',
  'clog/step-comments [LOW] Robotic AI Step Comments Left Behind (Clean up AI instructional comments.)',
  'clog/dead-code [HIGH] Unreachable Dead Code (Delete unreachable lines or run plumber clean --write.)',
  'slop/pointless-wrapper [LOW] Function That Only Forwards Its Arguments (Call underlying function directly.)',
  'joint/icon-button [HIGH] Icon Button Without Accessible Name (Add aria-label attribute to button element.)',
  'joint/clickable-div [HIGH] Non-Semantic Clickable Element (Missing Button / Role) (Use native <button type="button">.)',
  'joint/empty-test [HIGH] Empty Test with No Assertions (Add assert statements or verification logic.)',
  'joint/focus-removed [MEDIUM] Focus Outline Removed Without Replacement (Provide a visible :focus-visible style.)',
  'pipe/phantom-import [HIGH] Plausible but Hallucinated Package Import (Check package registry or use official package.)',
  'pipe/dead-link [MEDIUM] Broken or Null Link in Navigation (Use a <button> for actions or valid route for href.)',
  'slop/ai-gradient [MEDIUM] Purple / Violet AI Default Gradient (Use clean brand tokens or neutral surfaces.)',
  'slop/chatbot-residue [MEDIUM] Pasted Chatbot Conversational Residue (Delete conversational intro/outro boilerplate.)',
  'slop/neon-glow [LOW] Colored Neon Glow Shadow (Replace with subtle crisp 1px borders.)',
  'slop/gradient-text [LOW] Gradient-Clipped Headline Text (Use solid, high-contrast typography.)',
  'ui/important-abuse [LOW] !important Overrides in Stylesheet (Structure CSS cascade cleanly without !important.)',
  'sec/pull-request-target [CRITICAL] Untrusted pull_request_target Checkout or Write Permission (Use pull_request, or check out the base ref read-only with no secrets.)',
  'sec/expression-injection [CRITICAL] Expression Injection in Workflow run Step (Pass the value through an env: variable and reference that variable in the script.)',
  'pipe/action-unpinned [MEDIUM] Unpinned Third-Party Action (Pin the action to a full commit SHA.)',
  'sec/job-permissions [HIGH] Job Writes Without Least-Privilege Permissions (Set least-privilege permissions on the job.)',
  'sec/secret-to-untrusted [HIGH] Secret Passed to Untrusted Step (Scope the secret to the trusted step that needs it.)'
];

function writeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-mcp-pack-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

function removeRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function withRepo(files, fn) {
  const root = writeRepo(files);
  try {
    return fn(root);
  } finally {
    removeRepo(root);
  }
}

function ids(report) {
  return report.issues.map((issue) => issue.rule_id);
}

function packFile(root, name, body) {
  const full = path.join(root, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return full;
}

test('package metadata is 1.3.0 and still has only the two runtime dependencies', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.version, '1.3.0');
  assert.equal(
    pkg.description,
    'Plumber as an MCP server — let your AI coding agent scan repos and GitHub Actions workflows for leaked secrets, dead code, and AI slop, with fixes in plain English. Add your own checks with custom rule packs. Check one pipeline config before you commit it.'
  );
  assert.deepEqual(pkg.keywords, [
    'mcp',
    'model-context-protocol',
    'claude-code',
    'cursor',
    'opencode',
    'ai-agents',
    'security',
    'secrets-detection',
    'code-quality',
    'linter',
    'github-actions',
    'ci-cd',
    'workflow',
    'yaml',
    'custom-rules',
    'rule-packs',
    'config-scan',
    'ci-gate'
  ]);
  assert.deepEqual(pkg.files, ['bin', 'src', 'examples', 'README.md']);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@modelcontextprotocol/sdk', 'js-yaml']);
});

test('readme documents custom rule packs and the 1.2.0 changelog line', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(readme.includes('### Custom rule packs — bring your own rules'));
  assert.ok(readme.includes('Bring rule packs when you need custom rules the built-in set does not ship'));
  assert.ok(readme.includes('## 1.2.0\n- Custom rule packs: load your own rules from `.plumber-rules.json` or a `rulesFile`, ids under `custom/`.'));
  assert.ok(readme.includes('custom/no-internal-api-key'));
  assert.ok(readme.includes('custom/no-banned-marker'));
});

test('example pack loads two custom rules and does not change the 26 built-ins', () => {
  const before = RULES.map((rule) => `${rule.id} [${rule.sev}] ${rule.title} (${rule.fix})`);
  assert.deepEqual(before, BUILTIN_LINES);
  const pack = loadRulePack(EXAMPLE);
  assert.equal(pack.broken, false);
  assert.deepEqual(pack.errors, []);
  assert.equal(pack.rules.length, 2);
  assert.equal(pack.rules[0].id, 'custom/no-internal-api-key');
  assert.equal(pack.rules[0].severity, 'CRITICAL');
  assert.equal(pack.rules[0].fix, KEY_FIX);
  assert.equal(pack.rules[0].source, 'pack');
  assert.equal(pack.rules[1].id, 'custom/no-banned-marker');
  assert.equal(pack.rules[1].severity, 'MEDIUM');
  assert.equal(pack.rules[1].source, 'pack');
  assert.deepEqual(RULES.map((rule) => rule.id), BUILTIN_LINES.map((line) => line.split(' ')[0]));
  assert.equal(RULES.length, 26);
});

test('a pack rule fires on a matching file, and a clean file does not', () => {
  const example = fs.readFileSync(EXAMPLE);
  withRepo({
    '.plumber-rules.json': example,
    'src/bad.js': KEY_LINE,
    'src/ok.js': 'function add(a, b) {\n  return a + b;\n}\n'
  }, (root) => {
    const pack = resolveScanPack(root);
    assert.equal(pack.path, path.resolve(path.join(root, '.plumber-rules.json')));
    assert.equal(pack.rules.length, 2);
    const report = scanLocalDirectory(root, { pack });
    assert.equal(report.total_files, 2);
    assert.equal(report.issues.length, 1);
    const issue = report.issues[0];
    assert.equal(issue.rule_id, 'custom/no-internal-api-key');
    assert.equal(issue.severity, 'CRITICAL');
    assert.equal(issue.title, 'Internal API key format');
    assert.equal(issue.line, 1);
    assert.equal(issue.fix, KEY_FIX);
    assert.equal(issue.source, 'pack');
    assert.deepEqual(report.file_reports.map((file) => file.path), ['src/bad.js']);
  });
});

test('globs filter scannable files, and a nested star does not cross directories', () => {
  const example = fs.readFileSync(EXAMPLE);
  withRepo({
    '.plumber-rules.json': example,
    'src/app.py': 'print("DO_NOT_SHIP")\n',
    'src/key.py': KEY_LINE,
    'src/ok.js': 'function add(a, b) {\n  return a + b;\n}\n'
  }, (root) => {
    const report = scanLocalDirectory(root, { pack: resolveScanPack(root) });
    const byPath = Object.fromEntries(report.file_reports.map((file) => [file.path, file.issues.map((issue) => issue.rule_id)]));
    assert.deepEqual(byPath['src/app.py'], ['custom/no-banned-marker']);
    assert.equal(report.file_reports.find((file) => file.path === 'src/app.py').issues[0].fix, BAN_FIX);
    assert.equal(byPath['src/key.py'], undefined);
    assert.equal(byPath['src/ok.js'], undefined);
  });

  withRepo({
    'narrow.json': JSON.stringify({
      rules: [{
        id: 'custom/root-js-only',
        severity: 'LOW',
        title: 'Root JavaScript only',
        pattern: 'ROOT_ONLY',
        files: ['*.js'],
        fix: 'Remove ROOT_ONLY.'
      }]
    }),
    'app.js': 'const flag = "ROOT_ONLY";\n',
    'src/app.js': 'const flag = "ROOT_ONLY";\n'
  }, (root) => {
    const pack = loadRulePack(path.join(root, 'narrow.json'));
    const rootHit = scanText('const flag = "ROOT_ONLY";\n', 'app.js', { pack });
    const nested = scanText('const flag = "ROOT_ONLY";\n', 'src/app.js', { pack });
    assert.deepEqual(ids(rootHit), ['custom/root-js-only']);
    assert.deepEqual(ids(nested), []);
  });
});

test('rulesFile wins over .plumber-rules.json and a snippet with no repo does not auto-load', () => {
  withRepo({
    '.plumber-rules.json': JSON.stringify({
      rules: [{
        id: 'custom/only-auto',
        severity: 'LOW',
        title: 'Auto only',
        pattern: 'ONLY_AUTO',
        fix: 'Remove ONLY_AUTO.'
      }]
    }),
    'chosen.json': fs.readFileSync(EXAMPLE),
    'src/both.js': KEY_LINE + 'const marker = "ONLY_AUTO";\n'
  }, (root) => {
    const chosenPath = path.join(root, 'chosen.json');
    const chosen = resolveScanPack(root, chosenPath);
    assert.equal(chosen.path, path.resolve(chosenPath));
    const picked = scanLocalDirectory(root, { pack: chosen });
    assert.deepEqual(ids(picked), ['custom/no-internal-api-key']);
    assert.equal(picked.issues[0].fix, KEY_FIX);

    const auto = resolveScanPack(root);
    const autoReport = scanLocalDirectory(root, { pack: auto });
    assert.match(auto.path, /\.plumber-rules\.json$/);
    assert.deepEqual(ids(autoReport), ['custom/only-auto']);
  });

  const unloaded = scanText(KEY_LINE, 'src/config.js');
  assert.equal(unloaded.pack, undefined);
  assert.deepEqual(ids(unloaded), []);
});

test('auto-load reads only the target directory, including beside a file target', () => {
  withRepo({
    'src/.plumber-rules.json': fs.readFileSync(EXAMPLE),
    'src/app.js': KEY_LINE,
    'other.js': KEY_LINE
  }, (root) => {
    assert.equal(resolveScanPack(root), null);
    const bare = scanLocalDirectory(root);
    assert.equal(bare.pack, undefined);
    assert.deepEqual(ids(bare), []);

    const filePack = resolveScanPack(path.join(root, 'src', 'app.js'));
    assert.match(filePack.path, /src[\\/]\.plumber-rules\.json$/);
    const fileReport = scanLocalDirectory(path.join(root, 'src', 'app.js'), { pack: filePack });
    assert.deepEqual(ids(fileReport), ['custom/no-internal-api-key']);
  });
});

test('a pattern that spans lines still reports the starting line', () => {
  withRepo({
    'span.json': JSON.stringify({
      rules: [{
        id: 'custom/span',
        severity: 'LOW',
        title: 'Spanned marker',
        pattern: 'START_BLOCK\\nEND_BLOCK',
        fix: 'Remove the spanned marker.'
      }]
    })
  }, (root) => {
    const pack = loadRulePack(path.join(root, 'span.json'));
    const report = scanText('START_BLOCK\nEND_BLOCK\n', 'src/app.js', { pack });
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0].line, 1);
    assert.equal(report.issues[0].rule_id, 'custom/span');
  });
});

test('a repo with no pack file keeps the built-in result and does not invent a pack error', () => {
  withRepo({
    'src/latest.js': AWS_LINE,
    'src/ok.js': 'function add(a, b) {\n  return a + b;\n}\n'
  }, (root) => {
    assert.equal(resolveScanPack(root), null);
    const report = scanLocalDirectory(root);
    assert.equal(report.pack, undefined);
    assert.deepEqual(ids(report), ['leak/api-key']);
    assert.equal(report.issues[0].title, 'Leaked AWS Access Key ID');
    assert.equal(report.issues[0].fix, 'Revoke key and store in secrets manager.');
  });
});

test('invalid JSON, a bad regex, a duplicate id, a missing fix, and a non-custom id are rejected while built-ins still report', () => {
  withRepo({ 'src/latest.js': AWS_LINE }, (root) => {
    const cases = [
      {
        name: 'invalid-json',
        body: '{',
        error: /Invalid JSON in /
      },
      {
        name: 'bad-regex',
        body: {
          rules: [{
            id: 'custom/bad-regex',
            severity: 'HIGH',
            title: 'Broken pattern',
            pattern: '(unclosed',
            fix: 'Fix the pattern.'
          }]
        },
        error: /Rejected pack rule custom\/bad-regex: bad regex \(/
      },
      {
        name: 'duplicate-id',
        body: {
          rules: [
            { id: 'custom/dup', severity: 'LOW', title: 'First', pattern: 'FIRST_MARK', fix: 'Remove FIRST_MARK.' },
            { id: 'custom/dup', severity: 'LOW', title: 'Second', pattern: 'SECOND_MARK', fix: 'Remove SECOND_MARK.' }
          ]
        },
        error: /Rejected pack rule custom\/dup: duplicate id$/,
        keep: 'custom/dup'
      },
      {
        name: 'missing-fix',
        body: {
          rules: [{ id: 'custom/no-fix', severity: 'HIGH', title: 'No fix', pattern: 'NO_FIX_MARK' }]
        },
        error: /Rejected pack rule custom\/no-fix: missing fix/
      },
      {
        name: 'bad-prefix',
        body: {
          rules: [{ id: 'house/nope', severity: 'HIGH', title: 'House', pattern: 'HOUSE_MARK', fix: 'Remove HOUSE_MARK.' }]
        },
        error: /Rejected pack rule house\/nope: id must start with custom\//
      },
      {
        name: 'builtin-collision',
        body: {
          rules: [{
            id: 'leak/api-key',
            severity: 'LOW',
            title: 'Should not replace the built-in',
            pattern: 'AKIA',
            fix: 'This fix must not replace the built-in fix.'
          }]
        },
        error: /Rejected pack rule leak\/api-key: duplicate id \(matches built-in rule leak\/api-key\)/
      },
      {
        name: 'unknown-severity',
        body: {
          rules: [{ id: 'custom/warn', severity: 'WARN', title: 'Warn', pattern: 'WARN_MARK', fix: 'Remove WARN_MARK.' }]
        },
        error: /Rejected pack rule custom\/warn: unknown severity "WARN"/
      }
    ];

    for (const item of cases) {
      const full = packFile(root, item.name + '.json', item.body);
      const pack = loadRulePack(full);
      assert.match(pack.errors.join('\n'), item.error, item.name);
      const report = scanLocalDirectory(root, { pack });
      assert.ok(ids(report).includes('leak/api-key'), item.name + ' dropped the built-in finding');
      const aws = report.issues.find((issue) => issue.rule_id === 'leak/api-key');
      assert.equal(aws.title, 'Leaked AWS Access Key ID', item.name);
      assert.equal(aws.fix, 'Revoke key and store in secrets manager.', item.name);
      assert.equal(aws.source, undefined, item.name);
      if (item.keep) {
        assert.equal(ids(report).filter((id) => id === item.keep).length, 0);
      }
      if (item.name === 'builtin-collision') {
        assert.equal(report.issues.filter((issue) => issue.rule_id === 'leak/api-key').length, 1);
      }
      if (item.name !== 'duplicate-id') {
        assert.equal(report.issues.some((issue) => issue.source === 'pack'), false, item.name);
      }
    }

    const yamlPath = packFile(root, 'pack.yml', 'rules:\n  - id: custom/from-yaml\n');
    const yamlPack = loadRulePack(yamlPath);
    assert.match(yamlPack.errors[0], /Invalid JSON in /);
    assert.equal(yamlPack.rules.length, 0);
  });
});

test('a duplicate custom id keeps the first rule and drops the second', () => {
  withRepo({
    'dup.json': JSON.stringify({
      rules: [
        { id: 'custom/dup', severity: 'LOW', title: 'First', pattern: 'FIRST_MARK', fix: 'Remove FIRST_MARK.' },
        { id: 'custom/dup', severity: 'LOW', title: 'Second', pattern: 'SECOND_MARK', fix: 'Remove SECOND_MARK.' }
      ]
    }),
    'src/marks.js': 'const a = "FIRST_MARK";\nconst b = "SECOND_MARK";\n'
  }, (root) => {
    const pack = loadRulePack(path.join(root, 'dup.json'));
    assert.equal(pack.rules.length, 1);
    assert.equal(pack.rules[0].title, 'First');
    assert.match(pack.errors[0], /Rejected pack rule custom\/dup: duplicate id/);
    const report = scanLocalDirectory(root, { pack });
    assert.deepEqual(ids(report), ['custom/dup']);
    assert.equal(report.issues[0].title, 'First');
    assert.equal(report.issues[0].fix, 'Remove FIRST_MARK.');
    assert.equal(report.issues[0].line, 1);
  });
});

test('a URL pack is rejected locally and is not fetched', () => {
  const remote = loadRulePack('https://example.com/rules.json');
  assert.equal(remote.rules.length, 0);
  assert.match(remote.errors[0], /rule packs must be local JSON files/);
  const fileUrl = loadRulePack('file:///tmp/rules.json');
  assert.match(fileUrl.errors[0], /rule packs must be local JSON files/);
});

test('mcp tools accept optional rulesFile and apply, list, and reject packs', { timeout: 60000 }, async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const examplePath = path.resolve(EXAMPLE);
  const dirs = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '../bin/plumber-mcp.js')],
    stderr: 'ignore'
  });
  const client = new Client({ name: 'plumber-mcp-pack-test', version: '1.2.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['plumber_scan', 'plumber_list_rules', 'plumber_scan_text', 'plumber_scan_config']);
    assert.equal(listed.tools.length, 4);
    for (const tool of listed.tools) {
      assert.equal(typeof tool.inputSchema.properties.rulesFile, 'object');
      assert.equal(tool.inputSchema.properties.rulesFile.type, 'string');
    }
    assert.deepEqual(listed.tools[2].inputSchema.required, ['text']);

    function textOf(result) {
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.content[0].text;
    }

    const bare = textOf(await client.callTool({ name: 'plumber_list_rules', arguments: {} }));
    assert.deepEqual(bare.split('\n'), BUILTIN_LINES);

    const packedList = textOf(await client.callTool({
      name: 'plumber_list_rules',
      arguments: { rulesFile: examplePath }
    }));
    const packedLines = packedList.split('\n');
    assert.deepEqual(packedLines.slice(0, 26), BUILTIN_LINES);
    assert.equal(packedLines[26], 'custom/no-internal-api-key [CRITICAL] Internal API key format (' + KEY_FIX + ') source: pack');
    assert.equal(packedLines[27], 'custom/no-banned-marker [MEDIUM] Banned ship marker (' + BAN_FIX + ') source: pack');
    assert.equal(packedLines[28], `Pack: ${examplePath} (2 pack rules loaded)`);
    assert.equal(packedLines.length, 29);

    const autoRoot = writeRepo({
      '.plumber-rules.json': fs.readFileSync(EXAMPLE),
      'src/bad.js': KEY_LINE,
      'src/ok.js': 'function add(a, b) {\n  return a + b;\n}\n'
    });
    dirs.push(autoRoot);
    const autoText = textOf(await client.callTool({ name: 'plumber_scan', arguments: { target: autoRoot } }));
    const autoPackPath = path.resolve(path.join(autoRoot, '.plumber-rules.json'));
    assert.ok(autoText.includes(`Pack: ${autoPackPath} (2 pack rules loaded)`), autoText);
    assert.equal(autoText.includes('Pack error:'), false);
    assert.match(autoText, /Files: 2 \| Issues: 1/);
    assert.ok(autoText.includes('- [CRITICAL] Internal API key format (' + KEY_FIX + ') — src/bad.js:1'), autoText);
    assert.equal(autoText.includes('src/ok.js'), false, autoText);

    const cleanRoot = writeRepo({
      'src/latest.js': AWS_LINE
    });
    dirs.push(cleanRoot);
    const cleanText = textOf(await client.callTool({ name: 'plumber_scan', arguments: { target: cleanRoot } }));
    const expectedClean = [
      `Plumber Health Report for ${path.basename(cleanRoot)}`,
      'Score: 95.8/100 (Grade A)',
      'Files: 1 | Issues: 1',
      '',
      '- [CRITICAL] Leaked AWS Access Key ID (Revoke key and store in secrets manager.) — src/latest.js:1'
    ].join('\n');
    assert.equal(cleanText, expectedClean);

    const matchText = textOf(await client.callTool({
      name: 'plumber_scan_text',
      arguments: { text: KEY_LINE, filename: 'src/config.js', rulesFile: examplePath }
    }));
    assert.equal(matchText, [
      'Plumber Health Report for src/config.js',
      'Score: 95.8/100 (Grade A)',
      'Files: 1 | Issues: 1',
      `Pack: ${examplePath} (2 pack rules loaded)`,
      '',
      '- [CRITICAL] Internal API key format (' + KEY_FIX + ') — src/config.js:1'
    ].join('\n'));

    const missText = textOf(await client.callTool({
      name: 'plumber_scan_text',
      arguments: {
        text: 'function add(a, b) {\n  return a + b;\n}\n',
        filename: 'src/add.js',
        rulesFile: examplePath
      }
    }));
    assert.equal(missText, [
      'Plumber Health Report for src/add.js',
      'Score: 100/100 (Grade A)',
      'Files: 1 | Issues: 0',
      `Pack: ${examplePath} (2 pack rules loaded)`,
      '',
      'No issues found.'
    ].join('\n'));

    const pyKey = textOf(await client.callTool({
      name: 'plumber_scan_text',
      arguments: { text: KEY_LINE, filename: 'src/app.py', rulesFile: examplePath }
    }));
    assert.equal(pyKey.includes('Internal API key format'), false, pyKey);
    assert.match(pyKey, /No issues found\./);

    const pyBan = textOf(await client.callTool({
      name: 'plumber_scan_text',
      arguments: { text: 'print("DO_NOT_SHIP")\n', filename: 'src/app.py', rulesFile: examplePath }
    }));
    assert.match(pyBan, /\[MEDIUM\] Banned ship marker \(Remove the banned marker before committing this file\.\) — src\/app\.py:1/);

    const brokenRoot = writeRepo({
      '.plumber-rules.json': JSON.stringify({
        rules: [{
          id: 'custom/bad-regex',
          severity: 'HIGH',
          title: 'Broken pattern',
          pattern: '(unclosed',
          fix: 'Fix the pattern.'
        }]
      }),
      'src/latest.js': AWS_LINE
    });
    dirs.push(brokenRoot);
    const broken = textOf(await client.callTool({ name: 'plumber_scan', arguments: { target: brokenRoot } }));
    assert.match(broken, /Pack error: Rejected pack rule custom\/bad-regex: bad regex \(/);
    assert.match(broken, /\[CRITICAL\] Leaked AWS Access Key ID \(Revoke key and store in secrets manager\.\) — src\/latest\.js:1/);
    assert.match(broken, /Files: 1 \| Issues: 1/);
    assert.equal(broken.includes('Broken pattern'), false, broken);
    assert.match(broken, /0 pack rules loaded/);

    const invalidRoot = writeRepo({
      '.plumber-rules.json': '{',
      'src/latest.js': AWS_LINE
    });
    dirs.push(invalidRoot);
    const invalid = textOf(await client.callTool({ name: 'plumber_scan', arguments: { target: invalidRoot } }));
    assert.match(invalid, /Pack error: Invalid JSON in /);
    assert.match(invalid, /Leaked AWS Access Key ID/);
    assert.match(invalid, /Issues: 1/);

    const overrideRoot = writeRepo({
      '.plumber-rules.json': JSON.stringify({
        rules: [{
          id: 'custom/only-auto',
          severity: 'LOW',
          title: 'Auto only',
          pattern: 'ONLY_AUTO',
          fix: 'Remove ONLY_AUTO.'
        }]
      }),
      'chosen.json': fs.readFileSync(EXAMPLE),
      'src/both.js': KEY_LINE + 'const marker = "ONLY_AUTO";\n'
    });
    dirs.push(overrideRoot);
    const chosen = path.resolve(path.join(overrideRoot, 'chosen.json'));
    const overridden = textOf(await client.callTool({
      name: 'plumber_scan',
      arguments: { target: overrideRoot, rulesFile: chosen }
    }));
    assert.ok(overridden.includes(`Pack: ${chosen} (2 pack rules loaded)`), overridden);
    assert.match(overridden, /Internal API key format/);
    assert.equal(overridden.includes('ONLY_AUTO'), false, overridden);
    assert.equal(overridden.includes('Auto only'), false, overridden);
  } finally {
    for (const dir of dirs) removeRepo(dir);
    await client.close();
  }
});
