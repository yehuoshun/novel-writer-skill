'use strict';
// 续写位置（next-chapter）：账本 + 正文目录 + 交接包三处拼成「我停在哪、下一章读什么」
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');
const gate = require('../scripts/lib/gate-suite');

const NEXT = path.join(__dirname, '..', 'scripts', 'next-chapter.js');
const run = (args) => spawnSync(process.execPath, [NEXT, ...args], { encoding: 'utf-8' });

const HANDOFF_CHANGES = ['---CHANGES---', '<!-- 交接包 -->', '- 剧情当前位置：青云山前殿', '- 下章该写：进入藏经阁', '---END CHANGES---', ''].join('\n');

function chapterText(handoff) {
  return `　　正文。\n\n${handoff || HANDOFF_CHANGES}`;
}

const SNAPSHOT_WITH_HANDOFF = [
  '# 状态快照（截止第2章）', '', '## 下章交接包',
  '- 剧情当前位置：前殿西廊', '- 当前时间：入宗第 3 天', '- 下章该写：与竹牌主人交接', '',
  '## 角色状态', '', '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
  '|------|------|----------|------|------|-----------|', '| 林山 | 炼气三层 | 前殿西廊 | 健康 | 断锋剑 | 2 |', '',
].join('\n');

function writeLedger(settingsDir, chapter, snapshotFp, extra) {
  const dir = path.join(settingsDir, 'changes');
  fs.mkdirSync(dir, { recursive: true });
  const record = Object.assign({
    publishedAt: `2026-11-12T10:0${chapter}:00Z`,
    chapter,
    contentFingerprint: `sha256:content${chapter}`,
    fileName: `第${String(chapter).padStart(3, '0')}章.md`,
    snapshotFingerprint: snapshotFp,
    staleSnapshot: false,
  }, extra || {});
  fs.writeFileSync(path.join(dir, `ch${String(chapter).padStart(3, '0')}-publish.json`), JSON.stringify({
    schemaVersion: gate.SCHEMA_VERSION, chapter, novel: '续写测试',
    fileName: record.fileName, publishes: [record],
  }, null, 2));
}

/** 造一本书：chapters = 正文目录里有哪些章；snapshot = 快照文本（null 表示没有快照） */
function makeBook({ chapters = [], snapshot = null, ledgerChapters = [], ledgerSnapshotFp = 'current', chaptersText = null } = {}) {
  const dir = tmpDir('nw-next-');
  const settingsDir = path.join(dir, '设定');
  const contentDir = path.join(dir, '正文');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    info: { name: '续写测试' },
    local: { content_path: './正文', settings_path: './设定' },
  }, null, 2));

  const currentFp = snapshot === null ? null : gate.fileFingerprint(snapshot);
  if (snapshot !== null) fs.writeFileSync(path.join(settingsDir, '状态快照.md'), snapshot);
  for (const n of chapters) {
    fs.writeFileSync(path.join(contentDir, `第${String(n).padStart(3, '0')}章.md`), chaptersText || chapterText());
  }
  for (const n of ledgerChapters) {
    writeLedger(settingsDir, n, ledgerSnapshotFp === 'current' ? currentFp : `sha256:old${n}`);
  }
  return { dir, configPath: path.join(dir, 'config.json'), settingsDir };
}

test('空书：没有账本也没有正文 → 下一章第1章，提醒没有交接包，exit 0', () => {
  const { configPath } = makeBook({});
  const r = run([configPath, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.next.chapter, 1);
  assert.strictEqual(j.published.chapter, null);
  assert.deepStrictEqual(j.handoff.items, []);
  assert.ok(j.warnings.some((w) => w.code === 'no-handoff'), JSON.stringify(j.warnings));
  assert.deepStrictEqual(j.blockers, []);
});

test('已发到第2章且快照已回写 → 下一章第3章，交接包取自快照，exit 0', () => {
  const { configPath } = makeBook({
    chapters: [1, 2], snapshot: SNAPSHOT_WITH_HANDOFF, ledgerChapters: [1, 2], ledgerSnapshotFp: 'old',
  });
  const r = run([configPath, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.next.chapter, 3);
  assert.strictEqual(j.next.draftHint, '草稿/第003章.md');
  assert.strictEqual(j.handoff.source, 'snapshot');
  assert.strictEqual(j.handoff.items.find((it) => it.key === '剧情当前位置').value, '前殿西廊');
  assert.match(j.readFirst[0], /状态快照\.md/);
  assert.deepStrictEqual(j.blockers, []);
});

test('上一章发布后快照没回写 → 阻塞 exit 1，并指出去哪回写', () => {
  const { configPath } = makeBook({
    chapters: [1, 2], snapshot: SNAPSHOT_WITH_HANDOFF, ledgerChapters: [1, 2], ledgerSnapshotFp: 'current',
  });
  const r = run([configPath]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /状态快照\.md 未被改动/);
  assert.match(r.stdout, /⛔/);
  assert.match(r.stdout, /按第2章 CHANGES 回写/);
});

test('快照没有「下章交接包」→ 回退到上一章 CHANGES 的交接包', () => {
  const { configPath } = makeBook({ chapters: [1, 2], snapshot: '# 状态快照\n\n## 角色状态\n' });
  const r = run([configPath, '--json']);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.handoff.source, 'chapter');
  assert.strictEqual(j.next.chapter, 3);
  assert.strictEqual(j.handoff.items.find((it) => it.key === '下章该写').value, '进入藏经阁');
  assert.match(j.handoff.from, /第002章\.md/);
});

test('正文有第3章但账本只到第2章 → 提醒这章绕过闸门，下一章第4章', () => {
  const { configPath } = makeBook({ chapters: [1, 2, 3], snapshot: SNAPSHOT_WITH_HANDOFF, ledgerChapters: [1, 2], ledgerSnapshotFp: 'old' });
  const r = run([configPath, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.next.chapter, 4);
  assert.strictEqual(j.published.chapter, 2);
  assert.ok(j.warnings.some((w) => w.code === 'unpublished-content'), JSON.stringify(j.warnings));
});

test('账本说第3章已发布但正文没了 → 阻塞 exit 1（账本与正文对不上，别往下写）', () => {
  const { configPath } = makeBook({ chapters: [1, 2], snapshot: SNAPSHOT_WITH_HANDOFF, ledgerChapters: [1, 2, 3], ledgerSnapshotFp: 'old' });
  const r = run([configPath, '--json']);
  assert.strictEqual(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.ok(j.blockers.some((b) => b.code === 'ledger-without-content'), JSON.stringify(j.blockers));
});

test('缺章（有第1、3章，缺第2章）→ 提醒缺章，但不阻塞', () => {
  const { configPath } = makeBook({ chapters: [1, 3], snapshot: SNAPSHOT_WITH_HANDOFF });
  const r = run([configPath, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.warnings.some((w) => w.code === 'chapter-gap' && /第2章/.test(w.text)), JSON.stringify(j.warnings));
});

test('用法错误（缺参数 / 未知选项 / 配置不存在）→ exit 2', () => {
  assert.strictEqual(run([]).status, 2);
  const { configPath } = makeBook({});
  assert.strictEqual(run([configPath, '--nope']).status, 2);
  assert.strictEqual(run([path.join(os.tmpdir(), 'nw-not-exist', 'config.json')]).status, 2);
});

// ---------------- 伏笔账（v3.5.39）----------------

const FS_TABLE_HEAD = ['## 伏笔状态', '', '| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |', '|------|------|------|------|------|------|------|------|'];

function snapshotWith(rows, header = '# 状态快照（截止第7章）') {
  return [header, '', '## 下章交接包', '- 剧情当前位置：前殿西廊', '', ...FS_TABLE_HEAD, ...rows, ''].join('\n');
}

test('next-chapter：伏笔账点出该处理的、快到线的，终态不记账', () => {
  const b = makeBook({
    chapters: [1, 2, 3, 4, 5, 6, 7],
    ledgerChapters: [1, 2, 3, 4, 5, 6, 7], ledgerSnapshotFp: 'old',
    snapshot: snapshotWith([
      '| v1 | 断锋来历 | 长线 | 揭晓震惊 | 已埋设 | 第1章 | — | 待定 |',
      '| v2 | 古庙秘密 | 短线 | 好奇 | 已埋设 | 第3章 | — | — |',
      '| v3 | 掌门失踪 | 长线 | 悬疑 | 已推进 | 第2章 | 第4章 | 待定 |',
      '| v4 | 旧疤来历 | 短线 | 心酸 | 已回收 | 第1章 | 第2章 | 第3章 |',
    ]),
  });
  const r = run([path.join(b.dir, 'config.json')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /伏笔账（共 3 条未了结：1 条该处理、1 条快到线；长线 2、短线 1）/);
  assert.match(r.stdout, /🔴 v2 古庙秘密（短线，第3章埋设）已埋 5 章未推进/);
  assert.match(r.stdout, /🟡 v1 断锋来历（长线，第1章埋设）已埋 7 章未推进——距 10 章告警线还有 3 章/);
  assert.match(r.stdout, /⚪ v3 掌门失踪（长线，第4章推进）推进后 4 章还没回收/);
  assert.ok(!/v4 旧疤来历/.test(r.stdout), '已回收的伏笔不该出现在账上');
  assert.match(r.stdout, /伏笔逾期：1 条到了该推进\/该收的时候/);
});

test('next-chapter：--json 里带 foreshadow 结构', () => {
  const b = makeBook({
    chapters: [1, 2, 3, 4, 5, 6, 7],
    ledgerChapters: [1, 2, 3, 4, 5, 6, 7], ledgerSnapshotFp: 'old',
    snapshot: snapshotWith([
      '| v1 | 断锋来历 | 长线 | 揭晓震惊 | 已埋设 | 第1章 | — | 待定 |',
      '| v2 | 古庙秘密 | 短线 | 好奇 | 已埋设 | 第3章 | — | — |',
    ]),
  });
  const r = run([path.join(b.dir, 'config.json'), '--json']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.foreshadow.hasTable, true);
  assert.strictEqual(j.foreshadow.checked, 2);
  assert.strictEqual(j.foreshadow.open, 2);
  assert.strictEqual(j.foreshadow.overdue, 1);
  assert.strictEqual(j.foreshadow.due, 1);
  assert.deepStrictEqual(j.foreshadow.byType, { 长线: 1, 短线: 1 });
  const v2 = j.foreshadow.entries.find((e) => e.id === 'v2');
  assert.strictEqual(v2.level, 'overdue');
  assert.strictEqual(v2.age, 5);
  const v1 = j.foreshadow.entries.find((e) => e.id === 'v1');
  assert.strictEqual(v1.level, 'due');
  assert.strictEqual(v1.plant, 1);
});

test('next-chapter：伏笔全收干净时说「没有欠账」', () => {
  const b = makeBook({
    chapters: [1, 2],
    ledgerChapters: [1, 2], ledgerSnapshotFp: 'old',
    snapshot: snapshotWith([
      '| v1 | 断锋来历 | 长线 | 揭晓震惊 | 已回收 | 第1章 | 第1章 | 第2章 |',
      '| v2 | 古庙秘密 | 短线 | 好奇 | 已废弃 | 第2章 | — | — |',
    ]),
  });
  const r = run([path.join(b.dir, 'config.json')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /伏笔账：2 条都收干净了，没有欠账/);
  assert.ok(!/伏笔逾期/.test(r.stdout));
});

test('next-chapter：快照没有伏笔状态表 → 明说算不了，不影响续写判定', () => {
  const b = makeBook({ chapters: [1, 2], ledgerChapters: [1, 2], ledgerSnapshotFp: 'old', snapshot: SNAPSHOT_WITH_HANDOFF });
  const r = run([path.join(b.dir, 'config.json')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /伏笔账：（快照没有 ## 伏笔状态 表，这笔账算不了）/);
  const j = JSON.parse(run([path.join(b.dir, 'config.json'), '--json']).stdout);
  assert.strictEqual(j.foreshadow.hasTable, false);
  assert.deepStrictEqual(j.foreshadow.entries, []);
});

test('next-chapter：缺埋设章 / 状态认不得时不炸，写明为什么算不出来', () => {
  const b = makeBook({
    chapters: [1, 2],
    ledgerChapters: [1, 2], ledgerSnapshotFp: 'old',
    snapshot: snapshotWith([
      '| v1 | 断锋来历 | 长线 | 揭晓震惊 | 已埋设 | — | — | 待定 |',
      '| v2 | 古庙秘密 | ??? | 好奇 | 挂着 | — | — | — |',
    ]),
  });
  const r = run([path.join(b.dir, 'config.json')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /v1 断锋来历（长线）缺埋设章，这笔账算不出来/);
  assert.match(r.stdout, /v2 古庙秘密（\?\?\?）状态「挂着」认不得，跳过/);
});
