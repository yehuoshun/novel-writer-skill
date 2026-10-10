'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'parse-changes.js');
const FIXTURES = path.join(__dirname, 'fixtures');
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf-8' });
const template = fs.readFileSync(path.join(FIXTURES, 'changes-template.txt'), 'utf-8');

test('官方模板 → 退出码 0，解析出全部 10 类分节', () => {
  const r = run(template);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  for (const k of ['characterStates', 'conflictProgress', 'newPlotNodes', 'foreshadowing',
    'handoff', 'locationChanges', 'factionChanges', 'timeProgress', 'characterMoves', 'itemTransfers']) {
    assert.ok(Array.isArray(j[k]), `缺分节 ${k}`);
  }
});

test('伏笔四态：类型/ID/名称正确', () => {
  const j = JSON.parse(run(template).stdout);
  assert.deepStrictEqual(j.foreshadowing.map(f => f.type), ['plant', 'progress', 'harvest', 'abandon']);
  assert.deepStrictEqual(j.foreshadowing.map(f => f.id), ['v1', 'v1', 'v2', 'v3']);
  assert.deepStrictEqual(j.foreshadowing.map(f => f.name), ['假死真相', '假死真相', '古庙秘密', '掌门失踪线']);
});

test('交接包：键值对解析', () => {
  const j = JSON.parse(run(template).stdout);
  const keys = j.handoff.map(h => h.key);
  assert.ok(keys.includes('剧情当前位置'));
  assert.ok(keys.includes('遗留悬念'));
});

test('CRLF 换行仍可解析', () => {
  const crlf = template.replace(/\n/g, '\r\n');
  const r = run(crlf);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
});

test('无 CHANGES 块 → 退出码 1', () => {
  const r = run('只是普通正文，没有变更块。');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No CHANGES block found/);
});

test('空 CHANGES 块 → 退出码 0，输出 {}', () => {
  const r = run('正文。\n---CHANGES---\n\n---END CHANGES---\n');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), {});
});

test('未识别分节标记 → 退出码 1（不静默吞行）', () => {
  const bad = '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→轻伤\n<!-- 伏笔 -->\n- 🔨埋设 **v1 x**\n---END CHANGES---\n';
  const r = run(bad);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未识别/);
});

test('旧格式伏笔（无 vX，【】包裹）不崩，id 为 null', () => {
  const legacy = '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- 🔨埋设 **【神秘人】**\n---END CHANGES---\n';
  const r = run(legacy);
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.foreshadowing[0].id, null);
  assert.strictEqual(j.foreshadowing[0].name, '神秘人');
});

test('【】包裹角色名也能解析（**[张三]** 兼容变体）', () => {
  const r = run('正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **【张三】**：健康→轻伤\n---END CHANGES---\n');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.characterStates[0].name, '张三');
});

test('裸名 **张三** 也能解析', () => {
  const r = run('正文。\n---CHANGES---\n<!-- 角色移动 -->\n- **张三**：天剑宗→青云山\n---END CHANGES---\n');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.characterMoves[0].name, '张三');
});

// ---- 分节标记归一化（v3.3.55）：忽略标记内外空白，兼容紧凑写法 ----
test('无空格分节标记（<!--角色状态变化-->）也能解析', () => {
  const r = run('正文。\n---CHANGES---\n<!--角色状态变化-->\n- **[张三]**：健康→轻伤\n<!--交接包-->\n- 剧情当前位置：x\n---END CHANGES---\n');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.characterStates[0].name, '张三');
  assert.strictEqual(j.handoff[0].key, '剧情当前位置');
});

test('分节标记带说明后缀且无空格（<!--伏笔动作（四态）-->）也能解析', () => {
  const r = run('正文。\n---CHANGES---\n<!--伏笔动作（四态，必须引用伏笔ID）-->\n- 🔨埋设 **v1 断锋来历** | 预期读者效果：X\n---END CHANGES---\n');
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.foreshadowing[0].type, 'plant');
  assert.strictEqual(j.foreshadowing[0].id, 'v1');
});
