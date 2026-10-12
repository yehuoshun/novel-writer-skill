#!/usr/bin/env node
/**
 * 阶段四配置自动回写（2026-10-12 P2-7 落地）——把「手改 config JSON」变成一条命令
 *
 * 背景：第23章回写时 config 的 current_chapter/written_chapters/total_words 全手工改，
 *   容易漏（written_chapters 忘了 push 新章）。本脚本从正文目录自动算这三个字段；
 *   爽点/钩子/情绪峰值是 LLM 判断，通过参数显式传入（脚本不猜）。
 *
 * 用法:
 *   node scripts/finalize-config.js <config.json> <小说目录> \
 *     [--chapter 24] \
 *     [--sweet-spot "扮猪吃虎"] \
 *     [--hook-start "悬念钩,强"] [--hook-end "危机钩,强"] \
 *     [--emotion "危急,9"]
 *
 * 行为:
 *   - current_chapter：--chapter 优先，否则取目录中最大章号（第NNN章）
 *   - written_chapters：目录中全部章号，升序
 *   - total_words：目录中全部正文（第NNN章*.md，排除 上传版/备份/润色版）汉字数总和
 *   - --sweet-spot/--hook-start/--hook-end/--emotion：写 info.last_*（含 chapter 字段）
 *   - 每次运行把 info 里 4 个 consecutive_* 重置为 0（新章不再连续）
 *   - 只动 info.*，其余配置块（writing/yuque/local/backup）不动
 *
 * 退出码: 0=成功, 1=失败, 2=用法错误
 */
'use strict';
const fs = require('fs');
const path = require('path');

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

const [cfgPath, novelDir] = process.argv.slice(2, 4);
if (!cfgPath || !novelDir) {
  console.error('用法: node scripts/finalize-config.js <config.json> <小说目录> [--chapter N] [--sweet-spot 类型] [--hook-start 类型,强度] [--hook-end 类型,强度] [--emotion 情绪,强度]');
  process.exit(2);
}
if (!fs.existsSync(cfgPath)) die(`配置文件不存在: ${cfgPath}`, 2);
if (!fs.existsSync(novelDir)) die(`小说目录不存在: ${novelDir}`, 2);

const a = argParse(process.argv.slice(4));
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
const info = cfg.info;
if (!info) die('配置缺 info 块');

// 1. 正文文件：第NNN章*.md（排除 上传版/备份/润色版/旧版/初稿/三轮版/版本）
const files = fs.readdirSync(novelDir).filter(f =>
  /^第\d+章 .+\.md$/.test(f) && !/(上传版|备份|润色版|旧版|初稿|三轮版|版本)/.test(f));
if (!files.length) die('目录里没有 第NNN章*.md 正文文件');

const chapters = files
  .map(f => Number((f.match(/^第(\d+)章/) || [])[1]))
  .filter(n => !Number.isNaN(n))
  .sort((x, y) => x - y);

const totalWords = files.reduce((sum, f) => {
  const body = fs.readFileSync(path.join(novelDir, f), 'utf-8').split('---CHANGES---')[0];
  return sum + (body.match(/[\u4e00-\u9fff]/g) || []).length;
}, 0);

// 2. 应用字段
const changes = [];
const setInt = (k, v) => { if (typeof v === 'number') { info[k] = v; changes.push(`${k}=${v}`); } };

const chapter = a.chapter !== undefined ? Number(a.chapter) : chapters[chapters.length - 1];
if (Number.isNaN(chapter)) die('--chapter 不是数字');
setInt('current_chapter', chapter);
info.written_chapters = chapters;
changes.push(`written_chapters=${chapters.join(',')}`);
setInt('total_words', totalWords);

const pair = (s) => s.split(',').map(x => x.trim());
if (a['sweet-spot'] !== undefined) {
  info.last_sweet_spot = { chapter, type: String(a['sweet-spot']) };
  changes.push(`last_sweet_spot={${a['sweet-spot']}}`);
}
if (a['hook-start'] !== undefined) {
  const [type, strength] = pair(a['hook-start']);
  info.last_hook_start = { chapter, type, strength };
  changes.push(`last_hook_start={${type},${strength}}`);
}
if (a['hook-end'] !== undefined) {
  const [type, strength] = pair(a['hook-end']);
  info.last_hook_end = { chapter, type, strength };
  changes.push(`last_hook_end={${type},${strength}}`);
}
if (a.emotion !== undefined) {
  const [emotion, intensity] = pair(a.emotion);
  info.last_emotion_peak = { chapter, emotion, intensity: Number(intensity) };
  changes.push(`last_emotion_peak={${emotion},${intensity}}`);
}
// 连续计数器：新章一律重置
for (const k of ['consecutive_no_spot', 'consecutive_same_type', 'consecutive_weak_hooks', 'consecutive_flat_emotion']) {
  if (info[k] !== undefined) { info[k] = 0; changes.push(`${k}=0`); }
}

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`✅ 配置已回写（${cfgPath}）`);
console.log(`   ${changes.join(' | ')}`);
console.log(`   （其余 info 字段未动；writing/yuque/local 块未动）`);
process.exit(0);
