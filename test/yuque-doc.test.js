'use strict';
/**
 * yuque-doc.js 测试：lib 纯逻辑 + 本地假语雀端到端
 *
 * 假服务端只复现语雀真正扎人的三件事，别的都按最朴素的方式回答：
 *   1. POST /docs 建的文档不进 TOC（要 appendNode + doc_ids 才生成节点）
 *   2. 移动 DOC 得给 node_uuid（给 doc_ids + target_uuid 语雀会挂根或漏挂）
 *   3. TOC 写会静默失败——响应像成功、回读却在原地（这就是回读校验存在的理由）
 *
 * 用 spawn 而不是 spawnSync：假服务端跑在本进程里，spawnSync 会把事件循环堵死，
 * 子进程的请求永远等不到响应。
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { tmpDir } = require('./helpers/tmp');
const lib = require('../scripts/lib/yuque-toc');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'yuque-doc.js');
const TOKEN = 'tk-test';
const BOOK = '12345';
const FAST_RETRY = { YUQUE_MAX_RETRIES: '2', YUQUE_RETRY_BASE_MS: '1', YUQUE_TIMEOUT_MS: '3000', YUQUE_POLL_MS: '1' };

// ---------- 假语雀 ----------

function clone(n) {
  return { ...n };
}

function startFakeYuque(opts = {}) {
  const state = {
    token: opts.token || TOKEN,
    toc: [],
    docs: new Map(),
    nextDocId: 2000,
    nextNodeId: 1,
    rateLimitOnce: 0,
    dropMoves: false,   // true = 假装挂好了，实际没动（复现「TOC 写路径静默积压」）
    requests: [],
  };

  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', d => { buf += d; });
    req.on('end', () => {
      state.requests.push(`${req.method} ${req.url}`);
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (state.rateLimitOnce > 0) {
        state.rateLimitOnce--;
        return send(429, { code: 'rate_limit', message: '请求太频繁' });
      }
      if (req.headers['x-auth-token'] !== state.token) {
        return send(401, { code: 'token_invalid', message: 'bad token' });
      }

      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      let body = {};
      try { body = buf ? JSON.parse(buf) : {}; } catch { return send(400, { code: 'body_parse_failed', message: 'bad json' }); }

      const tocPath = /^\/api\/v2\/repos\/([^/]+)\/toc$/.exec(pathname);
      if (tocPath) {
        if (req.method === 'GET') return send(200, { data: state.toc.map(clone) });
        if (body.action !== 'appendNode') return send(422, { code: 'invalid_params', message: 'bad action' });
        // 移动：必须给 node_uuid
        if (body.node_uuid) {
          const node = state.toc.find(n => n.uuid === body.node_uuid);
          if (!node) return send(404, { code: 'not_found', message: 'no such node' });
          if (!state.dropMoves) node.parent_uuid = body.target_uuid || '';
          return send(200, { data: state.toc.map(clone) });
        }
        // 建分组
        if (body.type === 'TITLE') {
          state.toc.push({ uuid: `t${state.nextNodeId++}`, type: 'TITLE', title: body.title, parent_uuid: '' });
          return send(200, { data: state.toc.map(clone) });
        }
        // 挂根
        const created = [];
        for (const id of body.doc_ids || []) {
          const doc = state.docs.get(Number(id));
          if (!doc) return send(404, { code: 'doc_not_found', message: 'no such doc' });
          const node = { uuid: `n${state.nextNodeId++}`, type: 'DOC', doc_id: doc.id, title: doc.title, parent_uuid: '' };
          state.toc.push(node);
          created.push(node);
        }
        return send(200, { data: state.toc.map(clone) });
      }

      if (/^\/api\/v2\/repos\/([^/]+)\/docs$/.test(pathname) && req.method === 'POST') {
        const doc = { id: state.nextDocId++, title: body.title, body: body.body || '', format: body.format || 'markdown' };
        state.docs.set(doc.id, doc);
        return send(200, { data: doc });   // 注意：不入 TOC
      }

      const docPath = /^\/api\/v2\/repos\/([^/]+)\/docs\/([^/]+)$/.exec(pathname);
      if (docPath) {
        const doc = state.docs.get(Number(docPath[2]));
        if (!doc) return send(404, { code: 'doc_not_found', message: 'no such doc' });
        if (req.method === 'GET') return send(200, { data: doc });
        if (body.body !== undefined) doc.body = body.body;
        if (body.format !== undefined) doc.format = body.format;
        return send(200, { data: doc });
      }

      return send(404, { code: 'not_found', message: pathname });
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        state,
        base: `http://127.0.0.1:${server.address().port}/api/v2`,
        open: () => new Promise(r => server.close(r)),
      });
    });
  });
}

async function withServer(opts, fn) {
  const srv = await startFakeYuque(opts);
  try {
    return await fn(srv);
  } finally {
    await srv.open();
  }
}

/** 跑 CLI，返回 { code, stdout, stderr } */
function runCli(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...FAST_RETRY, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function apiArgs(srv, extra = []) {
  return ['--book', BOOK, '--api-base', srv.base, '--token', TOKEN, ...extra];
}

// ---------- lib 纯逻辑 ----------

test('argParse 支持 --k v、--k=v、开关与位置参数', () => {
  const a = lib.argParse(['create-mount', '--book', '12', '--dry-run', '--group=设定', '--title', '角色']);
  assert.deepStrictEqual(a._, ['create-mount']);
  assert.strictEqual(a.book, '12');
  assert.strictEqual(a['dry-run'], true);
  assert.strictEqual(a.group, '设定');
  assert.strictEqual(a.title, '角色');
});

test('normTitle 抹平章节后缀与章节前缀', () => {
  assert.strictEqual(lib.normTitle('状态快照（截止第12章）'), '状态快照');
  assert.strictEqual(lib.normTitle('角色（第5章 转折）'), '角色');
  assert.strictEqual(lib.normTitle('第023章 断剑'), '断剑');
  assert.strictEqual(lib.normTitle('伏笔追踪'), '伏笔追踪');
});

test('findGroup 优先根节点，findDocNode 取最后一个重复节点', () => {
  const toc = [
    { uuid: 't1', type: 'TITLE', title: '角色', parent_uuid: 'x' },
    { uuid: 't2', type: 'TITLE', title: '角色', parent_uuid: '' },
    { uuid: 'd1', type: 'DOC', doc_id: 7, title: '林山', parent_uuid: '' },
    { uuid: 'd2', type: 'DOC', doc_id: 7, title: '林山', parent_uuid: 't2' },
  ];
  assert.strictEqual(lib.findGroup(toc, '角色').uuid, 't2');
  assert.strictEqual(lib.findGroup(toc, '角色', '').uuid, 't2');
  assert.strictEqual(lib.findGroup(toc, '角色', 'x').uuid, 't1');
  assert.strictEqual(lib.findGroup(toc, '不存在'), null);
  assert.strictEqual(lib.findDocNode(toc, 7).uuid, 'd2');
  assert.strictEqual(lib.findDocNode(toc, '999'), null);
});

test('isBodyFile 只认正文档，衍生档不算', () => {
  assert.ok(lib.isBodyFile('第001章 起点.md'));
  assert.ok(!lib.isBodyFile('第001章 起点上传版.md'));
  assert.ok(!lib.isBodyFile('第001章 起点备份.md'));
  assert.ok(!lib.isBodyFile('设定/角色.md'));
});

test('bodiesEqual 豁免标题头与尾部空白', () => {
  assert.ok(lib.bodiesEqual('# 角色\n\n林山，青云山弟子\n\n', '林山，青云山弟子'));
  assert.ok(!lib.bodiesEqual('林山，青云山弟子', '林山，青云山掌门'));
  assert.ok(lib.bodiesEqual('', ''));
});

test('groupFromLocalPath 按方案 A 镜像推分组', () => {
  const root = path.resolve('C:/novel');
  assert.strictEqual(lib.groupFromLocalPath(root, path.join(root, '设定', '角色', '林山.md')), '角色');
  assert.strictEqual(lib.groupFromLocalPath(root, path.join(root, '设定', '角色.md')), null);
  assert.strictEqual(lib.groupFromLocalPath(root, path.join(root, '第001章 起点.md')), null);
  assert.strictEqual(lib.groupFromLocalPath(root, path.join(root, '..', 'outside.md')), null);
});

test('formatApiError 把状态码与业务 code 都翻成人话', () => {
  const msg = lib.formatApiError(404, '{"code":"book_not_found","message":"repo not found"}');
  assert.match(msg, /HTTP 404/);
  assert.match(msg, /book_not_found/);
  assert.match(msg, /知识库不存在/);
  assert.match(msg, /repo not found/);
  assert.match(lib.formatApiError(500, 'oops'), /oops/);
});

// ---------- CLI 基本行为 ----------

test('--help 打印用法并成功退出', async () => {
  const r = await runCli(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /create-mount/);
  assert.match(r.stdout, /退出码: 0=成功/);
});

test('未知子命令与缺 --book 都算用法错误（exit 2）', async () => {
  const bad = await runCli(['nope']);
  assert.strictEqual(bad.code, 2);
  assert.match(bad.stderr, /未知子命令「nope」/);

  const noBook = await runCli(['ls-groups', '--token', TOKEN]);
  assert.strictEqual(noBook.code, 2);
  assert.match(noBook.stderr, /缺少 --book/);
});

test('token 不对：报成人话且不重试', async () => {
  await withServer({}, async srv => {
    const r = await runCli(['ls-groups', '--book', BOOK, '--api-base', srv.base, '--token', 'wrong']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /HTTP 401/);
    assert.match(r.stderr, /token 无效/);
    assert.ok(!/重试/.test(r.stderr), '401 不该重试');
  });
});

test('429 会退避重试并最终成功', async () => {
  await withServer({}, async srv => {
    srv.state.rateLimitOnce = 1;
    const r = await runCli(apiArgs(srv, ['ls-groups']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stderr, /429/);
    assert.match(r.stdout, /还没有分组/);
  });
});

// ---------- create-mount ----------

test('create-mount：先挂根再按 node_uuid 移进分组，并回读校验', async () => {
  await withServer({}, async srv => {
    srv.state.toc.push({ uuid: 't-char', type: 'TITLE', title: '角色', parent_uuid: '' });
    const dir = tmpDir('nw-yq-');
    const file = path.join(dir, '林山.md');
    fs.writeFileSync(file, '林山，青云山弟子。', 'utf-8');

    const r = await runCli(apiArgs(srv, ['create-mount', '--title', '林山', '--file', file, '--group', '角色']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /已建文档：林山/);
    assert.match(r.stdout, /已挂进分组「角色」/);

    const doc = [...srv.state.docs.values()].find(d => d.title === '林山');
    assert.ok(doc, '文档应已创建');
    const node = lib.findDocNode(srv.state.toc, doc.id);
    assert.ok(node, '文档应在 TOC 里');
    assert.strictEqual(node.parent_uuid, 't-char');
    assert.strictEqual(doc.body, '林山，青云山弟子。');
  });
});

test('create-mount：分组不存在时在建文档之前就失败，不留孤儿', async () => {
  await withServer({}, async srv => {
    const dir = tmpDir('nw-yq-');
    const file = path.join(dir, 'x.md');
    fs.writeFileSync(file, '内容', 'utf-8');

    const r = await runCli(apiArgs(srv, ['create-mount', '--title', 'x', '--file', file, '--group', '不存在的分组']));
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /分组「不存在的分组」不存在/);
    assert.strictEqual(srv.state.docs.size, 0, '不该留下孤儿文档');
  });
});

test('create-mount --create-group 会顺手建分组', async () => {
  await withServer({}, async srv => {
    const dir = tmpDir('nw-yq-');
    const file = path.join(dir, 'x.md');
    fs.writeFileSync(file, '内容', 'utf-8');

    const r = await runCli(apiArgs(srv, ['create-mount', '--title', 'x', '--file', file, '--group', '新分组', '--create-group']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /已建分组「新分组」/);
    const group = lib.findGroup(srv.state.toc, '新分组');
    assert.ok(group);
    const doc = [...srv.state.docs.values()][0];
    assert.strictEqual(lib.findDocNode(srv.state.toc, doc.id).parent_uuid, group.uuid);
  });
});

test('静默失败能被回读校验抓住，再用 move 修好', async () => {
  await withServer({}, async srv => {
    srv.state.toc.push({ uuid: 't-char', type: 'TITLE', title: '角色', parent_uuid: '' });
    const dir = tmpDir('nw-yq-');
    const file = path.join(dir, 'x.md');
    fs.writeFileSync(file, '内容', 'utf-8');

    srv.state.dropMoves = true;
    const created = await runCli(apiArgs(srv, ['create-mount', '--title', '林山', '--file', file, '--group', '角色']));
    assert.strictEqual(created.code, 1, '回读校验必须拦住假的成功');
    assert.match(created.stderr, /挂载回读校验没过/);
    assert.match(created.stderr, /move --book 12345/);

    const doc = [...srv.state.docs.values()][0];
    assert.strictEqual(lib.findDocNode(srv.state.toc, doc.id).parent_uuid, '', '假成功：节点其实还在根');

    srv.state.dropMoves = false;
    const moved = await runCli(apiArgs(srv, ['move', '--doc', String(doc.id), '--group', '角色']));
    assert.strictEqual(moved.code, 0, moved.stderr);
    assert.strictEqual(lib.findDocNode(srv.state.toc, doc.id).parent_uuid, 't-char');
  });
});

test('move 支持按标题找文档', async () => {
  await withServer({}, async srv => {
    srv.state.toc.push({ uuid: 't-char', type: 'TITLE', title: '角色', parent_uuid: '' });
    srv.state.docs.set(3001, { id: 3001, title: '林山', body: 'x', format: 'markdown' });
    srv.state.toc.push({ uuid: 'n-x', type: 'DOC', doc_id: 3001, title: '林山', parent_uuid: '' });

    const r = await runCli(apiArgs(srv, ['move', '--doc', '林山', '--group', '角色']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /林山 → 分组「角色」/);
    assert.strictEqual(lib.findDocNode(srv.state.toc, 3001).parent_uuid, 't-char');
  });
});

// ---------- audit / sync / get ----------

test('audit：没有「正文」分组时不崩，正文对被点名', async () => {
  await withServer({}, async srv => {
    srv.state.docs.set(4001, { id: 4001, title: '角色', body: 'x', format: 'markdown' });
    srv.state.toc.push({ uuid: 'n-c', type: 'DOC', doc_id: 4001, title: '角色', parent_uuid: '' });

    const root = tmpDir('nw-yq-');
    fs.mkdirSync(path.join(root, '设定'), { recursive: true });
    fs.writeFileSync(path.join(root, '设定', '角色.md'), '本地角色', 'utf-8');
    fs.writeFileSync(path.join(root, '设定', '新增.md'), '本地新增', 'utf-8');
    fs.writeFileSync(path.join(root, '第001章 起点.md'), '正文', 'utf-8');

    const r = await runCli(apiArgs(srv, ['audit', '--local', root]));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /两边一致（1）/);
    assert.match(r.stdout, /本地有、语雀无（2）/);
    assert.match(r.stdout, /语雀没有「正文」分组/);
  });
});

test('audit --json 给出机器可读结果', async () => {
  await withServer({}, async srv => {
    const root = tmpDir('nw-yq-');
    fs.mkdirSync(path.join(root, '设定'), { recursive: true });
    fs.writeFileSync(path.join(root, '设定', '角色.md'), '本地角色', 'utf-8');

    const r = await runCli(apiArgs(srv, ['audit', '--local', root, '--json']));
    assert.strictEqual(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.book, BOOK);
    assert.deepStrictEqual(out.localMissing, ['设定/角色.md']);
  });
});

test('sync：--dry-run 不写，真跑才推差异，内容一致则跳过', async () => {
  await withServer({}, async srv => {
    srv.state.docs.set(5001, { id: 5001, title: '角色', body: '旧内容', format: 'markdown' });
    srv.state.toc.push({ uuid: 'n-c', type: 'DOC', doc_id: 5001, title: '角色', parent_uuid: '' });

    const root = tmpDir('nw-yq-');
    fs.mkdirSync(path.join(root, '设定'), { recursive: true });
    fs.writeFileSync(path.join(root, '设定', '角色.md'), '新内容', 'utf-8');

    const dry = await runCli(apiArgs(srv, ['sync', '--local', root, '--dry-run']));
    assert.strictEqual(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /\[待更新\] 角色/);
    assert.strictEqual(srv.state.docs.get(5001).body, '旧内容', '预演不该写');

    const real = await runCli(apiArgs(srv, ['sync', '--local', root]));
    assert.strictEqual(real.code, 0, real.stderr);
    assert.match(real.stdout, /\[更新\] 角色/);
    assert.strictEqual(srv.state.docs.get(5001).body, '新内容');

    const again = await runCli(apiArgs(srv, ['sync', '--local', root]));
    assert.strictEqual(again.code, 0, again.stderr);
    assert.match(again.stdout, /一致跳过 1/);
  });
});

test('sync：远端是 lake 格式时拒写，免把排版冲掉', async () => {
  await withServer({}, async srv => {
    srv.state.docs.set(5002, { id: 5002, title: '角色', body: '<p>旧</p>', format: 'lake' });
    srv.state.toc.push({ uuid: 'n-c2', type: 'DOC', doc_id: 5002, title: '角色', parent_uuid: '' });

    const root = tmpDir('nw-yq-');
    fs.mkdirSync(path.join(root, '设定'), { recursive: true });
    fs.writeFileSync(path.join(root, '设定', '角色.md'), '新内容', 'utf-8');

    const r = await runCli(apiArgs(srv, ['sync', '--local', root]));
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /lake 格式/);
    assert.strictEqual(srv.state.docs.get(5002).body, '<p>旧</p>');
  });
});

test('get：打印正文，--out 存文件', async () => {
  await withServer({}, async srv => {
    srv.state.docs.set(6001, { id: 6001, title: '角色', body: '# 角色\n\n林山', format: 'markdown' });
    srv.state.toc.push({ uuid: 'n-c3', type: 'DOC', doc_id: 6001, title: '角色', parent_uuid: '' });

    const printed = await runCli(apiArgs(srv, ['get', '--doc', '角色']));
    assert.strictEqual(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /林山/);

    const dir = tmpDir('nw-yq-');
    const out = path.join(dir, 'sub', '角色.md');
    const saved = await runCli(apiArgs(srv, ['get', '--doc', '6001', '--out', out]));
    assert.strictEqual(saved.code, 0, saved.stderr);
    assert.strictEqual(fs.readFileSync(out, 'utf-8'), '# 角色\n\n林山');
  });
});

test('--novel-config + --group-key 省掉手填 book 与 uuid', async () => {
  await withServer({}, async srv => {
    srv.state.toc.push({ uuid: 't-content', type: 'TITLE', title: '正文', parent_uuid: '' });
    const dir = tmpDir('nw-yq-');
    const novel = path.join(dir, 'config.json');
    fs.writeFileSync(novel, JSON.stringify({
      yuque: { book: { book_id: Number(BOOK) }, groups: { content: 't-content' } },
    }), 'utf-8');
    const file = path.join(dir, '第001章 起点.md');
    fs.writeFileSync(file, '正文一段。', 'utf-8');

    const r = await runCli([
      'create-mount', '--novel-config', novel, '--group-key', 'content',
      '--api-base', srv.base, '--token', TOKEN,
      '--title', '第001章 起点', '--file', file,
    ]);
    assert.strictEqual(r.code, 0, r.stderr);
    const doc = [...srv.state.docs.values()][0];
    assert.strictEqual(lib.findDocNode(srv.state.toc, doc.id).parent_uuid, 't-content');
  });
});

// ---------- pull（语雀 → 本地） ----------

function seedDoc(srv, { id, title, body, format = 'markdown', parentUuid = '' }) {
  srv.state.docs.set(id, { id, title, body, format });
  srv.state.toc.push({ uuid: `n-${id}`, type: 'DOC', doc_id: id, title, parent_uuid: parentUuid });
}

function makeLocalSet(files) {
  const root = tmpDir('nw-yq-');
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, '设定', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf-8');
  }
  return root;
}

test('pull 默认只列清单：不写本地、不建备份', async () => {
  await withServer({}, async srv => {
    seedDoc(srv, { id: 7001, title: '角色', body: '语雀上的新版本' });
    const root = makeLocalSet({ '角色.md': '本地旧版' });

    const r = await runCli(apiArgs(srv, ['pull', '--local', root]));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /\[待覆盖\] 角色/);
    assert.strictEqual(fs.readFileSync(path.join(root, '设定', '角色.md'), 'utf-8'), '本地旧版');
    assert.ok(!fs.existsSync(path.join(root, '设定', '.sync-backup')), '预演不该建备份');
  });
});

test('pull --write 覆盖本地，旧版进 .sync-backup，备份区不污染对账', async () => {
  await withServer({}, async srv => {
    seedDoc(srv, { id: 7002, title: '角色', body: '语雀上的新版本' });
    const root = makeLocalSet({ '角色.md': '本地旧版' });

    const r = await runCli(apiArgs(srv, ['pull', '--local', root, '--write']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /\[覆盖\] 角色/);
    assert.strictEqual(fs.readFileSync(path.join(root, '设定', '角色.md'), 'utf-8'), '语雀上的新版本\n');

    const stamps = fs.readdirSync(path.join(root, '设定', '.sync-backup'));
    assert.strictEqual(stamps.length, 1);
    const bak = path.join(root, '设定', '.sync-backup', stamps[0], '角色.md');
    assert.strictEqual(fs.readFileSync(bak, 'utf-8'), '本地旧版', '备份必须是覆盖前的旧版');

    const audit = await runCli(apiArgs(srv, ['audit', '--local', root, '--json']));
    const out = JSON.parse(audit.stdout);
    assert.deepStrictEqual(out.localMissing, [], '备份文件不该被当成待补档案');
    assert.ok(out.same.some(x => x.title === '角色'));
  });
});

test('pull 内容一致就跳过，不留备份', async () => {
  await withServer({}, async srv => {
    seedDoc(srv, { id: 7003, title: '角色', body: '一样的内容' });
    const root = makeLocalSet({ '角色.md': '一样的内容' });

    const r = await runCli(apiArgs(srv, ['pull', '--local', root, '--write']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /一致跳过 1/);
    assert.ok(!fs.existsSync(path.join(root, '设定', '.sync-backup')));
  });
});

test('pull 遇到 lake 文档拒写，本地不动', async () => {
  await withServer({}, async srv => {
    seedDoc(srv, { id: 7004, title: '角色', body: '<p>语雀编辑器版本</p>', format: 'lake' });
    const root = makeLocalSet({ '角色.md': '本地内容' });

    const r = await runCli(apiArgs(srv, ['pull', '--local', root, '--write']));
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /lake 格式/);
    assert.strictEqual(fs.readFileSync(path.join(root, '设定', '角色.md'), 'utf-8'), '本地内容');
  });
});

test('pull 绝不碰正文：语雀正文是剥过 CHANGES 的上传版', async () => {
  await withServer({}, async srv => {
    srv.state.toc.push({ uuid: 't-body', type: 'TITLE', title: '正文', parent_uuid: '' });
    seedDoc(srv, { id: 7101, title: '第001章 起点', body: '语雀上传版', parentUuid: 't-body' });

    const root = tmpDir('nw-yq-');
    const chapter = path.join(root, '第001章 起点.md');
    const full = '正文\n\n---CHANGES---\n- 埋下断锋剑\n---END CHANGES---\n';
    fs.writeFileSync(chapter, full, 'utf-8');

    const r = await runCli(apiArgs(srv, ['pull', '--local', root, '--write']));
    assert.strictEqual(r.code, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(chapter, 'utf-8'), full, '完整版正文（含 CHANGES）不能被覆盖');
    assert.ok(!/第001章/.test(r.stdout), '正文不该出现在 pull 清单里');
  });
});

test('pull 单篇失败不中断，其余照写，最后 exit 1', async () => {
  await withServer({}, async srv => {
    seedDoc(srv, { id: 7201, title: '角色', body: '语雀角色新版' });
    seedDoc(srv, { id: 7202, title: '地点', body: '<p>lake</p>', format: 'lake' });
    const root = makeLocalSet({ '角色.md': '旧角色', '地点.md': '旧地点' });

    const r = await runCli(apiArgs(srv, ['pull', '--local', root, '--write']));
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /1 篇没拉成/);
    assert.strictEqual(fs.readFileSync(path.join(root, '设定', '角色.md'), 'utf-8'), '语雀角色新版\n', '好的那篇要写进去');
    assert.strictEqual(fs.readFileSync(path.join(root, '设定', '地点.md'), 'utf-8'), '旧地点');
  });
});
