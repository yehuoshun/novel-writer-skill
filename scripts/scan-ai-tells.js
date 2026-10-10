#!/usr/bin/env node
/**
 * AI 味 / 门禁 2–6 高精度子集扫描（SKILL 门禁 10 的 Gate 2/3/4/5/6 中「可规则化」的部分）
 *
 * 用法:
 *   node scan-ai-tells.js <正文.md>
 *   node scan-ai-tells.js < 正文.md
 *
 * 定位：Gate 1（文本健康）已有 scan-text-health.js；本脚本补 Gate 2–6 里能量化的子集，
 *       一律 **仅提示、不判硬伤**（退出码恒 0）——语义/上下文判断仍归 AI 侧（见 anti-ai-gates.md）。
 *
 * 覆盖：
 *   Gate 2 AI 句式：序数枚举套话（首先…其次…最后）、总结套话（综上所述/由此可见）、时代套话
 *   Gate 3 心理外化：他感到/心中涌起/不由得/忍不住… 成簇（≥3 处）
 *   Gate 4 节奏：自然段「等厚」（长度过于均匀）、单段超长
 *   Gate 5 对话：对话占比过高、连续纯对话（≥4 段无动作打断）、单次发言过长
 *   Gate 6 结尾：章尾段无明显钩子信号
 *
 * 退出码: 0=完成（仅提示）, 2=用法/文件错误
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
const body = raw.split('---CHANGES---')[0];
const paras = body.split('\n').map(l => l.trim()).filter(l => l && !/^#/.test(l));

const tells = [];
const hit = (label, detail) => tells.push(`${label}${detail ? '：' + detail : ''}`);

// ---- Gate 2 AI 句式 ----
if (/首先/.test(body) && /(其次|然后|最后|再者)/.test(body)) hit('Gate2 序数枚举套话', '「首先…其次/然后/最后」——检查是否八股');
if (/综上所述|总而言之|由此可见|不难看出|总的来说/.test(body)) hit('Gate2 总结套话', '「综上所述/由此可见」类');
if (/在这个[^，。！？]{0,8}的时代|随着[^，。！？]{0,10}的发展|在当今[^，。！？]{0,6}的?社会/.test(body)) hit('Gate2 时代套话', '「在这个…的时代」类');

// ---- Gate 3 心理外化 ----
const psy = (body.match(/他感到|她觉得|他感觉|心中(涌起|泛起|一暖|一沉)|心里(一|涌)|不由得|忍不住|情不自禁|涌上心头/g) || []).length;
if (psy >= 3) hit('Gate3 心理外化成簇', `${psy} 处（他感到/心中涌起/不由得/忍不住…）——可外化为动作或神态`);

// ---- Gate 4 节奏 ----
if (paras.length >= 8) {
  const lens = paras.map(p => p.length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  if (mean > 0 && sd / mean < 0.25) hit('Gate4 段落等厚', `自然段长度过于均匀（变异系数 ${(sd / mean).toFixed(2)}）——长短错落才像人`);
}
const longest = paras.reduce((m, p) => Math.max(m, p.length), 0);
if (longest > 500) hit('Gate4 超长段', `单段 ${longest} 字——考虑断段`);

// ---- Gate 5 对话 ----
const isDialogue = (p) => /^[“"]/.test(p);
const dlg = paras.filter(isDialogue).length;
if (paras.length >= 6 && dlg / paras.length > 0.7) hit('Gate5 对话过密', `对话段占 ${Math.round(dlg / paras.length * 100)}%`);
let run = 0, maxRun = 0;
for (const p of paras) { if (isDialogue(p)) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
if (maxRun >= 4) hit('Gate5 连续纯对话', `连续 ${maxRun} 段无动作/神态打断——建议插入动作`);
if (/“[^”]{80,}”/.test(body)) hit('Gate5 单次发言过长', '一段引号内容 >80 字');

// ---- Gate 6 结尾 ----
const last = paras[paras.length - 1] || '';
if (last && !/[？?…]$|却|竟|忽然|突然|没想到|可惜|只是|然而|不知道|谁|为什么|究竟|难道/.test(last)) {
  hit('Gate6 章尾疑似无钩子', `末段「${last.slice(0, 24)}…」——检查是否留了翻页动力`);
}

if (tells.length) {
  console.log(`🔍 门禁 2–6 高精度子集扫描（${tells.length} 项提示，非硬伤）:`);
  tells.forEach(t => console.log(`  🟡 ${t}`));
} else {
  console.log('✅ 门禁 2–6 高精度子集：未见明显 AI 味/节奏问题（语义判断仍由 AI 侧）');
}
process.exit(0);
