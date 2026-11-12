'use strict';
// 建档联动（scaffold-entity）：CHANGES 里出现的新实体 → 设定档案骨架
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');

const SCAFFOLD = path.join(__dirname, '..', 'scripts', 'scaffold-entity.js');
const run = (args) => spawnSync(process.execPath, [SCAFFOLD, ...args], { encoding: 'utf-8' });

const DRAFT = [
  '　　林山带着苏瑶走进云海城。',
  '---CHANGES---',
  '<!-- 角色状态变化 -->', '- **[苏瑶]**：炼气一层 | 轻伤',
  '<!-- 角色移动 -->', '- **[林山]**：云海城',
  '<!-- 地点状态变化 -->', '- **[云海城]**：已开启',
  '<!-- 物品流转 -->', '- **[青玉简]**：苏瑶持有 | 方式：林山赠予',
  '<!-- 势力状态变化 -->', '- **[云海商会]**：已登场',
  '<!-- 伏笔动作 -->', '- 🔨埋设 **v2 云海商会的账本**（类型：短线，预期读者效果：贪腐伏笔） | 苏瑶摸到账本',
  '---END CHANGES---', '',
].join('\n');

function makeBook({ draft = DRAFT, draftName = '第003章.md', files = {} } = {}) {
  const dir = tmpDir('nw-scaffold-');
  const settingsDir = path.join(dir, '设定');
  fs.mkdirSync(path.join(settingsDir, '角色设定'), { recursive: true });
  fs.mkdirSync(path.join(dir, '正文'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    info: { name: '建档测试' },
    local: { content_path: './正文', settings_path: './设定' },
  }, null, 2));
  for (const [rel, body] of Object.entries({ '角色设定/主角/林山.md': '# 林山\n\n- 发色：黑\n- 瞳色：黑\n', ...files })) {
    const p = path.join(settingsDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf8');
  }
  const draftPath = path.join(dir, '正文', draftName);
  fs.writeFileSync(draftPath, draft, 'utf8');
  return {
    dir,
    settingsDir,
    draft: draftPath,
    config: path.join(dir, 'config.json'),
    read: (rel) => fs.readFileSync(path.join(settingsDir, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(settingsDir, rel)),
  };
}

test('dry-run：列出要建的档案，一个文件都不写', () => {
  const book = makeBook();
  const r = run([book.config, book.draft]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /角色设定[\\/]苏瑶\.md/);
  assert.match(r.stdout, /地点设定[\\/]云海城\.md/);
  assert.match(r.stdout, /物品设定[\\/]青玉简\.md/);
  assert.match(r.stdout, /势力设定[\\/]云海商会\.md/);
  assert.match(r.stdout, /伏笔追踪[\\/]v2-云海商会的账本\.md/);
  assert.match(r.stdout, /dry-run/);
  assert.strictEqual(book.exists('角色设定/苏瑶.md'), false);
  assert.strictEqual(book.exists('伏笔追踪/v2-云海商会的账本.md'), false);
});

test('--write：五类档案都落地，骨架字段正确', () => {
  const book = makeBook();
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /已建 5 份/);

  const char = book.read('角色设定/苏瑶.md');
  assert.match(char, /^# 苏瑶$/m);
  assert.match(char, /- 首次登场：第3章/);
  // 外貌段只留提醒注释：写标签反而会被描写一致性门禁当成「待定颜色」比对
  assert.doesNotMatch(char, /发色：/);
  assert.match(char, /发色与瞳色要么与 状态快照 的「角色外貌」表一字不差/);

  const fs2 = book.read('伏笔追踪/v2-云海商会的账本.md');
  assert.match(fs2, /^# v2 云海商会的账本$/m);
  assert.match(fs2, /- 类型：短线/);
  assert.match(fs2, /- 埋设章节：第3章/);
  assert.match(fs2, /- 状态：已埋设/);
  assert.match(fs2, /- 预期读者效果：贪腐伏笔/);

  assert.match(book.read('地点设定/云海城.md'), /^# 云海城$/m);
  assert.match(book.read('物品设定/青玉简.md'), /^# 青玉简$/m);
  assert.match(book.read('势力设定/云海商会.md'), /^# 云海商会$/m);
});

test('已有档案一个字节都不动，也不再出现在计划里', () => {
  const custom = '# 林山\n\n- 发色：黑\n- 瞳色：黑\n\n我自己写的档案，别覆盖。\n';
  const book = makeBook({ files: { '角色设定/主角/林山.md': custom } });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(book.read('角色设定/主角/林山.md'), custom);
  assert.doesNotMatch(r.stdout, /林山\.md/);
});

test('命名约定「前缀_名字」也算已建档', () => {
  const book = makeBook({ files: { '地点设定/城池_云海城.md': '# 云海城\n' } });
  const r = run([book.config, book.draft]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /云海城\.md/);
});

test('推进没有档案的伏笔 → exit 1 且只报不建', () => {
  const draft = [
    '　　正文。', '---CHANGES---',
    '<!-- 伏笔动作 -->', '- ➡️推进 **v9 冒名伏笔** | 有人提起',
    '---END CHANGES---', '',
  ].join('\n');
  const book = makeBook({ draft });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /伏笔 v9（progress）没有/);
  assert.match(r.stderr, /推进\/回收的伏笔必须先在埋设那章建过档/);
  assert.strictEqual(book.exists('伏笔追踪/v9-冒名伏笔.md'), false);
});

test('重复埋设已有档案的伏笔 → 不重复建', () => {
  const book = makeBook({
    files: { '伏笔追踪/v2-旧名.md': '# v2 旧名\n- 类型：短线\n' },
    draft: ['　　正文。', '---CHANGES---', '<!-- 伏笔动作 -->', '- 🔨埋设 **v2 云海商会的账本** | 又埋一次', '---END CHANGES---', ''].join('\n'),
  });
  const r = run([book.config, book.draft, '--write']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /档案齐了/);
  assert.strictEqual(book.exists('伏笔追踪/v2-云海商会的账本.md'), false);
});

test('--json：dry-run 结构可机读', () => {
  const book = makeBook();
  const r = run([book.config, book.draft, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.strictEqual(data.chapter, 3);
  assert.strictEqual(data.dryRun, true);
  assert.strictEqual(data.planned.length, 5);
  assert.strictEqual(data.created, 0);
  assert.deepStrictEqual(data.problems, []);
});

test('--quiet 只打一行摘要', () => {
  const book = makeBook();
  const r = run([book.config, book.draft, '--write', '--quiet']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim().split(/\r?\n/).length, 1);
  assert.match(r.stdout, /已建 5 份/);
});

test('章号：从 ch007 解析，--chapter 可覆盖', () => {
  const book = makeBook({ draftName: 'ch007-changes.md' });
  run([book.config, book.draft, '--write']);
  assert.match(book.read('角色设定/苏瑶.md'), /- 首次登场：第7章/);

  const book2 = makeBook();
  run([book2.config, book2.draft, '--write', '--chapter', '9']);
  assert.match(book2.read('角色设定/苏瑶.md'), /- 首次登场：第9章/);
  assert.match(book2.read('伏笔追踪/v2-云海商会的账本.md'), /- 埋设章节：第9章/);
});

test('负例：用法/配置错误 exit 2，无 CHANGES exit 1', () => {
  const book = makeBook();
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run([book.config]).status, 2);
  assert.strictEqual(run([book.config, book.draft, '--chapter', 'abc']).status, 2);
  assert.strictEqual(run([book.config, book.draft, '--bogus']).status, 2);
  assert.strictEqual(run([path.join(book.dir, 'nope.json'), book.draft]).status, 2);

  const noChanges = makeBook({ draft: '　　纯正文，没有声明。\n' });
  const r = run([noChanges.config, noChanges.draft]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No CHANGES block found/);
});
