'use strict';
/**
 * 语雀 TOC / 文档的纯逻辑（yuque-doc.js 专用）
 *
 * 抽出来的理由：标题归一、分组查找、正文档豁免、错误码翻译这几条规则全靠「语雀到底怎么回」的
 * 经验，以前和 fetch 混在一个文件里，改一处只能对着真库手工验证；抽到 lib 后可离线单测。
 *
 * 口径来源：code/yuque-ai-mcp 的 common/api-client.ts、common/errors.ts、common/toc-ops.ts，
 * 以及 references/api/{doc,toc}_api.md（2026-11 对照，行为以官方文档 + 实弹为准）。
 */

const path = require('path');
const crypto = require('crypto');

// HTTP 状态 → 人话（照 MCP common/errors.ts:8-16）
const STATUS_MAP = {
  400: '请求参数不对',
  401: 'token 无效或缺失',
  403: '权限不足（token scope 不够 / 不是该知识库成员）',
  404: '对象不存在（book_id / doc_id 写错了？）',
  422: '参数校验没通过',
  429: '被限流了（已自动退避重试过）',
  500: '语雀服务端错误（已自动重试过）',
  502: '语雀网关错误（已自动重试过）',
  503: '语雀服务不可用（已自动重试过）',
  504: '语雀网关超时（已自动重试过）',
};

// 语雀业务 code → 人话（照 MCP common/errors.ts:18-43，只留会碰到的）
const CODE_MAP = {
  invalid_params: '参数无效（看看是不是 limit 超了 100 / body 不是合法 JSON）',
  not_found: '对象不存在',
  permission_denied: '没有权限（token scope 或知识库成员身份）',
  book_not_found: '知识库不存在（book_id 或 namespace 写错了？）',
  doc_not_found: '文档不存在（doc_id 对不上，可能已被删或换了 uuid）',
  toc_not_found: '目录不存在（book_id 写错了？）',
  slug_conflict: 'slug 冲突：同名文档已存在',
  book_slug_conflict: '知识库 slug 冲突',
  token_expired: 'token 已过期，去语雀设置里重新生成',
  token_invalid: 'token 无效，检查 config 里填的是不是 API Token',
  scope_insufficient: 'token 权限范围不够，重新生成时勾上知识库读写',
  rate_limit: '触发限流，稍后重试',
  too_many_requests: '请求太频繁，稍后重试',
  body_parse_failed: '请求体不是合法 JSON',
  cookie_required: '这个操作需要 cookie + ctoken（config 里补齐这两项）',
  book_full: '知识库文档数到 5000 上限了，API 建不了新文档（官方限制）',
};

/**
 * 解析命令行：支持 `--k v`、`--k=v`、`-h`；`--` 之后全部当位置参数。
 * 位置参数收在 out._ 里。
 */
function argParse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) out[k] = true;
    else { out[k] = v; i++; }
  }
  return out;
}

/**
 * 标题归一：去掉「（第N章 …）」「（截止第N章）」尾巴和「第N章 」前缀。
 * 语雀上同一份档案会随章节改标题（状态快照带「（截止第N章）」），对账得抹平这层。
 */
function normTitle(t) {
  return (t || '')
    .replace(/（第\d+章[^）]*）$/, '')
    .replace(/（截止第\d+章）$/, '')
    .replace(/^第\d+章\s*/, '')
    .trim();
}

/**
 * 找分组（TITLE 节点）。不传 parentUuid 时优先根节点，根上没有才退回任意层级
 * （照 MCP toc-ops.ts:28-41：根节点是 `!parent_uuid`）。
 */
function findGroup(toc, title, parentUuid) {
  const hits = (toc || []).filter(n => n && n.type === 'TITLE' && n.title === title);
  if (parentUuid !== undefined) return hits.find(n => (n.parent_uuid || '') === parentUuid) || null;
  return hits.find(n => !n.parent_uuid) || hits[0] || null;
}

/**
 * 找某个 doc 的 TOC 节点。同一文档可能残留多个节点（挪动失败会留孤儿），取最后一个——
 * 与旧脚本 `.pop()` 的口径一致。
 */
function findDocNode(toc, docId) {
  return (toc || []).filter(n => n && n.type === 'DOC' && Number(n.doc_id) === Number(docId)).pop() || null;
}

/** 按标题找 DOC 节点（精确匹配，供 `get --doc <标题>` 用） */
function findDocByTitle(toc, title) {
  return (toc || []).find(n => n && n.type === 'DOC' && n.title === title) || null;
}

// 正文档：第012章 xxx.md；上传版/备份/润色版等衍生档不进对账（2026-10-12 定）
const BODY_FILE = /^第\d+章 .+\.md$/;
const BODY_VARIANT = /(上传版|备份|润色版|旧版|初稿|三轮版|版本)/;

/** 是不是待对账的正文档（不含上传版等衍生档） */
function isBodyFile(name) {
  return BODY_FILE.test(name) && !BODY_VARIANT.test(name);
}

/**
 * 去掉开头的「# 标题」行与尾部空白。
 * 语雀编辑过的档案常被自动补一行标题头，本地档没有——对账时这一行不算差异。
 */
function stripHeading(text) {
  return (text || '').replace(/^#\s+.*\n+/, '').replace(/\s+$/, '');
}

/** 两份正文是否等价（忽略标题头与尾部空白） */
function bodiesEqual(a, b) {
  return stripHeading(a) === stripHeading(b);
}

/**
 * 正文指纹：按 bodiesEqual 的口径算（先剥标题头与尾部空白），
 * 否则语雀自动补的那行标题头会让「内容其实没变」被当成本地改动。
 * 取 16 位够用了——这是同步基线，不是防篡改。
 */
function contentHash(text) {
  return crypto.createHash('sha1').update(stripHeading(text), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 本地路径 → 语雀分组名（方案 A 镜像：设定/<分组>/xxx.md）。
 * 设定根下的散档与正文档一律回 null（落在 TOC 根或由 --group 显式指定）。
 */
function groupFromLocalPath(localRoot, filePath) {
  const rel = path.relative(path.resolve(localRoot), path.resolve(filePath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const seg = rel.split(path.sep);
  if (seg[0] !== '设定' || seg.length < 3) return null;
  return seg[1];
}

/**
 * HTTP 错误 → 一句人话。语雀的 body 一般是 {status, code, message}，
 * 业务 code（book_not_found 之类）比 HTTP 状态更能定位问题，所以两个都翻。
 */
function formatApiError(status, bodyText) {
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
  const code = body && typeof body.code === 'string' ? body.code : '';
  const raw = body ? (body.message || body.detail || '') : (bodyText || '');
  const message = String(raw).replace(/\s+/g, ' ').trim().slice(0, 160);
  const parts = [`HTTP ${status}${STATUS_MAP[status] ? ` ${STATUS_MAP[status]}` : ''}`];
  if (code) parts.push(CODE_MAP[code] ? `${code}：${CODE_MAP[code]}` : `code=${code}`);
  if (message && message !== code) parts.push(message);
  return parts.join('；');
}

module.exports = {
  STATUS_MAP,
  CODE_MAP,
  argParse,
  normTitle,
  findGroup,
  findDocNode,
  findDocByTitle,
  isBodyFile,
  stripHeading,
  bodiesEqual,
  contentHash,
  groupFromLocalPath,
  formatApiError,
};
