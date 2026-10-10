#!/usr/bin/env node
/**
 * 门禁报告完整性校验（把 SKILL 阶段三「AI 侧门禁」从软自觉变成硬交代）
 *
 * 用法:
 *   node verify-gate-report.js <门禁报告.md>
 *   node verify-gate-report.js < 报告.md
 *
 * 背景：12 门禁里，脚本能跑的（text-health / consistency / conflicts / ai-tells …）有退出码兜底；
 *       但 Gate 2–6 的语义判断、引用/蓝图/未知实体/伏笔的 AI 终判，全靠模型自觉——
 *       长会话下极易被跳过或一句「通过了」敷衍。本脚本在校验「报告是否 12 项齐全且各带结论」，
 *       缺项直接退 1，逼 AI 逐项交代（**不校验判断正确性**，那仍需人/另一模型复核）。
 *
 * 期望报告格式（见 SKILL「门禁结果输出格式」），必备项：
 *   🛡️ 门禁结果（第X章）
 *   Gate 1–6 写作质量 或 逐条 Gate 1…Gate 6，各带 ✅/⚠️/❌ 结论
 *   引用校验 / 一致性校验 / 描写一致性 / 未知实体检测 / 蓝图出场合规 / 伏笔闭环校验，各带结论
 *
 * 退出码: 0=齐全, 1=缺项, 2=用法/文件错误
 */
'use strict';
const fs = require('fs');

let raw;
const arg = process.argv[2];
if (arg) {
  if (!fs.existsSync(arg)) { console.error(`❌ 文件不存在: ${arg}`); process.exit(2); }
  raw = fs.readFileSync(arg, 'utf-8');
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
for (const label of ['引用校验', '一致性校验', '描写一致性', '未知实体', '蓝图出场', '伏笔闭环']) {
  if (!lineOf(label)) missing.push(label);
  else if (!hasVerdict(label)) missing.push(`${label}（缺结论）`);
}

if (missing.length) {
  console.error(`❌ 门禁报告不完整（缺 ${missing.length} 项）:`);
  missing.forEach(m => console.error(`  - ${m}`));
  console.error('   → 逐项补齐后再发布；禁止一句话「门禁通过」蒙混（12 门禁必须逐条交代）');
  process.exit(1);
}
console.log('✅ 门禁报告完整（12 门禁逐项带结论）——注意：只校验完整性，不校验判断正确性');
process.exit(0);
