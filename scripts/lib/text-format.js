'use strict';
/**
 * 正文排版共享规则（check-indentation.js / prepare-upload.js 共用）
 *
 * 之前两脚本各存一份 isExempt 清单，改一处漏一处必然漂移；抽到此处作单一源头。
 *
 * 规则：正文自然段段首必须是两个全角空格「\u3000\u3000」，否则语雀渲染顶格。
 * 以下行豁免：空行 / 代码围栏与块内 / 标题 / 引用 / 列表 / 表格 / HTML 注释 /
 *            独立加粗行 / 图片 / 场景分隔符。
 */

const INDENT = '\u3000\u3000';

// 场景分隔符（整行只有分隔符）：*** / * * * / --- / ___ / —— / ··· / ＊
// 中文网文常用场景切换符，不该被当成缺缩进的自然段（2026-10-10 实弹暴露）
const SEPARATOR = /^([*＊\-—–_·•=]{3,}|(?:\*\s*){3,}|—{2,}|·{3,})$/;

function isExempt(line, inCodeBlock = false) {
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
  if (SEPARATOR.test(t)) return true;        // 场景分隔符
  return false;
}

module.exports = { INDENT, isExempt, SEPARATOR };
