#!/usr/bin/env node
/**
 * 章节发布闸门（草稿 → 12 门禁 → 原子落盘 → 指纹账本）
 *
 * 用法:
 *   node publish-chapter.js <config.json> <草稿.md> [选项]
 *
 * 选项:
 *   --chapter <N>          章号（默认从草稿文件名「第N章」解析）
 *   --outline <细纲.md>     细纲（给了才做蓝图出场合规）
 *   --ai-gates <声明.json>  AI 侧门禁声明（Gate 2–6 语义结论 + 证据，见 SKILL「AI 侧门禁声明」）
 *   --allow-missing-ai     缺 AI 声明时不阻断（报告与账本记 aiOmitted=true）
 *   --revise               允许覆盖已存在的本章正文（内容指纹不同时默认拒绝）
 *   --no-gate              跳过门禁（账本记 forced=true，报告 12 项全 skip——用于已人工定稿的补救发布）
 *   --dry-run              只跑门禁与报告，不写正文、不写账本
 *   --json                 把结果打到 stdout（给脚本/agent 读）
 *
 * 为什么要有闸门（此前的问题）：
 *   旧流程是「AI 写完正文 → 直接落盘 正文/第N章.md → 再补一份门禁报告」，顺序反了——
 *   正文先成为事实，报告只是追认；报告漏项/漏跑也没人拦。本脚本把顺序掰回：
 *   **门禁通过才落盘**，且落盘时把正文指纹写进账本，事后能证明「这章发布时代码/门禁是什么版本、过没过」。
 *
 * 三条不可退让的规则：
 *   1. 门禁阻断 → 正文目录一个字节都不动（草稿留在原处，改完重跑）。
 *   2. 同一章重复发布、正文指纹一致 → 幂等 no-op（可安全重试，账本不重复记账）。
 *   3. 同一章正文已存在、指纹不同 → 默认拒绝（exit 3），必须显式 --revise 才覆盖，
 *      覆盖前旧指纹进账本 history（定稿正文不能被一次误跑静默改写）。
 *
 * 退出码: 0=已发布/幂等跳过, 1=门禁阻断, 2=用法或 IO 错误, 3=正文已存在且指纹不同（需 --revise）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');

const FLAGS = new Set(['--allow-missing-ai', '--revise', '--no-gate', '--dry-run', '--json']);
const VALUED = new Set(['--chapter', '--outline', '--ai-gates']);

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function show(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
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

/** 在正文目录里按「章号」找已存在的章节文件（不靠文件名补零位数猜） */
function findChapterFile(contentDir, n) {
  if (!fs.existsSync(contentDir)) return null;
  for (const name of fs.readdirSync(contentDir)) {
    const m = name.match(/^第\s*0*(\d+)\s*章\.md$/);
    if (m && Number(m[1]) === n) return path.join(contentDir, name);
  }
  return null;
}

const opts = parseArgs(process.argv.slice(2));
const [configPath, draftPath] = opts.positional;
if (!configPath || !draftPath) {
  die('用法: node publish-chapter.js <config.json> <草稿.md> [--chapter N] [--ai-gates 声明.json] [--revise] [--dry-run]');
}
if (!fs.existsSync(configPath)) die(`配置不存在: ${configPath}`);
if (!fs.existsSync(draftPath)) die(`草稿不存在: ${draftPath}`);

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
const snapshotPath = path.join(settingsDir, '状态快照.md');

const draftText = fs.readFileSync(draftPath, 'utf-8');
const chapterFromName = (path.basename(draftPath).match(/第\s*(\d+)\s*章/) || [])[1];
const chapter = opts.chapter ? Number(opts.chapter) : (chapterFromName ? Number(chapterFromName) : NaN);
if (!Number.isInteger(chapter) || chapter <= 0) {
  die('章号无法确定：草稿文件名不含「第N章」时请用 --chapter <N> 指定');
}

const curFp = gate.contentFingerprint(draftText);
const existing = findChapterFile(contentDir, chapter);
const targetPath = existing || path.join(contentDir, `第${String(chapter).padStart(3, '0')}章.md`);
const ledgerDir = path.join(settingsDir, 'changes');
const reportPath = path.join(ledgerDir, `ch${String(chapter).padStart(3, '0')}-gate-report.json`);
const ledgerPath = path.join(ledgerDir, `ch${String(chapter).padStart(3, '0')}-publish.json`);

// ---- 1. 门禁 ----
let report;
if (opts.noGate) {
  const gates = gate.GATES.map((g) => ({
    key: g.key, label: g.label, source: 'rule', verdict: 'skip', items: [],
    reason: '跳过门禁（--no-gate）：本章按人工定稿处理，账本记 forced=true',
  }));
  report = gate.buildReport({
    novel: (config.info && config.info.name) || '',
    chapter,
    draftText,
    gates,
    checks: [],
    blockReasons: [],
    extra: { gatesSkipped: true },
  });
} else {
  let ruleResult;
  try {
    ruleResult = gate.runRules({
      draftPath,
      configPath,
      snapshotPath,
      settingsDir,
      outlinePath: opts.outline,
    });
  } catch (e) {
    die(`门禁执行失败：${e.message}`);
  }
  let aiDecl = null;
  if (opts.aiGates) {
    try {
      aiDecl = gate.readJsonIfExists(opts.aiGates);
    } catch (e) {
      die(e.message);
    }
    if (!aiDecl) die(`AI 门禁声明不存在或为空: ${opts.aiGates}`);
  }
  const merged = gate.mergeAiDeclarations(ruleResult.gates, aiDecl, {
    contentFp: curFp,
    allowMissingAi: !!opts.allowMissingAi,
  });
  report = gate.buildReport({
    novel: (config.info && config.info.name) || '',
    chapter,
    draftText,
    gates: ruleResult.gates,
    checks: ruleResult.checks,
    blockReasons: merged.blockReasons,
    extra: merged.aiOmitted ? { aiOmitted: true } : null,
  });
}

// 报告自检：生成器有 bug 就不许往下走（宁可不发布，也不发布一份假报告）
const selfCheck = gate.verifyReport(report, { draftText });
if (!selfCheck.ok) {
  console.error('❌ 报告自检失败：');
  selfCheck.problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(2);
}

const out = {
  chapter,
  target: show(targetPath),
  contentFingerprint: curFp,
  summary: report.summary,
  blocked: report.blocked,
  blockReasons: report.blockReasons,
  reportPath: show(reportPath),
  ledgerPath: show(ledgerPath),
  published: false,
  noop: false,
  dryRun: !!opts.dryRun,
};

function printResult(lines) {
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    lines.forEach((l) => console.log(l));
  }
}

// ---- 2. 阻断：一个字都不落 ----
if (report.blocked && !opts.dryRun) {
  gate.writeJsonAtomic(reportPath, report);
  out.reportPath = show(reportPath);
}
if (report.blocked) {
  if (!opts.json) {
    console.error(`❌ 门禁阻断，未发布（${report.blockReasons.length} 条）——正文目录未改动：`);
    report.blockReasons.forEach((r) => console.error(`  - ${r}`));
    if (!opts.dryRun) console.error(`   报告已落盘：${show(reportPath)}（改稿后重跑）`);
  }
  printResult([]);
  process.exit(1);
}

// ---- 3. 幂等：同指纹且正文已在 → no-op ----
let ledger = null;
try {
  ledger = gate.readJsonIfExists(ledgerPath);
} catch (e) {
  die(e.message);
}
const publishes = (ledger && Array.isArray(ledger.publishes)) ? ledger.publishes : [];
const last = publishes.length ? publishes[publishes.length - 1] : null;
const publishedFileExists = !!existing && fs.existsSync(existing);
// 旧稿指纹必须在覆盖**之前**读出来（写后再读会拿到新内容，账本的 revisedFrom 就成假记录）
const existingFp = publishedFileExists ? gate.contentFingerprint(fs.readFileSync(existing, 'utf-8')) : null;
if (last && publishedFileExists && last.contentFingerprint === curFp && path.basename(targetPath) === last.fileName) {
  out.noop = true;
  out.publishCount = publishes.length;
  if (!opts.dryRun) gate.writeJsonAtomic(reportPath, report);
  printResult([
    `⏭️ 幂等跳过：第${chapter}章正文指纹未变（${curFp}），已发布过 ${publishes.length} 次，本次不重复落盘`,
    `   目标: ${show(targetPath)}`,
  ]);
  process.exit(0);
}

// ---- 4. 定稿保护：已存在且指纹不同 → 需 --revise ----
if (publishedFileExists && !opts.revise) {
  const oldFp = existingFp;
  if (oldFp !== curFp) {
    out.reason = 'existing-differs';
    out.existingFingerprint = oldFp;
    if (!opts.json) {
      console.error('❌ 本章正文已存在且内容指纹不同——默认不覆盖（定稿正文不能被误跑改写）：');
      console.error(`   已有: ${show(existing)}  ${oldFp}`);
      console.error(`   草稿: ${show(draftPath)}  ${curFp}`);
      console.error('   确认这是改稿，请加 --revise（旧指纹会进账本 history）');
    }
    printResult([]);
    process.exit(3);
  }
}

// ---- 5. dry-run：到此为止 ----
if (opts.dryRun) {
  out.published = false;
  printResult([
    `🔎 dry-run：门禁不阻断，未落盘（将写入 ${show(targetPath)}）`,
    `   正文指纹 ${curFp}｜pass ${report.summary.pass} / warn ${report.summary.warn} / fail 0 / skip ${report.summary.skip}`,
  ]);
  process.exit(0);
}

// ---- 6. 落盘：正文 → 报告 → 账本（全部原子写）----
const normalized = gate.normalizeNewlines(draftText);
const finalText = normalized.endsWith('\n') ? normalized : normalized + '\n';
gate.writeFileAtomic(targetPath, finalText);
gate.writeJsonAtomic(reportPath, report);

const record = {
  publishedAt: new Date().toISOString(),
  contentFingerprint: curFp,
  draftFingerprint: report.draftFingerprint,
  fileName: path.basename(targetPath),
  reportPath: path.relative(path.dirname(ledgerPath), reportPath).split(path.sep).join('/'),
  reportIntegrity: report.integrity,
  ruleVersion: report.ruleVersion,
  summary: report.summary,
  forced: !!opts.noGate,
  aiOmitted: !!report.aiOmitted,
  revised: !!opts.revise && !!publishedFileExists,
  revisedFrom: opts.revise && publishedFileExists ? existingFp : null,
};
publishes.push(record);
gate.writeJsonAtomic(ledgerPath, {
  schemaVersion: gate.SCHEMA_VERSION,
  chapter,
  novel: (config.info && config.info.name) || '',
  fileName: path.basename(targetPath),
  publishes,
});

out.published = true;
out.publishCount = publishes.length;
if (opts.json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const flags = [record.forced ? 'forced' : '', record.revised ? 'revise' : '', record.aiOmitted ? 'aiOmitted' : '']
    .filter(Boolean).join(' ');
  console.log(`✅ 已发布 第${chapter}章 → ${show(targetPath)}${flags ? ` [${flags}]` : ''}`);
  console.log(`   正文指纹 ${curFp}`);
  console.log(`   门禁 pass ${report.summary.pass} / warn ${report.summary.warn} / fail 0 / skip ${report.summary.skip}｜规则版本 ${report.ruleVersion}`);
  console.log(`   报告 ${show(reportPath)}`);
  console.log(`   账本 ${show(ledgerPath)}（本章第 ${publishes.length} 次发布）`);
}
process.exit(0);
