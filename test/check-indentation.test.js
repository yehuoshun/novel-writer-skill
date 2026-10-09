'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-indentation.js');
const run = (p) => spawnSync(process.execPath, [SCRIPT, p], { encoding: 'utf-8' });

const tmp = (name, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indent-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

test('全部段落带两全角空格 → 通过，退出码 0', () => {
  const p = tmp('ok.md', '\u3000\u3000第一段。\n\n\u3000\u3000第二段。\n\n\u3000\u3000第三段。\n\n---CHANGES---\n- **x**：y\n---END CHANGES---\n');
  const r = run(p);
  assert.strictEqual(r.status, 0, `stdout: ${r.stdout}`);
  assert.match(r.stdout, /通过/);
});

test('缺缩进段落 → 报行号 + 预览，退出码 1', () => {
  const p = tmp('bad.md', '顶格第一段。\n\n\u3000\u3000正常第二段。\n\n\u3000\u3000正常第三段。\n');
  const r = run(p);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /行 1/);
  assert.match(r.stdout, /顶格第一段/);
});

test('标题/列表/引用/表格/代码块豁免 → 不误报', () => {
  const content = '# 章标题\n\n- 列表项\n\n> 引用行\n\n| a | b |\n|---|---|\n\n```mermaid\ngraph LR\n  节点\n```\n\n\u3000\u3000正文段。\n';
  const p = tmp('exempt.md', content);
  const r = run(p);
  assert.strictEqual(r.status, 0, `stdout: ${r.stdout}`);
});

test('CHANGES 块内容不参与检查（协议块豁免）', () => {
  const content = '\u3000\u3000正文。\n\n---CHANGES---\n<!-- 角色状态变化 -->\n- **沈砚**：健康→健康\n---END CHANGES---\n';
  const p = tmp('changes.md', content);
  const r = run(p);
  assert.strictEqual(r.status, 0, `stdout: ${r.stdout}`);
});

test('文件不存在 → 退出码 2', () => {
  const r = run('/no/such/file.md');
  assert.strictEqual(r.status, 2);
});