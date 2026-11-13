# examples/ — 把技能接进你的工作流

这里的文件**不是技能运行时的一部分**，是给人抄的模板：复制到自己的仓库里，改掉 TODO 就能用。

## github-actions/book-report.yml — 每推一次正文就跑全书体检

`scripts/book-report.js` 解决的是「单章全绿、读者却弃书」这一类问题：爽点断档、同类型连用、章尾没钩子、情绪贴地、字数滑坡、伏笔逾期。这些只有攒了几章才看得出来，靠人记不住，适合交给 CI。

用法两步：

1. 把 [github-actions/book-report.yml](github-actions/book-report.yml) 复制到**小说正文仓库**的 `.github/workflows/book-report.yml`；
2. 打开改两处 TODO：`TODO_OWNER/novel-writer-skill` 换成技能仓库的 `owner/repo`，`configs/TODO.json` 换成你的配置文件。

之后 push 正文或追踪档就会触发。跑完在 Actions 运行的 Summary 里有一行简报：

```
📖 全书体检 第1–12章｜平均 3120 字｜🔴 2｜⚠️ 3｜热度均值 4800（5 章）
```

完整报告（`设定/全书体检.md`）作为 artifact 下载。**有红线时 job 失败**——这就是你要拦的东西；只想记账不想拦，把 `--brief` 换成 `--fail-on warn` 之外的写法，或者删掉命令里的红色规则（`--json` 输出里 `findings[].level` 分红/黄两级）。

### 几个容易踩的点

| 坑 | 说明 |
|---|---|
| `set -o pipefail` 不能删 | 命令接了 `tee`，管道会吞掉退出码，红线就不再让 job 失败了 |
| 技能仓库是私有的 | 取消 `token:` 那行注释，并在小说仓库配 `secrets.SKILL_REPO_TOKEN`（只需 `contents: read`） |
| `--write` 会改工作区 | 报告写进 `设定/全书体检.md`，CI 里只作为 artifact 上传，不回提交 |
| 没有热度数据 | `设定/章节热度.md` 是人手记的，没有就跳过热度那两条黄规则，其余照算 |

### 想让日报也进仓库？

`--digest` 会往 `设定/体检日报.md` 追加一行。要让 CI 把它提交回去，把上传 artifact 那一步换成：

```yaml
      - name: 提交日报
        run: |
          git config user.name  github-actions
          git config user.email actions@github.com
          git add 设定/体检日报.md 设定/全书体检.md
          git diff --staged --quiet || git commit -m "chore: 全书体检日报 $(date -u +%F)"
          git push
```

需要给 job 加 `permissions: contents: write`。注意正文仓库若同时有别的 bot 提交，可能触发下一轮 workflow —— 上面的 `paths` 只盯 `正文/**` 和追踪档，日报本身不会触发自己。

## 本地跑同样的东西

CI 只是把这条命令搬到云端，本地随时可跑（零依赖，Node 18+ 即可）：

```bash
node ../scripts/book-report.js configs/天龙传说.json --brief
node ../scripts/book-report.js configs/天龙传说.json --write   # 写 设定/全书体检.md
node ../scripts/book-report.js configs/天龙传说.json --digest  # 追加 设定/体检日报.md
```
