#!/usr/bin/env node
/**
 * 门禁报告完整性校验（把 SKILL 阶段三「AI 侧门禁」从软自觉变成硬交代）
 *
 * 用法:
 *   node verify-gate-report.js <门禁报告.md>
 *   node verify-gate-report.js <门禁报告.md> --data <gate-report.json>   # 额外比对结论口径
 *   node verify-gate-report.js < 报告.md
 *
 * 背景：12 门禁里，脚本能跑的（text-health / consistency / conflicts / ai-tells …）有退出码兜底；
 *       但 Gate 2–6 的语义判断、引用/蓝图/未知实体/伏笔的 AI 终判，全靠模型自觉——
 *       长会话下极易被跳过或一句「通过了」敷衍。本脚本先校验「报告是否 12 项齐全且各带结论」，
 *       缺项直接退 1，逼 AI 逐项交代。
 *
 * 给了 --data（scripts/gate-report.js 产出的数据报告）时，再逐项比对两边的结论：
 *   ✅ = pass、⚠️ = warn、❌ = fail、不适用/跳过 = skip。
 *   文本报告写 ✅ 而数据报告是 warn/fail → 退 1。这是「手写漂亮结论」的机械拦截点。
 *   合并写的「Gate 1-6」按 6 项里最差的那档比。
 *
 * 期望报告格式（见 SKILL「门禁结果输出格式」），必备项：
 *   🛡️ 门禁结果（第X章）
 *   Gate 1–6 写作质量 或 逐条 Gate 1…Gate 6，各带 ✅/⚠️/❌ 结论
 *   引用校验 / 一致性校验 / 描写一致性 / 未知实体检测 / 蓝图出场合规 / 伏笔闭环校验，各带结论
 *
 * 退出码: 0=齐全（且与数据报告一致）, 1=缺项或口径不符, 2=用法/文件错误
 */
'use strict';
const fs = require('fs');
const gate = require('./lib/gate-suite');

function usage(msg) {
  console.error(`❌ ${msg}`);
  console.error('用法: node verify-gate-report.js <门禁报告.md> [--data <gate-report.json>]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let filePath = null;
let dataPath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--data') {
    dataPath = argv[++i];
    if (!dataPath) usage('--data 缺少文件路径');
    continue;
  }
  if (a.startsWith('--')) usage(`未知参数: ${a}`);
  if (filePath) usage(`只接受一个报告文件，多余参数: ${a}`);
  filePath = a;
}

let raw;
if (filePath) {
  if (!fs.existsSync(filePath)) { console.error(`❌ 文件不存在: ${filePath}`); process.exit(2); }
  raw = fs.readFileSync(filePath, 'utf-8');
} else {
  raw = fs.readFileSync(0, 'utf-8');
}
if (!raw.trim()) { console.error('❌ 报告为空'); process.exit(1); }

const lines = raw.split('\n');
const VERDICT = /✅|⚠️|❌|通过|打回|不通过|修正|已修正|不适用|N\/A/;
const lineOf = (label) => lines.find(l => l.includes(label)) || '';
const hasVerdict = (label) => VERDICT.test(lineOf(label));

const missing = [];

// 表头
if (!/门禁结果/.test(raw)) missing.push('表头「🛡️ 门禁结果（第X章）」');

// 6 写作质量 Gate：允许合并为「Gate 1-6」，或逐条 Gate 1…Gate 6
const combined = /Gate\s*1\s*[-–~—到]\s*6/.test(raw);
const gates = ['Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'Gate 5', 'Gate 6'];
if (combined) {
  const l = lines.find(x => /Gate\s*1\s*[-–~—到]\s*6/.test(x)) || '';
  if (!VERDICT.test(l)) missing.push('Gate 1-6 写作质量（缺结论）');
} else {
  for (const g of gates) {
    if (!lineOf(g)) missing.push(`${g}`);
    else if (!hasVerdict(g)) missing.push(`${g}（缺结论）`);
  }
}

// 6 专项
const SPECIALS = ['引用校验', '一致性校验', '描写一致性', '未知实体', '蓝图出场', '伏笔闭环'];
for (const label of SPECIALS) {
  if (!lineOf(label)) missing.push(label);
  else if (!hasVerdict(label)) missing.push(`${label}（缺结论）`);
}

if (missing.length) {
  console.error(`❌ 门禁报告不完整（缺 ${missing.length} 项）:`);
  missing.forEach(m => console.error(`  - ${m}`));
  console.error('   → 逐项补齐后再发布；禁止一句话「门禁通过」蒙混（12 门禁必须逐条交代）');
  process.exit(1);
}

// ---- 结论口径比对（可选，给 --data 时）----
const GATE_KEY_BY_LABEL = [
  ['引用校验', 'ref_check'],
  ['一致性校验', 'state_consistency'],
  ['描写一致性', 'description_consistency'],
  ['未知实体', 'unknown_entity'],
  ['蓝图出场', 'blueprint_appearance'],
  ['伏笔闭环', 'foreshadow_closure'],
];
const GATE1_6 = ['gate1_text_health', 'gate2_ai_syntax', 'gate3_psych_external', 'gate4_rhythm', 'gate5_dialogue', 'gate6_ending'];
const RANK = { pass: 0, skip: 1, warn: 2, fail: 3 };

function textVerdict(line) {
  if (line.includes('❌')) return 'fail';
  if (line.includes('⚠')) return 'warn';
  if (line.includes('✅')) return 'pass';
  if (/不适用|N\/A|跳过/.test(line)) return 'skip';
  return null;
}

/** 合并写的「Gate 1-6」按最差的一档比；全 skip 才算 skip。 */
function worstVerdict(verdicts) {
  const worst = verdicts.reduce((acc, v) => (RANK[v] > RANK[acc] ? v : acc), 'pass');
  if (worst === 'pass' && verdicts.every(v => v === 'skip')) return 'skip';
  return worst;
}

if (dataPath) {
  if (!fs.existsSync(dataPath)) { console.error(`❌ 数据报告不存在: ${dataPath}`); process.exit(2); }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  } catch (err) {
    console.error(`❌ 数据报告不是合法 JSON: ${err.message}`);
    process.exit(2);
  }
  const self = gate.verifyReport(report);
  if (!self.ok) {
    console.error(`❌ 数据报告自身不可信（${self.problems.length} 项）:`);
    self.problems.forEach(p => console.error(`  - ${p}`));
    process.exit(1);
  }

  const byKey = new Map((report.gates || []).map(g => [g.key, g]));
  const verdictOf = (key) => {
    const g = byKey.get(key);
    return g && g.verdict ? g.verdict : null;
  };

  const mismatches = [];
  const compare = (label, expected, lineOverride) => {
    if (!expected) return;
    const line = lineOverride || lineOf(label);
    if (!line) return; // 缺项已在上面拦过
    const actual = textVerdict(line);
    if (!actual) return;
    if (actual !== expected) {
      mismatches.push(`${label}：文本报告 ${actual} // 数据报告 ${expected}`);
    }
  };

  const gate1to6 = GATE1_6.map(verdictOf).filter(Boolean);
  if (combined) {
    const combinedLine = lines.find(x => /Gate\s*1\s*[-–~—到]\s*6/.test(x)) || '';
    compare('Gate 1-6', worstVerdict(gate1to6), combinedLine);
  } else {
    GATE1_6.forEach((key, i) => compare(`Gate ${i + 1}`, verdictOf(key)));
  }
  GATE_KEY_BY_LABEL.forEach(([label, key]) => compare(label, verdictOf(key)));

  if (mismatches.length) {
    console.error(`❌ 文本报告与数据报告口径不一致（${mismatches.length} 项）:`);
    mismatches.forEach(m => console.error(`  - ${m}`));
    console.error('   → 文本报告的结论要照抄数据报告（scripts/gate-report.js 的输出），不是凭印象重判');
    process.exit(1);
  }
}

console.log(
  dataPath
    ? '✅ 门禁报告完整，且 12 项结论与数据报告一致'
    : '✅ 门禁报告完整（12 门禁逐项带结论）——注意：只校验完整性，不校验判断正确性'
);
process.exit(0);
