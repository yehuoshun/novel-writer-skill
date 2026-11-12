'use strict';
/**
 * 门禁闸门公共库（结构化门禁报告 + 内容指纹 + 自检）
 *
 * 定位：SKILL 的 12 门禁此前是「AI 按文档自查 + 文本报告」，脚本这一侧只有各单项脚本的退出码。
 *       本库把它们汇成一个**机器可校验的产物**：一份绑定正文指纹的 gate-report JSON，
 *       谁跑的、跑在哪个版本的规则上、每一项的结论与证据、是否阻断，全部落数据而不落自然语言。
 *
 * 三件事（对应「候选稿不可变 / 审批绑内容指纹 / 幂等写入」的机械化）：
 *   1. contentFingerprint：正文（---CHANGES--- 之前）规范化后的 sha256。报告与草稿一一绑定，
 *      草稿改了而报告没重跑 → 指纹不符 → 拒绝发布（防「拿旧报告放新稿」）。
 *   2. verifyReport()：报告自检。12 项必须齐全、结论必须是枚举值、AI 侧结论必须带证据、
 *      summary 计数必须与明细自洽、integrity 必须能重算（防手改 JSON 蒙混）。
 *   3. runRules()：规则侧门禁统一执行（复用各脚本退出码，不重写规则），缺输入时显式 skip，
 *      **绝不把「没跑」记成「通过」**。
 *
 * 退出码约定沿用各单脚本：0=通过 / 1=有阻断 / 2=输入错误。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 1;
// 规则版本：门禁口径变更时递增，报告带上它才能判断「这份报告是按哪版规则出的」
const RULE_VERSION = '2026-11-12.2';
// AI 侧结论的证据最短字数（「通过了」四个字不算证据）
const MIN_EVIDENCE = 6;
// 证据里必须出现的一段可复核引文的最短字数：AI 说得再像，也得到正文里找得到原文
const MIN_QUOTE = 8;

const VERDICTS = ['pass', 'warn', 'fail', 'skip'];
const SOURCES = ['rule', 'ai', 'mixed'];

// 12 门禁（顺序即报告顺序；key 稳定，作为账本/AI 声明文件的契约）
const GATES = [
  { key: 'gate1_text_health', label: 'Gate 1 文本健康', aiRequired: false },
  { key: 'gate2_ai_syntax', label: 'Gate 2 AI 句式', aiRequired: true },
  { key: 'gate3_psych_external', label: 'Gate 3 心理外化', aiRequired: true },
  { key: 'gate4_rhythm', label: 'Gate 4 节奏', aiRequired: true },
  { key: 'gate5_dialogue', label: 'Gate 5 对话', aiRequired: true },
  { key: 'gate6_ending', label: 'Gate 6 结尾钩子', aiRequired: true },
  { key: 'ref_check', label: '引用校验', aiRequired: false },
  { key: 'state_consistency', label: '一致性校验', aiRequired: false },
  { key: 'description_consistency', label: '描写一致性', aiRequired: false },
  { key: 'unknown_entity', label: '未知实体检测', aiRequired: false },
  { key: 'blueprint_appearance', label: '蓝图出场合规', aiRequired: false },
  { key: 'foreshadow_closure', label: '伏笔闭环校验', aiRequired: false },
];

// check-consistency.js 的问题标签 → 门禁 key（标签去掉「·…」后缀后比对）
const TAG_TO_GATE = {
  引用校验: 'ref_check',
  一致性: 'state_consistency',
  描写一致性: 'description_consistency',
  未知实体候选: 'unknown_entity',
  蓝图出场合规: 'blueprint_appearance',
  伏笔闭环: 'foreshadow_closure',
};
const CONSISTENCY_KEYS = [
  'ref_check',
  'state_consistency',
  'description_consistency',
  'unknown_entity',
  'blueprint_appearance',
  'foreshadow_closure',
];

// scan-ai-tells.js 的 Gate N 前缀 → 门禁 key
const AI_TELL_KEYS = {
  2: 'gate2_ai_syntax',
  3: 'gate3_psych_external',
  4: 'gate4_rhythm',
  5: 'gate5_dialogue',
  6: 'gate6_ending',
};

const SEVERITY = { pass: 0, warn: 1, skip: 1, fail: 2 };

/** 取更重的结论（同一门禁多处命中时用） */
function worst(a, b) {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function normalizeNewlines(s) {
  return String(s).replace(/\r\n?/g, '\n');
}

/** 正文 = ---CHANGES--- 之前的部分（协议块不参与正文指纹，改 CHANGES 不等于改正文） */
function bodyOf(text) {
  return normalizeNewlines(text).split('---CHANGES---')[0];
}

/** 正文指纹：换行归一 + 去尾部空白后哈希（同一稿不同保存方式指纹一致） */
function contentFingerprint(text) {
  return 'sha256:' + sha256(bodyOf(text).replace(/[ \t]+$/gm, '').trimEnd());
}

/** 文档指纹：换行归一 + 去行尾空白 + 去尾部空白后哈希（状态快照这类无 CHANGES 块的文档用） */
function fileFingerprint(text) {
  return 'sha256:' + sha256(normalizeNewlines(text).replace(/[ \t]+$/gm, '').replace(/\s+$/, ''));
}

/** 全稿指纹：含 CHANGES 块，仅供审计（幂等判据用 contentFingerprint） */
function draftFingerprint(text) {
  return fileFingerprint(text);
}

/** 去空白（含全角空格）：引文比对时只认字，不认排版 */
function stripSpace(s) {
  return String(s).replace(/[\s\u3000]+/g, '');
}

/** 抽出证据里的引文片段（「…」『…』“…”"…" 四种写法都认） */
function quotedSpans(evidence) {
  const spans = [];
  const re = /「([^」]+)」|『([^』]+)』|“([^”]+)”|"([^"]+)"/g;
  let m;
  while ((m = re.exec(String(evidence || ''))) !== null) {
    const span = m[1] || m[2] || m[3] || m[4] || '';
    if (span) spans.push(span);
  }
  return spans;
}

/**
 * 证据是否「有出处」：至少一段引文（去空白后 ≥ MIN_QUOTE 字）能在正文里原样找到。
 * 这是防「AI 没读正文就写一句很像的话」的唯一机械手段——长引文可以搜，空话搜不到。
 * @returns {string|null} 命中的引文，未命中返回 null
 */
function groundedQuote(evidence, bodyText) {
  const body = stripSpace(bodyOf(String(bodyText || '')));
  if (!body) return null;
  for (const span of quotedSpans(evidence)) {
    const needle = stripSpace(span);
    if (needle.length >= MIN_QUOTE && body.includes(needle)) return span;
  }
  return null;
}

// AI 声明骨架里每项该看什么（写给驱动 skill 的 agent 看，不参与校验）
const AI_HINTS = {
  gate2_ai_syntax: '找序数枚举（首先/其次/最后）、总结腔（总之/可见/由此可见）、时代套话（尘埃落定/波澜壮阔）',
  gate3_psych_external: '看情绪是「直接命名」（他感到害怕）还是「动作外化」（手抖了一下，捏紧了袖口）',
  gate4_rhythm: '看段落长度：段段等厚、超长段、一味短促，都记 warn 并指出段落序号',
  gate5_dialogue: '看对话密度、有无连续四轮纯对话、对话之间有没有动作与停顿',
  gate6_ending: '看章尾落在「钩子 / 悬念 / 动作」还是「总结 / 抒情 / 宣言」',
};

/**
 * 生成 AI 侧声明骨架：本稿指纹 + 5 个语义门禁空槽（指纹由脚本算，省得手抄出错）。
 * @param {object} o { chapter, draftText }
 * @returns {object} 可直接落盘的声明模板
 */
function aiDeclarationTemplate(o) {
  const opts = o || {};
  const gates = {};
  for (const def of GATES.filter((g) => g.aiRequired)) {
    gates[def.key] = { verdict: '', evidence: '', hint: AI_HINTS[def.key] || '' };
  }
  return {
    chapter: opts.chapter === undefined || opts.chapter === null ? null : opts.chapter,
    contentFingerprint: contentFingerprint(opts.draftText || ''),
    gates,
  };
}

/** 稳定序列化（对象键排序），用于 integrity 计算与比对 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** 报告完整性哈希：去掉 integrity 字段后重算，手改任何一项都会对不上 */
function reportIntegrity(report) {
  const clone = Object.assign({}, report);
  delete clone.integrity;
  return 'sha256:' + sha256(stableStringify(clone));
}

function readJsonIfExists(p) {
  if (!p || !fs.existsSync(p)) return null;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch (e) {
    throw new Error(`读不到 JSON 文件 ${p}: ${e.message}`);
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON 解析失败 ${p}: ${e.message}`);
  }
}

/** 原子写：先写同目录临时文件再 rename（中途崩也算要么旧要么新，不留半截文件） */
function writeFileAtomic(target, content) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* 清理失败不掩盖原错误 */ }
    throw e;
  }
}

function writeJsonAtomic(target, value) {
  writeFileAtomic(target, JSON.stringify(value, null, 2) + '\n');
}

/** 跑 scripts/ 下的既有门禁脚本，按退出码判定（不重写规则，口径只有一处） */
function runScript(scriptName, args) {
  const script = path.join(__dirname, '..', scriptName);
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: String(stdout || ''), stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || ''),
    };
  }
}

/** 解析「  [标签] 正文」形式的问题行；level 由输出通道决定（stderr=阻断，stdout=警告） */
function parseTagged(output, level) {
  const out = [];
  for (const line of String(output || '').split('\n')) {
    const m = line.match(/^\s{2}\[([^\]]+)\]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push({ level, tag: m[1], text: m[2] });
  }
  return out;
}

function parseBullets(output, level) {
  const out = [];
  for (const line of String(output || '').split('\n')) {
    const t = line.replace(/\s+$/, '');
    if (!/^\s{2}\S/.test(t)) continue;
    out.push({ level, text: t.trim() });
  }
  return out;
}

function newGateResults() {
  const map = new Map();
  for (const g of GATES) {
    map.set(g.key, { key: g.key, label: g.label, source: 'rule', verdict: 'pass', items: [] });
  }
  return map;
}

/**
 * 规则侧门禁执行。
 * @param {object} o
 * @param {string} o.draftPath     草稿文件（正文 + CHANGES）
 * @param {string} [o.configPath]  配置（给了才做字数门禁）
 * @param {string} [o.snapshotPath] 状态快照（上一章落地后、本章回写前）
 * @param {string} [o.settingsDir]  设定目录
 * @param {string} [o.outlinePath]  细纲（给了才做蓝图出场合规）
 * @returns {{gates: object[], checks: object[]}}
 */
function runRules(o) {
  const draftPath = o.draftPath;
  const gates = newGateResults();
  const checks = [];
  const bump = (key, verdict, text) => {
    const g = gates.get(key);
    if (!g) return;
    g.verdict = worst(g.verdict, verdict);
    if (text) g.items.push({ level: verdict, text });
  };

  const text = fs.readFileSync(draftPath, 'utf-8');

  // ---- 协议块：正文与 CHANGES 必须同稿（changes-protocol.md）----
  const hasChanges = /---CHANGES---/.test(text) && /---END CHANGES---/.test(text);
  checks.push({
    key: 'changes_block',
    label: 'CHANGES 协议块',
    verdict: hasChanges ? 'pass' : 'fail',
    items: hasChanges
      ? []
      : [{ level: 'fail', text: '缺 ---CHANGES--- / ---END CHANGES--- 协议块——正文与变更声明必须同稿提交' }],
  });

  // ---- Gate 1 文本健康（硬伤：半角标点 / 引号不成对 / 字数不足 / 破折号超限）----
  const th = runScript('scan-text-health.js', o.configPath ? [draftPath, o.configPath] : [draftPath]);
  const thLines = th.stdout.split('\n').map((l) => l.replace(/\s+$/, ''));
  if (th.code === 0) {
    // 提示类（句长分布/认知句/样本不足…）只作 note 记录，不把门禁结论抬成 warn——
    // 否则 Gate 1 永远 warn，真硬伤（旧口径的 exit 1）就淹在噪声里了
    const g1 = gates.get('gate1_text_health');
    for (const l of thLines.filter((l) => /🟡/.test(l)).slice(0, 10)) {
      g1.items.push({ level: 'note', text: l.replace(/^\s*🟡\s*/, '').trim() });
    }
  } else if (th.code === 2) {
    bump('gate1_text_health', 'fail', `文本健康脚本输入错误：${(th.stderr || th.stdout).trim().slice(0, 200)}`);
  } else {
    const idx = thLines.findIndex((l) => /硬伤/.test(l));
    const items = idx >= 0 ? thLines.slice(idx + 1).filter((l) => l.trim()) : [];
    if (!items.length) items.push('文本健康检测有硬伤（详见 scan-text-health.js 输出）');
    for (const it of items.slice(0, 20)) bump('gate1_text_health', 'fail', it.trim());
  }

  // ---- Gate 2–6 的可规则化子集（命中只算警告，语义终判仍归 AI 侧）----
  const at = runScript('scan-ai-tells.js', [draftPath]);
  if (at.code === 0) {
    for (const line of at.stdout.split('\n')) {
      const m = line.match(/🟡\s*Gate\s*([2-6])\s*(.*)$/);
      if (!m) continue;
      bump(AI_TELL_KEYS[m[1]], 'warn', `Gate ${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim());
    }
  } else {
    checks.push({
      key: 'ai_tells_scan',
      label: 'AI 味扫描',
      verdict: 'fail',
      items: [{ level: 'fail', text: `scan-ai-tells.js 执行失败（exit ${at.code}）：${(at.stderr || at.stdout).trim().slice(0, 200)}` }],
    });
  }

  // ---- 一致性族 6 门禁（引用 / 一致性 / 描写一致性 / 未知实体 / 蓝图 / 伏笔闭环）----
  const snapOk = !!o.snapshotPath && fs.existsSync(o.snapshotPath);
  const setOk = !!o.settingsDir && fs.existsSync(o.settingsDir) && fs.statSync(o.settingsDir).isDirectory();
  if (!snapOk || !setOk) {
    const reason = `缺${!snapOk ? '状态快照' : ''}${!snapOk && !setOk ? '、' : ''}${!setOk ? '设定目录' : ''}——一致性族 6 门禁未执行（skip 不是通过）`;
    for (const k of CONSISTENCY_KEYS) {
      const g = gates.get(k);
      g.verdict = 'skip';
      g.reason = reason;
    }
    checks.push({ key: 'consistency_inputs', label: '一致性输入', verdict: 'skip', items: [{ level: 'skip', text: reason }] });
  } else {
    const args = [o.snapshotPath, draftPath, o.settingsDir];
    if (o.outlinePath) args.push(o.outlinePath);
    const cc = runScript('check-consistency.js', args);
    const fails = parseTagged(cc.stderr, 'fail');
    const warns = parseTagged(cc.stdout, 'warn');
    let attributed = 0;
    for (const it of [...fails, ...warns]) {
      const tagBase = it.tag.replace(/·.*$/, '');
      const key = TAG_TO_GATE[tagBase];
      if (key) {
        attributed++;
        bump(key, it.level, `[${it.tag}] ${it.text}`);
      } else if (tagBase === '交接包') {
        checks.push({ key: 'handoff', label: '交接包必填', verdict: it.level, items: [{ level: it.level, text: it.text }] });
      } else {
        checks.push({ key: `consistency_${tagBase}`, label: tagBase, verdict: it.level, items: [{ level: it.level, text: it.text }] });
      }
    }
    if (cc.code === 2) {
      const reason = `一致性脚本输入错误：${(cc.stderr || cc.stdout).trim().slice(0, 200)}`;
      for (const k of CONSISTENCY_KEYS) if (gates.get(k).verdict === 'pass') bump(k, 'fail', reason);
    } else if (cc.code === 1 && attributed === 0) {
      // 脚本判阻断但输出没带标签 → 不能让它落到「通过」，挂到一致性校验上兜底
      bump('state_consistency', 'fail', `一致性门禁不通过（脚本输出未带标签）：${(cc.stderr || cc.stdout).trim().slice(0, 300)}`);
    }
  }

  // ---- 段首缩进（语雀渲染门禁，独立于 12 门禁但同样硬拦）----
  const ind = runScript('check-indentation.js', [draftPath]);
  checks.push({
    key: 'indentation',
    label: '段首缩进',
    verdict: ind.code === 0 ? 'pass' : 'fail',
    items: ind.code === 0
      ? []
      : (parseBullets(ind.stdout, 'fail').length
        ? parseBullets(ind.stdout, 'fail').slice(0, 20)
        : [{ level: 'fail', text: (ind.stderr || ind.stdout).trim().slice(0, 300) || '缩进检查未通过' }]),
  });

  // ---- 快照自身冲突（回写后用；此处作为发布前体检，缺输入则 skip）----
  if (snapOk && setOk) {
    const cf = runScript('check-conflicts.js', [o.snapshotPath, o.settingsDir]);
    if (cf.code === 0) {
      const warns = parseBullets(cf.stdout, 'warn').filter((x) => !/^⚠️/.test(x.text));
      checks.push({ key: 'conflicts', label: '快照冲突检测', verdict: warns.length ? 'warn' : 'pass', items: warns.slice(0, 20) });
    } else {
      const items = parseBullets(cf.stderr, 'fail').filter((x) => !/^❌/.test(x.text));
      checks.push({
        key: 'conflicts',
        label: '快照冲突检测',
        verdict: 'fail',
        items: items.length ? items.slice(0, 20) : [{ level: 'fail', text: (cf.stderr || cf.stdout).trim().slice(0, 300) || '冲突检测未通过' }],
      });
    }
  } else {
    checks.push({ key: 'conflicts', label: '快照冲突检测', verdict: 'skip', items: [{ level: 'skip', text: '缺快照/设定目录，未执行快照冲突检测' }] });
  }

  return { gates: [...gates.values()], checks };
}

/**
 * 合并 AI 侧门禁声明（语义终判 + 证据）。
 * @param {object[]} gates runRules 的门禁数组（会被就地合并）
 * @param {object|null} aiDecl AI 声明：{ contentFingerprint, gates: { <key>: { verdict, evidence } } }
 * @param {object} [opts] { contentFp, allowMissingAi }
 * @returns {{blockReasons: string[], aiOmitted: boolean}}
 */
function mergeAiDeclarations(gates, aiDecl, opts) {
  const o = opts || {};
  const blockReasons = [];
  const byKey = new Map(gates.map((g) => [g.key, g]));
  const declared = (aiDecl && aiDecl.gates) || null;
  // 合并前快照规则侧结论：用来判断这条门禁的结论到底是谁给的（rule / ai / 双方都有）
  const ruleSide = new Map(gates.map((g) => [g.key, { verdict: g.verdict, items: g.items.length }]));

  // 缺声明：要求的 5 项语义门禁一律记 skip 并阻断（skip 不是 pass）
  if (!declared) {
    const required = GATES.filter((g) => g.aiRequired).map((g) => g.key);
    for (const key of required) {
      const g = byKey.get(key);
      if (!g) continue;
      g.verdict = 'skip';
      g.reason = '缺 AI 侧门禁声明（--ai-gates）——语义判断不能由规则扫描代替';
    }
    if (o.allowMissingAi) {
      return { blockReasons: [], aiOmitted: true };
    }
    blockReasons.push('缺 AI 侧门禁声明（--ai-gates）：Gate 2–6 语义结论必须逐项带证据，规则扫描不能代替');
    return { blockReasons, aiOmitted: true };
  }

  if (aiDecl.contentFingerprint !== o.contentFp) {
    blockReasons.push(
      `AI 门禁声明的内容指纹与本稿不符（声明 ${aiDecl.contentFingerprint || '缺'} / 本稿 ${o.contentFp}）——声明属于旧稿，须按当前草稿重跑`
    );
  }

  // 证据出处要靠正文来复核；没正文这道检查就成了摆设，宁可当场报错
  const bodyText = typeof o.bodyText === 'string' ? o.bodyText : '';
  if (!bodyText) {
    blockReasons.push('内部错误：合并 AI 声明时未传入正文，无法复核证据出处（调用方须传 opts.bodyText）');
  }

  for (const [key, decl] of Object.entries(declared)) {
    const g = byKey.get(key);
    if (!g) {
      blockReasons.push(`AI 门禁声明里有未知门禁 key「${key}」（合法 key 见 scripts/lib/gate-suite.js GATES）`);
      continue;
    }
    const verdict = decl && decl.verdict;
    if (!VERDICTS.includes(verdict)) {
      blockReasons.push(`「${g.label}」AI 结论非法（${JSON.stringify(verdict)}，应为 ${VERDICTS.join('/')}）`);
      continue;
    }
    const evidence = typeof decl.evidence === 'string' ? decl.evidence.trim() : '';
    if (evidence.length < MIN_EVIDENCE) {
      const what = verdict === 'skip' ? '理由' : '证据';
      blockReasons.push(`「${g.label}」AI 结论无${what}（${JSON.stringify(evidence)}）：必须给出依据（≥${MIN_EVIDENCE} 字）`);
      continue;
    }
    // 证据必须有出处：pass/warn/fail 要引一段正文原文，skip 只解释为什么不适用（本章无对话这类）
    if (verdict !== 'skip' && bodyText && !groundedQuote(evidence, bodyText)) {
      const quotes = quotedSpans(evidence).map((s) => `「${s}」`);
      blockReasons.push(
        quotes.length
          ? `「${g.label}」AI 证据的引文在正文里找不到（${quotes.join('、')}）：引文必须原样来自本稿正文，去空白后每段 ≥${MIN_QUOTE} 字`
          : `「${g.label}」AI 证据没有引文（${JSON.stringify(evidence)}）：自报「${verdict}」必须用「」引一段 ≥${MIN_QUOTE} 字的正文原文，空话不算证据`
      );
      continue;
    }
    g.verdict = g.verdict === 'skip' ? worst('pass', verdict) : worst(g.verdict, verdict);
    const before = ruleSide.get(key) || { verdict: 'pass', items: 0 };
    g.source = (before.verdict !== 'pass' || before.items > 0) ? 'mixed' : 'ai';
    g.evidence = evidence;
    if (evidence) g.items.push({ level: verdict, text: `AI 侧：${evidence}` });
  }

  // 要求的语义门禁若仍无 AI 结论 → 阻断
  for (const def of GATES.filter((x) => x.aiRequired)) {
    const g = byKey.get(def.key);
    if (!g) continue;
    const hasAi = declared[def.key] && VERDICTS.includes(declared[def.key].verdict);
    if (!hasAi) {
      if (o.allowMissingAi) continue;
      blockReasons.push(`「${def.label}」缺 AI 侧结论（语义门禁必须逐项交代，不能靠规则扫描默认通过）`);
    }
  }

  return { blockReasons, aiOmitted: false };
}

/**
 * 组装报告（含 summary / blocked / integrity）。
 * @param {object} o { novel, chapter, draftText, gates, checks, blockReasons }
 * @returns {object} 可直接落盘的报告
 */
function buildReport(o) {
  const gates = o.gates;
  const checks = o.checks || [];
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const g of gates) summary[g.verdict] = (summary[g.verdict] || 0) + 1;

  const blockReasons = [...(o.blockReasons || [])];
  for (const g of gates) {
    if (g.verdict === 'fail') {
      const first = g.items.find((i) => i.level === 'fail');
      blockReasons.push(`${g.label} 未通过${first ? '：' + first.text.slice(0, 120) : ''}`);
    }
  }
  for (const c of checks) {
    if (c.verdict === 'fail') {
      const first = c.items.find((i) => i.level === 'fail');
      blockReasons.push(`${c.label} 未通过${first ? '：' + first.text.slice(0, 120) : ''}`);
    }
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    generatedAt: new Date().toISOString(),
    novel: o.novel || '',
    chapter: typeof o.chapter === 'number' ? o.chapter : null,
    contentFingerprint: contentFingerprint(o.draftText),
    draftFingerprint: draftFingerprint(o.draftText),
    gates,
    checks,
    summary,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
  // 附加标记（aiOmitted / gatesSkipped）必须在算 integrity 之前并入，
  // 否则「生成后补字段」会让自家报告过不了自家自检
  if (o.extra && typeof o.extra === 'object') {
    for (const [k, v] of Object.entries(o.extra)) {
      if (k === 'integrity' || k === 'gates' || k === 'summary' || k === 'blocked') continue;
      report[k] = v;
    }
  }
  report.integrity = reportIntegrity(report);
  return report;
}

/**
 * 报告自检：结构、枚举、证据、计数、integrity、指纹。
 * @param {object} report 报告对象
 * @param {object} [opts] { draftText } 给了就校验正文指纹
 * @returns {{ok: boolean, problems: string[]}}
 */
function verifyReport(report, opts) {
  const o = opts || {};
  const problems = [];
  if (!report || typeof report !== 'object') return { ok: false, problems: ['报告不是对象'] };

  if (report.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion 应为 ${SCHEMA_VERSION}，实际 ${report.schemaVersion}`);
  if (!report.ruleVersion) problems.push('缺 ruleVersion（无法判断按哪版门禁口径出的报告）');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(report.contentFingerprint))) problems.push('contentFingerprint 格式非法');

  const gates = Array.isArray(report.gates) ? report.gates : [];
  const wantKeys = GATES.map((g) => g.key);
  const gotKeys = gates.map((g) => g && g.key);
  if (gates.length !== GATES.length) problems.push(`门禁项应 ${GATES.length} 项，实际 ${gates.length} 项`);
  for (const k of wantKeys) if (!gotKeys.includes(k)) problems.push(`缺门禁项 ${k}`);
  for (const k of gotKeys) if (!wantKeys.includes(k)) problems.push(`多出未知门禁项 ${k}`);

  for (const g of gates) {
    if (!g) continue;
    if (!VERDICTS.includes(g.verdict)) problems.push(`${g.key} 结论非法：${g.verdict}`);
    if (!SOURCES.includes(g.source)) problems.push(`${g.key} source 非法：${g.source}`);
    if ((g.source === 'ai' || g.source === 'mixed') && String(g.evidence || '').trim().length < MIN_EVIDENCE) {
      problems.push(`${g.key} 标为 AI 结论但无证据（≥${MIN_EVIDENCE} 字）`);
    }
  }

  const recount = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const g of gates) if (g && VERDICTS.includes(g.verdict)) recount[g.verdict]++;
  for (const k of Object.keys(recount)) {
    const got = (report.summary || {})[k];
    if (got !== recount[k]) problems.push(`summary.${k} 与明细不符（${got} vs ${recount[k]}）`);
  }

  const hasFail = gates.some((g) => g && g.verdict === 'fail')
    || (report.checks || []).some((c) => c && c.verdict === 'fail');
  const reasons = Array.isArray(report.blockReasons) ? report.blockReasons : [];
  if (report.blocked !== (hasFail || reasons.length > 0)) {
    problems.push(`blocked(${report.blocked}) 与门禁明细/阻断原因不一致（fail 或阻断原因存在时应为 true）`);
  }

  if (!/^sha256:[0-9a-f]{64}$/.test(String(report.integrity))) {
    problems.push('缺 integrity（报告可能被手改或未由 gate-suite 生成）');
  } else if (report.integrity !== reportIntegrity(report)) {
    problems.push('integrity 校验失败——报告内容被改动过，须重新生成');
  }

  if (o.draftText !== undefined && report.contentFingerprint !== contentFingerprint(o.draftText)) {
    problems.push('contentFingerprint 与所给草稿不符——报告不是这份稿的');
  }

  return { ok: problems.length === 0, problems };
}

// ---- 账本与快照回写（「发布之后 CHANGES 到底有没有落到 状态快照.md」）----

const LEDGER_NAME_RE = /^ch(\d+)-publish\.json$/;

/** 读 changes 目录下所有分章账本 → [{chapter, publishes, file}]，按章号升序 */
function loadPublishLedgers(changesDir) {
  const out = [];
  if (!changesDir || !fs.existsSync(changesDir)) return out;
  for (const name of fs.readdirSync(changesDir)) {
    const m = name.match(LEDGER_NAME_RE);
    if (!m) continue;
    const file = path.join(changesDir, name);
    let publishes = [];
    try {
      const raw = readJsonIfExists(file);
      if (raw && Array.isArray(raw.publishes)) publishes = raw.publishes;
      out.push({ chapter: Number(m[1]), publishes, file });
    } catch (e) {
      // 账本坏了不能装作没有：留一条带 error 的空记录，让审计看得见
      out.push({ chapter: Number(m[1]), publishes: [], file, error: e.message });
    }
  }
  return out.sort((a, b) => a.chapter - b.chapter);
}

/** 账本里「章号小于本章」的最近一次发布 → {chapter, record} | null */
function previousPublish(ledgers, chapter) {
  let prev = null;
  for (const l of ledgers) {
    if (l.chapter >= chapter || !l.publishes.length) continue;
    prev = { chapter: l.chapter, record: l.publishes[l.publishes.length - 1] };
  }
  return prev;
}

/**
 * 快照回写判定：上一章发布时记下的快照指纹若与当前快照指纹相同，说明这一章发布后
 * 状态快照.md 一个字没改——CHANGES 没回写，一致性 6 门禁整族在拿旧事实比对，
 * 而且会「全过」。这是闸门里最后一处静默失效，靠指纹比对就能抓（纯函数，不做 IO）。
 * @returns {{verdict:'pass'|'fail'|'skip', reason:string, previousChapter?:number}}
 */
function snapshotFreshness({ currentFp, previousChapter, previousFp }) {
  if (!currentFp) {
    return { verdict: 'skip', reason: '没有状态快照文件，无法判定回写（一致性 6 门禁同样 skip）' };
  }
  if (!previousChapter) {
    return { verdict: 'skip', reason: '账本里没有更早的发布记录，无从比较' };
  }
  if (!previousFp) {
    return { verdict: 'skip', reason: `第${previousChapter}章的账本没记快照指纹（旧版账本），无法判定回写` };
  }
  if (currentFp === previousFp) {
    return {
      verdict: 'fail',
      previousChapter,
      reason:
        `第${previousChapter}章发布后 状态快照.md 未被改动（指纹仍是 ${String(currentFp).slice(0, 15)}…）——` +
        `CHANGES 没回写，一致性 6 门禁在比对旧事实。先按第${previousChapter}章 CHANGES 更新快照；` +
        `确认无需回写时加 --allow-stale-snapshot（账本会记 staleSnapshot=true）`,
    };
  }
  return { verdict: 'pass', previousChapter, reason: `状态快照在第${previousChapter}章发布后已更新` };
}

module.exports = {
  SCHEMA_VERSION,
  RULE_VERSION,
  MIN_EVIDENCE,
  MIN_QUOTE,
  VERDICTS,
  SOURCES,
  GATES,
  CONSISTENCY_KEYS,
  TAG_TO_GATE,
  sha256,
  normalizeNewlines,
  bodyOf,
  contentFingerprint,
  draftFingerprint,
  fileFingerprint,
  loadPublishLedgers,
  previousPublish,
  snapshotFreshness,
  stripSpace,
  quotedSpans,
  groundedQuote,
  AI_HINTS,
  aiDeclarationTemplate,
  stableStringify,
  reportIntegrity,
  readJsonIfExists,
  writeFileAtomic,
  writeJsonAtomic,
  runScript,
  runRules,
  mergeAiDeclarations,
  buildReport,
  verifyReport,
};
