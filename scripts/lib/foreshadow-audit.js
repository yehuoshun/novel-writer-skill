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
    // 状态列可能带备注（「已埋设（第1章埋设）」）→ 剥括号；再剥 `**` 加粗（canon 档案习惯写成 `**已推进**`），
    // 否则两边永远对不上
    out[m[1]] = m[2].trim().replace(/[（(][^）)]*[）)]$/, '').replace(/[*_]+/g, '').trim();
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
    out.set(m[1], { file: f, state: st ? st[1].trim().replace(/[（(][^）)]*[）)]$/, '').replace(/[*_]+/g, '').trim() : null });
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


// ---------- 伏笔账：动笔前先看「哪条欠着」 ----------
// 快照「## 伏笔状态」表列序：伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章
//
// 口径与 check-consistency 的门禁警告对齐（长线埋了 10 章没推进就告警），但提醒时机提前：
// 门禁是你写完那一章才说话，那时已经动笔了；这张账要在「开写下一章之前」就把欠的伏笔摆出来。
const TYPE_SPAN = {
  长线: { due: 5, overdue: 10 },
  短线: { due: 2, overdue: 4 },
  误导: { due: 2, overdue: 4 },
  彩蛋: { due: 3, overdue: 6 },
};
const PAYOFF_SPAN = { 长线: 10, 短线: 4, 误导: 4, 彩蛋: 6 };
const TERMINAL = /^(已回收|已废弃|closed|dropped)$/i;
const PLANTED = /^(已埋设|open|埋设)$/i;
const PROGRESSED = /^(已推进|推进|progress)$/i;

function cellNo(cell) {
  const m = String(cell || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

// 「推进章」一格是累积清单（如 11,19,24,25,29,30），算账要取**最后一次**推进，不是第一次。
// 取第一次会把「早就推进过很多次」的伏笔误判成逾期未回收（v1 明明第30章刚推进，却按第11章算成逾期）。
function cellLastNo(cell) {
  const nums = String(cell || '').match(/\d+/g);
  return nums && nums.length ? Number(nums[nums.length - 1]) : null;
}

function stripNote(s) {
  return String(s || '').trim().replace(/[（(][^）)]*[）)]$/, '');
}

/** 把快照「## 伏笔状态」表解析成结构化记录（认不出列序的行跳过，表头不是 vX 也会跳过） */
function snapshotRows(snapshotText) {
  const sec = (String(snapshotText || '').split(/^##\s*伏笔状态/m)[1] || '').split(/^##\s/m)[0];
  const rows = [];
  for (const line of sec.split(/\r?\n/)) {
    if (!/^\|/.test(line.trim())) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^v\d+$/.test(cells[0])) continue;
    rows.push({
      id: cells[0],
      name: cells[1] || '',
      type: cells[2] || '',
      effect: cells[3] || '',
      state: stripNote(cells[4]),
      plant: cellNo(cells[5]),
      progress: cellLastNo(cells[6]),
      payoff: cellNo(cells[7]),
    });
  }
  return rows;
}

/**
 * 伏笔账：给定「下一章章号」，算出每条未了结伏笔欠了多少章。
 * level：overdue=该处理了 / due=快到线 / idle=还早
 */
function ledgerReport(rows, nextChapter) {
  const entries = [];
  for (const row of rows) {
    if (TERMINAL.test(row.state)) continue;
    const type = row.type || '长线';
    const span = TYPE_SPAN[type] || TYPE_SPAN['长线'];
    const base = { id: row.id, name: row.name, type, state: row.state, plant: row.plant, progress: row.progress };
    if (PLANTED.test(row.state)) {
      if (!row.plant) {
        entries.push({ ...base, age: null, level: 'idle', text: `${row.id} ${row.name}（${type}）缺埋设章，这笔账算不出来——先补快照的「埋设章」列` });
        continue;
      }
      const age = Math.max(0, nextChapter - row.plant);
      const level = age >= span.overdue ? 'overdue' : age >= span.due ? 'due' : 'idle';
      let text = `${row.id} ${row.name}（${type}，第${row.plant}章埋设）已埋 ${age} 章未推进`;
      if (level === 'overdue') {
        text += type === '长线'
          ? '——过了 10 章告警线，再不推进就该挨门禁警告了'
          : `——${type}拖过 ${span.overdue} 章，读着容易断线，该推进或收了`;
      } else if (level === 'due') {
        text += type === '长线'
          ? `——距 10 章告警线还有 ${span.overdue - age} 章，找个合适的位置推进一次`
          : `——${type}的窗口不长（${span.overdue} 章），别再搁着`;
      }
      entries.push({ ...base, age, level, text });
      continue;
    }
    if (PROGRESSED.test(row.state)) {
      const from = row.progress || row.plant;
      if (!from) {
        entries.push({ ...base, sinceProgress: null, level: 'idle', text: `${row.id} ${row.name}（${type}）已推进但没写推进章，算不出还要多久收` });
        continue;
      }
      const since = Math.max(0, nextChapter - from);
      const limit = PAYOFF_SPAN[type] || PAYOFF_SPAN['长线'];
      const level = since >= limit ? 'overdue' : 'idle';
      const text = `${row.id} ${row.name}（${type}，第${from}章推进）推进后 ${since} 章还没回收` +
        (level === 'overdue' ? `——${type}推进后 ${limit} 章内该收，别再往后拖` : '');
      entries.push({ ...base, sinceProgress: since, level, text });
      continue;
    }
    entries.push({ ...base, level: 'idle', text: `${row.id} ${row.name}（${type}）状态「${row.state}」认不得，跳过` });
  }
  const byType = {};
  entries.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
  return {
    checked: rows.length,
    open: entries.length,
    overdue: entries.filter((e) => e.level === 'overdue').length,
    due: entries.filter((e) => e.level === 'due').length,
    byType,
    entries,
  };
}

module.exports = { auditForeshadow, snapshotStates, docStates, snapshotRows, ledgerReport };
