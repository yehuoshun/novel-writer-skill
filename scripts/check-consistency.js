#!/usr/bin/env node
/**
 * 一致性 / 引用 / 伏笔闭环 门禁（可执行实现）
 *
 * 用法:
 *   node check-consistency.js <状态快照.md> <章节.md> <设定目录> [细纲.md]
 *
 * 四道门禁：
 *   1. 引用校验：CHANGES 声明的角色/地点/物品/势力 是否有对应设定文档
 *   2. 一致性校验：角色移动出发地是否与「上一章快照」一致；已死角色是否登场
 *   3. 伏笔闭环：➡️推进/✅回收/❌废弃 引用的伏笔 ID 是否已登记、状态是否可回退
 *   4. 蓝图出场合规（传细纲文件时启用）：细纲蓝图清单中的必出角色/地点/势力 是否在正文出现（缺 >1 → 拦）
 *
 * ⚠️ 快照必须是「上一章落地后、本章回写前」的版本。回写后快照已更新为目标态，
 *    再跑一致性校验会误报（出发地=旧值 vs 快照=新值）。
 *
 * 退出码: 0=通过, 1=有阻断项, 2=文件不存在/不可读
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, } = require('child_process');

function die(msg, code) { console.error(`❌ ${msg}`); process.exit(code); }

const [snapPath, chapPath, setDir, outlinePath] = process.argv.slice(2);
if (!snapPath || !chapPath || !setDir) {
  die('用法: node check-consistency.js <状态快照.md> <章节.md> <设定目录>', 2);
}
for (const [label, p] of [['快照', snapPath], ['章节', chapPath]]) {
  if (!fs.existsSync(p)) die(`${label}文件不存在: ${p}`, 2);
}
if (!fs.existsSync(setDir) || !fs.statSync(setDir).isDirectory()) die(`设定目录不存在: ${setDir}`, 2);

// 复用 parse-changes.js 解析 CHANGES
const PARSE = path.join(__dirname, 'parse-changes.js');
let changes;
try {
  const out = execFileSync(process.execPath, [PARSE], { input: fs.readFileSync(chapPath, 'utf8') }).toString();
  changes = JSON.parse(out);
} catch (e) {
  die('CHANGES 解析失败（读不到 ---CHANGES--- 块或分节标记错误）', 1);
}

const problems = [];

// ---- 收集设定目录下所有实体名（文件名 stem + 正文出现的名字）----
function walk(d) {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md') && e.name !== '状态快照.md') out.push(p);
  }
  return out;
}
const settingFiles = walk(setDir);
const stems = settingFiles.map(f => path.basename(f, '.md'));
// 实体档案按文件名匹配（命名约定：文档名=实体名，允许「地点前缀_实体名」）
const hasEntity = (name) => stems.some(s => s === name || s.endsWith('_' + name));

// ---- 门禁 1：引用校验 ----
const refs = [
  ...(changes.characterStates || []).map(x => x.name),
  ...(changes.characterMoves || []).map(x => x.name),
  ...(changes.itemTransfers || []).map(x => x.name),
  ...(changes.locationChanges || []).map(x => x.name),
  ...(changes.factionChanges || []).map(x => x.name),
].filter(Boolean);
for (const r of new Set(refs)) {
  if (!hasEntity(r)) problems.push(`[引用校验] 未登记实体：${r}`);
}

// ---- 门禁 2：一致性（角色移动出发地 vs 快照当前位置）----
const snap = fs.readFileSync(snapPath, 'utf8');
const posSection = (snap.split(/^##\s*角色状态/m)[1] || '').split(/^##\s/m)[0];
const posOf = {};
const statusOf = {};
for (const m of posSection.matchAll(/^\|\s*([^|]+?)\s*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/gm)) {
  const name = m[1].trim(), st = m[2].trim();
  if (/^角色$|^-+$/.test(name)) continue;
  statusOf[name] = st;              // 第 4 列：状态
}
for (const m of posSection.matchAll(/^\|\s*([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|/gm)) {
  const name = m[1].trim(), pos = m[2].trim();
  if (/^角色$|^-+$/.test(name)) continue;
  posOf[name] = pos;                // 第 3 列：当前位置
}
for (const mv of changes.characterMoves || []) {
  const m = mv.detail && mv.detail.match(/^(.+?)→(.+)$/);
  if (!m) continue;
  const from = m[1].trim();
  const cur = posOf[mv.name];
  if (cur && from && !cur.includes(from) && !from.includes(cur)) {
    problems.push(`[一致性] ${mv.name} 从「${from}」出发，但快照记录其在「${cur}」`);
  }
}
// 已死角色出现
for (const name of new Set([
  ...(changes.characterStates || []).map(x => x.name),
  ...(changes.characterMoves || []).map(x => x.name),
].filter(Boolean))) {
  const st = statusOf[name];
  if (st && /已死|死亡|已阵亡/.test(st)) problems.push(`[一致性] 已死角色出现：${name}（快照状态：${st}）`);
}

// 快照：伏笔当前状态（第 5 列）
const fstateSection = (snap.split(/^##\s*伏笔状态/m)[1] || '').split(/^##\s/m)[0];
const stateOf = {};
for (const m of fstateSection.matchAll(/^\|\s*(v\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/gm)) {
  stateOf[m[1]] = m[2].trim();
}

// ---- 门禁 3：伏笔闭环 ----
const fsDir = path.join(setDir, '伏笔追踪');
const registered = fs.existsSync(fsDir)
  ? fs.readdirSync(fsDir).map(f => f.match(/^(v\d+)/)).filter(Boolean).map(m => m[1])
  : [];
for (const f of changes.foreshadowing || []) {
  if (['progress', 'harvest', 'abandon'].includes(f.type)) {
    if (!f.id || !registered.includes(f.id)) {
      problems.push(`[伏笔闭环] 未登记伏笔：${f.id || '(无ID)'}（${f.type}）`);
    } else if (stateOf[f.id] && /已回收|已废弃/.test(stateOf[f.id])) {
      problems.push(`[伏笔闭环] 伏笔 ${f.id} 已是终态「${stateOf[f.id]}」，不能再 ${f.type}（状态不可回退）`);
    }
  }
}

// ---- 门禁 15：蓝图出场合规（可选，传细纲文件时启用）----
if (outlinePath) {
  if (!fs.existsSync(outlinePath)) die(`细纲文件不存在: ${outlinePath}`, 2);
  const chNo = (path.basename(chapPath).match(/第\s*(\d+)\s*章/) || [])[1];
  if (chNo) {
    const body = fs.readFileSync(chapPath, 'utf8').split('---CHANGES---')[0];
    for (const line of fs.readFileSync(outlinePath, 'utf8').split('\n')) {
      const m = line.match(/^\|\s*第?\s*(\d+)\s*章?\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/);
      if (!m || Number(m[1]) !== Number(chNo)) continue;
      // 第2/4/5 列 = 必出场角色/地点/势力（第3列是戏份要求，跳过）
      const names = [m[2], m[4], m[5]].join('、').split(/[、,，/]/).map(s => s.trim()).filter(Boolean);
      const missing = names.filter(n => !body.includes(n));
      if (missing.length > 1) problems.push(`[蓝图出场合规] 蓝图未出场：${missing.join('、')}（缺 ${missing.length} 个）`);
    }
  }
}

if (problems.length) {
  console.error(`❌ 门禁不通过（${problems.length} 项）:`);
  problems.forEach(p => console.error(`  ${p}`));
  process.exit(1);
}
console.log('✅ 一致性 / 引用 / 伏笔闭环 门禁通过');
process.exit(0);
