'use strict';
// 门禁闸门公共库单测：指纹口径 / 报告自检 / AI 声明合并（不跑子进程，纯函数）
const { test } = require('node:test');
const assert = require('node:assert');
const gate = require('../scripts/lib/gate-suite');

const BODY = '　　青云山的雾还没散，林山站在石阶上。\n';
const DRAFT = BODY + '---CHANGES---\n<!-- 交接包 -->\n- 剧情当前位置：后山\n---END CHANGES---\n';

function fakeGates(verdict = 'pass') {
  return gate.GATES.map((g) => ({ key: g.key, label: g.label, source: 'rule', verdict, items: [] }));
}

function aiDecl(overrides) {
  const gates = {};
  for (const g of gate.GATES.filter((x) => x.aiRequired)) {
    gates[g.key] = { verdict: 'pass', evidence: `${g.label}：正文证据示例，长短句混排无明显套话` };
  }
  return Object.assign({ contentFingerprint: gate.contentFingerprint(DRAFT), gates }, overrides || {});
}

test('12 门禁定义：数量正确且 key 唯一', () => {
  assert.strictEqual(gate.GATES.length, 12);
  const keys = gate.GATES.map((g) => g.key);
  assert.strictEqual(new Set(keys).size, 12);
  assert.deepStrictEqual(gate.GATES.filter((g) => g.aiRequired).map((g) => g.key).sort(),
    ['gate2_ai_syntax', 'gate3_psych_external', 'gate4_rhythm', 'gate5_dialogue', 'gate6_ending']);
});

test('正文指纹：CHANGES 块与换行风格不影响，正文改字才变', () => {
  const a = gate.contentFingerprint(DRAFT);
  const b = gate.contentFingerprint(DRAFT.replace(/\n/g, '\r\n'));
  const c = gate.contentFingerprint(DRAFT.replace('- 剧情当前位置：后山', '- 剧情当前位置：前殿'));
  const d = gate.contentFingerprint(DRAFT.replace('林山站在石阶上', '林山坐在石阶上'));
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(b, a, 'CRLF 与 LF 应同指纹');
  assert.strictEqual(c, a, '改 CHANGES 不应改正文指纹');
  assert.notStrictEqual(d, a, '改正文必须换指纹');
});

test('buildReport + verifyReport：自洽报告通过', () => {
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates: fakeGates(), checks: [] });
  const r = gate.verifyReport(report, { draftText: DRAFT });
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(report.blocked, false);
  assert.strictEqual(report.summary.pass, 12);
});

test('verifyReport：手改结论 → integrity 对不上', () => {
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates: fakeGates(), checks: [] });
  report.gates[0].verdict = 'fail';
  const r = gate.verifyReport(report);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /integrity/.test(p)), r.problems.join(' / '));
});

test('verifyReport：summary 与明细不符 → 报错', () => {
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates: fakeGates(), checks: [] });
  report.summary.warn = 3;
  report.integrity = gate.reportIntegrity(report);
  const r = gate.verifyReport(report);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /summary\.warn/.test(p)), r.problems.join(' / '));
});

test('verifyReport：缺门禁项 / 缺 integrity → 报错', () => {
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates: fakeGates(), checks: [] });
  report.gates = report.gates.slice(0, 10);
  report.summary = { pass: 10, warn: 0, fail: 0, skip: 0 };
  delete report.integrity;
  const r = gate.verifyReport(report);
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /应 12 项/.test(p)));
  assert.ok(r.problems.some((p) => /integrity/.test(p)));
});

test('verifyReport：报告指纹与草稿不符 → 报错（防拿旧报告放新稿）', () => {
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates: fakeGates(), checks: [] });
  const other = DRAFT.replace('站在石阶上', '坐在石阶上');
  const r = gate.verifyReport(report, { draftText: other });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /不是这份稿的/.test(p)));
});

test('mergeAiDeclarations：缺 AI 声明 → 5 项语义门禁记 skip 并阻断', () => {
  const gates = fakeGates();
  const r = gate.mergeAiDeclarations(gates, null, { contentFp: gate.contentFingerprint(DRAFT) });
  assert.strictEqual(r.blockReasons.length, 1);
  assert.match(r.blockReasons[0], /缺 AI 侧门禁声明/);
  for (const key of ['gate2_ai_syntax', 'gate6_ending']) {
    assert.strictEqual(gates.find((g) => g.key === key).verdict, 'skip', 'skip 不是 pass');
  }
});

test('mergeAiDeclarations：allowMissingAi → 不阻断但记 aiOmitted', () => {
  const gates = fakeGates();
  const r = gate.mergeAiDeclarations(gates, null, { contentFp: gate.contentFingerprint(DRAFT), allowMissingAi: true });
  assert.deepStrictEqual(r.blockReasons, []);
  assert.strictEqual(r.aiOmitted, true);
});

test('mergeAiDeclarations：齐全声明 → 无阻断，来源标 ai/mixed', () => {
  const gates = fakeGates('warn');
  const r = gate.mergeAiDeclarations(gates, aiDecl(), { contentFp: gate.contentFingerprint(DRAFT) });
  assert.deepStrictEqual(r.blockReasons, []);
  const g2 = gates.find((g) => g.key === 'gate2_ai_syntax');
  assert.strictEqual(g2.source, 'mixed', '规则侧已有条目时应标 mixed');
  assert.ok(g2.evidence.length >= gate.MIN_EVIDENCE);
});

test('mergeAiDeclarations：AI 自报通过但无证据 → 阻断', () => {
  const decl = aiDecl();
  decl.gates.gate3_psych_external = { verdict: 'pass', evidence: '通过' };
  const r = gate.mergeAiDeclarations(fakeGates(), decl, { contentFp: gate.contentFingerprint(DRAFT) });
  assert.strictEqual(r.blockReasons.length, 1);
  assert.match(r.blockReasons[0], /无证据/);
});

test('mergeAiDeclarations：声明指纹属于旧稿 → 阻断', () => {
  const decl = aiDecl({ contentFingerprint: 'sha256:' + '0'.repeat(64) });
  const r = gate.mergeAiDeclarations(fakeGates(), decl, { contentFp: gate.contentFingerprint(DRAFT) });
  assert.ok(r.blockReasons.some((x) => /旧稿/.test(x)), r.blockReasons.join(' / '));
});

test('mergeAiDeclarations：未知 key / 非法结论 → 阻断', () => {
  const decl = aiDecl();
  decl.gates.not_a_gate = { verdict: 'pass', evidence: '随便写点什么够长' };
  decl.gates.gate4_rhythm = { verdict: '很好', evidence: '随便写点什么够长' };
  const r = gate.mergeAiDeclarations(fakeGates(), decl, { contentFp: gate.contentFingerprint(DRAFT) });
  assert.ok(r.blockReasons.some((x) => /未知门禁 key/.test(x)), r.blockReasons.join(' / '));
  assert.ok(r.blockReasons.some((x) => /结论非法/.test(x)), r.blockReasons.join(' / '));
});

test('mergeAiDeclarations：漏报某一项语义门禁 → 阻断', () => {
  const decl = aiDecl();
  delete decl.gates.gate5_dialogue;
  const r = gate.mergeAiDeclarations(fakeGates(), decl, { contentFp: gate.contentFingerprint(DRAFT) });
  assert.ok(r.blockReasons.some((x) => /Gate 5 对话/.test(x)), r.blockReasons.join(' / '));
});

test('buildReport：规则侧 fail → blocked 且原因带门禁名', () => {
  const gates = fakeGates();
  gates[0].verdict = 'fail';
  gates[0].items.push({ level: 'fail', text: '半角标点混入: ,' });
  const report = gate.buildReport({ novel: '测试书', chapter: 1, draftText: DRAFT, gates, checks: [] });
  assert.strictEqual(report.blocked, true);
  assert.ok(report.blockReasons.some((r) => /Gate 1 文本健康/.test(r)), report.blockReasons.join(' / '));
});

test('writeJsonAtomic / readJsonIfExists：往返一致且不留临时文件', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-gate-'));
  const target = path.join(dir, 'sub', 'x.json');
  gate.writeJsonAtomic(target, { a: 1 });
  assert.deepStrictEqual(gate.readJsonIfExists(target), { a: 1 });
  const left = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.tmp-'));
  assert.deepStrictEqual(left, []);
  assert.strictEqual(gate.readJsonIfExists(path.join(dir, 'nope.json')), null);
});
