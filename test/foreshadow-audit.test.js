'use strict';
// 伏笔双写体检（scripts/lib/foreshadow-audit.js）：档案状态 × 快照伏笔表
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { auditForeshadow } = require('../scripts/lib/foreshadow-audit');
const { tmpDir } = require('./helpers/tmp');

const SNAP = String.raw`# 状态快照（截止第2章）

## 伏笔状态
| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |
|--------|--------|------|--------------|------|--------|--------|--------|
| v1 | 断锋来历 | 长线 | 揭晓时震惊 | 已埋设 | 1 | — | 待定 |
| v2 | 古庙秘密 | 短线 | 好奇 | 已推进（第3章） | 2 | 3 | 待定 |

## 地点状态
| 地点 | 当前状态 | 触发事件 | 相关章节 |
|------|----------|----------|----------|
| 青云山 | 戒备 | 林山露剑 | 3 |
`;

function book(docs = {}) {
  const dir = tmpDir('nw-fs-audit-');
  if (Object.keys(docs).length) {
    const d = path.join(dir, '伏笔追踪');
    fs.mkdirSync(d, { recursive: true });
    for (const [file, body] of Object.entries(docs)) fs.writeFileSync(path.join(d, file), body, 'utf8');
  }
  return dir;
}

test('伏笔双写体检：两边状态一致 → 无打架无缺一', () => {
  const dir = book({
    'v1-断锋来历.md': '# v1 断锋来历\n- 类型：长线\n- 状态：已埋设\n',
    'v2-古庙秘密.md': '# v2 古庙秘密\n- 类型：短线\n- 状态：已推进\n',
  });
  const r = auditForeshadow({ settingsDir: dir, snapshotText: SNAP });
  assert.deepStrictEqual(r.mismatches, []);
  assert.deepStrictEqual(r.oneSided, []);
  assert.strictEqual(r.checked, 2);
});

test('伏笔双写体检：档案已推进、快照还停在已埋设 → 打架（带文件名与两边状态）', () => {
  const dir = book({
    'v1-断锋来历.md': '# v1 断锋来历\n- 状态：已推进\n',
    'v2-古庙秘密.md': '# v2 古庙秘密\n- 状态：已推进\n',
  });
  const r = auditForeshadow({ settingsDir: dir, snapshotText: SNAP });
  assert.strictEqual(r.mismatches.length, 1);
  assert.strictEqual(r.mismatches[0].id, 'v1');
  assert.strictEqual(r.mismatches[0].doc, '已推进');
  assert.strictEqual(r.mismatches[0].snapshot, '已埋设');
  assert.match(r.mismatches[0].message, /v1 档案「已推进」≠ 快照「已埋设」（伏笔追踪\/v1-断锋来历\.md）/);
});

test('伏笔双写体检：快照状态带括号备注时剥掉再比（不然永远对不上）', () => {
  const dir = book({ 'v2-古庙秘密.md': '# v2 古庙秘密\n- 状态：已推进\n' });
  const r = auditForeshadow({ settingsDir: dir, snapshotText: SNAP });
  assert.deepStrictEqual(r.mismatches, []);
  // v1 没有档案 → 只算单边缺一
  assert.strictEqual(r.oneSided.length, 1);
  assert.strictEqual(r.oneSided[0].id, 'v1');
  assert.strictEqual(r.oneSided[0].side, 'snapshot');
});

test('伏笔双写体检：有档案没登记 → 单边缺一（side=doc）', () => {
  const dir = book({ 'v9-没登记的伏笔.md': '# v9\n- 状态：已埋设\n' });
  const r = auditForeshadow({ settingsDir: dir, snapshotText: SNAP });
  const v9 = r.oneSided.find((x) => x.id === 'v9');
  assert.ok(v9, 'v9 应该被点名');
  assert.strictEqual(v9.side, 'doc');
  assert.match(v9.message, /有档案（伏笔追踪\/v9-没登记的伏笔\.md）但快照伏笔状态表没这一行/);
});

test('伏笔双写体检：档案没写 `- 状态：` 就跳过比对（不冤枉骨架）', () => {
  const dir = book({
    'v1-断锋来历.md': '# v1 断锋来历\n- 类型：长线\n- 预期读者效果：揭晓时震惊\n',
    'v2-古庙秘密.md': '# v2 古庙秘密\n- 状态：已推进\n',
  });
  const r = auditForeshadow({ settingsDir: dir, snapshotText: SNAP });
  assert.deepStrictEqual(r.mismatches, []);
  assert.deepStrictEqual(r.oneSided, []);
});

test('伏笔双写体检：没有 伏笔追踪 目录 → 全按快照单边缺一，不炸', () => {
  const r = auditForeshadow({ settingsDir: book(), snapshotText: SNAP });
  assert.deepStrictEqual(r.mismatches, []);
  assert.strictEqual(r.oneSided.length, 2);
  assert.strictEqual(r.checked, 2);
});
