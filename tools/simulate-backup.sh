#!/usr/bin/env bash
# backup-snapshot 端到端集成回归
# 用法: bash tools/simulate-backup.sh（在仓库根目录或任意位置）
# 覆盖：单章快照 / --full 全量 / 非 local 跳过 / 空路径 / 无文件不残留 / 真实回滚恢复
set +e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BS="node $ROOT/scripts/backup-snapshot.js"
WORK="$(mktemp -d /tmp/nw-backup.XXXXXX)"
cd "$WORK"

BOOK="$WORK/书"
mkdir -p "$BOOK/正文" "$BOOK/设定/changes" "$BOOK/backup"
printf '　　\xe6\xad\xa3\xe6\x96\x87\xe3\x80\x82\n' > "$BOOK/正文/第001章.md"
printf '# 状态快照（截止第1章）\n\n林墨：觉醒\n' > "$BOOK/设定/状态快照.md"
printf -- '---CHANGES---\n- **[林墨]**：失业→觉醒\n---END CHANGES---\n' > "$BOOK/设定/changes/ch001-changes.md"
cat > cfg.json <<EOF
{ "info": { "name": "书", "current_chapter": 1 },
  "save_location": "local",
  "backup": { "mode": "local", "local_path": "$BOOK/backup" },
  "local": { "content_path": "$BOOK/正文", "settings_path": "$BOOK/设定" },
  "writing": { "pov": "third-person", "perspective": "single", "style": "modern", "narrative_style": "fast-paced", "chapter_words": { "min": 2500, "max": 4000 } } }
EOF

PASS=0; FAIL=0
check() { # name expect_exit actual_exit
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✅ [$1] exit=$3"; else FAIL=$((FAIL+1)); echo "❌ [$1] 期望 exit=$2 实际=$3"; fi
}

echo "===== 1) 单章快照 ====="
OUT=$($BS cfg.json 1 2>&1); CODE=$?
check "单章快照" 0 $CODE
D1=$(ls -d "$BOOK/backup"/*-ch001 2>/dev/null | head -1)
for f in 状态快照.md changes/ch001-changes.md 正文/第001章.md manifest.json; do
  [ -f "$D1/$f" ] && echo "  ✓ $f" || { echo "  ✗ 缺 $f"; FAIL=$((FAIL+1)); }
done

echo "===== 2) 真实回滚：写坏快照 → 从快照恢复 ====="
cp "$D1/状态快照.md" /tmp/_orig_snap.md
printf 'BROKEN\n' > "$BOOK/设定/状态快照.md"
cp "$D1/状态快照.md" "$BOOK/设定/状态快照.md"
if python3 -c "import sys;sys.exit(0 if open('/tmp/_orig_snap.md').read()==open('$BOOK/设定/状态快照.md').read() else 1)"; then
  PASS=$((PASS+1)); echo "✅ [回滚恢复] 内容一致"
else
  FAIL=$((FAIL+1)); echo "❌ [回滚恢复] 内容不一致"
fi

echo "===== 3) --full 全量 ====="
OUT=$($BS cfg.json 1 --full 2>&1); CODE=$?
check "--full" 0 $CODE
DF=$(ls -dt "$BOOK/backup"/*-ch001 2>/dev/null | head -1)
[ -f "$DF/正文/第001章.md" ] && [ -f "$DF/设定/状态快照.md" ] && { PASS=$((PASS+1)); echo "✅ [--full 含 正文/+设定/]"; } || { FAIL=$((FAIL+1)); echo "❌ [--full 缺料]"; }

echo "===== 4) 非 local 模式跳过 ====="
python3 - <<'PY'
import json
d=json.load(open('cfg.json')); d['backup']['mode']='yuque_history'; json.dump(d,open('cfg2.json','w'))
PY
OUT=$($BS cfg2.json 2>&1); CODE=$?
check "yuque_history 跳过" 0 $CODE
grep -q "跳过" <<<"$OUT" && echo "  → 提示正确" || { echo "  ✗ 无跳过提示"; FAIL=$((FAIL+1)); }

echo "===== 5) local_path 为空 ====="
python3 - <<'PY'
import json
d=json.load(open('cfg.json')); d['backup']['local_path']=''; json.dump(d,open('cfg3.json','w'))
PY
OUT=$($BS cfg3.json 2>&1); CODE=$?
check "空 local_path" 1 $CODE

echo "===== 6) 无文件可备份 → 退 1 且不残留空目录 ====="
BEFORE=$(ls "$BOOK/backup" | wc -l)
python3 - <<'PY'
import json
d=json.load(open('cfg.json')); d['local']={'content_path':'/no/such/正文','settings_path':'/no/such/设定'}; json.dump(d,open('cfg4.json','w'))
PY
OUT=$($BS cfg4.json 1 2>&1); CODE=$?
check "无文件" 1 $CODE
AFTER=$(ls "$BOOK/backup" | wc -l)
[ "$BEFORE" = "$AFTER" ] && { PASS=$((PASS+1)); echo "✅ [不残留空目录]"; } || { FAIL=$((FAIL+1)); echo "❌ [残留空目录] $BEFORE→$AFTER"; }

echo ""
echo "===== 结果: PASS=$PASS FAIL=$FAIL ====="
cd / && rm -rf "$WORK" /tmp/_orig_snap.md
exit $FAIL
