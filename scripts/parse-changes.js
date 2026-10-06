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

const INPUT = require('fs').readFileSync('/dev/stdin', 'utf-8');

const MATCH = INPUT.match(/---CHANGES---\r?\n([\s\S]*?)\r?\n---END CHANGES---/);
if (!MATCH) {
  console.error('No CHANGES block found');
  process.exit(1);
}

const BLOCK = MATCH[1];

const RESULT = {};

const SECTIONS = [
  { key: 'characterStates', pattern: /<!-- 角色状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  { key: 'conflictProgress', pattern: /<!-- 冲突进度 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  { key: 'newPlotNodes', pattern: /<!-- 新剧情节点 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  {
    key: 'foreshadowing',
    pattern: /<!--\s*伏笔动作/,  // 兼容带说明后缀的标题：<!-- 伏笔动作（四态，必须引用伏笔ID） -->
    // 四态：🔨埋设/➡️推进/✅回收/❌废弃 + 名称段 **vX 伏笔名**（兼容旧格式 **伏笔名**）
    re: /^-\s*(🔨埋设|➡️推进|✅回收|❌废弃)\s*\*\*([^*]+)\*\*(.*)/
  },
  { key: 'handoff', pattern: /<!--\s*交接包/, re: /^- ([^：:]+)[：:](.*)/ },  // 兼容 <!-- 交接包（给下一章 AI 的交接单） -->
  { key: 'locationChanges', pattern: /<!-- 地点状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  { key: 'factionChanges', pattern: /<!-- 势力状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  { key: 'timeProgress', pattern: /<!-- 时间推进 -->/, re: /^- (.*)/ },
  { key: 'characterMoves', pattern: /<!-- 角色移动 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
  { key: 'itemTransfers', pattern: /<!-- 物品流转 -->/, re: /^- \*\*\[(.+?)\]\*\*[:：](.+)/ },
];

const LINES = BLOCK.split('\n');

let currentSection = null;

for (const LINE of LINES) {
  const trimmed = LINE.trim();
  if (!trimmed) continue;

  // Detect section header
  let found = false;
  for (const S of SECTIONS) {
    if (S.pattern.test(trimmed)) {
      currentSection = S.key;
      RESULT[currentSection] = RESULT[currentSection] || [];
      found = true;
      break;
    }
  }
  if (found) continue;

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
      }
    });
    RESULT[currentSection].push(parts);
  } else {
    const m = trimmed.match(/^- \*\*\[(.+?)\]\*\*[:：](.+)/);
    if (m) {
      RESULT[currentSection].push({ name: m[1].trim(), detail: m[2].trim(), raw: trimmed });
    } else {
      // Unrecognized line in section, keep raw
      RESULT[currentSection].push({ raw: trimmed });
    }
  }
}

console.log(JSON.stringify(RESULT, null, 2));
