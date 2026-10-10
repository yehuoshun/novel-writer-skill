'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'prepare-upload.js');
const run = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', ...opts });

const tmp = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
  const p = path.join(dir, 'ch.md');
  fs.writeFileSync(p, content);
  return { dir, p };
};

const BODY = '\u3000\u3000第一段。\n\n\u3000\u3000第二段。\n';
const CHANGES = '\n---CHANGES---\n<!-- 交接包 -->\n- 剧情当前位置：x\n---END CHANGES---\n';

test('剥离 CHANGES + 前置占位注释，输出到 stdout', () => {
  const { p } = tmp(BODY + CHANGES);
  const r = run([p]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.ok(out.startsWith('<!-- 语雀渲染占位（首段缩进保护） -->\n\n'), `占位注释缺失: ${JSON.stringify(out.slice(0, 50))}`);
  assert.ok(out.includes('\u3000\u3000第一段'), '正文缺失');
  assert.ok(!out.includes('CHANGES'), 'CHANGES 未剥离');
  assert.ok(!out.includes('END CHANGES'), 'END CHANGES 未剥离');
  assert.ok(out.trimEnd().endsWith('\u3000\u3000第二段。'), '结尾应为最后一段');
});

test('写入输出文件模式', () => {
  const { dir, p } = tmp(BODY + CHANGES);
  const out = path.join(dir, 'out.md');
  const r = run([p, out]);
  assert.strictEqual(r.status, 0, r.stderr);
  const content = fs.readFileSync(out, 'utf-8');
  assert.ok(content.startsWith('<!-- 语雀渲染占位'));
  assert.ok(!content.includes('---CHANGES---'));
});

test('缺缩进段落 → 退出码 1，提示先跑 check-indentation', () => {
  const { p } = tmp('顶格段落。\n\n' + BODY + CHANGES);
  const r = run([p]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /缩进不通过/);
  assert.match(r.stderr, /check-indentation/);
});

test('无 CHANGES 块也能处理（纯正文）', () => {
  const { p } = tmp(BODY);
  const r = run([p]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('CHANGES'));
});

test('文件不存在 → 退出码 2', () => {
  const r = run(['/no/such/file.md']);
  assert.strictEqual(r.status, 2);
});
// ---- 场景分隔符豁免（与 check-indentation 共用 scripts/lib/text-format.js，防两处漂移）----
test('场景分隔符 *** / --- 豁免缩进，与 check-indentation 同规则', () => {
  const { p } = tmp('　　第一段。\n\n***\n\n　　第二段。\n\n---\n\n　　第三段。\n' + CHANGES);
  const r = run([p]);
  assert.strictEqual(r.status, 0, r.stderr);
});
