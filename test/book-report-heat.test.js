'use strict';
// 全书体检读章节热度（scripts/book-report.js + 设定/章节热度.md）以及 --brief / --digest / --fail-on
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpDir } = require('./helpers/tmp');

const REPORT = path.join(__dirname, '..', 'scripts', 'book-report.js');

// 每章 ~14 个汉字，远低于爽点间隔阈值（5000 字）
const BODY = '　　林山提剑走出山门，风雪扑面而来。\n';

function makeBook({ n = 8, files = {} } = {}) {
  const dir = tmpDir('nw-book-heat-');
  const content = path.join(dir, '正文');
  const settings = path.join(dir, '设定');
  fs.mkdirSync(content, { recursive: true });
  fs.mkdirSync(settings, { recursive: true });
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(content, `第${String(i).padStart(3, '0')}章.md`), BODY, 'utf-8');
  }
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(settings, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf-8');
  }
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    info: { name: '热度测试' },
    local: { content_path: '正文', settings_path: '设定' },
    writing: {},
  }, null, 2), 'utf-8');
  return { dir, cfgPath, settings };
}

const HEAT = (rows) => `# 章节热度\n\n| 章节 | 平台热度 | 留存 | 备注 |\n|---|---|---|---|\n${rows}\n`;
const SWEET = (rows) => `# 爽点追踪\n\n| 章节 | 爽点类型 | 铺放比 |\n|---|---|---|\n${rows}\n`;

function run(cfgPath, args) {
  return spawnSync(process.execPath, [REPORT, cfgPath, ...args], { encoding: 'utf-8' });
}

test('热度：连片低热度出黄条，--brief 只打一行摘要', () => {
  const { cfgPath } = makeBook({
    files: {
      '章节热度.md': HEAT('| 1 | 1000 | — | — |\n| 2 | 100 | — | — |\n| 3 | 90 | — | — |\n| 4 | 120 | — | — |\n| 5 | 1000 | — | — |'),
    },
  });
  const full = run(cfgPath, []);
  assert.strictEqual(full.status, 0, full.stderr);
  assert.match(full.stdout, /【热度】5 章有标注，均值 462/);
  assert.match(full.stdout, /最低：第3章 90、第2章 100、第4章 120/);
  assert.match(full.stdout, /\[低热度连片\] 第2–4章热度都不到均值一半/);

  const brief = run(cfgPath, ['--brief']);
  assert.strictEqual(brief.status, 0);
  const lines = brief.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^📖 全书体检 第1–8章｜平均 \d+ 字｜🔴 0｜⚠️ 1｜热度均值 462（5 章）$/);
});

test('--fail-on warn：有黄条也 exit 1，非法值 exit 2', () => {
  const { cfgPath } = makeBook({
    files: { '章节热度.md': HEAT('| 1 | 1000 | — | — |\n| 2 | 100 | — | — |\n| 3 | 90 | — | — |\n| 4 | 120 | — | — |') },
  });
  assert.strictEqual(run(cfgPath, []).status, 0);
  assert.strictEqual(run(cfgPath, ['--fail-on', 'warn']).status, 1);
  const bad = run(cfgPath, ['--fail-on', 'maybe']);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /--fail-on 只认 red/);
});

test('--digest：追加一行，第二次跑不重复表头', () => {
  const { cfgPath, settings } = makeBook({
    files: { '章节热度.md': HEAT('| 1 | 1000 | — | — |\n| 2 | 900 | — | — |\n| 3 | 800 | — | — |') },
  });
  const first = run(cfgPath, ['--digest']);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.match(first.stdout, /日报追加一行/);
  assert.match(first.stdout, /📖 全书体检 第1–8章/);
  const second = run(cfgPath, ['--digest']);
  assert.strictEqual(second.status, 0, second.stderr);

  const digest = fs.readFileSync(path.join(settings, '体检日报.md'), 'utf-8');
  assert.strictEqual(digest.split('| 时间 | 跨度 |').length - 1, 1, '表头只应出现一次');
  const rows = digest.split('\n').filter((l) => /^\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/.test(l));
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0], /\| 第1–8章 \| \d+ \| 0 \| 0 \| 900 \|/);
});

test('热度对照：有爽点的章比没爽点的章还冷，单独提醒', () => {
  // 爽点章两两一组、中间隔一个单章无爽点（不断档、也不同质）
  const { cfgPath } = makeBook({
    files: {
      '爽点追踪.md': SWEET('| 1 | 打脸 | 0.5 |\n| 2 | 扮猪吃虎 | 0.6 |\n| 4 | 打脸 | 0.5 |\n| 5 | 扮猪吃虎 | 0.6 |\n| 7 | 打脸 | 0.5 |\n| 8 | 扮猪吃虎 | 0.6 |'),
      '章节热度.md': HEAT('| 1 | 100 | — | — |\n| 2 | 110 | — | — |\n| 3 | 1000 | — | — |\n| 4 | 120 | — | — |\n| 5 | 130 | — | — |\n| 6 | 1100 | — | — |\n| 7 | 140 | — | — |\n| 8 | 150 | — | — |'),
    },
  });
  const r = run(cfgPath, []);
  assert.match(r.stdout, /\[爽点与热度\] 有爽点的章平均热度 125，没爽点的章 1050——爽点没换来追读/);
  assert.match(r.stdout, /有爽点章均值 125 \/ 无爽点章 1050/);
});
