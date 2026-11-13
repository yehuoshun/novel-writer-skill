#!/usr/bin/env node
/**
 * 章节热度标注（人工打分，给全书体检做对照）
 *
 * 平台给的数据只有作者自己看得到：哪章追读掉了、哪章评论区炸了。
 * 这个脚本把「作者手工记的一列数」落成结构化表格，让 book-report 能把它和
 * 字数、爽点类型、钩子强度摆在一起看——脚本不猜热度，只负责存和读。
 *
 * 用法:
 *   node chapter-heat.js <config.json> list [--json]
 *   node chapter-heat.js <config.json> set <章号> --heat <数> [--retain <0-1>] [--note <文字>] [--write]
 *
 * 数据落在 设定/章节热度.md：
 *   | 章节 | 平台热度 | 留存 | 备注 |
 *   |---|---|---|---|
 *   | 12 | 8600 | 0.71 | 打脸章，评论区炸了 |
 *
 * set 默认 dry-run（只打印改完会是什么样），--write 才落盘；同章再 set 一次是覆盖那一行。
 * 退出码: 0=成功, 1=参数/数据不合法（不落盘）, 2=用法或 IO 错误
 */
'use strict';

const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');

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
const WRITE = argv.includes('--write');
const known = new Set(['--json', '--write']);
const valued = { '--heat': 'heat', '--retain': 'retain', '--note': 'note' };

const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (valued[a]) {
    if (i + 1 >= argv.length) die(`${a} 后面要跟一个值`);
    opts[valued[a]] = argv[++i];
  } else if (a.startsWith('--')) {
    if (!known.has(a)) die(`未知选项 ${a}（认 --heat / --retain / --note / --write / --json）`);
  } else {
    positional.push(a);
  }
}

const [configPath, sub, chapterArg] = positional;
if (!configPath) die('用法: node chapter-heat.js <config.json> list|set ...');
if (!fs.existsSync(configPath)) die(`配置不存在: ${configPath}`);

let config;
try {
  config = gate.readJsonIfExists(configPath);
} catch (e) {
  die(e.message);
}
if (!config) die(`配置为空: ${configPath}`);
const local = config.local || {};
if (!local.settings_path) die('配置缺 local.settings_path（设定目录）');

const base = path.dirname(path.resolve(configPath));
function resolveDir(p) {
  if (path.isAbsolute(p)) return p;
  const byConfig = path.resolve(base, p);
  if (fs.existsSync(byConfig)) return byConfig;
  return path.resolve(p);
}

const settingsDir = resolveDir(local.settings_path);
const heatPath = path.join(settingsDir, '章节热度.md');

const HEADER = ['章节', '平台热度', '留存', '备注'];

/** 把 章节热度.md 读成 [{chapter, heat, retain, note}]；没有文件就是空表 */
function readRows() {
  if (!fs.existsSync(heatPath)) return [];
  const text = fs.readFileSync(heatPath, 'utf-8');
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells[0] === '章节' || /^:?-{2,}/.test(cells[0])) continue;
    const chapter = Number(cells[0]);
    if (!Number.isInteger(chapter) || chapter <= 0) continue;
    rows.push({
      chapter,
      heat: cells[1] === '' || cells[1] === '—' ? null : Number(cells[1]),
      retain: cells[2] === '' || cells[2] === '—' ? null : Number(cells[2]),
      note: cells[3] === '—' ? '' : cells[3],
    });
  }
  return rows.sort((a, b) => a.chapter - b.chapter);
}

function renderTable(rows) {
  const lines = ['# 章节热度', '', '> 人工标注：平台热度与留存只看作者后台，脚本只负责存和读。`node scripts/chapter-heat.js <config> set <章> --heat N --write` 维护。', '', `| ${HEADER.join(' | ')} |`, '|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| ${r.chapter} | ${r.heat === null ? '—' : r.heat} | ${r.retain === null ? '—' : r.retain} | ${r.note || '—'} |`);
  }
  return lines.join('\n') + '\n';
}

function fmt(r) {
  return `第${r.chapter}章 热 ${r.heat === null ? '—' : r.heat} / 留存 ${r.retain === null ? '—' : r.retain}${r.note ? `  ${r.note}` : ''}`;
}

if (sub === 'list') {
  const rows = readRows();
  if (JSON_OUT) {
    console.log(JSON.stringify({ file: heatPath, chapters: rows.length, rows }, null, 2));
    process.exit(0);
  }
  if (!rows.length) {
    console.log('📊 章节热度：还没有标注（node scripts/chapter-heat.js <config> set 1 --heat 1200 --write）');
    process.exit(0);
  }
  console.log(`📊 章节热度（${rows.length} 章，${show(heatPath)}）`);
  for (const r of rows) console.log(`   ${fmt(r)}`);
  process.exit(0);
}

if (sub !== 'set') die(`未知子命令 ${sub || '（空）'}（只认 list / set）`);

const chapter = Number(chapterArg);
if (!Number.isInteger(chapter) || chapter <= 0) die(`章号不合法: ${chapterArg}`);

if (opts.heat === undefined) die('set 缺 --heat（这章的平台热度，比如 8600）');
const heat = Number(opts.heat);
if (!Number.isFinite(heat) || heat < 0) die(`--heat 要是非负数: ${opts.heat}`);

let retain = null;
if (opts.retain !== undefined) {
  retain = Number(String(opts.retain).replace(/%$/, ''));
  if (String(opts.retain).endsWith('%')) retain /= 100;
  if (!Number.isFinite(retain) || retain < 0 || retain > 1) die(`--retain 要 0–1 之间（或写成 62%）: ${opts.retain}`);
}

const rows = readRows();
const existing = rows.find((r) => r.chapter === chapter);
const row = { chapter, heat, retain: retain === null ? (existing ? existing.retain : null) : retain, note: opts.note !== undefined ? opts.note : (existing ? existing.note : '') };
if (existing) Object.assign(existing, row);
else rows.push(row);
rows.sort((a, b) => a.chapter - b.chapter);

const next = renderTable(rows);
if (JSON_OUT) {
  console.log(JSON.stringify({ file: heatPath, dryRun: !WRITE, row, chapters: rows.length }, null, 2));
} else {
  console.log(`${WRITE ? '✅ 已写入' : '📝 将写入'} ${show(heatPath)}：${fmt(row)}${WRITE ? '' : '（dry-run，加 --write 才落盘）'}`);
}
if (WRITE) {
  fs.mkdirSync(settingsDir, { recursive: true });
  gate.writeFileAtomic(heatPath, next);
}
process.exit(0);
