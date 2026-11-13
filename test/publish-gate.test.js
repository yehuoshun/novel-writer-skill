'use strict';
// 发布闸门端到端：草稿 → 12 门禁 → 原子落盘 → 指纹账本（含幂等 / 定稿保护 / 阻断不落盘）
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmpDir } = require('./helpers/tmp');
const gate = require('../scripts/lib/gate-suite');

const REPORT = path.join(__dirname, '..', 'scripts', 'gate-report.js');
const PUBLISH = path.join(__dirname, '..', 'scripts', 'publish-chapter.js');
const STATUS = path.join(__dirname, '..', 'scripts', 'publish-status.js');
const runReport = (args) => spawnSync(process.execPath, [REPORT, ...args], { encoding: 'utf-8' });
const runPublish = (args) => spawnSync(process.execPath, [PUBLISH, ...args], { encoding: 'utf-8' });
const runStatus = (args) => spawnSync(process.execPath, [STATUS, ...args], { encoding: 'utf-8' });

// 合格正文：段首两全角空格、全角标点、无半角引号、无破折号、汉字 ≥100
const BODY = [
  '　　青云山的晨雾还没散，林山已经站在后山的石阶上。他把剑从鞘里抽出一寸，又推了回去。',
  '',
  '　　风从谷底翻上来，带着湿冷的草腥气。他数着呼吸，一，二，三，数到第七下才停手。',
  '',
  '　　前殿那边传来钟声。林山抬头看了一眼天色，转身往下走。石阶很窄，两侧的松针落了一地。',
  '',
  '　　他忽然想起昨夜师父说过的那句话，脚下慢了半拍，随即又加快。有些事想不明白，就只能先往前走。',
  '',
].join('\n');

const CHANGES = [
  '---CHANGES---',
  '<!-- 角色状态变化 -->',
  '- **[林山]**：健康→健康',
  '<!-- 角色移动 -->',
  '- **[林山]**：青云山后山→青云山前殿',
  '<!-- 交接包 -->',
  '- 剧情当前位置：青云山前殿',
  '---END CHANGES---',
  '',
].join('\n');

const SNAPSHOT = [
  '# 状态快照（截止第0章）',
  '',
  '## 角色状态',
  '',
  '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
  '|------|------|----------|------|------|-----------|',
  '| 林山 | 炼气三层 | 青云山后山 | 健康 | 剑 | 0 |',
  '',
].join('\n');

function writeConfig(dir, chapterWords) {
  const cfg = {
    info: { name: '测试书' },
    save_location: 'local',
    backup: { mode: 'local', local_path: './备份' },
    local: { content_path: './正文', settings_path: './设定' },
    writing: { chapter_words: chapterWords || { min: 100, max: 4000 } },
  };
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  return p;
}

function setup(draftText) {
  const dir = tmpDir('nw-pub-');
  const settingsDir = path.join(dir, '设定');
  fs.mkdirSync(path.join(settingsDir, '角色设定', '主角'), { recursive: true });
  fs.mkdirSync(path.join(settingsDir, '地点设定'), { recursive: true });
  fs.mkdirSync(path.join(settingsDir, '伏笔追踪'), { recursive: true });
  fs.writeFileSync(path.join(settingsDir, '角色设定', '主角', '林山.md'), '# 林山\n\n- 发色：黑\n- 瞳色：黑\n');
  fs.writeFileSync(path.join(settingsDir, '地点设定', '青云山.md'), '# 青云山\n');
  fs.writeFileSync(path.join(settingsDir, '状态快照.md'), SNAPSHOT);

  const contentDir = path.join(dir, '正文');
  const draft = path.join(dir, '草稿', '第001章.md');
  fs.mkdirSync(path.dirname(draft), { recursive: true });
  fs.writeFileSync(draft, draftText || BODY + CHANGES);

  const config = writeConfig(dir);
  const aiGates = path.join(dir, 'ai-gates.json');
  writeAiGates(aiGates, BODY + CHANGES);
  return { dir, settingsDir, contentDir, draft, config, aiGates, target: path.join(contentDir, '第001章.md'), ledger: path.join(settingsDir, 'changes', 'ch001-publish.json') };
}

// 正文里原样存在的一段 ≥8 字原文：证据必须能引到它，否则视为没读正文
const QUOTE = '他把剑从鞘里抽出一寸';

function writeAiGates(file, draftText) {
  const gates = {};
  for (const g of gate.GATES.filter((x) => x.aiRequired)) {
    gates[g.key] = { verdict: 'pass', evidence: `${g.label}：以「${QUOTE}」这类动作为证，长短句混排无套话` };
  }
  fs.writeFileSync(file, JSON.stringify({ chapter: 1, contentFingerprint: gate.contentFingerprint(draftText), gates }, null, 2) + '\n');
}

function readLedger(f) {
  return JSON.parse(fs.readFileSync(f.ledger, 'utf-8'));
}

// ---------------- gate-report ----------------

test('gate-report：缺 AI 声明 → exit 1，报告标 blocked 且语义门禁记 skip', () => {
  const f = setup();
  const out = path.join(f.dir, 'report.json');
  const r = runReport([f.draft, '--config', f.config, '--out', out]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf-8'));
  assert.strictEqual(report.blocked, true);
  assert.ok(report.blockReasons.some((x) => /AI 侧门禁声明/.test(x)), report.blockReasons.join(' / '));
  const g2 = report.gates.find((g) => g.key === 'gate2_ai_syntax');
  assert.strictEqual(g2.verdict, 'skip', '未判断不等于通过');
});

test('gate-report：AI 声明齐全 → exit 0，报告自检通过且规则侧门禁真的跑了', () => {
  const f = setup();
  const out = path.join(f.dir, 'report.json');
  const r = runReport([f.draft, '--config', f.config, '--ai-gates', f.aiGates, '--out', out]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf-8'));
  assert.strictEqual(report.blocked, false);
  assert.strictEqual(report.summary.fail, 0);
  assert.strictEqual(report.ruleVersion, gate.RULE_VERSION);
  const check = gate.verifyReport(report, { draftText: fs.readFileSync(f.draft, 'utf-8') });
  assert.deepStrictEqual(check.problems, []);
  // 有快照与设定目录 → 一致性族不许落成 skip
  for (const key of gate.CONSISTENCY_KEYS) {
    const g = report.gates.find((x) => x.key === key);
    assert.notStrictEqual(g.verdict, 'skip', `${key} 不应 skip`);
  }
  const g1 = report.gates.find((g) => g.key === 'gate1_text_health');
  assert.strictEqual(g1.verdict, 'pass', JSON.stringify(g1.items));
});

test('gate-report：AI 声明指纹属于旧稿 → exit 1（不许拿旧结论放新稿）', () => {
  const f = setup();
  const stale = path.join(f.dir, 'ai-stale.json');
  // 指纹不匹配必须来自正文改动（CHANGES 块不参与指纹，改它等于没改）
  writeAiGates(stale, BODY.replace('晨雾还没散', '晨雾还没散尽') + CHANGES);
  const r = runReport([f.draft, '--config', f.config, '--ai-gates', stale]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /旧稿/);
});

test('gate-report：证据没引正文原文（空话）→ exit 1（防「没读稿就给结论」）', () => {
  const f = setup();
  const fake = path.join(f.dir, 'ai-fake.json');
  const decl = JSON.parse(fs.readFileSync(f.aiGates, 'utf-8'));
  decl.gates.gate3_psych_external = { verdict: 'pass', evidence: '整体质量达标，心理描写处理得当，没有问题' };
  fs.writeFileSync(fake, JSON.stringify(decl, null, 2));
  const r = runReport([f.draft, '--config', f.config, '--ai-gates', fake]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /没有引文/);
});

test('gate-report：证据引文是编造的（正文里没有）→ exit 1', () => {
  const f = setup();
  const fake = path.join(f.dir, 'ai-fabricated.json');
  const decl = JSON.parse(fs.readFileSync(f.aiGates, 'utf-8'));
  decl.gates.gate2_ai_syntax = { verdict: 'pass', evidence: '「他把剑收回鞘中，转身走向前殿的钟楼」这句没有任何套话' };
  fs.writeFileSync(fake, JSON.stringify(decl, null, 2));
  const r = runReport([f.draft, '--config', f.config, '--ai-gates', fake]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /找不到/);
});

test('gate-report：--emit-ai-template 产出骨架（指纹+5 槽），填完即可发布', () => {
  const f = setup();
  const tplPath = path.join(f.dir, 'ai-template.json');
  const g = runReport([f.draft, '--emit-ai-template', tplPath]);
  assert.strictEqual(g.status, 0, g.stdout + g.stderr);
  const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf-8'));
  assert.strictEqual(tpl.contentFingerprint, gate.contentFingerprint(BODY + CHANGES));
  assert.deepStrictEqual(Object.keys(tpl.gates).length, 5);

  for (const v of Object.values(tpl.gates)) {
    v.verdict = 'pass';
    v.evidence = `以「${QUOTE}」为准，本项无问题`;
  }
  fs.writeFileSync(tplPath, JSON.stringify(tpl, null, 2));
  const r = runPublish([f.config, f.draft, '--ai-gates', tplPath]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(f.target));
});

test('gate-report：用法错误 → exit 2', () => {
  assert.strictEqual(runReport([]).status, 2);
  assert.strictEqual(runReport(['不存在.md']).status, 2);
  assert.strictEqual(runReport(['x.md', '--bogus']).status, 2);
});

// ---------------- publish-chapter ----------------

test('publish：首次发布 → 正文落盘、账本一条、报告与指纹可复核、无 tmp 残留', () => {
  const f = setup();
  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(f.target), '正文未落盘');
  const published = fs.readFileSync(f.target, 'utf-8');
  assert.strictEqual(gate.contentFingerprint(published), gate.contentFingerprint(BODY + CHANGES));

  const led = readLedger(f);
  assert.strictEqual(led.publishes.length, 1);
  assert.strictEqual(led.chapter, 1);
  const rec = led.publishes[0];
  assert.strictEqual(rec.forced, false);
  assert.strictEqual(rec.revised, false);
  assert.match(rec.reportIntegrity, /^sha256:/);
  assert.strictEqual(rec.ruleVersion, gate.RULE_VERSION);
  // 发布那一刻的正文指标落进账本：之后正文被手改，「当时多少字」还查得到
  assert.deepStrictEqual(Object.keys(rec.metrics).sort(), ['chars', 'dialogueRatio', 'paragraphs', 'words']);
  assert.strictEqual(rec.metrics.words, (BODY.match(/[\u4e00-\u9fff]/g) || []).length);
  assert.ok(rec.metrics.paragraphs >= 1, '段数应该至少 1');
  assert.ok(rec.metrics.chars >= rec.metrics.words, '去空白字符数不应小于汉字数');

  const left = fs.readdirSync(f.contentDir).filter((n) => n.includes('.tmp-'));
  assert.deepStrictEqual(left, [], '不应残留临时文件');
});

test('publish：同稿重复发布 → 幂等 no-op，账本仍一条', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const before = fs.readFileSync(f.target, 'utf-8');
  const r2 = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /幂等跳过/);
  assert.strictEqual(readLedger(f).publishes.length, 1);
  assert.strictEqual(fs.readFileSync(f.target, 'utf-8'), before);
});

test('publish：门禁阻断（正文混入半角标点）→ exit 1，正文一个字都不写', () => {
  const f = setup((BODY + CHANGES).replace('晨雾还没散', '晨雾还没散,'));
  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(f.target), '阻断时正文目录不该出现章节文件');
  assert.ok(fs.existsSync(path.join(f.settingsDir, 'changes', 'ch001-gate-report.json')), '阻断也要留报告备查');
  assert.ok(!fs.existsSync(f.ledger), '阻断不该记发布账本');
});

test('publish：缺 CHANGES 协议块 → exit 1（正文与变更声明必须同稿）', () => {
  const f = setup(BODY);
  const r = runPublish([f.config, f.draft, '--no-gate']);
  assert.strictEqual(r.status, 0, '--no-gate 是人工补救通道，不跑门禁');
  const f2 = setup(BODY);
  const r2 = runPublish([f2.config, f2.draft, '--ai-gates', f2.aiGates]);
  assert.strictEqual(r2.status, 1, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /CHANGES/);
});

test('publish：字数不足配置下限 → exit 1（字数门禁有脚本兜底）', () => {
  const f = setup();
  writeConfig(f.dir, { min: 5000, max: 6000 });
  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /字数不足/);
});

test('publish：正文已存在且指纹不同 → exit 3，不覆盖定稿', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const before = fs.readFileSync(f.target, 'utf-8');

  const changed = BODY.replace('数到第七下才停手', '数到第九下才停手') + CHANGES;
  fs.writeFileSync(f.draft, changed);
  writeAiGates(f.aiGates, changed);

  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /--revise/);
  assert.strictEqual(fs.readFileSync(f.target, 'utf-8'), before, '定稿正文被改写了');
  assert.strictEqual(readLedger(f).publishes.length, 1);
});

test('publish：--revise → 显式改稿放行，旧指纹进账本 history', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const oldFp = gate.contentFingerprint(fs.readFileSync(f.target, 'utf-8'));

  const changed = BODY.replace('数到第七下才停手', '数到第九下才停手') + CHANGES;
  fs.writeFileSync(f.draft, changed);
  writeAiGates(f.aiGates, changed);

  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates, '--revise']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(gate.contentFingerprint(fs.readFileSync(f.target, 'utf-8')), gate.contentFingerprint(changed));
  const led = readLedger(f);
  assert.strictEqual(led.publishes.length, 2);
  assert.strictEqual(led.publishes[1].revised, true);
  assert.strictEqual(led.publishes[1].revisedFrom, oldFp);
});

test('publish：--no-gate → 放行但账本记 forced=true（跳过门禁留痕）', () => {
  const f = setup();
  const r = runPublish([f.config, f.draft, '--no-gate']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(f.target));
  const rec = readLedger(f).publishes[0];
  assert.strictEqual(rec.forced, true);
  const report = JSON.parse(fs.readFileSync(path.join(f.settingsDir, 'changes', 'ch001-gate-report.json'), 'utf-8'));
  assert.strictEqual(report.gatesSkipped, true);
  assert.strictEqual(report.summary.skip, 12);
});

test('publish：--dry-run → 只跑门禁不落盘', () => {
  const f = setup();
  const r = runPublish([f.config, f.draft, '--ai-gates', f.aiGates, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(f.target));
  assert.ok(!fs.existsSync(f.ledger));
});

test('publish：章号无法确定 → exit 2；配置缺目录字段 → exit 2', () => {
  const f = setup();
  const noChapter = path.join(f.dir, '草稿', '初稿.md');
  fs.writeFileSync(noChapter, BODY + CHANGES);
  assert.strictEqual(runPublish([f.config, noChapter, '--ai-gates', f.aiGates]).status, 2);
  assert.strictEqual(runPublish([f.config, noChapter, '--chapter', '3', '--ai-gates', f.aiGates]).status, 0);

  const badCfg = path.join(f.dir, 'bad.json');
  fs.writeFileSync(badCfg, JSON.stringify({ info: { name: 'x' }, local: { content_path: './正文' } }));
  assert.strictEqual(runPublish([badCfg, f.draft]).status, 2);
});

test('publish：--chapter 指定章号 → 正文文件按 3 位补零命名', () => {
  const f = setup();
  const r = runPublish([f.config, f.draft, '--chapter', '7', '--no-gate']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(f.contentDir, '第007章.md')));
});

// ---------------- 快照回写（CHANGES 欠账）----------------

/** 在同一个书目录里造第 2 章草稿（内容与第 1 章同构，指纹相同不影响判定） */
function addChapter2(f) {
  const draft2 = path.join(f.dir, '草稿', '第002章.md');
  fs.writeFileSync(draft2, BODY + CHANGES);
  return draft2;
}

function touchSnapshot(f, line) {
  fs.appendFileSync(path.join(f.settingsDir, '状态快照.md'), line + '\n');
}

test('publish：第 1 章发布后快照没回写 → 第 2 章 exit 4，正文不落盘但留报告', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const draft2 = addChapter2(f);
  const r = runPublish([f.config, draft2, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /状态快照欠账/);
  assert.match(r.stderr, /未被改动/);
  assert.ok(!fs.existsSync(path.join(f.contentDir, '第002章.md')), '欠账时不许落盘');
  assert.ok(!fs.existsSync(path.join(f.settingsDir, 'changes', 'ch002-publish.json')), '欠账时不许记账');
  const report = JSON.parse(fs.readFileSync(path.join(f.settingsDir, 'changes', 'ch002-gate-report.json'), 'utf-8'));
  assert.strictEqual(report.snapshotFreshness.verdict, 'fail');
  assert.strictEqual(report.snapshotFreshness.previousChapter, 1);
});

test('publish：回写快照后第 2 章放行（快照指纹变了即视为已回写）', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const draft2 = addChapter2(f);
  touchSnapshot(f, '\n## 已回写\n\n- 林山：青云山前殿');
  const r = runPublish([f.config, draft2, '--ai-gates', f.aiGates]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(f.contentDir, '第002章.md')));
  const ledger2 = JSON.parse(fs.readFileSync(path.join(f.settingsDir, 'changes', 'ch002-publish.json'), 'utf-8'));
  assert.strictEqual(ledger2.publishes[0].staleSnapshot, false);
  assert.match(ledger2.publishes[0].snapshotFingerprint, /^sha256:[0-9a-f]{64}$/);
});

test('publish：--allow-stale-snapshot 认账放行，账本记 staleSnapshot=true', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const draft2 = addChapter2(f);
  const r = runPublish([f.config, draft2, '--ai-gates', f.aiGates, '--allow-stale-snapshot']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const ledger2 = JSON.parse(fs.readFileSync(path.join(f.settingsDir, 'changes', 'ch002-publish.json'), 'utf-8'));
  assert.strictEqual(ledger2.publishes[0].staleSnapshot, true);
});

test('publish：--no-gate 的补救发布不受快照欠账拦截', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const draft2 = addChapter2(f);
  const r = runPublish([f.config, draft2, '--no-gate']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('publish：--apply-changes → 发布后自动回写快照，下一章不再被判欠账', () => {
  const f = setup();
  const r1 = runPublish([f.config, f.draft, '--ai-gates', f.aiGates, '--apply-changes']);
  assert.strictEqual(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /快照回写/);

  const snap = fs.readFileSync(path.join(f.settingsDir, '状态快照.md'), 'utf-8');
  assert.match(snap, /# 状态快照（截止第1章）/);
  assert.match(snap, /\| 林山 \| 炼气三层 \| 青云山前殿 \| 健康 \| 剑 \| 1 \|/);
  assert.match(snap, /- 剧情当前位置：青云山前殿/);
  assert.strictEqual(readLedger(f).publishes[0].snapshotApplied, true);

  // 快照已被脚本回写 → 第 2 章不再被判「快照欠账」（exit 4）。
  // 这里复用的是同一份草稿，它的出发地（后山）与回写后的快照（前殿）不一致，
  // 所以门禁会按「移动对不上」拦下——那正是该拦的；本用例只关心欠账这一层。
  const draft2 = addChapter2(f);
  const r2 = runPublish([f.config, draft2, '--ai-gates', f.aiGates]);
  assert.notStrictEqual(r2.status, 4, r2.stdout + r2.stderr);
  assert.ok(!/状态快照欠账/.test(r2.stderr), r2.stderr);
});

test('publish：没用 --apply-changes 时账本不写 snapshotApplied 字段', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  assert.strictEqual('snapshotApplied' in readLedger(f).publishes[0], false);
});

// 新角色登场：CHANGES 里有名字、设定里没档案 → 门禁 1 按「未登记实体」拦；--scaffold 先建档就放行
const CHANGES_NEW_CAST = [
  '---CHANGES---',
  '<!-- 角色状态变化 -->',
  '- **[林山]**：健康→健康',
  '- **[苏瑶]**：健康',
  '<!-- 角色移动 -->',
  '- **[林山]**：青云山后山→青云山前殿',
  '<!-- 交接包 -->',
  '- 剧情当前位置：青云山前殿',
  '---END CHANGES---',
  '',
].join('\n');

test('publish：--scaffold → 新角色先建档再过门禁', () => {
  const f = setup(BODY + CHANGES_NEW_CAST);
  writeAiGates(f.aiGates, BODY + CHANGES_NEW_CAST);
  const noDossier = path.join(f.settingsDir, '角色设定', '苏瑶.md');
  assert.strictEqual(fs.existsSync(noDossier), false);

  // 不建档：门禁 1 拦下，正文不落盘
  const blocked = runPublish([f.config, f.draft, '--ai-gates', f.aiGates]);
  assert.strictEqual(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stdout + blocked.stderr, /苏瑶/);
  assert.strictEqual(fs.existsSync(f.target), false);

  // --scaffold：先补档案骨架，再走门禁 → 发布成功
  const ok = runPublish([f.config, f.draft, '--ai-gates', f.aiGates, '--scaffold']);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /建档/);
  assert.ok(fs.existsSync(noDossier), '应建出 设定/角色设定/苏瑶.md');
  assert.match(fs.readFileSync(noDossier, 'utf-8'), /^# 苏瑶$/m);
  assert.strictEqual(readLedger(f).publishes[0].scaffolded, true);
});

test('publish：没用 --scaffold 时账本不写 scaffolded 字段', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  assert.strictEqual('scaffolded' in readLedger(f).publishes[0], false);
});

// ---------------- publish-status（账本审计）----------------

test('publish-status：账本、报告、正文一致 → exit 0', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  touchSnapshot(f, '- 林山：青云山前殿');
  const r = runStatus([f.config]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /账本与报告一致/);
  assert.match(r.stdout, /第001章/);
});

test('publish-status：报告被手改 → exit 1 并指出 integrity 不一致', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const reportPath = path.join(f.settingsDir, 'changes', 'ch001-gate-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  report.gates[0].verdict = 'fail';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const r = runStatus([f.config]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /发现需要处理的问题/);
  assert.match(r.stdout, /报告自检不通过|integrity/);
});

test('publish-status：快照待回写 → exit 0 但提醒（拦截留给下一章发布时）', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  const r = runStatus([f.config]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /状态快照\.md 至今未改动/);
  assert.match(r.stdout, /回写后本提醒消失/);
});

test('publish-status：正文发布后被改 → exit 0 但给待确认提示', () => {
  const f = setup();
  assert.strictEqual(runPublish([f.config, f.draft, '--ai-gates', f.aiGates]).status, 0);
  touchSnapshot(f, '- 林山：青云山前殿');
  // 改正文（不是改 CHANGES 块——CHANGES 不参与正文指纹，这是刻意口径）
  const edited = fs.readFileSync(f.target, 'utf-8').replace('青云山的晨雾还没散', '青云山的浓雾还没散');
  fs.writeFileSync(f.target, edited);
  const r = runStatus([f.config]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /正文在发布后被改动/);
});

test('publish-status：没有账本 → exit 0，明说尚无记录', () => {
  const f = setup();
  const r = runStatus([f.config]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /尚无发布记录|没有发布记录/);
});
