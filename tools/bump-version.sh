#!/usr/bin/env bash
# 一键同步版本号（package.json + SKILL.md frontmatter + SKILL.md 尾部）。
# 用法:
#   bash tools/bump-version.sh [patch|minor|major]   # 默认 patch
#   bash tools/bump-version.sh --root <dir> patch    # 在指定目录操作（供测试）
#
# 发版流程（半自动）:
#   1. bash tools/bump-version.sh patch
#   2. git add -A && git commit -m "<描述> v<新版本>"
#   3. git push   # CI 测试全绿后自动打 tag + 建 Release + 钉钉通知
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then
  ROOT="$2"
  shift 2
fi
cd "$ROOT"

LEVEL="${1:-patch}"
CUR="$(node -p "require('./package.json').version")"
IFS='.' read -r MAJ MIN PAT <<< "$CUR"

case "$LEVEL" in
  patch) PAT=$((PAT + 1)) ;;
  minor) MIN=$((MIN + 1)); PAT=0 ;;
  major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
  *) echo "用法: bump-version.sh [patch|minor|major]（默认 patch），当前: $LEVEL" >&2; exit 1 ;;
esac
NEW="$MAJ.$MIN.$PAT"

node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p));j.version='$NEW';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
sed -i "s/^version: ${CUR}$/version: ${NEW}/" SKILL.md
sed -i "s/_版本：v${CUR}_/_版本：v${NEW}_/" SKILL.md

echo "版本: $CUR → $NEW"
echo "下一步: git add -A && git commit -m \"<改动描述> v$NEW\" && git push（CI 自动发版）"
