const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'plumber.js');
const fixtures = path.join(__dirname, 'fixtures');
const cleanDir = path.join(fixtures, 'clean');

const RULE_LEVELS = [
  ['leak/api-key', 'error'],
  ['leak/committed-env', 'error'],
  ['leak/hardcoded-secret', 'error'],
  ['sec/raw-html', 'warning'],
  ['clog/elided-code', 'error'],
  ['clog/swallowed-error', 'error'],
  ['clog/stub-function', 'warning'],
  ['clog/step-comments', 'note'],
  ['clog/dead-code', 'error'],
  ['slop/pointless-wrapper', 'note'],
  ['joint/icon-button', 'error'],
  ['joint/clickable-div', 'error'],
  ['joint/empty-test', 'error'],
  ['joint/focus-removed', 'warning'],
  ['pipe/phantom-import', 'error'],
  ['pipe/dead-link', 'warning'],
  ['slop/ai-gradient', 'warning'],
  ['slop/chatbot-residue', 'warning'],
  ['slop/neon-glow', 'note'],
  ['slop/gradient-text', 'note'],
  ['ui/important-abuse', 'note'],
  ['pipe/docker-unpinned', 'warning'],
  ['sec/curl-pipe-shell', 'error'],
  ['sec/permissions-write-all', 'error'],
  ['leak/slack-webhook', 'error'],
  ['pipe/npm-unpinned', 'warning'],
  ['sec/pull-request-target', 'error'],
  ['sec/expression-injection', 'error'],
  ['pipe/action-unpinned', 'warning'],
  ['sec/job-permissions', 'error'],
  ['sec/secret-to-untrusted', 'error'],
  ['pipe/gitlab-include-unpinned', 'warning'],
  ['sec/gitlab-artifact-secret', 'error'],
  ['sec/gitlab-cache-shared', 'warning'],
  ['sec/gitlab-allow-failure-gate', 'warning'],
  ['sec/gitlab-deploy-unprotected', 'error']
];

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function scanSample(format) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-format-'));
  const sampleDir = path.join(root, 'sample');
  fs.mkdirSync(sampleDir);
  fs.copyFileSync(path.join(fixtures, 'sample-ci.yml.txt'), path.join(sampleDir, 'ci.yml'));
  try {
    return run(['scan', sampleDir, '--format', format]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('rules command lists the registered rules', () => {
  const output = run(['rules']);
  assert.match(output, /Plumber Inspection Rules \(36 registered\)/);
  const ids = [...output.matchAll(/\] (\S+) \(/g)].map((match) => match[1]);
  assert.deepEqual(ids, RULE_LEVELS.map(([id]) => id));
});

test('markdown and json output stay byte-identical', () => {
  const md = scanSample('md');
  const json = scanSample('json');
  assert.equal(md, fs.readFileSync(path.join(fixtures, 'expected.md'), 'utf8'));
  assert.equal(json, fs.readFileSync(path.join(fixtures, 'expected.json'), 'utf8'));
});

test('sarif output is SARIF 2.1.0 and keeps the plain-English fix', () => {
  const report = JSON.parse(scanSample('json'));
  const sarif = JSON.parse(scanSample('sarif'));
  const run = sarif.runs[0];
  const driver = run.tool.driver;

  assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  assert.equal(sarif.version, '2.1.0');
  assert.equal(driver.name, 'plumber-linter');
    assert.equal(driver.version, '1.6.1');
  assert.equal(driver.informationUri, 'https://github.com/parasraju/plumber');
  assert.equal(driver.rules.length, 36);
  assert.deepEqual(driver.rules.map((rule) => rule.id), RULE_LEVELS.map(([id]) => id));

  driver.rules.forEach((rule, index) => {
    const [id, level] = RULE_LEVELS[index];
    assert.equal(rule.id, id);
    assert.equal(typeof rule.name, 'string');
    assert.equal(rule.name.length > 0, true);
    assert.equal(typeof rule.shortDescription.text, 'string');
    assert.equal(typeof rule.fullDescription.text, 'string');
    assert.equal(rule.help.text.length > 0, true);
    assert.equal(rule.defaultConfiguration.level, level);
  });

  const curlRule = driver.rules.find((rule) => rule.id === 'sec/curl-pipe-shell');
  assert.equal(
    curlRule.help.text,
    'Download script first, verify its SHA256 checksum or signature, then execute it.'
  );

  assert.equal(run.results.length, report.issues.length);
  report.issues.forEach((issue, index) => {
    const result = run.results[index];
    const location = result.locations[0].physicalLocation;
    assert.equal(result.ruleId, issue.rule_id);
    assert.equal(location.artifactLocation.uri, 'ci.yml');
    assert.equal(location.region.startLine, issue.line);
    assert.equal(result.message.text.includes(issue.title), true);
    assert.equal(result.message.text.includes(issue.fix), true);
  });

  const critical = run.results.find((result) => result.ruleId === 'sec/curl-pipe-shell');
  const high = run.results.find((result) => result.ruleId === 'sec/permissions-write-all');
  const medium = run.results.find((result) => result.ruleId === 'pipe/docker-unpinned');
  assert.equal(critical.level, 'error');
  assert.equal(high.level, 'error');
  assert.equal(medium.level, 'warning');
  console.log(`CRITICAL -> error: ${critical.ruleId} | ${critical.message.text}`);
  console.log(`HIGH -> error: ${high.ruleId} | ${high.message.text}`);
  console.log(`MEDIUM -> warning: ${medium.ruleId} | ${medium.message.text}`);
});

test('a clean config produces SARIF with an empty results array', () => {
  const sarif = JSON.parse(run(['scan', cleanDir, '--format', 'sarif']));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.rules.length, 36);
  assert.deepEqual(sarif.runs[0].results, []);
});

test('html report matches json severity counts and lists every finding', () => {
  const report = JSON.parse(scanSample('json'));
  const html = scanSample('html');
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of report.issues) counts[issue.severity] += 1;

  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /Scanned target: sample/);
  assert.match(html, new RegExp(`Total findings: ${report.issues.length}`));
  for (const [severity, count] of Object.entries(counts)) {
    assert.match(html, new RegExp(`${severity}: ${count}`));
  }
  for (const issue of report.issues) {
    assert.equal(html.includes(issue.rule_id), true);
    assert.equal(html.includes(issue.title), true);
    assert.equal(html.includes(issue.evidence), true);
    assert.equal(html.includes(issue.fix), true);
    assert.match(html, new RegExp(`ci\\.yml:${issue.line}`));
  }
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<link'), false);
  assert.equal(html.includes('@import'), false);
  assert.equal(html.includes('url('), false);
});

test('html escapes markup in finding evidence and fix text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-html-escape-'));
  fs.writeFileSync(path.join(root, 'page.html'), '<div onclick="<script>alert(1)</script>"></div>\n', 'utf8');
  try {
    const html = run(['scan', root, '--format', 'html']);
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
    assert.equal(html.includes('&quot;'), true);
    assert.equal(html.includes('joint/clickable-div'), true);
    assert.equal(html.includes('page.html:1'), true);
    assert.equal(html.includes('Use a native &lt;button type=&quot;button&quot;&gt; instead.'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a clean config produces html that says the scan is clean', () => {
  const html = run(['scan', cleanDir, '--format', 'html']);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /No findings\. This scan is clean\./);
  assert.match(html, /Total findings: 0/);
  for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    assert.match(html, new RegExp(`${severity}: 0`));
  }
  assert.equal(html.length > 0, true);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<link'), false);
  assert.equal(html.includes('@import'), false);
  assert.equal(html.includes('url('), false);
});
