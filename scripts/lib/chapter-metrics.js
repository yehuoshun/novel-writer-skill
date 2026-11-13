'use strict';
// 单章指标：发布那一刻量一次，记进账本（chNNN-publish.json 的 metrics 字段）。
// 为什么要落盘：全书体检要从头算一遍字数，正文被手改过之后「发布时到底多少字」就查不到了；
// 账本记下来，跨章趋势才是「当时的事实」而不是「现在的样子」。
//
// 口径只量正文：---CHANGES--- 之后是协议块，不算字数（与 scan-text-health.js 同口径）。
const { bodyOf } = require('./gate-suite');

/** 对话行：整行去掉缩进后以引号开头（「“"），或行内出现成对「」——口语只进对话层，占比是「讲解章」的粗信号 */
const DIALOGUE_LINE = /^\s*(?:[「“"]|[^\n]*「[^」\n]+」)/;

/**
 * 量一章的正文（纯函数，不做 IO）
 * @param {string} text 章节全文（可含 CHANGES 块）
 * @returns {{words:number, chars:number, paragraphs:number, dialogueRatio:number}}
 *   words=汉字数（与门禁同口径） chars=去空白字符数 paragraphs=非空行数 dialogueRatio=对话行占比 0–1（两位小数）
 */
function measureChapter(text) {
  const body = bodyOf(text || '');
  const words = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  const chars = body.replace(/\s+/g, '').length;
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const dialogue = lines.filter((l) => DIALOGUE_LINE.test(l)).length;
  return {
    words,
    chars,
    paragraphs: lines.length,
    dialogueRatio: lines.length ? Math.round((dialogue / lines.length) * 100) / 100 : 0,
  };
}

/** 一行摘要，给终端打印用：`2600 字 / 42 段 / 对话 38%` */
function describeMetrics(m) {
  if (!m) return '';
  const pct = Math.round((m.dialogueRatio || 0) * 100);
  return `${m.words} 字 / ${m.paragraphs} 段 / 对话 ${pct}%`;
}

module.exports = { measureChapter, describeMetrics };
