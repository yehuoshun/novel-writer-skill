'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'validate-config.js');
const ROOT = path.join(__dirname, '..');

const runFile = (p) => spawnSync(process.execPath, [SCRIPT, p], { encoding: 'utf-8' });
const runStdin = (obj) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(obj), encoding: 'utf-8' });

const BASE = {
  info: {
    name: '测试', type: '玄幻', status: 'ongoing', created_at: '2026-01-01',
    current_chapter: 3, written_chapters: [1, 2, 3], total_words: 9000, current_volume: 1,
  },
  save_location: 'local',
  local: { content_path: './x/正文', settings_path: './x/设定' },
  writing: {
    pov: 'third-person', perspective: 'single', style: 'classical', narrative_style: 'fast-paced',
    chapter_words: { min: 2000, max: 4000 },
  },
};
const clone = () => JSON.parse(JSON.stringify(BASE));

test('仓库自带 example.json 通过', () => {
  const r = runFile(path.join(ROOT, 'configs', 'example.json'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /校验通过/);
});

test('仓库自带 example-yuque.json 通过', () => {
  const r = runFile(path.join(ROOT, 'configs', 'example-yuque.json'));
  assert.strictEqual(r.status, 0, r.stderr);
});

test('最小合法 local 配置通过', () => {
  const r = runStdin(BASE);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('新书：tracking 字段为 null → 通过（未写章节时允许 null）', () => {
  const c = clone();
  c.info.current_chapter = 0; c.info.written_chapters = []; c.info.total_words = 0;
  c.info.last_sweet_spot = null;
  c.info.last_hook_start = null;
  c.info.last_hook_end = null;
  c.info.last_emotion_peak = null;
  const r = runStdin(c);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('info.name 为空 → 失败', () => {
  const c = clone(); c.info.name = '   ';
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /小说名不能为空/);
});

test('缺 required 字段 → 失败', () => {
  const r = runStdin({ save_location: 'local', writing: BASE.writing, local: BASE.local });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /info/);
});

test('status 非法枚举 → 失败', () => {
  const c = clone(); c.info.status = 'bad';
  assert.strictEqual(runStdin(c).status, 1);
});

test('created_at 格式错 → 失败', () => {
  const c = clone(); c.info.created_at = '2026/1/1';
  assert.strictEqual(runStdin(c).status, 1);
});

test('chapter_words min>max → 失败', () => {
  const c = clone(); c.writing.chapter_words = { min: 5000, max: 2000 };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /min\(5000\) > max\(2000\)/);
});

test('written_chapters 重复 → 失败', () => {
  const c = clone(); c.info.written_chapters = [1, 2, 2];
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /重复章节号/);
});

test('current_chapter 落后于已写 → 失败', () => {
  const c = clone(); c.info.current_chapter = 1; c.info.written_chapters = [1, 2, 3];
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /落后于已写列表/);
});

test('yuque 模式缺 book → 失败', () => {
  const c = clone();
  c.save_location = 'yuque';
  c.yuque = { groups: {} };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /book_id 与 namespace 至少填其一/);
});

test('yuque 模式缺分组 → 失败（22 必需）', () => {
  const c = clone();
  c.save_location = 'yuque';
  c.yuque = { book: { book_id: '1' }, groups: { content: 'u' } };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /缺失（必填）|必需分组/);
});

test('both 模式 local 块空（缺 content_path/settings_path）→ 失败', () => {
  const c = clone();
  c.save_location = 'both';
  c.local = {};
  c.yuque = {
    book: { book_id: '1' },
    groups: { content: 'u1', characters_protagonist: 'u2', characters_antagonist: 'u3', characters_supporting: 'u4', characters_deceased: 'u5', items: 'u6', locations: 'u7', factions: 'u8', foreshadowing: 'u9', timeline: 'u10', outline: 'u11', dialogs: 'u12', level_system: 'u13', change_log: 'u14', sweet_spot_tracking: 'u15', hook_tracking: 'u16', detailed_outline: 'u17', emotion_arc: 'u18', world_view: 'u19', mermaid_graph: 'u20', snapshot: 'u21', changes: 'u22' },
  };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /local.content_path: 缺失/);
  assert.match(r.stderr, /local.settings_path: 缺失/);
});

test('local 模式缺 settings_path → 失败', () => {
  const c = clone();
  delete c.local.settings_path;
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /local.settings_path: 缺失/);
});

test('文件不存在 → 退出码 2', () => {
  const r = runFile(path.join(ROOT, 'configs', '__nope__.json'));
  assert.strictEqual(r.status, 2);
});

test('钩子类型乱填（非追踪类词汇）→ 失败', () => {
  const c = clone();
  c.info.last_hook_start = { chapter: 4, type: '悬念钩子', strength: '强' };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /悬念钩子/);
});

test('爽点类型乱填 → 失败', () => {
  const c = clone();
  c.info.last_sweet_spot = { chapter: 3, type: '爽歪歪' };
  const r = runStdin(c);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /爽歪歪/);
});
