#!/usr/bin/env node
/**
 * 正文上传预处理（语雀渲染门禁，2026-10-09 实弹验证）
 *
 * 用法:
 *   node prepare-upload.js <正文.md>            # 纯正文输出到 stdout
 *   node prepare-upload.js <正文.md> <out.md>   # 写入输出文件
 *
 * 做三件事（缺一不可，否则语雀渲染顶格/露协议块）：
 *   1. 剥离 ---CHANGES--- ... ---END CHANGES--- 块（协议不进正文页面，只进 chXXX-changes 文档）
 *   2. 前置占位注释行「<!-- 语雀渲染占位（首段缩进保护） -->」+ 空行——
 *      实测语雀 lake 转换会吃掉「文档第一段」行首的全角空格，注释占位把原第一段变成第二段
 *   3. 段首缩进校验：正文自然段段首必须是两全角空格「　　」（标题/列表/引用/表格/代码块豁免）；
 *      不通过退出码 1，先跑 check-indentation.js 补齐再上传
 *
 * 退出码: 0=通过(输出可上传正文), 1=缩进不通过, 2=用法/文件错误
 */
'use strict';
const fs = require('fs');

const PLACEHOLDER = '<!-- 语雀渲染占位（首段缩进保护） -->';
const INDENT = '\u3000\u3000';

if (process.argv.length < 3) {
  console.error('❌ 用法: node prepare-upload.js <正文.md> [输出.md]');
  process.exit(2);
}
const SRC = process.argv[2];
const OUT = process.argv[3];
if (!fs.existsSync(SRC)) {
  console.error(`❌ 文件不存在: ${SRC}`);
  process.exit(2);
}

const FULL = fs.readFileSync(SRC, 'utf8');
const BODY = FULL.split('---CHANGES---')[0].replace(/\s+$/, '');
const LINES = BODY.split('\n');

// ---- 缩进校验（与 check-indentation.js 同规则）----
let inCodeBlock = false;
const isExempt = (line) => {
  const t = line.trim();
  if (!t || inCodeBlock) return true;
  if (/^```|^~~~/.test(t)) return true;
  if (/^#/.test(t)) return true;
  if (/^>/.test(t)) return true;
  if (/^[-*+] |^\d+[.、] /.test(t) || /^[-*+]$/.test(t)) return true;
  if (/^\|/.test(t)) return true;
  if (/^<!--/.test(t)) return true;
  if (/^\*\*.+\*\*$/.test(t)) return true;
  if (/^!\[/.test(t)) return true;
  return false;
};
const problems = [];
for (let i = 0; i < LINES.length; i++) {
  const line = LINES[i];
  const t = line.trim();
  if (/^```|^~~~/.test(t)) { inCodeBlock = !inCodeBlock; continue; }
  if (inCodeBlock) continue;
  if (isExempt(line)) continue;
  const prev = i === 0 ? '' : LINES[i - 1];
  const prevExempt = i === 0 || isExempt(prev) || /^```|^~~~/.test(prev.trim());
  if (!prevExempt) continue;
  if (!line.startsWith(INDENT)) problems.push(`  行 ${i + 1}: 「${t.slice(0, 30)}${t.length > 30 ? '…' : ''}」`);
}
if (problems.length) {
  console.error(`❌ 缩进不通过（${problems.length} 个自然段缺两全角空格），先跑 check-indentation.js 补齐：`);
  for (const p of problems) console.error(p);
  process.exit(1);
}

const OUT_BODY = PLACEHOLDER + '\n\n' + BODY + '\n';
if (OUT) {
  fs.writeFileSync(OUT, OUT_BODY);
  console.log(`✅ 已生成可上传正文: ${OUT}（${OUT_BODY.length} 字符，CHANGES 已剥离，占位注释已前置）`);
} else {
  process.stdout.write(OUT_BODY);
}
process.exit(0);
