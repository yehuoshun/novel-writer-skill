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
 */

const INPUT = require('fs').readFileSync('/dev/stdin', 'utf-8');

const MATCH = INPUT.match(/---CHANGES---\n([\s\S]*?)\n---END CHANGES---/);
if (!MATCH) {
  console.error('No CHANGES block found');
  process.exit(1);
}

const BLOCK = MATCH[1];

const RESULT = {};

const SECTIONS = [
  { key: 'characterStates', pattern: /<!-- 角色状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'conflictProgress', pattern: /<!-- 冲突进度 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'newPlotNodes', pattern: /<!-- 新剧情节点 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'foreshadowing', pattern: /<!-- 伏笔动作 -->/, re: /^-(?: ✅| 🔨)?\s*\*\*\[(.+?)\]\*\*(.*)/ },
  { key: 'locationChanges', pattern: /<!-- 地点状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'factionChanges', pattern: /<!-- 势力状态变化 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'timeProgress', pattern: /<!-- 时间推进 -->/, re: /^- (.*)/ },
  { key: 'characterMoves', pattern: /<!-- 角色移动 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
  { key: 'itemTransfers', pattern: /<!-- 物品流转 -->/, re: /^- \*\*\[(.+?)\]\*\*：(.+)/ },
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
    const isPlant = trimmed.includes('🔨');
    const isHarvest = trimmed.includes('✅');
    const clean = trimmed.replace(/[🔨✅]\s*/, '').replace(/^-\s*/, '');
    const nameMatch = clean.match(/\*\*\[(.+?)\]\*\*/);
    const rest = clean.replace(/\*\*\[.+?\]\*\*/, '').trim();
    RESULT[currentSection].push({
      type: isHarvest ? 'harvest' : isPlant ? 'plant' : 'unknown',
      name: nameMatch ? nameMatch[1] : null,
      detail: rest,
      raw: trimmed
    });
  } else if (currentSection === 'timeProgress') {
    const raw = trimmed.replace(/^-\s*/, '');
    const parts = {};
    raw.split('|').forEach(p => {
      const [k, ...v] = p.trim().split('：');
      if (k && v.length) parts[k.trim()] = v.join('：').trim();
    });
    RESULT[currentSection].push(parts);
  } else {
    const m = trimmed.match(/^- \*\*\[(.+?)\]\*\*：(.+)/);
    if (m) {
      RESULT[currentSection].push({ name: m[1].trim(), detail: m[2].trim(), raw: trimmed });
    } else {
      // Unrecognized line in section, keep raw
      RESULT[currentSection].push({ raw: trimmed });
    }
  }
}

console.log(JSON.stringify(RESULT, null, 2));