#!/usr/bin/env node
/**
 * 小说写作辅助 — 配置文件校验
 *
 * 规则唯一源头：configs/config.schema.json（JSON Schema draft-07 子集）
 * 本脚本只做两件事：
 *   1. 用内置 mini validator 校验 JSON Schema（零依赖，覆盖本项目用到的关键字）
 *   2. 跑 5 条 schema 表达不了的补充逻辑（min<=max、22 个必需分组兜底、book 二选一、written_chapters 语义、name 非空）
 *
 * 用法:
 *   node validate-config.js < config.json
 *   node validate-config.js /path/to/config.json
 *
 * 退出码:
 *   0 — 通过
 *   1 — 校验失败（字段缺失/类型错误/补充逻辑不过）
 *   2 — 文件不存在/不可读
 */

const fs = require('fs');
const path = require('path');

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

// ---- 加载配置 ----
let raw;
const arg = process.argv[2];
if (arg) {
  if (!fs.existsSync(arg)) die(`文件不存在: ${arg}`, 2);
  raw = fs.readFileSync(arg, 'utf-8');
} else {
  raw = fs.readFileSync(0, 'utf-8');
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch (e) {
  die(`JSON 解析失败: ${e.message}`);
}

// ---- mini JSON Schema validator（draft-07 子集）----
// 支持: type(含数组)/enum/required/properties/items/minimum/maximum/pattern/patternProperties/allOf(if-then)
// 未用到的不实现；additionalProperties 默认不限制
const errors = [];

function checkType(schema, val, p, errs) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const ok = types.some(t => {
    if (t === 'object') return val !== null && typeof val === 'object' && !Array.isArray(val);
    if (t === 'array') return Array.isArray(val);
    if (t === 'integer') return Number.isInteger(val);
    if (t === 'number') return typeof val === 'number';
    if (t === 'string') return typeof val === 'string';
    if (t === 'boolean') return typeof val === 'boolean';
    if (t === 'null') return val === null;
    return true;
  });
  if (!ok) errs.push(`${p}: 类型错误，应为 ${types.join('/')}, 实际是 ${val === null ? 'null' : typeof val}`);
}

function validate(schema, val, p = '', errs = errors) {
  if (val === undefined) return;
  if (schema.type) checkType(schema, val, p, errs);
  if (schema.enum && !schema.enum.includes(val)) {
    errs.push(`${p}: 非法值，应为 ${schema.enum.join('/')}, 实际是 ${JSON.stringify(val)}`);
  }
  if (typeof val === 'number') {
    if (schema.minimum !== undefined && val < schema.minimum) errs.push(`${p}: 最小值 ${schema.minimum}, 实际是 ${val}`);
    if (schema.maximum !== undefined && val > schema.maximum) errs.push(`${p}: 最大值 ${schema.maximum}, 实际是 ${val}`);
  }
  if (typeof val === 'string' && schema.pattern && !new RegExp(schema.pattern).test(val)) {
    errs.push(`${p}: 格式不匹配 ${schema.pattern}, 实际是 ${val}`);
  }
  if (Array.isArray(val) && schema.items) {
    val.forEach((item, i) => validate(schema.items, item, `${p}[${i}]`, errs));
  }
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    if (schema.required) {
      for (const k of schema.required) {
        if (val[k] === undefined) errs.push(`${p}${p ? '.' : ''}${k}: 缺失（必填）`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (val[k] !== undefined) validate(sub, val[k], `${p}${p ? '.' : ''}${k}`, errs);
      }
    }
    if (schema.patternProperties) {
      for (const [k, v] of Object.entries(val)) {
        for (const [pat, sub] of Object.entries(schema.patternProperties)) {
          if (new RegExp(pat).test(k)) validate(sub, v, `${p}${p ? '.' : ''}${k}`, errs);
        }
      }
    }
  }
  if (schema.allOf) {
    for (const cond of schema.allOf) {
      if (cond.if) {
        // if 命中判定用独立 probe，不污染全局错误
        const probe = [];
        validate(cond.if, val, p, probe);
        if (probe.length === 0) validate(cond.then || {}, val, p, errs);
      } else {
        validate(cond, val, p, errs);
      }
    }
  }
}

const schemaPath = path.join(__dirname, '..', 'configs', 'config.schema.json');
if (!fs.existsSync(schemaPath)) die(`schema 文件不存在: ${schemaPath}`, 2);
let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
} catch (e) {
  die(`schema 解析失败: ${e.message}`, 2);
}

// 用独立 probe 判定 allOf.if（见 validate 内部实现，不污染全局 errors）
validate(schema, cfg);

// ---- 补充逻辑（schema 表达不了的跨字段/跨结构规则）----
// 1. chapter_words.min <= max
const cw = cfg.writing && cfg.writing.chapter_words;
if (cw && typeof cw.min === 'number' && typeof cw.max === 'number' && cw.min > cw.max) {
  errors.push(`writing.chapter_words: min(${cw.min}) > max(${cw.max})`);
}
// 2. 必需分组：语雀模式必须有全部 22 个分组（21 设定组 + content 正文组，缺了运行时会炸）
//    schema.required 已报「缺失（必填）」，这里避免重复报同一 key，仅作第二道防线
const REQUIRED_GROUPS = ['content', 'characters_protagonist', 'characters_antagonist', 'characters_supporting', 'characters_deceased', 'items', 'locations', 'factions', 'foreshadowing', 'timeline', 'outline', 'dialogs', 'level_system', 'change_log', 'sweet_spot_tracking', 'hook_tracking', 'detailed_outline', 'emotion_arc', 'world_view', 'mermaid_graph', 'snapshot', 'changes'];
if (cfg.save_location === 'yuque' || cfg.save_location === 'both') {
  const g = cfg.yuque && cfg.yuque.groups;
  if (!g || typeof g !== 'object' || Array.isArray(g)) {
    errors.push('yuque.groups: 缺失或非对象（语雀模式必需）');
  } else {
    for (const k of REQUIRED_GROUPS) {
      if (!g[k]) {
        const dup = errors.some(e => e.startsWith(`yuque.groups.${k}:`));
        if (!dup) errors.push(`yuque.groups.${k}: 缺失（${REQUIRED_GROUPS.length} 个必需分组之一）`);
      }
    }
  }
}
// 3. 语雀模式 book：book_id 与 namespace 二选一（repo 标识两者均可，但至少填其一）
if (cfg.save_location === 'yuque' || cfg.save_location === 'both') {
  const b = cfg.yuque && cfg.yuque.book;
  const hasId = !!(b && b.book_id && String(b.book_id).trim());
  const hasNs = !!(b && b.namespace && String(b.namespace).trim());
  if (!hasId && !hasNs) {
    errors.push('yuque.book: book_id 与 namespace 至少填其一（语雀 repo 标识二选一）');
  }
}
// 4. written_chapters 语义：无重复 + current_chapter 不落后于已写列表
const wc = cfg.info && cfg.info.written_chapters;
if (Array.isArray(wc) && wc.length > 0) {
  const uniq = new Set(wc);
  if (uniq.size !== wc.length) {
    errors.push(`info.written_chapters: 存在重复章节号（${wc.length} 项去重后 ${uniq.size} 项）`);
  }
  const maxW = Math.max(...wc);
  if (typeof cfg.info.current_chapter === 'number' && cfg.info.current_chapter < maxW) {
    errors.push(`info.current_chapter(${cfg.info.current_chapter}) < written_chapters 最大值(${maxW})：当前章号落后于已写列表`);
  }
}

// 5. info.name 非空（schema 的 type:string 挡不住空串，mini validator 不支持 minLength）
const n = cfg.info && cfg.info.name;
if (!n || !String(n).trim()) {
  errors.push('info.name: 小说名不能为空');
}

// 6. local/both 模式：local.content_path + settings_path 必填非空（schema 未约束子字段，
//    both 模式 local:{} 空块会放行，运行时读 path 炸 —— v3.3.43 实弹暴露）
if (cfg.save_location === 'local' || cfg.save_location === 'both') {
  const l = cfg.local;
  if (!l || typeof l !== 'object' || Array.isArray(l)) {
    errors.push('local: 缺失或非对象（local/both 模式必需，且 content_path/settings_path 必填）');
  } else {
    for (const k of ['content_path', 'settings_path']) {
      if (!l[k] || !String(l[k]).trim()) {
        errors.push(`local.${k}: 缺失（local/both 模式必需，统一格式 ./小说名/正文）`);
      }
    }
  }
}

// 7. backup.mode=local 时 local_path 必填非空（schema 的 required 只挡 undefined，
//    null/空串会漏 —— v3.3.44 实弹暴露）
if (cfg.backup && cfg.backup.mode === 'local') {
  const lp = cfg.backup.local_path;
  if (!lp || !String(lp).trim()) {
    errors.push('backup.local_path: 缺失或为空（backup.mode=local 时需要非空路径）');
  }
}

// ---- 输出 ----
if (errors.length > 0) {
  // 全局去重：同一错误可能被顶层 properties 与 allOf 多约束叠加重复报告，输出前收敛为一条
  const uniq = [...new Set(errors)];
  console.error(`❌ 配置校验失败（${uniq.length} 处）:`);
  uniq.forEach(e => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log('✅ 配置文件校验通过');
  console.log(`   JSON Schema: configs/config.schema.json`);
  process.exit(0);
}
