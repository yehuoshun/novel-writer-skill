'use strict';
// examples/ 模板自检：YAML 里的命令必须真能跑、用的开关必须是 book-report 认的
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpDir } = require('./helpers/tmp');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'book-report.js');
const YML = path.join(ROOT, 'examples', 'github-actions', 'book-report.yml');

const yml = fs.readFileSync(YML, 'utf-8');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
}

function makeBook() {
  const dir = tmpDir('nw-example-');
  const content = path.join(dir, '正文');
  const settings = path.join(dir, '设定');
  fs.mkdirSync(content, { recursive: true });
  fs.mkdirSync(settings, { recursive: true });
  const body = '　　林山提剑走出山门，风雪扑面而来。\n';
  fs.writeFileSync(path.join(content, '第001章.md'), body, 'utf-8');
  fs.writeFileSync(path.join(content, '第002章.md'), body, 'utf-8');
  const cfg = {
    info: { name: '模板测试' },
    local: { content_path: '正文', settings_path: '设定' },
  };
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return cfgPath;
}

test('模板里的命令行能原样跑通（--write --brief）', () => {
  const cfgPath = makeBook();
  const r = run([cfgPath, '--write', '--brief']);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /^📖 全书体检 第1–2章/m);
  const report = fs.readFileSync(path.join(path.dirname(cfgPath), '设定', '全书体检.md'), 'utf-8');
  assert.match(report, /全书体检/);
});

test('YAML 里用到的开关都是 book-report 认的（防止模板写了个不存在的能力）', () => {
  const probe = run(['--nope-flag']);
  assert.strictEqual(probe.status, 2);
  const accepted = new Set(probe.stderr.match(/--[a-z-]+/g) || []);
  const used = new Set(
    yml.split('\n')
      .filter((l) => /book-report\.js/.test(l))
      .flatMap((l) => l.match(/--[a-z-]+/g) || []),
  );
  const unknown = [...used].filter((f) => !accepted.has(f));
  assert.deepStrictEqual(unknown, [], `模板用了 book-report 不认的开关：${unknown.join(', ')}`);
});

test('管道接 tee 时保留了 set -o pipefail（否则红线不会让 job 失败）', () => {
  const runBlocks = yml.split(/\n\s*- name:/).filter((s) => s.includes('book-report.js'));
  assert.strictEqual(runBlocks.length, 1, '应当只有一处调用 book-report');
  const block = runBlocks[0];
  assert.match(block, /\|\s*tee/);
  assert.match(block, /set -o pipefail/);
});

test('保留待改占位符，且引用的脚本真实存在', () => {
  assert.match(yml, /TODO_OWNER\/novel-writer-skill/);
  assert.match(yml, /configs\/TODO\.json/);
  const ref = yml.match(/node ([^\s]*book-report\.js)/)[1];
  const real = path.join(ROOT, ref.replace(/^\.?\/?\.novel-writer-skill\//, '').replace(/^\//, ''));
  assert.ok(fs.existsSync(real), `模板指向的脚本不存在：${real}`);
  assert.ok(fs.existsSync(path.join(ROOT, 'examples', 'README.md')));
});
