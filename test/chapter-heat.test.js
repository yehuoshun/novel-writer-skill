'use strict';
// 章节热度标注（scripts/chapter-heat.js）：人工记平台热度/留存，落成规范表给全书体检读
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpDir } = require('./helpers/tmp');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'chapter-heat.js');

function makeBook() {
  const dir = tmpDir('nw-heat-');
  fs.mkdirSync(path.join(dir, '正文'), { recursive: true });
  fs.mkdirSync(path.join(dir, '设定'), { recursive: true });
  fs.writeFileSync(path.join(dir, '正文', '第001章.md'), '　　林山提剑走出山门。\n', 'utf-8');
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    info: { name: '热度测试' },
    local: { content_path: '正文', settings_path: '设定' },
  }, null, 2), 'utf-8');
  return { dir, cfgPath, heatPath: path.join(dir, '设定', '章节热度.md') };
}

function run(cfgPath, args) {
  return spawnSync(process.execPath, [SCRIPT, cfgPath, ...args], { encoding: 'utf-8' });
}

test('set 默认 dry-run：只说要写什么，磁盘上不落文件', () => {
  const { cfgPath, heatPath } = makeBook();
  const r = run(cfgPath, ['set', '3', '--heat', '8600', '--retain', '62%', '--note', '打脸章']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /将写入/);
  assert.match(r.stdout, /第3章 热 8600 \/ 留存 0\.62/);
  assert.match(r.stdout, /dry-run/);
  assert.strictEqual(fs.existsSync(heatPath), false);
});

test('set --write 落成规范表，list --json 读回来', () => {
  const { cfgPath, heatPath } = makeBook();
  const w = run(cfgPath, ['set', '3', '--heat', '8600', '--retain', '62%', '--note', '打脸章', '--write']);
  assert.strictEqual(w.status, 0, w.stderr);
  const text = fs.readFileSync(heatPath, 'utf-8');
  assert.match(text, /\| 章节 \| 平台热度 \| 留存 \| 备注 \|/);
  assert.match(text, /\| 3 \| 8600 \| 0\.62 \| 打脸章 \|/);

  const j = JSON.parse(run(cfgPath, ['list', '--json']).stdout);
  assert.strictEqual(j.chapters, 1);
  assert.deepStrictEqual(j.rows, [{ chapter: 3, heat: 8600, retain: 0.62, note: '打脸章' }]);
});

test('同章再 set 是覆盖，没给的字段保留旧值', () => {
  const { cfgPath, heatPath } = makeBook();
  run(cfgPath, ['set', '3', '--heat', '8600', '--retain', '0.62', '--note', '打脸章', '--write']);
  run(cfgPath, ['set', '1', '--heat', '1200', '--write']);
  const r = run(cfgPath, ['set', '3', '--heat', '9000', '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  const text = fs.readFileSync(heatPath, 'utf-8');
  assert.match(text, /\| 3 \| 9000 \| 0\.62 \| 打脸章 \|/);
  assert.match(text, /\| 1 \| 1200 \| — \| — \|/);
  // 章号升序
  assert.ok(text.indexOf('| 1 |') < text.indexOf('| 3 |'));
});

test('还没有标注时 list 给一句提示而不是空表', () => {
  const { cfgPath } = makeBook();
  const r = run(cfgPath, ['list']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /还没有标注/);
});

test('参数不合法一律 exit 2 且不落盘', () => {
  const { cfgPath, heatPath } = makeBook();
  const cases = [
    ['set', '3'],                       // 缺 --heat
    ['set', '0', '--heat', '100'],      // 章号不合法
    ['set', '2', '--heat', '100', '--retain', '1.5'], // 留存越界
    ['set', '2', '--heat', 'abc'],      // 热度不是数
    ['wat'],                            // 未知子命令
  ];
  for (const args of cases) {
    const r = run(cfgPath, args);
    assert.strictEqual(r.status, 2, `${args.join(' ')} 应该 exit 2，实际 ${r.status}`);
    assert.match(r.stderr, /❌/);
  }
  const unknown = run(cfgPath, ['set', '2', '--heat', '100', '--heat2', '3']);
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /未知选项 --heat2/);
  assert.strictEqual(fs.existsSync(heatPath), false);
});
