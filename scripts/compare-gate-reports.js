#!/usr/bin/env node
/**
 * 双模型门禁报告比对（把 AI 判层也自动化：一致自动过，分歧才升级人工）
 *
 * 用法:
 *   node compare-gate-reports.js <主报告.md> <复核报告.md>
 *
 * 背景：AI 侧门禁（Gate 2–6 语义/引用/蓝图/未知实体/伏笔终判）无法单脚本判定对错。
 *       对策：换一个模型 / 新上下文独立跑一遍，产第二份「门禁结果」报告；
 *       本脚本逐项比对两份报告的结论——**完全一致 → 自动通过（无需人工）；任一分歧 → 退出码 1 升级人工**。
 *       这样把「人工验收」压到只剩「两模型打架」这种极少数情况（老板 2026-10-10 定：能不人工就不人工）。
 *
 * 退出码: 0=一致（自动过）, 1=有分歧（歧义，升级人工）, 3=报告缺项/不完整（重跑复核，非人工）, 2=用法/文件错误
 */
'use strict';
const fs = require('fs');

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('❌ 用法: node compare-gate-reports.js <主报告.md> <复核报告.md>');
  process.exit(2);
}
for (const p of [aPath, bPath]) {
  if (!fs.existsSync(p)) { console.error(`❌ 文件不存在: ${p}`); process.exit(2); }
}

const ITEMS = ['引用校验', '一致性校验', '描写一致性', '未知实体', '蓝图出场', '伏笔闭环'];
const GATES = ['Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'Gate 5', 'Gate 6'];

const verdictOf = (line) => {
  if (!line) return 'MISSING';
  if (/❌|打回|不通过/.test(line)) return 'fail';
  if (/⚠️/.test(line)) return 'warn';
  if (/✅|通过|已修正|修正/.test(line)) return 'pass';
  return 'unknown';
};

function parse(text) {
  const lines = text.split('\n');
  const find = (re) => lines.find(l => re.test(l));
  const out = {};
  const combined = find(/Gate\s*1\s*[-–~—到]\s*6/);
  if (combined) out['Gate1-6'] = verdictOf(combined);
  else for (const g of GATES) out[g] = verdictOf(find(new RegExp(g)));
  for (const it of ITEMS) out[it] = verdictOf(find(new RegExp(it)));
  return out;
}

const A = parse(fs.readFileSync(aPath, 'utf-8'));
const B = parse(fs.readFileSync(bPath, 'utf-8'));
const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];

const diffs = [];
const missing = [];
for (const k of keys) {
  const va = A[k] || 'MISSING', vb = B[k] || 'MISSING';
  if (va === 'MISSING' || vb === 'MISSING') { missing.push(`${k}（主=${va} 复核=${vb}）`); continue; }
  if (va !== vb) diffs.push(`${k}：主判定=${va} vs 复核=${vb}`);
}

if (diffs.length) {
  console.error(`❌ 两模型结论分歧 ${diffs.length} 处（属**歧义**）——升级人工复核:`);
  diffs.forEach(d => console.error(`  - ${d}`));
  if (missing.length) console.error(`  （另有 ${missing.length} 处缺项，一并补齐）`);
  console.error('   → 人工只需裁这一处歧义，不是每章都审。');
  process.exit(1);
}
if (missing.length) {
  console.error(`↻ 报告缺项 ${missing.length} 处（**非歧义**，不找人）——补齐后**重跑复核**:`);
  missing.forEach(m => console.error(`  - ${m}`));
  process.exit(3);
}
console.log(`✅ 双模型门禁报告完全一致（${keys.length} 项）——自动通过，无需人工`);
process.exit(0);
