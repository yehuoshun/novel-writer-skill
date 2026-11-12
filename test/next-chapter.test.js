'use strict';
// 续写位置（next-chapter）：账本 + 正文目录 + 交接包三处拼成「我停在哪、下一章读什么」
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-next-'));
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
