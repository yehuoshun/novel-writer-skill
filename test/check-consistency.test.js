'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-consistency.js');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '地点设定'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '林山.md'), '# 林山\n');
  fs.writeFileSync(path.join(set, '地点设定', '青云山.md'), '# 青云山\n');
  fs.writeFileSync(path.join(set, '伏笔追踪', 'v1-断锋来历.md'), '# v1\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照（截止第1章）\n## 角色状态\n' +
    '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n' +
    '| 林山 | 炼气三层 | 青云山后山 | 健康 | 剑 | 1 |\n');
  const good = path.join(dir, 'good.md');
  fs.writeFileSync(good,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n' +
    '<!-- 角色移动 -->\n- **[林山]**：青云山后山→青云山前殿\n' +
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v1 断锋来历** | 新线索\n---END CHANGES---\n');
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(bad,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[赵无极]**：健康\n' +
    '<!-- 角色移动 -->\n- **[林山]**：天剑宗→青云山\n' +
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ✅回收 **v9 不存在**\n---END CHANGES---\n');
  return { dir, set, snap, good, bad };
}

test('合法章节 → 通过（exit 0）', () => {
  const { snap, good, set } = setup();
  const r = run([snap, good, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /门禁通过/);
});

test('冲突章节 → 拦三类问题（exit 1）', () => {
  const { snap, bad, set } = setup();
  const r = run([snap, bad, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未登记实体：赵无极/);
  assert.match(r.stderr, /林山 从「天剑宗」出发/);
  assert.match(r.stderr, /未登记伏笔：v9/);
});

test('实体仅被他档提及、无自有档案 → 仍判未登记', () => {
  const { dir, set, snap } = setup();
  fs.appendFileSync(path.join(set, '角色设定', '主角', '林山.md'), '\n- 关系：师父（青云子）\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[青云子]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未登记实体：青云子/);
});

test('推进/回收 已终结伏笔 → 拦（状态不可回退）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 9 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已回收 | 1 | 2 | 8 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v1 断锋来历** | 又推\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /不可回退/);
});

test('已死角色出现 → 拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 9 |\n' +
    '| 王老 | — | — | 已死亡 | — | 5 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[王老]**：死亡→复活\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /已死角色出现：王老/);
});

test('蓝图出场合规：必出角色缺失 >1 → 拦', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '## 第3章 细纲\n| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山、青云子、三师兄 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /蓝图未出场：青云子、三师兄/);
});

test('蓝图出场合规：缺额 ≤1 不拦', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山、青云子 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在青云山的路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('描写一致性：正文发色与档案矛盾 → 拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n- 瞳色：深褐\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '张三的金色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /描写一致性.*张三.*金发/);
});

test('描写一致性：与档案一致 → 不拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '张三的黑色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('参数缺失 → exit 2', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /用法/);
});

test('文件不存在 → exit 2', () => {
  const { good, set } = setup();
  const r = run(['/no/such/snapshot.md', good, set]);
  assert.strictEqual(r.status, 2);
});
