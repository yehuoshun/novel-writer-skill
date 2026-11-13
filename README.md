# 小说写作辅助 (novel-writer-skill)

一个用于 OpenClaw 的小说写作辅助技能，帮你管理长篇小说的设定、大纲和章节写作。

## 核心能力

- **设定管理**：角色、物品、地点、势力、时间线、伏笔自动追踪，设定冲突检测
- **CHANGES 变更声明协议**：每章写完自动声明变更，AI 自动更新设定，保持一致性
- **12 门禁校验**：6 道写作质量门禁（文本健康 / AI句式 / 心理外化 / 节奏 / 对话 / 结尾）+ 引用校验 + 一致性校验 + 描写一致性 + 未知实体检测 + 蓝图出场合规 + 伏笔闭环校验
- **发布闸门**：门禁不过，正文目录一个字都不写（`scripts/publish-chapter.js`）——候选稿 → 内容指纹审批 → 原子落盘 → 账本留痕，重跑幂等；上一章的状态没回写快照就直接拒绝（`exit 4`），发布之后用 `publish-status.js` 复核账本
- **反 AI 检测指纹**：破折号限额（叙述层≤3）、排比不过三、对话毛边、收尾去总结腔、精确数字不成簇、对仗句不≥2、章尾不宣言、顺滑编排插桩（对话轮转插停顿/动作链插迟钝/群体反应延迟/章尾意象改动作）——实战校准固化（`references/quality/anti-ai-gates.md`）
- **下章交接包**：每章落地生成下一章的「值班交接单」，写新章前只读交接包即可开写，跨章连贯不丢线
- **伏笔状态机**：埋设→推进→回收/废弃四态驱动，防漏收/错收
- **事实快照**：集中管理所有实体的当前状态，解决长篇小说 Big Doc 问题
- **大纲管理**：全书 → 卷 → 章节三层大纲，自动标注关键节点
- **爽点/钩子/情绪追踪**：追踪爽点间隔、钩子类型强度、情绪曲线
- **多本小说**：配置隔离，随时切换
- **存储方式**：本地为主，语雀为可选项（支持本地 / 语雀 / 双写 both，语雀操作手册见 `references/integrations/yuque-integration.md`）
- **本地备份**：`backup.mode=local` 时每章回写后自动生成本地快照（状态快照 + 本章正文 + changes，可回滚）

## 快速开始

```
新建小说 我的第一本书
```

然后按提示回答类型、存储方式、人称、文风等设定。每道题可输入「够了」跳过。

## 命令一览

| 命令 | 用途 |
|------|------|
| `新建小说 [书名]` | 初始化新项目 |
| `切换小说 [书名]` | 切换到另一本书 |
| `写大纲` | 生成全书/卷/章节大纲 |
| `查大纲 [章节号]` | 查看大纲详情 |
| `写章节 [章节号]` | 写指定章节（自动走 CHANGES+门禁） |
| `续写` | 继续写未完成的章节 |
| `回溯 [章节号]` | 查看某章详情 |
| `状态` | 当前进度概览 |
| `查设定 [实体名]` | 查询角色/物品/地点/势力 |
| `查冲突` | 检测全部设定冲突 |
| `更新设定` | 手动更新设定 |
| `补充设定` | 继续初始化时未完成的设定问答 |
| `更新图` | 更新 Mermaid 关系图 |

## 存储结构

### 本地
```
小说名/
├── 正文/ 第1章.md, 第2章.md ...
├── 设定/
│   ├── 角色设定/ 物品设定/ 地点设定/ 势力设定/
│   ├── 时间线/ 伏笔追踪/ 大纲/ 关键对话/ 世界观/
│   ├── 爽点追踪/ 钩子追踪/ 情绪曲线/ 等级体系/ Mermaid关系图/
│   ├── 变更日志/ changes/
│   └── 状态快照.md
```

### 语雀（可选）
正文和设定存同一个知识库，语雀内用 TITLE 节点做分组目录（正文/ + 21 个设定组）。全部语雀操作细节（建库分组/API 速查/上传挂载/changes 归档/audit/sync）见 `references/integrations/yuque-integration.md`；纯本地模式无需语雀。

语雀批量操作用 `node scripts/yuque-doc.js`（`--help` 看用法）：建文档+挂载、挪档、查分组、对账、同步、反向拉取、取文档。调用口径照 `code/yuque-ai-mcp`：30s 超时 + 429/5xx 指数退避重试、错误翻中文、先定分组再建文档（不留孤儿）、挂载后回读 TOC 校验（语雀 TOC 高频写会静默失败）。反向拉取（`pull`）默认只列清单，`--write` 才落盘，覆盖前把本地旧版存进 `设定/.sync-backup/<时间戳>/`；正文不参与反向同步（语雀正文是剥过 CHANGES 的上传版）。

## 配置文件

放在 `configs/[小说名].json`（本地模式示例：`configs/example.json`；语雀模式示例：`configs/example-yuque.json`；双写模式示例：`configs/example-both.json`）。

> ⚠️ 实际配置（`configs/[小说名].json`）不入 git 仓库，skill 重装/更新前注意自行备份。

## 仓库结构

```
novel-writer-skill/
├── SKILL.md              # 主流程（技能入口）
├── README.md             # 本文件
├── configs/              # 配置示例与 schema
├── scripts/              # 校验/工具脚本（零依赖）
├── tools/               # 发版/回归模拟脚本
├── test/                 # 单测（node --test）
└── references/           # 参考手册（按主题分子目录，按需加载）
    ├── README.md         # 加载优先级索引
    ├── core/             # 核心协议与模板
    ├── outline/          # 大纲与剧情设计
    ├── structure/        # 故事结构理论
    ├── hook/             # 钩子与期待感
    ├── opening/          # 开篇与上架物料
    ├── genre/            # 题材框架
    ├── character/        # 角色设计
    ├── style/            # 风格与写法
    ├── quality/          # 质量与去 AI
    ├── notes/            # 作者经验与心态
    └── integrations/     # 语雀集成（可选）
```

## 技术细节

- **CHANGES 协议**：每章末尾的固定格式变更声明，AI 自动解析
- **12 门禁**：6 道写作质量门禁 + 引用/一致性/描写/实体/蓝图出场/伏笔闭环校验
- **事实快照**：集中存储当前态，历史在 changes/ 目录下增量保存

## 发布闸门

门禁结论原来是「AI 自己说通过」，这里把最后一步做成机械闸门：不过就不写正文目录。

```bash
# 1) 出结构化门禁报告（可单独跑，人读或 CI 读）
node scripts/gate-report.js 草稿/第010章.md --config configs/天龙传说.json --out 报告.json

# 2) 通过才落盘（草稿 → 正文目录）
node scripts/publish-chapter.js configs/天龙传说.json 草稿/第010章.md --ai-gates 声明.json
```

| 退出码 | 含义 |
|--------|------|
| 0 | 已发布；或内容没变、属重复发布（幂等 no-op） |
| 1 | 门禁阻断：正文目录一个字不写，报告仍落盘备查 |
| 3 | 目标章节已存在且内容变过，须显式 `--revise` |
| 4 | 上一章发布后 `状态快照.md` 没回写（状态欠账），见下 |
| 2 | 用法错误（参数、配置字段、报告自检不通过） |

四条不变量：

1. **候选稿与正文分离**：草稿路径随便放，正文目录只在闸门通过后写。
2. **审批绑内容指纹**：
AI 侧门禁声明带 `contentFingerprint`（正文 sha256；CHANGES 块与换行风格不参与计算），正文改一个字指纹就变，旧声明自动失效。
3. **幂等 + 留痕**：每章一份账本 `设定/changes/chNNN-publish.json`（时间、指纹、报告路径、结论汇总），同内容重跑不重复记账；报告 `chNNN-gate-report.json` 带 integrity 自校验，手改结论会被 `verifyReport` 抓出来。
4. **状态回写才算完**：发布时把当时的快照指纹记进账本；发下一章若快照一个字没改，闸门拒绝（exit 4）——不拦的话一致性 6 门禁会拿旧事实比对，而且会「全过」。确认无需回写时加 `--allow-stale-snapshot`（账本记 `staleSnapshot: true`）；`--no-gate` 的补救发布不受此拦。

**状态回写可以机械做**：加 `--apply-changes`，闸门在发布成功后直接拿本章 CHANGES 回写 `状态快照.md`（角色状态/移动、伏笔四态、地点与势力、物品归属、冲突进度、时间线、下章交接包），幂等可重跑；回写失败不影响已经落地的发布，但会明确喊一声。也可以单独跑（**默认 dry-run**，只打印将要改哪几行）：

```bash
node scripts/apply-changes.js configs/天龙传说.json 正文/第010章.md            # 先看
node scripts/apply-changes.js configs/天龙传说.json 正文/第010章.md --write    # 再写
```

它只负责快照里的结构化栏目（表格 + 交接包 + 时间线）。**从 v3.5.35 起，伏笔档案也跟着一起改**：快照里 `v1` 变成「已推进」，`伏笔追踪/v1-*.md` 的 `- 状态：` 同一趟改成「已推进」，plant 补 `- 埋设章节：`、progress 接 `- 推进章节：`、harvest 补 `- 揭晓章：`（幂等，重跑不重复插行；档案不存在只提醒、不新建——建档是 `scaffold-entity.js` 的事）。爽点/钩子/情绪/等级等追踪文档仍按流程手工补，那些是自由文本，脚本不猜。

**新角色/新地点第一次上场，档案得先有**：门禁 1 只认 `设定/` 下的档案文件名，伏笔闭环只认 `伏笔追踪/<vID>-*.md`。CHANGES 里声明了却没有档案，这名字下一章一出现就是「未登记实体」。加 `--scaffold`，闸门在门禁之前按 CHANGES 把缺的骨架补上（已有档案一个字节不动）：

```bash
node scripts/scaffold-entity.js configs/天龙传说.json 草稿/第010章.md           # 先看会建哪几份
node scripts/scaffold-entity.js configs/天龙传说.json 草稿/第010章.md --write   # 再建
```

骨架只是把字段摆齐——`身份：待补`、外貌段只留一句提醒——内容还得自己填（外貌颜色写错，下一章反而会被描写一致性门禁打回）。**推进/回收一个从没建过档的伏笔时它不补建，直接报错**：补建会把「前面漏建档」洗成「刚埋设」。

AI 侧门禁声明（Gate 2–6 是语义判断，规则扫描替代不了，必须逐项交代）。骨架用脚本生成，指纹由脚本算，省得手抄：

```bash
node scripts/gate-report.js 草稿/第010章.md --emit-ai-template 声明.json
```

**证据必须有出处**：`pass` / `warn` / `fail` 的 `evidence` 里必须用「」原样引一段 ≥8 字的本稿正文（去空白后能在正文里搜到）。引文找不到就阻断——「整体质量达标，无问题」这类空话过不去，没读稿就给结论这条路被堵死。`skip` 只写不适用的理由（本章无对话之类），不必引文。

```json
{
  "chapter": 10,
  "contentFingerprint": "sha256:...",
  "gates": {
    "gate2_ai_syntax": { "verdict": "pass", "evidence": "「他把剑从鞘里抽出一寸，又推了回去」是动作句，全章没有序数套话与总结腔" },
    "gate3_psych_external": { "verdict": "warn", "evidence": "「他忽然感到一阵没来由的害怕」直接命名了情绪，建议改成手上的动作" },
    "gate4_rhythm": { "verdict": "pass", "evidence": "「数到第七下才停手」一段偏短，与前后长段交错，没有等厚段落" },
    "gate5_dialogue": { "verdict": "skip", "evidence": "本章为纯叙述段落，没有对白，对话密度不适用" },
    "gate6_ending": { "verdict": "pass", "evidence": "「有些事想不明白，就只能先往前走」收在动作上，没有总结腔" }
  }
}
```

缺声明默认阻断（`--allow-missing-ai` 可放行并在报告记 `aiOmitted`）；`--no-gate` 是人工补救通道，报告记 `gatesSkipped`、账本记 `forced: true`。

> `scripts/verify-gate-report.js` 校验的是**文本**报告（写给读者看的那份），`gate-report.js` 产出的是**数据**报告（给机器读），两者互补不替代。给了 `--data <数据报告.json>` 时它还会逐项比对结论口径：文本写 ✅ 而数据报告是 warn/fail 直接打回——文本报告只能抄数据报告，不能重新判一遍。

### 发布之后：账本审计

发布那一刻守住了，之后还会漂：报告被手改、正文被手改、上一章的状态没回写快照。这些没有脚本盯着，账本写了等于没写。

```bash
node scripts/publish-status.js configs/天龙传说.json
```

逐章核对：报告还在不在、能不能过自检、integrity 与账本是否同一份、正文指纹有没有被动过；顺带汇总 forced / revise / staleSnapshot 各几章。最新一章发布后快照还没回写会单独用 `⚠️` 点名（这是「待办」不是「账本坏了」——真正的拦截在下一章发布时 exit 4）。账本与报告对不上 exit 1（详情列在问题行下面）。

还有两项「发布之外」的体检：**伏笔双写**（`伏笔追踪/vID-*.md` 的 `- 状态：` 与快照伏笔表逐条比对，不一致直接 exit 1——双写门禁只在过门禁那一刻查，之后谁手改了档案没人盯）与**正文未入账**（正文目录里有 `第NNN章.md` 但账本没有它的发布记录，说明这章没走闸门，只 `⚠️` 点名，不算账本出错）。

> 报告按章号存档（`设定/changes/chNNN-gate-report.json`），记的是**发布当时**那份。发布之后再跑一次被门禁拦下的改稿，报告另存为 `chNNN-gate-report-draft-<指纹前8位>.json`，不会把已发布的验收记录顶掉。

### 断点续跑：我从哪继续

交接包、状态快照、分章账本一直是三份数据，跨会话接手时得自己 `ls` 正文目录 + 翻快照顶部 + 数账本才能拼出「停在哪」。一条命令问完：

```bash
node scripts/next-chapter.js configs/天龙传说.json        # 加 --json 给脚本/agent 读
```

```
📖 续写位置：天龙传说
   已发布：第2章   2026-11-12T10:02:00Z   账本 1 次
   正文目录：第2章（正文/第002章.md）
   下一章：第3章   草稿写 草稿/第003章.md → 发布目标 正文/第003章.md
   交接包（来自 设定/状态快照.md）：
     - 剧情当前位置：前殿西廊
     - 下章该写：与竹牌主人交接
   开写前先读：设定/状态快照.md、本章涉及角色的设定档案（角色设定/主角/*.md）
   ⛔ 第2章发布后 状态快照.md 未被改动……
      → 按第2章 CHANGES 回写 设定/状态快照.md；确认无需回写时发布可加 --allow-stale-snapshot
```

三件事它替你核对：**到第几章**（账本与正文目录不一致就点名：账本说有、正文没了 = `⛔` 阻塞；正文有、账本没记 = 绕过闸门落盘的提醒）、**下一章几号**（取两者较大值 +1，跳号会单独提）、**该读什么**（快照的 `## 下章交接包` 优先，快照还没回写就回退到上一章 CHANGES 的 `<!-- 交接包 -->` 并说明来源）。有 `⛔` 时 exit 1——多半是上一章的 CHANGES 欠账，先回写再写新章。

顺带把**伏笔账**也算了：快照 `## 伏笔状态` 里每条未了结的伏笔，按类型算它离「该推进」还剩几章（长线埋满 5 章起提醒、10 章算逾期；短线/误导 2 章起、4 章逾期；彩蛋 3 章起、6 章逾期），到期标 🟡、逾期标 🔴，按远近排序打在交接包前面；有逾期项时清单里还会多一条 `foreshadow-overdue` 提醒。这件事本来只有门禁在**写完那一章**之后才说（`伏笔 v1 已埋设 10 章未推进`），等你说的时候这一章已经白写了——所以把它挪到动笔前，让「这一章顺手推一条」成为选项而不是返工。已回收 / 已废弃 / closed / dropped 的不进账。


### 连着发几章：publish-batch

单章发布是 `publish-chapter.js`；一次要发三五章时，**每章都得带 `--apply-changes`（否则下一章 exit 4）和 `--scaffold`（否则新角色第一次上场撞「未登记实体」）**，手敲 N 遍迟早漏一个。`publish-batch.js` 把这两件事写死在每一章里：

```bash
node scripts/publish-batch.js configs/天龙传说.json --chapters 3                          # 先看要发哪几章（默认 dry-run）
node scripts/publish-batch.js configs/天龙传说.json --chapters 3 --ai-gates 声明 --write   # 真发
node scripts/publish-batch.js configs/天龙传说.json --to 12 --ai-gates 声明 --write      # 从断点一路发到第 12 章为止
node scripts/publish-batch.js configs/天龙传说.json --to 12 --ai-gates 声明 --stop-on-warn --write  # 哪章出 warn 就停在哪儿
node scripts/publish-batch.js configs/天龙传说.json --chapters 3 --ai-gates 声明 --write --no-status  # 发完不体检（CI 里已经单独跑过 publish-status 时）
```

- **从账本断点起算**：账本已发到第 7 章，就自动从第 8 章起发 3 章，不用手比章号；重跑同一条命令天然从断点继续。
- **AI 声明要么给目录、要么明说没有**：`--ai-gates 声明/` 里按 `chNNN-ai-gates.json`（也认 `第NNN章-ai-gates.json`）逐章取；既没目录、又没 `--allow-missing-ai` → exit 2，一章都不发（AI 侧结论不能凭空造）。
- **一章被打回就停在该章**：门禁 exit 1、指纹冲突 exit 3、快照欠账 exit 4，任何一章非零立刻停，后面的章节一个字节都不动，子进程的原始报错照贴；改完重跑即从该章继续。
- **发到第 N 章为止（`--to`）**：`--to 12` 是从断点一路发到第 12 章（区间上限写死），适合「先把这一卷发完」；`--chapters` 与 `--to` 只能给一个，都缺就 exit 2。`--to` 指向已经发过的章 → exit 2——重发某一章请用 `publish-chapter.js --revise`，批量脚本只往前走。
- **`--stop-on-warn`**：默认只在被打回时停；加上它，某章出现 warn 也停在该章（exit 0），并在 stderr 里点名是哪几道门禁 warn。warn 不阻断发布，但连发时值得先停下来看一眼。
- **发完自动体检**：真发过章节时，最后跑一遍 `publish-status` 并把结论压成一行（`📋 账本体检：✅` / `❌` 加前 5 条问题）——刚写完的这批报告还在不在、正文有没有被手改、快照回写欠不欠、伏笔档案与快照对不对得上、有没有绕过闸门落进正文的稿子。**体检不通过不改本命令的退出码**（那是 `publish-status` 自己的判定），只用 ❌ 点名，免得「发完了」和「被打回」两种 1 混在一起；不想跑加 `--no-status`，`--json` 里对应 `status` 字段（跳过时为 null）。
- 每章实际执行 `<config> <草稿> --apply-changes --scaffold`，与单章命令等价，账本里照样有 `snapshotApplied` / `scaffolded` / `aiOmitted`。

退出码：0 = 请求的 N 章都发完（`--stop-on-warn` 主动停下也算 0，stderr 写明 `停在第X章`）；1 = 中途停（缺草稿 / 缺声明 / 被打回）；2 = 用法错误或配置读不出来。


### 收尾清理：删掉该删的

写完几十章，`设定/changes/` 里会攒下每次被拦下的改稿报告（`chNNN-gate-report-draft-<指纹前8位>.json`）、原子写中断留下的 `*.tmp`，本地备份也会垒成一摞。**默认 dry-run，只报不删**：

```bash
node scripts/housekeeping.js configs/天龙传说.json                       # 先看
node scripts/housekeeping.js configs/天龙传说.json --write                # 再删
node scripts/housekeeping.js configs/天龙传说.json --write --keep-drafts 1 --keep-backups 5
```

- **草稿报告**：每章只留最新 N 份（默认 3）。`chNNN-gate-report.json`（发布当时的验收记录）和分章账本**永远不在删除范围**——那是 `publish-status` 复核的凭据。
- **临时残留**：`设定/changes/` 与 `正文/` 下的 `*.tmp` / `*.partial` 一律清（原子写中断的中间态）。
- **本地备份**：`backup.local_path` 下 `YYYY-MM-DD_HH-mm-ss-SSS-chNNN` 目录只留最新 N 个（默认 20）。
- **孤儿报告只点名不删**：`chNNN-gate-report.json` 找不到对应账本时打 `⚠️`，提示先跑 `publish-status` 看清楚——那多半是绕过闸门手动放进正文的章节。

退出码 0=清理完或无需清理、1=有删除失败、2=用法或配置错；`--json` 给脚本读。重跑幂等，第二次会说「无需清理」。

## 测试

零依赖，用 Node 内置 test runner：

```bash
node --test        # 或 npm test
```

覆盖全部门禁/工具脚本的输入输出（CHANGES 解析四态、一致性/引用/伏笔/蓝图/描写、冲突检测、配置校验正负例、配置回写、文本健康、AI 味扫描、段首缩进、上传预处理、本地备份快照）+ 发布闸门（内容指纹口径、AI 声明审批、报告 integrity 自校验、幂等重发、修订保护、强制通道留痕）+ 仓库元数据自检（链接、表格、版本、命名、换行、schema 枚举 ↔ 文档词表）+ Release 通知脚本（--print 不联网）+ 收尾清理（草稿报告按章轮转、dry-run 不落盘、备份轮转、孤儿报告只点名、参数负例）+ 建档联动（按 CHANGES 补角色、地点、物品、势力档案与伏笔档案骨架、前缀命名约定、已有档案一个字节不动、推进未建档伏笔只报不建）+ 发布账本体检（伏笔档案×快照表的全书比对、正文有章节但账本没记录只提醒、状态列括号备注剥掉再比）+ 伏笔双写（档案里的 `- 状态：` 与快照伏笔表逐条比对，不一致打回；只登记没档案、有档案没登记只提醒；`apply-changes` 回写快照时把档案状态、埋设/推进/揭晓章一起同步，幂等、不新建档案）+ 批量续跑编排（从账本断点起算、缺声明先拒、缺草稿就停、一章被打回就停在该章且后面不动、`--json` 结构、`--allow-missing-ai` 账本记 aiOmitted）。CI（`.github/workflows/test.yml`）在 push / PR 时自动跑两个作业：ubuntu 跑单测 + 四个集成脚本，windows 只跑单测——集成脚本是 bash，Windows 作业专门盯路径分隔符、控制台编码、CRLF 这些只在真机暴露的问题。

集成回归（5 章全生命周期：埋设→推进→回收、新角色建档、终态回退、重复埋设）：

```bash
bash tools/simulate-lifecycle.sh
```

集成回归（本地备份快照：单章/--full/跳过/空路径/无文件不残留/真实回滚恢复）：

```bash
bash tools/simulate-backup.sh
```

长篇回归（50 章长期积累：伏笔状态机跨 30+ 章、快照不发胖、跨章位置一致性、冲突检测、门禁报告完整性）：

```bash
bash tools/simulate-longform.sh
```

发布链路回归（16 个场景 / 81 条断言：首发布落盘+记账 → 幂等重发不重复记 → 快照欠账 exit 4 → `--allow-stale-snapshot` 放行并留痕 → 改稿默认 exit 3 → `--revise` 覆盖留旧指纹 → 门禁阻断正文一个字节不动 → 账本审计 → 断点续跑 → `--apply-changes` 自动回写快照后下一章直接放行 → 收尾清理只删草稿报告、验收记录与账本一个不动 → 伏笔双写体检打架 exit 1、正文未入账只提醒 → `publish-batch` 连发两章并从断点续跑、第 7 章半角标点被打回就停在第 7 章、第 8 章一个字节不动 → `--to` 一路发到第 N 章、指向已发过的章 exit 2、`--stop-on-warn` 出 warn 停在该章并点名门禁、发完自动出账本体检 → `next-chapter` 在动笔前把伏笔账算出来（长线 v1 已埋 8 章、明说还差 2 章到告警线））：

```bash
bash tools/simulate-publish.sh
```

四个集成脚本都跑在 CI 的 ubuntu 作业上（`.github/workflows/test.yml` 的「集成回归」一步）。脚本本身是 `bash + node`，不再依赖 python；Windows 的 Git-bash 里可以直接跑。

## 发版（半自动）

版本号手动控制语义（patch/minor/major 需人判断），tag / Release / 钉钉通知全自动：

> **版本约定（2026-10-12 拍板）**：**每次改动都 bump**，含纯文档、微修补丁、文案修正——不留「无版本提交」。提交标题一律带 `v<新版本>`（repo-meta 测试会校验标题版本与 package.json 一致，对不上即红）。

```bash
bash tools/bump-version.sh patch   # 一键同步 package.json + SKILL.md frontmatter + 尾部
# 或 minor / major

git add -A && git commit -m "<改动描述> v<新版本>" && git push
```

push 后 CI（`.github/workflows/release.yml`）自动完成：

1. 跑全部测试 + 集成回归（失败则不发版）
2. 检测 `package.json` 版本是否已打 tag——未打则自动创建 GitHub Release（含 changelog + 整仓 zip 资产 `novel-writer-skill-v<版本>.zip`）
3. Release 正文 = 自上个 tag 以来的 commit 变更记录
4. 钉钉通知（`DINGTALK_WEBHOOK` secret，未配置不阻断）

> 版本不变时不发版（日常改动不 bump 就只会触发 test.yml）。
> 首次启用后，当前未打 tag 的版本会在下次 push 时自动补发。

## 许可

MIT
