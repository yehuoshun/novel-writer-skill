#!/usr/bin/env node
/**
 * 一致性 / 引用 / 伏笔闭环 门禁（可执行实现）
 *
 * 用法:
 *   node check-consistency.js <状态快照.md> <章节.md> <设定目录> [细纲.md]
 *
 * 五道门禁：
 *   1. 引用校验：CHANGES 声明的角色/地点/物品/势力 是否有对应设定文档
 *   2. 一致性校验：角色移动出发地是否与「上一章快照」一致；已死角色是否登场；
 *      地点状态变化出发态 vs 快照地点状态表；物品流转原持有者 vs 快照物品归属表（v3.3.40+）
 *   3. 伏笔闭环：➡️推进/✅回收/❌废弃 引用的伏笔 ID 是否已登记、状态是否可回退
 *   4. 蓝图出场合规（传细纲文件时启用）：细纲蓝图清单中的必出角色/地点/势力 是否在正文出现（缺 >1 → 拦）
 *   5. 描写一致性：正文中发色/瞳色描写是否与快照「角色外貌」表/角色档案矛盾（如黑发、正文写「金色长发」）
 *      ——支持「色/白+的+发」变体（银色头发/银白的长发）与双色词主色归一化（银白≈银）
 *
 * 另：交接包必填（changes-protocol.md「每章必填」，缺失 → 打回，防下一章无交接单）
 *
 * 另：警告（不阻断，仅 stdout）——伏笔埋设后 10 章未推进；旧格式伏笔（无 vX ID）；
 *     细纲存在但蓝图清单无本章行（outline-arrangement.md 要求每章附蓝图）。
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
const warnings = [];
const chapterBody = fs.readFileSync(chapPath, 'utf8').split('---CHANGES---')[0];

// ---- 交接包必填（changes-protocol.md「交接包类别每章必填」）----
// 缺失 → 打回：下一章的交接单断了，属于真实流程断裂，不静默放过
if (!changes.handoff || changes.handoff.length === 0) {
  problems.push('[交接包] 缺少 <!-- 交接包 --> 声明（协议要求每章必填，供下一章读取）');
}

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
// 表头判别新旧格式：标准 6 列含「等级」（角色|等级|当前位置|状态|背包|最后出场章）；
// 旧格式 3 列（角色|位置|状态）无等级列 → 位置取第 2 列，避免误把「状态」当位置（v3.3.42 实弹误报修复）
const headerLine = posSection.split('\n').find(l => /^\|\s*角色\s*\|/.test(l)) || '';
const legacyPos = !headerLine.includes('等级');
for (const line of posSection.split('\n')) {
  const t = line.trim();
  if (!t.startsWith('|')) continue;
  const cells = t.replace(/^\||\|$/g, '').split('|').map(s => s.trim());
  const name = cells[0];
  if (!name || /^角色$|^-+$/.test(name) || cells.length < 3) continue;
  if (legacyPos) {
    posOf[name] = cells[1];
    statusOf[name] = cells[2];
  } else {
    posOf[name] = cells[2] || '';
    statusOf[name] = cells[3] || '';
  }
}
for (const mv of changes.characterMoves || []) {
  const m = mv.detail && mv.detail.match(/^(.+?)(?:→|->)(.+)$/);
  if (!m) continue;
  const from = m[1].trim();
  const cur = posOf[mv.name];
  // 快照位置为「—」/空/未知时无对照基准，不判矛盾
  const unknown = /^(—|-{1,2}|－|未知|不详|不明|待定|无)$/;
  if (cur && !unknown.test(cur) && from && !unknown.test(from) && !cur.includes(from) && !from.includes(cur)) {
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
const plantChapter = {};
for (const m of fstateSection.matchAll(/^\|\s*(v\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/gm)) {
  // 状态列可能带备注（如「已埋设（第1章埋设）」）→ 剥括号备注，避免状态机判断静默失效
  stateOf[m[1]] = m[2].trim().replace(/[（(][^）)]*[）)]$/, '');
  plantChapter[m[1]] = (m[3].match(/\d+/) || [])[0];
}

// ---- 门禁 3：伏笔闭环 ----
const fsDir = path.join(setDir, '伏笔追踪');
const registered = fs.existsSync(fsDir)
  ? fs.readdirSync(fsDir).map(f => f.match(/^(v\d+)/)).filter(Boolean).map(m => m[1])
  : [];
for (const f of changes.foreshadowing || []) {
  // 旧格式（无 vX ID）→ 警告，不打回（SKILL 门禁16 明确）
  if (!f.id) {
    warnings.push(`[伏笔闭环] 旧格式伏笔（无 vX ID）：「${f.name || (f.raw || '').trim()}」建议迁移到 vX 格式`);
    continue;
  }
  if (['progress', 'harvest', 'abandon'].includes(f.type)) {
    if (!registered.includes(f.id)) {
      problems.push(`[伏笔闭环] 未登记伏笔：${f.id}（${f.type}）——如已在快照伏笔状态表登记，请检查是否漏建 ${path.join('伏笔追踪', f.id + '-*.md')} 文档`);
    } else if (stateOf[f.id] && /已回收|已废弃/.test(stateOf[f.id])) {
      problems.push(`[伏笔闭环] 伏笔 ${f.id} 已是终态「${stateOf[f.id]}」，不能再 ${f.type}（状态不可回退）`);
    }
  }
}

// ---- 门禁 12 增强：地点状态一致性（CHANGES 地点状态变化 出发态 vs 快照地点状态表）----
// SKILL.md 门禁 13 承诺「正文中地点描写与地点特征档案矛盾 → 打回」——自由文本特征无法规则判定，
// 可枚举的「地点状态」矛盾由这里兜底（与角色移动出发地同构）：
//   - **[古庙]**：破败→被探查，快照地点状态「破败」→ 一致
//   - **[古庙]**：平静→紧张，快照地点状态「破败」→ 矛盾 → 打回
const locStateSection = (snap.split(/^##\s*地点状态/m)[1] || '').split(/^##\s/m)[0];
const locStateOf = {};
// 地点状态表是 4 列：地点 | 当前状态 | 触发事件 | 相关章节 → 取第 1、2 列
for (const m of locStateSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
  const name = m[1].trim();
  if (/^(地点|-+)$/.test(name)) continue;
  locStateOf[name] = m[2].trim();
}
for (const lc of changes.locationChanges || []) {
  const m = lc.detail && lc.detail.match(/^(.+?)(?:→|->)(.+)$/);
  if (!m) continue;
  const from = m[1].trim();
  const cur = locStateOf[lc.name];
  const unknown = /^(—|-{1,2}|－|未知|不详|不明|待定|无)$/;
  if (cur && !unknown.test(cur) && from && !unknown.test(from) && !cur.includes(from) && !from.includes(cur)) {
    problems.push(`[一致性] ${lc.name} 状态从「${from}」变化，但快照记录其当前状态为「${cur}」`);
  }
}

// ---- 门禁 12 增强：物品归属一致性（CHANGES 物品流转 原持有者 vs 快照物品归属表）----
//   - **[断锋剑]**：林山→林山，快照持有者「林山」→ 一致
//   - **[断锋剑]**：赵无极→赵无极，快照持有者「林山」→ 矛盾 → 打回
const itemSection = (snap.split(/^##\s*物品归属/m)[1] || '').split(/^##\s/m)[0];
const ownerOf = {};
// 物品归属表是 3 列：物品 | 持有者 | 状态 → 取第 1、2 列（与角色状态表取第 1、3 列不同）
for (const m of itemSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
  const name = m[1].trim();
  if (/^(物品|-+)$/.test(name)) continue;
  ownerOf[name] = m[2].trim();
}
for (const it of changes.itemTransfers || []) {
  const m = it.detail && it.detail.match(/^(.+?)(?:→|->)(.+)$/);
  if (!m) continue;
  const from = m[1].trim();
  const cur = ownerOf[it.name];
  const unknown = /^(—|-{1,2}|－|未知|不详|不明|待定|无)$/;
  if (cur && !unknown.test(cur) && from && !unknown.test(from) && !cur.includes(from) && !from.includes(cur)) {
    problems.push(`[一致性] 物品「${it.name}」原持有者「${from}」，但快照记录持有者为「${cur}」`);
  }
}

// ---- 门禁 15：蓝图出场合规（可选，传细纲文件时启用）----
// 只认「蓝图出场清单」表（表头含「必出场」），避免把同文档里的细纲表
// （| 章 | 核心事件 | 爽点类型 | 章首钩子 | 章尾钩子 | 字数 |）当蓝图解析而误拦。
if (outlinePath) {
  if (!fs.existsSync(outlinePath)) die(`细纲文件不存在: ${outlinePath}`, 2);
  const chNo = (path.basename(chapPath).match(/第\s*(\d+)\s*章/) || [])[1];
  if (chNo) {
    const body = chapterBody;
    const lines = fs.readFileSync(outlinePath, 'utf8').split('\n');
    const isSep = (s) => /^\s*\|[\s:|-]+\|\s*$/.test(s || '');
    let inBlueprint = false;
    let blueprintMatched = false;  // 本章是否有蓝图行（无 → 警告，见下方）
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s*\|/.test(line)) { inBlueprint = false; continue; }
      // 表头：含「必出场/出场」且下一行是分隔行（细纲表列头无「出场」，不会误认）
      if (/必出场|出场/.test(line) && isSep(lines[i + 1])) { inBlueprint = true; continue; }
      if (isSep(line)) continue;
      if (!inBlueprint) continue;
      const m = line.match(/^\|\s*第?\s*(\d+)\s*章?\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/);
      if (!m || Number(m[1]) !== Number(chNo)) continue;
      blueprintMatched = true;
      // 第2/4/5 列 = 必出场角色/地点/势力（第3列是戏份要求，跳过）
      const names = [m[2], m[4], m[5]].join('、').split(/[、,，/]/).map(s => s.trim()).filter(Boolean);
      const missing = names.filter(n => !body.includes(n));
      if (missing.length > 1) problems.push(`[蓝图出场合规] 蓝图未出场：${missing.join('、')}（缺 ${missing.length} 个）`);
    }
    // 细纲存在但蓝图清单无本章行 → 警告（文档要求每章附蓝图，漏附会让门禁空转）
    if (!blueprintMatched) {
      warnings.push(`[蓝图出场合规] 细纲蓝图清单无第 ${chNo} 章的行（outline-arrangement.md 要求每章附蓝图出场清单）`);
    }
  }
}

// ---- 门禁 13：描写一致性（正文发色/瞳色 vs 快照外貌表 / 角色档案）----
// 双色词在前（银白/乌黑…），避免「银白」被拆成「银」；单色词在后兜底
const COLOR = '银白|灰白|金棕|棕黑|乌黑|银灰|青灰|火红|深蓝|浅蓝|天蓝|墨黑|雪白|惨白|金黄|橘红|暗红|紫黑|黑|白|金|银|红|蓝|绿|紫|灰|棕|褐|青|橙|粉|黄';
// 双色词 → 主色（比较前归一化，避免「银白发 vs 银发」这种语义等价被误拦）
const COLOR_NORM = { 银白: '银', 灰白: '灰', 金棕: '棕', 棕黑: '黑', 乌黑: '黑', 银灰: '灰', 青灰: '灰', 火红: '红', 深蓝: '蓝', 浅蓝: '蓝', 天蓝: '蓝', 墨黑: '黑', 雪白: '白', 惨白: '白', 金黄: '金', 橘红: '橙', 暗红: '红', 紫黑: '紫' };
const normColor = (c) => COLOR_NORM[c] || c;
const HAIR = '发丝|头发|长发|短发|卷发|刘海|发';
const EYE = '眼眸|双眸|眸子|瞳孔|瞳|眼睛|眼';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profOf = (name) => {
  const f = settingFiles.find(p => { const s = path.basename(p, '.md'); return s === name || s.endsWith('_' + name); });
  return f ? fs.readFileSync(f, 'utf8') : null;
};
// 取数源（按文档约定）：优先「状态快照 → 角色外貌」表（state-snapshot.md 明确其
// 「用于描写一致性校验」）；无该表时回退角色档案的「发色/瞳色」标签（兼容旧快照/单测）。
const lookSection = (snap.split(/^##\s*角色外貌/m)[1] || '').split(/^##\s/m)[0];
const colorMap = {};
for (const m of lookSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/gm)) {
  const nm = m[1].trim();
  if (/^角色$|^-+$/.test(nm)) continue;
  colorMap[nm] = {
    hair: (m[2].match(new RegExp(`(?:${COLOR})`)) || [])[0],
    eye: (m[3].match(new RegExp(`(?:${COLOR})`)) || [])[0],
  };
}
const colorOf = (name, isHair) => {
  const cm = colorMap[name];
  if (cm) { const c = isHair ? cm.hair : cm.eye; if (c) return c; }
  const txt = profOf(name);
  if (!txt) return null;
  // 1) 旧档案标签：发色：/瞳色：
  const label = (txt.match(isHair ? /发色\s*[：:]+\s*([^\n]+)/ : /瞳色\s*[：:]+\s*([^\n]+)/) || [])[1];
  if (label) return (label.match(new RegExp('(?:' + COLOR + ')')) || [])[0] || null;
  // 2) setup-templates 档案模板是自由文本「## 外貌描述」（无标签字段）：
  //    从描述提取「X发/X瞳」颜色，避免快照无「角色外貌」表时门禁静默失效（老书/手动维护场景）
  const desc = txt.split(/^## /m).find(s => s.startsWith('外貌描述')) || '';
  // 「色」与「发/瞳」之间允许「的」：银色头发 / 银白的长发 都要能命中
  const m = desc.match(new RegExp(`(?:${COLOR})色?(?:的)?(?:${isHair ? HAIR : EYE})`));
  return m ? (m[0].match(new RegExp('(?:' + COLOR + ')')) || [])[0] : null;
};
// 角色名长优先，避免「张三」吃掉「张三丰」（子串误报）
// 命名约定允许「地点前缀_实体名」（如 龙城_张三.md），去前缀后也要能命中正文；
// 快照外貌表里的角色同样纳入（可能无独立档案）
const profNames = [...new Set([
  ...settingFiles
    .filter(p => p.includes(`${path.sep}角色设定${path.sep}`))
    .flatMap(p => {
      const s = path.basename(p, '.md');
      if (!s) return [];
      const i = s.lastIndexOf('_');
      return i > 0 ? [s, s.slice(i + 1)] : [s];
    }),
  ...Object.keys(colorMap),
])].sort((a, b) => b.length - a.length);
if (profNames.length) {
  const NAME_RE = new RegExp(`(${profNames.map(escRe).join('|')})`, 'g');
  // 允许「色/白」与「发/瞳」之间带「的」：黑色长发 / 银色的头发 / 银白的长发 都要能命中（v3.3.40 实弹漏检修复）
  const ATTR_RE = new RegExp(`(${COLOR})色?(?:的)?(${HAIR}|${EYE})`, 'g');
  for (const m of chapterBody.matchAll(ATTR_RE)) {
    const idx = m.index, got = m[1], noun = m[2];
    // 取「颜色词」所在句内、前 12 字窗口，归属给其中最靠后的角色名
    // （避免「林山看着青云子的白发」把白发误记到林山头上）
    const pre = chapterBody.slice(0, idx);
    const sentStart = Math.max(0, ...['。', '！', '？', '\n'].map(c => pre.lastIndexOf(c) + 1));
    const win = pre.slice(Math.max(sentStart, pre.length - 12));
    let who = null, whoEnd = -1;
    for (const mm of win.matchAll(NAME_RE)) { who = mm[1]; whoEnd = mm.index + mm[1].length; }
    if (!who) continue;
    // 名字与颜色之间若出现「…的」（不紧贴名字），发/瞳归属方是另一个名词 → 跳过
    if (win.slice(whoEnd).indexOf('的') > 0) continue;
    const isHair = new RegExp('^(?:' + HAIR + ')$').test(noun);
    const want = colorOf(who, isHair);
    if (want && normColor(got) !== normColor(want)) {
      problems.push(`[描写一致性] ${who} 正文写「${got}${isHair ? '发' : '瞳'}」，设定记「${want}${isHair ? '发' : '瞳'}」`);
    }
  }
}

// ---- 警告（不阻断）：伏笔埋设后 10 章未推进且未回收 ----
const curCh = (path.basename(chapPath).match(/第\s*(\d+)\s*章/) || [])[1];
if (curCh) {
  for (const [id, st] of Object.entries(stateOf)) {
    if (/^已埋设$|^open$/i.test(st)) {
      const pc = plantChapter[id];
      if (pc && Number(curCh) - Number(pc) >= 10) {
        warnings.push(`[伏笔闭环] 伏笔 ${id} 已埋设 ${Number(curCh) - Number(pc)} 章未推进（埋设于第${pc}章）`);
      }
    }
  }
}

if (warnings.length) {
  console.log(`⚠️ 警告（${warnings.length} 项，不阻断）:`);
  warnings.forEach(w => console.log(`  ${w}`));
}
if (problems.length) {
  console.error(`❌ 门禁不通过（${problems.length} 项）:`);
  problems.forEach(p => console.error(`  ${p}`));
  process.exit(1);
}
console.log('✅ 一致性 / 引用 / 伏笔闭环 门禁通过');
process.exit(0);
