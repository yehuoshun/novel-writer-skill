'use strict';
// 全书体检（scripts/book-report.js）：跨章口径——爽点断档/同质、钩子疲软、情绪太平、字数、计划 vs 实况
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpDir } = require('./helpers/tmp');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'book-report.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
}

// 每章 ~14 个汉字，别触发爽点间隔那条（>5000 字）
const BODY = '　　林山提剑走出山门，风雪扑面而来。\n';

function makeBook({ n = 6, body = BODY, files = {}, min = null } = {}) {
  const dir = tmpDir('nw-book-report-');
  const content = path.join(dir, '正文');
  const settings = path.join(dir, '设定');
  fs.mkdirSync(content, { recursive: true });
  fs.mkdirSync(settings, { recursive: true });
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(content, `第${String(i).padStart(3, '0')}章.md`), body, 'utf-8');
  }
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(settings, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf-8');
  }
  const cfg = {
    info: { name: '测试书' },
    local: { content_path: '正文', settings_path: '设定' },
    writing: min === null ? {} : { chapter_words: { min } },
  };
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  return { dir, cfgPath };
}

const SWEET = (rows) => `# 爽点追踪\n\n| 章节 | 爽点类型 | 铺放比 |\n|---|---|---|\n${rows}\n`;

const HOOK = (tailRows, headRows = '| 1 | 悬念 | 强 |\n') => `# 钩子追踪

## 章首钩子

| 章节 | 类型 | 强度 |
|---|---|---|
${headRows}
## 章尾钩子

| 章节 | 类型 | 强度 |
|---|---|---|
${tailRows}
`;

const EMOTION = (rows) => `# 情绪曲线

## 情绪走势

| 章节 | 开头情绪 | 中段情绪 | 结尾情绪 | 情绪极值 | 反转点 |
|---|---|---|---|---|---|
${rows}
`;

test('干净的书：没有硬问题、退出 0、报告写清跨度和数据源', () => {
  const { cfgPath } = makeBook({
    n: 4,
    files: {
      '爽点追踪.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 升级 | 2:1 |\n| 3 | 反转 | 3:1 |\n| 4 | 打脸 | 3:1 |'),
      '钩子追踪.md': HOOK('| 1 | 悬念 | 中 |\n| 2 | 危机 | 强 |\n| 3 | 悬念 | 中 |\n| 4 | 危机 | 强 |'),
    },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /全书体检：测试书/);
  assert.match(r.stdout, /跨度：第1–4章（4 章/);
  assert.match(r.stdout, /爽点追踪（实况，覆盖 4 章）/);
  assert.match(r.stdout, /✅ 跨章口径没发现硬问题/);
});

test('连续 2 章没爽点 → 红线点名，退出 1', () => {
  const { cfgPath } = makeBook({
    n: 4,
    files: { '爽点追踪.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 无 | — |\n| 3 | 无 | — |\n| 4 | 升级 | 2:1 |') },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[爽点断档\] 第2–3章 连续 2 章没有爽点/);
});

test('追踪档缺章不算连号：第2章和第10章之间那几个字别被算成「连续」', () => {
  const { cfgPath } = makeBook({
    n: 12,
    body: '　　短。\n',
    files: { '爽点追踪.md': SWEET('| 1 | 无 | — |\n| 2 | 无 | — |\n| 10 | 无 | — |\n| 11 | 无 | — |') },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[爽点断档\] 第1–2章 连续 2 章/);
  assert.match(r.stdout, /\[爽点断档\] 第10–11章 连续 2 章/);
  assert.doesNotMatch(r.stdout, /第1–11章|第2–10章/);
});

test('同一类型连用 3 章 → 提醒换类型（而不是只在单章里挑毛病）', () => {
  const { cfgPath } = makeBook({
    n: 6,
    files: { '爽点追踪.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 打脸 | 3:1 |\n| 3 | 打脸 | 3:1 |\n| 4 | 升级 | 2:1 |') },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[爽点同质\] 第1–3章 连续 3 章都是「打脸」/);
  // 只报那一段，别把后面的「升级」也算进去
  assert.doesNotMatch(r.stdout, /升级」/);
});

test('章尾钩子连续 3 章「弱」→ 红线；章尾留空的章单独点名', () => {
  const { cfgPath } = makeBook({
    n: 5,
    files: {
      '钩子追踪.md': HOOK('| 1 | 悬念 | 弱 |\n| 2 | 悬念 | 弱 |\n| 3 | 危机 | 弱 |\n| 4 | 无 | 中 |\n| 5 | 危机 | 强 |'),
    },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[钩子疲软\] 第1–3章 连续 3 章尾钩强度都是「弱」/);
  assert.match(r.stdout, /\[章尾无钩\] 第4章章尾没有钩子/);
});

test('情绪极值连续 3 章 ≤5 → 太平；连续 5 章 ≥8 → 疲劳（前者红、后者黄）', () => {
  const { cfgPath } = makeBook({
    n: 8,
    files: {
      '情绪曲线.md': EMOTION(
        [
          '| 1 | 平静(3) | 紧绷(4) | 平静(3) | 4 | — |',
          '| 2 | 平静(3) | 紧绷(4) | 平静(3) | 4 | — |',
          '| 3 | 平静(3) | 紧绷(4) | 平静(3) | 5 | — |',
          '| 4 | 爽(8) | 极爽(9) | 爽(8) | 9 | — |',
          '| 5 | 爽(8) | 极爽(9) | 爽(8) | 9 | — |',
          '| 6 | 爽(8) | 极爽(9) | 爽(8) | 8 | — |',
          '| 7 | 爽(8) | 极爽(9) | 爽(8) | 9 | — |',
          '| 8 | 爽(8) | 极爽(9) | 爽(8) | 9 | — |',
        ].join('\n')
      ),
    },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\[情绪太平\] 第1–3章 连续 3 章情绪极值 ≤5/);
  assert.match(r.stdout, /⚠️ 看着办/);
  assert.match(r.stdout, /\[情绪疲劳\] 第4–8章 连续 5 章情绪极值 ≥8/);
});

test('字数低于下限聚成一条点名（不刷屏）；下限没配就不查', () => {
  const withMin = makeBook({ n: 2, min: 1000 });
  const r = run([withMin.cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.strictEqual((r.stdout.match(/\[字数不足\]/g) || []).length, 1);
  assert.match(r.stdout, /\[字数不足\] 2 章短于下限 1000 字：第1章、第2章（最短 第1章 \d+ 字）/);

  const noMin = makeBook({ n: 2 });
  const r2 = run([noMin.cfgPath]);
  assert.strictEqual(r2.status, 0, r2.stdout);
  assert.doesNotMatch(r2.stdout, /字数不足/);
});

test('追踪档是目录形态（设定/爽点追踪/*.md）也认得', () => {
  const { cfgPath } = makeBook({
    n: 3,
    files: {
      '爽点追踪/第001-020章.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 无 | — |\n| 3 | 无 | — |'),
    },
  });
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /爽点追踪（实况，覆盖 3 章）/);
  assert.match(r.stdout, /\[爽点断档\] 第2–3章/);
});

test('细纲写的爽点类型和实写不一致 → 列出来（最多 5 条）', () => {
  const outline = `# 细纲

| 章 | 核心事件 | 爽点类型 | 章首钩子 | 章尾钩子 | 字数 |
|---|---|---|---|---|---|
| 1 | 入门 | 打脸 | 悬念 | 危机 | 3000 |
| 2 | 试炼 | 升级 | 悬念 | 危机 | 3000 |

## 蓝图出场清单

| 章 | 必出场 |
|---|---|
| 1 | 林山 |
`;
  const { cfgPath } = makeBook({
    n: 2,
    files: {
      '大纲/细纲/第一卷.md': outline,
      '爽点追踪.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 反转 | 3:1 |'),
    },
  });
  const r = run([cfgPath]);
  assert.match(r.stdout, /【计划 vs 实况】1 章的爽点类型和细纲不一致/);
  assert.match(r.stdout, /第2章 计划「升级」→ 实写「反转」/);
});

test('--json 给结构化结果；--write 落到 设定/全书体检.md', () => {
  const { dir, cfgPath } = makeBook({
    n: 3,
    files: { '爽点追踪.md': SWEET('| 1 | 打脸 | 3:1 |\n| 2 | 无 | — |\n| 3 | 无 | — |') },
  });
  const r = run([cfgPath, '--json']);
  assert.strictEqual(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.range.chapters, 3);
  assert.strictEqual(out.sweet.checked, 3);
  assert.deepStrictEqual(out.sweet.distribution, { 打脸: 1, 无: 2 });
  assert.ok(out.findings.some((f) => f.rule === '爽点断档' && f.level === 'red'));

  const w = run([cfgPath, '--write']);
  assert.strictEqual(w.status, 1);
  const report = path.join(dir, '设定', '全书体检.md');
  assert.ok(fs.existsSync(report), '应写出 设定/全书体检.md');
  const text = fs.readFileSync(report, 'utf-8');
  assert.match(text, /^# 全书体检（第1–3章）/);
  assert.match(text, /\[爽点断档\]/);

  const bad = run([cfgPath, '--nope']);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /未知选项 --nope/);
});

test('正文目录空着：不报错，说明没什么可看的（还没开始写）', () => {
  const dir = tmpDir('nw-book-report-');
  fs.mkdirSync(path.join(dir, '正文'), { recursive: true });
  fs.mkdirSync(path.join(dir, '设定'), { recursive: true });
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ info: { name: '空书' }, local: { content_path: '正文', settings_path: '设定' } }), 'utf-8');
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /还没开始写/);
});

test('账本记着发布时的字数：规则按发布时算，发布后被改过另算一条黄条', () => {
  const { cfgPath, dir } = makeBook({ n: 3, min: 100 });
  // 第 1 章发布时 200 字，之后正文被改短到 14 字 —— 账本才是「当时的事实」
  const ledgerDir = path.join(dir, '设定', 'changes');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, 'ch001-publish.json'),
    JSON.stringify({ schemaVersion: 1, chapter: 1, publishes: [{ metrics: { words: 200, chars: 260, paragraphs: 6, dialogueRatio: 0.3 } }] }),
    'utf-8'
  );
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 1, '另外两章仍不足下限，应有红线');
  assert.match(r.stdout, /2 章短于下限 100 字/, '第 1 章按账本 200 字算，不该算进字数不足');
  assert.doesNotMatch(r.stdout, /3 章短于下限/);
  assert.match(r.stdout, /\[发布后改稿\] 第1章 发布时 200 字，现在 14 字（差 93%）/);
  assert.match(r.stdout, /发布账本（1 章字数取发布时口径）/);
});

test('账本字数与当前正文差不到 2%：不报发布后改稿', () => {
  const { cfgPath, dir } = makeBook({ n: 2 });
  const ledgerDir = path.join(dir, '设定', 'changes');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, 'ch001-publish.json'),
    JSON.stringify({ schemaVersion: 1, chapter: 1, publishes: [{ metrics: { words: 14, chars: 18, paragraphs: 1, dialogueRatio: 0 } }] }),
    'utf-8'
  );
  const r = run([cfgPath]);
  assert.doesNotMatch(r.stdout, /发布后改稿/);
  assert.match(r.stdout, /发布账本（1 章字数取发布时口径）/);
});
