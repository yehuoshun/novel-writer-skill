#!/usr/bin/env node
/**
 * 文本健康检测器 — 从「禁词」思维升级为「健康」思维
 *
 * 用法:
 *   node scan-text-health.js < 正文.md
 *   node scan-text-health.js /path/to/正文.md [config.json]
 *
 * 可选第 2 参数 config.json：对照 writing.chapter_words 做字数门禁——
 *   正文汉字数 < min → 硬伤 exit 1（「写章节」要求每章不低于下限）；> max → 提示（上限是提醒不是硬伤）
 *   （2026-10-10 实弹暴露：此前字数约束只写在 SKILL 文档，无脚本兜底，1685 字正文照样全绿）
 *
 * 检测维度（词无罪，分布和通顺才是判据）：
 *   1. 口语虚词密度（净句警告：得/还/甚至/又/也/就/都 过少 = 句子太干净）
 *   2. 断句呼吸（逗号链 ≥6、连续长句、句长均匀）
 *   3. 修饰分布（比喻词、封闭逻辑词「只有/仅仅/恰好」密度）
 *   4. 认知句模式（他总觉得/这让他知道/他意识到/久到 — 提醒非禁用）
 *   5. 标点硬伤（英文标点混入、引号不成对）
 *   6. 缩进健康（自然段段首两全角空格；豁免规则与 check-indentation 共享 lib/text-format.js）
 *
 * 输出: ✅/⚠️ 报告，exit 0=健康，1=有硬伤（英文标点/引号不成对/字数不足）
 */

const fs = require('fs');
const path = require('path');
const { INDENT, isExempt } = require('./lib/text-format');

let raw;
const [arg, cfgArg] = process.argv.slice(2);
if (arg) {
  if (!fs.existsSync(arg)) { console.error(`❌ 文件不存在: ${arg}`); process.exit(2); }
  raw = fs.readFileSync(arg, 'utf-8');
} else {
  raw = fs.readFileSync(0, 'utf-8');
}

// 取正文（去掉 ---CHANGES--- 块）
const body = raw.split('---CHANGES---')[0];
const zhCount = (body.match(/[\u4e00-\u9fff]/g) || []).length;
if (zhCount < 100) { console.log('⚠️ 文本过短（<100 汉字），检测参考意义有限'); }
// 密度类指标按「千字」算，对短文本会虚高；样本不足时跳过，避免误报
const MIN_SAMPLE = 1500;
const enough = zhCount >= MIN_SAMPLE;

const issues = [];
const notes = [];

// ---- 1. 口语虚词密度 ----
const particles = ['得', '还', '甚至', '又', '也', '就', '都', '才', '再'];
let pCount = 0;
for (const p of particles) pCount += (body.match(new RegExp(p, 'g')) || []).length;
const perK = pCount / zhCount * 1000;
if (enough && perK < 15) notes.push(`口语虚词偏少（${perK.toFixed(1)}/千字，参考 15-60）— 句子可能太「净」，缺人在说话的口气`);
else if (enough && perK > 60) notes.push(`口语虚词偏多（${perK.toFixed(1)}/千字）— 检查是否啰嗦`);

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
const metaphors = (body.match(/(?<![好不理想图对气景迹形现印偶])像|仿佛/g) || []).length;
if (enough && metaphors / zhCount * 1000 > 4) notes.push(`比喻词密度 ${(metaphors / zhCount * 1000).toFixed(1)}/千字（阈值 ≤4）— 比喻偏密`);
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
if (enough && connectors / zhCount * 1000 > 2) notes.push(`连接词密度 ${(connectors / zhCount * 1000).toFixed(1)}/千字（然后/接着/于是）— 检查因果链是否靠连接词硬串`);
// 「的」字句密度（是…的 结构滥用）——排除「但是/就是/还是/那是/要是」类连词里的「是」（v3.3.56 实弹暴露：连词被当判断腔误算）
const deSents = (body.match(/(?<![但就还那要于可总或若如尽既倒偏确只竟便则乃亦更])是[^。！？!?]{2,15}的/g) || []).length;
if (deSents >= 3) notes.push(`「是…的」结构 ${deSents} 处 — 书面判断腔，换直接叙述`);
// 废话填充：明显空转（不由分说/二话不说/只见/但见）
const filler = (body.match(/不由分说|二话不说|只见|但见/g) || []).length;
if (filler) notes.push(`填充词 ${filler} 处（不由分说/二话不说/只见）— 删掉句子意思不变`);

// ---- 5. 标点硬伤 ----
let hard = 0;
// HTML 注释里的 ! 是注释语法（<!-- 语雀渲染占位（首段缩进保护） -->），不是标点混入——
// prepare-upload.js 前置的占位注释会被 [",!?] 误判为硬伤（2026-10-10 实弹暴露：
// 2026-10-09 加占位注释功能时未同步豁免相邻门禁，自家产物被自家门禁拦）
const noComment = body.replace(/<!--[\s\S]*?-->/g, '');
// 硬伤：半角引号/逗号/叹号/问号（中文正文一律用全角）
const halfHard = noComment.match(/[",!?]/g);
if (halfHard) { issues.push(`半角标点混入: ${[...new Set(halfHard)].join(' ')}（${halfHard.length} 处）`); hard = 1; }
// 软提示：半角括号/冒号/分号（正文少见，也可能是「3:1」类比例，仅提醒不判硬伤）
const halfSoft = noComment.match(/[:;()]/g);
if (halfSoft) { notes.push(`半角括号/冒号 ${halfSoft.length} 处（: ; ( )）— 若非数字比例等特例，应改全角`); }
const openQ = (noComment.match(/“/g) || []).length;
const closeQ = (noComment.match(/”/g) || []).length;
if (openQ !== closeQ) { issues.push(`引号不成对（“ ${openQ} / ” ${closeQ}）`); hard = 1; }
// 缩进健康：与 check-indentation.js 同规则（共享 lib/text-format.js，防口径漂移）——
// 只统计「自然段首行」（标题/列表/引用/表格/代码块/场景分隔符等豁免行不进分母），
// 段内续行不强制（上一行是空行/文件开头/豁免行才算新段）。此前用「非空行」粗估分母，
// 会把豁免行计入导致合规正文误报（2026-10-10 全面扫描发现）
const LINES = body.split('\n');
let inCodeBlock = false;
let paraFirst = 0, paraIndented = 0;
for (let i = 0; i < LINES.length; i++) {
  const t = LINES[i].trim();
  if (/^```|^~~~/.test(t)) { inCodeBlock = !inCodeBlock; continue; }
  if (inCodeBlock) continue;
  if (isExempt(LINES[i], inCodeBlock)) continue;
  const prev = i === 0 ? '' : LINES[i - 1];
  const prevExempt = i === 0 || isExempt(prev) || /^```|^~~~/.test(prev.trim());
  if (!prevExempt) continue; // 段内续行，不强制
  paraFirst++;
  if (LINES[i].startsWith(INDENT)) paraIndented++;
}
if (paraFirst && paraIndented < paraFirst * 0.9) notes.push(`首行缩进缺失（${paraIndented}/${paraFirst} 个自然段有缩进）`);

// ---- 5.5 字数对照（config.chapter_words.min/max，2026-10-10 实弹暴露：
//       此前约束只写在 SKILL 文档无脚本兜底，1685 字正文照样全绿通过验收）----
if (cfgArg) {
  if (!fs.existsSync(cfgArg)) { console.error(`❌ 配置文件不存在: ${cfgArg}`); process.exit(2); }
  let wordMin, wordMax;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgArg, 'utf-8'));
    const cw = cfg.writing && cfg.writing.chapter_words;
    wordMin = cw && cw.min;
    wordMax = cw && cw.max;
  } catch (e) { console.error(`❌ 配置文件解析失败: ${e.message}`); process.exit(2); }
  if (typeof wordMin === 'number' && zhCount < wordMin) {
    issues.push(`字数不足：${zhCount} < 配置下限 ${wordMin}（writing.chapter_words.min）——按「写章节」要求补写后再验收`);
    hard = 1;
  } else if (typeof wordMax === 'number' && zhCount > wordMax) {
    notes.push(`字数超出上限：${zhCount} > ${wordMax}（配置 chapter_words.max，上限是提醒非硬伤）`);
  }
}
if (!enough) notes.push(`字数 ${zhCount} < ${MIN_SAMPLE}：密度类指标（口语虚词/比喻/连接词）样本不足未判，仅供参考`);

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
