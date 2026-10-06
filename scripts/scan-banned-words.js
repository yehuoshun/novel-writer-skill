#!/usr/bin/env node
/**
 * 禁用词扫描器 — 对应 references/banned-words.md 的一级/二级分级
 *
 * 用法:
 *   node scan-banned-words.js < 正文.md
 *   node scan-banned-words.js /path/to/正文.md
 *
 * 输出:
 *   一级命中（0 容忍，出现即改）+ 二级命中（单章 ≥3 次违规）+ 句式模板命中
 *
 * 规则唯一源头：references/banned-words.md（脚本启动时实时解析，不硬编码）
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

// ---- 解析 banned-words.md ----
const BANNED_PATH = require('path').join(__dirname, '..', 'references', 'banned-words.md');
const src = fs.readFileSync(BANNED_PATH, 'utf-8');

const level1 = new Set();
const level2 = new Set();
const sentences = [];  // 总结/排比/升华句式模板（简单子串）

let currentList = null;
let currentLevel = null;
for (const line of src.split('\n')) {
  const t = line.trim();
  if (t.startsWith('## ')) {
    currentLevel = t.includes('一级') ? 1 : t.includes('二级') ? 2 : null;
    currentList = null;
    continue;
  }
  if (t.startsWith('### ')) {
    currentList = t;  // 类名，仅用于上下文
    continue;
  }
  if (t.startsWith('- "') || t.startsWith('- "')) {
    const m = t.match(/^-\s*"([^"]+)"/);
    if (m) sentences.push(m[1]);
    continue;
  }
  if (currentLevel === 1 || currentLevel === 2) {
    for (const w of t.split(/[、,，]/)) {
      const w2 = w.trim().replace(/^[-*]\s*/, '');
      if (w2 && w2.length > 0 && !w2.startsWith('#')) {
        if (currentLevel === 1) level1.add(w2);
        else level2.add(w2);
      }
    }
  }
}

// ---- 扫描 ----
const l1hits = [];
const l2counts = {};
const sentHits = [];

for (const w of level1) {
  let idx = body.indexOf(w);
  while (idx !== -1) {
    l1hits.push({ word: w, ctx: body.slice(Math.max(0, idx - 12), idx + w.length + 12).replace(/\n/g, ' ') });
    idx = body.indexOf(w, idx + w.length);
  }
}
for (const w of level2) {
  let idx = body.indexOf(w);
  let n = 0;
  while (idx !== -1) { n++; idx = body.indexOf(w, idx + w.length); }
  if (n > 0) l2counts[w] = n;
}
for (const s of sentences) {
  if (s && body.includes(s)) sentHits.push(s);
}

// ---- 输出 ----
let exit = 0;
console.log('🔍 禁用词扫描结果\n');

if (l1hits.length) {
  console.log(`❌ 一级命中（0 容忍，必须替换）: ${l1hits.length} 处`);
  for (const h of l1hits) console.log(`  「${h.word}」→ ${h.ctx}`);
  exit = 1;
} else {
  console.log('✅ 一级禁用词: 零命中');
}

const l2bad = Object.entries(l2counts).filter(([, n]) => n >= 3);
if (l2bad.length) {
  console.log(`\n❌ 二级命中（≥3 次违规，替换至少 2 处）: ${l2bad.length} 个词`);
  for (const [w, n] of l2bad) console.log(`  「${w}」×${n}次`);
  exit = 1;
} else if (Object.keys(l2counts).length) {
  console.log('\n🟡 二级词（单次不违规，注意密度）:');
  for (const [w, n] of Object.entries(l2counts).sort((a, b) => b[1] - a[1])) console.log(`  「${w}」×${n}次`);
} else {
  console.log('\n✅ 二级禁用词: 零命中');
}

if (sentHits.length) {
  console.log(`\n❌ 句式模板命中（0 容忍）: ${sentHits.length} 条`);
  for (const s of sentHits) console.log(`  "${s}"`);
  exit = 1;
} else {
  console.log('\n✅ 句式模板: 零命中');
}

process.exit(exit);
