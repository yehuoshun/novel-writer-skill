#!/usr/bin/env node
/**
 * 本地备份快照（backup.mode=local 的实现）
 *
 * 用法:
 *   node backup-snapshot.js <config.json> [章节号] [--full]
 *   node backup-snapshot.js <config.json> --full [章节号]
 *
 * 做两件事（按 backup.mode 决定是否执行）：
 *   1. 默认：把「状态快照 + 本章正文 + 本章 chXXX-changes」快照到
 *      <backup.local_path>/<时间戳>-chXXX/（可回滚的单章检查点）
 *   2. --full：额外全量拷贝 正文/ 与 设定/ 两棵目录树
 *
 * 退出码: 0=成功(或以非 local 模式跳过), 1=备份失败, 2=用法/文件错误
 *
 * 由 SKILL 阶段四「状态回写」后调用；失败不阻断写章节流程（见 SKILL）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const full = args.includes('--full');
const pos = args.filter(a => !a.startsWith('--'));
const [cfgPath, chArg] = pos;

if (!cfgPath) {
  console.error('❌ 用法: node backup-snapshot.js <config.json> [章节号] [--full]');
  process.exit(2);
}
if (!fs.existsSync(cfgPath)) {
  console.error(`❌ 配置文件不存在: ${cfgPath}`);
  process.exit(2);
}
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
} catch (e) {
  console.error(`❌ 配置解析失败: ${e.message}`);
  process.exit(2);
}

const mode = cfg.backup && cfg.backup.mode;
if (mode !== 'local') {
  console.log(`ℹ️ backup.mode=${mode || '未设'}，非 local，跳过本地备份（退出码 0，不阻断）`);
  process.exit(0);
}

const lp = cfg.backup.local_path;
if (!lp || !String(lp).trim()) {
  console.error('❌ backup.mode=local 但 backup.local_path 为空（配置校验应已拦，请人工核对）');
  process.exit(1);
}
const abs = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(p)) : null);
const settings = abs(cfg.local && cfg.local.settings_path);
const content = abs(cfg.local && cfg.local.content_path);
const base = abs(lp);

// 章节号：显式参数优先，否则取 config.current_chapter
const chNum = chArg ? parseInt(chArg, 10) : (cfg.info && Number(cfg.info.current_chapter)) || 0;
if (!Number.isFinite(chNum) || chNum < 0) {
  console.error(`❌ 无法确定章节号（参数="${chArg}"，config.current_chapter=${cfg.info && cfg.info.current_chapter}）`);
  process.exit(1);
}
const ch = String(chNum).padStart(3, '0');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
const dest = path.join(base, `${stamp}-ch${ch}`);

const copied = [];
const copyTo = (src, rel) => {
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isFile()) return;
  const to = path.join(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(src, to);
  copied.push(rel);
};
const copyTree = (srcDir, relBase) => {
  if (!srcDir || !fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, e.name);
    const rel = path.join(relBase, e.name);
    if (e.isDirectory()) copyTree(s, rel);
    else copyTo(s, rel);
  }
};

if (full) {
  copyTree(content, '正文');
  copyTree(settings, '设定');
} else {
  // 单章检查点：状态快照 + 本章 changes + 本章正文
  copyTo(settings && path.join(settings, '状态快照.md'), '状态快照.md');
  copyTo(settings && path.join(settings, 'changes', `ch${ch}-changes.md`), path.join('changes', `ch${ch}-changes.md`));
  if (content && fs.existsSync(content)) {
    const re = new RegExp(`^第\\s*0*${chNum}\\s*章`);
    const f = fs.readdirSync(content).find(x => x.endsWith('.md') && re.test(x));
    if (f) copyTo(path.join(content, f), path.join('正文', f));
  }
}

if (copied.length === 0) {
  fs.rmSync(dest, { recursive: true, force: true });
  console.error(`❌ 未找到可备份文件（模式=${full ? 'full' : '单章'}）；核对路径 settings_path=${settings || '-'} content_path=${content || '-'} 章节=${ch}`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(dest, 'manifest.json'),
  JSON.stringify({
    created_at: new Date().toISOString(),
    mode: full ? 'full' : 'chapter',
    chapter: ch,
    source: { settings_path: settings, content_path: content, backup_path: base },
    files: copied,
  }, null, 2) + '\n'
);

console.log(`✅ 备份完成: ${dest}（${copied.length} 个文件，模式=${full ? 'full' : 'chapter'}）`);
for (const f of copied) console.log(`  ${f}`);
process.exit(0);
