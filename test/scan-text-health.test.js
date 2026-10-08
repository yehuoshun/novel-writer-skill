'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'scan-text-health.js');
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf-8' });

// 含「如」但无任何比喻（虽然/如果/如此/如何/比如），回归 v3.3.10 的误报修复
const RU = '如果有人问起今天发生的事，如此这般解释也就够了。他如何做出选择，'
  + '比如这道题该不该答，都不是重点。接下来的路还很长，需要一步一步走完，'
  + '不能着急也不能停下。如此多的疑问堆在眼前，他只能迎着风继续往前赶路。';

// 真·比喻密集（多个「像」）
const XIANG = '她的眼睛像星星，笑容像春风，声音像溪水，脾气像烈火，心思像深潭，'
  + '命运像浮萍，过往像迷雾，未来像长夜，等待像凌迟，思念像潮水，孤独像荒野，沉默像深渊。';

test('含「如」无比喻 → 不报「比喻偏密」（防 v3.3.10 回归）', () => {
  const r = run(RU);
  assert.ok(!/比喻偏密/.test(r.stdout), `误报:\n${r.stdout}`);
});

test('真·比喻密集 → 报「比喻偏密」', () => {
  const r = run(XIANG);
  assert.match(r.stdout, /比喻偏密/);
});

test('半角冒号（比例 3:1）→ 软提示，不是硬伤，退出码 0', () => {
  const r = run('　　他胜率高达3:1，全场哗然。这是一段用来凑足汉字数量的测试文本，'
    + '需要写得足够长才能让检测器正常工作，因此继续补充一些无关紧要的内容凑字数。');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /半角括号\/冒号/);
});

test('半角感叹号 → 硬伤，退出码 1', () => {
  const r = run('　　他大喊hello!然后走了。这也是一段用来凑足汉字数量的测试文本，'
    + '继续补充一些无关紧要的内容，凑够一百个汉字让检测器觉得有意义再说话。');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /半角标点混入/);
});

test('引号不成对 → 硬伤，退出码 1', () => {
  const r = run('　　他说“来吧，然后转身离开。这段也是凑字数的文本，继续补充一些'
    + '无关紧要的内容，凑够一百个汉字让检测器别嫌太短，然后再多写一点凑齐。');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /引号不成对/);
});

test('干净文本 → 退出码 0', () => {
  const r = run(RU);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /无标点硬伤/);
});
