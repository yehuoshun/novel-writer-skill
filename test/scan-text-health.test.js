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

// ---- 密度/句式分支补强（v3.3.35）----
test('认知句成簇（他总觉得 ×N）→ 提示认知句模式', () => {
  const r = run('他总觉得这件事不简单。风从谷口灌进来，带着焦糊的气味。'.repeat(60));
  assert.match(r.stdout, /认知句模式.*他总觉得/);
});

test('逗号链（单句 ≥6 逗号）→ 提示长逗号链', () => {
  const r = run('他走啊走，走啊走，走啊走，走啊走，走啊走，走啊走，走啊走。'.repeat(50));
  assert.match(r.stdout, /长逗号链/);
});

test('同主语连发（连续 3+ 句同一开头）→ 提示句首单调', () => {
  const r = run('他走了。他走了。他走了。他走了。他走了。他走了。'.repeat(40));
  assert.match(r.stdout, /同一开头/);
});

// ---- 未覆盖分支补强（v3.3.47，实弹第九轮）----
test('填充词（只见/不由分说/二话不说）→ 提示', () => {
  const t = '　　只见他不由分说拔剑，二话不说就砍。但见她身影一闪，已到十丈外。' + '　　补充叙述内容继续写下去，节奏保持平稳。'.repeat(70);
  assert.match(run(t).stdout, /填充词/);
});

test('连接词密度超标（然后/接着/于是）→ 提示', () => {
  const t = ('　　于是他推开门，接着走进来，然后坐下，随后又站起来。叙述继续推进，节奏不慢。').repeat(55);
  assert.match(run(t).stdout, /连接词密度/);
});

test('「是…的」≥3 处 → 提示书面判断腔', () => {
  const t = '　　这把剑是师父传的。那封信是她写的。这条路是他选的。' + '　　补充叙述内容继续写下去，节奏保持平稳。'.repeat(70);
  assert.match(run(t).stdout, /是…的/);
});

test('对话密集交替开头 → 不误报句首单调', () => {
  const t = ('　　“你来了。”她说。“我来了。”他答。“你终于肯来了。”她低声。“我不来，谁来？”他反问。').repeat(15) + '　　夜色渐深，两人并肩坐下。远处的灯火一盏盏熄灭。她靠在他肩上，慢慢闭上眼睛。这一夜很长。';
  const r = run(t);
  assert.ok(!/同一开头/.test(r.stdout), `误报:\n${r.stdout}`);
});

test('纯英文 → 文本过短提示，无硬伤', () => {
  const r = run('Hello world. This is a test. '.repeat(20));
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /过短/);
});

test('部分段落无缩进 → 提示缩进缺失', () => {
  const t = '　　缩进段落。' + '内容补充。'.repeat(20) + '\n无缩进段落。' + '内容补充。'.repeat(20) + '\n　　缩进段落。' + '内容补充。'.repeat(20);
  assert.match(run(t).stdout, /缩进缺失/);
});

// ---- 误报修正（v3.3.56 实弹暴露）----
const FILL = '继续补充无关紧要的叙述内容，把字数凑足到样本线。'.repeat(70);

test('连词里的「是」（但是/就是/那是）不误报「是…的」判断腔', () => {
  const t = '　　但是他说的不假。就是这条路的尽头。那是他忘不了的地方。' + FILL;
  const r = run(t);
  assert.ok(!/是…的/.test(r.stdout), `误报:\n${r.stdout}`);
});

test('真·「是…的」判断腔仍提示（线索未误伤）', () => {
  const t = '　　这把剑是师父传的。那封信是她写的。这条路是他选的。' + FILL;
  assert.match(run(t).stdout, /是…的/);
});

test('「好像/不像/图像」不计入比喻密度', () => {
  const t = '　　他好像明白了。'.repeat(60) + FILL;
  const r = run(t);
  assert.ok(!/比喻偏密/.test(r.stdout), `误报:\n${r.stdout}`);
});
