#!/usr/bin/env node
/**
 * 收尾清理（默认只预演，不删）
 *
 * 用法:
 *   node housekeeping.js <config.json> [--write] [--keep-drafts N] [--keep-backups N] [--json]
 *
 * 清什么（都能机械判定，不猜）:
 *   1. 草稿验收报告 设定/changes/chNNN-gate-report-draft-<指纹前8位>.json —— 每章只留最新 N 份（默认 3）
 *   2. 本地备份目录 <backup.local_path>/<时间戳>-chNNN/ —— 只留最新 N 个（默认 20）
 *   3. 原子写残留 设定/changes 与 正文 下的 *.tmp / *.partial —— 一律清（写入中断的废文件）
 *
 * 不删什么（只点名，交给人判断）:
 *   - 发布当时的验收记录 chNNN-gate-report.json（账本指着它，删了 publish-status 立刻报「报告缺失」）
 *   - 账本里没有对应章节的孤儿报告 —— 打印 ⚠️，让你先跑 publish-status 看清楚
 *   - 草稿目录里的 .md（那是正在写的稿子，不是垃圾）
 *
 * 为什么要有它：v3.5.29 起被门禁拦下的改稿另存草稿报告（不再覆盖已发布的验收记录），每被拦一次多一份；
 * 备份目录按章累积；两者都没人收。几个月后 设定/changes 里躺着几百个文件，真正要看的
 * chNNN-gate-report.json 反而混在里面找不着。
 *
 * 退出码: 0=已清理/无可清理, 1=有删除失败, 2=用法或 IO 错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');

const FLAGS = new Set(['--write', '--json']);
const VALUED = new Set(['--keep-drafts', '--keep-backups']);
const USAGE = '用法: node housekeeping.js <config.json> [--write] [--keep-drafts N] [--keep-backups N] [--json]';

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.has(a)) {
      opts[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else if (VALUED.has(a)) {
      const v = argv[++i];
      if (v === undefined || VALUED.has(v) || FLAGS.has(v)) die(`${a} 缺少取值`);
      opts[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    } else if (a.startsWith('--')) {
      die(`未知选项 ${a}`);
    } else {
      opts.positional.push(a);
    }
  }
  return opts;
}

function intOrDie(raw, flag, fallback) {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(String(raw))) die(`${flag} 需要非负整数，收到「${raw}」`);
  return Number(raw);
}

const opts = parseArgs(process.argv.slice(2));
const configPath = opts.positional[0];
if (!configPath) die(USAGE);
if (fs.existsSync(configPath) === false) die(`配置不存在: ${configPath}`);

let config;
try {
  config = gate.readJsonIfExists(configPath);
} catch (e) {
  die(e.message);
}
if (!config) die(`配置为空: ${configPath}`);

const keepDrafts = intOrDie(opts.keepDrafts, '--keep-drafts', 3);
const keepBackups = intOrDie(opts.keepBackups, '--keep-backups', 20);

const base = path.dirname(path.resolve(configPath));
const local = config.local || {};
if (!local.content_path) die('配置缺 local.content_path（正文目录）');
if (!local.settings_path) die('配置缺 local.settings_path（设定目录）');
const contentDir = path.resolve(base, local.content_path);
const settingsDir = path.resolve(base, local.settings_path);
const ledgerDir = path.join(settingsDir, 'changes');
const backupDir = config.backup && config.backup.local_path ? path.resolve(base, config.backup.local_path) : null;

const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

function bytesOf(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (st.isFile()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) total += bytesOf(path.join(p, e.name));
  return total;
}

function mtimeOf(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** 新→旧；时间戳相同的（测试里常见）按名字倒序，保证每次挑的是同一批 */
const newestFirst = (a, b) => (mtimeOf(b) - mtimeOf(a)) || b.localeCompare(a);

const plan = []; // { kind, path, bytes, note }
const keep = [];
const warns = [];

// ---- 1. 草稿验收报告：每章保留最新 N 份 ----
const DRAFT_RE = /^ch(\d{3,})-gate-report-draft-[0-9a-f]{8}\.json$/;
const PUBLISHED_RE = /^ch(\d{3,})-gate-report\.json$/;
const draftByChapter = new Map();
const publishedReports = new Map();

if (fs.existsSync(ledgerDir)) {
  for (const name of fs.readdirSync(ledgerDir)) {
    const full = path.join(ledgerDir, name);
    const d = name.match(DRAFT_RE);
    if (d) {
      const ch = Number(d[1]);
      if (!draftByChapter.has(ch)) draftByChapter.set(ch, []);
      draftByChapter.get(ch).push(full);
      continue;
    }
    const p = name.match(PUBLISHED_RE);
    if (p) publishedReports.set(Number(p[1]), full);
  }
}

for (const ch of [...draftByChapter.keys()].sort((a, b) => a - b)) {
  const files = draftByChapter.get(ch).sort(newestFirst);
  files.slice(0, keepDrafts).forEach((f) => keep.push(`第${ch}章草稿报告（保留最新 ${keepDrafts} 份）`));
  for (const f of files.slice(keepDrafts)) {
    plan.push({ kind: 'draft-report', path: f, bytes: bytesOf(f), note: `第${ch}章草稿验收报告（同章留 ${keepDrafts} 份）` });
  }
}

// ---- 2. 原子写残留 ----
const TMP_RE = /\.(tmp|partial)$/i;
for (const dir of [ledgerDir, contentDir]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!TMP_RE.test(name)) continue;
    const full = path.join(dir, name);
    plan.push({ kind: 'tmp', path: full, bytes: bytesOf(full), note: '写入中断留下的临时文件' });
  }
}

// ---- 3. 本地备份目录：只留最新 N 个 ----
const BACKUP_RE = /^\d{4}-\d{2}-\d{2}_[\d-]+-ch\d{3,}$/;
if (backupDir && fs.existsSync(backupDir)) {
  const dirs = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && BACKUP_RE.test(e.name))
    .map((e) => path.join(backupDir, e.name))
    .sort(newestFirst);
  dirs.slice(0, keepBackups).forEach((d) => keep.push(`备份 ${path.basename(d)}（保留最新 ${keepBackups} 个）`));
  for (const d of dirs.slice(keepBackups)) {
    plan.push({ kind: 'backup', path: d, bytes: bytesOf(d), note: `本地备份（同库留 ${keepBackups} 个）` });
  }
}

// ---- 4. 只点名不删的：孤儿报告 / 孤儿账本 ----
let ledgers = [];
try {
  ledgers = gate.loadPublishLedgers(ledgerDir);
} catch (e) {
  warns.push(`账本目录读不出来：${e.message}`);
}
const ledgerChapters = new Set(ledgers.filter((l) => !l.error && l.publishes.length).map((l) => l.chapter));
for (const [ch, file] of [...publishedReports.entries()].sort((a, b) => a[0] - b[0])) {
  if (!ledgerChapters.has(ch)) {
    warns.push(`孤儿报告 ${path.basename(file)}（账本里没有第${ch}章的发布记录）—— 先跑 publish-status 看清楚，别急着删`);
  }
}
for (const l of ledgers) {
  if (l.error) warns.push(`账本损坏 ${path.basename(l.file)}：${l.error}`);
}

// ---- 输出 / 执行 ----
const totalBytes = plan.reduce((s, x) => s + x.bytes, 0);
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const failures = [];
if (opts.write) {
  for (const item of plan) {
    try {
      fs.rmSync(item.path, { recursive: true, force: true });
    } catch (e) {
      failures.push(`${rel(item.path)}：${e.message}`);
    }
  }
}

if (opts.json) {
  console.log(JSON.stringify({
    dryRun: !opts.write,
    keepDrafts,
    keepBackups,
    planned: plan.map((x) => ({ kind: x.kind, path: rel(x.path), bytes: x.bytes, note: x.note })),
    deleted: opts.write ? plan.filter((x) => !failures.some((f) => f.startsWith(rel(x.path)))).map((x) => rel(x.path)) : [],
    failures,
    warns,
    totals: { items: plan.length, bytes: totalBytes },
  }, null, 2));
} else {
  console.log(`🧹 收尾清理（${opts.write ? '真删' : 'dry-run 预演，加 --write 才删'}）`);
  console.log(`   保留口径：草稿报告每章 ${keepDrafts} 份 / 本地备份 ${keepBackups} 个 / 临时残留一律清`);
  if (!plan.length) {
    console.log(`✅ 无需清理${keep.length ? `（${keep.length} 项在保留数内）` : ''}`);
  } else {
    for (const x of plan) console.log(`   ${opts.write ? '🗑 ' : '✂️ '}${rel(x.path)}  ${kb(x.bytes)}  ${x.note}`);
    console.log(`   合计 ${plan.length} 项 / ${kb(totalBytes)}${opts.write ? '' : '（预演，未动任何文件）'}`);
    if (opts.write) {
      console.log(failures.length
        ? `⚠️ 删了 ${plan.length - failures.length} 项，${failures.length} 项失败：\n     - ${failures.join('\n     - ')}`
        : `✅ 已删除 ${plan.length} 项，回收 ${kb(totalBytes)}`);
    } else if (plan.some((x) => x.kind === 'backup')) {
      console.log('   注意：备份目录删了就真没了，先确认最新几个能回滚再 --write');
    }
  }
  for (const w of warns) console.error(`⚠️ ${w}`);
}

process.exit(failures.length ? 1 : 0);
