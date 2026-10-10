'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-conflicts.js');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '已故'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '已故', '赵六.md'), '# 赵六\n');
  const snap = path.join(dir, '状态快照.md');
  const write = (s) => fs.writeFileSync(snap, s);
  return { dir, set, snap, write };
}

test('干净快照 → 无冲突，退出码 0', () => {
  const { set, snap, write } = setup();
  write('# 状态快照（截止第2章）\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n|------|------|----------|------|------|-----------|\n| 张三 | 金丹期 | 烈焰谷 | 健康 | — | 2 |\n## 时间线（最近一章）\n- 第5天：出发\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /无确定性冲突/);
});

test('角色状态表重复登记 → 冲突', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n|------|------|----------|------|------|-----------|\n| 张三 | 金丹期 | 甲 | 健康 | — | 1 |\n| 张三 | 金丹期 | 甲 | 健康 | — | 1 |\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /重复登记/);
});

test('已故目录角色在状态表未标已死 → 冲突', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n|------|------|----------|------|------|-----------|\n| 赵六 | 筑基期 | — | 健康 | — | 2 |\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /已死角色/);
});

test('已故目录角色状态标已死 → 不误报', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n|------|------|----------|------|------|-----------|\n| 赵六 | 筑基期 | — | 已死 | — | 2 |\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('物品归属多行持有者不一致 → 冲突', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 物品归属\n| 物品 | 持有者 | 状态 |\n|------|--------|------|\n| 断锋剑 | 张三 | active |\n| 断锋剑 | 李四 | active |\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /物品归属/);
});

test('时间线倒流 → 冲突', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 时间线（最近一章）\n- 第12天：出发\n- 第8天：抵达\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /时间倒流/);
});

test('位置留空但状态含移动语义 → 仅提示（退出码 0）', () => {
  const { set, snap, write } = setup();
  write('# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n|------|------|----------|------|------|-----------|\n| 张三 | 金丹期 | — | 移动中 | — | 3 |\n');
  const r = run([snap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /位置为「—」/);
});

test('用法错误 / 文件不存在 → 退出码 2', () => {
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run(['/no/such/snap.md', '/no/such/set']).status, 2);
});
