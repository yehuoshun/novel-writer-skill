'use strict';
// 状态快照机械回写（apply-changes）：CHANGES → 快照各表
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APPLY = path.join(__dirname, '..', 'scripts', 'apply-changes.js');
const run = (args) => spawnSync(process.execPath, [APPLY, ...args], { encoding: 'utf-8' });

const SNAPSHOT = [
  '# 状态快照（截止第2章）', '',
  '## 下章交接包', '- 剧情当前位置：旧包', '',
  '## 角色状态',
  '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
  '|------|------|----------|------|------|-----------|',
  '| 林山 | 炼气 | 青云山后山 | 健康 | 断剑 | 2 |', '',
  '## 伏笔状态',
  '| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |',
  '|--------|--------|------|--------------|------|--------|--------|--------|',
  '| v1 | 断锋来历 | 长线 | 揭晓时震惊 | 已埋设 | 1 | — | 待定 |', '',
].join('\n');

const FULL_DRAFT = [
  '　　林山走进前殿。', '---CHANGES---',
  '<!-- 角色状态变化 -->', '- **[林山]**：健康→轻伤 | 心理变化：初入江湖',
  '<!-- 冲突进度 -->', '- **[正邪大战]**：潜伏→激化 | 推进事件：林山露剑',
  '<!-- 伏笔动作（四态，必须引用伏笔ID） -->', '- ➡️推进 **v1 断锋来历** | 新线索：苏瑶认出断剑',
  '<!-- 地点状态变化 -->', '- **[青云山]**：平静→戒备 | 林山露剑',
  '<!-- 势力状态变化 -->', '- **[天剑宗]**：安稳→内乱 | 掌门失踪',
  '<!-- 交接包 -->', '- 剧情当前位置：初入青云山', '- 当前时间：入宗第 3 天',
  '<!-- 时间推进 -->', '- 距上一章：1天 | 时段：深夜 | 关键事件：林山入山',
  '<!-- 角色移动 -->', '- **[林山]**：青云山后山→青云山前殿',
  '<!-- 物品流转 -->', '- **[断剑]**：林山→苏瑶 | 方式：赠送 | 完好',
  '---END CHANGES---', '',
].join('\n');

function makeBook({ snapshot = SNAPSHOT, draft = FULL_DRAFT, draftName = '第003章.md' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-apply-'));
  const settingsDir = path.join(dir, '设定');
  const contentDir = path.join(dir, '正文');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    info: { name: '回写测试' },
    local: { content_path: './正文', settings_path: './设定' },
  }, null, 2));
  if (snapshot !== null) fs.writeFileSync(path.join(settingsDir, '状态快照.md'), snapshot, 'utf8');
  const draftPath = path.join(contentDir, draftName);
  fs.writeFileSync(draftPath, draft, 'utf8');
  return {
    dir,
    settingsDir,
    draft: draftPath,
    config: path.join(dir, 'config.json'),
    snap: () => fs.readFileSync(path.join(settingsDir, '状态快照.md'), 'utf8'),
  };
}

test('全类声明一次回写：角色/移动/伏笔/地点/势力/物品/冲突/时间线/交接包', () => {
  const book = makeBook();
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  const snap = book.snap();

  assert.match(snap, /# 状态快照（截止第3章）/);
  assert.match(snap, /\| 林山 \| 炼气 \| 青云山前殿 \| 轻伤 \| 断剑 \| 3 \|/);
  assert.match(snap, /\| v1 \| 断锋来历 \| 长线 \| 揭晓时震惊 \| 已推进 \| 1 \| 3 \| 待定 \|/);
  assert.match(snap, /\| 青云山 \| 戒备 \| 林山露剑 \| 3 \|/);
  assert.match(snap, /\| 天剑宗 \| 内乱 \| 掌门失踪 \|/);
  assert.match(snap, /\| 断剑 \| 苏瑶 \| 完好 \|/);
  assert.match(snap, /\| 正邪大战 \| 激化 \| 林山露剑 \|/);
  assert.match(snap, /- 第3章：深夜 \| 距上一章1天 \| 关键事件：林山入山/);
  assert.match(snap, /- 剧情当前位置：初入青云山\n- 当前时间：入宗第 3 天/);
  assert.doesNotMatch(snap, /旧包/);
});

test('默认 dry-run：打印将改什么，但文件一个字节不动', () => {
  const book = makeBook();
  const before = book.snap();
  const r = run([book.config, book.draft]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /角色状态 林山：健康 → 轻伤/);
  assert.match(r.stdout, /dry-run：未写入/);
  assert.strictEqual(book.snap(), before);
});

test('同一章重复回写幂等：第二次报「无需回写」，文件不变', () => {
  const book = makeBook();
  assert.strictEqual(run([book.config, book.draft, '--write']).status, 0);
  const after1 = book.snap();
  const r2 = run([book.config, book.draft, '--write']);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /无需回写/);
  assert.strictEqual(book.snap(), after1);
});

test('CHANGES 里有、表里没有的角色 → 追加新行（等级/位置留 —）', () => {
  const draft = [
    '　　正文。', '---CHANGES---',
    '<!-- 角色状态变化 -->', '- **[苏瑶]**：健康→轻伤',
    '---END CHANGES---', '',
  ].join('\n');
  const book = makeBook({ draft });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ 角色状态 苏瑶：轻伤（新增行/);
  assert.match(book.snap(), /\| 苏瑶 \| — \| — \| 轻伤 \| — \| 3 \|/);
});

test('伏笔推进但快照未登记 → exit 1，指出先补登记，且文件不动', () => {
  const draft = [
    '　　正文。', '---CHANGES---',
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->', '- ➡️推进 **v9 神秘玉简** | 新线索',
    '---END CHANGES---', '',
  ].join('\n');
  const book = makeBook({ draft });
  const before = book.snap();
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /伏笔 v9 未在快照伏笔状态表登记/);
  assert.strictEqual(book.snap(), before);
});

test('新伏笔埋设 → 新增行，类型与预期读者效果从声明里取', () => {
  const draft = [
    '　　正文。', '---CHANGES---',
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
    '- 🔨埋设 **v2 古庙秘密**（类型：短线） | 十章内给读者一个小惊喜 | 线索：墙上的刻痕',
    '---END CHANGES---', '',
  ].join('\n');
  const book = makeBook({ draft });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(book.snap(), /\| v2 \| 古庙秘密 \| 短线 \| 十章内给读者一个小惊喜 \| 已埋设 \| 3 \| — \| 待定 \|/);
});

test('旧格式 3 列角色表（角色|位置|状态）照样能改位置与状态', () => {
  const snapshot = [
    '# 状态快照（截止第2章）', '',
    '## 角色状态', '| 角色 | 位置 | 状态 |', '|------|------|------|', '| 林山 | 青云山后山 | 健康 |', '',
  ].join('\n');
  const draft = [
    '　　正文。', '---CHANGES---',
    '<!-- 角色状态变化 -->', '- **[林山]**：健康→重伤',
    '<!-- 角色移动 -->', '- **[林山]**：青云山后山→前殿',
    '---END CHANGES---', '',
  ].join('\n');
  const book = makeBook({ snapshot, draft });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(book.snap(), /\| 林山 \| 前殿 \| 重伤 \|/);
});

test('章号：能从 ch005-changes.md 解析；--chapter 可覆盖；都没有则 exit 2', () => {
  const book5 = makeBook({ draftName: 'ch005-changes.md' });
  const r5 = run([book5.config, book5.draft, '--write']);
  assert.strictEqual(r5.status, 0, r5.stderr);
  assert.match(book5.snap(), /# 状态快照（截止第5章）/);

  const book = makeBook({ draftName: '草稿.md' });
  const noChapter = run([book.config, book.draft]);
  assert.strictEqual(noChapter.status, 2);
  assert.match(noChapter.stderr, /请加 --chapter N/);

  const ok = run([book.config, book.draft, '--chapter', '7', '--write']);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(book.snap(), /# 状态快照（截止第7章）/);
});

test('缺 CHANGES 块 → exit 1；缺快照 → exit 1', () => {
  const noChanges = makeBook({ draft: '　　只有正文，没有声明。\n' });
  const r1 = run([noChanges.config, noChanges.draft]);
  assert.strictEqual(r1.status, 1);
  assert.match(r1.stderr, /No CHANGES block found/);

  const noSnap = makeBook({ snapshot: null });
  const r2 = run([noSnap.config, noSnap.draft]);
  assert.strictEqual(r2.status, 1);
  assert.match(r2.stderr, /找不到状态快照/);
});
