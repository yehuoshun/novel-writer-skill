#!/usr/bin/env node
/**
 * CHANGES 变更声明协议解析器
 *
 * 用法:
 *   node parse-changes.js < input.md
 *   cat chapter.md | node parse-changes.js
 *
 * 输入: 包含 ---CHANGES--- ... ---END CHANGES--- 块的文本
 * 输出: 结构化 JSON (stdout)
 *
 * 支持伏笔四态（🔨埋设/➡️推进/✅回收/❌废弃）与下章交接包（<!-- 交接包 -->）
 */

const INPUT = require('fs').readFileSync(0, 'utf-8');

const MATCH = INPUT.match(/---CHANGES---\r?\n([\s\S]*?)\r?\n---END CHANGES---/);
if (!MATCH) {
  console.error('No CHANGES block found');
  process.exit(1);
}

const BLOCK = MATCH[1];

const RESULT = {};

// 分节标记：marker = 标记内文（允许尾部说明，如「伏笔动作（四态…）」）。
// 匹配按「内文去除首尾空白后以 marker 开头」判定 → <!-- 角色状态变化 --> 与
// <!--角色状态变化--> 等价（v3.3.54 扫描暴露：此前多数标记精确匹配单空格，写法一变就报「未识别」）。
const SECTIONS = [
  { key: 'characterStates', marker: '角色状态变化' },
  { key: 'conflictProgress', marker: '冲突进度' },
  { key: 'newPlotNodes', marker: '新剧情节点' },
  { key: 'foreshadowing', marker: '伏笔动作' },
  { key: 'handoff', marker: '交接包' },
  { key: 'locationChanges', marker: '地点状态变化' },
  { key: 'factionChanges', marker: '势力状态变化' },
  { key: 'timeProgress', marker: '时间推进' },
  { key: 'characterMoves', marker: '角色移动' },
  { key: 'itemTransfers', marker: '物品流转' },
];

const LINES = BLOCK.split('\n');

let currentSection = null;
const unknownMarkers = [];

for (const LINE of LINES) {
  const trimmed = LINE.trim();
  if (!trimmed) continue;

  // Detect section header（归一化：忽略标记内外空白，兼容带说明后缀的标题）
  const mk = trimmed.match(/^<!--\s*([\s\S]*?)\s*-->$/);
  if (mk) {
    const inner = mk[1];
    const S = SECTIONS.find(s => inner === s.marker || inner.startsWith(s.marker));
    if (S) {
      currentSection = S.key;
      RESULT[currentSection] = RESULT[currentSection] || [];
    } else {
      // 未识别的分节标记 → 记录后报错，避免静默吞入上一分节
      unknownMarkers.push(trimmed);
    }
    continue;
  }

  // Parse line based on current section
  if (!currentSection) continue;

  if (currentSection === 'foreshadowing') {
    const m = trimmed.match(/^-\s*(🔨埋设|➡️推进|✅回收|❌废弃)\s*\*\*([^*]+)\*\*(.*)/);
    if (!m) {
      RESULT[currentSection].push({ raw: trimmed });
      continue;
    }
    const action = m[1];
    const namePart = m[2].trim();
    const detail = m[3].trim();
    // 名称段解析：优先 vX 前缀 → { id: 'v1', name: '假死真相' }；无 ID 时 name 为整段
    // 分隔符兼容：空格 / 连字符 / 破折号（v1 假死真相 / v1-假死真相 / v1—假死真相）
    const idMatch = namePart.match(/^(v\d+)(?:[\s\-—]+)(.+)$/);
    RESULT[currentSection].push({
      type: action.includes('🔨') ? 'plant'
        : action.includes('➡️') ? 'progress'
        : action.includes('✅') ? 'harvest'
        : 'abandon',
      id: idMatch ? idMatch[1] : null,
      // 兼容旧格式 **【伏笔名】** / **[伏笔名]**（无 vX ID）
      name: idMatch ? idMatch[2].replace(/^[\[【]|[\]】]$/g, '') : namePart.replace(/^[\[【]|[\]】]$/g, ''),
      detail: detail.replace(/^\|/, '').trim(),
      raw: trimmed
    });
  } else if (currentSection === 'handoff') {
    // 交接包：`- 键：值` 逐行解析（兼容半角冒号）
    const m = trimmed.match(/^- ([^：:]+)[：:](.*)/);
    if (m) {
      RESULT[currentSection].push({ key: m[1].trim(), value: m[2].trim(), raw: trimmed });
    } else {
      RESULT[currentSection].push({ raw: trimmed });
    }
  } else if (currentSection === 'timeProgress') {
    const raw = trimmed.replace(/^-\s*/, '');
    const parts = {};
    raw.split('|').forEach(p => {
      // 首个冒号切分（兼容全/半角），值里剩余的冒号原样保留
      const idx = p.search(/[：:]/);
      if (idx > 0) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k) parts[k] = v;
      } else {
        // 无冒号裸值（如「第5天」）：不丢弃，归入 _raw 保留，供消费端自行理解
        const t = p.trim();
        if (t) parts._raw = parts._raw ? `${parts._raw} | ${t}` : t;
      }
    });
    RESULT[currentSection].push(parts);
  } else {
    const m = trimmed.match(/^- \*\*(.+?)\*\*[:：](.+)/);
    if (m) {
      // 兼容 **[张三]** / **【张三】** / **张三** 三种写法（协议标准为 **[张三]**）
      RESULT[currentSection].push({ name: m[1].trim().replace(/^[\[【]|[\]】]$/g, ''), detail: m[2].trim(), raw: trimmed });
    } else {
      // Unrecognized line in section, keep raw
      RESULT[currentSection].push({ raw: trimmed });
    }
  }
}

if (unknownMarkers.length) {
  console.error(`未识别的 CHANGES 分节标记（${unknownMarkers.length} 处）: ${unknownMarkers.join(' / ')}`);
  console.error('请核对 references/changes-protocol.md 的标准标记');
  process.exit(1);
}

console.log(JSON.stringify(RESULT, null, 2));
