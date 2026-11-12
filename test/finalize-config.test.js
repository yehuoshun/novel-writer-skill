'use strict';
// finalize-config.js 单测：阶段四配置回写的字段计算 + 参数边界（此前无测试，2026-11-11 补）
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'finalize-config.js');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
const zh = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;

// 目录里第 N 章正文（含 CHANGES 块，验证计数时被剥离）
function body(n, head = '正文') {
  return `　　${head}内容。\n---CHANGES---\n- **[林墨]**：第${n}章变更\n---END CHANGES---\n`;
}

function setup({ chapters = [1, 2], info, extra = {} } = {}) {
  const dir = tmpDir('fin-');
  const book = path.join(dir, '书');
  fs.mkdirSync(book, { recursive: true });
  const chapterFiles = chapters.map((n) => `第${String(n).padStart(3, '0')}章 测试.md`);
  for (const f of chapterFiles) fs.writeFileSync(path.join(book, f), body(f));
  const cfg = {
    info: info !== undefined ? info : {
      name: '书', current_chapter: 1, written_chapters: [1], total_words: 0,
      consecutive_no_spot: 2, consecutive_same_type: 1,
      consecutive_weak_hooks: 3, consecutive_flat_emotion: 0,
    },
    save_location: 'local',
    writing: {},
    ...extra,
  };
  const cfgPath = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return { dir, book, cfgPath, chapterFiles };
}
const readCfg = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

test('正常回写：current_chapter 取最大章号、written_chapters 升序、total_words 累加（剥离 CHANGES）', () => {
  const { book, cfgPath, chapterFiles } = setup({ chapters: [3, 1, 2] }); // 乱序建
  const r = run([cfgPath, book]);
  assert.strictEqual(r.status, 0, r.stderr);
  const c = readCfg(cfgPath).info;
  assert.strictEqual(c.current_chapter, 3);
  assert.deepStrictEqual(c.written_chapters, [1, 2, 3]);
  const expect = chapterFiles.reduce((s, f) => s + zh(fs.readFileSync(path.join(book, f), 'utf-8').split('---CHANGES---')[0]), 0);
  assert.strictEqual(c.total_words, expect);
  assert.ok(expect > 0, '期望字数应大于 0');
});

test('CHANGES 块不计入 total_words（正文计数口径一致）', () => {
  const { book, cfgPath } = setup({ chapters: [1] });
  run([cfgPath, book]);
  const c = readCfg(cfgPath).info;
  const full = fs.readFileSync(path.join(book, '第001章 测试.md'), 'utf-8');
  assert.ok(c.total_words < zh(full), '含 CHANGES 的全文汉字数应大于 total_words');
});

test('排除 上传版/备份/润色版/初稿 等衍生文件', () => {
  const { book, cfgPath } = setup({ chapters: [1] });
  for (const tag of ['上传版', '备份', '润色版', '初稿']) {
    fs.writeFileSync(path.join(book, `第001章 测试${tag}.md`), body(1, '衍生'));
  }
  const r = run([cfgPath, book]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(readCfg(cfgPath).info.written_chapters, [1], '衍生文件不应被计入');
});

test('--chapter 显式覆盖（大于等于最大章号）→ current_chapter 用它，written_chapters 仍取目录全部', () => {
  const { book, cfgPath } = setup({ chapters: [1, 2] });
  const r = run([cfgPath, book, '--chapter', '5']);
  assert.strictEqual(r.status, 0, r.stderr);
  const c = readCfg(cfgPath).info;
  assert.strictEqual(c.current_chapter, 5);
  assert.deepStrictEqual(c.written_chapters, [1, 2]);
});

test('--sweet-spot/--hook-start/--hook-end/--emotion 写入 info.last_* 且带 chapter 字段', () => {
  const { book, cfgPath } = setup({ chapters: [1, 2] });
  const r = run([cfgPath, book,
    '--sweet-spot', '扮猪吃虎',
    '--hook-start', '悬念钩,强',
    '--hook-end', '危机钩,中',
    '--emotion', '危急,9']);
  assert.strictEqual(r.status, 0, r.stderr);
  const c = readCfg(cfgPath).info;
  assert.deepStrictEqual(c.last_sweet_spot, { chapter: 2, type: '扮猪吃虎' });
  assert.deepStrictEqual(c.last_hook_start, { chapter: 2, type: '悬念钩', strength: '强' });
  assert.deepStrictEqual(c.last_hook_end, { chapter: 2, type: '危机钩', strength: '中' });
  assert.deepStrictEqual(c.last_emotion_peak, { chapter: 2, emotion: '危急', intensity: 9 });
});

test('consecutive_* 计数器重置为 0（存在时才动）', () => {
  const { book, cfgPath } = setup({ chapters: [1] });
  run([cfgPath, book]);
  const c = readCfg(cfgPath).info;
  for (const k of ['consecutive_no_spot', 'consecutive_same_type', 'consecutive_weak_hooks', 'consecutive_flat_emotion']) {
    assert.strictEqual(c[k], 0, `${k} 应重置为 0`);
  }
});

test('未声明的字段不被注入（字段缺失时保持不动）', () => {
  const { book, cfgPath } = setup({ chapters: [1], info: { name: '书', current_chapter: 1 } });
  const r = run([cfgPath, book]);
  assert.strictEqual(r.status, 0, r.stderr);
  const c = readCfg(cfgPath).info;
  assert.strictEqual(c.consecutive_no_spot, undefined, '不应凭空创建 consecutive_* 字段');
});

// ---- 参数边界（2026-11-11 护栏）----
test('--chapter 缺值 → 退出码 2（不静默当成 1）', () => {
  const { book, cfgPath } = setup({ chapters: [1] });
  const r = run([cfgPath, book, '--chapter']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /缺少取值/);
});

test('--chapter 非数字 → 退出码 2', () => {
  const { book, cfgPath } = setup({ chapters: [1] });
  const r = run([cfgPath, book, '--chapter', 'abc']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /正整数/);
});

test('--chapter 小于目录最大章号 → 退出码 1（防进度回退），且不改配置', () => {
  const { book, cfgPath } = setup({ chapters: [1, 2, 3] });
  const before = fs.readFileSync(cfgPath, 'utf-8');
  const r = run([cfgPath, book, '--chapter', '2']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /写回退/);
  assert.strictEqual(fs.readFileSync(cfgPath, 'utf-8'), before, '被护栏拦下时不应写文件');
});

// ---- 用法 / 环境错误 ----
test('缺参数（少于 2 个位置参数）→ 退出码 2', () => {
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run(['only-config.json']).status, 2);
});

test('配置文件不存在 → 退出码 2', () => {
  const { book } = setup();
  assert.strictEqual(run(['/no/such/cfg.json', book]).status, 2);
});

test('小说目录不存在 → 退出码 2', () => {
  const { cfgPath } = setup();
  assert.strictEqual(run([cfgPath, '/no/such/dir']).status, 2);
});

test('配置缺 info 块 → 退出码 1', () => {
  const { book, cfgPath } = setup({ info: undefined });
  fs.writeFileSync(cfgPath, JSON.stringify({ save_location: 'local' }, null, 2));
  assert.strictEqual(run([cfgPath, book]).status, 1);
});

test('目录里没有 第NNN章*.md 正文 → 退出码 1', () => {
  const dir = tmpDir('fin-');
  const book = path.join(dir, '空书');
  fs.mkdirSync(book, { recursive: true });
  const cfgPath = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ info: { name: '书' } }, null, 2));
  const r = run([cfgPath, book]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /没有/);
});
