#!/usr/bin/env node
/**
 * 文本健康检测器 — 从「禁词」思维升级为「健康」思维
 *
 * 用法:
 *   node scan-text-health.js < 正文.md
 *   node scan-text-health.js /path/to/正文.md
 *
 * 检测维度（词无罪，分布和通顺才是判据）：
 *   1. 口语虚词密度（净句警告：得/还/甚至/又/也/就/都 过少 = 句子太干净）
 *   2. 断句呼吸（逗号链 ≥6、连续长句、句长均匀）
 *   3. 修饰分布（比喻词、封闭逻辑词「只有/仅仅/恰好」密度）
 *   4. 认知句模式（他总觉得/这让他知道/他意识到/久到 — 提醒非禁用）
 *   5. 标点硬伤（英文标点混入、引号不成对）
 *
 * 输出: ✅/⚠️ 报告，exit 0=健康，1=有硬伤（英文标点/引号不成对）
 */

const fs = require('fs');

let raw;
const arg = process.argv[2];
if (arg) {
  if (!fs.existsSync(arg)) { console.error(`❌ 文件不存在: ${arg}`); process.exit(2); }
  raw = fs.readFileSync(arg, 'utf-8');
} else {
  raw = fs.readFileSync('/dev/stdin', 'utf-8');
}

// 取正文（去掉 ---CHANGES--- 块）
const body = raw.split('---CHANGES---')[0];
const zhCount = (body.match(/[\u4e00-\u9fff]/g) || []).length;
if (zhCount < 100) { console.log('⚠️ 文本过短（<100 汉字），检测参考意义有限'); }

const issues = [];
const notes = [];

// ---- 1. 口语虚词密度 ----
const particles = ['得', '还', '甚至', '又', '也', '就', '都', '才', '再'];
let pCount = 0;
for (const p of particles) pCount += (body.match(new RegExp(p, 'g')) || []).length;
const perK = pCount / zhCount * 1000;
if (perK < 15) notes.push(`口语虚词偏少（${perK.toFixed(1)}/千字，参考 15-60）— 句子可能太「净」，缺人在说话的口气`);
else if (perK > 60) notes.push(`口语虚词偏多（${perK.toFixed(1)}/千字）— 检查是否啰嗦`);

// ---- 2. 断句呼吸 ----
// 逗号链：单句内连续逗号 ≥6
const commasPerSent = [];
for (const s of body.split(/[。！？!?]/)) {
  const n = (s.match(/[，,]/g) || []).length;
  if (n >= 6) commasPerSent.push({ n, s: s.trim().slice(0, 30) });
}
if (commasPerSent.length) notes.push(`长逗号链 ${commasPerSent.length} 处（单句 ≥6 逗号）: ${commasPerSent.map(c => `「${c.s}…」(${c.n})`).join(' / ')}`);

// 句长分布
const sents = body.split(/[。！？!?]/).filter(s => s.trim().length > 0 && !/^["“]/.test(s.trim()));
const longS = sents.filter(s => s.length >= 25);
const shortS = sents.filter(s => s.length <= 8);
const longPct = sents.length ? longS.length / sents.length * 100 : 0;
if (longPct > 50) notes.push(`长句（25 字+）占比 ${longPct.toFixed(0)}% — 偏多`);
else if (sents.length && shortS.length === 0) notes.push('无短句碎片（≤8 字）— 节奏可能缺少起伏');
else if (longPct < 15) notes.push(`长句占比仅 ${longPct.toFixed(0)}% — 可能过于碎`);
else notes.push(`句长分布健康（长句 ${longPct.toFixed(0)}%，短碎片 ${shortS.length} 句）`);

// ---- 3. 修饰分布 ----
const metaphors = (body.match(/[像如]|仿佛/g) || []).length;
if (metaphors / zhCount * 1000 > 4) notes.push(`比喻词密度 ${(metaphors / zhCount * 1000).toFixed(1)}/千字（阈值 ≤4）— 比喻偏密`);
const closedWords = (body.match(/只有|仅仅|恰好|刚好|唯一|无非/g) || []).length;
if (closedWords >= 3) notes.push(`封闭逻辑词 ${closedWords} 处（只有/仅仅/恰好…）— 检查叙述是否过于精确，可用「还有/又」替换`);

// ---- 4. 认知句模式（提醒非禁用）----
const patterns = [
  [/他总觉得/g, '「他总觉得」认知开头'],
  [/这让他知道/g, '「这让他知道」认知总结'],
  [/他意识到/g, '「他意识到」认知总结'],
  [/久到/g, '「久到」强调重复'],
  [/忽然/g, '「忽然」转折词'],
];
const patHits = [];
for (const [re, label] of patterns) {
  const n = (body.match(re) || []).length;
  if (n) patHits.push(`${label}×${n}`);
}
if (patHits.length) notes.push(`认知句模式 ${patHits.join(' / ')} — 可保留 1 处，成簇时替换为直接动作/引述`);

// ---- 4.5 语句通顺 ----
// 同主语连发：连续 3 句以上同一句首词（他/她/然后）→ 单调
const starts = body.split(/[。！？!?]/).map(s => s.trim()).filter(s => s.length > 2);
let sameStart = 0;
let runStart = '';
for (const s of starts) {
  const first = s.slice(0, 2);
  if (first === runStart) {
    sameStart++;
    if (sameStart === 2) notes.push(`连续 3+ 句同一开头「${first}…」— 句首单调，变化一下主语或换承接`);
  } else {
    sameStart = 0;
    runStart = first;
  }
}
// 连接词滥用：然后/接着/于是 密度
const connectors = (body.match(/然后|接着|于是|接下来/g) || []).length;
if (connectors / zhCount * 1000 > 2) notes.push(`连接词密度 ${(connectors / zhCount * 1000).toFixed(1)}/千字（然后/接着/于是）— 检查因果链是否靠连接词硬串`);
// 「的」字句密度（是…的 结构滥用）
const deSents = (body.match(/是[^。！？!?]{2,15}的/g) || []).length;
if (deSents >= 3) notes.push(`「是…的」结构 ${deSents} 处 — 书面判断腔，换直接叙述`);
// 废话填充：明显空转（不由分说/二话不说/只见/但见）
const filler = (body.match(/不由分说|二话不说|只见|但见/g) || []).length;
if (filler) notes.push(`填充词 ${filler} 处（不由分说/二话不说/只见）— 删掉句子意思不变`);

// ---- 5. 标点硬伤 ----
let hard = 0;
const half = body.match(/[",:;!?()]/g);
if (half) { issues.push(`半角标点混入: ${[...new Set(half)].join(' ')}（${half.length} 处）`); hard = 1; }
const openQ = (body.match(/“/g) || []).length;
const closeQ = (body.match(/”/g) || []).length;
if (openQ !== closeQ) { issues.push(`引号不成对（“ ${openQ} / ” ${closeQ}）`); hard = 1; }
const noIndent = body.split('\n').filter(l => l.startsWith('　　')).length;
const totalParas = body.split('\n').filter(l => l.trim()).length;
if (totalParas && noIndent < totalParas * 0.9) notes.push(`首行缩进缺失（${noIndent}/${totalParas} 段有缩进）`);

// ---- 输出 ----
console.log('🏥 文本健康检测报告\n');
console.log(`字数: ${zhCount} | 句数: ${sents.length}\n`);
for (const n of notes) console.log(`  🟡 ${n}`);
if (issues.length) {
  console.log(`\n❌ 硬伤 ${issues.length} 处:`);
  for (const i of issues) console.log(`  ${i}`);
  process.exit(1);
} else {
  console.log('\n✅ 无标点硬伤');
  process.exit(0);
}
