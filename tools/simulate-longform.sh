#!/usr/bin/env bash
# 长篇（50 章）长期积累回归：伏笔状态机跨章 / 快照膨胀 / 跨章位置一致性 / 冲突检测
# 用法: bash tools/simulate-longform.sh
# 设计：机械化生成 50 章（每章正文+CHANGES），逐章跑门禁；不手写正文，专测机器在长跨度下的行为
set +e
# 纯 node：不依赖 python（Windows 的 Git-bash 往往没有 python3）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT
node - <<'JS'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.ROOT;
const CC = path.join(ROOT, 'scripts', 'check-consistency.js');
const CF = path.join(ROOT, 'scripts', 'check-conflicts.js');
const VG = path.join(ROOT, 'scripts', 'verify-gate-report.js');
const N = 50;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-long-'));
const SET = path.join(WORK, '设定');
for (const d of ['角色设定/主角', '地点设定', '物品设定', '伏笔追踪']) fs.mkdirSync(path.join(SET, d), { recursive: true });

const write = (p, s) => fs.writeFileSync(p, s, 'utf8');
const LOCS = ['青云山', '古庙', '天剑宗', '黑风寨', '迷雾森林'];
for (const l of LOCS) write(path.join(SET, '地点设定', `${l}.md`), `# ${l}\n`);
write(path.join(SET, '角色设定', '主角', '林山.md'), '# 林山\n- 发色：黑\n- 瞳色：黑\n');
write(path.join(SET, '角色设定', '主角', '苏瑶.md'), '# 苏瑶\n- 发色：银白\n- 瞳色：蓝\n');
write(path.join(SET, '物品设定', '断锋剑.md'), '# 断锋剑\n');

const pos = { 林山: '—' };
const last = { 林山: 0, 苏瑶: 0 };
const fors = {};           // id -> {name,type,state,plant,prog?,reveal?}
let pending = [];          // 本同新建的伏笔文档（阶段四「回写」时才建档，门禁时尚未存在）
const items = { 断锋剑: '林山' };
let day = 0;
const snapPath = path.join(SET, '状态快照.md');

function writeSnap(ch) {
  const L = [`# 状态快照（截止第${ch}章）`, ''];
  L.push('## 角色状态', '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
    '|------|------|----------|------|------|-----------|');
  for (const [name, p] of Object.entries(pos)) {
    L.push(`| ${name} | 金丹期 | ${p} | 健康 | — | ${last[name]} |`);
  }
  L.push('', '## 角色外貌', '| 角色 | 发色 | 瞳色 | 外貌特征 | 性格标签 |',
    '|------|------|------|----------|----------|',
    '| 林山 | 黑 | 黑 | 剑眉 | 隐忍 |', '| 苏瑶 | 银白 | 蓝 | 冷艳 | 清冷 |');
  L.push('', '## 伏笔状态',
    '| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |',
    '|--------|--------|------|--------------|------|--------|--------|--------|');
  for (const fid of Object.keys(fors).sort()) {
    const f = fors[fid];
    L.push(`| ${fid} | ${f.name} | ${f.type} | 揭晓时震惊 | ${f.state} | ${f.plant} | ${f.prog || '—'} | ${f.reveal || '待定'} |`);
  }
  L.push('', '## 地点状态', '| 地点 | 当前状态 | 触发事件 | 相关章节 |',
    '|------|----------|----------|----------|', '| 青云山 | 正常 | — | 1 |');
  L.push('', '## 物品归属', '| 物品 | 持有者 | 状态 |', '|------|--------|------|');
  for (const [it, o] of Object.entries(items)) L.push(`| ${it} | ${o} | active |`);
  L.push('', '## 时间线（最近一章）', `- 第${day}天：推进`);
  write(snapPath, L.join('\n') + '\n');
}

function changes(ch) {
  const x = ['---CHANGES---', '<!-- 角色状态变化 -->', '- **[林山]**：健康→健康'];
  const to = LOCS[ch % LOCS.length];
  x.push('<!-- 角色移动 -->', `- **[林山]**：${pos.林山}→${to}`);
  pos.林山 = to; last.林山 = ch;
  const plan = {
    1: ['plant', 'v1', '断锋来历', '长线'], 2: ['plant', 'v2', '古庙秘密', '短线'],
    3: ['progress', 'v1', '断锋来历', '长线'], 4: ['plant', 'v3', '掌门失踪', '长线'],
    5: ['harvest', 'v2', '古庙秘密', '短线'], 20: ['harvest', 'v1', '断锋来历', '长线'],
    21: ['progress', 'v1', '断锋来历', '长线'], 22: ['plant', 'v3', '掌门失踪', '长线'],
  };
  let expectFail = false;
  if (plan[ch]) {
    const [act, fid, name, typ] = plan[ch];
    if (act === 'plant') {
      if (fors[fid]) {  // 重复埋设 → 预期打回
        expectFail = true;
        x.push('<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
          `- 🔨埋设 **${fid} ${name}**（类型：${typ}）| 预期读者效果：X | 线索：重复`);
      } else {
        fors[fid] = { name, type: typ, state: '已埋设', plant: ch };
        pending.push([fid, name]);  // 建档延到回写阶段（门禁时不能已存在）
        x.push('<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
          `- 🔨埋设 **${fid} ${name}**（类型：${typ}）| 预期读者效果：X | 线索：初始`);
      }
    } else if (act === 'progress') {
      const state = (fors[fid] || {}).state;
      if (state === '已回收' || state === '已废弃') expectFail = true;  // 终态回退 → 预期打回
      else { fors[fid].state = '已推进'; fors[fid].prog = String(ch); }
      x.push('<!-- 伏笔动作（四态，必须引用伏笔ID） -->', `- ➡️推进 **${fid} ${name}** | 新线索`);
    } else if (act === 'harvest') {
      fors[fid].state = '已回收'; fors[fid].reveal = String(ch);
      x.push('<!-- 伏笔动作（四态，必须引用伏笔ID） -->', `- ✅回收 **${fid} ${name}** | 回收方式：揭晓`);
    }
  }
  if (ch === 6) {  // 物品流转
    items.断锋剑 = '苏瑶';
    x.push('<!-- 物品流转 -->', '- **[断锋剑]**：林山→苏瑶 | 方式：赠送 | 物品状态：完好');
  }
  x.push('<!-- 交接包 -->', `- 剧情当前位置：第${ch}章`, '- 下章该写：继续');
  x.push('---END CHANGES---');
  day += 3;
  return [x.join('\n') + '\n', expectFail];
}

const REPORT = '🛡️ 门禁结果（第X章）\n  ✅ Gate 1-6 写作质量：通过\n  ✅ 引用校验：通过\n'
  + '  ✅ 一致性校验：通过\n  ✅ 描写一致性：通过\n  ✅ 未知实体检测：通过\n'
  + '  ✅ 蓝图出场合规：通过\n  ✅ 伏笔闭环校验：通过\n';
const rep = path.join(WORK, '报告.md'); write(rep, REPORT);

writeSnap(0);  // 初始快照（截止第0章）
let PASS = 0; let FAIL = 0;
function chk(name, cond, extra = '') {
  if (cond) { PASS += 1; console.log(`  ✅ ${name}`); }
  else { FAIL += 1; console.log(`  ❌ ${name} ${extra}`); }
}
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

const t0 = Date.now();
const fails = new Set([21, 22]);
for (let ch = 1; ch <= N; ch += 1) {
  const chap = path.join(WORK, `第${String(ch).padStart(3, '0')}章.md`);
  const [changesTxt] = changes(ch);
  write(chap, `　　第${ch}章的内容。\n${changesTxt}`);
  const r = run(CC, [snapPath, chap, SET]);
  const tag = `ch${String(ch).padStart(2, '0')}`;
  if (fails.has(ch)) {
    chk(`${tag} 预期打回（终态回退/重复埋设）`, r.status === 1, String(r.stderr).slice(0, 120));
  } else {
    chk(`${tag} 一致性通过`, r.status === 0, `${r.stdout}${r.stderr}`.slice(0, 160));
    if (ch === 14) {
      chk('ch14 伏笔 v3 埋设 10 章未推进警告', String(r.stdout).includes('已埋设 10 章未推进'), String(r.stdout).slice(0, 160));
    }
  }
  // 阶段四回写：为本章新建的伏笔建档（门禁时尚未存在，对齐真实时序）
  for (const [fid, name] of pending) write(path.join(SET, '伏笔追踪', `${fid}-${name}.md`), `# ${fid}\n`);
  pending = [];
  writeSnap(ch);  // 回写
  const rc = run(CF, [snapPath, SET]);
  chk(`${tag} 冲突检测通过`, rc.status === 0, String(rc.stderr).slice(0, 120));
  const rv = run(VG, [rep]);
  chk(`${tag} 门禁报告完整`, rv.status === 0, String(rv.stderr).slice(0, 120));
}

const dt = (Date.now() - t0) / 1000;
const size = fs.statSync(snapPath).size;
console.log(`\n最终快照 ${size} 字节（${N} 章后）`);
console.log(`总耗时 ${dt.toFixed(2)}s（平均 ${Math.round((dt / N) * 1000)} ms/章）`);
console.log(`\n===== 结果: PASS=${PASS} FAIL=${FAIL} =====`);
fs.rmSync(WORK, { recursive: true, force: true });
process.exit(FAIL ? 1 : 0);
JS
