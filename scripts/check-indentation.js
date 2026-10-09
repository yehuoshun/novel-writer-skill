#!/usr/bin/env node
/**
 * 正文段首缩进检测（语雀渲染门禁）
 *
 * 用法:
 *   node check-indentation.js <正文.md>
 *
 * 规则（2026-10-09 实测）：
 *   语雀 markdown 渲染不会自动加首行缩进，正文自然段段首必须是两个全角空格「　　」，
 *   否则页面显示顶格。标题/空行/列表/引用块/表格/代码块/CHANGES 块豁免。
 *
 * 输出: 缺缩进段落行号 + 预览；退出码 0=通过, 1=有缺缩进段落
 */
'use strict';
const fs = require('fs');

if (process.argv.length < 3) {
  console.error('❌ 用法: node check-indentation.js <正文.md>');
  process.exit(2);
}
const PATH = process.argv[2];
if (!fs.existsSync(PATH)) {
  console.error(`❌ 文件不存在: ${PATH}`);
  process.exit(2);
}

const FULL = fs.readFileSync(PATH, 'utf8');
// 只检查 CHANGES 块之前（与 check-consistency.js 口径一致：CHANGES 是协议块，不参与正文排版）
const BODY = FULL.split('---CHANGES---')[0];
const LINES = BODY.split('\n');

const INDENT = '\u3000\u3000';
const problems = [];
let inCodeBlock = false;

function isExempt(line) {
  const t = line.trim();
  if (!t) return true;                       // 空行
  if (inCodeBlock) return true;              // 代码块内部
  if (/^```|^~~~/.test(t)) return true;      // 代码围栏（含结束围栏）
  if (/^#/.test(t)) return true;             // 标题
  if (/^>/.test(t)) return true;             // 引用块
  if (/^[-*+] |^\d+[.、] /.test(t) || /^[-*+]$/.test(t)) return true;  // 列表项
  if (/^\|/.test(t)) return true;            // 表格
  if (/^<!--/.test(t)) return true;          // HTML 注释
  if (/^\*\*.+\*\*$/.test(t)) return true;   // 独立加粗行（如小标题式强调）
  if (/^!\[/.test(t)) return true;           // 图片
  return false;
}

for (let i = 0; i < LINES.length; i++) {
  const line = LINES[i];
  const t = line.trim();

  // 代码围栏切换
  if (/^```|^~~~/.test(t)) {
    inCodeBlock = !inCodeBlock;
    continue;
  }
  if (inCodeBlock) continue;

  if (isExempt(line)) continue;

  // 段首判定：上一行是空行 / 文件开头 / 豁免行 → 当前行为新段落首行
  const prev = i === 0 ? '' : LINES[i - 1];
  const prevExempt = i === 0 || isExempt(prev) || /^```|^~~~/.test(prev.trim());
  if (!prevExempt) continue; // 段内续行，不强制

  if (!line.startsWith(INDENT)) {
    problems.push(`  行 ${i + 1}: 「${t.slice(0, 30)}${t.length > 30 ? '…' : ''}」`);
  }
}

if (problems.length > 0) {
  console.log(`❌ 段首缩进检查未通过（${problems.length} 个自然段缺两全角空格缩进，语雀渲染会顶格）：`);
  for (const p of problems) console.log(p);
  console.log('\n修复：每个自然段落首补两个全角空格「　　」后重跑本脚本');
  process.exit(1);
} else {
  console.log('✅ 段首缩进检查通过（全部自然段带两全角空格缩进）');
  process.exit(0);
}
