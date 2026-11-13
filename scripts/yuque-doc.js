#!/usr/bin/env node
/**
 * 语雀文档工具 — 建文档 / 挂目录 / 对账 / 同步，全部走 REST
 *
 * 为什么不走 mcporter：数组参数（doc_ids）在 key=value 里会变形，--args JSON 才稳；
 * 直接打 REST 少一层坑，也方便把重试和校验写死。
 *
 * 调用口径照 code/yuque-ai-mcp（同一套 REST 的另一种封装），要点：
 *   - 30s 超时；网络异常 / 429 / 5xx 退避重试 3 次（1s→2s→4s），400/401/403/404/422 立刻报错
 *   - POST /docs 创建的文档不进目录，必须 appendNode + doc_ids 才生成 TOC 节点
 *   - 移动 DOC 用 node_uuid 直移（语雀 v2 对 DOC 用 doc_ids + target_uuid 不可靠，会挂根/漏挂）
 *   - appendNode 不带 target_uuid 时要把字段整个去掉，不能传 ""（传空串可能清空目录结构）
 *   - TOC 写路径高频写会静默积压：响应是乐观回显，挂载后必须回读 TOC 校验
 *
 * 用法（node scripts/yuque-doc.js <子命令> [选项]）：
 *   ls-groups   列出分组
 *   create-mount 建文档并挂进分组（先定分组再建文档，不留孤儿）
 *   move        把已有文档挪进分组（修挂载失败的孤儿）
 *   audit       本地↔语雀对账
 *   sync        把本地设定档推到语雀
 *   get         取回一篇文档（--out 存文件）
 *
 * 退出码: 0=成功, 1=业务失败（含挂载校验不过）, 2=用法错误
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {
  argParse,
  normTitle,
  findGroup,
  findDocNode,
  findDocByTitle,
  isBodyFile,
  bodiesEqual,
  contentHash,
  groupFromLocalPath,
  formatApiError,
} = require('./lib/yuque-toc');

const DEF_CONFIG = path.join(__dirname, '../../yuque-ai-mcp/config/config.json');
const DEFAULT_BASE = 'https://www.yuque.com/api/v2';
const MAX_RETRIES = intEnv('YUQUE_MAX_RETRIES', 3);
const RETRY_BASE_MS = intEnv('YUQUE_RETRY_BASE_MS', 1000);
const TIMEOUT_MS = intEnv('YUQUE_TIMEOUT_MS', 30000);
const MOUNT_POLL_MS = intEnv('YUQUE_POLL_MS', 600);
const SYNC_DELAY_MS = 200;

const USAGE = `
语雀文档工具（设定档 / 正文的上传、挂载、对账、同步）

用法: node scripts/yuque-doc.js <子命令> --book <id|namespace> [选项]

子命令:
  help          显示本说明
  ls-groups     列出知识库里的分组（TITLE 节点）与它们下面的文档
  create-mount  新建文档并挂进分组（先确认分组存在，再建文档，建完回读校验）
  move          把已存在的文档挪进分组（挂载失败留下的孤儿用它修）
  audit         本地 ↔ 语雀 对账（本地有语雀无 / 语雀有本地无 / 两边一致）
  sync          把本地设定档推到语雀（正文除外；按内容比对，只写有差异的）
  pull          把语雀设定档拉回本地（默认只列清单；两边都改过会跳过，--force 才盖）
  get           取回一篇文档的正文

通用选项:
  --book <id|namespace>   知识库（必填；也可由 --novel-config 的 yuque.book 提供）
  --config <路径>         语雀 token 配置（默认 code/yuque-ai-mcp/config/config.json）
  --token <token>         覆盖 token（测试用，避免读真实凭据）
  --api-base <url>        覆盖 API 地址（默认 ${DEFAULT_BASE}）
  --json                  机器可读输出

create-mount / move:
  --title <标题>          新文档标题（create-mount 必填）
  --file <路径>           markdown 正文（create-mount 必填）
  --doc <doc_id|标题>     要挪的文档（move 必填）
  --group <分组标题>      目标分组
  --group-uuid <uuid>     目标分组 uuid（省一次 TOC 查找）
  --group-key <键>        从小说配置的 yuque.groups 里取 uuid（如 content / characters）
  --novel-config <路径>   小说 config.json（提供 book 与 groups）
  --local <小说根目录>    按方案 A 镜像从 --file 的相对路径自动推分组
  --create-group          目标分组不存在时顺手建一个

audit / sync / pull / get:
  --local <小说根目录>    含 设定/ 与 第NNN章*.md（audit、sync、pull 必填）
  --dry-run               sync 只列要改的，不写
  --write                 pull 真落盘（默认只列清单）
  --force                 pull 连「两边都改过」的档案也盖（默认跳过等你看）
  --only <关键字>         sync / pull 只处理标题含该关键字的档案
  --doc <doc_id|标题>     get 要取的文档
  --out <路径>            get 存到文件（不传则打印正文）

环境变量（测试用）: YUQUE_MAX_RETRIES / YUQUE_RETRY_BASE_MS / YUQUE_TIMEOUT_MS / YUQUE_POLL_MS

退出码: 0=成功, 1=业务失败（含挂载回读校验不过）, 2=用法错误
`.trim();

function intEnv(name, def) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

// 不用 process.exit：Windows 上管道输出可能被截断，改成抛 silent 错误由底部统一收口
function die(msg, code = 2) {
  console.error(`❌ ${msg}`);
  const e = new Error('exit');
  e.silent = true;
  e.exitCode = code;
  throw e;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isOn(v) {
  return v === true || v === 'true' || v === '1' || v === 'yes';
}

function strOpt(opts, key) {
  return typeof opts[key] === 'string' && opts[key].trim() ? opts[key].trim() : '';
}

// ---- 配置 ----

function loadConfig(opts) {
  const p = strOpt(opts, 'config') || DEF_CONFIG;
  let c = {};
  if (fs.existsSync(p)) {
    try { c = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { die(`config 不是合法 JSON: ${p}（${e.message}）`); }
  } else if (opts.config) {
    die(`config 不存在: ${p}`);
  }
  const token = strOpt(opts, 'token') || c.token || c.api_token || '';
  if (!token || /在此填入/.test(token)) {
    die(`没有可用的 token：检查 ${p} 里的 token（或传 --token）`);
  }
  const base = (strOpt(opts, 'api-base') || c.api_base || DEFAULT_BASE).replace(/\/+$/, '');
  return { token, base, source: p };
}

function loadNovelConfig(opts) {
  const p = strOpt(opts, 'novel-config');
  if (!p) return null;
  if (!fs.existsSync(p)) die(`小说配置不存在: ${p}`);
  let c;
  try { c = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { die(`小说配置不是合法 JSON: ${p}（${e.message}）`); }
  return { path: p, data: c, yuque: c.yuque || {} };
}

function resolveBook(opts, novel) {
  const direct = strOpt(opts, 'book');
  if (direct) return direct;
  const b = novel && novel.yuque && novel.yuque.book;
  if (typeof b === 'number') return String(b);
  if (b && typeof b === 'object') {
    if (b.book_id) return String(b.book_id);
    if (b.namespace) return String(b.namespace);
    if (b.slug) return String(b.slug);
  }
  if (typeof b === 'string' && b) return b;
  die('缺少 --book（知识库 id 或 namespace；也可用 --novel-config 指向含 yuque.book 的小说配置）');
}

function groupUuidFromKey(opts, novel) {
  const key = strOpt(opts, 'group-key');
  if (!key) return '';
  const groups = novel && novel.yuque && novel.yuque.groups;
  if (!groups) die(`--group-key 需要 --novel-config 指向含 yuque.groups 的小说配置`);
  const uuid = groups[key];
  if (!uuid) {
    die(`小说配置里没有分组键「${key}」。可用: ${Object.keys(groups).join(' / ') || '（空）'}`, 1);
  }
  return String(uuid);
}

// ---- HTTP ----

function bookPath(book) {
  return String(book).split('/').map(encodeURIComponent).join('/');
}

/**
 * 一次请求。软失败（soft）不退出，交给调用方汇总——sync 要逐条报错不中断。
 * 返回 { ok, data } 或 { ok:false, message }。
 */
async function request(cfg, method, urlPath, bodyObj, { soft = false } = {}) {
  const url = `${cfg.base}${urlPath}`;
  const payload = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
  let lastMessage = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.error(`   ↻ ${lastMessage}，${delay}ms 后重试（第 ${attempt}/${MAX_RETRIES} 次）`);
      await sleep(delay);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res, raw;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'X-Auth-Token': cfg.token,
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload,
        signal: ac.signal,
      });
      raw = await res.text();
    } catch (e) {
      lastMessage = e && e.name === 'AbortError'
        ? `${method} ${urlPath} 超时（${TIMEOUT_MS}ms）`
        : `${method} ${urlPath} 连不上（${e.message}）`;
      continue;
    } finally {
      clearTimeout(timer);
    }
    // 429 / 5xx 可重试；其余错误立刻定性，重试也不会变好
    if (res.status === 429 || res.status >= 500) {
      lastMessage = `${method} ${urlPath} ${formatApiError(res.status, raw)}`;
      continue;
    }
    if (!res.ok) {
      const message = `${method} ${urlPath} ${formatApiError(res.status, raw)}`;
      if (soft) return { ok: false, message };
      die(message, 1);
    }
    if (!raw || !raw.trim()) return { ok: true, data: null };
    try {
      return { ok: true, data: JSON.parse(raw) };
    } catch {
      const message = `${method} ${urlPath} 返回的不是 JSON：${raw.slice(0, 160)}`;
      if (soft) return { ok: false, message };
      die(message, 1);
    }
  }
  const message = `${lastMessage}（已重试 ${MAX_RETRIES} 次）`;
  if (soft) return { ok: false, message };
  die(message, 1);
}

async function api(cfg, method, urlPath, bodyObj) {
  const r = await request(cfg, method, urlPath, bodyObj);
  return r.data;
}

function tocOf(data) {
  return Array.isArray(data && data.data) ? data.data : [];
}

async function getToc(cfg, book) {
  return tocOf(await api(cfg, 'GET', `/repos/${bookPath(book)}/toc`));
}

/**
 * 写 TOC。PUT 的响应就是更新后的全量节点数组（官方文档），所以不用再 GET 找 uuid。
 * 注意：payload 里绝不能出现 target_uuid: ''（会清空目录结构），由调用方负责不带该键。
 */
async function putToc(cfg, book, payload) {
  return tocOf(await api(cfg, 'PUT', `/repos/${bookPath(book)}/toc`, payload));
}

// ---- 目录操作 ----

/**
 * 把文档挂进分组：先挂根拿到节点 uuid，再按 node_uuid 直移。
 * 返回 { ok, nodeUuid, parentUuid }；不 ok 时调用方负责提示 move 修。
 */
async function attachDoc(cfg, book, docId, targetUuid) {
  let node = findDocNode(await getToc(cfg, book), docId);

  // 1. 不在 TOC 里就先挂根（POST /docs 不自动进目录）
  if (!node) {
    const t = await putToc(cfg, book, { action: 'appendNode', action_mode: 'child', type: 'DOC', doc_ids: [docId] });
    node = findDocNode(t, docId) || findDocNode(await getToc(cfg, book), docId);
    if (!node) return { ok: false, nodeUuid: null, parentUuid: '', why: '挂到 TOC 根之后仍然找不到节点' };
  }
  if (!targetUuid) return { ok: true, nodeUuid: node.uuid, parentUuid: node.parent_uuid || '' };
  if ((node.parent_uuid || '') === targetUuid) return { ok: true, nodeUuid: node.uuid, parentUuid: targetUuid };

  // 2. node_uuid 直移：语雀 v2 对 DOC 用 doc_ids + target_uuid 会挂根或漏挂
  await putToc(cfg, book, { action: 'appendNode', action_mode: 'child', node_uuid: node.uuid, target_uuid: targetUuid });

  // 3. 回读校验：响应是乐观回显，高频写 TOC 时会静默失败
  const seen = await verifyMount(cfg, book, docId, targetUuid);
  return { ok: seen.ok, nodeUuid: seen.nodeUuid, parentUuid: seen.parentUuid };
}

async function verifyMount(cfg, book, docId, targetUuid) {
  let node = null;
  for (let i = 0; i < 4; i++) {
    if (i > 0) await sleep(MOUNT_POLL_MS);
    node = findDocNode(await getToc(cfg, book), docId);
    if (!node) continue;
    const parent = node.parent_uuid || '';
    if (targetUuid ? parent === targetUuid : !parent) return { ok: true, nodeUuid: node.uuid, parentUuid: parent };
  }
  return { ok: false, nodeUuid: node && node.uuid, parentUuid: (node && node.parent_uuid) || '' };
}

async function ensureGroup(cfg, book, title) {
  const resp = await putToc(cfg, book, { action: 'appendNode', action_mode: 'child', type: 'TITLE', title });
  const node = findGroup(resp, title) || findGroup(await getToc(cfg, book), title);
  if (!node || !node.uuid) {
    die(`建分组「${title}」失败：响应里没有这个节点（TOC 写路径可能积压了，静置 10 分钟再试）`, 1);
  }
  console.log(`✅ 已建分组「${title}」（node=${node.uuid}）`);
  return node.uuid;
}

/** 目标分组：--group-uuid / --group-key > --group > --local 自动推；都给不出就回 TOC 根 */
async function resolveTarget(cfg, book, opts, novel) {
  const byKey = groupUuidFromKey(opts, novel);
  if (byKey) return { uuid: byKey, name: strOpt(opts, 'group') || strOpt(opts, 'group-key') };
  const byUuid = strOpt(opts, 'group-uuid');
  if (byUuid) return { uuid: byUuid, name: strOpt(opts, 'group') || byUuid };

  let name = strOpt(opts, 'group');
  const local = strOpt(opts, 'local');
  const file = strOpt(opts, 'file');
  if (!name && local && file) name = groupFromLocalPath(local, file);
  if (!name) return null;

  const toc = await getToc(cfg, book);
  const found = findGroup(toc, name);
  if (found) return { uuid: found.uuid, name };
  if (isOn(opts['create-group'])) return { uuid: await ensureGroup(cfg, book, name), name, created: true };

  const list = toc.filter(n => n.type === 'TITLE').map(n => `  ${n.title}  →  ${n.uuid}`).join('\n');
  die(`分组「${name}」不存在（文档还没创建，什么都没改）。现有分组：\n${list || '  （这个知识库还没有分组）'}\n加 --create-group 可顺手建，或用 --group-uuid 直接指定`, 1);
}

// ---- 本地 ↔ 语雀映射（audit / sync 共用） ----

/**
 * 本地不存 changes（2026-10-12 定：changes 由语雀权威备份），故不对账 changes。
 * 返回 { ok:[{local,yqTitle,docId,isBody?}], localMissing:[], yqMissing:[] }
 */
async function buildMapping(cfg, book, localDir) {
  const setDir = path.join(localDir, '设定');
  const toc = await getToc(cfg, book);
  const yqDocs = toc.filter(n => n.type === 'DOC');
  const yqByNorm = new Map();
  for (const n of yqDocs) yqByNorm.set(normTitle(n.title), n);

  const ok = [];
  const localMissing = [];
  const yqMissing = [];
  const localAll = new Set();

  // A. 设定档：设定/*.md 扁平 + 子目录（伏笔追踪/大纲/变更日志）
  const flat = [];
  const sub = [];
  (function walk(d, rel) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        // changes 以语雀为权威、点目录（.sync-backup 等）是本工具的备份区，都不参与对账
        if (e.name !== 'changes' && !e.name.startsWith('.')) walk(p, rel + e.name + '/');
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      if (rel === '') flat.push(e.name.slice(0, -3));
      else sub.push({ rel: rel + e.name, base: e.name.slice(0, -3) });
    }
  })(setDir, '');

  for (const name of flat) {
    localAll.add(name);
    const n = yqByNorm.get(name);
    if (!n) localMissing.push(`设定/${name}.md`);
    else ok.push({ local: path.join(setDir, name + '.md'), yqTitle: n.title, docId: n.doc_id });
  }
  for (const f of sub) {
    localAll.add(f.base);
    const n = yqByNorm.get(f.base);
    if (!n) { localMissing.push(`设定/${f.rel}`); continue; }
    // 方案 A 镜像：本地 rel 首目录应等于语雀所属分组
    const localGroup = f.rel.split('/')[0];
    const parent = toc.find(x => x.uuid === n.parent_uuid);
    const yqGroup = parent ? parent.title : '';
    if (localGroup !== yqGroup) {
      localMissing.push(`设定/${f.rel}（路径分组「${localGroup}」≠ 语雀分组「${yqGroup}」——需挪目录或调整语雀）`);
      continue;
    }
    ok.push({ local: path.join(setDir, f.rel), yqTitle: n.title, docId: n.doc_id });
  }

  // C. 正文对账（本地非上传版 vs 语雀「正文」分组）
  const contentGroup = findGroup(toc, '正文');
  const contentNodes = contentGroup
    ? toc.filter(n => n.type === 'DOC' && (n.parent_uuid || '') === contentGroup.uuid)
    : [];
  const contentByTitle = new Map(contentNodes.map(n => [n.title, n]));
  const bodyFiles = fs.readdirSync(localDir).filter(f => isBodyFile(f));
  for (const f of bodyFiles) {
    const t = f.slice(0, -3);
    const n = contentByTitle.get(t);
    if (n) ok.push({ local: path.join(localDir, f), yqTitle: t, docId: n.doc_id, isBody: true });
    else if (!contentGroup) localMissing.push(`正文/${f}（语雀没有「正文」分组）`);
    else localMissing.push(`正文/${f}（语雀正文分组无「${t}」）`);
  }
  for (const n of contentNodes) {
    if (!bodyFiles.some(f => f.slice(0, -3) === n.title)) yqMissing.push(`正文/${n.title}（本地无同名非上传版正文）`);
  }

  // D. 语雀有本地无（设定档，排除语雀特有/正文/changes/状态快照）
  for (const n of yqDocs) {
    const nn = normTitle(n.title);
    if (nn === '' || nn === '章节摘要' || nn.startsWith('ch') || /^第\d+章/.test(n.title)) continue;
    if (/^状态快照/.test(n.title)) {
      if (!fs.existsSync(path.join(setDir, '状态快照.md'))) yqMissing.push(`状态快照（语雀有 ${n.title}）`);
      continue;
    }
    if (nn === '简介' || nn === '地点关系图') continue;
    if (!localAll.has(nn)) yqMissing.push(`${n.title}（语雀 ${n.title} 本地无）`);
  }

  return { ok, localMissing, yqMissing };
}

// ---- 子命令 ----

function printGroups(toc) {
  const groups = toc.filter(n => n.type === 'TITLE');
  if (!groups.length) {
    console.log('📁 这个知识库还没有分组（TITLE 节点）——文档都在 TOC 根上。');
    return;
  }
  console.log('📁 知识库分组（TITLE 节点）:');
  for (const g of groups) {
    const kids = toc.filter(n => n.type === 'DOC' && (n.parent_uuid || '') === g.uuid);
    console.log(`  ${g.title}  →  ${g.uuid}（${kids.length} 篇）`);
    for (const k of kids) console.log(`      · ${k.title} (doc=${k.doc_id})`);
  }
  const rootDocs = toc.filter(n => n.type === 'DOC' && !n.parent_uuid);
  if (rootDocs.length) {
    console.log(`\n  ⚠️ TOC 根上还有 ${rootDocs.length} 篇没归组：`);
    for (const d of rootDocs) console.log(`      · ${d.title} (doc=${d.doc_id}, node=${d.uuid})`);
  }
}

async function cmdLsGroups(cfg, book, opts) {
  const toc = await getToc(cfg, book);
  if (isOn(opts.json)) {
    console.log(JSON.stringify({
      groups: toc.filter(n => n.type === 'TITLE').map(n => ({ title: n.title, uuid: n.uuid })),
      rootDocs: toc.filter(n => n.type === 'DOC' && !n.parent_uuid).map(n => ({ title: n.title, docId: n.doc_id })),
      total: toc.length,
    }, null, 2));
    return 0;
  }
  printGroups(toc);
  return 0;
}

async function cmdCreateMount(cfg, book, opts, novel) {
  const title = strOpt(opts, 'title');
  const file = strOpt(opts, 'file');
  if (!title) die('缺少 --title');
  if (!file) die('缺少 --file');
  if (!fs.existsSync(file)) die(`正文文件不存在: ${file}`, 1);
  const body = fs.readFileSync(file, 'utf-8');
  if (!body.trim()) die(`正文是空的: ${file}`, 1);

  // 1. 先定分组——分组不存在就在建文档之前失败，不留孤儿 DOC
  const target = await resolveTarget(cfg, book, opts, novel);
  if (!target) console.log('ℹ️ 没指定分组，文档会留在 TOC 根');

  // 2. 建文档（format=markdown；POST /docs 不会自动进目录）
  const created = await api(cfg, 'POST', `/repos/${bookPath(book)}/docs`, {
    title,
    format: 'markdown',
    body,
  });
  const docId = created && created.data && created.data.id;
  if (!docId) die('建文档失败：响应里没有 doc id', 1);
  console.log(`✅ 已建文档：${title}（doc_id=${docId}）`);

  // 3. 挂进分组并回读校验
  const res = await attachDoc(cfg, book, docId, target ? target.uuid : '');
  if (!res.ok) {
    console.error(`❌ 文档建好了，但挂载回读校验没过（现在在「${res.parentUuid || 'TOC 根'}」，目标「${target.name}」）。`);
    console.error('   语雀 TOC 写路径高频写时会静默积压（要静置 ~10 分钟）。等一会儿再修：');
    console.error(`   node scripts/yuque-doc.js move --book ${book} --doc ${docId} --group-uuid ${target.uuid}`);
    return 1;
  }
  if (target) console.log(`✅ 已挂进分组「${target.name}」（node=${res.nodeUuid}）`);
  if (isOn(opts.json)) console.log(JSON.stringify({ docId, nodeUuid: res.nodeUuid, group: target ? target.name : null }, null, 2));
  return 0;
}

async function cmdMove(cfg, book, opts, novel) {
  const ref = strOpt(opts, 'doc');
  if (!ref) die('缺少 --doc <doc_id|标题>');
  const toc = await getToc(cfg, book);
  const node = /^\d+$/.test(ref) ? findDocNode(toc, ref) : findDocByTitle(toc, ref);
  const docId = node ? node.doc_id : (/^\d+$/.test(ref) ? Number(ref) : 0);
  if (!docId) die(`语雀里找不到「${ref}」对应的文档`, 1);

  const target = await resolveTarget(cfg, book, opts, novel);
  if (!target) die('缺少目标分组（--group / --group-uuid / --group-key）');
  const res = await attachDoc(cfg, book, docId, target.uuid);
  if (!res.ok) {
    console.error(`❌ 还是没挂上（现在在「${res.parentUuid || 'TOC 根'}」）。TOC 写路径可能积压了，静置 10 分钟重跑同一条命令。`);
    return 1;
  }
  console.log(`✅ ${node ? node.title : 'doc=' + docId} → 分组「${target.name}」（node=${res.nodeUuid}）`);
  return 0;
}

async function cmdAudit(cfg, book, opts) {
  const localDir = strOpt(opts, 'local');
  if (!localDir) die('缺少 --local <小说根目录>（含 设定/ 与 第NNN章*.md）');
  if (!fs.existsSync(localDir)) die(`本地目录不存在: ${localDir}`, 1);
  const { ok, localMissing, yqMissing } = await buildMapping(cfg, book, localDir);

  if (isOn(opts.json)) {
    console.log(JSON.stringify({
      book,
      same: ok.map(x => ({ title: x.yqTitle, docId: x.docId, body: !!x.isBody })),
      localMissing,
      yqMissing,
    }, null, 2));
    return 0;
  }

  console.log(`\n📋 本地↔语雀对账（book=${book}）`);
  console.log(`\n🟢 两边一致（${ok.length}）:`);
  for (const x of ok) console.log(`  ${x.isBody ? '正文/' : ''}${x.yqTitle}（doc=${x.docId}）`);
  console.log(`\n🔴 本地有、语雀无（${localMissing.length}）——需上传/补建:`);
  for (const x of localMissing) console.log(`  ${x}`);
  console.log(`\n🔵 语雀有、本地无（${yqMissing.length}）——需下载/补档:`);
  for (const x of yqMissing) console.log(`  ${x}`);
  console.log('\n（对账按标题匹配，标题不同但内容相同的档会误报——人工核对后再补）');
  return 0;
}

async function cmdSync(cfg, book, opts) {
  const localDir = strOpt(opts, 'local');
  if (!localDir) die('缺少 --local <小说根目录>');
  if (!fs.existsSync(localDir)) die(`本地目录不存在: ${localDir}`, 1);
  const dryRun = isOn(opts['dry-run']);
  const only = strOpt(opts, 'only');

  const { ok } = await buildMapping(cfg, book, localDir);
  // 正文不进 sync：语雀正文是上传版，本地非上传版含 CHANGES
  let targets = ok.filter(x => !x.isBody && x.docId);
  if (only) targets = targets.filter(x => x.yqTitle.includes(only) || x.local.includes(only));
  const skipped = ok.filter(x => !x.isBody && !x.docId).length;

  // 顺手维护同步基线：push 成功后本地=远端，记下来 pull 才知道"是谁改的"
  const state = loadState(localDir);
  let stateDirty = false;

  let updated = 0;
  let same = 0;
  let skippedFormat = 0;
  const failures = [];
  let firstWrite = true;

  for (const t of targets) {
    const localBody = fs.readFileSync(t.local, 'utf-8');
    const r = await request(cfg, 'GET', `/repos/${bookPath(book)}/docs/${t.docId}`, undefined, { soft: true });
    if (!r.ok) { failures.push(`${t.yqTitle}：拉取失败（${r.message}）`); continue; }
    const doc = (r.data && r.data.data) || {};
    // 远端若是 lake（在语雀编辑器里写过），PUT markdown 会把排版冲掉——跳过等人处理
    if (doc.format && doc.format !== 'markdown') {
      failures.push(`${t.yqTitle}：远端是 ${doc.format} 格式，直接推 markdown 会毁排版——请在语雀里改或先转格式`);
      skippedFormat++;
      continue;
    }
    if (bodiesEqual(doc.body || '', localBody)) {
      same++;
      recordBaseline(state, book, t.docId, t.yqTitle, path.relative(localDir, t.local),
        contentHash(localBody), contentHash(doc.body || ''));
      stateDirty = true;
      continue;
    }
    console.log(`${dryRun ? '[待更新]' : '[更新]'} ${t.yqTitle} (${t.docId})`);
    if (dryRun) { updated++; continue; }
    if (!firstWrite) await sleep(SYNC_DELAY_MS);
    firstWrite = false;
    const w = await request(cfg, 'PUT', `/repos/${bookPath(book)}/docs/${t.docId}`, { format: 'markdown', body: localBody }, { soft: true });
    if (!w.ok) { failures.push(`${t.yqTitle}：写入失败（${w.message}）`); continue; }
    recordBaseline(state, book, t.docId, t.yqTitle, path.relative(localDir, t.local),
      contentHash(localBody), contentHash(localBody));
    stateDirty = true;
    updated++;
  }

  if (!dryRun && stateDirty) saveState(localDir, state);

  const summary = { dryRun, targets: targets.length, updated, same, skipped, skippedFormat, failures };
  if (isOn(opts.json)) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\nsync ${dryRun ? '预演（--dry-run）' : '完成'}：需更新 ${updated}，一致跳过 ${same}，无 doc_id 跳过 ${skipped}`);
    if (dryRun) console.log('（预演模式：确认无误后去掉 --dry-run 再跑）');
    else if (!failures.length) console.log('✅ 设定档已与本地对齐（正文不在此列——正文用 create-mount 上传上传版）');
  }
  if (failures.length) {
    console.error(`\n❌ ${failures.length} 篇没同步成：`);
    for (const f of failures) console.error(`   · ${f}`);
    return 1;
  }
  return 0;
}

const BACKUP_DIR = '.sync-backup';

function timestamp() {
  const d = new Date();
  const two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/**
 * 同步基线：记「上次确认两边一致」时的本地/远端正文指纹。
 *
 * 为什么需要它：只比「现在两边一不一样」分不清是谁改的。本地这两天补了两段设定、语雀那头也有人动过，
 * 一次 pull 就把本地改动盖了——备份里有，但得事后自己去翻目录捞。有了基线就能三方对比：
 * 只有语雀动 → 覆盖；只有本地动 → 提示去 sync；两边都动 → 停下来要 --force。
 *
 * 存在小说根目录（不在 设定/ 里），audit/sync 的目录扫描碰不到它。
 */
const STATE_FILE = '.yuque-sync-state.json';

function statePath(localDir) {
  return path.join(localDir, STATE_FILE);
}

function loadState(localDir) {
  const p = statePath(localDir);
  if (!fs.existsSync(p)) return { version: 1, books: {}, firstRun: true };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object' || !raw.books) throw new Error('缺 books 字段');
    return raw;
  } catch (e) {
    console.error(`⚠️ 同步基线读不懂（${STATE_FILE}）：${e.message}——这轮按「没有基线」处理`);
    return { version: 1, books: {}, broken: true };
  }
}

function bookState(state, book) {
  const key = String(book);
  if (!state.books[key] || typeof state.books[key] !== 'object') state.books[key] = { docs: {} };
  if (!state.books[key].docs) state.books[key].docs = {};
  return state.books[key];
}

function recordBaseline(state, book, docId, title, relLocal, localHash, remoteHash) {
  bookState(state, book).docs[String(docId)] = {
    title,
    local: relLocal,
    localHash,
    remoteHash,
    at: new Date().toISOString(),
  };
}

function saveState(localDir, state) {
  // firstRun / broken 是这一轮的临时判断，别写进文件——否则下次读回来永远以为自己是首次
  const { firstRun, broken, ...persisted } = state;
  fs.writeFileSync(statePath(localDir), `${JSON.stringify(persisted, null, 2)}\n`, 'utf-8');
}

/**
 * 反向同步：语雀 → 本地，只碰设定档。
 * 默认 dry-run（列清单不落盘），--write 才写；覆盖前把本地旧版存 设定/.sync-backup/<时间戳>/<相对路径>。
 *
 * 三方对比（靠 STATE_FILE 记的基线）：只有语雀改 → 覆盖；只有本地改 → 提示去 sync、不动它；
 * 两边都改 → 跳过并 exit 1，确认以语雀为准再加 --force。没有基线的档按「不清楚」处理：
 * 首次拉取（状态文件还不存在）照旧覆盖并提示一次；有状态但缺这篇（标题撞车/手工新建）需 --force。
 *
 * 正文永远不参与：语雀正文是 prepare-upload 剥过 CHANGES 的上传版，拉回来会把本地完整版的 CHANGES 抹掉。
 */
async function cmdPull(cfg, book, opts) {
  const localDir = strOpt(opts, 'local');
  if (!localDir) die('缺少 --local <小说根目录>');
  if (!fs.existsSync(localDir)) die(`本地目录不存在: ${localDir}`, 1);
  const write = isOn(opts.write);
  const force = isOn(opts.force);
  const only = strOpt(opts, 'only');

  const { ok } = await buildMapping(cfg, book, localDir);
  let targets = ok.filter(x => !x.isBody && x.docId);
  if (only) targets = targets.filter(x => x.yqTitle.includes(only) || x.local.includes(only));

  const setDir = path.join(localDir, '设定');
  const backupRoot = path.join(setDir, BACKUP_DIR, timestamp());
  const state = loadState(localDir);
  const docs = bookState(state, book).docs;
  let stateDirty = false;
  const failures = [];
  const conflicts = [];
  const localAhead = [];
  let noBaseline = 0;
  let updated = 0;
  let same = 0;
  let backedUp = 0;

  for (const t of targets) {
    const r = await request(cfg, 'GET', `/repos/${bookPath(book)}/docs/${t.docId}`, undefined, { soft: true });
    if (!r.ok) { failures.push(`${t.yqTitle}：拉取失败（${r.message}）`); continue; }
    const doc = (r.data && r.data.data) || {};
    if (doc.format && doc.format !== 'markdown') {
      failures.push(`${t.yqTitle}：远端是 ${doc.format} 格式，拉下来不是 markdown——先在语雀里转回 markdown 或手工处理`);
      continue;
    }
    const remoteBody = doc.body || '';
    if (!remoteBody.trim()) { failures.push(`${t.yqTitle}：远端正文是空的，不拿空内容覆盖本地`); continue; }

    const localBody = fs.readFileSync(t.local, 'utf-8');
    const relLocal = path.relative(localDir, t.local);
    const localHash = contentHash(localBody);
    const remoteHash = contentHash(remoteBody);

    // 两边本来就一致：不动文件，顺手校准基线（sync 过但还没 pull 过的项目全靠这一步建基线）
    if (bodiesEqual(remoteBody, localBody)) {
      same++;
      recordBaseline(state, book, t.docId, t.yqTitle, relLocal, localHash, remoteHash);
      stateDirty = true;
      continue;
    }

    const base = docs[String(t.docId)];
    const localChanged = base ? base.localHash !== localHash : false;
    const remoteChanged = base ? base.remoteHash !== remoteHash : false;

    // 没有基线：首次拉取（状态文件还不存在）照旧覆盖；有状态却缺这篇说明来源不明，要 --force
    if (!base && !state.firstRun && !force) {
      conflicts.push({ title: t.yqTitle, local: relLocal, reason: '无基线' });
      console.log(`⚠️ 跳过：${t.yqTitle}（这篇没有同步基线，分不清是谁改的；确认以语雀为准加 --force）`);
      continue;
    }
    if (base && localChanged && remoteChanged && !force) {
      conflicts.push({ title: t.yqTitle, local: relLocal, reason: '两边都改过' });
      console.log(`⚠️ 跳过：${t.yqTitle}（本地和语雀都改过；确认以语雀为准加 --force，本地版本在备份里）`);
      continue;
    }
    if (base && localChanged && !remoteChanged && !force) {
      localAhead.push({ title: t.yqTitle, local: relLocal });
      console.log(`⚠️ 本地比语雀新：${t.yqTitle}（这篇该跑 sync 推上去，pull 不动它）`);
      continue;
    }
    if (!base) noBaseline++;

    console.log(`${write ? '[覆盖]' : '[待覆盖]'} ${t.yqTitle}（本地 ${localBody.trim().length} 字 → 语雀 ${remoteBody.trim().length} 字）`);
    if (!write) { updated++; continue; }
    const bak = path.join(backupRoot, path.relative(setDir, t.local));
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.copyFileSync(t.local, bak);
    backedUp++;
    fs.writeFileSync(t.local, remoteBody.endsWith('\n') ? remoteBody : `${remoteBody}\n`, 'utf-8');
    recordBaseline(state, book, t.docId, t.yqTitle, relLocal, remoteHash, remoteHash);
    stateDirty = true;
    updated++;
  }

  if (write && stateDirty) saveState(localDir, state);

  const summary = {
    write,
    targets: targets.length,
    updated,
    same,
    backedUp,
    noBaseline,
    conflicts,
    localAhead,
    backupDir: backedUp ? path.relative(localDir, backupRoot) : null,
    failures,
  };
  if (isOn(opts.json)) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\npull ${write ? '完成' : '预演（默认只列清单）'}：${write ? '覆盖' : '待覆盖'} ${updated}，一致跳过 ${same}，备份 ${backedUp}`);
    if (backedUp) console.log(`🗂 本地旧版已存 ${path.relative(localDir, backupRoot)}/（要还原就拷回去）`);
    if (!write && updated) console.log('（确认清单无误后加 --write 落盘；正文不在 pull 范围内）');
    if (write && state.firstRun && (updated || same)) {
      console.log(`ℹ️ 已建同步基线 ${STATE_FILE}：以后 pull 能分辨「本地改的」和「语雀改的」，两边都动过就停下来等你定`);
    }
    if (localAhead.length) {
      console.log(`⚠️ ${localAhead.length} 篇本地比语雀新，该跑 sync：${localAhead.map(x => x.title).join('、')}`);
    }
    if (conflicts.length) {
      console.log(`⚠️ ${conflicts.length} 篇没敢动（两边都改过或无基线）：${conflicts.map(x => x.title).join('、')}——确认以语雀为准就加 --force`);
    }
  }
  if (failures.length) {
    console.error(`\n❌ ${failures.length} 篇没拉成：`);
    for (const f of failures) console.error(`   · ${f}`);
  }
  if (failures.length || conflicts.length) return 1;
  return 0;
}

async function cmdGet(cfg, book, opts) {
  const ref = strOpt(opts, 'doc');
  if (!ref) die('缺少 --doc <doc_id|标题>');
  let docRef = ref;
  if (!/^\d+$/.test(ref)) {
    const node = findDocByTitle(await getToc(cfg, book), ref);
    if (!node) die(`语雀里找不到标题为「${ref}」的文档`, 1);
    docRef = node.doc_id;
  }
  const r = await api(cfg, 'GET', `/repos/${bookPath(book)}/docs/${docRef}`);
  const doc = (r && r.data) || {};
  const out = strOpt(opts, 'out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, doc.body || '', 'utf-8');
    console.log(`✅ 已保存：${out}（${(doc.body || '').length} 字，format=${doc.format || '?'}）`);
    return 0;
  }
  if (isOn(opts.json)) {
    console.log(JSON.stringify({
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      format: doc.format,
      wordCount: doc.word_count,
      updatedAt: doc.updated_at,
      body: doc.body || '',
    }, null, 2));
    return 0;
  }
  if (doc.format && doc.format !== 'markdown') {
    console.error(`⚠️ 这篇在语雀里是 ${doc.format} 格式，body 可能不是 markdown 原文`);
  }
  process.stdout.write(doc.body || '');
  if (!(doc.body || '').endsWith('\n')) process.stdout.write('\n');
  return 0;
}

async function main(argv) {
  const opts = argParse(argv);
  const positionals = opts._;
  const sub = positionals[0];

  if (!sub || sub === 'help' || isOn(opts.help)) {
    console.log(USAGE);
    // 什么都不带时算是用法错误；显式 --help / help 是成功
    return !sub && !isOn(opts.help) ? 2 : 0;
  }
  const known = ['ls-groups', 'create-mount', 'move', 'audit', 'sync', 'pull', 'get'];
  if (!known.includes(sub)) die(`未知子命令「${sub}」。可用: ${known.join(' / ')} / help`);

  const novel = loadNovelConfig(opts);
  const book = resolveBook(opts, novel);
  const cfg = loadConfig(opts);

  if (sub === 'ls-groups') return cmdLsGroups(cfg, book, opts);
  if (sub === 'create-mount') return cmdCreateMount(cfg, book, opts, novel);
  if (sub === 'move') return cmdMove(cfg, book, opts, novel);
  if (sub === 'audit') return cmdAudit(cfg, book, opts);
  if (sub === 'sync') return cmdSync(cfg, book, opts);
  if (sub === 'pull') return cmdPull(cfg, book, opts);
  return cmdGet(cfg, book, opts);
}

main(process.argv.slice(2))
  .then(code => { process.exitCode = code || 0; })
  .catch(e => {
    if (e && e.silent) { process.exitCode = e.exitCode; return; }
    console.error(`❌ ${e && e.stack ? e.stack : e}`);
    process.exitCode = 1;
  });
