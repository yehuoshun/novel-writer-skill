const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'housekeeping.js');
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', cwd });

const FP = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'];

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-hk-'));
  const ledgerDir = path.join(dir, '设定', 'changes');
  const contentDir = path.join(dir, '正文');
  const backupDir = path.join(dir, '备份');
  for (const d of [ledgerDir, contentDir, backupDir]) fs.mkdirSync(d, { recursive: true });
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    info: { name: '清理测试' },
    save_location: 'local',
    backup: { mode: 'local', local_path: './备份' },
    local: { content_path: './正文', settings_path: './设定' },
  }, null, 2) + '\n');
  return { dir, ledgerDir, contentDir, backupDir, config };
}

const now = Date.now() / 1000;

/** 第 ch 章的草稿报告，mtime 越小越旧 */
function draft(f, ch, i, ageMin) {
  const p = path.join(f.ledgerDir, `ch${String(ch).padStart(3, '0')}-gate-report-draft-${FP[i]}.json`);
  fs.writeFileSync(p, JSON.stringify({ ch, fp: FP[i] }));
  fs.utimesSync(p, now - ageMin * 60, now - ageMin * 60);
  return p;
}

function publishedReport(f, ch) {
  const p = path.join(f.ledgerDir, `ch${String(ch).padStart(3, '0')}-gate-report.json`);
  fs.writeFileSync(p, JSON.stringify({ published: true }));
  return p;
}

function ledger(f, ch) {
  const p = path.join(f.ledgerDir, `ch${String(ch).padStart(3, '0')}-publish.json`);
  const sha = (c) => 'sha256:' + c.repeat(64);
  fs.writeFileSync(p, JSON.stringify({
    schemaVersion: 1,
    chapter: ch,
    novel: '清理测试',
    fileName: `第${String(ch).padStart(3, '0')}章.md`,
    publishes: [{
      publishedAt: new Date().toISOString(),
      chapter: ch,
      contentFingerprint: sha('a'),
      draftFingerprint: sha('b'),
      fileName: `第${String(ch).padStart(3, '0')}章.md`,
      reportPath: `ch${String(ch).padStart(3, '0')}-gate-report.json`,
      reportIntegrity: sha('c'),
      ruleVersion: 'test',
      summary: { pass: 1, warn: 0, fail: 0, skip: 0 },
      forced: false,
      aiOmitted: false,
      snapshotFingerprint: sha('d'),
      staleSnapshot: false,
      revised: false,
    }],
  }, null, 2) + '\n');
  return p;
}

function backup(f, stamp, ch, ageHour) {
  const p = path.join(f.backupDir, `${stamp}-ch${String(ch).padStart(3, '0')}`);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, '状态快照.md'), 'x'.repeat(1024));
  fs.utimesSync(p, now - ageHour * 3600, now - ageHour * 3600);
  return p;
}

const listed = (dir) => fs.readdirSync(dir).sort();

test('dry-run：只报计划，一个文件都不动', () => {
  const f = setup();
  ledger(f, 3);
  publishedReport(f, 3);
  const drafts = FP.map((_, i) => draft(f, 3, i, 10 - i)); // 越靠后越新
  const r = run([f.config]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dry-run 预演/);
  assert.match(r.stdout, /预演，未动任何文件/);
  assert.match(r.stdout, /ch003-gate-report-draft-aaaaaaaa\.json/);
  assert.doesNotMatch(r.stdout, /ch003-gate-report-draft-dddddddd\.json/);
  assert.strictEqual(fs.existsSync(drafts[0]), true, 'dry-run 不许删');
  assert.strictEqual(listed(f.ledgerDir).filter((n) => n.includes('-draft-')).length, 4);
});

test('--write --keep-drafts 2：每章只留最新 2 份，验收记录与账本不动', () => {
  const f = setup();
  ledger(f, 3);
  const report = publishedReport(f, 3);
  const lg = ledger(f, 3);
  FP.forEach((_, i) => draft(f, 3, i, 10 - i));
  const r = run([f.config, '--write', '--keep-drafts', '2']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /已删除 2 项/);
  const left = listed(f.ledgerDir).filter((n) => n.includes('-draft-'));
  assert.deepStrictEqual(left, ['ch003-gate-report-draft-cccccccc.json', 'ch003-gate-report-draft-dddddddd.json']);
  assert.ok(fs.existsSync(report), '发布当时的验收记录不许删');
  assert.ok(fs.existsSync(lg), '账本不许删');
});

test('--keep-drafts 0：草稿报告全清，第二次跑说「无需清理」（幂等）', () => {
  const f = setup();
  ledger(f, 3);
  publishedReport(f, 3);
  FP.forEach((_, i) => draft(f, 3, i, 10 - i));
  const first = run([f.config, '--write', '--keep-drafts', '0']);
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  assert.strictEqual(listed(f.ledgerDir).filter((n) => n.includes('-draft-')).length, 0);
  const second = run([f.config, '--write', '--keep-drafts', '0']);
  assert.strictEqual(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /无需清理/);
});

test('本地备份：按时间只留最新 N 个（默认 20 全留）', () => {
  const f = setup();
  const dirs = [0, 1, 2, 3, 4].map((i) => backup(f, `2026-11-0${i + 1}_10-00-00-000`, i + 1, 24 - i));
  const keepAll = run([f.config, '--write']);
  assert.strictEqual(keepAll.status, 0, keepAll.stdout + keepAll.stderr);
  assert.strictEqual(listed(f.backupDir).length, 5, '默认保留 20 个，5 个备份不该被动');

  const r = run([f.config, '--write', '--keep-backups', '2']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(listed(f.backupDir), ['2026-11-04_10-00-00-000-ch004', '2026-11-05_10-00-00-000-ch005']);
  assert.ok(!fs.existsSync(dirs[0]));
});

test('临时残留一律清（*.tmp / *.partial），不受 --keep-drafts 影响', () => {
  const f = setup();
  const a = path.join(f.ledgerDir, 'ch010-publish.json.tmp');
  const b = path.join(f.contentDir, '第011章.md.partial');
  const c = path.join(f.ledgerDir, 'ch011-gate-report.json'); // 正常报告不该被误伤
  for (const p of [a, b, c]) fs.writeFileSync(p, 'x');
  const r = run([f.config, '--write', '--keep-drafts', '99']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.existsSync(a), false);
  assert.strictEqual(fs.existsSync(b), false);
  assert.strictEqual(fs.existsSync(c), true);
});

test('孤儿报告只点名不删（账本里没有那一章）', () => {
  const f = setup();
  ledger(f, 3);
  publishedReport(f, 3);
  const orphan = publishedReport(f, 9);
  const r = run([f.config, '--write']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /孤儿报告 ch009-gate-report\.json/);
  assert.match(r.stderr, /publish-status/);
  assert.ok(fs.existsSync(orphan), '孤儿报告要人看过再删');
});

test('--json：dry-run 时给计划不给已删列表', () => {
  const f = setup();
  ledger(f, 3);
  publishedReport(f, 3);
  FP.forEach((_, i) => draft(f, 3, i, 10 - i));
  const r = run([f.config, '--json']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.dryRun, true);
  assert.strictEqual(out.totals.items, 1);
  assert.strictEqual(out.planned[0].kind, 'draft-report');
  assert.deepStrictEqual(out.deleted, []);
  assert.strictEqual(out.keepDrafts, 3);
});

test('参数与配置错误 → exit 2；按相对路径跑也认得配置所在目录', () => {
  const f = setup();
  assert.strictEqual(run([f.config, '--keep-drafts', 'abc']).status, 2);
  assert.strictEqual(run([f.config, '--keep-drafts', '-1']).status, 2);
  assert.strictEqual(run([f.config, '--keep-backups']).status, 2);
  assert.strictEqual(run([f.config, '--nope']).status, 2);
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run([path.join(f.dir, 'nope.json')]).status, 2);

  const bad = path.join(f.dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ local: { content_path: './正文' } }));
  const r = run([bad]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /缺 local\.settings_path/);

  // 相对配置路径 + 相对 cwd：目录按 config 所在目录解析，不按 cwd
  ledger(f, 3);
  publishedReport(f, 3);
  FP.forEach((_, i) => draft(f, 3, i, 10 - i));
  const rel = run(['config.json'], f.dir);
  assert.strictEqual(rel.status, 0, rel.stdout + rel.stderr);
  assert.match(rel.stdout, /ch003-gate-report-draft-aaaaaaaa\.json/);
});
