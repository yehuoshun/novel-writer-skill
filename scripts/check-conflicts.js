#!/usr/bin/env node
/**
 * 冲突检测（SKILL 阶段四 step19「状态回写后自动跑冲突检测」的实现）
 *
 * 用法:
 *   node check-conflicts.js <状态快照.md> <设定目录>
 *
 * 检测快照内部的确定性冲突（回写后跑；与 check-consistency 的「CHANGES vs 上一章快照」互补——
 * 那是回写前、基于 CHANGES；这是回写后、基于快照自身）：
 *   1. 角色状态表：同一角色重复登记
 *   2. 已死角色：在「角色设定/已故/」目录，却在状态表里状态未标已死
 *   3. 物品归属：同一物品多行、持有者不一致
 *   4. 时间线：第N天倒流（后出现的天数 < 前面的）
 *   5. 位置留空：角色状态表位置为「—/未知」，却有明确「移动中」类状态（低置信，仅提示）
 *
 * 自由文本/跨章区间的位置冲突无法从单份快照规则判定 → 归 AI 侧（SKILL step19 明示「有冲突则提示」）。
 *
 * 退出码: 0=无冲突, 1=有冲突, 2=文件不存在/用法错误
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [snapPath, setDir] = process.argv.slice(2);
if (!snapPath || !setDir) {
  console.error('❌ 用法: node check-conflicts.js <状态快照.md> <设定目录>');
  process.exit(2);
}
for (const [label, p] of [['快照', snapPath], ['设定目录', setDir]]) {
  if (!fs.existsSync(p)) { console.error(`❌ ${label}不存在: ${p}`); process.exit(2); }
}
const snap = fs.readFileSync(snapPath, 'utf8');

const section = (name) => (snap.split(new RegExp(`^##\\s*${name}`, 'm'))[1] || '').split(/^##\s/m)[0];
const tableRows = (sec) => {
  const rows = [];
  for (const line of sec.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    if (!cells[0] || /^[-—]+$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
};

const conflicts = [];
const warnings = [];

// 1. 角色状态表重复
const cs = tableRows(section('角色状态'));
const seen = new Set();
const statusOf = new Map();
const posOf = new Map();
// 表头判别新旧格式：标准 6 列含「等级」（角色|等级|当前位置|状态|背包|最后出场章）；
// 旧格式 3 列（角色|位置|状态）无等级列 → 位置取第 2 列、状态取第 3 列，
// 避免把「状态」当位置、并让已死角色检测在旧格式下不静默失效
// （与 check-consistency.js v3.3.42 的 legacyPos 判别同规则）
const headerLine = section('角色状态').split('\n').find(l => /^\|\s*角色\s*\|/.test(l)) || '';
const legacy = !headerLine.includes('等级');
for (const c of cs) {
  const name = c[0];
  if (/^角色$/.test(name)) continue;
  if (seen.has(name)) conflicts.push(`[角色状态] 「${name}」在状态表出现多行（重复登记）`);
  seen.add(name);
  if (legacy) {
    if (c.length >= 2) posOf.set(name, c[1]);
    if (c.length >= 3) statusOf.set(name, c[2]);
  } else {
    if (c.length >= 3) posOf.set(name, c[2]);
    if (c.length >= 4) statusOf.set(name, c[3]);
  }
}

// 2. 已死角色：已故目录 vs 状态表
const deceased = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name === '已故') {
        for (const f of fs.readdirSync(p)) if (f.endsWith('.md')) deceased.push(path.basename(f, '.md'));
      } else walk(p);
    }
  }
})(setDir);
for (const dn of deceased) {
  const bare = dn.includes('_') ? dn.slice(dn.lastIndexOf('_') + 1) : dn;
  const st = statusOf.get(bare) || statusOf.get(dn);
  if (st && !/已死|死亡|已阵亡|已故|身亡|殒/.test(st)) {
    conflicts.push(`[已死角色] 「${bare}」在「角色设定/已故/」目录，但状态表记「${st}」（未标已死）`);
  }
}

// 3. 物品归属：同一物品多行且持有者不一致
const items = tableRows(section('物品归属'));
const ownerOf = new Map();
for (const it of items) {
  const n = it[0], owner = it[1];
  if (/^物品$/.test(n)) continue;
  if (ownerOf.has(n) && ownerOf.get(n) !== owner) {
    conflicts.push(`[物品归属] 物品「${n}」多行持有者不一致：「${ownerOf.get(n)}」vs「${owner}」`);
  }
  ownerOf.set(n, owner);
}

// 4. 时间线倒流
const days = [...section('时间线').matchAll(/第\s*(\d+)\s*天/g)].map(m => Number(m[1]));
for (let i = 1; i < days.length; i++) {
  if (days[i] < days[i - 1]) conflicts.push(`[时间线] 第 ${days[i]} 天出现在第 ${days[i - 1]} 天之后（时间倒流）`);
}

// 5. 位置留空但状态像「移动中」（低置信，仅提示）
const UNKNOWN_POS = /^(—|-{1,2}|－|未知|不详|待定|无|？|\?)$/;
for (const [name, pos] of posOf) {
  const st = statusOf.get(name) || '';
  if (UNKNOWN_POS.test(pos) && /移动中|赶路|在路上|前往/.test(st)) {
    warnings.push(`[位置] 「${name}」位置为「${pos}」但状态含移动语义「${st}」——确认位置已回写`);
  }
}

// 6. 档案完整性：快照角色/物品表 vs 设定目录档案文件（2026-10-12 ch023 实弹暴露：
//    设定/ 目录曾缺 30+ 份档案（10-11 重构搬漏，第17-22章校验靠旧目录撑着），
//    且语雀也缺苏正档案——加对账提示，缺档当场暴露）
//    无名龙套（外部势力先头队、主人/后队等势力成员）合法无独立档案 → 只提示不判错，AI 判断
const files = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['已故', 'changes', '伏笔追踪', '大纲', '变更日志'].includes(e.name)) continue;
      walk(p);
    } else if (e.name.endsWith('.md')) files.push(path.basename(e.name, '.md'));
  }
})(setDir);
const nameSet = new Set(files);
// 别名注册：档案名「外部势力来使（灰袍人）」→ 同时注册「灰袍人」（快照常用简称）
for (const f of files) {
  const m = f.match(/^(.*?)（([^）]+)）$/);
  if (m) nameSet.add(m[2]);
}
// 非独立角色：含势力前缀/斜杠合写/占位符
const NON_PERSON = /^(—|-{1,2}|－|未知|不详|待定|无|？|\?)$|\/|外部势力|后队|先头队|来使/;
for (const name of seen) {
  if (NON_PERSON.test(name)) continue;
  if (nameSet.has(name) || nameSet.has(name + '_')) continue;
  warnings.push(`[档案完整性] 快照角色「${name}」在设定目录无同名档案——龙套可忽略，重要角色需补档`);
}
for (const [item] of ownerOf) {
  if (/^(—|-{1,2}|－|未知|不详|待定|无|？|\?)$/.test(item)) continue;
  if (nameSet.has(item)) continue;
  warnings.push(`[档案完整性] 快照物品「${item}」在设定目录无同名档案——需补档或说明归并到哪份档案`);
}

if (warnings.length) {
  console.log(`⚠️ 提示（${warnings.length} 项，非冲突）:`);
  warnings.forEach(w => console.log(`  ${w}`));
}
if (conflicts.length) {
  console.error(`❌ 冲突检测：发现 ${conflicts.length} 处冲突:`);
  conflicts.forEach(c => console.error(`  ${c}`));
  process.exit(1);
}
console.log('✅ 冲突检测：快照内部无确定性冲突（跨章位置/语义冲突仍由 AI 判）');
process.exit(0);
