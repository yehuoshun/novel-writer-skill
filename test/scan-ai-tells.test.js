'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'scan-ai-tells.js');
const run = (input) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf-8' });
const runFile = (p) => spawnSync(process.execPath, [SCRIPT, p], { encoding: 'utf-8' });

const AIY = '　　首先他感到一阵寒意。其次他觉得不简单。最后他心中涌起不安。\n' +
  '　　综上所述，这一夜漫长。在这个信息爆炸的时代，他不由得握紧拳头。\n' +
  '　　“你来了。”\n　　“我来了。”\n　　“你终于来了。”\n　　“是的。”\n' +
  '　　他知道明天会更好。他忍不住笑了。他感到一种轻松。\n';

test('AI 味文本 → 提示 Gate2/3/5/6（退出码恒 0）', () => {
  const r = run(AIY);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Gate2 序数枚举套话/);
  assert.match(r.stdout, /Gate3 心理外化成簇/);
  assert.match(r.stdout, /Gate5 连续纯对话/);
  assert.match(r.stdout, /Gate6 章尾疑似无钩子/);
});

test('干净文本 → 无提示', () => {
  const clean = '　　雨点砸在铁皮棚上。林墨数到第七声，楼道灯灭了。\n' +
    '　　他摸黑下楼，台阶嘎吱。三楼堆着旧家具，一张断腿沙发斜靠墙上。\n' +
    '　　“喂。”声音从沙发后传来。他停住脚。\n' +
    '　　墙上是水电表，指针停在了一个不该停的数字上。\n' +
    '　　为什么是今天？\n';
  const r = run(clean);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /未见明显 AI 味/);
});

test('CHANGES 块内的套话不计入（只扫正文）', () => {
  const t = '　　他推开门。\n---CHANGES---\n<!-- 交接包 -->\n- 剧情当前位置：首先消耗，其次推进，最后收束。综上所述完成。\n---END CHANGES---\n';
  const r = run(t);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/Gate2/.test(r.stdout), `不应扫 CHANGES：\n${r.stdout}`);
});

test('单次发言过长 → 提示', () => {
  const t = '　　“' + '他说了很多很多'.repeat(20) + '。”\n';
  const r = run(t);
  assert.match(r.stdout, /Gate5 单次发言过长/);
});

test('文件不存在 → 退出码 2', () => {
  assert.strictEqual(runFile('/no/such/file.md').status, 2);
});
