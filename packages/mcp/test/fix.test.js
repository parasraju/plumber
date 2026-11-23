const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SERVER = path.join(__dirname, '../bin/plumber-mcp.js');
const README = path.join(__dirname, '../README.md');
const FAKE_SHA = '0000000000000000000000000000000000000000';
const NO_SHA_REASON = 'no SHA supplied — pass one in `pins`';
const INTENT_REASON = 'Not auto-fixed: changing this would rewrite the workflow intent.';
const CHECKOUT_FIX = 'Use pull_request, or check out the base ref read-only with no secrets.';

function workflow(lines) {
  return lines.join('\n') + '\n';
}

const UNPINNED = workflow([
  '# release pipeline',
  'name: build',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: example/deploy@v1'
]);

const QUOTED = workflow([
  'name: quoted',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: "example/deploy@v1" # production'
]);

const TARGET = workflow([
  'name: pull-request',
  'on: pull_request_target',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}'
]);

const CLEAN = workflow([
  'name: ci',
  'on: pull_request',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@0000000000000000000000000000000000000000',
  '      - run: npm test'
]);

function writeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-mcp-fix-'));
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
  const client = new Client({ name: 'plumber-mcp-fix-test', version: '1.4.0' }, { capabilities: {} });
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

function changedLines(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  assert.equal(right.length, left.length);
  const changed = [];
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) changed.push({ line: i + 1, before: left[i], after: right[i] });
  }
  return changed;
}

test('a matching pin rewrites only that uses line and the re-scan is clean', async () => {
  const root = writeRepo({ '.github/workflows/build.yml': UNPINNED });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: {
          configPath: '.github/workflows/build.yml',
          pins: { 'example/deploy@v1': FAKE_SHA }
        }
      }));
      const expectedLine = '      - uses: example/deploy@' + FAKE_SHA + ' # v1';
      const changed = changedLines(UNPINNED, result.fixedText);
      assert.deepEqual(changed, [{ line: 9, before: '      - uses: example/deploy@v1', after: expectedLine }]);
      assert.deepEqual(result.appliedFixes, [{
        rule_id: 'pipe/action-unpinned',
        line: 9,
        before: '      - uses: example/deploy@v1',
        after: expectedLine
      }]);
      assert.deepEqual(result.remainingFindings, []);
      assert.deepEqual(result.unusedPins, []);
      assert.deepEqual(result.counts, { applied: 1, remaining: 0 });
      const doc = yaml.load(result.fixedText);
      assert.equal(doc.jobs.build.steps[1].uses, 'example/deploy@' + FAKE_SHA);
      const again = jsonOf(await client.callTool({
        name: 'plumber_scan_config',
        arguments: { configText: result.fixedText }
      }));
      assert.equal(again.findings.some((finding) => finding.rule_id === 'pipe/action-unpinned'), false);
      assert.equal(again.verdict, 'pass');
    });
  } finally {
    removeRepo(root);
  }
});

test('no pins leaves the file unchanged and reports the missing SHA', async () => {
  const root = writeRepo({ '.github/workflows/build.yml': UNPINNED });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/build.yml' }
      }));
      assert.equal(result.fixedText, UNPINNED);
      assert.deepEqual(result.appliedFixes, []);
      assert.deepEqual(result.unusedPins, []);
      assert.equal(result.remainingFindings.length, 1);
      assert.equal(result.remainingFindings[0].rule_id, 'pipe/action-unpinned');
      assert.equal(result.remainingFindings[0].severity, 'MEDIUM');
      assert.equal(result.remainingFindings[0].line, 9);
      assert.equal(result.remainingFindings[0].fix, 'Pin the action to a full commit SHA.');
      assert.equal(result.remainingFindings[0].reason, NO_SHA_REASON);
      assert.deepEqual(result.counts, { applied: 0, remaining: 1 });
    });
  } finally {
    removeRepo(root);
  }
});

test('a bad pin is an invalid-params error that names the key', async () => {
  const root = writeRepo({ '.github/workflows/build.yml': UNPINNED });
  const bad = [
    '0123456789abcdef',
    'v1',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '0123456789ABCDEF0123456789ABCDEF01234567'
  ];
  try {
    await withClient(root, async (client) => {
      for (const value of bad) {
        await assert.rejects(
          () => client.callTool({
            name: 'plumber_fix',
            arguments: {
              configPath: '.github/workflows/build.yml',
              pins: { 'example/deploy@v1': value }
            }
          }),
          (err) => {
            assert.equal(err.code, ErrorCode.InvalidParams);
            assert.match(err.message, /example\/deploy@v1/);
            return true;
          }
        );
      }
      const stillUp = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/build.yml' }
      }));
      assert.equal(stillUp.fixedText, UNPINNED);
    });
  } finally {
    removeRepo(root);
  }
});

test('a pin that matches no uses line is listed in unusedPins', async () => {
  const root = writeRepo({ '.github/workflows/build.yml': UNPINNED });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: {
          configPath: '.github/workflows/build.yml',
          pins: {
            'actions/checkout@v4': FAKE_SHA,
            'example/missing@v2': FAKE_SHA
          }
        }
      }));
      assert.equal(result.fixedText, UNPINNED);
      assert.deepEqual(result.appliedFixes, []);
      assert.deepEqual(result.unusedPins, ['actions/checkout@v4', 'example/missing@v2']);
      assert.equal(result.remainingFindings[0].rule_id, 'pipe/action-unpinned');
      assert.equal(result.remainingFindings[0].reason, NO_SHA_REASON);
    });
  } finally {
    removeRepo(root);
  }
});

test('pull_request_target stays in the file and in remainingFindings', async () => {
  const root = writeRepo({ '.github/workflows/pr.yml': TARGET });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/pr.yml', pins: { 'actions/checkout@v4': FAKE_SHA } }
      }));
      assert.equal(result.fixedText, TARGET);
      assert.equal(result.fixedText.includes('on: pull_request_target'), true);
      assert.deepEqual(result.appliedFixes, []);
      assert.deepEqual(result.unusedPins, ['actions/checkout@v4']);
      const finding = result.remainingFindings.find((item) => item.rule_id === 'sec/pull-request-target');
      assert.ok(finding);
      assert.equal(finding.severity, 'CRITICAL');
      assert.equal(finding.line, 9);
      assert.equal(finding.fix, CHECKOUT_FIX);
      assert.equal(finding.reason, INTENT_REASON);
    });
  } finally {
    removeRepo(root);
  }
});

test('a clean workflow is returned byte-identical with empty lists', async () => {
  const root = writeRepo({ '.github/workflows/ci.yml': CLEAN });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/ci.yml' }
      }));
      assert.equal(result.fixedText, CLEAN);
      assert.deepEqual(result.appliedFixes, []);
      assert.deepEqual(result.remainingFindings, []);
      assert.deepEqual(result.unusedPins, []);
      assert.deepEqual(result.counts, { applied: 0, remaining: 0 });
    });
  } finally {
    removeRepo(root);
  }
});

test('configText pins the same line as configPath', async () => {
  const root = writeRepo({ '.github/workflows/build.yml': UNPINNED });
  try {
    await withClient(root, async (client) => {
      const pins = { 'example/deploy@v1': FAKE_SHA };
      const fromPath = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/build.yml', pins }
      }));
      const fromText = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configText: UNPINNED, pins }
      }));
      assert.equal(fromText.fixedText, fromPath.fixedText);
      assert.deepEqual(fromText.appliedFixes, fromPath.appliedFixes);
      assert.deepEqual(fromText.remainingFindings, fromPath.remainingFindings);
      assert.deepEqual(fromText.unusedPins, fromPath.unusedPins);
      assert.equal(fromText.fixedText.includes('example/deploy@' + FAKE_SHA + ' # v1'), true);
    });
  } finally {
    removeRepo(root);
  }
});

test('bad fix input is an invalid-params error and the server keeps answering', async () => {
  const root = writeRepo({ '.github/workflows/ci.yml': CLEAN });
  const missing = path.join(root, 'missing-workflow.yml');
  try {
    await withClient(root, async (client) => {
      async function rejects(args, pattern) {
        await assert.rejects(
          () => client.callTool({ name: 'plumber_fix', arguments: args }),
          (err) => {
            assert.equal(err.code, ErrorCode.InvalidParams);
            assert.match(err.message, pattern);
            return true;
          }
        );
      }

      await rejects({}, /Provide 'configPath' or 'configText'\./);
      await rejects(
        { configPath: missing, configText: 'FROM scratch\n' },
        /Provide 'configPath' or 'configText', not both\./
      );
      await rejects({ configPath: missing }, /Config file does not exist: /);
      await rejects(
        { configText: 'FROM scratch\n', configType: 'jenkins' },
        /'configType' must be one of: github-actions, gitlab-ci, dockerfile, auto/
      );

      const stillUp = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: { configPath: '.github/workflows/ci.yml' }
      }));
      assert.equal(stillUp.fixedText, CLEAN);
      assert.deepEqual(stillUp.remainingFindings, []);
    });
  } finally {
    removeRepo(root);
  }
});

test('a quoted uses value keeps its quotes and appends the old ref after the pin', async () => {
  const root = writeRepo({ '.github/workflows/quoted.yml': QUOTED });
  try {
    await withClient(root, async (client) => {
      const result = jsonOf(await client.callTool({
        name: 'plumber_fix',
        arguments: {
          configPath: '.github/workflows/quoted.yml',
          pins: { 'example/deploy@v1': FAKE_SHA }
        }
      }));
      const expectedLine = '      - uses: "example/deploy@' + FAKE_SHA + '" # v1 # production';
      const changed = changedLines(QUOTED, result.fixedText);
      assert.deepEqual(changed, [{
        line: 7,
        before: '      - uses: "example/deploy@v1" # production',
        after: expectedLine
      }]);
      const doc = yaml.load(result.fixedText);
      assert.equal(doc.jobs.build.steps[0].uses, 'example/deploy@' + FAKE_SHA);
      assert.equal(result.appliedFixes[0].before, '      - uses: "example/deploy@v1" # production');
      assert.equal(result.appliedFixes[0].after, expectedLine);
    });
  } finally {
    removeRepo(root);
  }
});

test('pins on a Dockerfile are unused and the file is unchanged', async () => {
  const docker = 'FROM scratch\n';
  await withClient(undefined, async (client) => {
    const result = jsonOf(await client.callTool({
      name: 'plumber_fix',
      arguments: {
        configText: docker,
        pins: { 'example/deploy@v1': FAKE_SHA }
      }
    }));
    assert.equal(result.fixedText, docker);
    assert.deepEqual(result.appliedFixes, []);
    assert.deepEqual(result.remainingFindings, []);
    assert.deepEqual(result.unusedPins, ['example/deploy@v1']);
  });
});

test('readme documents plumber_fix with the fake SHA and the 1.4.0 line', () => {
  const readme = fs.readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(readme.includes('### Fix it for me — plumber_fix'));
  assert.ok(readme.includes('fixed config'));
  assert.ok(readme.includes('auto-fix'));
  assert.ok(readme.includes(FAKE_SHA));
  assert.ok(readme.includes('## 1.4.0\nNew tool plumber_fix: pins actions to the SHAs you pass and returns the fixed config text; everything else is reported, not changed.'));
  assert.ok(readme.includes('| `plumber_fix` |'));
});
