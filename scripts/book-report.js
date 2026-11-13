#!/usr/bin/env node
/**
 * 全书体检（跨章口径）
 *
 * 用法:
 *   node book-report.js <config.json> [--write] [--json]
 *
 * 为什么要有这个脚本：
 *   SKILL 里那些「跨章」的质量口径一直只是写在文档里让 AI 自己记——爽点连用 3 次要换、
 *   钩子连续 3 章弱要提醒、情绪连续 3 章平就是太平、每 3000–5000 字得有一个爽点。
 *   章内的错有 12 门禁拦（check-consistency / scan-ai-tells），全书走向没有任何脚本说话。
 *   单章全绿却让读者在第 40 章没理由追下去，是长篇最常见的死法。
 *
 * 数据从哪来（都是现成的，不改任何现有流程）:
 *   计划侧 设定/大纲/细纲/*.md 的细纲表（章 | 核心事件 | 爽点类型 | 章首钩子 | 章尾钩子 | 字数）
 *   实况侧 设定/爽点追踪(.md 或 目录)、钩子追踪、情绪曲线（每章回写时更新的三个追踪档）
 *          正文/第NNN章.md 的实际汉字数（先剥 CHANGES 块）
 *   伏笔   状态快照.md 的「## 伏笔状态」表（与 next-chapter 同一套口径）
 *
 * 判据（照 SKILL 原文，不另立标准）:
 *   - 连续 2 章无爽点 → 提醒；同一类型连用 3 次 → 提醒换类型；爽点间隔超 5000 字 → 提醒
 *   - 章尾无钩子 → 提醒；连续 3 章钩子强度「弱」→ 提醒
 *   - 情绪极值连续 3 章 ≤5 → 太平成；连续 5 章 ≥8 → 情绪疲劳
 *   - 正文字数低于 writing.chapter_words.min → 每章点名；后半程均值比前半程掉 >20% → 提醒
 *   - 伏笔逾期（长线埋 10 章没推进等，见 lib/foreshadow-audit）→ 点名
 *   - 主角系角色最后出场距今 >15 章 → 提醒「这个角色消失太久了」
 *
 * 选项:
 *   --write   把报告写到 设定/全书体检.md（默认只打到屏幕）
 *   --json    结构化结果打到 stdout（给脚本/agent 读）
 *
 * 退出码: 0=没命中硬规则, 1=有硬规则命中（爽点/钩子/情绪/字数/伏笔）, 2=用法或 IO 错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('./lib/gate-suite');
const { snapshotRows, ledgerReport } = require('./lib/foreshadow-audit');

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

function show(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') ? rel : p;
}

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const WRITE = argv.includes('--write');
const BRIEF = argv.includes('--brief');
const DIGEST = argv.includes('--digest');
let FAIL_ON = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--fail-on') {
    FAIL_ON = argv[++i];
    if (FAIL_ON !== 'red' && FAIL_ON !== 'warn') die('--fail-on 只认 red（默认：有红线才 exit 1）或 warn（有黄条也 exit 1）');
  } else if (a === '--json' || a === '--write' || a === '--brief' || a === '--digest') {
    // 布尔开关
  } else if (a.startsWith('--')) {
    die(`未知选项 ${a}（认 --write / --json / --brief / --digest / --fail-on warn）`);
  } else {
    positional.push(a);
  }
}
const [configPath] = positional;
if (!configPath) die('用法: node book-report.js <config.json> [--write] [--json] [--brief] [--digest] [--fail-on warn]');
if (!fs.existsSync(configPath)) die(`配置不存在: ${configPath}`);

let config;
try {
  config = gate.readJsonIfExists(configPath);
} catch (e) {
  die(e.message);
}
if (!config) die(`配置为空: ${configPath}`);

const base = path.dirname(path.resolve(configPath));
const local = config.local || {};
if (!local.content_path) die('配置缺 local.content_path（正文目录）');
if (!local.settings_path) die('配置缺 local.settings_path（设定目录）');

/** 相对路径：先按配置文件所在目录算（与 next-chapter 一致），那里没有就回退到 cwd */
function resolveDir(p) {
  if (path.isAbsolute(p)) return p;
  const byConfig = path.resolve(base, p);
  if (fs.existsSync(byConfig)) return byConfig;
  return path.resolve(p);
}

const contentDir = resolveDir(local.content_path);
const settingsDir = resolveDir(local.settings_path);
const detailDir1 = path.join(settingsDir, '大纲', '细纲');
const detailDir2 = path.join(settingsDir, '细纲');
const detailDir = fs.existsSync(detailDir1) ? detailDir1 : (fs.existsSync(detailDir2) ? detailDir2 : null);
const snapshotPath = path.join(settingsDir, '状态快照.md');
const reportPath = path.join(settingsDir, '全书体检.md');

const chapterWords = (config.writing && config.writing.chapter_words) || {};
const WORD_MIN = Number(chapterWords.min) || 0;

// ---------- 基础读取 ----------

/** 正文目录里现存的章号 → 文件路径（与 next-chapter 同一口径） */
function scanChapters(dir) {
  const found = new Map();
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^第\s*0*(\d+)\s*章\.md$/);
    if (m) found.set(Number(m[1]), path.join(dir, name));
  }
  return found;
}

/** 正文字数：先剥 CHANGES 块，数汉字（英文标点不掺进来，与 scan-text-health 同口径） */
function zhCount(text) {
  const body = gate.bodyOf(text);
  return (body.match(/[\u4e00-\u9fff]/g) || []).length;
}

/** 追踪档既可能是 设定/爽点追踪.md，也可能是 设定/爽点追踪/*.md（语雀分组镜像的目录形态） */
function readTrackDoc(name) {
  const asFile = path.join(settingsDir, `${name}.md`);
  if (fs.existsSync(asFile)) return { source: asFile, text: fs.readFileSync(asFile, 'utf-8') };
  const asDir = path.join(settingsDir, name);
  if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
    const files = fs.readdirSync(asDir).filter((f) => f.endsWith('.md')).sort();
    if (!files.length) return null;
    const text = files.map((f) => fs.readFileSync(path.join(asDir, f), 'utf-8')).join('\n\n');
    return { source: asDir, text, files: files.length };
  }
  return null;
}

// ---------- markdown 表格 ----------

/** 把 markdown 里的所有表格抠出来：[{header:[], rows:[[]], at:行号}] */
function mdTables(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const header = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      if (!/^\s*\|/.test(lines[j])) break;
      rows.push(cells(lines[j]));
    }
    tables.push({ header, rows, at: i });
    i = j - 1;
  }
  return tables;
}

function colIndex(header, ...words) {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].replace(/\s/g, '');
    if (words.some((w) => h.includes(w))) return i;
  }
  return -1;
}

/** 「—」「-」「无」「没有」都当「没有爽点/没有钩子」 */
function blankish(s) {
  return !s || /^(—+|-+|无|没有|暂无|none|null|n\/a)$/i.test(String(s).trim());
}

function cleanCell(s) {
  return String(s || '').trim().replace(/[（(][^）)]*[）)]$/, '').replace(/\*\*/g, '').trim();
}

function chapterNo(cell) {
  const m = String(cell || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function numberIn(cell) {
  const m = String(cell || '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ---------- 三个追踪档 ----------

/** 爽点追踪：章节 | 爽点类型 | 铺放比。没有值算「无爽点」 */
function parseSweet(text) {
  const out = new Map();
  if (!text) return out;
  for (const t of mdTables(text)) {
    const ch = colIndex(t.header, '章节', '章');
    const type = colIndex(t.header, '爽点类型', '类型');
    if (ch < 0 || type < 0) continue;
    const ratio = colIndex(t.header, '铺放比', '比例');
    for (const r of t.rows) {
      const n = chapterNo(r[ch]);
      if (!n) continue;
      const raw = cleanCell(r[type]);
      out.set(n, {
        type: blankish(raw) ? '无' : raw,
        ratio: ratio >= 0 ? cleanCell(r[ratio]) : '',
      });
    }
  }
  return out;
}

/** 钩子追踪：分「章首钩子」「章尾钩子」两张表（章节 | 类型 | 强度） */
function parseHook(text) {
  const head = new Map();
  const tail = new Map();
  if (!text) return { head, tail };
  const lines = String(text).split(/\r?\n/);
  let section = '';
  let cursor = 0;
  for (const t of mdTables(text)) {
    // 表格之前的最后一个标题决定它属于章首还是章尾
    for (let i = cursor; i <= t.at; i++) {
      const m = lines[i].match(/^#{1,6}\s*(.*)$/);
      if (m) section = m[1];
    }
    cursor = t.at + 1;
    const ch = colIndex(t.header, '章节', '章');
    const type = colIndex(t.header, '类型', '钩子');
    if (ch < 0 || type < 0) continue;
    const strength = colIndex(t.header, '强度');
    const isTail = /章尾|结尾|尾部/.test(section);
    const isHead = /章首|开头|开篇/.test(section);
    if (!isHead && !isTail) continue;
    for (const r of t.rows) {
      const n = chapterNo(r[ch]);
      if (!n) continue;
      const rec = {
        type: blankish(cleanCell(r[type])) ? '' : cleanCell(r[type]),
        strength: strength >= 0 ? cleanCell(r[strength]) : '',
      };
      (isTail ? tail : head).set(n, rec);
    }
  }
  return { head, tail };
}

/** 情绪曲线：情绪走势表取「情绪极值」列的强度；反转记录表取「情绪差」≤2 的条目 */
function parseEmotion(text) {
  const peaks = new Map();
  const weakReversals = [];
  if (!text) return { peaks, weakReversals };
  for (const t of mdTables(text)) {
    const ch = colIndex(t.header, '章节', '章');
    const peak = colIndex(t.header, '情绪极值', '极值');
    if (ch >= 0 && peak >= 0) {
      for (const r of t.rows) {
        const n = chapterNo(r[ch]);
        const v = numberIn(r[peak]);
        if (n && v !== null) peaks.set(n, v);
      }
      continue;
    }
    const diff = colIndex(t.header, '情绪差');
    if (ch >= 0 && diff >= 0) {
      for (const r of t.rows) {
        const n = chapterNo(r[ch]);
        const v = numberIn(r[diff]);
        if (n && v !== null && Math.abs(v) <= 2) weakReversals.push({ chapter: n, diff: v });
      }
    }
  }
  return { peaks, weakReversals };
}

// ---------- 细纲（计划侧） ----------

/** 章节热度：章节 | 平台热度 | 留存 | 备注（chapter-heat.js 维护的人工标注，缺档就不算什么） */
function parseHeat(text) {
  const out = new Map();
  if (!text) return out;
  for (const t of mdTables(text)) {
    const ci = colIndex(t.header, '章节', '章');
    const hi = colIndex(t.header, '平台热度', '热度');
    if (ci < 0 || hi < 0) continue;
    for (const row of t.rows) {
      const n = chapterNo(row[ci]);
      const v = numberIn(row[hi]);
      if (n === null || v === null) continue;
      out.set(n, v);
    }
  }
  return out;
}

function readDetailPlan(dir) {
  const plan = new Map();
  if (!dir) return { plan, source: null, files: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  let used = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8');
    for (const t of mdTables(text)) {
      const ch = colIndex(t.header, '章');
      const sweet = colIndex(t.header, '爽点');
      const words = colIndex(t.header, '字数');
      if (ch < 0 || sweet < 0) continue; // 蓝图出场清单等其它表跳过
      used++;
      const hookStart = colIndex(t.header, '章首钩子', '章首');
      const hookEnd = colIndex(t.header, '章尾钩子', '章尾');
      for (const r of t.rows) {
        const n = chapterNo(r[ch]);
        if (!n) continue;
        plan.set(n, {
          sweet: blankish(cleanCell(r[sweet])) ? '无' : cleanCell(r[sweet]),
          words: words >= 0 ? numberIn(r[words]) : null,
          hookStart: hookStart >= 0 ? cleanCell(r[hookStart]) : '',
          hookEnd: hookEnd >= 0 ? cleanCell(r[hookEnd]) : '',
        });
      }
    }
  }
  return { plan, source: files.length ? dir : null, files: used };
}

// ---------- 规则 ----------

/** 连续满足条件的章号段 → [{from,to}]。章号必须真的相邻，中间缺记录就算断开 */
function runStreaks(chapters, pred) {
  const streaks = [];
  let cur = null;
  for (const n of chapters) {
    if (pred(n)) {
      if (cur && n === cur.to + 1) cur.to = n;
      else {
        if (cur) streaks.push(cur);
        cur = { from: n, to: n };
      }
    } else if (cur) {
      streaks.push(cur);
      cur = null;
    }
  }
  if (cur) streaks.push(cur);
  return streaks;
}

function span(s) {
  return s.from === s.to ? `第${s.from}章` : `第${s.from}–${s.to}章`;
}

// ---------- 主流程 ----------

const chapters = scanChapters(contentDir);
if (!chapters.size) {
  const msg = `正文目录里没有正文章节（${show(contentDir)}）——还没开始写，全书体检没什么可看的`;
  if (JSON_OUT) console.log(JSON.stringify({ novel: (config.info && config.info.name) || '', chapters: 0, message: msg }, null, 2));
  else console.log(`📖 全书体检：${msg}`);
  process.exit(0);
}

const chapterNos = [...chapters.keys()].sort((a, b) => a - b);
const latest = Math.max(...chapterNos);
const wordCounts = new Map();
for (const [n, p] of chapters) wordCounts.set(n, zhCount(fs.readFileSync(p, 'utf-8')));

// 账本记着「发布那一刻」的字数：正文发布后被人改过，当前正文数就不再是当时的事实。
// 规则一律用发布时口径（读者拿到的那版），另开一张表盯「发布后改稿」。
const ledgerWords = new Map();
for (const led of gate.loadPublishLedgers(path.join(settingsDir, 'changes'))) {
  const last = led.publishes && led.publishes[led.publishes.length - 1];
  const w = last && last.metrics && Number(last.metrics.words);
  if (w > 0) ledgerWords.set(led.chapter, w);
}
const currentWords = new Map(wordCounts);
for (const [n, w] of ledgerWords) if (wordCounts.has(n)) wordCounts.set(n, w);
const postPublishEdits = [];
for (const [n, w] of ledgerWords) {
  const now = currentWords.get(n);
  if (!now) continue;
  const drift = Math.abs(now - w) / w;
  if (drift > 0.02) postPublishEdits.push({ chapter: n, published: w, current: now, percent: Math.round(drift * 100) });
}

const sweetDoc = readTrackDoc('爽点追踪');
const hookDoc = readTrackDoc('钩子追踪');
const emotionDoc = readTrackDoc('情绪曲线');
const heatDoc = readTrackDoc('章节热度');
const actual = {
  sweet: parseSweet(sweetDoc && sweetDoc.text),
  hook: parseHook(hookDoc && hookDoc.text),
  emotion: parseEmotion(emotionDoc && emotionDoc.text),
  heat: heatDoc ? parseHeat(heatDoc.text) : new Map(),
};
const detail = readDetailPlan(detailDir);

// 分节口径：有实况用实况，没有就用细纲计划（并在报告里写清数据源）
const sweetSource = actual.sweet.size ? '爽点追踪' : (detail.plan.size ? '细纲计划' : null);
const sweetByChapter = new Map();
if (actual.sweet.size) {
  for (const [n, v] of actual.sweet) sweetByChapter.set(n, v);
} else {
  for (const [n, v] of detail.plan) sweetByChapter.set(n, { type: v.sweet, ratio: '' });
}

const findings = []; // {level:'red'|'warn', rule, text}
const red = (rule, text) => findings.push({ level: 'red', rule, text });
const warn = (rule, text) => findings.push({ level: 'warn', rule, text });

// ---- 1. 爽点 ----
const sweetSeq = chapterNos.filter((n) => sweetByChapter.has(n));
const sweetChecked = sweetSeq.length;
const sweetStats = {};
if (sweetChecked) {
  const noSpot = runStreaks(sweetSeq, (n) => sweetByChapter.get(n).type === '无');
  for (const s of noSpot) {
    if (s.to - s.from + 1 >= 2) red('爽点断档', `${span(s)} 连续 ${s.to - s.from + 1} 章没有爽点（SKILL 口径：连续 2 章无爽点就要提醒）`);
  }
  // 同类型连用
  let start = sweetSeq[0];
  let typeName = sweetByChapter.get(start).type;
  let len = 1;
  for (let i = 1; i <= sweetSeq.length; i++) {
    const n = sweetSeq[i];
    const cur = n === undefined ? null : sweetByChapter.get(n).type;
    // 相邻且同类型才继续这一段；章号断了或换了类型就结算
    if (cur === typeName && cur !== '无' && n === sweetSeq[i - 1] + 1) {
      len++;
      continue;
    }
    if (typeName !== '无' && len >= 3) {
      red('爽点同质', `${span({ from: start, to: sweetSeq[i - 1] })} 连续 ${len} 章都是「${typeName}」——读者会腻，换类型`);
    }
    if (n === undefined) break;
    start = n;
    typeName = cur;
    len = 1;
  }
  // 爽点间隔（按字数累加，不是章数）
  let acc = 0;
  let lastSpot = 0;
  for (const n of chapterNos) {
    acc += wordCounts.get(n) || 0;
    const t = sweetByChapter.get(n);
    if (t && t.type !== '无') {
      if (acc > 5000 && lastSpot) warn('爽点间隔', `第${lastSpot}章到第${n}章之间写了 ${acc} 字才见下一个爽点（SKILL 口径：每 3000–5000 字必须有一个）`);
      acc = 0;
      lastSpot = n;
    }
  }
  const dist = {};
  for (const n of sweetSeq) {
    const t = sweetByChapter.get(n).type;
    dist[t] = (dist[t] || 0) + 1;
  }
  Object.assign(sweetStats, dist);
}

// ---- 2. 钩子 ----
const tailByChapter = actual.hook.tail;
const headByChapter = actual.hook.head;
const hookChecked = tailByChapter.size + headByChapter.size;
if (hookChecked) {
  const weak = (st) => /弱/.test(st || '');
  const weakTail = chapterNos.filter((n) => tailByChapter.has(n) && weak(tailByChapter.get(n).strength));
  for (const s of runStreaks(weakTail, () => true)) {
    if (s.to - s.from + 1 >= 3) red('钩子疲软', `${span(s)} 连续 ${s.to - s.from + 1} 章尾钩强度都是「弱」——读者不会点下一章`);
  }
  const missingTail = chapterNos.filter((n) => tailByChapter.has(n) && !tailByChapter.get(n).type);
  for (const n of missingTail) red('章尾无钩', `第${n}章章尾没有钩子——这一章等于没有「接着读」的理由`);
} else {
  // 只有细纲计划时，退一步看计划里的章尾钩子列
  const planned = chapterNos.filter((n) => detail.plan.has(n) && n <= latest);
  const noPlanHook = planned.filter((n) => blankish(detail.plan.get(n).hookEnd));
  if (planned.length && noPlanHook.length) {
    warn('章尾无钩（计划）', `${noPlanHook.slice(0, 5).map((n) => `第${n}章`).join('、')}${noPlanHook.length > 5 ? ` 等 ${noPlanHook.length} 章` : ''} 细纲里就没写章尾钩子`);
  }
}

// ---- 3. 情绪 ----
const peaks = actual.emotion.peaks;
if (peaks.size) {
  const flatChapters = chapterNos.filter((n) => peaks.has(n) && peaks.get(n) <= 5);
  for (const s of runStreaks(flatChapters, () => true)) {
    if (s.to - s.from + 1 >= 3) red('情绪太平', `${span(s)} 连续 ${s.to - s.from + 1} 章情绪极值 ≤5——读者会睡着`);
  }
  const hotChapters = chapterNos.filter((n) => peaks.has(n) && peaks.get(n) >= 8);
  for (const s of runStreaks(hotChapters, () => true)) {
    if (s.to - s.from + 1 >= 5) warn('情绪疲劳', `${span(s)} 连续 ${s.to - s.from + 1} 章情绪极值 ≥8——一口气绷这么久，读者会累，插一章缓的`);
  }
  for (const r of actual.emotion.weakReversals) {
    warn('反转力度不足', `第${r.chapter}章反转前后情绪差只有 ${r.diff}（≤2 撑不起反转，>2 才有落差）`);
  }
}

// ---- 4. 字数 ----
if (WORD_MIN) {
  const short = chapterNos.filter((n) => wordCounts.get(n) < WORD_MIN);
  if (short.length) {
    const shown = short.slice(0, 6).map((n) => `第${n}章`).join('、');
    red(
      '字数不足',
      `${short.length} 章短于下限 ${WORD_MIN} 字：${shown}${short.length > 6 ? ` 等 ${short.length} 章` : ''}（最短 第${short.reduce((a, b) => (wordCounts.get(a) <= wordCounts.get(b) ? a : b))}章 ${Math.min(...short.map((n) => wordCounts.get(n)))} 字）`
    );
  }
}
if (chapterNos.length >= 6) {
  const half = Math.floor(chapterNos.length / 2);
  const mean = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const early = mean(chapterNos.slice(0, half).map((n) => wordCounts.get(n)));
  const late = mean(chapterNos.slice(half).map((n) => wordCounts.get(n)));
  if (early > 0 && late < early * 0.8) {
    warn('字数滑坡', `后半程平均 ${late} 字/章，前半程 ${early} 字/章（掉 ${Math.round((1 - late / early) * 100)}%）——越写越短，通常是热情在掉`);
  }
}

// ---- 4.5 发布后改稿（账本记的字数 vs 现在正文） ----
for (const e of postPublishEdits.slice(0, 5)) {
  warn('发布后改稿', `第${e.chapter}章 发布时 ${e.published} 字，现在 ${e.current} 字（差 ${e.percent}%）——正文在发布后被改过，本章验收报告与账本记的还是旧稿`);
}
if (postPublishEdits.length > 5) warn('发布后改稿', `另有 ${postPublishEdits.length - 5} 章同样在发布后被改过，这里只列了前 5 章`);

// ---- 5. 伏笔 ----
let foreshadow = { hasTable: false, checked: 0, open: 0, overdue: 0, due: 0, byType: {}, entries: [] };
let snapshotText = null;
if (fs.existsSync(snapshotPath)) {
  snapshotText = fs.readFileSync(snapshotPath, 'utf-8');
  const rows = snapshotRows(snapshotText);
  foreshadow = { hasTable: /^##\s*伏笔状态/m.test(snapshotText), ...ledgerReport(rows, latest + 1) };
}
if (foreshadow.overdue > 0) {
  const overdueEntries = (foreshadow.entries || []).filter((e) => e.level === 'overdue');
  const detail = overdueEntries.slice(0, 2).map((e) => String(e.text).split('——')[0]).join('；');
  red(
    '伏笔逾期',
    `${foreshadow.overdue} 条到期：${detail}${overdueEntries.length > 2 ? `；另有 ${foreshadow.overdue - 2} 条见 --json` : ''}`
  );
}

// ---- 6. 角色出场频次 ----
const roleDir = path.join(settingsDir, '角色设定');
const roles = [];
if (fs.existsSync(roleDir)) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) roles.push({ name: e.name.replace(/\.md$/, ''), file: p });
    }
  };
  walk(roleDir);
}
const chapterTexts = new Map(chapterNos.map((n) => [n, fs.readFileSync(chapters.get(n), 'utf-8')]));
const roleStats = roles
  .map((r) => {
    const seen = chapterNos.filter((n) => chapterTexts.get(n).includes(r.name));
    return { name: r.name, chapters: seen.length, last: seen.length ? seen[seen.length - 1] : 0 };
  })
  .filter((r) => r.chapters > 0)
  .sort((a, b) => b.chapters - a.chapters);
for (const r of roleStats) {
  if (latest - r.last > 15) warn('角色消失', `「${r.name}」最后一次出场在第${r.last}章，已经 ${latest - r.last} 章没露面`);
}

// ---- 7. 计划 vs 实况（细纲写的爽点类型，实际写成了什么） ----
const planDrift = [];
for (const n of chapterNos) {
  const p = detail.plan.get(n);
  const a = actual.sweet.get(n);
  if (!p || !a) continue;
  if (p.sweet !== a.type) planDrift.push({ chapter: n, planned: p.sweet, actual: a.type });
}

// ---- 8. 热度（人工标注：平台后台的数，脚本只读不猜） ----
const heatByChapter = actual.heat;
const heatStats = { chapters: heatByChapter.size, mean: null, low: [], sweetMean: null, plainMean: null };
if (heatByChapter.size >= 3) {
  const vals = [...heatByChapter.values()];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  heatStats.mean = Math.round(mean);
  heatStats.low = [...heatByChapter.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([chapter, heat]) => ({ chapter, heat }));
  const half = mean * 0.5;
  const heatStreaks = runStreaks(chapterNos.filter((n) => heatByChapter.has(n)), (n) => heatByChapter.get(n) < half);
  for (const st of heatStreaks) {
    if (st.to - st.from + 1 >= 3) {
      warn('低热度连片', `${span(st)}热度都不到均值一半（均值 ${Math.round(mean)}）——这一段像是读者流失点，回看这几章的爽点和章尾钩`);
    }
  }
  const sweetVals = [];
  const plainVals = [];
  for (const [n, h] of heatByChapter) (sweetByChapter.has(n) ? sweetVals : plainVals).push(h);
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  heatStats.sweetMean = avg(sweetVals);
  heatStats.plainMean = avg(plainVals);
  if (sweetVals.length >= 2 && plainVals.length >= 2 && heatStats.sweetMean < heatStats.plainMean) {
    warn('爽点与热度', `有爽点的章平均热度 ${heatStats.sweetMean}，没爽点的章 ${heatStats.plainMean}——爽点没换来追读，可能爽得雷同或位置放错了`);
  }
}

// ---------- 结果 ----------
const hardRed = findings.filter((f) => f.level === 'red');
const softWarn = findings.filter((f) => f.level === 'warn');
const meanWords = Math.round(chapterNos.reduce((a, n) => a + wordCounts.get(n), 0) / chapterNos.length);

const result = {
  novel: (config.info && config.info.name) || '',
  range: { from: chapterNos[0], to: latest, chapters: chapterNos.length, meanWords },
  sources: {
    content: show(contentDir),
    ledger: ledgerWords.size ? `发布账本（${ledgerWords.size} 章字数取发布时口径）` : null,
    sweet: sweetSource ? `${sweetSource}（${sweetSource === '爽点追踪' ? '实况' : '计划'}，覆盖 ${sweetChecked} 章）` : null,
    hook: hookChecked ? `钩子追踪（章首 ${headByChapter.size} 章 / 章尾 ${tailByChapter.size} 章）` : null,
    emotion: peaks.size ? `情绪曲线（${peaks.size} 章）` : null,
    outline: detail.plan.size ? `细纲（${detail.files} 张细纲表 / ${detail.plan.size} 章）` : null,
    foreshadow: foreshadow.hasTable ? '状态快照（## 伏笔状态）' : null,
    heat: heatByChapter.size ? `章节热度（${heatByChapter.size} 章，人工标注）` : null,
  },
  sweet: { checked: sweetChecked, distribution: sweetStats || {} },
  foreshadow: {
    open: foreshadow.open, overdue: foreshadow.overdue, due: foreshadow.due, byType: foreshadow.byType,
  },
  roles: roleStats,
  heat: heatStats,
  postPublishEdits,
  planDrift,
  findings,
};

/** 默认只有红线才算失败；--fail-on warn 连黄条也算（给 CI 用） */
function exitCode() {
  return hardRed.length || (FAIL_ON === 'warn' && softWarn.length) ? 1 : 0;
}

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode());
}

// ---------- 文字报告 ----------
const L = [];
L.push(`📖 全书体检：${result.novel || '(未命名)'}`);
L.push(`   跨度：第${result.range.from}–${result.range.to}章（${result.range.chapters} 章，平均 ${meanWords} 字/章）`);
const src = Object.entries(result.sources).filter(([k, v]) => v && k !== 'content').map(([, v]) => v);
L.push(`   数据源：${src.length ? src.join('；') : '（只有正文，追踪档和细纲都没找到）'}`);
L.push('');

L.push('【爽点】' + (sweetChecked ? `${sweetChecked} 章有记录` : '没有爽点追踪档，也没找到细纲表'));
if (sweetChecked) {
  const dist = Object.entries(sweetStats || {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('、');
  L.push(`   类型分布：${dist}`);
}
L.push('【钩子】' + (hookChecked ? `章首 ${headByChapter.size} 章 / 章尾 ${tailByChapter.size} 章有记录` : '没有钩子追踪档'));
L.push('【情绪】' + (peaks.size ? `${peaks.size} 章有极值记录` : '没有情绪曲线档'));
L.push(`【伏笔】${foreshadow.hasTable ? `未了结 ${foreshadow.open} 条（逾期 ${foreshadow.overdue}、将到期 ${foreshadow.due}）` : '快照没有 ## 伏笔状态 表，这笔账算不了'}`);
if (roleStats.length) {
  const top = roleStats.slice(0, 5).map((r) => `${r.name} ${r.chapters} 章`).join('、');
  L.push(`【角色】出场最多：${top}`);
}
if (heatByChapter.size) {
  L.push(`【热度】${heatByChapter.size} 章有标注，均值 ${heatStats.mean}`);
  if (heatStats.low.length) L.push(`   最低：${heatStats.low.map((x) => `第${x.chapter}章 ${x.heat}`).join('、')}`);
  if (heatStats.sweetMean !== null && heatStats.plainMean !== null) {
    L.push(`   有爽点章均值 ${heatStats.sweetMean} / 无爽点章 ${heatStats.plainMean}`);
  }
}
if (planDrift.length) {
  L.push(`【计划 vs 实况】${planDrift.length} 章的爽点类型和细纲不一致：`);
  planDrift.slice(0, 5).forEach((d) => L.push(`   第${d.chapter}章 计划「${d.planned}」→ 实写「${d.actual}」`));
  if (planDrift.length > 5) L.push(`   ……另有 ${planDrift.length - 5} 章，见 --json`);
}
L.push('');

if (hardRed.length) {
  L.push(`🔴 该处理的（${hardRed.length} 条）：`);
  hardRed.forEach((f) => L.push(`   - [${f.rule}] ${f.text}`));
} else {
  L.push('✅ 跨章口径没发现硬问题（爽点/钩子/情绪/字数/伏笔都过关）');
}
if (softWarn.length) {
  L.push(`⚠️ 看着办（${softWarn.length} 条）：`);
  softWarn.forEach((f) => L.push(`   - [${f.rule}] ${f.text}`));
}
if (hardRed.length) L.push('', '   这些不阻断写作，但它们是「单章全绿、读者却弃书」的常见来源。');

const text = L.join('\n');
const briefLine = `📖 全书体检 第${result.range.from}–${result.range.to}章｜平均 ${meanWords} 字｜🔴 ${hardRed.length}｜⚠️ ${softWarn.length}${heatByChapter.size ? `｜热度均值 ${heatStats.mean}（${heatByChapter.size} 章）` : ''}`;
result.brief = briefLine;

if (DIGEST) {
  const digestPath = path.join(settingsDir, '体检日报.md');
  const now = new Date();
  const pad2 = (x) => String(x).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const head = ['# 体检日报', '', '> 每次 `book-report.js --digest` 追加一行，跨天看趋势用。', '', '| 时间 | 跨度 | 平均字数 | 🔴 | ⚠️ | 热度均值 |', '|---|---|---|---|---|---|'];
  const row = `| ${stamp} | 第${result.range.from}–${result.range.to}章 | ${meanWords} | ${hardRed.length} | ${softWarn.length} | ${heatByChapter.size ? heatStats.mean : '—'} |`;
  const old = fs.existsSync(digestPath) ? fs.readFileSync(digestPath, 'utf-8') : null;
  fs.writeFileSync(digestPath, (old ? old.replace(/\s*$/, '\n') : head.join('\n') + '\n') + row + '\n', 'utf-8');
  console.log(`🗂 日报追加一行 → ${show(digestPath)}`);
}
if (BRIEF || DIGEST) console.log(briefLine);
else console.log(text);

if (WRITE) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const header = [`# 全书体检（第${result.range.from}–${result.range.to}章）`, '', `> 生成时间：${stamp}　数据源：${src.join('、') || '仅正文'}`, ''];
  try {
    fs.writeFileSync(reportPath, header.join('\n') + text.replace(/^📖[^\n]*\n/, '') + '\n', 'utf-8');
    console.log(`\n🗂 报告已写入 ${show(reportPath)}`);
  } catch (e) {
    die(`写报告失败：${e.message}`);
  }
}

process.exit(exitCode());
