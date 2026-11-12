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
 *   --allow-stale-snapshot 承认「上一章发布后状态快照没回写」，照常发布（账本记 staleSnapshot=true）
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
 *   4. 上一章发布后 状态快照.md 没被改动 → 默认拒绝（exit 4）：CHANGES 欠账会让一致性
 *      6 门禁拿旧事实比对且「全过」，所以回写没落地就不许继续往下发。
 *
 * 退出码: 0=已发布/幂等跳过, 1=门禁阻断, 2=用法或 IO 错误, 3=正文已存在且指纹不同（需 --revise）,
 *         4=上一章的状态变化没回写快照（需回写或 --allow-stale-snapshot）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');
const { spawnSync } = require('node:child_process');

const FLAGS = new Set(['--allow-missing-ai', '--allow-stale-snapshot', '--revise', '--no-gate', '--dry-run', '--json', '--apply-changes', '--scaffold']);
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

// ---- 0. 快照回写检查：上一章发布后 状态快照.md 有没有真的被改动 ----
// 一致性 6 门禁全靠快照比对，快照陈旧时它们会「全过」——这是闸门里唯一还静默失效的地方。
let snapshotFp = null;
try {
  if (fs.existsSync(snapshotPath)) snapshotFp = gate.fileFingerprint(fs.readFileSync(snapshotPath, 'utf-8'));
} catch (e) {
  die(`读状态快照失败：${e.message}`);
}
const ledgers = gate.loadPublishLedgers(ledgerDir);
const prevPublish = gate.previousPublish(ledgers, chapter);
const freshness = gate.snapshotFreshness({
  currentFp: snapshotFp,
  previousChapter: prevPublish ? prevPublish.chapter : null,
  previousFp: prevPublish ? prevPublish.record.snapshotFingerprint : null,
});
const snapshotNote = {
  verdict: freshness.verdict,
  reason: freshness.reason,
  previousChapter: prevPublish ? prevPublish.chapter : null,
};

// 账本提前读：阻断/幂等分支也要据此判断「这次要不要覆盖已发布的那份验收记录」
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
// 已发布过「另一稿」时，被拦/幂等运行的报告另存草稿名：chNNN-gate-report.json 是发布当时的验收记录，
// 被一次没发出去的改稿覆盖掉，账本与报告就对不上了（publish-status 会报 integrity 不一致）
const draftReportPath = (fp) => path.join(
  ledgerDir,
  `ch${String(chapter).padStart(3, '0')}-gate-report-draft-${String(fp).replace(/^sha256:/, '').slice(0, 8)}.json`,
);
const blockedReportPath = (last && last.contentFingerprint !== curFp) ? draftReportPath(curFp) : reportPath;

// ---- 0.9 可选：先把本章 CHANGES 里的新实体补成档案骨架（--scaffold）----
// 必须在门禁之前：门禁 1（引用校验）只认 设定/ 下的档案文件名，新角色上场前不建档就是「未登记实体」；
// 伏笔闭环也只认 伏笔追踪/<vID>-*.md。建档只补骨架、不碰已有文件，失败不阻断——门禁会照实拦。
let scaffolded = null;
if (opts.scaffold) {
  // 用草稿（还没落盘到正文），不是 targetPath——闸门之前正文目录还是空的
  const r = spawnSync(process.execPath, [path.join(__dirname, 'scaffold-entity.js'), configPath, draftPath, '--write', '--quiet'], { encoding: 'utf-8' });
  const text = `${(r.stdout || '').trim()}\n${(r.stderr || '').trim()}`.trim();
  scaffolded = r.status === 0;
  if (!opts.json) {
    if (r.status === 0) console.log(`   ${text || '档案齐了'}`);
    else console.warn(`   ⚠️ 建档没做全（门禁按现状判定）：\n${text.replace(/^/gm, '     ')}`);
  }
}

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
    extra: { gatesSkipped: true, snapshotFreshness: snapshotNote },
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
    bodyText: draftText,
    allowMissingAi: !!opts.allowMissingAi,
  });
  const extra = { snapshotFreshness: snapshotNote };
  if (merged.aiOmitted) extra.aiOmitted = true;
  report = gate.buildReport({
    novel: (config.info && config.info.name) || '',
    chapter,
    draftText,
    gates: ruleResult.gates,
    checks: ruleResult.checks,
    blockReasons: merged.blockReasons,
    extra,
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
  snapshotFreshness: snapshotNote,
  published: false,
  noop: false,
  dryRun: !!opts.dryRun,
};
// --scaffold 的结果要能出现在 --json 输出里（账本里也有，见 record.scaffolded）
if (opts.scaffold) out.scaffolded = !!scaffolded;
if (opts.scaffold) out.scaffolded = !!scaffolded;

function printResult(lines) {
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    lines.forEach((l) => console.log(l));
  }
}


// ---- 2. 阻断：一个字都不落 ----
if (report.blocked && !opts.dryRun) {
  gate.writeJsonAtomic(blockedReportPath, report);
  out.reportPath = show(blockedReportPath);
}
if (report.blocked) {
  if (!opts.json) {
    console.error(`❌ 门禁阻断，未发布（${report.blockReasons.length} 条）——正文目录未改动：`);
    report.blockReasons.forEach((r) => console.error(`  - ${r}`));
    if (!opts.dryRun) {
      console.error(`   报告已落盘：${show(blockedReportPath)}（改稿后重跑）`);
      if (blockedReportPath !== reportPath) {
        console.error(`   已发布的验收记录 ${show(path.basename(reportPath))} 保持不动（这一稿没发出去）`);
      }
    }
  }
  printResult([]);
  process.exit(1);
}

// ---- 3. 幂等：同指纹且正文已在 → no-op ----
if (last && publishedFileExists && last.contentFingerprint === curFp && path.basename(targetPath) === last.fileName) {
  out.noop = true;
  out.publishCount = publishes.length;
  // 不重写报告：重生成会换掉 generatedAt 与 integrity，账本里记的还是发布当时那份，审计就会报「报告被改过」
  printResult([
    `⏭️ 幂等跳过：第${chapter}章正文指纹未变（${curFp}），已发布过 ${publishes.length} 次，本次不重复落盘`,
    `   目标: ${show(targetPath)}`,
    `   发布时的报告: ${show(reportPath)}（未重写）`,
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

// ---- 4.5 定稿保护之后：快照欠账 → 拒绝继续（一致性门禁在拿旧事实比对）----
const staleBlocked = freshness.verdict === 'fail' && !opts.allowStaleSnapshot && !opts.noGate;
if (staleBlocked) {
  if (!opts.dryRun) gate.writeJsonAtomic(blockedReportPath, report);
  out.reason = 'stale-snapshot';
  out.blocked = true;
  out.reportPath = show(blockedReportPath);
  if (!opts.json) {
    console.error('❌ 状态快照欠账：上一章的状态变化没有回写，拒绝发布——正文目录未改动：');
    console.error(`   ${freshness.reason}`);
    console.error(`   快照: ${show(snapshotPath)}  ${snapshotFp}`);
    if (!opts.dryRun) {
      console.error(`   报告已落盘：${show(blockedReportPath)}（回写快照后重跑）`);
      if (blockedReportPath !== reportPath) {
        console.error(`   已发布的验收记录 ${show(path.basename(reportPath))} 保持不动（这一稿没发出去）`);
      }
    }
  }
  printResult([]);
  process.exit(4);
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

// ---- 5.9 可选：把本章 CHANGES 机械回写到状态快照（--apply-changes）----
// 发布成功才回写；回写失败不改发布结果（正文与账本已落地），但会喊一声，别让欠账悄悄留下
let snapshotApplied = null;
if (opts.applyChanges) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'apply-changes.js'), configPath, targetPath, '--write', '--quiet'], { encoding: 'utf-8' });
  snapshotApplied = r.status === 0;
  out.snapshotApplied = snapshotApplied;
  if (!opts.json) {
    if (r.status === 0) console.log(`   快照回写 ${(r.stdout || '').trim() || '完成'}`);
    else console.error(`   ⚠️ 快照回写失败（正文与账本已发布，快照需手工补）：${((r.stderr || '') + (r.stdout || '')).trim()}`);
  }
}

const record = {
  publishedAt: new Date().toISOString(),
  chapter,
  contentFingerprint: curFp,
  draftFingerprint: report.draftFingerprint,
  fileName: path.basename(targetPath),
  reportPath: path.relative(path.dirname(ledgerPath), reportPath).split(path.sep).join('/'),
  reportIntegrity: report.integrity,
  ruleVersion: report.ruleVersion,
  summary: report.summary,
  forced: !!opts.noGate,
  aiOmitted: !!report.aiOmitted,
  // 供「下一章发布时」判断快照有没有回写：发布当时快照长什么样
  snapshotFingerprint: snapshotFp,
  staleSnapshot: freshness.verdict === 'fail',
  // --apply-changes 是否成功把本章 CHANGES 机械回写进快照（未用该选项时不写这个字段）
  snapshotApplied: opts.applyChanges ? !!snapshotApplied : undefined,
  // --scaffold 是否把 CHANGES 里缺的实体档案都补上了（未用该选项时不写这个字段）
  scaffolded: opts.scaffold ? !!scaffolded : undefined,
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
  const flags = [record.forced ? 'forced' : '', record.revised ? 'revise' : '', record.aiOmitted ? 'aiOmitted' : '',
    record.staleSnapshot ? 'staleSnapshot' : '', record.snapshotApplied ? 'applied' : '']
    .filter(Boolean).join(' ');
  console.log(`✅ 已发布 第${chapter}章 → ${show(targetPath)}${flags ? ` [${flags}]` : ''}`);
  console.log(`   正文指纹 ${curFp}`);
  console.log(`   门禁 pass ${report.summary.pass} / warn ${report.summary.warn} / fail 0 / skip ${report.summary.skip}｜规则版本 ${report.ruleVersion}`);
  console.log(`   报告 ${show(reportPath)}`);
  console.log(`   账本 ${show(ledgerPath)}（本章第 ${publishes.length} 次发布）`);
}
process.exit(0);
