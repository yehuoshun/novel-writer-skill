#!/usr/bin/env node
/**
 * 小说写作辅助 — 配置文件校验
 *
 * 用法:
 *   node validate-config.js < config.json
 *   node validate-config.js /path/to/config.json
 *
 * 退出码:
 *   0 — 通过
 *   1 — 字段缺失/类型错误
 *   2 — 文件不存在/不可读
 */

const fs = require('fs');

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

// ---- 加载 ----
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

let hasError = false;
const errors = [];

function req(path, type, extra) {
  const keys = path.split('.');
  let val = cfg;
  for (const k of keys) {
    if (val == null || typeof val !== 'object') {
      errors.push(`缺失: ${path} (应为 ${type})`);
      return;
    }
    val = val[k];
  }
  if (val === undefined || val === null) {
    errors.push(`缺失: ${path} (应为 ${type})`);
    return;
  }
  if (type === 'array' && !Array.isArray(val)) {
    errors.push(`类型错误: ${path} 应为 array, 实际是 ${typeof val}`);
    return;
  }
  if (type !== 'array' && typeof val !== type) {
    errors.push(`类型错误: ${path} 应为 ${type}, 实际是 ${typeof val}`);
    return;
  }
  // extra validations
  if (extra) extra(val, path);
}

function isPositiveInt(n) { return Number.isInteger(n) && n > 0; }
function isBool(v) { return typeof v === 'boolean'; }

// ---- 校验规则 ----
const checks = [
  // info block
  () => req('info.name', 'string'),
  () => req('info.type', 'string'),
  () => req('info.status', 'string', v => {
    if (!['ongoing', 'completed', 'paused'].includes(v))
      errors.push(`非法值: info.status 应为 ongoing/completed/paused, 实际是 ${v}`);
  }),
  () => req('info.created_at', 'string'),
  () => req('info.current_chapter', 'number', v => {
    if (!isPositiveInt(v)) errors.push(`非法值: info.current_chapter 应为正整数, 实际是 ${v}`);
  }),
  () => req('info.written_chapters', 'array', v => {
    if (!v.every(x => isPositiveInt(x)))
      errors.push(`非法值: info.written_chapters 元素须为正整数`);
  }),
  () => req('info.total_words', 'number', v => {
    if (!isPositiveInt(v)) errors.push(`非法值: info.total_words 应为正整数, 实际是 ${v}`);
  }),
  () => req('info.current_volume', 'number', v => {
    if (!isPositiveInt(v)) errors.push(`非法值: info.current_volume 应为正整数`);
  }),

  // save_location
  () => req('save_location', 'string', v => {
    if (!['yuque', 'local', 'both'].includes(v))
      errors.push(`非法值: save_location 应为 yuque/local/both, 实际是 ${v}`);
  }),

  // writing block
  () => req('writing.pov', 'string'),
  () => req('writing.perspective', 'string'),
  () => req('writing.style', 'string'),
  () => req('writing.narrative_style', 'string'),
  () => req('writing.chapter_words.min', 'number'),
  () => req('writing.chapter_words.max', 'number'),
  () => req('writing.chapter_words', 'object', v => {
    if (v.min > v.max) errors.push(`逻辑错误: chapter_words.min(${v.min}) > max(${v.max})`);
  }),
];

// ---- 按 save_location 条件校验 ----
if (cfg.save_location === 'yuque' || cfg.save_location === 'both') {
  checks.push(() => req('yuque.content_book.book_id', 'string'));
  checks.push(() => req('yuque.content_book.namespace', 'string'));
  checks.push(() => req('yuque.settings_book.book_id', 'string'));
  checks.push(() => req('yuque.settings_book.namespace', 'string'));
  checks.push(() => req('yuque.groups', 'object'));
}

if (cfg.save_location === 'local' || cfg.save_location === 'both') {
  checks.push(() => req('local.content_path', 'string'));
  checks.push(() => req('local.settings_path', 'string'));
}

// ---- 执行 ----
checks.forEach(fn => fn());

// ---- 输出 ----
if (errors.length > 0) {
  errors.forEach(e => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log('✅ 配置文件校验通过');

// 提示 JSON Schema
const schemaPath = require('path').join(__dirname, '..', 'configs', 'config.schema.json');
if (fs.existsSync(schemaPath)) {
  console.log(`   JSON Schema: configs/config.schema.json`);
}
process.exit(0);
}