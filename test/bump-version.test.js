'use strict';
// bump-version.sh 自检：三处版本号同步递增（在临时目录跑，不污染仓库）。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'tools', 'bump-version.sh');
const ROOT = path.join(__dirname, '..');

// bash 在哪因平台而异：Linux CI 直接有 bash，Windows 上通常只有 Git 自带的 bash.exe（不在 PATH）。
// 显式找一遍，否则本机 4 条用例会以 ENOENT 误报失败，掩盖真正的脚本问题。
function resolveBash() {
  const fromEnv = process.env.BASH_PATH || process.env.BASH;
  if (fromEnv) return fromEnv;
  if (process.platform !== 'win32') return 'bash';
  const candidates = [];
  try {
    const gitExe = execFileSync('where', ['git'], { encoding: 'utf-8' }).split(/\r?\n/)[0].trim();
    candidates.push(path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe'));
  } catch {
    // 没装 git 就退回 PATH 里的 bash
  }
  for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (pf) candidates.push(path.join(pf, 'Git', 'bin', 'bash.exe'));
  }
  return candidates.find((p) => fs.existsSync(p)) || 'bash';
}

const BASH = resolveBash();

function setupTmp() {
  const dir = tmpDir('bump-test-');
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
  execFileSync(BASH, [SCRIPT, '--root', dir, 'patch'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  const [maj, min, pat] = before.split('.').map(Number);
  assert.strictEqual(after.pkg, `${maj}.${min}.${pat + 1}`);
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh minor：次版本 +1 且 patch 清零', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  execFileSync(BASH, [SCRIPT, '--root', dir, 'minor'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  const [maj, min] = before.split('.').map(Number);
  assert.strictEqual(after.pkg, `${maj}.${min + 1}.0`);
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh major：主版本 +1 且次/补丁清零', () => {
  const dir = setupTmp();
  execFileSync(BASH, [SCRIPT, '--root', dir, 'major'], { encoding: 'utf-8' });
  const after = readVersion(dir);
  assert.strictEqual(after.pkg, '4.0.0');
  assert.strictEqual(after.fm, after.pkg);
  assert.strictEqual(after.tail, after.pkg);
});

test('bump-version.sh 非法参数报错且不改文件', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  assert.throws(() => execFileSync(BASH, [SCRIPT, '--root', dir, 'bogus']));
  assert.strictEqual(readVersion(dir).pkg, before);
});

test('bump-version.sh 默认参数 = patch', () => {
  const dir = setupTmp();
  const before = readVersion(dir).pkg;
  execFileSync(BASH, [SCRIPT, '--root', dir], { encoding: 'utf-8' });
  const [maj, min, pat] = before.split('.').map(Number);
  assert.strictEqual(readVersion(dir).pkg, `${maj}.${min}.${pat + 1}`);
});
