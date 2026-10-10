'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'tools', 'notify-release.py');
const PY = process.env.PYTHON || 'python3';

test('notify-release 生成含 changelog 的 markdown（--print 不联网）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-nr-'));
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, '## 📦 test v9\n\n### 更新内容\n- fix: 修了个 bug\n');
  const r = spawnSync(PY, [SCRIPT, '--print', body], {
    encoding: 'utf-8',
    env: { ...process.env, TAG: 'v9.9.9', REPO: 'yehuoshun/x' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Release v9\.9\.9/);   // 标题
  assert.match(r.stdout, /新版本发布/);
  assert.match(r.stdout, /`v9\.9\.9`/);          // 版本号
  assert.match(r.stdout, /fix: 修了个 bug/);      // changelog 正文（非空消息）
  assert.match(r.stdout, /GitHub/);              // 钉钉机器人关键词
});

test('未配置 DINGTALK_WEBHOOK → 不阻断 CI（退出码 0）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-nr-'));
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, '## 📦 test\n');
  const env = { ...process.env, TAG: 'v9.9.9', REPO: 'yehuoshun/x' };
  delete env.DINGTALK_WEBHOOK;
  const r = spawnSync(PY, [SCRIPT, body], { encoding: 'utf-8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /未配置 DINGTALK_WEBHOOK/);
});
