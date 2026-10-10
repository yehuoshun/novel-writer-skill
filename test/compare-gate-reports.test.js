'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'compare-gate-reports.js');
const run = (a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf-8' });

const HEAD = '🛡️ 门禁结果（第5章）\n';
const six = (v = '✅ 通过') => ['引用校验', '一致性校验', '描写一致性', '未知实体', '蓝图出场', '伏笔闭环']
  .map(l => `  ${v.split(' ')[0]} ${l}：${v.split(' ').slice(1).join(' ')}\n`).join('');
const report = (gate = '✅', detail = '通过', extra = '') =>
  HEAD + `  ${gate} Gate 1-6 写作质量：${detail}\n` + six(`${gate} ${detail}`) + extra;
const tmp = (name, content) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  const p = path.join(d, name); fs.writeFileSync(p, content); return p;
};

test('两份报告完全一致 → 自动通过（exit 0）', () => {
  const r = run([tmp('a.md', report()), tmp('b.md', report())]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /完全一致/);
  assert.match(r.stdout, /无需人工/);
});

test('逐条 Gate 形式也支持', () => {
  const gates = '  ✅ Gate 1 文本健康：通过\n  ✅ Gate 2 AI句式：通过\n  ✅ Gate 3 心理外化：通过\n  ✅ Gate 4 节奏：通过\n  ✅ Gate 5 对话：通过\n  ✅ Gate 6 结尾：通过\n';
  const r = run([tmp('a.md', HEAD + gates + six()), tmp('b.md', HEAD + gates + six())]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('单项判断分歧 → 升级人工（exit 1）', () => {
  const a = report();
  const b = HEAD + '  ✅ Gate 1-6 写作质量：通过\n' + six().replace('✅ 描写一致性：通过', '❌ 描写一致性：不通过');
  const r = run([tmp('a.md', a), tmp('b.md', b)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /描写一致性/);
  assert.match(r.stderr, /升级人工/);
});

test('warn vs pass 视为分歧', () => {
  const a = report();
  const b = HEAD + '  ✅ Gate 1-6 写作质量：通过\n' + six().replace('✅ 引用校验：通过', '⚠️ 引用校验：待核');
  const r = run([tmp('a.md', a), tmp('b.md', b)]);
  assert.strictEqual(r.status, 1);
});

test('复核报告缺项 → 重跑（exit 3，非人工）', () => {
  const r = run([tmp('a.md', report()), tmp('b.md', HEAD + '  ✅ Gate 1-6 写作质量：通过\n')]);
  assert.strictEqual(r.status, 3, r.stderr);
  assert.match(r.stderr, /缺项/);
  assert.match(r.stderr, /非歧义/);
});

test('既有分歧又缺项 → 以歧义优先（exit 1，人工）', () => {
  const b = HEAD + '  ✅ Gate 1-6 写作质量：通过\n  ❌ 引用校验：不通过\n';
  const r = run([tmp('a.md', report()), tmp('b.md', b)]);
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /歧义/);
});

test('用法/文件错误 → exit 2', () => {
  assert.strictEqual(run([]).status, 2);
  assert.strictEqual(run(['/no/such/a.md', '/no/such/b.md']).status, 2);
});
