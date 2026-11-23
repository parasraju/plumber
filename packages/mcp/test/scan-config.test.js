const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RULES } = require('../src/engine.js');
const { ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SERVER = path.join(__dirname, '../bin/plumber-mcp.js');
const README = path.join(__dirname, '../README.md');
const PINNED = '0123456789abcdef0123456789abcdef01234567';
const UNKNOWN_NOTE = 'Could not detect the config type from the path or content. Ran the full rule set.';
const CHECKOUT_FIX = 'Use pull_request, or check out the base ref read-only with no secrets.';
const UNPINNED_FIX = 'Pin the action to a full commit SHA.';
const SECRET_FIX = 'Replace with process.env / os.environ reference.';
const TODO_FIX = 'Remove TODO_WORKFLOW from the workflow.';

const BAD_WORKFLOW = [
  'name: pull-request',
  'on: pull_request_target',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
  '      - uses: example/deploy@v1'
].join('\n') + '\n';

const CLEAN_WORKFLOW = [
  'name: ci',
  'on: pull_request',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
  '      - uses: example/action@' + PINNED,
  '      - name: title',
  '        env:',
  '          TITLE: ${{ github.event.pull_request.title }}',
  '          HEAD: ${{ github.head_ref }}',
  '        run: echo "$TITLE $HEAD"',
  '      - name: token',
  '        env:',
  '          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}',
  '        run: echo "$NPM_TOKEN"'
].join('\n') + '\n';

const MEDIUM_WORKFLOW = [
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: example/deploy@v1'
].join('\n') + '\n';

const GITLAB_WORKFLOW = [
  'stages:',
  '  - test',
  'unit:',
  '  stage: test',
  '  script:',
  '    - npm test'
].join('\n') + '\n';

const ZERO_COUNTS = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
const VERDICT_KEYS = ['configType', 'detectedBy', 'verdict', 'failOn', 'counts', 'findings'];

function writeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-mcp-config-'));
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

function textOf(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

function jsonOf(result) {
  return JSON.parse(textOf(result));
}

async function connect(cwd) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: 'ignore',
    cwd: cwd
  });
  const client = new Client({ name: 'plumber-mcp-config-test', version: '1.3.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function withClient(cwd, fn) {
  const client = await connect(cwd);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function ids(result) {
  return result.findings.map((finding) => finding.rule_id);
}

test('tools/list adds only plumber_scan_config and list_rules stays on the 26 built-ins', async () => {
  await withClient(undefined, async (client) => {
    assert.deepEqual(client.getServerVersion(), { name: 'plumber-mcp', version: '1.4.0' });
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      'plumber_scan',
      'plumber_list_rules',
      'plumber_scan_text',
      'plumber_scan_config',
      'plumber_fix'
    ]);
    for (const tool of listed.tools.slice(0, 3)) {
      assert.equal(tool.inputSchema.properties.configPath, undefined, tool.name);
      assert.equal(tool.inputSchema.properties.configText, undefined, tool.name);
      assert.equal(tool.inputSchema.properties.configType, undefined, tool.name);
      assert.equal(tool.inputSchema.properties.failOn, undefined, tool.name);
    }
    const added = listed.tools[3];
    assert.equal(added.description, 'Scan one local pipeline config file or pasted config and return a pass/fail verdict.');
    assert.equal(added.inputSchema.required, undefined);
    assert.deepEqual(added.inputSchema, {
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
    });

    const lines = textOf(await client.callTool({ name: 'plumber_list_rules', arguments: {} })).split('\n');
    assert.equal(lines.length, 26);
    assert.equal(lines.length, RULES.length);
    for (let i = 0; i < RULES.length; i++) {
      assert.equal(
        lines[i],
        RULES[i].id + ' [' + RULES[i].sev + '] ' + RULES[i].title + ' (' + RULES[i].fix + ')'
      );
    }
  });
});

test('a pull_request_target checkout and an unpinned action fail the default gate', async () => {
  const root = writeRepo({ '.github/workflows/pr.yml': BAD_WORKFLOW });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.github/workflows/pr.yml' }
      }));
      assert.deepEqual(Object.keys(result), VERDICT_KEYS);
      assert.equal(result.configType, 'github-actions');
      assert.equal(result.detectedBy, 'path');
      assert.equal(result.verdict, 'fail');
      assert.equal(result.failOn, 'HIGH');
      assert.deepEqual(result.counts, { CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 0 });
      assert.deepEqual(ids(result), ['sec/pull-request-target', 'pipe/action-unpinned']);
      assert.equal(result.findings[0].severity, 'CRITICAL');
      assert.equal(result.findings[0].file, '.github/workflows/pr.yml');
      assert.equal(result.findings[0].line, 9);
      assert.equal(result.findings[0].evidence, 'ref: ${{ github.event.pull_request.head.sha }}');
      assert.equal(result.findings[0].fix, CHECKOUT_FIX);
      assert.equal(result.findings[1].severity, 'MEDIUM');
      assert.equal(result.findings[1].file, '.github/workflows/pr.yml');
      assert.equal(result.findings[1].line, 10);
      assert.equal(result.findings[1].evidence, '- uses: example/deploy@v1');
      assert.equal(result.findings[1].fix, UNPINNED_FIX);
    });
  } finally {
    removeRepo(root);
  }
});

test('a clean workflow passes with an empty findings list', async () => {
  const root = writeRepo({ '.github/workflows/ci.yml': CLEAN_WORKFLOW });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.github/workflows/ci.yml' }
      }));
      assert.deepEqual(Object.keys(result), VERDICT_KEYS);
      assert.equal(result.configType, 'github-actions');
      assert.equal(result.detectedBy, 'path');
      assert.equal(result.verdict, 'pass');
      assert.equal(result.failOn, 'HIGH');
      assert.deepEqual(result.findings, []);
      assert.deepEqual(result.counts, ZERO_COUNTS);
    });
  } finally {
    removeRepo(root);
  }
});

test('pasted workflow text is auto-detected and judged the same way', async () => {
  await withClient(undefined, async (client) => {
    const failed = jsonOf(await client.callTool({
      name: 'plumber_scan_config',
      arguments: { configText: BAD_WORKFLOW }
    }));
    assert.equal(failed.configType, 'github-actions');
    assert.equal(failed.detectedBy, 'content');
    assert.equal(failed.verdict, 'fail');
    assert.deepEqual(ids(failed), ['sec/pull-request-target', 'pipe/action-unpinned']);
    assert.equal(failed.findings[0].file, undefined);
    assert.equal(failed.findings[0].line, 9);
    assert.equal(failed.findings[0].evidence, 'ref: ${{ github.event.pull_request.head.sha }}');
    assert.equal(failed.findings[0].fix, CHECKOUT_FIX);
    assert.equal(failed.findings[1].line, 10);
    assert.equal(failed.findings[1].evidence, '- uses: example/deploy@v1');
    assert.equal(failed.findings[1].fix, UNPINNED_FIX);

    const clean = jsonOf(await client.callTool({
      name: 'plumber_scan_config',
      arguments: { configText: CLEAN_WORKFLOW }
    }));
    assert.equal(clean.configType, 'github-actions');
    assert.equal(clean.detectedBy, 'content');
    assert.equal(clean.verdict, 'pass');
    assert.deepEqual(clean.findings, []);
  });
});

test('bad config input is an invalid-params error and the server keeps answering', async () => {
  const root = writeRepo({ '.github/workflows/ci.yml': CLEAN_WORKFLOW });
  const missing = path.join(root, 'missing-workflow.yml');
  try {
    await withClient(root, async (client) => {
      async function rejects(args, pattern) {
        await assert.rejects(
          () => client.callTool({ name: 'plumber_scan_config', arguments: args }),
          (err) => {
            assert.equal(err.code, ErrorCode.InvalidParams);
            assert.match(err.message, pattern);
            return true;
          }
        );
      }

      await rejects({}, /Provide 'configPath' or 'configText'\./);
      await rejects({ configType: 'auto' }, /Provide 'configPath' or 'configText'\./);
      await rejects(
        { configPath: missing, configText: 'FROM scratch\n' },
        /Provide 'configPath' or 'configText', not both\./
      );
      await rejects({ configPath: '   ' }, /'configPath' must be a non-empty string/);
      await rejects({ configText: '\n  \n' }, /'configText' must be a non-empty string/);
      await rejects({ configPath: missing }, /Config file does not exist: /);
      await rejects({ configPath: root }, /Config path must be a file: /);
      await rejects(
        { configPath: 'https://example.com/.github/workflows/pr.yml' },
        /Config path must be a local file, not a URL: /
      );
      await rejects(
        { configPath: 'file:///tmp/workflow.yml' },
        /Config path must be a local file, not a URL: /
      );
      await rejects(
        { configText: 'FROM scratch\n', configType: 'jenkins' },
        /'configType' must be one of: github-actions, gitlab-ci, dockerfile, auto/
      );
      await rejects(
        { configText: 'FROM scratch\n', failOn: 'high' },
        /'failOn' must be one of: CRITICAL, HIGH, MEDIUM, LOW/
      );

      const stillUp = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.github/workflows/ci.yml' }
      }));
      assert.equal(stillUp.verdict, 'pass');
      assert.deepEqual(stillUp.findings, []);
    });
  } finally {
    removeRepo(root);
  }
});

test('config type comes from the path, then the contents, and filters workflow rules', async () => {
  const root = writeRepo({
    '.gitlab-ci.yml': BAD_WORKFLOW,
    'docker/Dockerfile.prod': 'ARG VERSION=1\nFROM alpine\n',
    'pipeline.txt': 'FROM scratch\n',
    'notes.txt': 'hello from the pipeline\n'
  });
  try {
    await withClient(root, async (client) => {
      const gitlabPath = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.gitlab-ci.yml' }
      }));
      assert.equal(gitlabPath.configType, 'gitlab-ci');
      assert.equal(gitlabPath.detectedBy, 'path');
      assert.equal(gitlabPath.verdict, 'pass');
      assert.equal(ids(gitlabPath).includes('sec/pull-request-target'), false);
      assert.equal(ids(gitlabPath).includes('pipe/action-unpinned'), false);
      assert.deepEqual(gitlabPath.findings, []);

      const forced = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.gitlab-ci.yml', configType: 'github-actions' }
      }));
      assert.equal(forced.configType, 'github-actions');
      assert.equal(forced.detectedBy, 'explicit');
      assert.equal(forced.verdict, 'fail');
      assert.equal(forced.findings[0].rule_id, 'sec/pull-request-target');
      assert.equal(forced.findings[0].file, '.gitlab-ci.yml');
      assert.equal(forced.findings[0].fix, CHECKOUT_FIX);

      const asDockerfile = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: BAD_WORKFLOW, configType: 'dockerfile' }
      }));
      assert.equal(asDockerfile.configType, 'dockerfile');
      assert.equal(asDockerfile.detectedBy, 'explicit');
      assert.equal(asDockerfile.verdict, 'pass');
      assert.deepEqual(asDockerfile.findings, []);

      const gitlabText = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: GITLAB_WORKFLOW }
      }));
      assert.equal(gitlabText.configType, 'gitlab-ci');
      assert.equal(gitlabText.detectedBy, 'content');
      assert.equal(gitlabText.verdict, 'pass');
      assert.deepEqual(gitlabText.findings, []);

      const scriptOnly = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: 'unit:\n  script:\n    - npm test\n' }
      }));
      assert.equal(scriptOnly.configType, 'gitlab-ci');
      assert.equal(scriptOnly.detectedBy, 'content');

      const dockerText = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: '# syntax=docker/dockerfile:1\n\nFROM ubuntu:22.04\nRUN echo ok\n' }
      }));
      assert.equal(dockerText.configType, 'dockerfile');
      assert.equal(dockerText.detectedBy, 'content');
      assert.equal(dockerText.verdict, 'pass');

      const dockerPath = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: 'docker/Dockerfile.prod' }
      }));
      assert.equal(dockerPath.configType, 'dockerfile');
      assert.equal(dockerPath.detectedBy, 'path');
      assert.equal(dockerPath.note, undefined);
      assert.equal(dockerPath.verdict, 'pass');

      const dockerByContents = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: 'pipeline.txt' }
      }));
      assert.equal(dockerByContents.configType, 'dockerfile');
      assert.equal(dockerByContents.detectedBy, 'content');

      const unknown = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: 'notes.txt' }
      }));
      assert.deepEqual(Object.keys(unknown), VERDICT_KEYS.concat('note'));
      assert.equal(unknown.configType, 'unknown');
      assert.equal(unknown.detectedBy, 'failed');
      assert.equal(unknown.note, UNKNOWN_NOTE);
      assert.equal(unknown.verdict, 'pass');
      assert.deepEqual(unknown.findings, []);

      const secret = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: 'const k = "AKIAIOSFODNN7EXAMPLE";\n' }
      }));
      assert.equal(secret.configType, 'unknown');
      assert.equal(secret.detectedBy, 'failed');
      assert.equal(secret.note, UNKNOWN_NOTE);
      assert.equal(secret.verdict, 'fail');
      assert.deepEqual(ids(secret), ['leak/api-key']);
      assert.equal(secret.findings[0].severity, 'CRITICAL');
      assert.equal(secret.findings[0].line, 1);
      assert.equal(secret.findings[0].fix, 'Revoke key and store in secrets manager.');

      const dockerSecret = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: 'FROM ubuntu:22.04\nENV password="supersecret"\n' }
      }));
      assert.equal(dockerSecret.configType, 'dockerfile');
      assert.equal(dockerSecret.verdict, 'fail');
      assert.deepEqual(ids(dockerSecret), ['leak/hardcoded-secret']);
      assert.equal(dockerSecret.findings[0].severity, 'HIGH');
      assert.equal(dockerSecret.findings[0].evidence, 'ENV password="supersecret"');
      assert.equal(dockerSecret.findings[0].fix, SECRET_FIX);
    });
  } finally {
    removeRepo(root);
  }
});

test('failOn changes the verdict and still returns findings below the bar', async () => {
  await withClient(undefined, async (client) => {
    async function at(failOn) {
      const args = { configText: MEDIUM_WORKFLOW };
      if (failOn) args.failOn = failOn;
      return jsonOf(await client.callTool({ name: 'plumber_scan_config', arguments: args }));
    }

    const high = await at(undefined);
    assert.equal(high.failOn, 'HIGH');
    assert.equal(high.verdict, 'pass');
    assert.deepEqual(ids(high), ['pipe/action-unpinned']);
    assert.equal(high.findings[0].severity, 'MEDIUM');
    assert.equal(high.findings[0].fix, UNPINNED_FIX);
    assert.deepEqual(high.counts, { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 });

    const explicitHigh = await at('HIGH');
    assert.equal(explicitHigh.verdict, 'pass');
    const medium = await at('MEDIUM');
    assert.equal(medium.failOn, 'MEDIUM');
    assert.equal(medium.verdict, 'fail');
    assert.deepEqual(ids(medium), ['pipe/action-unpinned']);
    const low = await at('LOW');
    assert.equal(low.verdict, 'fail');
    const critical = await at('CRITICAL');
    assert.equal(critical.verdict, 'pass');
    assert.deepEqual(ids(critical), ['pipe/action-unpinned']);

    const blocked = jsonOf(await client.callTool({
      name: 'plumber_scan_config',
      arguments: { configText: BAD_WORKFLOW, failOn: 'CRITICAL' }
    }));
    assert.equal(blocked.verdict, 'fail');
    assert.equal(blocked.failOn, 'CRITICAL');
    assert.equal(blocked.findings[0].rule_id, 'sec/pull-request-target');
  });
});

test('rulesFile and a beside-file pack apply, and a missing pack is not an error', async () => {
  const pack = {
    rules: [{
      id: 'custom/no-todo-workflow',
      severity: 'LOW',
      title: 'Workflow TODO',
      pattern: 'TODO_WORKFLOW',
      fix: TODO_FIX
    }]
  };
  const rootPack = {
    rules: [{
      id: 'custom/root-only',
      severity: 'HIGH',
      title: 'Root pack',
      pattern: 'pull_request',
      fix: 'This root pack must not load for a nested config path.'
    }]
  };
  const marked = '# TODO_WORKFLOW\n' + CLEAN_WORKFLOW;
  const root = writeRepo({
    '.github/workflows/ci.yml': marked,
    '.github/workflows/.plumber-rules.json': JSON.stringify(pack),
    '.plumber-rules.json': JSON.stringify(rootPack),
    'chosen.json': JSON.stringify(pack)
  });
  try {
    await withClient(root, async (client) => {
      const auto = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.github/workflows/ci.yml' }
      }));
      assert.equal(auto.verdict, 'pass');
      assert.deepEqual(ids(auto), ['custom/no-todo-workflow']);
      assert.equal(auto.findings[0].severity, 'LOW');
      assert.equal(auto.findings[0].source, 'pack');
      assert.equal(auto.findings[0].line, 1);
      assert.equal(auto.findings[0].evidence, '# TODO_WORKFLOW');
      assert.equal(auto.findings[0].fix, TODO_FIX);
      assert.equal(auto.findings[0].file, '.github/workflows/ci.yml');
      assert.equal(auto.pack.rulesLoaded, 1);
      assert.deepEqual(auto.pack.errors, []);
      assert.match(auto.pack.path, /\.github\/workflows\/\.plumber-rules\.json$/);
      assert.equal(ids(auto).includes('custom/root-only'), false);

      const bareRoot = writeRepo({
        '.plumber-rules.json': JSON.stringify(rootPack),
        '.github/workflows/ci.yml': CLEAN_WORKFLOW
      });
      try {
        const ignored = jsonOf(await client.callTool({
          name: 'plumber_scan_config',
          arguments: { configPath: path.join(bareRoot, '.github', 'workflows', 'ci.yml') }
        }));
        assert.equal(ignored.pack, undefined);
        assert.deepEqual(ignored.findings, []);
        assert.equal(ignored.verdict, 'pass');
      } finally {
        removeRepo(bareRoot);
      }

      const pasted = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: marked }
      }));
      assert.equal(pasted.pack, undefined);
      assert.equal(ids(pasted).includes('custom/root-only'), false);
      assert.equal(ids(pasted).includes('custom/no-todo-workflow'), false);

      const chosen = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: marked, rulesFile: path.join(root, 'chosen.json') }
      }));
      assert.deepEqual(ids(chosen), ['custom/no-todo-workflow']);
      assert.equal(chosen.findings[0].source, 'pack');
      assert.equal(chosen.findings[0].fix, TODO_FIX);
      assert.equal(chosen.verdict, 'pass');
      assert.equal(chosen.pack.rulesLoaded, 1);
      assert.equal(chosen.findings[0].file, undefined);

      const missingPack = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: CLEAN_WORKFLOW, rulesFile: path.join(root, 'no-such-pack.json') }
      }));
      assert.equal(missingPack.verdict, 'pass');
      assert.deepEqual(missingPack.findings, []);
      assert.equal(missingPack.pack.rulesLoaded, 0);
      assert.match(missingPack.pack.errors[0], /Pack file not found: /);
    });
  } finally {
    removeRepo(root);
  }
});

test('plumber_scan and plumber_scan_text keep their report text on the same configs', async () => {
  const root = writeRepo({
    '.github/workflows/pr.yml': BAD_WORKFLOW,
    '.github/workflows/ci.yml': CLEAN_WORKFLOW
  });
  const checkoutLine = '- [CRITICAL] Untrusted pull_request_target Checkout or Write Permission (' + CHECKOUT_FIX + ') — .github/workflows/pr.yml:9';
  const unpinnedLine = '- [MEDIUM] Unpinned Third-Party Action (' + UNPINNED_FIX + ') — .github/workflows/pr.yml:10';
  try {
    await withClient(root, async (client) => {
      const scanned = textOf(await client.callTool({
        name: 'plumber_scan',
        arguments: { target: path.join(root, '.github', 'workflows', 'pr.yml') }
      }));
      assert.equal(scanned, [
        'Plumber Health Report for pr.yml',
        'Score: 91.6/100 (Grade A)',
        'Files: 1 | Issues: 2',
        '',
        checkoutLine,
        unpinnedLine
      ].join('\n'));
      assert.equal(scanned.includes('"verdict"'), false);

      const cleanScan = textOf(await client.callTool({
        name: 'plumber_scan',
        arguments: { target: path.join(root, '.github', 'workflows', 'ci.yml') }
      }));
      assert.equal(cleanScan, [
        'Plumber Health Report for ci.yml',
        'Score: 100/100 (Grade A)',
        'Files: 1 | Issues: 0',
        '',
        'No issues found.'
      ].join('\n'));

      const pasted = textOf(await client.callTool({
        name: 'plumber_scan_text',
        arguments: { text: BAD_WORKFLOW, filename: '.github/workflows/pr.yml' }
      }));
      assert.equal(pasted, [
        'Plumber Health Report for .github/workflows/pr.yml',
        'Score: 91.6/100 (Grade A)',
        'Files: 1 | Issues: 2',
        '',
        checkoutLine,
        unpinnedLine
      ].join('\n'));
      assert.equal(pasted.includes('"verdict"'), false);

      const snippet = textOf(await client.callTool({
        name: 'plumber_scan_text',
        arguments: { text: 'const k = "AKIAIOSFODNN7EXAMPLE";', filename: 'src/latest.js' }
      }));
      assert.equal(snippet, [
        'Plumber Health Report for src/latest.js',
        'Score: 95.8/100 (Grade A)',
        'Files: 1 | Issues: 1',
        '',
        '- [CRITICAL] Leaked AWS Access Key ID (Revoke key and store in secrets manager.) — src/latest.js:1'
      ].join('\n'));
      assert.equal(snippet.includes('Unpinned Third-Party Action'), false);
      assert.equal(snippet.includes('Expression Injection'), false);
    });
  } finally {
    removeRepo(root);
  }
});

test('the readme example is the live result for that workflow', async () => {
  const readme = fs.readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
  const heading = readme.indexOf('### Scan one config — plumber_scan_config');
  assert.ok(heading !== -1);
  assert.ok(readme.includes('scan a config file'));
  assert.ok(readme.includes('CI gate'));
  assert.ok(readme.includes('## 1.3.0\nNew tool plumber_scan_config: scan one pipeline config file with a pass/fail verdict.'));
  const fence = readme.indexOf('```json\n', heading);
  assert.ok(fence !== -1);
  const jsonStart = fence + '```json\n'.length;
  const jsonEnd = readme.indexOf('\n```', jsonStart);
  assert.ok(jsonEnd !== -1);
  const documented = readme.slice(jsonStart, jsonEnd);

  const root = writeRepo({ '.github/workflows/pr.yml': BAD_WORKFLOW });
  try {
    await withClient(root, async (client) => {
      const live = textOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configPath: '.github/workflows/pr.yml' }
      }));
      assert.equal(live, documented);
      const parsed = JSON.parse(live);
      assert.equal(parsed.verdict, 'fail');
      assert.equal(parsed.findings[0].rule_id, 'sec/pull-request-target');
      assert.equal(parsed.findings[0].fix, CHECKOUT_FIX);
    });
  } finally {
    removeRepo(root);
  }
});
