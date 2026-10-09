'use strict';
// 仓库元数据自检：结构/引用/格式一致性。改动后无需肉眼，跑一遍即知。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'test']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else out.push(p);
  }
  return out;
}
const ALL = walk(ROOT);
const MD = ALL.filter(f => f.endsWith('.md'));
const TEXT = ALL.filter(f => /\.(md|js|json|yml|sh|txt)$/.test(f));
const rel = (f) => path.relative(ROOT, f);

test('所有 markdown 链接可解析（相对路径按文件位置）', () => {
  const bad = [];
  for (const f of MD) {
    const dir = path.dirname(f);
    for (const m of fs.readFileSync(f, 'utf-8').matchAll(/\]\(([^)]+)\)/g)) {
      let t = m[1].split('#')[0].trim();
      if (!t || /^https?:/.test(t)) continue;
      const target = path.resolve(dir, decodeURIComponent(t));
      if (!fs.existsSync(target)) bad.push(`${rel(f)} → ${m[1]}`);
    }
  }
  assert.deepStrictEqual(bad, [], `断链:\n${bad.join('\n')}`);
});

test('表格列数一致（无错位）', () => {
  const bad = [];
  for (const f of MD) {
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    let prev = 0;
    lines.forEach((l, i) => {
      if (/^\|/.test(l)) {
        const n = (l.match(/\|/g) || []).length;
        if (prev > 0 && n !== prev && !/^\|[-: |]+\|$/.test(l)) bad.push(`${rel(f)}:${i + 1} 列数 ${prev}→${n}`);
        prev = n;
      } else prev = 0;
    });
  }
  assert.deepStrictEqual(bad, [], `表格错位:\n${bad.join('\n')}`);
});

test('版本号一致：frontmatter == 末尾标注 == package.json', () => {
  const t = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
  const fm = t.match(/^version:\s*(\S+)/m);
  const tail = t.match(/_版本：v(\S+)_/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
  assert.ok(fm, 'frontmatter 缺 version');
  assert.ok(tail, '末尾缺 _版本：_');
  assert.strictEqual(tail[1], fm[1], `frontmatter ${fm[1]} != 末尾 ${tail[1]}`);
  assert.strictEqual(pkg, fm[1], `package.json ${pkg} != SKILL ${fm[1]}（发版时两者须同步）`);
});

test('无未识别的 CHANGES 分节标记', () => {
  const KNOWN = /^(角色状态变化|冲突进度|新剧情节点|伏笔动作|交接包|地点状态变化|势力状态变化|时间推进|角色移动|物品流转)/;
  const bad = [];
  for (const f of MD) {
    for (const m of fs.readFileSync(f, 'utf-8').matchAll(/<!--\s*([^>]+?)\s*-->/g)) {
      if (!KNOWN.test(m[1])) bad.push(`${rel(f)}: <!-- ${m[1]} -->`);
    }
  }
  assert.deepStrictEqual(bad, [], `未识别标记（parse-changes 会报错）:\n${bad.join('\n')}`);
});

test('所有文本文件以换行结尾 + 无行尾空白', () => {
  const bad = [];
  for (const f of TEXT) {
    const s = fs.readFileSync(f, 'utf-8');
    if (s.length && !s.endsWith('\n')) bad.push(`${rel(f)} 末尾无换行`);
    if (/[ \t]+\n/.test(s)) bad.push(`${rel(f)} 有行尾空白`);
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

test('SKILL.md「参考资料」表覆盖 references/ 全部文件', () => {
  const t = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
  const sec = t.split(/^## 参考资料/m)[1] || '';
  const refs = fs.readdirSync(path.join(ROOT, 'references')).filter(f => f.endsWith('.md') && f !== 'README.md');
  const missing = refs.filter(r => !sec.includes(r));
  assert.deepStrictEqual(missing, [], `参考资料表未列出: ${missing.join(', ')}`);
});

test('标题层级无跳级（围栏感知）', () => {
  const bad = [];
  for (const f of MD) {
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    let fence = null, prev = 0;
    lines.forEach((l, i) => {
      const m = l.match(/^(`{3,})/);
      if (m) { if (fence === null) fence = m[1]; else if (l.trim() === fence) fence = null; return; }
      if (fence !== null) return;
      const h = l.match(/^(#{1,6}) /);
      if (!h) return;
      const n = h[1].length;
      if (prev > 0 && n > prev + 1) bad.push(`${rel(f)}:${i + 1} H${prev}→H${n}`);
      prev = n;
    });
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
