#!/usr/bin/env bash
# 发布闸门端到端回归（publish-chapter + 分章账本 + publish-status）
# 用法: bash tools/simulate-publish.sh
# 覆盖: 首发布落盘与记账 / 幂等重发不重复记账 / 快照欠账 exit 4 / --allow-stale-snapshot 放行并记账 /
#       改稿默认拒绝 exit 3 / --revise 覆盖并留旧指纹 / 门禁阻断 exit 1 且正文一个字节不动 / 账本审计 exit 0 /
#       --apply-changes 自动回写快照 / housekeeping 清理草稿报告且不碰验收记录与账本
# 为什么放 CI：node --test 跑的是进程内逻辑；发布链路的真实入口是 shell 里的 CLI，退出码与账本落盘
# 只有在这里跑一遍才算验过（v3.5.26 的 exit 4 与 v3.5.28 的 --data 比对都靠它兜底）。
set +e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="node $ROOT/scripts/publish-chapter.js"
STATUS="node $ROOT/scripts/publish-status.js"
NEXT="node $ROOT/scripts/next-chapter.js"
REPORT="node $ROOT/scripts/gate-report.js"
HK="node $ROOT/scripts/housekeeping.js"
WORK="$(mktemp -d /tmp/nw-publish.XXXXXX)"
cd "$WORK" || exit 2
mkdir -p 草稿 正文 设定/changes 设定/角色设定/主角 设定/地点设定

PASS=0; FAIL=0
check() {
  local name="$1" expect="$2" actual="$3" out="${4:-}"
  if [ "$expect" = "$actual" ]; then
    PASS=$((PASS+1)); echo "✅ [$name] exit=$actual 符合预期"
  else
    FAIL=$((FAIL+1)); echo "❌ [$name] 期望 exit=$expect 实际=$actual"; echo "$out" | tail -8
  fi
}
ok() {
  local name="$1" cond="$2" detail="${3:-}"
  if [ "$cond" = "1" ]; then PASS=$((PASS+1)); echo "✅ [$name]"
  else FAIL=$((FAIL+1)); echo "❌ [$name] $detail"; fi
}
# 账本里第 N 章的发布次数（文件不存在 → 0）；账本文件名是补零的三位章号
ledger_count() {
  node -e "const fs=require('fs');const p='设定/changes/ch'+String(process.argv[1]).padStart(3,'0')+'-publish.json';if(!fs.existsSync(p)){console.log(0);process.exit(0)}console.log(JSON.parse(fs.readFileSync(p,'utf-8')).publishes.length)" "$1" 2>/dev/null || echo 0
}
ledger_field() { # $1=章号 $2=第几笔 $3=字段
  node -e "const fs=require('fs');const p='设定/changes/ch'+String(process.argv[1]).padStart(3,'0')+'-publish.json';const r=JSON.parse(fs.readFileSync(p,'utf-8'));const rec=r.publishes[Number(process.argv[2])];console.log(rec?String(rec[process.argv[3]]):'missing')" "$1" "$2" "$3" 2>/dev/null || echo missing
}

cat > config.json <<'EOF'
{
  "info": { "name": "发布冒烟", "type": "长篇" },
  "save_location": "local",
  "local": { "content_path": "./正文", "settings_path": "./设定" },
  "writing": { "pov": "第三人称", "perspective": "限制视角", "style": "平实", "chapter_words": { "min": 100, "max": 4000 } }
}
EOF

cat > 设定/角色设定/主角/林山.md <<'EOF'
# 林山
- 发色：黑
- 瞳色：黑
- 兵器：断锋剑
EOF

cat > 设定/地点设定/青云山.md <<'EOF'
# 青云山
- 类型：门派山门
- 方位：东
EOF

cat > 设定/状态快照.md <<'EOF'
# 状态快照（开书前）

## 角色状态
| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |
|------|------|----------|------|------|-----------|
| 林山 | 炼气三层 | 青云山后山 | 健康 | 断锋剑 | 0 |
EOF

cat > 草稿/第001章.md <<'EOF'
　　青云山的晨雾还没散，林山已经站在后山的石阶上。他把断锋剑从鞘里抽出一寸，又推了回去，铁器摩擦的声音在山谷里转了半圈才停。
　　风从谷底翻上来，带着湿冷的草腥气。他数着呼吸，一，二，三，数到第七下才停手，指节上的旧伤被冷风一激，隐隐发胀。
　　他想起昨夜师父说过的那句话，脚下慢了半拍，随即又加快。有些事想不明白，就只能先往前走，走到山门再回头看一眼。
　　山道尽头的松枝上挂着露水，一滴一滴落在青石上。林山提剑穿过那片松林，朝前殿去了。
---CHANGES---
<!-- 角色状态变化 -->
- **[林山]**：健康→健康 | 位置：青云山后山→青云山前殿
<!-- 角色移动 -->
- 林山：青云山后山 → 青云山前殿
<!-- 交接包 -->
- 剧情当前位置：青云山前殿
- 未了结线索：师父那句没说完的话
---END CHANGES---
EOF

cat > 草稿/第002章.md <<'EOF'
　　前殿的铜钟被风撞了一下，声音在檐角上碎开。林山立在阶下，看着殿门里那块被香火熏黑的长明灯。
　　有人从侧廊过来，脚步很轻，袖口带着药味。他抬眼看了看那人腰间挂的竹牌，竹牌上刻着一个没见过的字。
　　两人对望了一眼，谁也没先开口。殿外的钟声歇了，风也停了，只剩下灯芯爆响的细碎声音。
　　林山把断锋剑往身侧挪了挪，留出了半步的距离。
---CHANGES---
<!-- 角色状态变化 -->
- **[林山]**：健康→健康 | 位置：青云山前殿
<!-- 角色移动 -->
- 林山：青云山前殿 → 前殿西廊
<!-- 交接包 -->
- 剧情当前位置：前殿西廊
- 未了结线索：竹牌上那个字
---END CHANGES---
EOF

# 造 AI 声明：先取指纹骨架，再把 5 条结论写 pass 并附正文引文（引文必须原样出现在本稿正文里）
make_decl() { # $1=草稿 $2=输出 $3=引文
  $REPORT "$1" --config config.json --emit-ai-template "$2" >/dev/null 2>&1
  node -e "
const fs=require('fs');const p=process.argv[1];const quote=process.argv[2];
const d=JSON.parse(fs.readFileSync(p,'utf-8'));
for(const k of Object.keys(d.gates)){d.gates[k].verdict='pass';d.gates[k].evidence='正文「'+quote+'」这段没有套话与心理外化';}
fs.writeFileSync(p,JSON.stringify(d,null,2));
" "$2" "$3"
}

echo "===== 场景 1：首发布（门禁通过 → 落盘 + 记账）====="
make_decl 草稿/第001章.md decl1.json "铁器摩擦的声音在山谷里转了半圈"
OUT=$($PUB config.json 草稿/第001章.md --ai-gates decl1.json 2>&1); CODE=$?
check "第1章首发布" 0 $CODE "$OUT"
ok "正文已落盘" "$([ -f 正文/第001章.md ] && echo 1 || echo 0)" "正文/第001章.md 不存在"
ok "账本记 1 笔" "$([ "$(ledger_count 1)" = "1" ] && echo 1 || echo 0)" "实际 $(ledger_count 1) 笔"

echo ""
echo "===== 场景 2：同稿重发（幂等，不重复记账）====="
OUT=$($PUB config.json 草稿/第001章.md --ai-gates decl1.json 2>&1); CODE=$?
check "第1章重发" 0 $CODE "$OUT"
ok "账本仍 1 笔" "$([ "$(ledger_count 1)" = "1" ] && echo 1 || echo 0)" "实际 $(ledger_count 1) 笔"

echo ""
echo "===== 场景 3：账本审计（一致的账本）====="
OUT=$($STATUS config.json 2>&1); CODE=$?
check "publish-status 审计" 0 $CODE "$OUT"

echo ""
echo "===== 场景 4：上一章没回写快照 → 拒绝发布（exit 4）====="
make_decl 草稿/第002章.md decl2.json "前殿的铜钟被风撞了一下"
OUT=$($PUB config.json 草稿/第002章.md --ai-gates decl2.json 2>&1); CODE=$?
check "快照欠账" 4 $CODE "$OUT"
ok "第2章正文未落盘" "$([ -f 正文/第002章.md ] && echo 0 || echo 1)" "正文/第002章.md 不该存在"
ok "第2章账本未写" "$([ "$(ledger_count 2)" = "0" ] && echo 1 || echo 0)" "实际 $(ledger_count 2) 笔"
printf '%s\n' "$OUT" | grep -q "状态快照" && echo "  → 拦截原因正确：状态快照欠账" || { echo "  → 拦截原因不符！"; echo "$OUT" | tail -5; FAIL=$((FAIL+1)); }

echo ""
echo "===== 场景 5：--allow-stale-snapshot 明确承认后可发（账本记 staleSnapshot）====="
OUT=$($PUB config.json 草稿/第002章.md --ai-gates decl2.json --allow-stale-snapshot 2>&1); CODE=$?
check "承认欠账后发布" 0 $CODE "$OUT"
ok "账本记 staleSnapshot=true" "$([ "$(ledger_field 2 0 staleSnapshot)" = "true" ] && echo 1 || echo 0)" "实际 $(ledger_field 2 0 staleSnapshot)"

echo ""
echo "===== 场景 6：回写快照后改稿重发 → 默认拒绝（exit 3）====="
# 回写必须是「改那一行」，不能追加一行——追加会变成同一角色重复登记，门禁会以另一条理由先拦下来
cat > 设定/状态快照.md <<'EOF'
# 状态快照（开书前）

## 角色状态
| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |
|------|------|----------|------|------|-----------|
| 林山 | 炼气三层 | 前殿西廊 | 健康 | 断锋剑 | 2 |
EOF
cat > 草稿/第002章.md <<'EOF'
　　前殿的铜钟被风撞了一下，声音在檐角上碎开。林山立在阶下，看着殿门里那块被香火熏黑的长明灯。
　　有人从侧廊过来，脚步很轻，袖口带着药味。他抬眼看了看那人腰间挂的竹牌，竹牌上刻着一个没见过的字。
　　两人对望了一眼，谁也没先开口。殿外的钟声歇了，风也停了，只剩下灯芯爆响的细碎声音。
　　林山把断锋剑往身侧挪了挪，留出了半步的距离，随后跟着那人往西廊去了。
---CHANGES---
<!-- 角色状态变化 -->
- **[林山]**：健康→健康 | 位置：青云山前殿
<!-- 角色移动 -->
- 林山：青云山前殿 → 前殿西廊
<!-- 交接包 -->
- 剧情当前位置：前殿西廊
- 未了结线索：竹牌上那个字
---END CHANGES---
EOF
make_decl 草稿/第002章.md decl2b.json "前殿的铜钟被风撞了一下"
OUT=$($PUB config.json 草稿/第002章.md --ai-gates decl2b.json 2>&1); CODE=$?
check "改稿未加 --revise" 3 $CODE "$OUT"
ok "账本仍 1 笔" "$([ "$(ledger_count 2)" = "1" ] && echo 1 || echo 0)" "实际 $(ledger_count 2) 笔"

echo ""
echo "===== 场景 7：--revise 覆盖（旧指纹留档）====="
OUT=$($PUB config.json 草稿/第002章.md --ai-gates decl2b.json --revise 2>&1); CODE=$?
check "带 --revise 覆盖" 0 $CODE "$OUT"
ok "账本 2 笔" "$([ "$(ledger_count 2)" = "2" ] && echo 1 || echo 0)" "实际 $(ledger_count 2) 笔"
ok "第2笔记 revisedFrom" "$([ "$(ledger_field 2 1 revisedFrom)" != "missing" ] && echo 1 || echo 0)" "缺 revisedFrom"

echo ""
echo "===== 场景 8：门禁阻断（半角标点）→ 正文一个字节都不动 ===="
cat > 草稿/第003章.md <<'EOF'
　　山雨压了下来,林山站在檐下听水声。他把断锋剑横在膝上,用布一寸一寸擦过去。
　　雨线斜着打进来,湿了半边肩头。他往里头挪了半步,继续擦剑。
　　远处有人喊他的名字,声音被雨声压得含糊。他应了一声,起身往里走。
---CHANGES---
<!-- 角色状态变化 -->
- **[林山]**：健康→健康
<!-- 交接包 -->
- 剧情当前位置：前殿西廊
---END CHANGES---
EOF
make_decl 草稿/第003章.md decl3.json "山雨压了下来"
OUT=$($PUB config.json 草稿/第003章.md --ai-gates decl3.json 2>&1); CODE=$?
check "半角标点阻断" 1 $CODE "$OUT"
ok "第3章正文未落盘" "$([ -f 正文/第003章.md ] && echo 0 || echo 1)" "正文/第003章.md 不该存在"
ok "第3章账本未写" "$([ "$(ledger_count 3)" = "0" ] && echo 1 || echo 0)" "实际 $(ledger_count 3) 笔"
ok "报告仍然落盘" "$([ -f 设定/changes/ch003-gate-report.json ] && echo 1 || echo 0)" "缺 ch003-gate-report.json"

echo ""
echo "===== 场景 9：账本审计（含失败章节也未污染账本）====="
OUT=$($STATUS config.json 2>&1); CODE=$?
check "publish-status 复审" 0 $CODE "$OUT"

echo ""
echo "===== 场景 10：断点续跑（next-chapter 报「停在哪、下一章读什么」）====="
OUT=$($NEXT config.json 2>&1); CODE=$?
check "快照欠账时 next-chapter 拦一下" 1 $CODE "$OUT"
ok "报出下一章第3章" "$(printf '%s' "$OUT" | grep -q '下一章：第3章' && echo 1 || echo 0)" "$OUT"
ok "交接包回退到上一章 CHANGES" "$(printf '%s' "$OUT" | grep -q '上一章 CHANGES' && echo 1 || echo 0)" "$OUT"
cat > 设定/状态快照.md <<'EOF'
# 状态快照（截止第2章）

## 下章交接包
- 剧情当前位置：前殿西廊
- 下章该写：与竹牌主人交接

## 角色状态
| 角色 | 等级 | 当前位置 | 状态 | 背包 | 最后出场章 |
|------|------|----------|------|------|-----------|
| 林山 | 炼气三层 | 前殿西廊 | 健康 | 断锋剑 | 2 |
EOF
OUT=$($NEXT config.json 2>&1); CODE=$?
check "回写快照后可继续" 0 $CODE "$OUT"
ok "交接包取自快照" "$(printf '%s' "$OUT" | grep -q '来自 .*状态快照\.md' && echo 1 || echo 0)" "$OUT"
ok "交接包内容原样带出" "$(printf '%s' "$OUT" | grep -q '与竹牌主人交接' && echo 1 || echo 0)" "$OUT"

echo ""
echo "===== 场景 11：--apply-changes（发布后自动回写快照，下一章不再欠账）====="
cat > 草稿/第004章.md <<'EOF2'
　　竹林深处的雾气比山道更重，林山把断锋剑横在膝上，听见风穿过竹节的空响。
　　那声音一截一截地断，像有人在远处数着数。他抬头看天，云压得很低，没有鸟。
　　竹牌还在袖中，棱角硌着腕骨。他把手伸进去，摸到那道刻痕，指腹来回摩了一下。
　　有些话没问出口，就只能先记着。林山站起来，往林子更深处走了几步，又停下。
---CHANGES---
<!-- 角色状态变化 -->
- **[林山]**：健康→健康
<!-- 角色移动 -->
- **[林山]**：前殿西廊→后山竹林
<!-- 交接包 -->
- 剧情当前位置：后山竹林
- 未了结线索：竹牌上的刻字没人认得
---END CHANGES---
EOF2
make_decl 草稿/第004章.md decl4.json "风穿过竹节的空响"
OUT=$($PUB config.json 草稿/第004章.md --ai-gates decl4.json --apply-changes 2>&1); CODE=$?
check "--apply-changes 发布第4章" 0 $CODE "$OUT"
ok "快照已自动回写（不必手抄）" "$(grep -q '| 林山 | 炼气三层 | 后山竹林 | 健康 | 断锋剑 | 4 |' 设定/状态快照.md && echo 1 || echo 0)" "$(tail -5 设定/状态快照.md)"
ok "快照标题跟着章号走" "$(grep -q '# 状态快照（截止第4章）' 设定/状态快照.md && echo 1 || echo 0)" "$(head -1 设定/状态快照.md)"
ok "交接包整段换成本章的" "$(grep -q '竹牌上的刻字没人认得' 设定/状态快照.md && echo 1 || echo 0)" "$(tail -8 设定/状态快照.md)"
ok "账本记 snapshotApplied=true" "$([ "$(ledger_field 4 0 snapshotApplied)" = "true" ] && echo 1 || echo 0)" "实际 $(ledger_field 4 0 snapshotApplied)"
OUT=$($NEXT config.json 2>&1); CODE=$?
check "回写后 next-chapter 直接放行" 0 $CODE "$OUT"
ok "下一章是第5章" "$(printf '%s' "$OUT" | grep -q '下一章：第5章' && echo 1 || echo 0)" "$OUT"
echo ""
echo "===== 场景 12：housekeeping（草稿报告轮转，验收记录与账本不许动）====="
# 闸门只在「发过一稿又拿改稿重跑」时才另存草稿报告；这里先造三份，模拟被拦过的改稿
for s in aa11bb22 cc33dd44 ee55ff66; do echo "{}" > 设定/changes/ch002-gate-report-draft-$s.json; done
draft_count() { ls 设定/changes/ch*-gate-report-draft-*.json 2>/dev/null | wc -l | tr -d ' '; }
ledger_before=$(ls 设定/changes/ch*-publish.json 2>/dev/null | wc -l | tr -d ' ')
OUT=$($HK config.json 2>&1); CODE=$?
check "housekeeping 默认 dry-run" 0 $CODE "$OUT"
ok "dry-run 不删东西" "$([ "$(draft_count)" = "3" ] && echo 1 || echo 0)" "实际 $(draft_count) 份"
OUT=$($HK config.json --write --keep-drafts 1 2>&1); CODE=$?
check "housekeeping --write --keep-drafts 1" 0 $CODE "$OUT"
ok "草稿报告只留最新 1 份" "$([ "$(draft_count)" = "1" ] && echo 1 || echo 0)" "剩 $(ls 设定/changes/ch*-gate-report-draft-*.json 2>/dev/null | tr '\n' ' ')"
ok "发布当时的验收记录还在" "$([ -f 设定/changes/ch001-gate-report.json ] && [ -f 设定/changes/ch004-gate-report.json ] && echo 1 || echo 0)" "$(ls 设定/changes | tr '\n' ' ')"
ok "分章账本一份没少" "$([ "$(ls 设定/changes/ch*-publish.json 2>/dev/null | wc -l | tr -d ' ')" = "$ledger_before" ] && echo 1 || echo 0)" "之前 $ledger_before 之后 $(ls 设定/changes/ch*-publish.json 2>/dev/null | wc -l | tr -d ' ')"
OUT=$($HK config.json --write --keep-drafts 1 2>&1); CODE=$?
check "housekeeping 重跑幂等" 0 $CODE "$OUT"
ok "第二次说无需清理" "$(printf '%s' "$OUT" | grep -q '无需清理' && echo 1 || echo 0)" "$OUT"
OUT=$($STATUS config.json 2>&1); CODE=$?
check "清理后账本审计照样通过" 0 $CODE "$OUT"
echo "===== 结果: PASS=$PASS FAIL=$FAIL ====="
cd / && rm -rf "$WORK"
exit $FAIL
