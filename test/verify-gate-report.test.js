'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-gate-report.js');
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
