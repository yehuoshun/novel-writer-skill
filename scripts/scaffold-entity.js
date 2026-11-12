#!/usr/bin/env node
/**
 * 建档联动：把本章 CHANGES 里出现的新实体补成设定档案骨架
 *
 * 用法:
 *   node scaffold-entity.js <config.json> <草稿.md> [--write] [--chapter N] [--quiet] [--json]
 *
 * 默认 dry-run：只打印「会建哪个文件」，不落盘；--write 才建。
 *
 * 为什么要有这个脚本：
 *   一致性门禁 1（引用校验）只认 设定/ 目录下的**档案文件名**（check-consistency.js:76 hasEntity），
 *   伏笔闭环只认 伏笔追踪/<vID>-*.md。于是会出现这种死结：CHANGES 里声明了一个新角色，
 *   apply-changes 能把它写进快照表，但档案还是空的——下一章这角色一登场就被「未登记实体」打回。
 *   人手建四五份样板档案既慢又容易漏字段，这里按 CHANGES 一次补齐。
 *
 * 建什么（只建缺的，已有的一个字节都不动）:
 *   角色设定/<名>.md   物品设定/<名>.md   地点设定/<名>.md   势力设定/<名>.md
 *   伏笔追踪/<vID>-<名>.md（只对「新埋设」建；推进/回收没有档案说明前面就漏建了，直接报错）
 *
 * 建档只补骨架，不替你编内容：外貌描述留空并附一句提醒——颜色写错，下一章反而会被描写一致性门禁打回。
 *
 * 退出码: 0 成功（含「档案齐了」）/ 1 有声明无法建档（需人工处理）/ 2 用法或配置错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');
const { parseChanges } = require('./parse-changes');

const USAGE = `用法: node scaffold-entity.js <config.json> <草稿.md> [--write] [--chapter N] [--quiet] [--json]

  默认 dry-run（只打印会建哪些文件），--write 才落盘
  --chapter N   草稿文件名解析不出章号时手工指定
  --quiet       只输出结果摘要（给 publish-chapter --scaffold 用）
  --json        机器可读输出`;

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const positional = [];
let write = false;
let quiet = false;
let asJson = false;
let chapterArg = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--write') write = true;
  else if (a === '--quiet') quiet = true;
  else if (a === '--json') asJson = true;
  else if (a === '--chapter') {
    const v = argv[++i];
    if (!v || !/^\d+$/.test(v)) die(`--chapter 需要一个正整数（收到 ${JSON.stringify(v)}）\n\n${USAGE}`, 2);
    chapterArg = Number(v);
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('--')) {
    die(`未知选项 ${a}\n\n${USAGE}`, 2);
  } else {
    positional.push(a);
  }
}
if (positional.length < 2) die(USAGE, 2);
const [configPath, draftPath] = positional;
if (!fs.existsSync(configPath)) die(`配置文件不存在：${configPath}`, 2);
if (!fs.existsSync(draftPath)) die(`草稿不存在：${draftPath}`, 2);

// ---------- 配置与目录 ----------
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  die(`配置文件不是合法 JSON：${e.message}`, 2);
}
const base = path.dirname(path.resolve(configPath));
const local = cfg.local || {};
if (!local.settings_path) die('配置缺 local.settings_path（设定目录）', 2);
const settingsDir = path.resolve(base, local.settings_path);
if (!fs.existsSync(settingsDir)) die(`设定目录不存在：${settingsDir}`, 2);

// ---------- 章号 ----------
function chapterFromName(p) {
  const baseName = path.basename(p);
  const m = baseName.match(/第\s*0*(\d+)\s*章/) || baseName.match(/^ch0*(\d+)/i);
  return m ? Number(m[1]) : null;
}
const chapter = chapterArg || chapterFromName(draftPath);
if (!chapter) die(`无法从 ${path.basename(draftPath)} 解析章号，请加 --chapter N`, 2);

// ---------- CHANGES ----------
let changes;
try {
  changes = parseChanges(fs.readFileSync(draftPath, 'utf8'));
} catch (e) {
  die(`${path.basename(draftPath)}：${e.message}`);
}

// ---------- 现有档案 ----------
/** 递归收集某个设定子目录下的文件名（不含扩展名） */
function stemsIn(sub) {
  const dir = path.join(settingsDir, sub);
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(path.basename(e.name, '.md'));
    }
  };
  walk(dir);
  return out;
}

/** 命名约定：文档名=实体名，允许多一级前缀（「地点_云海城」这种） */
const hasEntity = (sub, name) => {
  const stems = stemsIn(sub);
  return stems.some((s) => s === name || s.endsWith('_' + name));
};

const fsDir = path.join(settingsDir, '伏笔追踪');
const foreshadowDocs = fs.existsSync(fsDir)
  ? fs.readdirSync(fsDir).filter((f) => f.endsWith('.md')).map((f) => ({ file: f, id: (f.match(/^(v\d+)/) || [])[1] }))
  : [];
const foreshadowHas = (id) => foreshadowDocs.some((d) => d.id === id);

// ---------- 骨架模板 ----------
const note = (s) => `<!-- ${s} -->`;

const TEMPLATES = {
  character: (name) => [
    `# ${name}`,
    '',
    '## 基本信息',
    '',
    '- 身份：待补',
    '- 等级：待补',
    `- 首次登场：第${chapter}章`,
    '',
    '## 外貌描述',
    '',
    note('发色与瞳色要么与 状态快照 的「角色外貌」表一字不差，要么留空——颜色写错，下一章会被描写一致性门禁打回'),
    '',
    '## 性格特点',
    '',
    '## 说话风格',
    '',
    '## 目标',
    '',
  ].join('\n'),
  location: (name) => [
    `# ${name}`,
    '',
    '## 基本信息',
    '',
    '- 类型：待补',
    `- 首次登场：第${chapter}章`,
    '',
    '## 特点描述',
    '',
    '## 发生事件',
    '',
  ].join('\n'),
  item: (name) => [
    `# ${name}`,
    '',
    '## 基本信息',
    '',
    '- 类型：待补',
    `- 首次登场：第${chapter}章`,
    '',
    '## 外观描述',
    '',
    '## 状态',
    '',
    '## 流转历史',
    '',
  ].join('\n'),
  faction: (name) => [
    `# ${name}`,
    '',
    '## 基本信息',
    '',
    '- 类型：待补',
    `- 首次登场：第${chapter}章`,
    '',
    '## 目标',
    '',
    '## 成员',
    '',
  ].join('\n'),
  foreshadow: (id, meta) => [
    `# ${id} ${meta.title}`,
    '',
    `- 类型：${meta.type}`,
    `- 埋设章节：第${chapter}章`,
    '- 状态：已埋设',
    `- 预期读者效果：${meta.effect}`,
    '- 关联角色：',
    '',
    '## 推进记录',
    '',
  ].join('\n'),
};

const SUBDIR = { character: '角色设定', location: '地点设定', item: '物品设定', faction: '势力设定' };
const KIND_LABEL = { character: '角色', location: '地点', item: '物品', faction: '势力', foreshadow: '伏笔' };

// ---------- 盘点 ----------
const plan = [];      // { kind, name, file, note }
const problems = [];  // 声明了但没法自动建

function consider(kind, name) {
  if (!name || !String(name).trim()) return;
  const n = String(name).trim();
  if (hasEntity(SUBDIR[kind], n)) return;
  const file = path.join(settingsDir, SUBDIR[kind], `${n}.md`);
  plan.push({ kind, name: n, file, note: `${KIND_LABEL[kind]}档案骨架（第${chapter}章首次出现）` });
}

for (const x of changes.characterStates || []) consider('character', x.name);
for (const x of changes.characterMoves || []) consider('character', x.name);
for (const x of changes.locationChanges || []) consider('location', x.name);
for (const x of changes.itemTransfers || []) consider('item', x.name);
for (const x of changes.factionChanges || []) consider('faction', x.name);

for (const f of changes.foreshadowing || []) {
  if (!f.id) continue; // 旧格式伏笔由门禁给警告，不在这里猜 ID
  const rawName = (f.name || '').trim();
  // 裸名可能带「（类型：短线，预期读者效果：…）」；协议里这类说明也可能在 **名** 之后的详情段，两处都找
  const metaText = `${rawName} | ${f.detail || ''}`;
  const title = rawName.replace(/[（(][^（）()]*[）)]\s*$/, '').trim() || '待补';
  const typeM = metaText.match(/类型[：:]\s*([^，,；;｜|）)]+)/);
  const effM = metaText.match(/预期读者效果[：:]\s*([^，,；;｜|）)]+)/);
  const meta = { title, type: typeM ? typeM[1].trim() : '待补（长线 / 短线 / 误导 / 彩蛋）', effect: effM ? effM[1].trim() : '待补（揭晓那一刻要让读者感到什么）' };

  if (f.type === 'plant') {
    if (foreshadowHas(f.id)) continue; // 重复埋设由门禁拦，这里不管
    const file = path.join(fsDir, `${f.id}-${title}.md`);
    plan.push({ kind: 'foreshadow', name: f.id, file, note: `伏笔档案骨架（第${chapter}章埋设）`, meta });
  } else if (!foreshadowHas(f.id)) {
    problems.push(
      `伏笔 ${f.id}（${f.type}）没有 ${path.join('伏笔追踪', f.id + '-*.md')} 档案——` +
        '推进/回收的伏笔必须先在埋设那章建过档，这里不替你补建（补建会把「漏建档」掩盖成「刚埋设」）',
    );
  }
}

// ---------- 输出 ----------
const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

let created = 0;
const failed = [];

// 真写阶段：JSON 模式下也照常落盘，只是不打人类可读行
if (write && !asJson && !quiet && plan.length) console.log(`🏗 建档（真写）\n   缺 ${plan.length} 份档案：`);

for (const p of plan) {
  if (!write) {
    if (!asJson && !quiet) console.log(`   + ${rel(p.file)}  ${p.note}`);
    continue;
  }
  try {
    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    const body = p.kind === 'foreshadow'
      ? TEMPLATES.foreshadow(p.name, p.meta)
      : TEMPLATES[p.kind](p.name);
    gate.writeFileAtomic(p.file, body);
    created++;
    if (!asJson && !quiet) console.log(`   ✅ ${rel(p.file)}  ${p.note}`);
  } catch (e) {
    failed.push(`${rel(p.file)}：${e.message}`);
    if (!asJson) console.error(`   ❌ ${rel(p.file)}：${e.message}`);
  }
}

if (asJson) {
  console.log(JSON.stringify({
    chapter,
    dryRun: !write,
    planned: plan.map((p) => ({ kind: p.kind, name: p.name, file: rel(p.file), note: p.note })),
    created,
    failed,
    problems,
  }, null, 2));
} else {
  if (!plan.length) {
    if (!quiet) console.log('🏗 建档\n   ✅ 档案齐了，不用建');
  } else if (!write) {
    if (!quiet) console.log('   （dry-run 预演，加 --write 才建）');
  } else {
    console.log(`🏗 建档：已建 ${created} 份${failed.length ? `，失败 ${failed.length} 份` : ''}`);
  }
  if (!quiet) for (const msg of problems) console.error(`   ⚠️ ${msg}`);
}

if (failed.length || problems.length) process.exit(1);
process.exit(0);
