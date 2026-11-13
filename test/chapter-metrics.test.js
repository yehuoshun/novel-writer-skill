'use strict';
// 发布时指标（scripts/lib/chapter-metrics.js）：字数/段数/对话占比
const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../scripts/lib/chapter-metrics');

test('measureChapter：只数 CHANGES 之前的正文，汉字/去空白字符/段数各自独立', () => {
  const text = [
    '　　林山提剑出门，风雪扑面。',
    '',
    '　　「你来了。」她说。',
    '---CHANGES---',
    '- [角色] 林山：无',
    '',
  ].join('\n');
  const r = m.measureChapter(text);
  assert.strictEqual(r.words, 15);
  assert.strictEqual(r.chars, 21);
  assert.strictEqual(r.paragraphs, 2);
  assert.strictEqual(r.dialogueRatio, 0.5);
});

test('measureChapter：空文本与只有 CHANGES 的稿子都给零，不炸', () => {
  assert.deepStrictEqual(m.measureChapter(''), { words: 0, chars: 0, paragraphs: 0, dialogueRatio: 0 });
  const r = m.measureChapter('---CHANGES---\n- [角色] 无\n');
  assert.strictEqual(r.words, 0);
  assert.strictEqual(r.paragraphs, 0);
});

test('measureChapter：引号开头的段落算对话，叙述段不算', () => {
  const r = m.measureChapter('　　「走吧。」\n　　他沉默着。\n　　她说：「走。」\n　　「嗯。」\n');
  assert.strictEqual(r.paragraphs, 4);
  assert.strictEqual(r.dialogueRatio, 0.75);
});

test('describeMetrics：一句话给人看', () => {
  assert.strictEqual(m.describeMetrics({ words: 2680, paragraphs: 41, dialogueRatio: 0.37 }), '2680 字 / 41 段 / 对话 37%');
  assert.strictEqual(m.describeMetrics({ words: 0, paragraphs: 0, dialogueRatio: 0 }), '0 字 / 0 段 / 对话 0%');
});
