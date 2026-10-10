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

// ---- 蓝图占位符过滤（2026-10-10 扫描暴露）----
// 蓝图「必出场地点/势力」列写「无/—」是占位符，不是实体名；
// 过滤前：真实实体全出场 + 两列占位符 → 被当「未出场：无、无」误拦整章。
test('蓝图占位符：地点/势力列写「无」不参与缺失判定', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山 | 各≥1 | 无 | 无 |\n' +
    '| 4 | 林山 | 各≥1 | — | 待定 |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在路上，拔出断锋剑。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, '占位符被当未出场实体：\n' + r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /蓝图未出场：无/);
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

// ---- 伏笔状态机：重复埋设拦截（v3.3.43，实弹第四轮暴露）----
test('已推进伏笔重新埋设 → 拦（状态机反向 + 非唯一 ID）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 20 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | 已推进 | 1 | 5,12 | 待定 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- 🔨埋设 **v1 断锋来历**（类型：长线）| 预期读者效果：震惊 | 线索：新线索\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /重复埋设：v1 已登记/);
});

test('新书首章埋设新伏笔 → 不误拦', () => {
  const { dir, set, snap } = setup();
  // 清掉 setup 预建的 v1 文档，模拟全新伏笔
  fs.rmSync(path.join(set, '伏笔追踪', 'v1-断锋来历.md'));
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 1 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- 🔨埋设 **v1 断锋来历**（类型：长线）| 预期读者效果：震惊 | 线索：新线索\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('英文态终态（resolved）被推进 → 拦（状态机兼容英文态）', () => {
  const { dir, set, snap } = setup();
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |\n' +
    '|------|------|----------|------|------|-----------|\n| 林山 | 炼气三层 | 青云山 | 健康 | 剑 | 30 |\n' +
    '## 伏笔状态\n| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |\n' +
    '|--------|--------|------|--------------|------|--------|--------|--------|\n' +
    '| v1 | 断锋来历 | 长线 | 揭晓身世 | resolved | 1 | 5 | 25 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ➡️推进 **v1 断锋来历** | 又推\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /已是终态「resolved」/);
});

// ---- 旧格式快照 / 蓝图列头变体（v3.3.42，实弹第三轮暴露）----
test('旧格式 3 列快照（角色|位置|状态）→ 位置取第 2 列，不误把状态当位置', () => {
  const { dir, set } = setup();
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照（截止第3章）\n## 角色状态\n| 角色 | 位置 | 状态 |\n' +
    '|------|------|------|\n| 林山 | 青云山 | 健康 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色移动 -->\n- **[林山]**：青云山→天剑宗\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('旧格式 3 列快照：出发地与位置矛盾 → 仍拦', () => {
  const { dir, set } = setup();
  const snap = path.join(dir, '状态快照.md');
  fs.writeFileSync(snap,
    '# 状态快照\n## 角色状态\n| 角色 | 位置 | 状态 |\n' +
    '|------|------|------|\n| 林山 | 青云山 | 健康 |\n');
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap, '正文。\n---CHANGES---\n<!-- 角色移动 -->\n- **[林山]**：天剑宗→青云山\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /林山 从「天剑宗」出发，但快照记录其在「青云山」/);
});

test('蓝图列头「出场角色」（无必出字样）也能识别校验', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '## 蓝图\n| 章 | 出场角色 | 戏份要求 | 出场地点 | 出场势力 |\n' +
    '|----|---------|---------|---------|---------|\n' +
    '| 3 | 林山、青云子、三师兄 | 各≥1 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 试.md');
  fs.writeFileSync(chap, '林山走在路上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /蓝图未出场：青云子、三师兄/);
});

test('摘要涉及角色已登记 → 不警告', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 新剧情节点 -->\n- **林山得剑**：拾得断锋 | 涉及角色：林山 | 故事线：主线\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /引用校验·摘要/);
});

test('摘要涉及未登记实体 → 警告不阻断（堵藏实体逃校验的缝）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 新剧情节点 -->\n- **黑风寨探子混入**：暗中窥探 | 涉及角色：黑风寨 | 故事线：支线\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /引用校验·摘要.*黑风寨/);
});

test('摘要涉及实体已在声明段声明（门禁11已拦）→ 不重复警告', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, 'x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 势力状态变化 -->\n- **[黑风寨]**：安定→蠢动\n<!-- 新剧情节点 -->\n- **黑风寨探子混入**：暗中窥探 | 涉及角色：黑风寨 | 故事线：支线\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /未登记实体：黑风寨/);
  assert.doesNotMatch(r.stdout, /引用校验·摘要/);
});

// ---- 描写一致性误报防护（v3.3.54，2026-10-10 实弹暴露）----
// 现实正文里的「黑眼圈 / 翻白眼 / 通红的眼睛 / 黄发卡 / 红发带」此前被当成发色/瞳色误拦，
// 门禁几乎每章误报。以下回归锁定：这些非固有色描述不拦，真·发色瞳色矛盾仍拦。
const 苏瑶 = { '苏瑶.md': '# 苏瑶\n- 发色：黑\n- 瞳色：蓝\n' };

test('描写一致性：黑眼圈（眼部器官）→ 不误报', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap, '苏瑶顶着两个黑眼圈走进会议室。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：翻白眼 / 眼眶红 / 眼白（部件与俗语）→ 不误报', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap,
    '苏瑶翻了个白眼，没说话。\n苏瑶的眼眶红了。\n苏瑶气得眼白都翻了出来。\n' +
    CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：通红的眼睛（临时泛红）→ 不误报', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap, '哭过之后，苏瑶通红的眼睛还没消肿。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：头发配件/发式（黄发卡/红发带/黑发夹/发型）→ 不误报', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap,
    '苏瑶戴着一只黄色发卡。\n苏瑶用红发带扎起头发。\n苏瑶夹着黑发夹。\n苏瑶换了个新发型。\n' +
    CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：真·瞳色矛盾（蓝瞳人物写红瞳）仍拦', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap, '苏瑶的红瞳在暗处发亮。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*苏瑶.*红瞳/);
});

test('描写一致性：误报与真阳性混排 → 只报真阳性', () => {
  const { snap, chap, set } = colorSetup(苏瑶);
  fs.writeFileSync(chap,
    '苏瑶顶着黑眼圈。\n苏瑶翻了个白眼。\n苏瑶戴着一只黄色发卡。\n苏瑶的红瞳在暗处发亮。\n' +
    CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /苏瑶.*红瞳/);
  assert.doesNotMatch(r.stderr, /黑瞳|白瞳|黄发/);
});

// ---- 门禁14 未知实体候选（v3.3.55）：脚本给候选清单，AI 终判 —— 仅警告不阻断 ----
test('门禁14：正文重复出现的未登记人物 → 候选警告（不阻断）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, '第005章 x.md');
  fs.writeFileSync(chap,
    '沈鹤拦住了林山。沈鹤说，他等这一天很久了。\n' +
    '---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /未知实体候选.*沈鹤/);
});

test('门禁14：已登记实体及其子串不列为候选', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, '第005章 x.md');
  fs.writeFileSync(chap,
    '林山回到青云山。林山望着青云山出神。\n' +
    '---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /未知实体候选/);
});

test('门禁14：单次出现的未登记名词不误列（≥2 次才记）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, '第005章 x.md');
  fs.writeFileSync(chap,
    '林山路过一座无名的断魂崖。\n' +
    '---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /未知实体候选/);
});

test('门禁14：宗门场景高频词与姓氏粘连碎片不列为候选（2026-10-10 实弹噪声）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, '第005章 x.md');
  fs.writeFileSync(chap,
    '林山走出外门，回到屋里。林山站在后院，看见林山脚下的大门。\n' +
    '---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /未知实体候选.*外门|未知实体候选.*见林|未知实体候选.*后院/);
});

// ---- 蓝图门禁两处兜底（v3.3.55）----
test('蓝图：文件名无「第N章」→ 显式警告（不再静默跳过）', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山 | — | 青云山 | |\n');
  const chap = path.join(dir, '随手记.md');
  fs.writeFileSync(chap, '林山站在青云山。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /无法从章节文件名解析章号/);
});

test('蓝图：必出场角色全章仅出场 1 次 → 叙事力度警告（不阻断）', () => {
  const { dir, set, snap } = setup();
  const outline = path.join(dir, '细纲.md');
  fs.writeFileSync(outline,
    '| 章 | 必出场角色 | 戏份要求 | 必出场地点 | 必出场势力 |\n' +
    '|----|-----------|---------|-----------|-----------|\n' +
    '| 3 | 林山 | 主角≥3场景 | 青云山 | |\n');
  const chap = path.join(dir, '第003章 x.md');
  fs.writeFileSync(chap, '林山站在青云山的石阶上。\n---CHANGES---\n<!-- 角色状态变化 -->\n- **[林山]**：健康→健康\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set, outline]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /「林山」全章仅出场 1 次/);
});

// ---- 伏笔回收方式兜底（v3.3.55）----
test('伏笔：回收未写「回收方式」→ 警告（不阻断）', () => {
  const { dir, set, snap } = setup();
  const chap = path.join(dir, '第007章 x.md');
  fs.writeFileSync(chap,
    '正文。\n---CHANGES---\n<!-- 伏笔动作（四态，必须引用伏笔ID） -->\n- ✅回收 **v1 断锋来历** | 就此了结\n<!-- 交接包 -->\n- 剧情当前位置：X\n---END CHANGES---\n');
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /回收未写明「回收方式」/);
});

// ---- 档案自由文本提取共用误报防护（v3.3.57 实弹暴露）----
// 档案「## 外貌描述」是自由文本；此前提取不套误报防护，写「黑眼圈」会把瞳色记成黑，
// 导致合法「蓝瞳」正文被误拦。
test('描写一致性：档案「黑眼圈」不污染瞳色（正文蓝瞳通过）', () => {
  const { snap, chap, set } = colorSetup({ '苏瑶.md': '# 苏瑶\n## 外貌描述\n黑眼圈很重，蓝色瞳孔却很亮。\n' });
  fs.writeFileSync(chap, '苏瑶的蓝瞳在暗处发亮。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：档案「黄发卡」不污染发色（正文黑发通过）', () => {
  const { snap, chap, set } = colorSetup({ '苏瑶.md': '# 苏瑶\n## 外貌描述\n戴一只黄发卡，一头黑色长发。\n' });
  fs.writeFileSync(chap, '苏瑶的黑发垂到腰际。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /描写一致性/);
});

test('描写一致性：档案自由文本真·瞳色矛盾仍拦（蓝色瞳孔 vs 正文红瞳）', () => {
  const { snap, chap, set } = colorSetup({ '苏瑶.md': '# 苏瑶\n## 外貌描述\n蓝色瞳孔，眼神很冷。\n' });
  fs.writeFileSync(chap, '苏瑶的红瞳在暗处发亮。\n' + CH('<!-- 角色状态变化 -->\n- **[苏瑶]**：健康→健康'));
  const r = run([snap, chap, set]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /描写一致性.*苏瑶.*红瞳/);
});
