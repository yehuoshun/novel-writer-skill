#!/usr/bin/env python3
"""Release 钉钉通知（自包含）。

为什么不用 yehuoshun-notify action：tag push 事件无 commits，action 的 push()
处理器会生成「0 提交」空消息；而用默认 GITHUB_TOKEN 创建的 release 不会级联触发
监听 release 事件的别的 workflow（GitHub 防递归）。故在 release 工作流内自包含发送。

用法:
  python3 notify-release.py <body_file>          # 发送
  python3 notify-release.py --print <body_file>  # 仅打印将发送的 markdown（不联网，供测试）

环境: DINGTALK_WEBHOOK, TAG, REPO
"""
import json
import os
import sys
import time
import urllib.request

MAX_BYTES = 19000  # 钉钉 markdown 上限约 20KB


def build_text(tag: str, repo: str, body: str) -> str:
    body = (body or "")[:4000]
    text = (
        "## 🏷️ 新版本发布 / Released\n\n"
        f"**仓库** / *Repo*: {repo}\n"
        f"**版本** / *Version*: `{tag}`\n\n"
        f"{body}\n\n—— **GitHub**"
    )
    b = text.encode("utf-8")
    if len(b) > MAX_BYTES:
        text = b[: MAX_BYTES - 100].decode("utf-8", "ignore").rsplit("\n", 1)[0] + "\n\n⋯ (已截断 / truncated)"
    return text


def main() -> int:
    args = sys.argv[1:]
    dry = False
    if args and args[0] == "--print":
        dry = True
        args = args[1:]
    body_path = args[0] if args else ""
    body = ""
    if body_path and os.path.exists(body_path):
        body = open(body_path, encoding="utf-8").read()

    tag = os.environ.get("TAG", "?")
    repo = os.environ.get("REPO", "?")
    text = build_text(tag, repo, body)
    title = f"Release {tag} · {repo}"

    if dry:
        print(title)
        print(text)
        return 0

    hook = os.environ.get("DINGTALK_WEBHOOK", "")
    if not hook:
        print("[DingTalk] ❌ 未配置 DINGTALK_WEBHOOK", file=sys.stderr)
        return 1

    payload = json.dumps({"msgtype": "markdown", "markdown": {"title": title, "text": text}}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(hook, data=payload, headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=10)
            b = json.loads(resp.read().decode() or "{}")
            if b.get("errcode", 0) == 0:
                print("[DingTalk] ✅ Release 通知已发送")
                return 0
            print(f"[DingTalk] ⚠️ errcode={b.get('errcode')}: {b.get('errmsg')}")
        except Exception as e:  # noqa: BLE001
            print(f"[DingTalk] ⚠️ 尝试 {attempt + 1}/3 失败: {e}")
        if attempt < 2:
            time.sleep(min(2 ** attempt * 2, 60))
    print("[DingTalk] ❌ 发送失败（不阻断 CI）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
