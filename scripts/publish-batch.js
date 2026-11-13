#!/usr/bin/env node
/**
 * 批量续跑：从账本断点起，连发 N 章
 *
 * 用法:
 *   node publish-batch.js <config.json> --chapters N [选项]
 *
 * 选项:
 *   --chapters N        连发 N 章（必填，1–200）
 *   --drafts <目录>     草稿目录（默认 ./草稿，文件名 第NNN章.md / 第N章.md）
 *   --ai-gates <目录>   AI 门禁声明目录（每章 chNNN-ai-gates.json 或 第NNN章-ai-gates.json）
 *   --allow-missing-ai  允许本章没有 AI 声明（账本会记 aiOmitted，慎用）
 *   --write             真发；默认 dry-run 只打印计划
 *   --json              机器可读输出
 *
 * 每章实际执行：
 *   node publish-chapter.js <config> 草稿/第NNN章.md --apply-changes --scaffold [--ai-gates …]
 * 即「过门禁 → 补档案骨架 → 原子落盘 → 记账 → 回写快照并同步伏笔档案」一条龙。
 *
 * 为什么要有它：N 章连发时手敲 N 次命令，中间任何一次漏 --apply-changes，下一章就会被 exit 4 拦下；
 * 漏 --scaffold，新角色第一次上场就撞「未登记实体」。这里把每章的固定动作写死。
 *
 * 断点语义：任何一章被打回（门禁 exit 1 / 指纹冲突 exit 3 / 快照欠账 exit 4）立刻停在该章，
 * 后面的章节一个字节都不动；改完重跑同一条命令，从「账本最后一章 + 1」自动继续。
 *
 * 退出码: 0=请求的 N 章都发完；1=中途停（缺草稿 / 缺声明 / 被打回）；2=用法或 IO 错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
const gate = require('./lib/gate-suite');

const USAGE = `用法: node publish-batch.js <config.json> --chapters N [--drafts 目录] [--ai-gates 目录]
                              [--allow-missing-ai] [--write] [--json]

  默认 dry-run（只打印要发哪几章），--write 才真发
  每章等价于 publish-chapter … --apply-changes --scaffold（门禁 → 建档 → 落盘 → 记账 → 回写快照）`;

const FLAGS = { '--write': 'write', '--json': 'json', '--allow-missing-ai': 'allowMissingAi' };
const VALUED = { '--chapters': 'chapters', '--drafts': 'drafts', '--ai-gates': 'aiGates' };

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS[a]) {
      opts[FLAGS[a]] = true;
    } else if (VALUED[a]) {
      const v = argv[++i];
      if (v === undefined || FLAGS[v] || VALUED[v]) die(`${a} 缺少取值\n\n${USAGE}`);
      opts[VALUED[a]] = v;
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith('--')) {
      die(`未知选项 ${a}\n\n${USAGE}`);
    } else {
      opts.positional.push(a);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.positional.length !== 1) die(`需要且只需要一个 <config.json>\n\n${USAGE}`);
const configPath = opts.positional[0];
if (!fs.existsSync(configPath)) die(`配置不存在: ${configPath}`);
if (opts.chapters === undefined) die(`必须给 --chapters N\n\n${USAGE}`);
if (!/^\d+$/.test(opts.chapters)) die(`--chapters 需要正整数（收到 ${JSON.stringify(opts.chapters)}）`);
const wanted = Number(opts.chapters);
if (wanted < 1 || wanted > 200) die(`--chapters 需在 1–200 之间（收到 ${wanted}）`);

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
const ledgerDir = path.join(path.resolve(base, local.settings_path), 'changes');
const draftsDir = path.resolve(base, opts.drafts || './草稿');
const aiGatesDir = opts.aiGates ? path.resolve(base, opts.aiGates) : null;

if (!fs.existsSync(draftsDir)) die(`草稿目录不存在: ${draftsDir}`);
if (aiGatesDir && !fs.existsSync(aiGatesDir)) die(`AI 声明目录不存在: ${aiGatesDir}`);

// 断点：账本里发过的最新一章 + 1
const ledgers = gate.loadPublishLedgers(ledgerDir);
const publishedChapters = ledgers.filter((l) => !l.error && l.publishes.length).map((l) => l.chapter);
const start = publishedChapters.length ? Math.max(...publishedChapters) + 1 : 1;

// 草稿目录里按章号索引（第001章.md / 第1章.md 都认）
const drafts = new Map();
for (const f of fs.readdirSync(draftsDir)) {
  const m = f.match(/^第\s*0*(\d+)\s*章\.md$/);
  if (!m) continue;
  const ch = Number(m[1]);
  if (!drafts.has(ch)) drafts.set(ch, path.join(draftsDir, f));
}

function declFor(ch) {
  if (!aiGatesDir) return null;
  for (const name of [`ch${String(ch).padStart(3, '0')}-ai-gates.json`, `第${String(ch).padStart(3, '0')}章-ai-gates.json`, `第${ch}章-ai-gates.json`]) {
    const p = path.join(aiGatesDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const plan = [];
for (let i = 0; i < wanted; i++) {
  const ch = start + i;
  plan.push({ chapter: ch, draft: drafts.get(ch) || null, decl: declFor(ch) });
}

// 提前拒绝只会「看着跑了半本才发现没声明」的情况
if (opts.write && !aiGatesDir && !opts.allowMissingAi) {
  die('没有 --ai-gates 目录，也没给 --allow-missing-ai：批量发布会一章都发不出去（AI 侧门禁声明不能凭空造）。\n'
    + '   要么把每章的声明放进一个目录（chNNN-ai-gates.json），要么明确 --allow-missing-ai（账本记 aiOmitted）。');
}

const novel = (config.info && config.info.name) || '';
const show = (p) => {
  const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
  return rel && !rel.startsWith('..') ? rel : p;
};

if (!opts.write) {
  if (opts.json) {
    console.log(JSON.stringify({ novel, dryRun: true, start, requested: wanted, plan: plan.map((p) => ({ chapter: p.chapter, draft: p.draft ? show(p.draft) : null, decl: p.decl ? show(p.decl) : null })) }, null, 2));
    process.exit(0);
  }
  console.log(`📚 批量发布计划｜${novel || '本书'}｜从第${start}章起连发 ${wanted} 章（当前账本最后一章：${start - 1 || '无'}）`);
  for (const p of plan) {
    const draft = p.draft ? show(p.draft) : '（缺草稿）';
    const decl = p.decl ? '✓ 声明' : (opts.allowMissingAi ? '无声明（--allow-missing-ai）' : aiGatesDir ? '（缺声明）' : '无声明目录');
    console.log(`  第${String(p.chapter).padStart(3, '0')}章  ${draft}  ${decl}`);
  }
  console.log('\n（dry-run：未发布。确认无误后加 --write 落盘）');
  process.exit(0);
}

// ---- 真发 ----
const results = [];
let stopped = null;
for (const p of plan) {
  if (!p.draft) {
    stopped = { chapter: p.chapter, exit: null, reason: `第${p.chapter}章没有草稿（${show(draftsDir)}/第${String(p.chapter).padStart(3, '0')}章.md）` };
    break;
  }
  if (aiGatesDir && !p.decl) {
    stopped = { chapter: p.chapter, exit: null, reason: `第${p.chapter}章缺 AI 声明（${show(aiGatesDir)}/ch${String(p.chapter).padStart(3, '0')}-ai-gates.json）` };
    break;
  }
  const args = [path.join(__dirname, 'publish-chapter.js'), configPath, p.draft, '--apply-changes', '--scaffold'];
  if (p.decl) args.push('--ai-gates', p.decl);
  else args.push('--allow-missing-ai');
  if (!opts.json) console.log(`\n===== 第${p.chapter}章 =====`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf-8' });
  if (!opts.json) {
    if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : r.stderr + '\n');
  }
  const ok = r.status === 0;
  results.push({ chapter: p.chapter, exit: r.status, ok });
  if (!ok) {
    stopped = { chapter: p.chapter, exit: r.status, reason: '发布被打回（见上方 ❌）' };
    break;
  }
}

const published = results.filter((r) => r.ok).map((r) => r.chapter);
const ok = !stopped && published.length === wanted;

if (opts.json) {
  console.log(JSON.stringify({ novel, dryRun: false, start, requested: wanted, published, stopped, results }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (published.length) console.log(`\n📬 已发布 ${published.length} 章：第${published.join('、')}章`);
if (stopped) {
  console.error(`\n⛔ 停在第${stopped.chapter}章：${stopped.reason}`);
  console.error('   后面的章节一个字节都没动；改完重跑同一条命令，从该章自动继续。');
  process.exit(1);
}
console.log(`✅ 批量发布完成（${wanted} 章）`);
