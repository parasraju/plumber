const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'plumber.js');

const GITLAB_RULES = [
  ['pipe/gitlab-include-unpinned', 'MEDIUM', 'Pin ref: to a full commit SHA or a tag.'],
  ['sec/gitlab-artifact-secret', 'CRITICAL', 'Remove the file from artifacts: paths: and pass secrets via CI/CD variables.'],
  ['sec/gitlab-cache-shared', 'MEDIUM', 'Set an explicit per-branch key, e.g. key: $CI_COMMIT_REF_SLUG.'],
  ['sec/gitlab-allow-failure-gate', 'MEDIUM', 'Remove allow_failure: true from the gate job (or set it false).'],
  ['sec/gitlab-deploy-unprotected', 'HIGH', 'Add rules: restricting the job to protected branches or tags (e.g. rules: - if: $CI_COMMIT_BRANCH == "main").']
];

const REMOTE_BAD = [
  'include:',
  '  - remote: https://example.com/ci/base.yml',
  'job:',
  '  script:',
  '    - echo ok',
  ''
].join('\n');

const PROJECT_BAD = [
  'include:',
  '  - project: group/shared',
  '    file:',
  '      - /templates/deploy.yml',
  'job:',
  '  script:',
  '    - echo ok',
  ''
].join('\n');

const INCLUDE_CLEAN = [
  'include:',
  '  - project: group/ci-templates',
  '    ref: 0123456789abcdef0123456789abcdef01234567',
  '    file: /ci/base.yml',
  '  - project: group/ci-templates',
  '    ref: main',
  '    file: /ci/base.yml',
  '  - local: /ci/local.yml',
  '  - template: Security/SAST.gitlab-ci.yml',
  '  - project: group/missing-file',
  'job:',
  '  script:',
  '    - echo ok',
  ''
].join('\n');

const ARTIFACT_BAD = [
  'release:',
  '  script:',
  '    - echo pack',
  '  artifacts:',
  '    paths:',
  '      - dist/',
  '      - .env',
  '      - config/.env.production',
  '      - certs/server.pem',
  '      - keys/app.key',
  '      - deploy/id_rsa',
  '      - deploy/id_rsa.pub',
  ''
].join('\n');

const ARTIFACT_CLEAN = [
  'release:',
  '  script:',
  '    - echo pack',
  '  artifacts:',
  '    paths:',
  '      - dist/',
  '      - coverage/index.html',
  '      - .environment',
  ''
].join('\n');

const CACHE_BARE = [
  'cache:',
  '  paths:',
  '    - node_modules/',
  'job:',
  '  script:',
  '    - echo ok',
  ''
].join('\n');

const CACHE_CONST = [
  'job:',
  '  script:',
  '    - echo ok',
  '  cache:',
  '    key: shared-cache',
  '    paths:',
  '      - node_modules/',
  ''
].join('\n');

const CACHE_FILES = [
  'build:',
  '  script:',
  '    - echo ok',
  '  cache:',
  '    key:',
  '      files:',
  '        - package-lock.json',
  '    paths:',
  '      - node_modules/',
  ''
].join('\n');

const CACHE_CLEAN = [
  'cache:',
  '  key: $CI_COMMIT_REF_SLUG',
  '  paths:',
  '    - node_modules/',
  'default:',
  '  cache:',
  '    key:',
  '      prefix: $CI_COMMIT_REF_SLUG',
  '      files:',
  '        - package-lock.json',
  '    paths:',
  '      - .cache/',
  'job:',
  '  script:',
  '    - echo ok',
  '  cache:',
  '    - key: branch-$CI_COMMIT_REF_SLUG',
  '      paths:',
  '        - vendor/',
  ''
].join('\n');

const GATE_BAD = [
  'sast:',
  '  stage: test',
  '  script:',
  '    - echo scan',
  '  allow_failure: true',
  'Unit-Test:',
  '  script:',
  '    - echo unit',
  '  allow_failure: true',
  ''
].join('\n');

const GATE_CLEAN = [
  'sast:',
  '  script:',
  '    - echo scan',
  '  allow_failure: false',
  'deploy:',
  '  script:',
  '    - echo ship',
  '  allow_failure: true',
  'unit_test:',
  '  script:',
  '    - echo test',
  '  allow_failure:',
  '    exit_codes:',
  '      - 1',
  ''
].join('\n');

const DEPLOY_BAD = [
  'ship:',
  '  script:',
  '    - echo ship',
  '  environment: production',
  'promote:',
  '  script:',
  '    - echo promote',
  '  environment:',
  '    name: prod-eu',
  ''
].join('\n');

const DEPLOY_CLEAN = [
  'ship:',
  '  environment: production',
  '  rules:',
  '    - if: $CI_COMMIT_BRANCH == "main"',
  '  script:',
  '    - echo ship',
  'stage_only:',
  '  environment: staging',
  '  script:',
  '    - echo stage',
  'tagged:',
  '  environment:',
  '    name: production',
  '  only:',
  '    - main',
  '  script:',
  '    - echo tag',
  'excepted:',
  '  environment: Production',
  '  except:',
  '    - branches',
  '  script:',
  '    - echo except',
  ''
].join('\n');

const ALL_CLEAN = [
  INCLUDE_CLEAN.trimEnd(),
  'release:',
  '  image: node:20.11-alpine',
  '  script:',
  '    - echo pack',
  '  artifacts:',
  '    paths:',
  '      - dist/',
  '  cache:',
  '    key: $CI_COMMIT_REF_SLUG',
  '    paths:',
  '      - .cache/',
  '  environment: production',
  '  rules:',
  '    - if: $CI_COMMIT_BRANCH == "main"',
  'sast:',
  '  script:',
  '    - echo scan',
  '  allow_failure: false',
  'docs:',
  '  script:',
  '    - echo docs',
  '  allow_failure: true',
  ''
].join('\n');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return result;
}

function scanYaml(name, yamlText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-gl-'));
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yamlText, 'utf8');
  try {
    const result = run(['scan', root, '--format', 'json']);
    return { result, report: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function ids(report) {
  return report.issues.map((issue) => issue.rule_id);
}

function assertRule(report, ruleId, severity, fix) {
  const hit = report.issues.find((issue) => issue.rule_id === ruleId);
  assert.ok(hit, 'expected ' + ruleId + ' in ' + ids(report).join(','));
  assert.equal(hit.severity, severity);
  assert.equal(hit.fix, fix);
  assert.equal(Number.isInteger(hit.line) && hit.line >= 1, true);
  assert.equal(hit.evidence.length > 0, true);
  return hit;
}

function hits(report, ruleId) {
  return report.issues.filter((issue) => issue.rule_id === ruleId);
}

test('pipe/gitlab-include-unpinned flags a remote include', () => {
  const { report } = scanYaml('.gitlab-ci.yml', REMOTE_BAD);
  const hit = assertRule(report, GITLAB_RULES[0][0], GITLAB_RULES[0][1], GITLAB_RULES[0][2]);
  assert.equal(hit.line, 2);
  assert.match(hit.evidence, /example\.com\/ci\/base\.yml/);
  assert.equal(hits(report, 'pipe/gitlab-include-unpinned').length, 1);
});

test('pipe/gitlab-include-unpinned flags a project include with no ref', () => {
  const { report } = scanYaml('.gitlab-ci.yml', PROJECT_BAD);
  const hit = assertRule(report, GITLAB_RULES[0][0], GITLAB_RULES[0][1], GITLAB_RULES[0][2]);
  assert.equal(hit.line, 2);
  assert.match(hit.evidence, /group\/shared/);
});

test('pipe/gitlab-include-unpinned ignores a ref, a local file, and a template', () => {
  const { report } = scanYaml('.gitlab-ci.yml', INCLUDE_CLEAN);
  assert.equal(ids(report).includes('pipe/gitlab-include-unpinned'), false);
  assert.deepEqual(report.issues, []);
});

test('sec/gitlab-artifact-secret flags secret-bearing artifact paths', () => {
  const { report } = scanYaml('.gitlab-ci.yml', ARTIFACT_BAD);
  const found = hits(report, 'sec/gitlab-artifact-secret');
  assert.equal(found.length, 6);
  found.forEach((hit) => {
    assert.equal(hit.severity, 'CRITICAL');
    assert.equal(hit.fix, GITLAB_RULES[1][2]);
  });
  assert.deepEqual(found.map((hit) => hit.line), [7, 8, 9, 10, 11, 12]);
  assert.equal(ids(report).includes('sec/gitlab-artifact-secret') && found.some((hit) => hit.evidence.includes('dist/')), false);
});

test('sec/gitlab-artifact-secret ignores ordinary artifact paths', () => {
  const { report } = scanYaml('.gitlab-ci.yml', ARTIFACT_CLEAN);
  assert.equal(ids(report).includes('sec/gitlab-artifact-secret'), false);
  assert.deepEqual(report.issues, []);
});

test('sec/gitlab-cache-shared flags a default cache with no key', () => {
  const yamlText = [
    'default:',
    '  cache:',
    '    paths:',
    '      - node_modules/',
    'job:',
    '  script:',
    '    - echo ok',
    ''
  ].join('\n');
  const { report } = scanYaml('.gitlab-ci.yml', yamlText);
  const hit = assertRule(report, GITLAB_RULES[2][0], GITLAB_RULES[2][1], GITLAB_RULES[2][2]);
  assert.equal(hit.line, 2);
  assert.match(hit.evidence, /cache:/);
});

test('sec/gitlab-cache-shared flags a cache with no key', () => {
  const { report } = scanYaml('.gitlab-ci.yml', CACHE_BARE);
  const hit = assertRule(report, GITLAB_RULES[2][0], GITLAB_RULES[2][1], GITLAB_RULES[2][2]);
  assert.equal(hit.line, 1);
  assert.match(hit.evidence, /cache:/);
});

test('sec/gitlab-cache-shared flags a constant cache key', () => {
  const { report } = scanYaml('.gitlab-ci.yml', CACHE_CONST);
  const hit = assertRule(report, GITLAB_RULES[2][0], GITLAB_RULES[2][1], GITLAB_RULES[2][2]);
  assert.equal(hit.line, 5);
  assert.match(hit.evidence, /shared-cache/);
});

test('sec/gitlab-cache-shared flags a files key with no branch prefix', () => {
  const { report } = scanYaml('.gitlab-ci.yml', CACHE_FILES);
  const hit = assertRule(report, GITLAB_RULES[2][0], GITLAB_RULES[2][1], GITLAB_RULES[2][2]);
  assert.equal(hit.line, 5);
  assert.match(hit.evidence, /key:/);
});

test('sec/gitlab-cache-shared ignores a per-branch key and prefix', () => {
  const { report } = scanYaml('.gitlab-ci.yml', CACHE_CLEAN);
  assert.equal(ids(report).includes('sec/gitlab-cache-shared'), false);
  assert.deepEqual(report.issues, []);
});

test('sec/gitlab-allow-failure-gate flags a security or test job', () => {
  const { report } = scanYaml('.gitlab-ci.yml', GATE_BAD);
  const found = hits(report, 'sec/gitlab-allow-failure-gate');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((hit) => hit.line), [5, 9]);
  found.forEach((hit) => {
    assert.equal(hit.severity, 'MEDIUM');
    assert.equal(hit.fix, GITLAB_RULES[3][2]);
    assert.match(hit.evidence, /allow_failure:\s*true/);
  });
});

test('sec/gitlab-allow-failure-gate ignores a non-gate job and an exit-code allow', () => {
  const { report } = scanYaml('.gitlab-ci.yml', GATE_CLEAN);
  assert.equal(ids(report).includes('sec/gitlab-allow-failure-gate'), false);
  assert.deepEqual(report.issues, []);
});

test('sec/gitlab-deploy-unprotected flags a production environment with no ref limit', () => {
  const { report } = scanYaml('.gitlab-ci.yml', DEPLOY_BAD);
  const found = hits(report, 'sec/gitlab-deploy-unprotected');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((hit) => hit.line), [4, 8]);
  found.forEach((hit) => {
    assert.equal(hit.severity, 'HIGH');
    assert.equal(hit.fix, GITLAB_RULES[4][2]);
    assert.match(hit.evidence, /environment:/);
  });
});

test('sec/gitlab-deploy-unprotected ignores rules, only, except, and non-prod names', () => {
  const { report } = scanYaml('.gitlab-ci.yml', DEPLOY_CLEAN);
  assert.equal(ids(report).includes('sec/gitlab-deploy-unprotected'), false);
  assert.deepEqual(report.issues, []);
});

test('a clean .gitlab-ci.yml passes all five GitLab rules', () => {
  const { report } = scanYaml('.gitlab-ci.yml', ALL_CLEAN);
  for (const [ruleId] of GITLAB_RULES) {
    assert.equal(ids(report).includes(ruleId), false, ruleId);
  }
  assert.deepEqual(report.issues, []);
});

test('GitLab rules scan .gitlab-ci.yaml and a nested path', () => {
  const nested = scanYaml(path.join('team', 'app', '.gitlab-ci.yaml'), REMOTE_BAD);
  assert.equal(ids(nested.report).includes('pipe/gitlab-include-unpinned'), true);
  assert.equal(nested.report.file_reports[0].path, 'team/app/.gitlab-ci.yaml');
});

test('the same include in a non-GitLab YAML file is not a GitLab finding', () => {
  const { report } = scanYaml('ci.yml', REMOTE_BAD);
  assert.equal(ids(report).includes('pipe/gitlab-include-unpinned'), false);
  assert.deepEqual(report.issues, []);
});

test('a single .gitlab-ci.yml path is scanned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-gl-'));
  const filePath = path.join(root, '.gitlab-ci.yml');
  fs.writeFileSync(filePath, REMOTE_BAD, 'utf8');
  try {
    const result = run(['scan', filePath, '--format', 'json']);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(ids(report).includes('pipe/gitlab-include-unpinned'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic YAML rules on .gitlab-ci.yml stay the same', () => {
  const token = 'sk-' + 'live1234567890abcdef1234567890abcd';
  const yamlText = [
    'job:',
    '  image: node',
    '  script:',
    '    - curl https://example.com/install.sh | bash',
    '    - npm install left-pad',
    '    - echo ' + token,
    ''
  ].join('\n');
  const { report } = scanYaml('.gitlab-ci.yml', yamlText);
  const generic = report.issues.filter((issue) => !issue.rule_id.startsWith('sec/gitlab-') && issue.rule_id !== 'pipe/gitlab-include-unpinned');
  assert.deepEqual(generic.map((issue) => [issue.rule_id, issue.severity, issue.line, issue.evidence, issue.fix]), [
    ['leak/api-key', 'CRITICAL', 6, ('- echo ' + token).slice(0, 90), 'Extract secret to .env file immediately.'],
    ['pipe/docker-unpinned', 'MEDIUM', 2, 'image: node', 'Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine).'],
    ['sec/curl-pipe-shell', 'CRITICAL', 4, '- curl https://example.com/install.sh | bash', 'Download script first, verify its SHA256 checksum or signature, then execute it.'],
    ['pipe/npm-unpinned', 'MEDIUM', 5, '- npm install left-pad', 'Use npm ci to enforce lockfile versions or pass --save-exact when adding packages.']
  ]);
  for (const [ruleId] of GITLAB_RULES) {
    assert.equal(ids(report).includes(ruleId), false);
  }
});

test('a malformed .gitlab-ci.yml logs the parse error and the scan continues', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-gl-'));
  fs.writeFileSync(path.join(root, '.gitlab-ci.yml'), 'include: [\n  remote: [\n', 'utf8');
  const nested = path.join(root, 'ci');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, '.gitlab-ci.yml'), REMOTE_BAD, 'utf8');
  try {
    const result = run(['scan', root, '--format', 'json']);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /Failed to parse workflow YAML/);
    assert.match(result.stderr, /\.gitlab-ci\.yml/);
    const report = JSON.parse(result.stdout);
    assert.equal(report.total_files >= 2, true);
    assert.equal(ids(report).filter((id) => id === 'pipe/gitlab-include-unpinned').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
