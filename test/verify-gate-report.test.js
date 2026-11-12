'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-gate-report.js');
const gate = require(path.join(__dirname, '..', 'scripts', 'lib', 'gate-suite'));
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf-8' });
const runFile = (p) => spawnSync(process.execPath, [SCRIPT, p], { encoding: 'utf-8' });

const HEAD = '🛡️ 门禁结果（第5章）\n';
const SIX = ['引用校验', '一致性校验', '描写一致性', '未知实体', '蓝图出场', '伏笔闭环'];
const okLines = (gate) => SIX.map(l => `  ✅ ${l}：通过\n`).join('');

test('合并式 Gate 1-6 + 6 专项 → 完整（exit 0）', () => {
  const r = run(HEAD + '  ✅ Gate 1-6 写作质量：通过\n' + okLines());
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /门禁报告完整/);
});

test('逐条 Gate 1…Gate 6 + 6 专项 → 完整（exit 0）', () => {
  const gates = ['Gate 1 文本健康', 'Gate 2 AI句式', 'Gate 3 心理外化', 'Gate 4 节奏', 'Gate 5 对话', 'Gate 6 结尾']
    .map((g, i) => `  ${i === 1 ? '⚠️' : '✅'} ${g}：${i === 1 ? '1 处已修正' : '通过'}\n`).join('');
  const r = run(HEAD + gates + okLines());
  assert.strictEqual(r.status, 0, r.stderr);
});

test('一句话「门禁通过」敷衍 → 缺项（exit 1）', () => {
  const r = run('门禁通过了，没问题。\n');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /门禁报告不完整/);
});

test('缺若干专项 → 列出缺失项（exit 1）', () => {
  const r = run(HEAD + '  ✅ Gate 1-6 写作质量：通过\n  ✅ 引用校验：通过\n');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /一致性校验/);
  assert.match(r.stderr, /伏笔闭环/);
});

test('有项但缺结论标记 → 视为缺项（exit 1）', () => {
  const r = run(HEAD + '  Gate 1-6 写作质量\n' + okLines());
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Gate 1-6 写作质量（缺结论）/);
});

test('空报告 → exit 1', () => {
  const r = run('   \n');
  assert.strictEqual(r.status, 1);
});

test('文件不存在 → exit 2', () => {
  assert.strictEqual(runFile('/no/such/report.md').status, 2);
});

// ---- --data：文本报告与数据报告结论口径比对 ----

/** 造一份结构合法的数据报告（可用 overrides 指定某些门禁的结论）。 */
function writeData(dir, overrides) {
  const gates = gate.GATES.map((g) => ({
    ...g,
    source: 'rule',
    items: [],
    verdict: (overrides && overrides[g.key]) || 'pass',
  }));
  const report = gate.buildReport({ novel: '测试书', chapter: 5, draftText: '　　正文。\n', gates, checks: [] });
  const p = path.join(dir, 'ch005-gate-report.json');
  gate.writeJsonAtomic(p, report);
  return p;
}

function runWithData(reportText, dataPath) {
  const dir = tmpDir('nw-vgr-');
  const rp = path.join(dir, 'report.md');
  fs.writeFileSync(rp, reportText);
  return spawnSync(process.execPath, [SCRIPT, rp, '--data', dataPath], { encoding: 'utf-8' });
}

const allPassReport = HEAD + '  ✅ Gate 1-6 写作质量：通过\n' + okLines();

test('--data：文本与数据全 pass → exit 0', () => {
  const dir = tmpDir('nw-vgr-');
  const r = runWithData(allPassReport, writeData(dir));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /与数据报告一致/);
});

test('--data：数据是 warn 而文本写 ✅ → exit 1 并点名该项', () => {
  const dir = tmpDir('nw-vgr-');
  const data = writeData(dir, { gate3_psych_external: 'warn' });
  const text = HEAD + '  ✅ Gate 1 文本健康：通过\n  ✅ Gate 2 AI句式：通过\n  ✅ Gate 3 心理外化：通过\n'
    + ['Gate 4 节奏', 'Gate 5 对话', 'Gate 6 结尾'].map(g => `  ✅ ${g}：通过\n`).join('')
    + okLines();
  const r = runWithData(text, data);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Gate 3：文本报告 pass \/\/ 数据报告 warn/);
});

test('--data：合并写的 Gate 1-6 按最差一档比（数据有 fail → 文本写通过算不一致）', () => {
  const dir = tmpDir('nw-vgr-');
  const data = writeData(dir, { gate6_ending: 'fail' });
  const r = runWithData(allPassReport, data);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Gate 1-6：文本报告 pass \/\/ 数据报告 fail/);
});

test('--data：数据报告 skip 与文本「跳过（不适用）」一致 → exit 0', () => {
  const dir = tmpDir('nw-vgr-');
  const data = writeData(dir, { gate5_dialogue: 'skip' });
  const text = HEAD + '  ✅ Gate 1 文本健康：通过\n  ✅ Gate 2 AI句式：通过\n  ✅ Gate 3 心理外化：通过\n'
    + '  ✅ Gate 4 节奏：通过\n  ⏭️ Gate 5 对话：跳过（不适用，本章无对话）\n  ✅ Gate 6 结尾：通过\n'
    + okLines();
  const r = runWithData(text, data);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('--data：数据报告被手改（integrity 坏）→ exit 1', () => {
  const dir = tmpDir('nw-vgr-');
  const data = writeData(dir, { gate2_ai_syntax: 'warn' });
  const broken = JSON.parse(fs.readFileSync(data, 'utf-8'));
  broken.gates.find(g => g.key === 'gate2_ai_syntax').verdict = 'pass';
  fs.writeFileSync(data, JSON.stringify(broken, null, 2));
  const r = runWithData(allPassReport, data);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /数据报告自身不可信/);
});

test('--data 指向不存在的文件 → exit 2', () => {
  const r = runWithData(allPassReport, path.join(os.tmpdir(), 'nw-nope.json'));
  assert.strictEqual(r.status, 2);
});
