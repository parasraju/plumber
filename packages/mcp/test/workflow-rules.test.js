const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RULES, scanLocalDirectory, scanText } = require('../src/engine.js');

const ORIGINAL_IDS = [
  'leak/api-key',
  'leak/committed-env',
  'leak/hardcoded-secret',
  'sec/raw-html',
  'clog/elided-code',
  'clog/swallowed-error',
  'clog/stub-function',
  'clog/step-comments',
  'clog/dead-code',
  'slop/pointless-wrapper',
  'joint/icon-button',
  'joint/clickable-div',
  'joint/empty-test',
  'joint/focus-removed',
  'pipe/phantom-import',
  'pipe/dead-link',
  'slop/ai-gradient',
  'slop/chatbot-residue',
  'slop/neon-glow',
  'slop/gradient-text',
  'ui/important-abuse'
];

const NEW_IDS = [
  'sec/pull-request-target',
  'sec/expression-injection',
  'pipe/action-unpinned',
  'sec/job-permissions',
  'sec/secret-to-untrusted'
];

const PINNED = '0123456789abcdef0123456789abcdef01234567';

function ids(report) {
  return report.issues.map((issue) => issue.rule_id);
}

function one(report, ruleId) {
  const found = report.issues.filter((issue) => issue.rule_id === ruleId);
  assert.equal(found.length, 1, ruleId + ' => ' + JSON.stringify(report.issues, null, 2));
  return found[0];
}

function yaml(lines) {
  return lines.join('\n') + '\n';
}

function writeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-mcp-'));
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

test('rule catalogue keeps the original 21 ids and appends five workflow rules', () => {
  assert.equal(RULES.length, 26);
  assert.deepEqual(RULES.slice(0, 21).map((rule) => rule.id), ORIGINAL_IDS);
  assert.deepEqual(RULES.slice(21).map((rule) => rule.id), NEW_IDS);
  const byId = Object.fromEntries(RULES.map((rule) => [rule.id, rule]));
  assert.equal(byId['sec/pull-request-target'].sev, 'CRITICAL');
  assert.equal(byId['sec/expression-injection'].sev, 'CRITICAL');
  assert.equal(byId['pipe/action-unpinned'].sev, 'MEDIUM');
  assert.equal(byId['sec/job-permissions'].sev, 'HIGH');
  assert.equal(byId['sec/secret-to-untrusted'].sev, 'HIGH');
});

test('pull_request_target checkout of the PR head is flagged, and the fix is plain English', () => {
  const report = scanText(yaml([
    'name: pull-request',
    'on: pull_request_target',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}'
  ]), '.github/workflows/pr.yml');
  const issue = one(report, 'sec/pull-request-target');
  assert.equal(issue.severity, 'CRITICAL');
  assert.equal(issue.line, 9);
  assert.match(issue.evidence, /github\.event\.pull_request\.head\.sha/);
  assert.equal(issue.fix, 'Use pull_request, or check out the base ref read-only with no secrets.');
});

test('pull_request_target with write-all is flagged even without an untrusted checkout', () => {
  const report = scanText(yaml([
    'name: label',
    'on: pull_request_target',
    'permissions: write-all',
    'jobs:',
    '  label:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo hello'
  ]), '.github/workflows/label.yml');
  const issue = one(report, 'sec/pull-request-target');
  assert.match(issue.evidence, /write-all/);
});

test('pull_request_target that checks out the base ref read-only is clean', () => {
  const report = scanText(yaml([
    'name: triage',
    'on:',
    '  pull_request_target:',
    '    types: [opened]',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  triage:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: echo base-ref-only'
  ]), '.github/workflows/triage.yml');
  assert.deepEqual(ids(report), []);
});

test('a pull_request trigger that checks out the head ref is not pull_request_target', () => {
  const report = scanText(yaml([
    'name: pr',
    'on: pull_request',
    'permissions:',
    '  contents: write',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '      - run: npm test'
  ]), '.github/workflows/pr.yml');
  assert.equal(ids(report).includes('sec/pull-request-target'), false);
  assert.equal(ids(report).includes('sec/job-permissions'), false);
});

test('an aliased checkout ref on pull_request_target is still flagged', () => {
  const report = scanText(yaml([
    'on: pull_request_target',
    'x-checkout: &untrusted',
    '  ref: ${{ github.event.pull_request.head.sha }}',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with: *untrusted'
  ]), '.github/workflows/alias.yml');
  one(report, 'sec/pull-request-target');
});

test('github.event and github.head_ref inside run are expression injection', () => {
  const inline = scanText(yaml([
    'on: issues',
    'jobs:',
    '  greet:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo "${{ github.event.issue.title }}"'
  ]), '.github/workflows/greet.yml');
  const inlineIssue = one(inline, 'sec/expression-injection');
  assert.equal(inlineIssue.severity, 'CRITICAL');
  assert.equal(inlineIssue.fix, 'Pass the value through an env: variable and reference that variable in the script.');
  assert.match(inlineIssue.evidence, /github\.event\.issue\.title/);

  const block = scanText(yaml([
    'on: pull_request',
    'jobs:',
    '  greet:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    '          echo "${{ github.head_ref }}"'
  ]), '.github/workflows/head.yml');
  const blockIssue = one(block, 'sec/expression-injection');
  assert.equal(blockIssue.line, 7);
  assert.match(blockIssue.evidence, /github\.head_ref/);
});

test('the same expressions passed through env are not injection, and github.sha is not either', () => {
  const envPassed = scanText(yaml([
    'on: issues',
    'jobs:',
    '  greet:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - env:',
    '          TITLE: ${{ github.event.issue.title }}',
    '          HEAD: ${{ github.head_ref }}',
    '          NAME: ${{ inputs.name }}',
    '        run: echo "$TITLE $HEAD $NAME"'
  ]), '.github/workflows/greet.yml');
  assert.equal(ids(envPassed).includes('sec/expression-injection'), false);

  const sha = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo "${{ github.sha }}"'
  ]), '.github/workflows/sha.yml');
  assert.deepEqual(ids(sha), []);
});

test('an anchored run script still counts as expression injection', () => {
  const report = scanText(yaml([
    'on: push',
    'x-run: &injected |',
    '  echo "${{ github.head_ref }}"',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: *injected'
  ]), '.github/workflows/anchor.yml');
  one(report, 'sec/expression-injection');
});

test('a third-party action on a tag or branch is unpinned, and a SHA pin is not', () => {
  const tagged = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: example/deploy@v1'
  ]), '.github/workflows/build.yml');
  const issue = one(tagged, 'pipe/action-unpinned');
  assert.equal(issue.severity, 'MEDIUM');
  assert.equal(issue.fix, 'Pin the action to a full commit SHA.');
  assert.match(issue.evidence, /example\/deploy@v1/);

  const branch = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: example/deploy@main'
  ]), '.github/workflows/build.yml');
  one(branch, 'pipe/action-unpinned');

  const clean = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: github/codeql-action/init@v3',
    '      - uses: example/deploy@' + PINNED,
    '      - uses: ./.github/actions/build',
    '      - uses: docker://node:20'
  ]), '.github/workflows/build.yml');
  assert.equal(ids(clean).includes('pipe/action-unpinned'), false);
});

test('a job that pushes with no permissions is flagged, and contents: write on that push is not', () => {
  const missing = scanText(yaml([
    'on: push',
    'jobs:',
    '  release:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: git push origin HEAD'
  ]), '.github/workflows/release.yml');
  const missingIssue = one(missing, 'sec/job-permissions');
  assert.equal(missingIssue.severity, 'HIGH');
  assert.equal(missingIssue.fix, 'Set least-privilege permissions on the job.');
  assert.match(missingIssue.evidence, /git push/);

  const least = scanText(yaml([
    'on: push',
    'jobs:',
    '  release:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: write',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: gh release create v1 --notes "ship"'
  ]), '.github/workflows/release.yml');
  assert.equal(ids(least).includes('sec/job-permissions'), false);

  const broad = scanText(yaml([
    'on: push',
    'permissions: write-all',
    'jobs:',
    '  release:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: git push origin HEAD'
  ]), '.github/workflows/release.yml');
  assert.match(one(broad, 'sec/job-permissions').evidence, /write-all/);
});

test('contents: write on a deploy-only job is flagged, including when the permission is merged from an anchor', () => {
  const deploy = scanText(yaml([
    'on: push',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: write',
    '    steps:',
    '      - run: npm publish'
  ]), '.github/workflows/publish.yml');
  assert.match(one(deploy, 'sec/job-permissions').evidence, /contents:\s*write/);

  const merged = scanText(yaml([
    'on: push',
    'x-perms: &broad',
    '  contents: write',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      <<: *broad',
    '    steps:',
    '      - run: npm publish'
  ]), '.github/workflows/publish.yml');
  one(merged, 'sec/job-permissions');

  const narrow = scanText(yaml([
    'on: push',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    '      id-token: write',
    '    steps:',
    '      - run: npm publish'
  ]), '.github/workflows/publish.yml');
  assert.equal(ids(narrow).includes('sec/job-permissions'), false);

  const testsOnly = scanText(yaml([
    'on: push',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: write',
    '    steps:',
    '      - run: npm test'
  ]), '.github/workflows/test.yml');
  assert.deepEqual(ids(testsOnly), []);
});

test('a secret on a third-party action is flagged, and a secret kept on a run step is not', () => {
  const passed = scanText(yaml([
    'on: push',
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: example/deploy@' + PINNED,
    '        env:',
    '          TOKEN: ${{ secrets.DEPLOY_TOKEN }}'
  ]), '.github/workflows/deploy.yml');
  const issue = one(passed, 'sec/secret-to-untrusted');
  assert.equal(issue.severity, 'HIGH');
  assert.equal(issue.fix, 'Scope the secret to the trusted step that needs it.');
  assert.equal(ids(passed).includes('pipe/action-unpinned'), false);

  const inherited = scanText(yaml([
    'on: push',
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      TOKEN: ${{ secrets.DEPLOY_TOKEN }}',
    '    steps:',
    '      - uses: example/deploy@' + PINNED
  ]), '.github/workflows/deploy.yml');
  one(inherited, 'sec/secret-to-untrusted');

  const scoped = scanText(yaml([
    'on: push',
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: example/deploy@' + PINNED,
    '      - env:',
    '          TOKEN: ${{ secrets.DEPLOY_TOKEN }}',
    '        run: echo "$TOKEN"'
  ]), '.github/workflows/deploy.yml');
  assert.equal(ids(scoped).includes('sec/secret-to-untrusted'), false);

  const firstParty = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          token: ${{ secrets.GITHUB_TOKEN }}'
  ]), '.github/workflows/build.yml');
  assert.deepEqual(ids(firstParty), []);
});

test('secrets: inherit on a third-party reusable workflow is flagged', () => {
  const report = scanText(yaml([
    'on: push',
    'jobs:',
    '  call:',
    '    uses: example/repo/.github/workflows/build.yml@v1',
    '    secrets: inherit'
  ]), '.github/workflows/call.yml');
  assert.equal(ids(report).includes('sec/secret-to-untrusted'), true);
  one(report, 'pipe/action-unpinned');
});

test('a clean workflow does not trip any new rule', () => {
  const report = scanText(yaml([
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
  ]), '.github/workflows/ci.yml');
  assert.deepEqual(ids(report), []);
});

test('directory scan applies workflow rules only under .github/workflows', () => {
  const js = 'function load() {\n  try {\n    return 1;\n  } catch (err) {}\n}\n';
  const hidden = 'const key = "AKIAIOSFODNN7EXAMPLE";\n';
  const gitlab = 'image: node:latest\nrun:\n  - curl https://example.com/install.sh | bash\n';
  const stray = yaml([
    'on: pull_request_target',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: example/deploy@v1'
  ]);
  const root = writeRepo({
    'src/app.js': js,
    '.github/scripts/hidden.js': hidden,
    '.gitlab-ci.yml': gitlab,
    'config.yml': stray
  });
  try {
    const before = scanLocalDirectory(root);
    assert.equal(before.total_files, 1);
    assert.deepEqual(ids(before), ['clog/swallowed-error']);

    const workflow = yaml([
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: example/deploy@v1'
    ]);
    const withWorkflow = writeRepo({
      'src/app.js': js,
      '.github/scripts/hidden.js': hidden,
      '.gitlab-ci.yml': gitlab,
      'config.yml': stray,
      '.github/workflows/build.yml': workflow
    });
    try {
      const after = scanLocalDirectory(withWorkflow);
      assert.equal(after.total_files, 2);
      assert.deepEqual(ids(after).sort(), ['clog/swallowed-error', 'pipe/action-unpinned']);
      const direct = scanLocalDirectory(path.join(withWorkflow, '.github', 'workflows', 'build.yml'));
      assert.equal(direct.total_files, 1);
      assert.deepEqual(ids(direct), ['pipe/action-unpinned']);
      assert.match(direct.file_reports[0].path.replace(/\\/g, '/'), /\.github\/workflows\/build\.yml$/);
    } finally {
      removeRepo(withWorkflow);
    }
  } finally {
    removeRepo(root);
  }
});

test('invalid workflow YAML does not crash, and a repo with no workflows is unchanged', () => {
  const root = writeRepo({
    'src/app.js': 'const value = 1;\n',
    '.github/workflows/broken.yml': ':\n  - [\n'
  });
  try {
    const report = scanLocalDirectory(root);
    assert.equal(report.total_files, 2);
    assert.deepEqual(ids(report), []);
  } finally {
    removeRepo(root);
  }
});

test('plumber_scan_text on a non-workflow snippet stays on the old rules', () => {
  const report = scanText('const k = "AKIAIOSFODNN7EXAMPLE";', 'src/latest.js');
  assert.deepEqual(ids(report), ['leak/api-key']);
  assert.equal(report.issues[0].title, 'Leaked AWS Access Key ID');

  const plain = scanText('function add(a, b) {\n  return a + b;\n}\n', 'src/add.js');
  assert.deepEqual(ids(plain), []);

  const pasted = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: example/deploy@v1'
  ]), 'snippet.yml');
  assert.deepEqual(ids(pasted), ['pipe/action-unpinned']);

  const byPath = scanText(yaml([
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo "${{ github.event.issue.title }}"'
  ]), 'workflows/ci.yaml');
  one(byPath, 'sec/expression-injection');
});

test('mcp server speaks stdio and keeps the three tool schemas', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-mcp-empty-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '../bin/plumber-mcp.js')],
    stderr: 'ignore'
  });
  const client = new Client({ name: 'plumber-mcp-test', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    assert.deepEqual(client.getServerVersion(), { name: 'plumber-mcp', version: '1.1.0' });
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['plumber_scan', 'plumber_list_rules', 'plumber_scan_text']);
    assert.equal(listed.tools.length, 3);
    assert.deepEqual(listed.tools[0].inputSchema, {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Directory or file path to scan (default ".")' }
      },
      additionalProperties: false
    });
    assert.deepEqual(listed.tools[1].inputSchema, {
      type: 'object',
      properties: {},
      additionalProperties: false
    });
    assert.deepEqual(listed.tools[2].inputSchema, {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Code or config snippet to scan' },
        filename: { type: 'string', description: 'Optional filename used to select applicable rules (e.g. app.js)' }
      },
      required: ['text'],
      additionalProperties: false
    });
    assert.equal(listed.tools[0].description, 'Scan a local directory or file for leaked secrets, dead code, and AI slop. Returns a score and fixes.');
    assert.equal(listed.tools[1].description, 'List all Plumber inspection rules with severity, title, and recommended fix.');
    assert.equal(listed.tools[2].description, 'Scan a pasted code or config snippet for leaked secrets, dead code, and AI slop.');

    const rules = await client.callTool({ name: 'plumber_list_rules', arguments: {} });
    const lines = rules.content[0].text.split('\n');
    assert.equal(lines.length, 26);
    assert.deepEqual(lines.slice(0, 21).map((line) => line.split(' ')[0]), ORIGINAL_IDS);
    assert.deepEqual(lines.slice(21).map((line) => line.split(' ')[0]), NEW_IDS);

    const emptyScan = await client.callTool({ name: 'plumber_scan', arguments: { target: empty } });
    const emptyText = emptyScan.content[0].text;
    assert.match(emptyText, /Files: 0 \| Issues: 0/);
    assert.match(emptyText, /No scannable files found, so nothing was checked\. Supported: \.py \.js \.jsx \.ts \.tsx \.html \.htm \.css \.scss \.env and \.env\* files\./);
    assert.equal(emptyText.includes('sec/pull-request-target'), false);

    const snippet = await client.callTool({
      name: 'plumber_scan_text',
      arguments: { text: 'const k = "AKIAIOSFODNN7EXAMPLE";', filename: 'src/latest.js' }
    });
    const snippetText = snippet.content[0].text;
    assert.match(snippetText, /\[CRITICAL\] Leaked AWS Access Key ID/);
    assert.equal(snippetText.includes('Unpinned Third-Party Action'), false);
    assert.equal(snippetText.includes('Expression Injection'), false);
  } finally {
    await client.close();
    removeRepo(empty);
  }
});
