#!/usr/bin/env bash
# 发版打包脚本：git archive <tag> → novel-writer-skill-<tag>.zip，并上传为 release asset
# 用法: bash tools/package-release.sh <tag>
# 环境变量: GITHUB_PAT_CLASSIC（不设则只打包不上传）
set -euo pipefail

TAG="${1:?用法: bash tools/package-release.sh <tag>}"
REPO="yehuoshun/novel-writer-skill"
ZIP="/tmp/novel-writer-skill-${TAG}.zip"

cd "$(dirname "$0")/.."

# 1. 校验 tag 存在
if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "❌ tag ${TAG} 不存在（先 git tag + push）" >&2
  exit 1
fi

# 2. 打包（内容 = tag 时刻的提交状态，不含 .git）
git archive --format=zip -o "$ZIP" "$TAG"
echo "✅ 打包完成: $ZIP ($(du -h "$ZIP" | cut -f1))"

# 3. 上传（可选）
if [[ -z "${GITHUB_PAT_CLASSIC:-}" ]]; then
  echo "⚠️ 未设置 GITHUB_PAT_CLASSIC，跳过上传"
  exit 0
fi

RID=$(curl -s -H "Authorization: Bearer $GITHUB_PAT_CLASSIC" \
  "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or '')")
if [[ -z "$RID" ]]; then
  echo "❌ release $TAG 不存在（先创建 release）" >&2
  exit 1
fi

curl -s -X POST -H "Authorization: Bearer $GITHUB_PAT_CLASSIC" \
  -H "Content-Type: application/zip" \
  --data-binary @"$ZIP" \
  "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=novel-writer-skill-$TAG.zip" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('✅ 已上传:',d.get('name'),d.get('size'),'bytes')"
