#!/usr/bin/env node
/**
 * 续写位置（断点续跑）
 *
 * 用法:
 *   node next-chapter.js <config.json> [--json]
 *
 * 输出:
 *   - 已发布到第几章（来自 设定/changes/chNNN-publish.json 账本，含时间与发布次数）
 *   - 正文目录实际到第几章（两者不一致时点名）
 *   - 下一章该写第几章、草稿写哪、发布目标哪
 *   - 下一章该读的交接包（状态快照.md 的 `## 下章交接包`；快照没写就回退到上一章 CHANGES 的 `<!-- 交接包 -->`）
 *   - 伏笔账：未了结的伏笔各埋了多少章、哪条该推进、哪条该收了（快照「## 伏笔状态」表）
 *   - 阻塞项：快照欠账（下一章发布会 exit 4）、账本说有正文却没有
 *
 * 为什么要有这个脚本：
 *   交接包、快照、账本三样东西项目里一直都有，但它们分散在「快照顶部一段 markdown」「分章 JSON 账本」
 *   「正文目录文件名」三处，跨会话接手时只能靠人（或 AI）自己 ls + 翻快照拼出来。断了几天再回来，
 *   或者换一个会话接着写，第一件事就是「我停在哪、下一章该读什么」——这个脚本把那三个来源拼成一句话。
 *
 * 退出码: 0=可继续写, 1=有阻塞（快照欠账 / 账本与正文不一致）, 2=用法或 IO 错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');
const { snapshotRows, ledgerReport } = require('./lib/foreshadow-audit');

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function show(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
}

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const positional = argv.filter((a) => !a.startsWith('--'));
const unknown = argv.filter((a) => a.startsWith('--') && a !== '--json');
if (unknown.length) die(`未知选项 ${unknown[0]}`);
const [configPath] = positional;
if (!configPath) die('用法: node next-chapter.js <config.json> [--json]');
if (!fs.existsSync(configPath)) die(`配置不存在: ${configPath}`);

let config;
try {
  config = gate.readJsonIfExists(configPath);
} catch (e) {
  die(e.message);
}
if (!config) die(`配置为空: ${configPath}`);

const base = path.dirname(path.resolve(configPath));
const local = config.local || {};
if (!local.content_path) die('配置缺 local.content_path（正文目录）');
if (!local.settings_path) die('配置缺 local.settings_path（设定目录）');
const contentDir = path.resolve(base, local.content_path);
const settingsDir = path.resolve(base, local.settings_path);
const ledgerDir = path.join(settingsDir, 'changes');
const snapshotPath = path.join(settingsDir, '状态快照.md');

/** 正文目录里现存的章号 → 文件路径 */
function scanChapters(dir) {
  const found = new Map();
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir)) {
    // 认两种命名：`第024章.md`（工具默认）与 `第024章 扫地.md`（团队约定带章名）
    const m = name.match(/^第\s*0*(\d+)\s*章(?:\s+[^\\/]*)?\.md$/);
    if (m) found.set(Number(m[1]), path.join(dir, name));
  }
  return found;
}

/** 从 markdown 的 `## 下章交接包` 段落里取 `- 键：值`（也认半角冒号） */
function handoffFromSnapshot(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*下章交接包/.test(l));
  if (start < 0) return null;
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const m = lines[i].match(/^-\s*([^：:]+)[：:](.*)$/);
    if (m) items.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return items.length ? items : null;
}

/** 从正文的 CHANGES 块里取 `<!-- 交接包 -->` 段（快照还没回写时的兜底来源） */
function handoffFromChapter(text) {
  const block = text.match(/---CHANGES---\r?\n([\s\S]*?)\r?\n---END CHANGES---/);
  if (!block) return null;
  const lines = block[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^<!--\s*交接包/.test(l.trim()));
  if (start < 0) return null;
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^<!--/.test(t)) break;
    const m = t.match(/^-\s*([^：:]+)[：:](.*)$/);
    if (m) items.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return items.length ? items : null;
}

function chapterFileLabel(n) {
  return `第${String(n).padStart(3, '0')}章.md`;
}

// ---- 账本 ----
let ledgers = [];
try {
  ledgers = gate.loadPublishLedgers(ledgerDir);
} catch (e) {
  die(`读账本失败：${e.message}`);
}
const brokenLedgers = ledgers.filter((l) => l.error);
if (brokenLedgers.length) {
  brokenLedgers.forEach((l) => console.error(`⚠️ 账本 ${path.basename(l.file)} 解析失败：${l.error}`));
}
const published = ledgers.filter((l) => !l.error && l.publishes.length);
const publishedMax = published.length ? Math.max(...published.map((l) => l.chapter)) : 0;
const lastPublished = published.find((l) => l.chapter === publishedMax) || null;
const lastRecord = lastPublished ? lastPublished.publishes[lastPublished.publishes.length - 1] : null;

// ---- 正文 ----
const chapters = scanChapters(contentDir);
const contentMax = chapters.size ? Math.max(...[...chapters.keys()]) : 0;
const nextChapter = Math.max(publishedMax, contentMax) + 1;

// ---- 快照：只读一次，交接包 / 指纹 / 伏笔账共用 ----
let snapshotText = null;
try {
  if (fs.existsSync(snapshotPath)) snapshotText = fs.readFileSync(snapshotPath, 'utf-8');
} catch (e) {
  die(`读状态快照失败：${e.message}`);
}

// ---- 交接包：快照优先，快照没写就回退到上一章 CHANGES ----
let handoff = { source: null, items: [], from: null };
if (snapshotText !== null) {
  const items = handoffFromSnapshot(snapshotText);
  if (items) handoff = { source: 'snapshot', items, from: show(snapshotPath) };
}
if (!handoff.items.length) {
  const prevChapter = chapters.size ? Math.max(...[...chapters.keys()]) : 0;
  if (prevChapter) {
    const prevPath = chapters.get(prevChapter);
    const items = handoffFromChapter(fs.readFileSync(prevPath, 'utf-8'));
    if (items) handoff = { source: 'chapter', items, from: show(prevPath) };
  }
}

// ---- 阻塞项 ----
const blockers = [];
const warnings = [];

let snapshotFp = null;
if (snapshotText !== null) snapshotFp = gate.fileFingerprint(snapshotText);
const prevPublish = gate.previousPublish(ledgers, nextChapter);
const freshness = gate.snapshotFreshness({
  currentFp: snapshotFp,
  previousChapter: prevPublish ? prevPublish.chapter : null,
  previousFp: prevPublish ? prevPublish.record.snapshotFingerprint : null,
});
if (freshness.verdict === 'fail') {
  blockers.push({
    code: 'stale-snapshot',
    text: freshness.reason,
    fix: `按第${prevPublish.chapter}章 CHANGES 回写 ${show(snapshotPath)}；确认无需回写时发布可加 --allow-stale-snapshot`,
  });
}
if (publishedMax > contentMax) {
  blockers.push({
    code: 'ledger-without-content',
    text: `账本说第${publishedMax}章已发布，但正文目录里最高只有第${contentMax}章——正文被删或换了目录`,
    fix: '确认正文目录指对了；账本与正文对不上时不要继续往下写',
  });
}
if (contentMax > publishedMax) {
  warnings.push({
    code: 'unpublished-content',
    text: `正文目录里有第${contentMax}章但账本没有发布记录——这章是绕过闸门落盘的`,
    fix: '需要的话重新过 publish-chapter 记账（同稿重发是幂等的）',
  });
}
const missing = [];
for (let n = 1; n <= Math.max(publishedMax, contentMax); n++) {
  if (!chapters.has(n) && !published.some((l) => l.chapter === n)) missing.push(n);
}
if (missing.length) {
  warnings.push({
    code: 'chapter-gap',
    text: `缺章：${missing.map((n) => `第${n}章`).join('、')} 既没有正文也没有账本`,
    fix: '确认是有意跳号（番外/序章）还是漏发',
  });
}
if (!handoff.items.length) {
  warnings.push({
    code: 'no-handoff',
    text: '没有可读的交接包：状态快照里没有 `## 下章交接包`，上一章 CHANGES 里也没有 `<!-- 交接包 -->`',
    fix: '先回写上一章的 CHANGES（含交接包），再开写下一章',
  });
}

// ---- 伏笔账：动笔前先看哪条欠着 ----
const foreshadow = (() => {
  if (snapshotText === null) return { hasTable: false, checked: 0, open: 0, overdue: 0, due: 0, byType: {}, entries: [] };
  const rows = snapshotRows(snapshotText);
  const report = ledgerReport(rows, nextChapter);
  return { hasTable: /^##\s*伏笔状态/m.test(snapshotText), ...report };
})();
if (foreshadow.overdue > 0) {
  warnings.push({
    code: 'foreshadow-overdue',
    text: `伏笔逾期：${foreshadow.overdue} 条到了该推进/该收的时候（见上方伏笔账）`,
    fix: '这一章顺手推一条，比后面一次性补三条容易',
  });
}

const result = {
  novel: (config.info && config.info.name) || '',
  published: {
    chapter: publishedMax || null,
    at: lastRecord ? lastRecord.publishedAt : null,
    publishes: lastPublished ? lastPublished.publishes.length : 0,
    staleSnapshot: lastRecord ? !!lastRecord.staleSnapshot : false,
  },
  content: { chapter: contentMax || null, file: contentMax ? show(chapters.get(contentMax)) : null },
  next: {
    chapter: nextChapter,
    draftHint: `草稿/第${String(nextChapter).padStart(3, '0')}章.md`,
    target: show(path.join(contentDir, chapterFileLabel(nextChapter))),
  },
  handoff,
  foreshadow,
  readFirst: handoff.source === 'snapshot'
    ? [show(snapshotPath), '本章涉及角色的设定档案（角色设定/主角/*.md）']
    : handoff.from ? [handoff.from, '以及回写后的 状态快照.md'] : [show(snapshotPath)],
  blockers,
  warnings,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(blockers.length ? 1 : 0);
}

const lines = [];
lines.push(`📖 续写位置：${result.novel || '(未命名)'}`);
lines.push(`   已发布：${result.published.chapter ? `第${result.published.chapter}章` : '（还没有发布记录）'}` +
  (result.published.at ? `   ${result.published.at}   账本 ${result.published.publishes} 次` : ''));
lines.push(`   正文目录：${result.content.chapter ? `第${result.content.chapter}章（${result.content.file}）` : '（空）'}`);
lines.push(`   下一章：第${result.next.chapter}章   草稿写 ${result.next.draftHint} → 发布目标 ${result.next.target}`);
if (handoff.items.length) {
  lines.push(`   交接包（来自 ${handoff.from}${handoff.source === 'chapter' ? ' · 快照还没回写，取的是上一章 CHANGES' : ''}）：`);
  handoff.items.forEach((it) => lines.push(`     - ${it.key}：${it.value}`));
} else {
  lines.push('   交接包：（无）');
}
if (!foreshadow.hasTable) {
  lines.push('   伏笔账：（快照没有 ## 伏笔状态 表，这笔账算不了）');
} else if (!foreshadow.open) {
  lines.push(`   伏笔账：${foreshadow.checked} 条都收干净了，没有欠账`);
} else {
  const head = [];
  if (foreshadow.overdue) head.push(`${foreshadow.overdue} 条该处理`);
  if (foreshadow.due) head.push(`${foreshadow.due} 条快到线`);
  const types = Object.entries(foreshadow.byType).map(([t, n]) => `${t} ${n}`).join('、');
  lines.push(`   伏笔账（共 ${foreshadow.open} 条未了结${head.length ? '：' + head.join('、') : ''}${types ? '；' + types : ''}）：`);
  const icon = { overdue: '🔴', due: '🟡', idle: '⚪' };
  foreshadow.entries
    .slice()
    .sort((a, b) => {
      const rank = { overdue: 0, due: 1, idle: 2 };
      return (rank[a.level] - rank[b.level]) || (Number(a.id.slice(1)) - Number(b.id.slice(1)));
    })
    .forEach((e) => lines.push(`     ${icon[e.level] || '⚪'} ${e.text}`));
}
lines.push(`   开写前先读：${result.readFirst.join('、')}`);
blockers.forEach((b) => {
  lines.push(`   ⛔ ${b.text}`);
  lines.push(`      → ${b.fix}`);
});
warnings.forEach((w) => {
  lines.push(`   ⚠️ ${w.text}`);
  lines.push(`      → ${w.fix}`);
});
if (!blockers.length) lines.push(`   ✅ 可以接着写第${result.next.chapter}章`);
console.log(lines.join('\n'));

process.exit(blockers.length ? 1 : 0);
