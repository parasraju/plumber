const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'plumber.js');

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('scan completes when the tree contains a dangling symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumber-symlink-'));
  fs.writeFileSync(path.join(root, 'ok.js'), 'const value = 1;\n', 'utf8');
  const link = path.join(root, 'README.md');
  try {
    fs.symlinkSync(path.join(root, 'missing-target.md'), link, 'file');
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }

  try {
    const output = run(['scan', root, '--format', 'json']);
    const report = JSON.parse(output);
    assert.equal(typeof report.score, 'number');
    assert.equal(report.total_files >= 1, true);
    assert.equal(report.issues.some((issue) => String(issue.evidence || '').includes('missing-target')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
