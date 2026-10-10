'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'backup-snapshot.js');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
const runCwd = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', cwd });

const WRITING = { pov: 'third-person', perspective: 'single', style: 'modern', narrative_style: 'fast-paced', chapter_words: { min: 2500, max: 4000 } };

function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const book = path.join(dir, '书');
  fs.mkdirSync(path.join(book, '正文'), { recursive: true });
  fs.mkdirSync(path.join(book, '设定', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(book, '正文', '第001章.md'), '　　正文。\n');
  fs.writeFileSync(path.join(book, '设定', '状态快照.md'), '# 状态快照\n');
  fs.writeFileSync(path.join(book, '设定', 'changes', 'ch001-changes.md'), '---CHANGES---\n---END CHANGES---\n');
  const cfg = {
    info: { name: '书', current_chapter: 1 },
    save_location: 'local',
    backup: { mode: 'local', local_path: path.join(book, 'backup') },
    local: { content_path: path.join(book, '正文'), settings_path: path.join(book, '设定') },
    writing: WRITING,
    ...overrides,
  };
  const cfgPath = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return { dir, book, cfgPath, cfg };
}
const snaps = (book) => {
  const b = path.join(book, 'backup');
  return fs.existsSync(b) ? fs.readdirSync(b) : [];
};

test('单章快照：状态快照 + 正文 + changes + manifest', () => {
  const { book, cfgPath } = setup();
  const r = run([cfgPath, '1']);
  assert.strictEqual(r.status, 0, r.stderr);
  const dirs = snaps(book);
  assert.strictEqual(dirs.length, 1, `应有 1 个快照目录，实际 ${dirs}`);
  const d = path.join(book, 'backup', dirs[0]);
  for (const f of ['状态快照.md', path.join('正文', '第001章.md'), path.join('changes', 'ch001-changes.md'), 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(d, f)), `缺 ${f}`);
  }
  const man = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf-8'));
  assert.strictEqual(man.mode, 'chapter');
  assert.strictEqual(man.chapter, '001');
});

test('默认章节号取 config.current_chapter（不传参）', () => {
  const { book, cfgPath } = setup();
  const r = run([cfgPath]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(snaps(book)[0], /ch001$/);
});

test('--full：全量拷 正文/ 与 设定/', () => {
  const { book, cfgPath } = setup();
  const r = run([cfgPath, '1', '--full']);
  assert.strictEqual(r.status, 0, r.stderr);
  const d = path.join(book, 'backup', snaps(book)[0]);
  assert.ok(fs.existsSync(path.join(d, '正文', '第001章.md')));
  assert.ok(fs.existsSync(path.join(d, '设定', '状态快照.md')));
  const man = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf-8'));
  assert.strictEqual(man.mode, 'full');
});

test('backup.mode=yuque_history → 跳过，退出码 0（不阻断）', () => {
  const { cfgPath } = setup({ backup: { mode: 'yuque_history' } });
  const r = run([cfgPath, '1']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /非 local，跳过/);
});

test('backup.mode=local 但 local_path 为空 → 退出码 1', () => {
  const { cfgPath } = setup({ backup: { mode: 'local', local_path: '' } });
  const r = run([cfgPath, '1']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /local_path 为空/);
});

test('没有可备份文件（路径不存在）→ 退出码 1，不残留空快照目录', () => {
  const { book, cfgPath } = setup({ local: { content_path: '/no/such/正文', settings_path: '/no/such/设定' } });
  const r = run([cfgPath, '1']);
  assert.strictEqual(r.status, 1);
  // v3.3.76 起源路径不存在时直接报「路径不存在」+ 双重嵌套排查提示（此前绕一圈报「未找到可备份文件」）
  assert.match(r.stderr, /路径不存在/);
  assert.strictEqual(snaps(book).length, 0, '不应残留空快照目录');
});

// ---- 相对路径双重嵌套（2026-10-10 实弹暴露）：相对路径按运行 cwd 解析，
//      在小说目录内跑会把 ./书/正文 解析成 书/书/正文 → 备份失败 ----
test('相对路径 config + cwd 在小说目录内 → 报路径不存在 + 双重嵌套排查提示', () => {
  const { dir, book, cfg } = setup();
  const relCfg = path.join(book, 'config-rel.json');
  fs.writeFileSync(relCfg, JSON.stringify({
    ...cfg,
    backup: { mode: 'local', local_path: './书/backup' },
    local: { content_path: './书/正文', settings_path: './书/设定' },
  }));
  const r = runCwd([relCfg, '1'], book); // cwd=小说目录内（最自然的运行姿势）
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /路径不存在/);
  assert.match(r.stderr, /双重嵌套/);
});

test('相对路径 config + cwd 在小说目录外 → 正常备份', () => {
  const { dir, book, cfg } = setup();
  const relCfg = path.join(dir, 'config-rel.json');
  fs.writeFileSync(relCfg, JSON.stringify({
    ...cfg,
    backup: { mode: 'local', local_path: './书/backup' },
    local: { content_path: './书/正文', settings_path: './书/设定' },
  }));
  const r = runCwd([relCfg, '1'], dir); // cwd=小说目录外
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(snaps(book).length, 1, '应有 1 个快照目录');
});

test('用法错误（缺配置参数）→ 退出码 2', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
});

test('配置文件不存在 → 退出码 2', () => {
  const r = run(['/no/such/cfg.json', '1']);
  assert.strictEqual(r.status, 2);
});
