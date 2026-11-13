'use strict';
// 伏笔双写体检（只读）：档案 `- 状态：` × 快照「## 伏笔状态」表的状态列
//
// 与 check-consistency「门禁 3 增强」同一套口径，区别是这里不依赖某一章的 CHANGES——
// publish-status 是「开工前体检」，要能回答「现在这本书的档案与快照还一致吗」。
const fs = require('fs');
const path = require('path');

function snapshotStates(snapshotText) {
  const sec = (String(snapshotText || '').split(/^##\s*伏笔状态/m)[1] || '').split(/^##\s/m)[0];
  const out = {};
  for (const m of sec.matchAll(/^\|\s*(v\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/gm)) {
    // 状态列可能带备注（「已埋设（第1章埋设）」）→ 剥括号，否则两边永远对不上
    out[m[1]] = m[2].trim().replace(/[（(][^）)]*[）)]$/, '');
  }
  return out;
}

function docStates(settingsDir) {
  const dir = path.join(settingsDir, '伏笔追踪');
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(v\d+)-.*\.md$/);
    if (!m) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const st = /^-\s*状态[：:]\s*(.+)$/m.exec(text);
    out.set(m[1], { file: f, state: st ? st[1].trim().replace(/[（(][^）)]*[）)]$/, '') : null });
  }
  return out;
}

function auditForeshadow({ settingsDir, snapshotText }) {
  const stateOf = snapshotStates(snapshotText);
  const docs = docStates(settingsDir);
  const mismatches = [];
  const oneSided = [];
  const ids = [...new Set([...Object.keys(stateOf), ...docs.keys()])]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  for (const id of ids) {
    const doc = docs.get(id);
    const snapState = stateOf[id];
    if (!doc) {
      oneSided.push({ id, side: 'snapshot', message: `${id} 在快照伏笔状态表登记，但没有 伏笔追踪/${id}-*.md 档案` });
    } else if (!snapState) {
      oneSided.push({ id, side: 'doc', message: `${id} 有档案（伏笔追踪/${doc.file}）但快照伏笔状态表没这一行` });
    } else if (doc.state && doc.state !== snapState) {
      mismatches.push({
        id,
        doc: doc.state,
        snapshot: snapState,
        file: doc.file,
        message: `${id} 档案「${doc.state}」≠ 快照「${snapState}」（伏笔追踪/${doc.file}）`,
      });
    }
  }
  return { checked: ids.length, mismatches, oneSided };
}

module.exports = { auditForeshadow, snapshotStates, docStates };
