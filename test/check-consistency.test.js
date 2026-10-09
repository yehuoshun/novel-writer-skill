'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-consistency.js');
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '地点设定'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '林山.md'), '# 林山\n');
  fs.writeFileSync(path.join(set, '地点设定', '青云山.md'), '# 青云山\n');
  fs.writeFileSync(path.join(set, '伏笔追踪', 'v1-断锋来历.md'), '# v1\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照（截止第1章）\n## 角色状态\n' +
    '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n' +
    '| 林山 | 炼气三层 | 青云山后山 | 健康 | 剑 | 1 |\n');
  const good = path.join(dir, 'good.md');
  fs.writeFileSync(good,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n' +
    '<!-- 角色移动 -->\n- **[林山]**：青云山后山→青云山前殿\n' +
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v1 断锋来历** | 新线索\n' +
    '<!-- 交接包 -->\n- 剧情当前位置：后山\n---END CHANGES---\n');
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(bad,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[赵无极]**：健康\n' +
    '<!-- 角色移动 -->\n- **[林山]**：天剑宗→青云山\n' +
    '<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ✅回收 **v9 不存在**\n---END CHANGES---\n');
  return { dir, set, snap, good, bad };
}

test('合法章节 → 通过（exit 0）', () => {
  const { snap, good, set } = setup();
  const r = run([snap, good, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /门禁通过/);
});

test('冲突章节 → 拦三类问题（exit 1）', () => {
  const { snap, bad, set } = setup();
  const r = run([snap, bad, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未登记实体：赵无极/);
  assert.match(r.stderr, /林山 从「天剑宗」出发/);
  assert.match(r.stderr, /未登记伏笔：v9/);
});

test('实体仅被他档提及、无自有档案 → 仍判未登记', () => {
  const { dir, set, snap } = setup();
  fs.appendFileSync(path.join(set, '角色设定', '主角', '林山.md'), '\n- 关系：师父（青云子）\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[青云子]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未登记实体：青云子/);
});

test('推进/回收 已终结伏笔 → 拦（状态不可回退）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 9 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已回收 | 1 | 2 | 8 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v1 断锋来历** | 又推\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /不可回退/);
});

test('已死角色出现 → 拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 9 |\n' +
    '| 王老 | — | — | 已死亡 | — | 5 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[王老]**：死亡→复活\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /已死角色出现：王老/);
});

test('蓝图出场合规：必出角色缺失 >1 → 拦', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '## 第3章 细纲\n| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山、青云子、三师兄 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /蓝图未出场：青云子、三师兄/);
});

test('蓝图出场合规：缺额 ≤1 不拦', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山、青云子 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在青云山的路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('描写一致性：正文发色与档案矛盾 → 拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n- 瞳色：深褐\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '张三的金色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /描写一致性.*张三.*金发/);
});

test('描写一致性：与档案一致 → 不拦', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '张三的黑色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('描写一致性：名字子串不误报（张三 vs 张三丰）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n');
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三丰.md'), '# 张三丰\n- 发色：黑\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '张三丰的金色长发垂到腰际。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三丰]**：健康→健康\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /张三丰 正文写「金发」/);
  assert.ok(!/张三 正文写/.test(r.stderr), `误报张三:\n${r.stderr}`);
});

test('伏笔埋设 10 章未推进 → 警告（不阻断，exit 0）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已埋设 | 1 | — | 待定 |\n');
  const chap = path.join(dir, '第012章 x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /v1 已埋设 11 章未推进/);
});

test('旧格式伏笔（无 vX ID）→ 警告不打回（exit 0）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **【神秘人】**\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /旧格式伏笔/);
});

test('参数缺失 → exit 2', () => {
  const r = run([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /用法/);
});

test('文件不存在 → exit 2', () => {
  const { good, set } = setup();
  const r = run(['/no/such/snapshot.md', good, set]);
  assert.strictEqual(r.status, 2);
});

// ---- 门禁 13 归属/命名回归（v3.3.30）----
function colorSetup(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  for (const [file, body] of Object.entries(profiles)) {
    fs.writeFileSync(path.join(set, '角色设定', '主角', file), body);
  }
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n' +
    '| 林山 | — | 青云山 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  return { set, snap, chap };
}
const CH = (states) => '正文。\n---CHANGES---\n' + states + '\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n';

test('描写一致性：地点前缀档案名（龙城_张三）也能命中', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '龙城_张三.md'), '# 龙城_张三\n- 发色：黑\n- 瞳色：黑\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | — | 龙城 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的金色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*张三.*金发/);
});

test('描写一致性：望向他人发色不误报（林山看着青云子的白发）', () => {
  const { set, snap, chap } = colorSetup({
    '林山.md': '# 林山\n- 发色：黑\n- 瞳色：黑\n',
    '青云子.md': '# 青云子\n- 发色：白\n- 瞳色：灰\n',
  });
  fs.writeFileSync(chap, '林山看着青云子的白发，心里发紧。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('描写一致性：他人发色归属不明时不误报（林山望着师父的白发）', () => {
  const { set, snap, chap } = colorSetup({ '林山.md': '# 林山\n- 发色：黑\n- 瞳色：黑\n' });
  fs.writeFileSync(chap, '林山望着师父的白发，一言不发。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('描写一致性：跨句不误报（张三走了。白发苍苍的老人）', () => {
  const { set, snap, chap } = colorSetup({ '张三.md': '# 张三\n- 发色：黑\n- 瞳色：黑\n' });
  fs.writeFileSync(chap, CH('<!-- 角色状态变化 -->\n- **[张三]**：健康→健康').replace('正文。', '张三走了。白发苍苍的老人坐在门口。'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

// ---- 蓝图/一致性 回归（v3.3.31）----
test('蓝图出场合规：忽略同文档的细纲表（核心事件列），只认蓝图表', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '## 细纲\n| 章 | 核心事件 | 爽点类型 | 章首钩子 | 章尾钩子 | 字数 |\n' +
    '|----|----------|----------|----------|----------|------|\n' +
    '| 3 | 外门试炼 | 装逼打脸 | 悬念钩 | 危机钩 | 3000 |\n\n' +
    '## 蓝图\n| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试炼.md');
  fs.writeFileSync(chap, '林山站在青云山的石阶上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, '细纲表被误当蓝图：\n' + r.stdout + r.stderr);
});

test('一致性：快照位置未知「—」时不误判移动矛盾', () => {
  const { dir, set } = setup();
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | — | — | 健康 | 剑 | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色移动 -->\n- **[林山]**：天剑宗→青云山\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

// ---- 描写一致性取数源回归（v3.3.32）：快照「角色外貌」表 ----
test('描写一致性：从快照「角色外貌」表取数（档案只有自由文本）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  // 按 setup-templates 角色模板：外貌是自由文本，无「发色：」标签
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n\n## 外貌描述\n黑发黑瞳，剑眉星目。\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | 炼气一层 | 龙城 | 健康 | — | 1 |\n\n' +
    '## 角色外貌（用于描写一致性校验）\n| 角色 | 发色 | 瞳色 | 外貌特征 | 性格标签 |\n' +
    '|------|------|------|----------|----------|\n| 张三 | 黑 | 黑 | 剑眉星目 | 果决 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的金色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, '快照外貌表未被读取：\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*张三.*金发/);
});

test('描写一致性：快照外貌表优先于档案标签', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n- 瞳色：黑\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | 炼气一层 | 龙城 | 健康 | — | 1 |\n\n' +
    '## 角色外貌（用于描写一致性校验）\n| 角色 | 发色 | 瞳色 | 外貌特征 | 性格标签 |\n' +
    '|------|------|------|----------|----------|\n| 张三 | 银 | 蓝 | — | — |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的银色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, '应以快照外貌表（银）为准：\n' + r.stdout + r.stderr);
});

// ---- 交接包必填 + 蓝图无本章行警告（v3.3.33）----
test('交接包缺失 → 打回（协议要求每章必填）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /缺少 <!-- 交接包 --> 声明/);
});

test('交接包存在 → 不因交接包打回', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('蓝图：细纲存在但无本章行 → 警告不阻断（exit 0）', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 2 | 林山 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /蓝图清单无第 0*3 章的行/);
});

// ---- 伏笔埋设即建档（v3.3.37，实际使用测试暴露）----
test('伏笔快照已登记但目录无文档 → 报未登记 + 建档自纠提示', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已埋设 | 1 | — | 待定 |\n' +
    '| v2 | 古庙秘密 | 短线 | 小惊喜 | 已埋设 | 2 | — | 待定 |\n');
  const chap = path.join(dir, '第3章 x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v2 古庙秘密** | 新线索\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /未登记伏笔：v2/);
  assert.match(r.stderr, /漏建/);
});

// ---- 描写一致性：自由文本外貌描述回退（v3.3.39，老书/无快照外貌表场景）----
test('描写一致性：快照无外貌表 + 档案自由文本（黑发）→ 正文金发被拦', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  // setup-templates 模板：外貌是自由文本，无「发色：」标签；快照也无角色外貌表（老书）
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n\n## 外貌描述\n黑发黑瞳，剑眉星目。\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | 炼气一层 | 龙城 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的金色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, '自由文本回退未生效：\n' + r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*张三.*金发/);
});

test('描写一致性：快照无外貌表 + 档案自由文本（黑发）→ 正文黑发不误报', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n\n## 外貌描述\n黑发黑瞳，剑眉星目。\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | 炼气一层 | 龙城 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的黑色长发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

// ---- 描写一致性「色+的+发」漏检修复（v3.3.40，实弹测试暴露）----
test('描写一致性：「银色的头发」也能命中（设定黑发 → 拦）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '张三.md'), '# 张三\n- 发色：黑\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 张三 | 炼气一层 | 龙城 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '张三的银色的头发在风中飘动。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[张三]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*张三.*银发/);
});

test('描写一致性：「银白的长发」双色词命中，档案同色不误报', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '苏瑶.md'), '# 苏瑶\n- 发色：银白\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 苏瑶 | 筑基期 | 天剑宗 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '苏瑶的银白的长发垂到腰际。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('描写一致性：双色词归一化（档案银白 vs 正文银发 → 一致不误报）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '苏瑶.md'), '# 苏瑶\n- 发色：银白\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 苏瑶 | 筑基期 | 天剑宗 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '苏瑶的银发在晨雾里泛着冷光。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('描写一致性：「银白的长发」双色词命中，换金发被拦', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cc-'));
  const set = path.join(dir, '设定');
  fs.mkdirSync(path.join(set, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(set, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(set, '角色设定', '主角', '苏瑶.md'), '# 苏瑶\n- 发色：银白\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 苏瑶 | 筑基期 | 天剑宗 | 健康 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '苏瑶的金色的长发垂到腰际。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*苏瑶.*金发/);
});

// ---- 伏笔状态列带备注（v3.3.40 实弹暴露：10 章警告静默失效）----
test('伏笔状态列带括号备注 → 10 章未推进警告仍触发', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已埋设（第1章埋设） | 1 | — | 待定 |\n');
  const chap = path.join(dir, '第012章 x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /v1 已埋设 11 章未推进/);
});

// ---- 门禁 12 增强：地点状态 / 物品归属 一致性（v3.3.40 实弹暴露）----
test('地点状态一致性：出发态与快照矛盾 → 拦', () => {
  const { dir, set } = setup();
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 地点状态\n| 地点 | 当前状态 | 触发事件 | 相关章节 |\n' +
    '|------|----------|----------|----------|\n| 青云山 | 破败 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 地点状态变化 -->\n- **[青云山]**：平静→紧张 | 触发事件：大战\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /青云山 状态从「平静」变化，但快照记录其当前状态为「破败」/);
});

test('地点状态一致性：出发态与快照一致 → 通过', () => {
  const { dir, set } = setup();
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 地点状态\n| 地点 | 当前状态 | 触发事件 | 相关章节 |\n' +
    '|------|----------|----------|----------|\n| 青云山 | 平静 | — | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 地点状态变化 -->\n- **[青云山]**：平静→紧张 | 触发事件：大战\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('物品归属一致性：原持有者与快照矛盾 → 拦', () => {
  const { dir, set } = setup();
  fs.mkdirSync(path.join(set, '物品设定'), { recursive: true });
  fs.writeFileSync(path.join(set, '物品设定', '断锋剑.md'), '# 断锋剑\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 物品归属\n| 物品 | 持有者 | 状态 |\n|------|--------|------|\n| 断锋剑 | 林山 | active |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 物品流转 -->\n- **[断锋剑]**：赵无极→赵无极 | 方式：赠送\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /物品「断锋剑」原持有者「赵无极」，但快照记录持有者为「林山」/);
});

test('物品归属一致性：原持有者与快照一致 → 通过', () => {
  const { dir, set } = setup();
  fs.mkdirSync(path.join(set, '物品设定'), { recursive: true });
  fs.writeFileSync(path.join(set, '物品设定', '断锋剑.md'), '# 断锋剑\n');
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n' +
    '## 物品归属\n| 物品 | 持有者 | 状态 |\n|------|--------|------|\n| 断锋剑 | 林山 | active |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 物品流转 -->\n- **[断锋剑]**：林山→林山 | 方式：— | 完好\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

// ---- 半角箭头兼容（v3.3.41，parse-changes 容错轰炸暴露）----
test('半角箭头 -> 一致性仍校验（不静默跳过）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色移动 -->\n- **[林山]**：天剑宗->青云山\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /林山 从「天剑宗」出发/);
});
