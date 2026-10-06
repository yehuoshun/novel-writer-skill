#!/usr/bin/env node
/**
 * 小说写作辅助 — 配置文件校验
 *
 * 规则唯一源头：configs/config.schema.json（JSON Schema draft-07 子集）
 * 本脚本只做两件事：
 *   1. 用内置 mini validator 校验 JSON Schema（零依赖，覆盖本项目用到的关键字）
 *   2. 跑 2 条 schema 表达不了的补充逻辑（min<=max、21 个必需分组兜底）
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
  raw = fs.readFileSync('/dev/stdin', 'utf-8');
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
  if (!ok) errs.push(`${p}: 类型错误，应为 ${schema.type.join('/')}, 实际是 ${val === null ? 'null' : typeof val}`);
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
// 2. 必需分组：语雀模式必须有全部 21 个分组（缺了运行时会炸）
//    schema.required 已报「缺失（必填）」，这里避免重复报同一 key，仅作第二道防线
const REQUIRED_GROUPS = ['characters_protagonist', 'characters_antagonist', 'characters_supporting', 'characters_deceased', 'items', 'locations', 'factions', 'foreshadowing', 'timeline', 'outline', 'dialogs', 'level_system', 'change_log', 'sweet_spot_tracking', 'hook_tracking', 'detailed_outline', 'emotion_arc', 'world_view', 'mermaid_graph', 'snapshot', 'changes'];
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

// ---- 输出 ----
if (errors.length > 0) {
  console.error(`❌ 配置校验失败（${errors.length} 处）:`);
  errors.forEach(e => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log('✅ 配置文件校验通过');
  console.log(`   JSON Schema: configs/config.schema.json`);
  process.exit(0);
}
