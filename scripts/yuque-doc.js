#!/usr/bin/env node
/**
 * 语雀文档工具 — 把「创建 → 挂载」一步封装，绕开 mcporter 数组参数坑
 *
 * 背景（2026-10-12 ch023 实弹）：
 *   - yuque_create_doc 的 parent_uuid 参数不生效，创建的文档落在 TOC 根部
 *   - TOC 挂载 appendNode + doc_ids 对「已在根部的 doc」无效，正确姿势是
 *     PUT /toc {"action":"appendNode","action_mode":"child","target_uuid":"<分组uuid>","node_uuid":"<TOC节点uuid>"}
 *     （node_uuid 是 TOC 节点 uuid，不是 doc_id）
 *   - mcporter 的 key=value 传数组参数会变形，--args JSON 才稳；本脚本直接用 REST API 免这层坑
 *
 * 用法:
 *   node scripts/yuque-doc.js ls-groups --book 84415848
 *   node scripts/yuque-doc.js create-mount --book 84415848 --title "第024章 xxx" --file /path/正文.md --group 正文
 *
 * 选项:
 *   --book <id|namespace>  知识库（必填）
 *   --title <标题>         新文档标题（create-mount 必填）
 *   --file <路径>          markdown 正文文件（create-mount 必填）
 *   --group <分组标题>     目标分组标题（默认 TOC 根；用 title 查 uuid）
 *   --group-uuid <uuid>    目标分组 uuid（优先于 --group，可跳过 TOC 查找）
 *   --config <路径>        yuque-mcp config.json（默认 skills/yuque-ai-mcp/config/config.json）
 *
 * 退出码: 0=成功, 1=业务失败, 2=用法错误
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEF_CONFIG = path.join(__dirname, '../../yuque-ai-mcp/config/config.json');

function die(msg, code = 2) { console.error(`❌ ${msg}`); process.exit(code); }

function argParse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true;
      else { out[k] = v; i++; }
    }
  }
  return out;
}

function loadCfg(p) {
  if (!fs.existsSync(p)) die(`config 不存在: ${p}`);
  const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const tok = c.token || c.api_token || '';
  if (!tok) die(`config 里没有 token: ${p}`);
  return { token: tok, base: (c.api_base || 'https://www.yuque.com/api/v2').replace(/\/$/, '') };
}

async function api(cfg, method, urlPath, bodyObj) {
  const res = await fetch(`${cfg.base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': cfg.token },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!res.ok) {
    const msg = data && data.detail ? data.detail : (data && data.message ? data.message : raw.slice(0, 200));
    die(`${method} ${urlPath} 失败 (${res.status}): ${msg}`, 1);
  }
  return data;
}

async function getToc(cfg, book) {
  const d = await api(cfg, 'GET', `/repos/${book}/toc`);
  return d.data || [];
}

function findGroup(toc, title) {
  return toc.find(n => n.type === 'TITLE' && n.title === title) || null;
}

// 本地↔语雀映射（audit/sync 共用）：标题规范化匹配 + 路径分组校验（方案 A 镜像）+ 正文对账
// 本地不存 changes（2026-10-12 老板定：changes 由语雀权威备份），故不对账 changes
// 返回 { ok:[{local, yqTitle, docId}], localMissing:[], yqMissing:[] }
async function buildMapping(cfg, book, localDir) {
  const setDir = path.join(localDir, '设定');
  const toc = await getToc(cfg, book);
  const yqDocs = toc.filter(n => n.type === 'DOC');
  const norm = (t) => (t || '')
    .replace(/（第\d+章[^）]*）$/, '')
    .replace(/（截止第\d+章）$/, '')
    .replace(/^第\d+章\s*/, '')
    .trim();
  const yqByNorm = new Map();
  for (const n of yqDocs) yqByNorm.set(norm(n.title), n);

  const ok = [], localMissing = [], yqMissing = [];
  const localAll = new Set();

  // A. 设定档：设定/*.md 扁平 + 子目录（伏笔追踪/大纲/变更日志）
  const flat = [], sub = [];
  (function walk(d, rel) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'changes') walk(p, rel + e.name + '/'); continue; }
      if (e.name.endsWith('.md')) {
        if (rel === '') flat.push(e.name.slice(0, -3));
        else sub.push({ rel: rel + e.name, base: e.name.slice(0, -3) });
      }
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
    // 路径分组校验（方案 A 镜像）：本地 rel 首目录 应等于 语雀所属分组
    const localGroup = f.rel.split('/')[0];
    const yqGroup = (() => { const p = toc.find(x => x.uuid === n.parent_uuid); return p ? p.title : ''; })();
    if (localGroup !== yqGroup) {
      localMissing.push(`设定/${f.rel}（路径分组「${localGroup}」≠ 语雀分组「${yqGroup}」——需挪目录或调整语雀）`);
      continue;
    }
    ok.push({ local: path.join(setDir, f.rel), yqTitle: n.title, docId: n.doc_id });
  }

  // C. 正文对账（本地非上传版 vs 语雀正文分组）
  const contentGroup = toc.find(n => n.type === 'TITLE' && n.title === '正文');
  const contentTitles = new Set(toc.filter(n => n.parent_uuid === contentGroup.uuid).map(n => n.title));
  const bodyFiles = fs.readdirSync(localDir).filter(f =>
    /^第\d+章 .+\.md$/.test(f) && !/(上传版|备份|润色版|旧版|初稿|三轮版|版本)/.test(f));
  for (const f of bodyFiles) {
    const t = f.slice(0, -3);
    if (contentTitles.has(t)) ok.push({ local: path.join(localDir, f), yqTitle: t, docId: null, isBody: true });
    else localMissing.push(`正文/${f}（语雀正文分组无「${t}」）`);
  }
  for (const cd of toc.filter(n => n.parent_uuid === contentGroup.uuid)) {
    const localFile = bodyFiles.find(f => f.slice(0, -3) === cd.title);
    if (!localFile) yqMissing.push(`正文/${cd.title}（本地无同名非上传版正文）`);
  }

  // D. 语雀有本地无（设定档，排除语雀特有/正文/changes/状态快照）
  for (const n of yqDocs) {
    const nn = norm(n.title);
    if (nn === '' || nn === '章节摘要' || nn.startsWith('ch') || /^第\d+章/.test(n.title)) continue;
    if (/^状态快照/.test(n.title)) { if (!fs.existsSync(path.join(setDir, '状态快照.md'))) yqMissing.push(`状态快照（语雀有 ${n.title}）`); continue; }
    if (nn === '简介' || nn === '地点关系图') continue;
    if (!localAll.has(nn)) yqMissing.push(`${n.title}（语雀 ${n.title} 本地无）`);
  }
  return { ok, localMissing, yqMissing };
}

async function main() {
  const a = argParse(process.argv.slice(2));
  const sub = process.argv[2];
  const book = a.book;
  if (!book) die('缺少 --book');
  const cfg = loadCfg(a.config || DEF_CONFIG);

  if (sub === 'ls-groups') {
    const toc = await getToc(cfg, book);
    console.log('📁 知识库分组（TITLE 节点）:');
    for (const n of toc) if (n.type === 'TITLE') console.log(`  ${n.title}  →  ${n.uuid}`);
    return;
  }

  if (sub === 'create-mount') {
    const title = a.title, file = a.file;
    if (!title) die('缺少 --title');
    if (!file) die('缺少 --file');
    if (!fs.existsSync(file)) die(`正文文件不存在: ${file}`);
    const body = fs.readFileSync(file, 'utf-8');
    // 方案 A 镜像：--local <小说根目录> 时，从 file 相对路径自动推分组（免手动 --group）
    if (!a.group && a.local) {
      const rel = path.relative(path.resolve(a.local), path.resolve(file));
      const seg = rel.split(path.sep);
      if (seg[0] === '设定' && seg.length >= 3) a.group = seg[1];
    }

    // 1. 创建文档（parent_uuid 参数实测不生效，创建后落在 TOC 根）
    const created = await api(cfg, 'POST', `/repos/${book}/docs`, { title, format: 'markdown', body });
    const docId = created.data && created.data.id;
    if (!docId) die('创建文档失败：响应无 doc id');
    console.log(`✅ 已创建 DOC: ${title} (doc_id=${docId})`);

    // 2. 查目标分组 uuid
    let targetUuid = a['group-uuid'];
    if (!targetUuid && a.group) {
      const toc = await getToc(cfg, book);
      const g = findGroup(toc, a.group);
      if (!g) {
        console.error(`⚠️ 分组「${a.group}」不存在，可用分组:`);
        for (const n of toc) if (n.type === 'TITLE') console.error(`  ${n.title}`);
        console.error(`文档已创建但未挂载（doc_id=${docId}），可重跑本命令修正 --group`);
        process.exit(1);
      }
      targetUuid = g.uuid;
    }
    if (!targetUuid) { console.log(`ℹ️ 未指定分组，文档留在 TOC 根（doc_id=${docId}）`); return; }

    // 3. 查新文档的 TOC 节点 uuid（REST POST /docs 创建后不进 TOC——2026-10-12 实测，
    //    与 mcporter 的 create_doc 行为不同——需先 appendNode 挂根再移动）
    // 创建后立刻查 TOC 可能命中缓存（2026-10-12 实弹：POST /docs 后 GET /toc 查不到新 doc），
    // appendNode 挂根后重试 3 次（间隔 600ms）再放弃
    const findNode = async () => (await getToc(cfg, book)).filter(n => n.doc_id === docId).pop();
    let node = await findNode();
    if (!node) {
      await api(cfg, 'PUT', `/repos/${book}/toc`, { action: 'appendNode', action_mode: 'sibling', type: 'DOC', doc_ids: [docId] });
      for (let i = 0; i < 3 && !node; i++) {
        await new Promise(r => setTimeout(r, 600));
        node = await findNode();
      }
    }
    if (!node || !node.uuid) die(`找不到新文档的 TOC 节点 (doc_id=${docId})`);

    // 4. 移动到目标分组
    await api(cfg, 'PUT', `/repos/${book}/toc`, {
      action: 'appendNode', action_mode: 'child', type: 'DOC',
      target_uuid: targetUuid, node_uuid: node.uuid,
    });
    console.log(`✅ 已挂载 → 分组「${a.group || targetUuid}」（doc_id=${docId}, node=${node.uuid}）`);
    return;
  }

  if (sub === 'audit') {
    const localDir = a.local;
    if (!localDir) die('缺少 --local <小说根目录>（含 设定/ 与 第NNN章*.md）');
    if (!fs.existsSync(localDir)) die(`本地目录不存在: ${localDir}`);
    const { ok, localMissing, yqMissing } = await buildMapping(cfg, book, localDir);
    console.log(`\n📋 本地↔语雀对账（book=${book}）`);
    console.log(`\n🟢 两边一致（${ok.length}）:`);
    ok.forEach(x => console.log(`  ${x.isBody ? '正文/' : ''}${x.yqTitle} → ${x.yqTitle} (${x.docId || '正文'})`));
    console.log(`\n🔴 本地有、语雀无（${localMissing.length}）——需上传/补建:`);
    localMissing.forEach(x => console.log(`  ${x}`));
    console.log(`\n🔵 语雀有、本地无（${yqMissing.length}）——需下载/补档:`);
    yqMissing.forEach(x => console.log(`  ${x}`));
    console.log(`\n（对账按标题匹配，标题不同但内容相同的档会误报——人工核对后再补）`);
    return;
  }

  if (sub === 'sync') {
    const localDir = a.local;
    if (!localDir) die('缺少 --local <小说根目录>');
    if (!fs.existsSync(localDir)) die(`本地目录不存在: ${localDir}`);
    const { ok } = await buildMapping(cfg, book, localDir);
    const targets = ok.filter(x => !x.isBody);  // 正文不进 sync（语雀正文是上传版，本地非上传版含 CHANGES）
    const dryRun = a['dry-run'] === 'true' || a['dry-run'] === true;
    let updated = 0, same = 0, skipped = 0;
    for (const t of targets) {
      if (!t.docId) { skipped++; continue; }
      const localBody = fs.readFileSync(t.local, 'utf-8');
      const r = await api(cfg, 'GET', `/repos/${book}/docs/${t.docId}?raw=1`);
      const yqBody = (r.data && r.data.body) || '';
      // 标题头差异豁免（双向——任一边带「# 标题」行，去标题后相同即视为一致）+ 尾部换行豁免
      const trimEq = (x) => x.replace(/^#\s+.*\n+/, '').replace(/\s+$/, '');
      if (trimEq(yqBody) === trimEq(localBody)) { same++; continue; }
      console.log(`${dryRun ? '[待更新]' : '[更新]'} ${t.yqTitle} (${t.docId})`);
      if (!dryRun) {
        await api(cfg, 'PUT', `/repos/${book}/docs/${t.docId}`, { format: 'markdown', body: localBody });
        updated++;
      } else updated++;
    }
    console.log(`\nsync ${dryRun ? '预演（--dry-run）' : '完成'}: 需更新 ${updated}（含预演），一致跳过 ${same}，跳过正文/无 id ${skipped}`);
    console.log(dryRun ? '加 --dry-run 可预演；确认后去掉即执行' : '✅ 全部档案已与本地对齐（正文除外——正文用 create-mount 上传上传版）');
    return;
  }

  die(`未知子命令「${sub}」。可用: ls-groups / create-mount / audit`);
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
