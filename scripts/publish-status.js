#!/usr/bin/env node
/**
 * 发布账本审计（已发布的章节现在还算不算数）
 *
 * 用法:
 *   node publish-status.js <config.json> [--chapter N] [--json]
 *
 * 查什么（都是机械可比对的东西）：
 *   1. 报告还在不在、能不能过自检、integrity 与账本记的是不是同一份（防「发布后改报告」）；
 *   2. 报告指纹与账本、正文指纹与账本是否一致（防「报告/正文被换掉」）；
 *   3. 正文在发布后有没有被改动（改了却没走 publish-chapter → 账本失效）；
 *   4. 最新一章发布后 状态快照.md 有没有回写（CHANGES 欠账会让下一章的一致性门禁比对旧事实）。
 *
 * 为什么要有它：
 *   gate-report / publish-chapter 只管「发布那一刻」。发布之后文件会不会被手改、快照会不会没回写，
 *   没有任何东西盯着——账本写下来却没人核对，等于没有账本。
 *
 * 退出码: 0=没发现问题, 1=发现问题（详情见输出）, 2=用法或 IO 错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');

const FLAGS = new Set(['--json']);
const VALUED = new Set(['--chapter']);

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

const opts = parseArgs(process.argv.slice(2));
const configPath = opts.positional[0];
if (!configPath) die('用法: node publish-status.js <config.json> [--chapter N] [--json]');
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

const only = opts.chapter === undefined ? null : Number(opts.chapter);
if (opts.chapter !== undefined && !Number.isInteger(only)) die(`--chapter 不是整数: ${opts.chapter}`);

const ledgers = gate.loadPublishLedgers(ledgerDir);
const chapters = [];

for (const l of ledgers) {
  if (only !== null && l.chapter !== only) continue;
  if (l.error) {
    chapters.push({ chapter: l.chapter, status: 'ledger-broken', issues: [`账本损坏：${l.error}`], warns: [] });
    continue;
  }
  if (!l.publishes.length) {
    chapters.push({ chapter: l.chapter, status: 'ledger-empty', issues: ['账本存在但没有发布记录'], warns: [] });
    continue;
  }
  const rec = l.publishes[l.publishes.length - 1];
  const issues = [];
  const warns = [];

  // 报告：在不在、自检过不过、跟账本记的是不是同一份
  const reportPath = rec.reportPath ? path.resolve(path.dirname(l.file), rec.reportPath) : null;
  if (!reportPath || !fs.existsSync(reportPath)) {
    issues.push(`报告缺失：${rec.reportPath || '（账本没记 reportPath）'}`);
  } else {
    let report = null;
    try {
      report = gate.readJsonIfExists(reportPath);
    } catch (e) {
      issues.push(`报告读不出来：${e.message}`);
    }
    if (report) {
      const check = gate.verifyReport(report);
      if (!check.ok) issues.push(`报告自检不通过：${check.problems.join('；')}`);
      if (rec.reportIntegrity && report.integrity !== rec.reportIntegrity) {
        issues.push('报告 integrity 与账本不一致——发布后报告被重新生成或改过');
      }
      if (rec.contentFingerprint && report.contentFingerprint !== rec.contentFingerprint) {
        issues.push('报告指纹与账本不一致——报告不是这一稿的');
      }
      if (rec.ruleVersion && report.ruleVersion !== rec.ruleVersion) {
        warns.push(`报告规则版本 ${report.ruleVersion} 与账本 ${rec.ruleVersion} 不同`);
      }
    }
  }

  // 正文：还在不在、指纹有没有变
  const bodyPath = rec.fileName ? path.join(contentDir, rec.fileName) : null;
  if (!bodyPath || !fs.existsSync(bodyPath)) {
    issues.push(`正文缺失：${rec.fileName || '（账本没记文件名）'}`);
  } else {
    const bodyFp = gate.contentFingerprint(fs.readFileSync(bodyPath, 'utf-8'));
    if (rec.contentFingerprint && bodyFp !== rec.contentFingerprint) {
      warns.push('正文在发布后被改动（改了正文却没重新发布，账本记录的已不是当前定稿）');
    }
  }

  chapters.push({
    chapter: l.chapter,
    status: issues.length ? 'issue' : 'ok',
    fileName: rec.fileName,
    publishedAt: rec.publishedAt,
    fingerprint: rec.contentFingerprint,
    publishCount: l.publishes.length,
    forced: !!rec.forced,
    revised: !!rec.revised,
    aiOmitted: !!rec.aiOmitted,
    staleSnapshot: !!rec.staleSnapshot,
    issues,
    warns,
  });
}

// 最新一章发布后快照有没有回写（只有「最后发布的那章」有欠账可查）
let snapshot = null;
const audited = chapters.filter((c) => c.publishCount);
if (audited.length) {
  const latest = audited[audited.length - 1];
  const ledger = ledgers.find((l) => l.chapter === latest.chapter);
  const rec = ledger.publishes[ledger.publishes.length - 1];
  let fp = null;
  try {
    if (fs.existsSync(snapshotPath)) fp = gate.fileFingerprint(fs.readFileSync(snapshotPath, 'utf-8'));
  } catch (e) {
    fp = null;
  }
  if (!fp) {
    snapshot = { verdict: 'skip', chapter: latest.chapter, reason: '没有状态快照文件，无法判定回写' };
  } else if (!rec.snapshotFingerprint) {
    snapshot = { verdict: 'skip', chapter: latest.chapter, reason: '账本没记快照指纹（旧版账本），无法判定回写' };
  } else if (fp === rec.snapshotFingerprint) {
    // 回写还没做：这是「待回写」而不是账本出错——发布刚结束、状态还没抄进快照时就是这状态。
    // 真正的拦截在下一章发布时（publish-chapter exit 4），这里只提醒，不计入问题数。
    snapshot = {
      verdict: 'pending',
      chapter: latest.chapter,
      reason: `第${latest.chapter}章发布后 状态快照.md 至今未改动——CHANGES 还没回写，下一章的一致性 6 门禁会比旧事实（回写后本提醒消失）`,
    };
  } else {
    snapshot = { verdict: 'pass', chapter: latest.chapter, reason: `状态快照在第${latest.chapter}章发布后已更新` };
  }
}

const summary = {
  chapters: chapters.length,
  forced: chapters.filter((c) => c.forced).length,
  revised: chapters.filter((c) => c.revised).length,
  staleSnapshot: chapters.filter((c) => c.staleSnapshot).length,
  withIssues: chapters.filter((c) => c.issues.length).length,
  withWarns: chapters.filter((c) => c.warns.length).length,
  snapshotDebt: snapshot && snapshot.verdict === 'pending' ? 1 : 0,
};
// 快照待回写不算「账本出错」：真正的闸门在下一章发布时（exit 4），这里只提醒
const ok = summary.withIssues === 0;
const novel = (config.info && config.info.name) || '';

if (opts.json) {
  console.log(JSON.stringify({ novel, ok, summary, snapshot, chapters }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (!chapters.length) {
  console.log(`📒 ${novel || '本书'}：${only !== null ? `第${only}章` : '尚无'}发布记录（${ledgerDir}）`);
  process.exit(0);
}

console.log(`📒 发布账本审计｜${novel || '本书'}｜${chapters.length} 章有记录`);
for (const c of chapters) {
  const tags = [c.forced ? 'forced' : '', c.revised ? 'revise' : '', c.aiOmitted ? 'aiOmitted' : '',
    c.staleSnapshot ? 'staleSnapshot' : ''].filter(Boolean).join(' ');
  const mark = c.issues.length ? '❌' : (c.warns.length ? '⚠️' : '✅');
  const at = c.publishedAt ? c.publishedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—';
  console.log(`  ${mark} 第${String(c.chapter).padStart(3, '0')}章  ${String(c.fingerprint || '—').slice(0, 20)}…  ${at}` +
    `${c.publishCount ? `  发布 ${c.publishCount} 次` : ''}${tags ? ` [${tags}]` : ''}`);
  for (const i of c.issues) console.log(`        ✗ ${i}`);
  for (const w of c.warns) console.log(`        · ${w}`);
}
if (snapshot && snapshot.verdict !== 'pass') {
  const icon = snapshot.verdict === 'pending' ? '⚠️' : '⏭️';
  console.log(`  ${icon} 状态快照回写：${snapshot.reason}`);
}
console.log(`\n汇总: ${summary.chapters} 章｜forced ${summary.forced}｜revise ${summary.revised}｜` +
  `staleSnapshot ${summary.staleSnapshot}｜报告问题 ${summary.withIssues}｜待确认 ${summary.withWarns}｜` +
  `快照待回写 ${summary.snapshotDebt}`);
if (ok) {
  console.log('✅ 账本与报告一致');
} else {
  console.error('❌ 发现需要处理的问题（见上方 ✗ 与快照回写一行）');
}
process.exit(ok ? 0 : 1);
