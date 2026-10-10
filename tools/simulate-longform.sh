#!/usr/bin/env bash
# 长篇（30 章）长期积累回归：伏笔状态机跨章 / 快照膨胀 / 跨章位置一致性 / 冲突检测
# 用法: bash tools/simulate-longform.sh
# 设计：机械化生成 30 章（每章正文+CHANGES），逐章跑门禁；不手写正文，专测机器在长跨度下的行为
set +e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT
python3 - <<'PY'
import os, subprocess, tempfile, time, shutil
ROOT = os.environ['ROOT']
CC = ['node', os.path.join(ROOT, 'scripts', 'check-consistency.js')]
CF = ['node', os.path.join(ROOT, 'scripts', 'check-conflicts.js')]
VG = ['node', os.path.join(ROOT, 'scripts', 'verify-gate-report.js')]
N = 50
WORK = tempfile.mkdtemp(prefix='nw-long-')
SET = os.path.join(WORK, '设定')
for d in ['角色设定/主角', '地点设定', '物品设定', '伏笔追踪']:
    os.makedirs(os.path.join(SET, d), exist_ok=True)
LOCS = ['青云山', '古庙', '天剑宗', '黑风寨', '迷雾森林']
for l in LOCS:
    open(os.path.join(SET, '地点设定', l + '.md'), 'w').write('# %s\n' % l)
open(os.path.join(SET, '角色设定', '主角', '林山.md'), 'w').write('# 林山\n- 发色：黑\n- 瞳色：黑\n')
open(os.path.join(SET, '角色设定', '主角', '苏瑶.md'), 'w').write('# 苏瑶\n- 发色：银白\n- 瞳色：蓝\n')
open(os.path.join(SET, '物品设定', '断锋剑.md'), 'w').write('# 断锋剑\n')

pos = {'林山': '—'}
last = {'林山': 0, '苏瑶': 0}
fors = {}   # id -> dict(name,type,state,plant,prog,reveal)
pending = []  # 本同新建的伏笔文档（阶段四「回写」时才建档，门禁时尚未存在）
items = {'断锋剑': '林山'}
day = 0
snap_path = os.path.join(SET, '状态快照.md')

def write_snap(ch):
    L = ['# 状态快照（截止第%d章）' % ch, '']
    L += ['## 角色状态', '| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |',
          '|------|------|----------|------|------|-----------|']
    for name, p in pos.items():
        L.append('| %s | 金丹期 | %s | 健康 | — | %d |' % (name, p, last[name]))
    L += ['', '## 角色外貌', '| 角色 | 发色 | 瞳色 | 外貌特征 | 性格标签 |',
          '|------|------|------|----------|----------|',
          '| 林山 | 黑 | 黑 | 剑眉 | 隐忍 |', '| 苏瑶 | 银白 | 蓝 | 冷艳 | 清冷 |']
    L += ['', '## 伏笔状态',
          '| 伏笔ID | 伏笔名 | 类型 | 预期读者效果 | 状态 | 埋设章 | 推进章 | 揭晓章 |',
          '|--------|--------|------|--------------|------|--------|--------|--------|']
    for fid, f in sorted(fors.items()):
        L.append('| %s | %s | %s | %s | %s | %s | %s | %s |' %
                 (fid, f['name'], f['type'], '揭晓时震惊', f['state'],
                  f['plant'], f.get('prog', '—'), f.get('reveal', '待定')))
    L += ['', '## 地点状态', '| 地点 | 当前状态 | 触发事件 | 相关章节 |',
          '|------|----------|----------|----------|', '| 青云山 | 正常 | — | 1 |']
    L += ['', '## 物品归属', '| 物品 | 持有者 | 状态 |', '|------|--------|------|']
    for it, o in items.items():
        L.append('| %s | %s | active |' % (it, o))
    L += ['', '## 时间线（最近一章）', '- 第%d天：推进' % day]
    open(snap_path, 'w').write('\n'.join(L) + '\n')

def changes(ch):
    global day
    x = ['---CHANGES---']
    x += ['<!-- 角色状态变化 -->', '- **[林山]**：健康→健康']
    # 移动
    to = LOCS[ch % len(LOCS)]
    x += ['<!-- 角色移动 -->', '- **[林山]**：%s→%s' % (pos['林山'], to)]
    pos['林山'] = to; last['林山'] = ch
    # 伏笔排程
    plan = {1: ('plant', 'v1', '断锋来历', '长线'), 2: ('plant', 'v2', '古庙秘密', '短线'),
            3: ('progress', 'v1', '断锋来历', '长线'), 4: ('plant', 'v3', '掌门失踪', '长线'),
            5: ('harvest', 'v2', '古庙秘密', '短线'), 20: ('harvest', 'v1', '断锋来历', '长线'),
            21: ('progress', 'v1', '断锋来历', '长线'), 22: ('plant', 'v3', '掌门失踪', '长线')}
    expect_fail = False
    if ch in plan:
        act, fid, name, typ = plan[ch]
        if act == 'plant':
            if fid in fors:  # 重复埋设 → 预期打回
                expect_fail = True
                x += ['<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
                      '- 🔨埋设 **%s %s**（类型：%s）| 预期读者效果：X | 线索：重复' % (fid, name, typ)]
            else:
                fors[fid] = {'name': name, 'type': typ, 'state': '已埋设', 'plant': ch}
                pending.append((fid, name))  # 建档延到回写阶段（门禁时不能已存在）
                x += ['<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
                      '- 🔨埋设 **%s %s**（类型：%s）| 预期读者效果：X | 线索：初始' % (fid, name, typ)]
        elif act == 'progress':
            if fors.get(fid, {}).get('state') in ('已回收', '已废弃'):  # 终态回退 → 预期打回
                expect_fail = True
            else:
                fors[fid]['state'] = '已推进'
                fors[fid]['prog'] = str(ch)
            x += ['<!-- 伏笔动作（四态，必须引用伏笔ID） -->', '- ➡️推进 **%s %s** | 新线索' % (fid, name)]
        elif act == 'harvest':
            fors[fid]['state'] = '已回收'; fors[fid]['reveal'] = str(ch)
            x += ['<!-- 伏笔动作（四态，必须引用伏笔ID） -->',
                  '- ✅回收 **%s %s** | 回收方式：揭晓' % (fid, name)]
    if ch == 6:  # 物品流转
        items['断锋剑'] = '苏瑶'
        x += ['<!-- 物品流转 -->', '- **[断锋剑]**：林山→苏瑶 | 方式：赠送 | 物品状态：完好']
    x += ['<!-- 交接包 -->', '- 剧情当前位置：第%d章' % ch, '- 下章该写：继续']
    x += ['---END CHANGES---']
    day += 3
    return '\n'.join(x) + '\n', expect_fail

REPORT = ('🛡️ 门禁结果（第X章）\n  ✅ Gate 1-6 写作质量：通过\n  ✅ 引用校验：通过\n'
          '  ✅ 一致性校验：通过\n  ✅ 描写一致性：通过\n  ✅ 未知实体检测：通过\n'
          '  ✅ 蓝图出场合规：通过\n  ✅ 伏笔闭环校验：通过\n')
rep = os.path.join(WORK, '报告.md'); open(rep, 'w').write(REPORT)

# 初始快照（截止第0章）
write_snap(0)
PASS = FAIL = 0
def chk(name, cond, extra=''):
    global PASS, FAIL
    if cond: PASS += 1; print('  ✅ %s' % name)
    else: FAIL += 1; print('  ❌ %s %s' % (name, extra))

t0 = time.time()
fails = {21, 22}
for ch in range(1, N + 1):
    chap = os.path.join(WORK, '第%03d章.md' % ch)
    changes_txt, _ = changes(ch)
    open(chap, 'w').write('　　第%d章的内容。\n' % ch + changes_txt)
    r = subprocess.run(CC + [snap_path, chap, SET], capture_output=True, text=True)
    if ch in fails:
        chk('ch%02d 预期打回（终态回退/重复埋设）' % ch, r.returncode == 1, r.stderr[:120])
    else:
        chk('ch%02d 一致性通过' % ch, r.returncode == 0, (r.stdout + r.stderr)[:160])
        if ch == 14:
            chk('ch14 伏笔 v3 埋设 10 章未推进警告', '已埋设 10 章未推进' in r.stdout, r.stdout[:160])
    # 阶段四回写：为本章新建的伏笔建档（门禁时尚未存在，对齐真实时序）
    for fid, name in pending:
        open(os.path.join(SET, '伏笔追踪', '%s-%s.md' % (fid, name)), 'w').write('# %s\n' % fid)
    pending.clear()
    write_snap(ch)  # 回写
    rc = subprocess.run(CF + [snap_path, SET], capture_output=True, text=True)
    chk('ch%02d 冲突检测通过' % ch, rc.returncode == 0, rc.stderr[:120])
    rv = subprocess.run(VG + [rep], capture_output=True, text=True)
    chk('ch%02d 门禁报告完整' % ch, rv.returncode == 0, rv.stderr[:120])

dt = time.time() - t0
size = os.path.getsize(snap_path)
print('\n最终快照 %d 字节（%d 章后）' % (size, N))
print('总耗时 %.2fs（平均 %.0f ms/章）' % (dt, dt / N * 1000))
print('\n===== 结果: PASS=%d FAIL=%d =====' % (PASS, FAIL))
shutil.rmtree(WORK, ignore_errors=True)
import sys; sys.exit(1 if FAIL else 0)
PY
