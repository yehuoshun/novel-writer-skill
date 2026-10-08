'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'scan-text-health.js');
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf-8' });

// ≥1500 汉字，含「如」（如果/如此/如何）但零比喻词（像/仿佛）
const RU_LONG = '如果有人问起今天发生的事，如此这般解释也就够了，他如何做出选择都不是重点。'.repeat(50);
// ≥1500 汉字，真·比喻密集（大量「像」）
const XIANG_LONG = '她的眼睛像星星，笑容像春风，声音像溪水。'.repeat(100);

test('长文含「如」无比喻 → 不报「比喻偏密」（防 v3.3.10 回归）', () => {
  const r = run(RU_LONG);
  assert.ok(!/比喻偏密/.test(r.stdout), `误报:\n${r.stdout}`);
});

test('长文真·比喻密集 → 报「比喻偏密」', () => {
  assert.match(run(XIANG_LONG).stdout, /比喻偏密/);
});

test('短文（<1500 字）→ 密度指标不判，提示样本不足', () => {
  const short = '她的眼睛像星星，笑容像春风，声音像溪水，脾气像烈火，心思像深潭，命运像浮萍。';
  const r = run(short);
  assert.ok(!/比喻偏密/.test(r.stdout), '短文不应报密度');
  assert.match(r.stdout, /样本不足/);
});

test('半角冒号（比例 3:1）→ 软提示，不是硬伤，退出码 0', () => {
  const r = run('　　他胜率高达3:1，全场哗然。' + '这是一段用来凑字数的测试文本。'.repeat(10));
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /半角括号\/冒号/);
});

test('半角感叹号 → 硬伤，退出码 1', () => {
  const r = run('　　他大喊hello!然后走了。' + '继续补充无关紧要的内容凑字数。'.repeat(10));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /半角标点混入/);
});

test('引号不成对 → 硬伤，退出码 1', () => {
  const r = run('　　他说“来吧，然后转身离开。' + '这段也是凑字数的文本继续补充。'.repeat(10));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /引号不成对/);
});

test('干净长文 → 退出码 0', () => {
  const r = run(RU_LONG);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /无标点硬伤/);
});
