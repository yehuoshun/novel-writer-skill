'use strict';
// bump-version.sh 自检：三处版本号同步递增（在临时目录跑，不污染仓库）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'bump-version.sh');
const ROOT = path.join(__dirname, '..');

function setupTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-test-'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.copyFileSync(path.join(ROOT, 'SKILL.md'), path.join(dir, 'SKILL.md'));
  return dir;
}

function readVersion(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
  const fm = skill.match(/^version:\s*(\S+)/m);
  const tail = skill.match(/_版本：v(\S+)_/);
  assert.ok(fm, 'frontmatter 缺 version');
  assert.ok(tail, '末尾缺 _版本：_');
  return { pkg: pkg.version, fm: fm[1], tail: tail[1] };
}

test('bump-version.sh patch：三处同步 +1', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  execFileSync('bash', [SCRIPT, '--root', dir, 'patch'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  const [maj, min, pat] = before.split('.').map(Number);
  assert.strictEqual(after.pkg, `${maj}.${min}.${pat + 1}`);
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh minor：次版本 +1 且 patch 清零', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  execFileSync('bash', [SCRIPT, '--root', dir, 'minor'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  const [maj, min] = before.split('.').map(Number);
  assert.strictEqual(after.pkg, `${maj}.${min + 1}.0`);
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh major：主版本 +1 且次/补丁清零', () => {
  const dir = setupTmp();
  execFileSync('bash', [SCRIPT, '--root', dir, 'major'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  assert.strictEqual(after.pkg, '4.0.0');
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh 非法参数报错且不改文件', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  assert.throws(() => execFileSync('bash', [SCRIPT, '--root', dir, 'bogus']));
  assert.strictEqual(readVersion(dir).pkg, before);
});

test('bump-version.sh 默认参数 = patch', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  execFileSync('bash', [SCRIPT, '--root', dir], { encoding: 'utf-8' });
  const [maj, min, pat] = before.split('.').map(Number);
  assert.strictEqual(readVersion(dir).pkg, `${maj}.${min}.${pat + 1}`);
});
