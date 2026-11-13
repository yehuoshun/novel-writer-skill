'use strict';
// publish-batch：多章续跑的编排（断点起算 / 缺声明先拒 / 中途被打回就停，后面的不动）
// 门禁细节由 publish-gate.test.js 覆盖，这里只验「批量怎么串」。
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');
const gate = require('../scripts/lib/gate-suite');

const REPORT = path.join(__dirname, '..', 'scripts', 'gate-report.js');
const BATCH = path.join(__dirname, '..', 'scripts', 'publish-batch.js');
const runBatch = (args, cwd) => spawnSync(process.execPath, [BATCH, ...args], { encoding: 'utf-8', cwd });

// 合格正文：段首两全角空格、全角标点、汉字 ≥100
const BODY = [
  '　　青云山的晨雾还没散，林山已经站在后山的石阶上。他把剑从鞘里抽出一寸，又推了回去。',
  '',
  '　　风从谷底翻上来，带着湿冷的草腥气。他数着呼吸，一，二，三，数到第七下才停手。',
  '',
  '　　前殿那边传来钟声。林山抬头看了一眼天色，转身往下走。石阶很窄，两侧的松针落了一地。',
  '',
  '　　他忽然想起昨夜师父说过的那句话，脚下慢了半拍，随即又加快。有些事想不明白，就只能先往前走。',
  '',
].join('\n');
const QUOTE = '他把剑从鞘里抽出一寸';

const CHANGES_1 = [
  '---CHANGES---',
  '<!-- 角色状态变化 -->',
  '- **[林山]**：健康→健康',
  '<!-- 角色移动 -->',
  '- **[林山]**：青云山后山→青云山前殿',
  '<!-- 交接包 -->',
  '- 剧情当前位置：青云山前殿',
  '---END CHANGES---',
  '',
].join('\n');

const CHANGES_2 = [
  '---CHANGES---',
  '<!-- 角色状态变化 -->',
  '- **[林山]**：健康→健康',
  '<!-- 交接包 -->',
  '- 剧情当前位置：青云山前殿',
  '---END CHANGES---',
  '',
].join('\n');

const SNAPSHOT = [
  '# 状态快照（截止第0章）',
  '',
  '## 角色状态',
  '',
  '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
  '|------|------|----------|------|------|-----------|',
  '| 林山 | 炼气三层 | 青云山后山 | 健康 | 剑 | 0 |',
  '',
].join('\n');

const declFile = (ch) => `ch${String(ch).padStart(3, '0')}-ai-gates.json`;

/** 造一本书：设定齐、草稿目录里放指定的几章、AI 声明放 声明/ */
function makeBook(drafts) {
  const dir = tmpDir('nw-batch-');
  const settingsDir = path.join(dir, '设定');
  fs.mkdirSync(path.join(settingsDir, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(settingsDir, '地点设定'), { recursive: true });
  fs.writeFileSync(path.join(settingsDir, '角色设定', '主角', '林山.md'), '# 林山\n\n- 发色：黑\n- 瞳色：黑\n');
  fs.writeFileSync(path.join(settingsDir, '地点设定', '青云山.md'), '# 青云山\n');
  fs.writeFileSync(path.join(settingsDir, '状态快照.md'), SNAPSHOT);

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    info: { name: '测试书' },
    save_location: 'local',
    local: { content_path: './正文', settings_path: './设定' },
    writing: { chapter_words: { min: 100, max: 4000 } },
  }, null, 2) + '\n');

  const draftDir = path.join(dir, '草稿');
  const declDir = path.join(dir, '声明');
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(declDir, { recursive: true });
  // drafts: { 章号: 正文 part }，part 会拼在 BODY 后面（CHANGES 不同、指纹也不同）
  for (const [ch, parts] of Object.entries(drafts || {})) {
    const file = path.join(draftDir, `第${String(ch).padStart(3, '0')}章.md`);
    fs.writeFileSync(file, BODY + parts);
    emitDecl(file, path.join(dir, 'config.json'), path.join(declDir, declFile(ch)));
  }
  return { dir, settingsDir, draftDir, declDir };
}

function emitDecl(draft, config, out) {
  const r = spawnSync(process.execPath, [REPORT, draft, '--config', config, '--emit-ai-template', out], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`emit-ai-template 失败：${r.stdout}${r.stderr}`);
  const d = JSON.parse(fs.readFileSync(out, 'utf-8'));
  for (const k of Object.keys(d.gates)) {
    d.gates[k].verdict = 'pass';
    d.gates[k].evidence = `正文「${QUOTE}」这段没有套话与心理外化`;
  }
  fs.writeFileSync(out, JSON.stringify(d, null, 2) + '\n');
}

function ledgerOf(dir, ch) {
  const p = path.join(dir, '设定', 'changes', `ch${String(ch).padStart(3, '0')}-publish.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

const bodyOf = (dir, ch) => path.join(dir, '正文', `第${String(ch).padStart(3, '0')}章.md`);

// ---------------- 计划（dry-run） ----------------

test('publish-batch：默认 dry-run 只列计划，不落正文', () => {
  const b = makeBook({ 1: CHANGES_1, 2: CHANGES_2, 3: '' });
  const r = runBatch(['config.json', '--chapters', '2'], b.dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /从第1章起连发 2 章/);
  assert.match(r.stdout, /第001章\s+草稿\/第001章\.md/);
  assert.match(r.stdout, /第002章\s+草稿\/第002章\.md/);
  assert.match(r.stdout, /dry-run/);
  assert.ok(!fs.existsSync(path.join(b.dir, '正文')), 'dry-run 不该建正文目录');
});

test('publish-batch：--json 给出机器可读计划，缺草稿的章标 null', () => {
  const b = makeBook({ 1: CHANGES_1 });
  const r = runBatch(['config.json', '--chapters', '2', '--json'], b.dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.dryRun, true);
  assert.strictEqual(j.start, 1);
  assert.strictEqual(j.requested, 2);
  assert.strictEqual(j.plan[0].chapter, 1);
  assert.strictEqual(j.plan[0].draft, '草稿/第001章.md');
  assert.strictEqual(j.plan[1].draft, null, '第2章没草稿');
});

// ---------------- 参数与前置拒绝 ----------------

test('publish-batch：--chapters 缺失或非法 → exit 2', () => {
  const b = makeBook({ 1: CHANGES_1 });
  for (const args of [['config.json'], ['config.json', '--chapters', '0'], ['config.json', '--chapters', 'abc'], ['config.json', '--chapters', '201']]) {
    const r = runBatch(args, b.dir);
    assert.strictEqual(r.status, 2, `${args.join(' ')} → ${r.status}`);
  }
});

test('publish-batch：--write 却没声明目录也没 --allow-missing-ai → exit 2，一章都不发', () => {
  const b = makeBook({ 1: CHANGES_1 });
  const r = runBatch(['config.json', '--chapters', '1', '--write'], b.dir);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /allow-missing-ai/);
  assert.ok(!fs.existsSync(bodyOf(b.dir, 1)), '拒绝时不该落下正文');
});

// ---------------- 真发 ----------------

test('publish-batch：连发两章，每章都自动回写快照并记账', () => {
  const b = makeBook({ 1: CHANGES_1, 2: CHANGES_2 });
  const r = runBatch(['config.json', '--chapters', '2', '--ai-gates', '声明', '--write'], b.dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(bodyOf(b.dir, 1)), '第1章正文应在');
  assert.ok(fs.existsSync(bodyOf(b.dir, 2)), '第2章正文应在');
  assert.strictEqual(ledgerOf(b.dir, 1).publishes[0].snapshotApplied, true, '第1章应回写快照');
  assert.strictEqual(ledgerOf(b.dir, 2).publishes[0].snapshotApplied, true, '第2章应回写快照');
  const snap = fs.readFileSync(path.join(b.dir, '设定', '状态快照.md'), 'utf-8');
  assert.match(snap, /# 状态快照（截止第2章）/);
  assert.match(r.stdout, /已发布 2 章/);
});

test('publish-batch：断点起算——发过第1章后再跑，从第2章继续', () => {
  const b = makeBook({ 1: CHANGES_1, 2: CHANGES_2 });
  const first = runBatch(['config.json', '--chapters', '1', '--ai-gates', '声明', '--write'], b.dir);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  const dry = runBatch(['config.json', '--chapters', '1'], b.dir);
  assert.strictEqual(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /从第2章起/);
  assert.match(dry.stdout, /当前账本最后一章：1/);
});

test('publish-batch：某章被打回 → 停在该章，后面的一个字节都不动', () => {
  // 第2章正文带半角逗号 → 门禁拦；第3章本身没问题，但不该被发出去
  const bad = BODY.replace(/，/g, ',') + CHANGES_2;
  const b = makeBook({ 1: CHANGES_1, 3: CHANGES_2 });
  fs.writeFileSync(path.join(b.draftDir, '第002章.md'), bad);
  emitDecl(path.join(b.draftDir, '第002章.md'), path.join(b.dir, 'config.json'), path.join(b.declDir, declFile(2)));

  const r = runBatch(['config.json', '--chapters', '3', '--ai-gates', '声明', '--write'], b.dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /停在第2章/);
  assert.ok(fs.existsSync(bodyOf(b.dir, 1)), '第1章该发出去');
  assert.ok(!fs.existsSync(bodyOf(b.dir, 2)), '第2章被打回，不该落盘');
  assert.ok(!fs.existsSync(bodyOf(b.dir, 3)), '第3章不该被顺手发出去');
  assert.strictEqual(ledgerOf(b.dir, 3), null, '第3章不该有账本');
});

test('publish-batch：缺草稿就停（明确告诉缺哪个文件）', () => {
  const b = makeBook({ 1: CHANGES_1 });
  const r = runBatch(['config.json', '--chapters', '2', '--ai-gates', '声明', '--write'], b.dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /第2章没有草稿/);
  assert.match(r.stderr, /第002章\.md/);
  assert.ok(fs.existsSync(bodyOf(b.dir, 1)), '第1章仍该发出去');
});

test('publish-batch：--json 输出结构化结果', () => {
  const b = makeBook({ 1: CHANGES_1 });
  const r = runBatch(['config.json', '--chapters', '1', '--ai-gates', '声明', '--write', '--json'], b.dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.dryRun, false);
  assert.deepStrictEqual(j.published, [1]);
  assert.strictEqual(j.stopped, null);
  assert.deepStrictEqual(j.results, [{ chapter: 1, exit: 0, ok: true }]);
});

test('publish-batch：没有 --ai-gates 时用 --allow-missing-ai 也能跑（账本记 aiOmitted）', () => {
  const b = makeBook({ 1: CHANGES_1 });
  fs.rmSync(b.declDir, { recursive: true, force: true }); // 声明目录都不存在
  const r = runBatch(['config.json', '--chapters', '1', '--allow-missing-ai', '--write'], b.dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(bodyOf(b.dir, 1)));
  const rec = ledgerOf(b.dir, 1).publishes[0];
  assert.strictEqual(rec.aiOmitted, true, JSON.stringify(rec));
});
