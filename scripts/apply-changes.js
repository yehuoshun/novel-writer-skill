#!/usr/bin/env node
/**
 * 状态快照机械回写：把本章 CHANGES 声明落到 设定/状态快照.md
 *
 * 用法:
 *   node apply-changes.js <config.json> <草稿.md> [--write] [--chapter N] [--quiet]
 *
 * 默认 dry-run：只打印「哪一行会改成什么」，不落盘；--write 才写回。
 * 章号默认从草稿文件名解析（第003章.md / ch003-changes.md），解析不到用 --chapter 指定。
 *
 * 为什么要有这个脚本：
 *   publish-chapter 能拦住「上一章没回写快照」（exit 4），但拦完之后还是让人手抄 CHANGES 到快照。
 *   手抄会错——多写一行就是「状态表出现多行（重复登记）」，漏写一行就是伏笔状态机停在旧值。
 *   这里把 10 类声明里能机械映射的那几类直接落到对应表：角色状态 / 角色移动 / 伏笔状态 /
 *   地点状态 / 势力状态 / 物品归属 / 冲突进度 / 时间线 / 下章交接包。
 *
 * 退出码: 0 成功（含「无需回写」）/ 1 回写失败（数据对不上，例如伏笔没登记）/ 2 用法错误
 */

const fs = require('fs');
const path = require('path');
const { parseChanges } = require('./parse-changes');

const RULE = '—';
const DASH = '—';
const UNKNOWN = new Set(['', '—', '-', '－', '未知', '不详', '不明', '待定', '无', '？', '?']);

function fail(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

// ---------- 参数 ----------
const USAGE = `用法: node apply-changes.js <config.json> <草稿.md> [--write] [--chapter N] [--quiet]

  默认 dry-run（只打印将要改的行），--write 才写回快照
  --chapter N   草稿文件名解析不出章号时手工指定
  --quiet       只输出结果摘要（给 publish-chapter --apply-changes 用）`;

const argv = process.argv.slice(2);
const positional = [];
let write = false;
let quiet = false;
let chapterArg = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--write') write = true;
  else if (a === '--quiet') quiet = true;
  else if (a === '--chapter') {
    const v = argv[++i];
    if (!v || !/^\d+$/.test(v)) fail(`--chapter 需要一个正整数（收到 ${JSON.stringify(v)}）`, 2);
    chapterArg = Number(v);
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('--')) {
    fail(`未知选项 ${a}\n\n${USAGE}`, 2);
  } else {
    positional.push(a);
  }
}

if (positional.length < 2) fail(`需要 <config.json> 和 <草稿.md>\n\n${USAGE}`, 2);
const [configPath, draftPath] = positional;

if (!fs.existsSync(configPath)) fail(`配置文件不存在：${configPath}`, 2);
if (!fs.existsSync(draftPath)) fail(`草稿不存在：${draftPath}`, 2);

// ---------- 配置与路径 ----------
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  fail(`配置文件不是合法 JSON：${e.message}`, 2);
}

const settingsDir = path.resolve(path.dirname(path.resolve(configPath)), cfg.local?.settings_path || './设定');
const snapshotPath = path.join(settingsDir, '状态快照.md');
if (!fs.existsSync(snapshotPath)) fail(`找不到状态快照：${snapshotPath}`);

// ---------- 章号 ----------
function chapterFromName(p) {
  const base = path.basename(p);
  const m = base.match(/第\s*0*(\d+)\s*章/) || base.match(/^ch0*(\d+)/i);
  return m ? Number(m[1]) : null;
}
const chapter = chapterArg || chapterFromName(draftPath);
if (!chapter) fail(`无法从 ${path.basename(draftPath)} 解析章号，请加 --chapter N`, 2);

// ---------- 解析 CHANGES ----------
let changes;
try {
  changes = parseChanges(fs.readFileSync(draftPath, 'utf8'));
} catch (e) {
  fail(`${path.basename(draftPath)}：${e.message}`);
}

// ---------- markdown 表格工具 ----------
function sectionRange(lines, title) {
  const re = new RegExp('^##\\s*' + title);
  const start = lines.findIndex(l => re.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
}

function lineOf(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

function rowLine(headerCells) {
  return '|' + headerCells.map(() => '------').join('|') + '|';
}

/** 取某段落的原文，用于判断「改完是否真的变了」 */
function sectionText(lines, range) {
  return lines.slice(range.start, range.end).join('\n');
}

function findTable(lines, range) {
  for (let i = range.start + 1; i < range.end - 1; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const next = (lines[i + 1] || '').trim();
    if (!/^\|[\s:|-]+\|$/.test(next)) return null;
    const rows = [];
    let j = i + 2;
    while (j < range.end && lines[j].trim().startsWith('|')) { rows.push(j); j++; }
    return { headerIdx: i, rows };
  }
  return null;
}

function ensureSection(lines, title, headerCells) {
  const found = sectionRange(lines, title);
  if (found) {
    if (!findTable(lines, found)) {
      // 有标题没表：补表头
      lines.splice(found.start + 1, 0, '', lineOf(headerCells), rowLine(headerCells), '');
      return sectionRange(lines, title);
    }
    return found;
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('', `## ${title}`, lineOf(headerCells), rowLine(headerCells), '');
  return sectionRange(lines, title);
}

const COL = {
  char: { title: '角色状态', header: ['角色', '等级', '当前位置', '状态', '背包', '最后出场章'], key: '角色' },
  foreshadow: { title: '伏笔状态', header: ['伏笔ID', '伏笔名', '类型', '预期读者效果', '状态', '埋设章', '推进章', '揭晓章'], key: '伏笔ID' },
  location: { title: '地点状态', header: ['地点', '当前状态', '触发事件', '相关章节'], key: '地点' },
  faction: { title: '势力状态', header: ['势力', '当前状态', '触发事件'], key: '势力' },
  item: { title: '物品归属', header: ['物品', '持有者', '状态'], key: '物品' },
  conflict: { title: '冲突进度', header: ['冲突', '当前状态', '最近事件', '涉及角色'], key: '冲突' },
};

const notes = [];
const problems = [];

function colIdx(header, names) {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * 在表格里找 key 行；不存在则追加新行（按 fallback 值填空）。
 * @returns {number} 行号
 */
function upsertRow(lines, def, keyValue, seed = {}) {
  const range = ensureSection(lines, def.title, def.header);
  const table = findTable(lines, range);
  const header = cellsOf(lines[table.headerIdx]);
  const keyIdx = 0;

  for (const rowIdx of table.rows) {
    const cells = cellsOf(lines[rowIdx]);
    if (cells[keyIdx] === keyValue) return { rowIdx, header, existed: true };
  }

  // 新增行：按 header 长度对齐
  const cells = header.map((name, i) => {
    if (i === keyIdx) return keyValue;
    if (name in seed) return seed[name];
    // 旧格式 3 列表（角色|位置|状态）兼容
    if (def === COL.char && name === '位置') return seed['当前位置'] ?? DASH;
    return DASH;
  });
  const insertAt = table.rows.length ? table.rows[table.rows.length - 1] + 1 : table.headerIdx + 2;
  lines.splice(insertAt, 0, lineOf(cells));
  return { rowIdx: insertAt, header, existed: false };
}

function setCell(lines, rowIdx, header, names, value) {
  const idx = colIdx(header, names);
  if (idx < 0) return;
  const cells = cellsOf(lines[rowIdx]);
  while (cells.length <= idx) cells.push(DASH);
  cells[idx] = value;
  lines[rowIdx] = lineOf(cells);
}

function getCell(lines, rowIdx, header, names) {
  const idx = colIdx(header, names);
  if (idx < 0) return '';
  return cellsOf(lines[rowIdx])[idx] || '';
}

// ---------- 字段解析 ----------
function segments(detail) {
  return String(detail || '').split('|').map(s => s.trim()).filter(Boolean);
}

function transition(seg) {
  const m = String(seg || '').match(/^(.+?)(?:→|->)(.+)$/);
  return m ? { from: m[1].trim(), to: m[2].trim() } : null;
}

function kv(seg) {
  const m = String(seg || '').match(/^([^：:]{1,10})[：:](.+)$/);
  return m ? { k: m[1].trim(), v: m[2].trim() } : null;
}

function appendChapter(existing, chapter) {
  const list = String(existing || '').split(/[,，、\s]+/).filter(s => s && !UNKNOWN.has(s));
  if (!list.includes(String(chapter))) list.push(String(chapter));
  return list.join(',');
}

// ---------- 快照文本 ----------
const original = fs.readFileSync(snapshotPath, 'utf8');
const lines = original.split('\n');
const before = lines.slice();

// 标题里的「截止第N章」
const titleIdx = lines.findIndex(l => /^#\s*状态快照/.test(l));
if (titleIdx >= 0 && !/截止第\s*\d+\s*章/.test(lines[titleIdx])) {
  lines[titleIdx] = lines[titleIdx].replace(/\s*$/, `（截止第${chapter}章）`);
} else if (titleIdx >= 0) {
  const old = (lines[titleIdx].match(/截止第\s*(\d+)\s*章/) || [])[1];
  if (old !== String(chapter)) {
    lines[titleIdx] = lines[titleIdx].replace(/截止第\s*\d+\s*章/, `截止第${chapter}章`);
    if (!quiet) notes.push(`~ 标题：截止第${old}章 → 第${chapter}章`);
  }
}

// 1) 角色状态变化
for (const c of changes.characterStates || []) {
  if (!c.name) continue;
  const segs = segments(c.detail);
  const tr = transition(segs[0]);
  const newState = tr ? tr.to : (segs[0] || '').trim();
  const { rowIdx, header, existed } = upsertRow(lines, COL.char, c.name, {
    '状态': newState || DASH, '最后出场章': String(chapter),
  });
  if (!existed) {
    if (newState) setCell(lines, rowIdx, header, ['状态'], newState);
    setCell(lines, rowIdx, header, ['最后出场章'], String(chapter));
    notes.push(`+ 角色状态 ${c.name}：${newState || '（未给状态）'}（新增行，位置/等级待补）`);
  } else {
    const prev = getCell(lines, rowIdx, header, ['状态']);
    if (newState && prev !== newState) {
      setCell(lines, rowIdx, header, ['状态'], newState);
      notes.push(`~ 角色状态 ${c.name}：${prev || RULE} → ${newState}`);
    }
    setCell(lines, rowIdx, header, ['最后出场章'], String(chapter));
  }
}

// 2) 角色移动
for (const m of changes.characterMoves || []) {
  if (!m.name) continue;
  const tr = transition(segments(m.detail)[0]);
  if (!tr) { problems.push(`角色移动「${m.name}」的声明读不出「出发地→目的地」：${m.detail}`); continue; }
  const { rowIdx, header, existed } = upsertRow(lines, COL.char, m.name, {
    '当前位置': tr.to, '最后出场章': String(chapter),
  });
  const prev = existed ? getCell(lines, rowIdx, header, ['当前位置', '位置']) : '';
  setCell(lines, rowIdx, header, ['当前位置', '位置'], tr.to);
  setCell(lines, rowIdx, header, ['最后出场章'], String(chapter));
  if (!existed) notes.push(`+ 角色状态 ${m.name}：位置 ${tr.to}（新增行）`);
  else if (prev !== tr.to) notes.push(`~ 角色位置 ${m.name}：${prev || RULE} → ${tr.to}`);
}

// 3) 伏笔状态（四态）
const FSTATE = { plant: '已埋设', progress: '已推进', harvest: '已回收', abandon: '已废弃' };
for (const f of changes.foreshadowing || []) {
  if (!f.id) continue; // 旧格式无 vX：门禁只警告，这里不动快照
  const next = FSTATE[f.type];
  let row;
  try {
    row = upsertRow(lines, COL.foreshadow, f.id, {
      '伏笔名': f.name || DASH, '状态': next,
      '埋设章': f.type === 'plant' ? String(chapter) : DASH,
      '揭晓章': f.type === 'plant' ? '待定' : DASH,
    });
  } catch (e) {
    problems.push(e.message);
    continue;
  }
  const { rowIdx, header, existed } = row;
  if (f.type === 'plant') {
    if (existed) {
      notes.push(`= 伏笔 ${f.id} 已在快照登记（${getCell(lines, rowIdx, header, ['状态'])}），不重复埋设`);
    } else {
      const segs = segments(f.detail);
      const typeSeg = segs.find(s => /^（?类型[：:]/.test(s.replace(/^（/, '')));
      const type = typeSeg ? (typeSeg.match(/类型[：:]\s*([^）|]+)/) || [])[1] : '';
      const rest = segs.filter(s => s !== typeSeg);
      const effect = rest[0] || DASH;
      setCell(lines, rowIdx, header, ['类型'], (type || DASH).trim());
      setCell(lines, rowIdx, header, ['预期读者效果'], effect.replace(/^预期读者效果[：:]?\s*/, '') || DASH);
      notes.push(`+ 伏笔状态 ${f.id} ${f.name || ''}：已埋设（第${chapter}章）`);
    }
  } else if (!existed) {
    problems.push(`伏笔 ${f.id} 未在快照伏笔状态表登记——先补登记（v1 行）再回写，状态机不能凭空推进`);
  } else {
    const prev = getCell(lines, rowIdx, header, ['状态']);
    const prevProg = getCell(lines, rowIdx, header, ['推进章']);
    setCell(lines, rowIdx, header, ['状态'], next);
    if (f.type === 'progress') {
      setCell(lines, rowIdx, header, ['推进章'], appendChapter(prevProg, chapter));
      const nowProg = getCell(lines, rowIdx, header, ['推进章']);
      if (prev !== next || prevProg !== nowProg) {
        notes.push(`~ 伏笔状态 ${f.id}：${prev} → 已推进（推进章 ${nowProg}）`);
      }
    } else if (f.type === 'harvest') {
      setCell(lines, rowIdx, header, ['揭晓章'], String(chapter));
      if (prev !== next) notes.push(`~ 伏笔状态 ${f.id}：${prev} → 已回收（揭晓章 ${chapter}）`);
    } else if (prev !== next) {
      notes.push(`~ 伏笔状态 ${f.id}：${prev} → 已废弃`);
    }
  }
}

// 4) 地点状态
for (const lc of changes.locationChanges || []) {
  if (!lc.name) continue;
  const segs = segments(lc.detail);
  const tr = transition(segs[0]);
  if (!tr) { problems.push(`地点状态「${lc.name}」的声明读不出「旧状态→新状态」：${lc.detail}`); continue; }
  const { rowIdx, header, existed } = upsertRow(lines, COL.location, lc.name, {
    '当前状态': tr.to, '相关章节': String(chapter),
  });
  const prev = existed ? getCell(lines, rowIdx, header, ['当前状态']) : '';
  setCell(lines, rowIdx, header, ['当前状态'], tr.to);
  setCell(lines, rowIdx, header, ['相关章节'], String(chapter));
  if (segs[1]) setCell(lines, rowIdx, header, ['触发事件'], segs[1]);
  if (!existed) notes.push(`+ 地点状态 ${lc.name}：${tr.to}（新增行）`);
  else if (prev !== tr.to) notes.push(`~ 地点状态 ${lc.name}：${prev || RULE} → ${tr.to}`);
}

// 5) 势力状态
for (const fc of changes.factionChanges || []) {
  if (!fc.name) continue;
  const segs = segments(fc.detail);
  const tr = transition(segs[0]);
  if (!tr) { problems.push(`势力状态「${fc.name}」的声明读不出「旧状态→新状态」：${fc.detail}`); continue; }
  const { rowIdx, header, existed } = upsertRow(lines, COL.faction, fc.name, { '当前状态': tr.to });
  const prev = existed ? getCell(lines, rowIdx, header, ['当前状态']) : '';
  setCell(lines, rowIdx, header, ['当前状态'], tr.to);
  if (segs[1]) setCell(lines, rowIdx, header, ['触发事件'], segs[1]);
  if (!existed) notes.push(`+ 势力状态 ${fc.name}：${tr.to}（新增行）`);
  else if (prev !== tr.to) notes.push(`~ 势力状态 ${fc.name}：${prev || RULE} → ${tr.to}`);
}

// 6) 物品流转
for (const it of changes.itemTransfers || []) {
  if (!it.name) continue;
  const segs = segments(it.detail);
  const tr = transition(segs[0]);
  if (!tr) { problems.push(`物品流转「${it.name}」的声明读不出「原持有者→新持有者」：${it.detail}`); continue; }
  const { rowIdx, header, existed } = upsertRow(lines, COL.item, it.name, { '持有者': tr.to });
  const prev = existed ? getCell(lines, rowIdx, header, ['持有者']) : '';
  setCell(lines, rowIdx, header, ['持有者'], tr.to);
  // 状态描述在「方式」之后的自由段（如「完好」「已损毁」），不是转移本身
  const stateSeg = segs.slice(1).find(s => !/^方式[：:]/.test(s));
  if (stateSeg) setCell(lines, rowIdx, header, ['状态'], stateSeg);
  if (!existed) notes.push(`+ 物品归属 ${it.name}：持有者 ${tr.to}（新增行）`);
  else if (prev !== tr.to) notes.push(`~ 物品归属 ${it.name}：${prev || RULE} → ${tr.to}`);
}

// 7) 冲突进度
for (const cp of changes.conflictProgress || []) {
  if (!cp.name) continue;
  const segs = segments(cp.detail);
  const tr = transition(segs[0]);
  if (!tr) { problems.push(`冲突进度「${cp.name}」的声明读不出「旧状态→新状态」：${cp.detail}`); continue; }
  const { rowIdx, header, existed } = upsertRow(lines, COL.conflict, cp.name, { '当前状态': tr.to });
  const prev = existed ? getCell(lines, rowIdx, header, ['当前状态']) : '';
  setCell(lines, rowIdx, header, ['当前状态'], tr.to);
  const eventSeg = segs.find(s => /^推进事件[：:]/.test(s));
  if (eventSeg) setCell(lines, rowIdx, header, ['最近事件'], kv(eventSeg).v);
  if (!existed) notes.push(`+ 冲突进度 ${cp.name}：${tr.to}（新增行）`);
  else if (prev !== tr.to) notes.push(`~ 冲突进度 ${cp.name}：${prev || RULE} → ${tr.to}`);
}

// 8) 时间线（最近一章）
for (const tp of changes.timeProgress || []) {
  if (!tp || typeof tp !== 'object') continue;
  const span = tp['距上一章'] || tp._raw || '';
  const slot = tp['时段'] || '';
  const event = tp['关键事件'] || '';
  const line = `- 第${chapter}章：${slot || DASH} | 距上一章${span || DASH} | 关键事件：${event || DASH}`;
  let range = sectionRange(lines, '时间线');
  const beforeText = range ? sectionText(lines, range) : null;
  if (!range) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '## 时间线（最近一章）', '', line, '');
  } else {
    // 该段只存「最近一章」一行：保留非条目说明文字，其余重建（重建要稳定，否则每跑一次多一个空行）
    const extras = [];
    for (let i = range.start + 1; i < range.end; i++) {
      const t = lines[i].trim();
      if (t.startsWith('- ') || t === '') continue;
      extras.push(t);
    }
    const rebuilt = ['', ...extras, line, ''];
    lines.splice(range.start + 1, range.end - range.start - 1, ...rebuilt);
  }
  const afterRange = sectionRange(lines, '时间线');
  if (beforeText !== sectionText(lines, afterRange)) {
    notes.push(`~ 时间线：第${chapter}章 ${slot || RULE} | 距上一章${span || RULE}`);
  }
  break; // 只取第一条
}

// 9) 下章交接包（整段覆盖）
const handoff = (changes.handoff || []).filter(h => h && (h.key || h.raw));
if (handoff.length) {
  const range = sectionRange(lines, '下章交接包');
  const beforeText = range ? sectionText(lines, range) : null;
  if (!range) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '## 下章交接包', '', ...handoff.map(h => `- ${h.key}：${h.value}`), '');
  } else {
    const rebuilt = ['', ...handoff.map(h => `- ${h.key}：${h.value}`), ''];
    lines.splice(range.start + 1, range.end - range.start - 1, ...rebuilt);
  }
  if (beforeText !== sectionText(lines, sectionRange(lines, '下章交接包'))) {
    notes.push(`= 下章交接包：整段覆盖 ${handoff.length} 行`);
  }
}

// ---------- 输出 ----------
const changed = lines.join('\n') !== before.join('\n');

if (quiet) {
  if (changed) console.log(`快照回写：${notes.length} 处（第${chapter}章）`);
  else console.log('快照回写：无变化');
} else {
  console.log(`📝 ${path.relative(process.cwd(), snapshotPath) || snapshotPath}（第${chapter}章 CHANGES）`);
  for (const n of notes) console.log(`  ${n}`);
  if (!notes.length) console.log('  （CHANGES 里没有能落到快照表的声明）');
}

if (problems.length) {
  for (const p of problems) console.error(`❌ ${p}`);
  fail(`状态快照未写回（${problems.length} 处对不上）`, 1);
}

if (write && changed) {
  fs.writeFileSync(snapshotPath, lines.join('\n'), 'utf8');
  console.log(`✅ 已写回 ${path.basename(snapshotPath)}（第${chapter}章，${notes.length} 处变更）`);
} else if (write) {
  console.log('✅ 无需回写（快照已是本章状态）');
} else if (changed) {
  console.log('\n（dry-run：未写入。确认无误后加 --write 落盘）');
} else {
  console.log('✅ 无需回写（快照已是本章状态）');
}
