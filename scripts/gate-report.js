#!/usr/bin/env node
/**
 * 结构化门禁报告生成器（把 12 门禁落成机器可校验的产物）
 *
 * 用法:
 *   node gate-report.js <草稿.md> [选项]
 *
 * 选项:
 *   --config <cfg.json>        配置文件（给了才做 writing.chapter_words 字数门禁）
 *   --settings <设定目录>       设定目录（默认取 config.local.settings_path）
 *   --snapshot <快照.md>        状态快照（默认 <设定目录>/状态快照.md）
 *   --outline <细纲.md>         细纲（给了才做蓝图出场合规）
 *   --ai-gates <声明.json>      AI 侧门禁声明（Gate 2–6 语义结论 + 证据，证据须引正文原文）
 *   --emit-ai-template <file>  只生成声明骨架（本稿指纹 + 5 个待填槽），不跑门禁，填完再回来跑
 *   --allow-missing-ai         缺 AI 声明时不阻断（报告与账本会记 aiOmitted=true）
 *   --chapter <N>              章号（默认从草稿文件名「第N章」解析）
 *   --out <报告.json>           报告落盘路径（默认不落盘，仅打印结论）
 *   --json                     把完整报告打到 stdout（给脚本/agent 读）
 *
 * 与 verify-gate-report.js 的分工：
 *   verify-gate-report 校验的是**文本报告**（AI 写的 Markdown 有没有 12 项齐全）；
 *   本脚本产出的是**数据报告**（带正文指纹 + 规则版本 + integrity 的报告，供 publish-chapter 消费）。
 *   两者不互相替代：文本报告给人看，数据报告给闸门用。
 *
 * 退出码: 0=不阻断, 1=被门禁阻断, 2=用法/文件错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');

const FLAGS = new Set(['--allow-missing-ai', '--json']);
const VALUED = new Set(['--config', '--settings', '--snapshot', '--outline', '--ai-gates', '--chapter', '--out', '--emit-ai-template']);

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

/** 报告附加字段——必须在算 integrity 之前并入（事后赋值会让报告过不了自己的自检） */
function buildExtra(merged, snapshotNote) {
  const extra = {};
  if (merged && merged.aiOmitted) extra.aiOmitted = true;
  if (snapshotNote) extra.snapshotFreshness = snapshotNote;
  return Object.keys(extra).length ? extra : null;
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

const opts = parseArgs(process.argv.slice(2));
const draftPath = opts.positional[0];
if (!draftPath) die('用法: node gate-report.js <草稿.md> [--config cfg.json] [--ai-gates 声明.json] [--out 报告.json] [--json]');
if (!fs.existsSync(draftPath)) die(`草稿不存在: ${draftPath}`);

const draftText = fs.readFileSync(draftPath, 'utf-8');

// ---- 配置推导出的默认路径 ----
let config = null;
let settingsDir = opts.settings || '';
let snapshotPath = opts.snapshot || '';
if (opts.config) {
  config = gate.readJsonIfExists(opts.config);
  if (!config) die(`配置不存在或为空: ${opts.config}`);
  const base = path.dirname(path.resolve(opts.config));
  const local = config.local || {};
  if (!settingsDir && local.settings_path) settingsDir = path.resolve(base, local.settings_path);
}
if (settingsDir && !opts.settings && !snapshotPath) snapshotPath = path.join(settingsDir, '状态快照.md');
if (!snapshotPath && settingsDir) snapshotPath = path.join(settingsDir, '状态快照.md');

const chapterFromName = (path.basename(draftPath).match(/第\s*(\d+)\s*章/) || [])[1];
const chapter = opts.chapter ? Number(opts.chapter) : (chapterFromName ? Number(chapterFromName) : null);
if (opts.chapter && !Number.isInteger(chapter)) die(`--chapter 不是整数: ${opts.chapter}`);

// ---- 声明脚手架（不跑门禁，纯生成待填骨架）----
if (opts.emitAiTemplate) {
  const tpl = gate.aiDeclarationTemplate({
    chapter: Number.isInteger(chapter) ? chapter : null,
    draftText,
  });
  gate.writeJsonAtomic(opts.emitAiTemplate, tpl);
  console.log(`🧩 已生成 AI 侧声明骨架: ${opts.emitAiTemplate}`);
  console.log(`   本稿指纹 ${tpl.contentFingerprint}（改稿后要重新生成，旧骨架会因指纹不符被拦）`);
  console.log(`   待填 ${Object.keys(tpl.gates).length} 项: ${Object.keys(tpl.gates).join(', ')}`);
  console.log('   规则: pass/warn/fail 的 evidence 必须用「」原样引一段 ≥8 字正文；skip 只写不适用的理由。');
  process.exit(0);
}

// ---- 规则侧 ----
let ruleResult;
try {
  ruleResult = gate.runRules({
    draftPath,
    configPath: opts.config,
    snapshotPath: snapshotPath || undefined,
    settingsDir: settingsDir || undefined,
    outlinePath: opts.outline,
  });
} catch (e) {
  die(`门禁执行失败：${e.message}`);
}

// ---- AI 侧声明 ----
let aiDecl = null;
if (opts.aiGates) {
  try {
    aiDecl = gate.readJsonIfExists(opts.aiGates);
  } catch (e) {
    die(e.message);
  }
  if (!aiDecl) die(`AI 门禁声明不存在或为空: ${opts.aiGates}`);
}

const contentFp = gate.contentFingerprint(draftText);
const merged = gate.mergeAiDeclarations(ruleResult.gates, aiDecl, {
  contentFp,
  bodyText: draftText,
  allowMissingAi: !!opts.allowMissingAi,
});

// ---- 快照回写检查（这里只报告；真正的阻断在 publish-chapter 的 exit 4）----
let snapshotNote = null;
if (settingsDir && Number.isInteger(chapter)) {
  const snapPath = snapshotPath || path.join(settingsDir, '状态快照.md');
  let snapFp = null;
  try {
    if (fs.existsSync(snapPath)) snapFp = gate.fileFingerprint(fs.readFileSync(snapPath, 'utf-8'));
  } catch (e) {
    die(`读状态快照失败：${e.message}`);
  }
  const ledgers = gate.loadPublishLedgers(path.join(settingsDir, 'changes'));
  const prev = gate.previousPublish(ledgers, chapter);
  const fresh = gate.snapshotFreshness({
    currentFp: snapFp,
    previousChapter: prev ? prev.chapter : null,
    previousFp: prev ? prev.record.snapshotFingerprint : null,
  });
  snapshotNote = { verdict: fresh.verdict, reason: fresh.reason, previousChapter: prev ? prev.chapter : null };
}

const report = gate.buildReport({
  novel: (config && config.info && config.info.name) || '',
  chapter: Number.isInteger(chapter) ? chapter : null,
  draftText,
  gates: ruleResult.gates,
  checks: ruleResult.checks,
  blockReasons: merged.blockReasons,
  extra: buildExtra(merged, snapshotNote),
});

const selfCheck = gate.verifyReport(report, { draftText });
if (!selfCheck.ok) {
  console.error('❌ 报告自检失败（生成器有 bug 或输入异常）：');
  selfCheck.problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(2);
}

if (opts.out) {
  gate.writeJsonAtomic(opts.out, report);
}

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`🛡️ 门禁结果（第${report.chapter === null ? '?' : report.chapter}章）｜规则版本 ${gate.RULE_VERSION}`);
  console.log(`   正文指纹: ${report.contentFingerprint}`);
  console.log(`   汇总: pass ${report.summary.pass} / warn ${report.summary.warn} / fail ${report.summary.fail} / skip ${report.summary.skip}`);
  const icon = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
  for (const g of report.gates) {
    const extra = g.items.length ? `（${g.items.length} 条）` : (g.reason ? `（${g.reason}）` : '');
    console.log(`   ${icon[g.verdict]} ${g.label} [${g.source}] ${g.verdict}${extra}`);
    for (const it of g.items.filter((i) => i.level === 'fail').slice(0, 3)) console.log(`        · ${it.text.slice(0, 160)}`);
  }
  for (const c of report.checks) {
    if (c.verdict === 'pass' || c.verdict === 'skip') continue;
    console.log(`   ${icon[c.verdict]} 检查项 ${c.label} ${c.verdict}`);
    for (const it of c.items.slice(0, 3)) console.log(`        · ${it.text.slice(0, 160)}`);
  }
  if (snapshotNote && snapshotNote.verdict !== 'pass') {
    const mark = snapshotNote.verdict === 'fail' ? '❌' : '⏭️';
    console.log(`   ${mark} 状态快照回写 ${snapshotNote.verdict}：${snapshotNote.reason}`);
  }
  if (report.blocked) {
    console.error(`\n❌ 门禁阻断（${report.blockReasons.length} 条）——本稿不可发布：`);
    report.blockReasons.forEach((r) => console.error(`  - ${r}`));
  } else {
    console.log('\n✅ 门禁不阻断（规则侧 + AI 侧结论齐全）——注意：只保证「逐项有结论」，不保证判断本身正确');
  }
}

process.exit(report.blocked ? 1 : 0);
