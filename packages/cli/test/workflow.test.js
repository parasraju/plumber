const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'plumber.js');
const cleanDir = path.join(__dirname, 'fixtures', 'clean');
const PINNED = '0123456789abcdef0123456789abcdef01234567';

const WORKFLOW_RULES = [
  ['sec/pull-request-target', 'CRITICAL', 'Use pull_request, or check out the base ref read-only with no secrets.'],
  ['sec/expression-injection', 'CRITICAL', 'Pass the value through an env: variable and reference that variable in the script.'],
  ['pipe/action-unpinned', 'MEDIUM', 'Pin the action to a full commit SHA.'],
  ['sec/job-permissions', 'HIGH', 'Set least-privilege permissions on the job.'],
  ['sec/secret-to-untrusted', 'HIGH', 'Scope the secret to the trusted step that needs it.']
];

const PRT_BAD = [
  'name: review',
  'on:',
  '  pull_request_target:',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
  ''
].join('\n');

const PRT_CLEAN = [
  'name: review',
  'on:',
  '  pull_request:',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}',
  ''
].join('\n');

const INJECT_BAD = [
  'name: inject',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo ${{ github.head_ref }}',
  ''
].join('\n');

const INJECT_CLEAN = [
  'name: inject',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: show',
  '        env:',
  '          HEAD_REF: ${{ github.head_ref }}',
  '        run: echo "$HEAD_REF"',
  ''
].join('\n');

const UNPINNED = [
  'name: build',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: example/action@v1',
  ''
].join('\n');

const PINNED_ACTION = [
  'name: build',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: example/action@' + PINNED,
  ''
].join('\n');

const JOB_PERMS_BAD = [
  'name: release',
  'on: push',
  'jobs:',
  '  publish:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: git push origin HEAD',
  ''
].join('\n');

const JOB_PERMS_CLEAN = [
  'name: release',
  'on: push',
  'jobs:',
  '  publish:',
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: write',
  '    steps:',
  '      - run: git push origin HEAD',
  ''
].join('\n');

const SECRET_BAD = [
  'name: deploy',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: example/action@' + PINNED,
  '        with:',
  '          token: ${{ secrets.DEPLOY_TOKEN }}',
  ''
].join('\n');

const SECRET_CLEAN = [
  'name: deploy',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: example/action@' + PINNED,
  '      - name: publish',
  '        env:',
  '          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}',
  '        run: echo "$DEPLOY_TOKEN"',
  ''
].join('\n');

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function ids(report) {
  return report.issues.map((issue) => issue.rule_id);
}

function withWorkflow(name, yamlText, scanRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-wf-'));
  const filePath = path.join(root, '.github', 'workflows', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yamlText, 'utf8');
  try {
    const target = scanRoot ? root : filePath;
    return JSON.parse(run(['scan', target, '--format', 'json']));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertRule(report, ruleId, severity, fix) {
  const hit = report.issues.find((issue) => issue.rule_id === ruleId);
  assert.ok(hit, 'expected ' + ruleId);
  assert.equal(hit.severity, severity);
  assert.equal(hit.fix, fix);
  assert.equal(Number.isInteger(hit.line) && hit.line >= 1, true);
  assert.equal(hit.evidence.length > 0, true);
  return hit;
}

test('sec/pull-request-target flags an untrusted pull_request_target checkout', () => {
  const report = withWorkflow('prt.yml', PRT_BAD, true);
  const hit = assertRule(report, WORKFLOW_RULES[0][0], WORKFLOW_RULES[0][1], WORKFLOW_RULES[0][2]);
  assert.match(hit.evidence, /github\.event\.pull_request\.head\.sha/);
});

test('sec/pull-request-target does not flag a pull_request trigger', () => {
  const report = withWorkflow('pr.yml', PRT_CLEAN, true);
  assert.equal(ids(report).includes('sec/pull-request-target'), false);
  assert.deepEqual(report.issues, []);
});

test('sec/expression-injection flags an attacker-controlled expression in run', () => {
  const report = withWorkflow('inject.yml', INJECT_BAD, true);
  const hit = assertRule(report, WORKFLOW_RULES[1][0], WORKFLOW_RULES[1][1], WORKFLOW_RULES[1][2]);
  assert.match(hit.evidence, /github\.head_ref/);
});

test('sec/expression-injection does not flag a value passed through env', () => {
  const report = withWorkflow('inject-safe.yml', INJECT_CLEAN, true);
  assert.equal(ids(report).includes('sec/expression-injection'), false);
  assert.deepEqual(report.issues, []);
});

test('pipe/action-unpinned flags a third-party action on a tag', () => {
  const report = withWorkflow('unpinned.yml', UNPINNED, true);
  const hit = assertRule(report, WORKFLOW_RULES[2][0], WORKFLOW_RULES[2][1], WORKFLOW_RULES[2][2]);
  assert.match(hit.evidence, /example\/action@v1/);
});

test('pipe/action-unpinned does not flag a full commit SHA', () => {
  const report = withWorkflow('pinned.yml', PINNED_ACTION, true);
  assert.equal(ids(report).includes('pipe/action-unpinned'), false);
  assert.deepEqual(report.issues, []);
});

test('pipe/action-unpinned also scans .yaml workflow files', () => {
  const report = withWorkflow('unpinned.yaml', UNPINNED, true);
  assert.equal(ids(report).includes('pipe/action-unpinned'), true);
});

test('sec/job-permissions flags a push job with no permissions block', () => {
  const report = withWorkflow('push.yml', JOB_PERMS_BAD, true);
  const hit = assertRule(report, WORKFLOW_RULES[3][0], WORKFLOW_RULES[3][1], WORKFLOW_RULES[3][2]);
  assert.match(hit.evidence, /git push/);
  assert.equal(ids(report).includes('sec/permissions-write-all'), false);
});

test('sec/job-permissions does not flag least-privilege contents write on a push', () => {
  const report = withWorkflow('push-ok.yml', JOB_PERMS_CLEAN, true);
  assert.equal(ids(report).includes('sec/job-permissions'), false);
  assert.equal(ids(report).includes('sec/permissions-write-all'), true);
});

test('sec/secret-to-untrusted flags a secret passed to a third-party action', () => {
  const report = withWorkflow('secret.yml', SECRET_BAD, true);
  const hit = assertRule(report, WORKFLOW_RULES[4][0], WORKFLOW_RULES[4][1], WORKFLOW_RULES[4][2]);
  assert.match(hit.evidence, /secrets\.DEPLOY_TOKEN/);
});

test('sec/secret-to-untrusted does not flag a secret scoped to a run step', () => {
  const report = withWorkflow('secret-ok.yml', SECRET_CLEAN, true);
  assert.equal(ids(report).includes('sec/secret-to-untrusted'), false);
  assert.deepEqual(report.issues, []);
});

test('scan accepts a single workflow file path', () => {
  const report = withWorkflow('prt.yml', PRT_BAD, false);
  assert.equal(ids(report).includes('sec/pull-request-target'), true);
});

test('YAML outside .github/workflows is not structurally scanned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-wf-'));
  fs.writeFileSync(path.join(root, 'ci.yml'), PRT_BAD, 'utf8');
  try {
    const report = JSON.parse(run(['scan', root, '--format', 'json']));
    assert.equal(ids(report).includes('sec/pull-request-target'), false);
    assert.deepEqual(report.issues, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a directory with no workflow files has no findings and no YAML error', () => {
  const result = spawnSync(process.execPath, [cli, 'scan', cleanDir, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || '').trim(), '');
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.issues, []);
});

test('a workflow parse error names the file and the scan continues', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-wf-'));
  const wfDir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'broken.yml'), 'on: [\njobs:\n  build: [\n', 'utf8');
  fs.writeFileSync(path.join(wfDir, 'unpinned.yml'), UNPINNED, 'utf8');
  try {
    const result = spawnSync(process.execPath, [cli, 'scan', root, '--format', 'json'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /Failed to parse workflow YAML/);
    assert.match(result.stderr, /broken\.yml/);
    const report = JSON.parse(result.stdout);
    assert.equal(report.total_files >= 2, true);
    assert.equal(ids(report).includes('pipe/action-unpinned'), true);
    assert.equal(ids(report).filter((id) => id === 'pipe/action-unpinned').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sarif lists the workflow rules and one result per workflow finding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-wf-'));
  const filePath = path.join(root, '.github', 'workflows', 'unpinned.yml');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, UNPINNED, 'utf8');
  try {
    const sarif = JSON.parse(run(['scan', root, '--format', 'sarif']));
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
    assert.equal(sarif.version, '2.1.0');
    const driver = sarif.runs[0].tool.driver;
    assert.equal(driver.name, 'plumber-linter');
    assert.equal(driver.version, '1.5.0');
    const ruleIds = driver.rules.map((rule) => rule.id);
    for (const [id] of WORKFLOW_RULES) {
      assert.equal(ruleIds.includes(id), true);
    }
    const hits = sarif.runs[0].results.filter((result) => result.ruleId === 'pipe/action-unpinned');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].message.text.includes('Pin the action to a full commit SHA.'), true);
    assert.equal(hits[0].locations[0].physicalLocation.artifactLocation.uri, '.github/workflows/unpinned.yml');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
