---
name: novel-writer
version: 3.5.49
description: 小说写作辅助技能。支持设定管理、大纲规划、章节写作、CHANGES变更声明协议、12门禁校验（引用/一致性/描写/未知实体/蓝图合规/伏笔闭环）、爽点钩子追踪、情绪曲线、去AI味、事实快照+下章交接包状态管理。当用户提到「写小说」「新建小说」「写章节」「续写」「更新设定」「补充设定」「查设定」「查冲突」「写大纲」「查大纲」「回溯」「状态」「切换小说」「更新图」时触发。
---

# 小说写作辅助

## 概述

帮助用户进行小说创作，管理复杂设定，追踪角色、物品、地点、伏笔、时间线等，确保长期写作的一致性。

**核心功能**：
- 多本小说管理（配置隔离）
- 完整设定追踪（角色、物品、地点、势力、时间线、伏笔）
- 大纲管理（三层：全书→卷→章节）+ 大纲排布方法论
- 章节写作（CHANGES变更声明协议、字数控制、设定自动回写、爽点标注、钩子检查、去AI味）
- 12 门禁校验（写作质量6门禁 + 引用校验 + 一致性校验 + 描写一致性 + 未知实体检测 + 蓝图出场合规 + 伏笔闭环校验）
- 事实快照集中管理（当前态快照 + 下章交接包 + 增量变更日志，解决 Big Doc 问题）
- 伏笔状态机（埋设→推进→回收/废弃，四态驱动，防漏收/错收）
- 冲突检测（跨章位置/时间线/状态/物品）
- Mermaid关系图自动生成
- 题材框架 / 风格模块 / 质量检查按需加载

> 已融合精华到 `references/` 目录下。写作流程/题材结构/角色情绪/质量润色等参考文件按需加载。
> 参考文件在 [references/](references/) 目录下，按需加载。

## 配置

配置文件路径：`~/.openclaw/workspace/skills/novel-writer-skill/configs/[小说名].json`（完整示例见 `configs/example.json` 本地模式 / `configs/example-yuque.json` 语雀模式 / `configs/example-both.json` 双写模式；**语雀是可选项，全部语雀操作细节见 [references/integrations/yuque-integration.md](references/integrations/yuque-integration.md)**）

> ⚠️ 实际配置不入 git 仓库，skill 重装/更新前注意备份 `configs/[小说名].json`

```json
{
  "info": {
    "name": "小说名",
    "type": "类型",
    "status": "ongoing/completed/paused",
    "created_at": "2026-04-16",
    "current_chapter": 10,
    "written_chapters": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "total_words": 38000,
    "current_volume": 1,
    "last_sweet_spot": { "chapter": 10, "type": "装逼打脸" },
    "consecutive_no_spot": 0,
    "consecutive_same_type": 0,
    "last_hook_start": { "chapter": 10, "type": "悬念钩", "strength": "强" },
    "last_hook_end": { "chapter": 10, "type": "悬念钩", "strength": "强" },
    "consecutive_weak_hooks": 0,
    "last_emotion_peak": { "chapter": 10, "emotion": "震撼", "intensity": 9 },
    "consecutive_flat_emotion": 0
  },

  "save_location": "local",

  "backup": {
    "mode": "local",
    "local_path": "./小说名/backup"
  },

  "local": {
    "content_path": "./小说名/正文",
    "settings_path": "./小说名/设定"
  },

  "writing": {
    "pov": "first-person/third-person",
    "perspective": "single/multi",
    "style": "classical/modern/humorous/serious",
    "narrative_style": "fast-paced/slow-burn/detailed",
    "dialogue_style": "quoted/unquoted",
    "chapter_words": {
      "min": 2500,
      "max": 4000
    }
  }
}
```

**配置说明**：
- `save_location`：保存位置（yuque / local / both）
  - `local`（**主线**）：正文+设定都存本地（两个目录）
  - `yuque` / `both`（**可选**）：语雀/双写模式，配置字段与全部操作细节见 [references/integrations/yuque-integration.md](references/integrations/yuque-integration.md)
- `backup.mode`：备份模式
  - `local`：每次写章节回写后由 `scripts/backup-snapshot.js` 生成本地快照（状态快照 + 本章正文 + chXXX-changes → `local_path/<时间戳>-chXXX/`）；加 `--full` 可全量备份 正文/ + 设定/ 两棵树
  - `yuque_history`（默认）：依赖语雀历史版本功能，不另做本地备份（仅语雀/both 模式使用；纯本地用户建议改 `local`）
- `backup.local_path`：本地备份路径（仅当 backup.mode=local 时需要）
- `info.written_chapters`：已写章节编号列表，用于追踪写作进度
- `yuque.book` / `yuque.groups`：语雀配置块（仅 yuque/both 需要，字段说明与 22 key 分组映射见 [references/integrations/yuque-integration.md](references/integrations/yuque-integration.md) 第 2/4 节）
- `local.content_path` / `local.settings_path`：本地正文/设定保存路径（仅 save_location=local/both 时需要）
- 本地路径统一格式：`./小说名/正文` / `./小说名/设定`（相对路径以运行时的当前工作目录为基准；**⚠️ 一律写绝对路径**——`backup-snapshot.js` 等脚本按运行 cwd 解析相对路径，若在小说目录内运行（最自然的操作），`./小说名/正文` 会被解析成 `小说名/小说名/正文` 双重嵌套导致备份失败；2026-10-10 实弹暴露）
- 配置里 `yuque` 和 `local` 两个块只需填当前 save_location 对应的块；both 时两个块都必填
- `writing`：文风设定，初始化时通过问答确定
- `writing.dialogue_style`（可选，建议填）：对白体例——`quoted`=引号体（“ ”／「」）；`unquoted`=「说，…」无引号体。**写章节前必对照本书近 1-2 章正文确认**，照本书体例写（2026-10-12 第22章实弹：本书为无引号体，误用引号体导致全章改写）

**命名约定**：
- 设定文档名称：中文命名（如「张三.md」「天龙城.md」）
- JSON 配置 key：英文命名（如 `characters_protagonist`）
- 文件命名冲突处理：加入地点前缀（如「龙城_张三.md」）

## 命令列表

每个命令这里只留一句话；**完整流程、参数、产物与判据在 [`references/core/commands/`](references/core/commands/) 下，动手执行前按需加载**。

| 场景 | 用法 | 一句话 | 详解 |
|---|---|---|---|
| 建书 | `新建小说 [小说名]` | 8 问定配置 → 建目录 → 大纲先行 → 书名查重 → 生成简介 | [init.md](references/core/commands/init.md) |
| 换书 | `切换小说 [小说名／配置文件]` | 校验配置、清上本书上下文、加载新书 | 同上 |
| 看进度 | `状态` | 章/卷进度、总字数、未了结伏笔、待处理冲突、最近爽点与钩子 | 同上 |
| 定大纲 | `写大纲` | 全书 → 卷 → 章节细纲（含蓝图出场清单）；不完成不进写章节流程 | [outline.md](references/core/commands/outline.md) |
| 看大纲 | `查大纲 [卷／章]` | 查已有大纲与细纲 | 同上 |
| 写正文 | `写章节 [章号／标题]` | 门禁全流程：读设定 → 写 → 自检 → 发布 → 回写 7 个追踪档 | [writing.md](references/core/commands/writing.md) |
| 接着写 | `续写` | 接上次中断处继续写当前章 | 同上 |
| 看旧章 | `回溯 [章号]` | 某章摘要、出场角色、爽点与钩子、可回改点 | 同上 |
| 改设定 | `更新设定` | 设定变动同步档案与追踪表 | [settings.md](references/core/commands/settings.md) |
| 补设定 | `补充设定` | 补初始化时跳过的设定问答 | 同上 |
| 查设定 | `查设定 [名字]` | 按角色／物品／地点／伏笔查档案 | 同上 |
| 查冲突 | `查冲突` | 角色位置、时间线等设定冲突检测 | 同上 |
| 画关系 | `更新图 [类型]` | 重画 Mermaid 关系图 | [other.md](references/core/commands/other.md) |

## 设定文档结构

### 语雀知识库（单库模式）

> 语雀为**可选**存储：TITLE/DOC 结构树、22 key groups 映射表、API 调用速查（MCP/裸 API 全踩坑记录：appendNode/sibling 静默 no-op/parent_uuid 不生效/confirm 必填等）全部见 [references/integrations/yuque-integration.md](references/integrations/yuque-integration.md) 第 4-5 节。

### 本地设定文件夹

```
小说名/设定/
├── 角色设定/
│   ├── 主角/
│   ├── 反派/
│   ├── 配角/
│   └── 已故/
├── 物品设定/
├── 地点设定/
├── 势力设定/
├── 等级体系/
├── 时间线/
├── 伏笔追踪/
├── 爽点追踪/
├── 钩子追踪/
├── 情绪曲线/
├── 大纲/
│   └── 细纲/
├── 关键对话/
├── 世界观/
├── Mermaid关系图/
│   └── 地理方位.md
├── 变更日志/
├── 状态快照.md
└── changes/（**可选**：旧布局兼容，backup-snapshot 优先读、无则从正文提取）
    ├── ch001-changes.md
    ├── ch002-changes.md
    └── ...
```

---

**伏笔追踪命名**：每条伏笔一个文档，命名 `vX-伏笔名.md`（如 `v1-假死真相.md`），与快照伏笔状态表的伏笔ID 一一对应；CHANGES 伏笔动作引用的 ID 必须能在该目录/分组中找到对应文档。**🔨埋设即建档**：伏笔在快照登记的同时必须创建对应文档，不得只改快照。

状态快照格式、更新规则等详见 [references/core/state-snapshot.md](references/core/state-snapshot.md)。

---

## 质量检查

写完一定章节后，加载 [references/quality/quality-checklist.md](references/quality/quality-checklist.md) 做检查。

**黄金三章专项**：写完前三章后自动跑评估（⚠️ 开篇趋势已前置：见 [references/opening/opening-design.md](references/opening/opening-design.md)「黄金一章」——钩子要提前到第一章、乃至前 500 字；「三章」是「定调 + 爽点密度」的底线窗口，「五章」是完整开篇公式见 [references/outline/outline-arrangement-2.md](references/outline/outline-arrangement-2.md)）：

| 维度 | 评分标准 |
|------|----------|
| 开篇钩子 | ★★★★★ |
| 主角塑造 | ★★★★★ |
| 爽点设计 | ★★★★★ |
| 世界观铺设 | ★★★★★ |
| 章尾悬念 | ★★★★★ |

参考 [references/opening/opening-design.md](references/opening/opening-design.md) 和 [references/opening/genre-opening-database.md](references/opening/genre-opening-database.md) 对比开篇质量。

**精修删减原则**：

改稿时逐句检查，凡符合以下条件者直接删或缩：

1. 不推动剧情的对话 → 删
2. 不铺垫反转的描写 → 删
3. 不推高情绪的心理活动 → 删
4. 读者能猜到的内容 → 缩短
5. 重复表达的情绪 → 合并

---

角色/物品/地点/势力/时间线/伏笔/爽点/钩子/情绪曲线/章节摘要/等级体系/对话记录/变更日志/大纲等所有设定文档模板详见 [references/core/setup-templates.md](references/core/setup-templates.md)。

---

## 工作流程

### 初始化流程

```
用户：新建小说「天龙传说」
↓
我：小说类型是？（玄幻/都市/科幻...）（可随时输入"够了"跳过剩余问题）
用户：玄幻修仙
↓
我：保存到哪？（A 语雀 / B 本地 / C 语雀+本地）
用户：B 本地
↓
我：正文保存路径？设定保存路径？
用户：默认就行
↓
我：人称？（第一人称/第三人称）
用户：第三人称
↓
我：视角？（单主角/多主角/群像）
用户：多主角
↓
我：文风？（古风/现代/幽默/严肃）
用户：古风
↓
我：叙事节奏？（快节奏/慢热/细腻）
用户：慢热
↓
我：每章字数范围？（默认2500-4000）
用户：默认就行
↓
我：修仙等级体系是什么？（如炼气→筑基→金丹）
用户：炼气期、筑基期、金丹期、元婴期、化神期
↓
[继续问玄幻相关设定，用户可随时「够了」停止]
↓
我：生成配置文件
[展示配置]
↓
我：确认配置？
用户：确认
↓
我：创建设定文档模板
↓
我：[根据存储方式创建目录]
- 本地：创建完整目录树（角色设定/物品设定/...全部目录结构见下方「本地设定文件夹」）
- 语雀/both：另见语雀手册第 3 节
↓
开始写全书大纲
```

### 写章节流程

```
用户：写章节 10
↓
我：加载事实快照 + 本章细纲（含蓝图出场清单）
↓
我：生成章节大纲（标注：核心事件、爽点类型、出场角色、钩子类型）
[展示大纲]
↓
我：确认大纲？（可修改）
用户：确认
↓
我：写正文 + CHANGES 变更声明
[实时字数提醒：3500字/4000字]
↓
我：🛡️ 12 门禁自动执行 → 跑脚本，贴它的原始输出（不手写结论）
  node scripts/gate-report.js 草稿/第010章.md --config configs/天龙传说.json --ai-gates 声明.json --out 设定/changes/ch010-gate-report.json
  [以下是命令真实输出，原样贴：]
  ✅ Gate 1 文本健康 [rule] pass
  ⚠️ Gate 2 AI 语法 [ai] warn（1 条）：…
  ✅ Gate 3 心理外化 [ai] pass
  …（逐项，不合并、不改写）
  门禁结果：12 项｜pass 9｜warn 3｜fail 0｜不阻断
↓
我：正文落盘（过发布闸门 publish-chapter：门禁不过不写；完整版含 CHANGES 块；账本记 chNNN-publish.json）
↓
我：状态回写完成。冲突检测：无冲突。
  更新摘要：
  - 角色A 位置：X城→Y城
  - 角色A 状态：健康→轻伤（第10章，被B打伤）
  - 物品「神秘钥匙」：无主→角色A
  - 时间线：第X天→第X+3天
  - 伏笔 v1「神秘人线索」：🔨埋设（长线）| 预期读者效果：揭晓时确认黑衣人身份
  - 状态快照已更新（含下章交接包）| 伏笔状态表已更新 | Mermaid图已更新
```

> **门禁结论只能来自命令输出。** 上面那段逐项结论必须是 `gate-report.js` 的原始输出（至少贴逐项行 + 汇总行），不许手写、不许改写措辞、不许把 warn 写成 pass、不许把 6 项合成一句「Gate 1-6 通过」。理由很实际：读者看不出手写清单和真跑过的区别，`publish-chapter` 落盘后会重算一遍，账本和报告里存的是真结论——两者对不上时，以报告为准，手写的那份就是错的。

### 更新设定流程

```
用户：改设定：角色A其实在B城，不是X城
↓
我：这将影响：
- 第5章：角色A在X城与C相遇
- 第8章：角色A从X城出发
确认修改？
↓
用户：确认
↓
我：设定已更新，受影响章节已标记
```

### 角色首次登场流程

```
[写章节时检测到新角色]
↓
我：检测到新角色「配角D」，请提供信息：
- 性别？
- 年龄？
- 阵营？（主角/反派/中立）
- 核心动机？（生存/复仇/守护/变强/自由/证明自己）
- 外貌描述？（可选）
- 性格特点？（可选）
用户：男，25岁，中立，守护家族，身材魁梧，沉默寡言
↓
我：已创建角色「配角D」，分组：配角组
```

### 新地点首次登场流程

```
[写章节时检测到新地点]
↓
我：检测到新地点「XX」，需登记：
- 类型？（宗门/城镇/山川/遗迹/场所）
- 地理位置？（位于<参照地>的<八方位>，约<距离/路程>）★必填
- 外观描述？（可选）
- 所属势力？（可选）
↓
我：已创建地点「XX」（地点设定分组），并同步更新「地理方位」表
```

> ⚠️ **地理位置必填（2026-10-12 补）**：新地点档案必须写「地理位置：位于<参照地>的<八方位>，约<距离>」，并同步「地理方位」表（Mermaid关系图分组下）。**方位一旦写下即锁定**，后续不得随意改向（A 在 B 东 → 后写成南 = 打回）。写章涉及多地相对位置时必对照该表。

---

## 特殊功能

### 爽点追踪

每章写完后自动追踪爽点密度和类型分布。

**爽点类型速查**：

| 类型 | 定义 | 示例 |
|------|------|------|
| 装逼打脸 | 实力碾压被轻视的人 | 废材一招秒天才 |
| 逆袭反转 | 绝境翻盘 | 绝境中突破 |
| 获得机缘 | 得到别人没有的东西 | 捡到神器/奇遇 |
| 信息差碾压 | 读者和主角知道、别人不知道 | 重生者先知优势 |
| 情感满足 | 人物关系进展 | 告白/团聚/认可 |
| 扮猪吃虎 | 隐藏实力突然展露 | 装弱实则强者 |

**追踪规则**：
- 每 3000-5000 字必须有一个爽点
- 连续 2 章无爽点 → 自动提醒
- 同一类型爽点连用 3 次 → 提醒换类型

**爽点间隔追踪示例**：
```
第1章：装逼打脸（铺放比3:1）
第2章：无爽点 ← ⚠️ 连续无爽点
第3章：获得机缘（铺放比1.5:1）
...
```

### 钩子追踪

每章写完后自动检查钩子质量。

**钩子类型速查**：

| 章首钩子 | 定义 | 示例 |
|----------|------|------|
| 悬念钩 | 抛出未解之谜 | 「这把剑为什么会认他为主？」 |
| 冲突钩 | 直接展示对抗 | 开篇就是追杀 |
| 反差钩 | 违反常识的信息 | 「穿越第一天就破产了」 |
| 代入钩 | 让读者产生共鸣 | 和读者处境相似的困境 |
| 信息差钩 | 给读者角色不知道的信息 | 「他还不知道，站在他面前的是…」 |

| 章尾钩子 | 定义 |
|----------|------|
| 悬念钩 | 抛出谜题等下一章解答 |
| 反转钩 | 章尾突然反转 |
| 新信息钩 | 揭示新信息打破认知 |
| 新角色钩 | 引人注目的人物登场 |
| 危机钩 | 章尾陷入危险 |
| 决策钩 | 角色面临重大选择 |

> 记录 `last_hook_start/last_hook_end.type` 时**统一使用上表 11 项词汇**（章首 5 + 章尾 6；悬念钩章首/章尾共用，去重后 10 个唯一类）；具体技法（章尾 13 式 / 章首 7 式）与追踪类的映射见 [references/hook/hook-techniques.md](references/hook/hook-techniques.md) 顶部「钩子式 ↔ 追踪类映射」。

**自动检查**：
- 章首无钩子（前 500 字内）→ 提醒
- 章尾无钩子 → 提醒「读者不会翻下一页」
- 连续 3 章钩子强度评为「弱」→ 提醒

### 群像角色分工

多主角/群像作品时，加载 [references/character/character-design.md](references/character/character-design.md) 检查角色分工。

**检查维度**：

| 角色 | 功能定位 | 爽点来源 | 避免重叠 |
|------|----------|----------|----------|
| A | 武力担当 | 装逼打脸 | — |
| B | 智力担当 | 信息差碾压 | 与A差异化 |
| C | 情感担当 | 情感满足 | 主线感情线 |

**自动检查**：
- 两个角色爽点来源相同 → 提醒「角色X和角色Y爽点重叠，建议差异化功能定位」
- 群像作品角色≥4时自动触发检查

### 情绪追踪

每章写完后更新情绪数据，加载 [references/outline/emotional-arc-design.md](references/outline/emotional-arc-design.md) 和 [references/outline/reversal-toolkit.md](references/outline/reversal-toolkit.md)。

**单章情绪**：章节摘要的情绪基调改为强度链格式，如 `紧张(7) → 释放(3) → 悬疑(8)`。

**跨章节情绪曲线**：每章自动录入情绪曲线文档，三种警报：
- 连续 3 章情绪极值 ≤ 5 → 提醒「情绪太平，读者会睡着」
- 反转情绪差（前后强度差）≤ 2 → 提醒「反转力度不足」
- 情绪极值密度过高（连续 5 章都≥8）→ 提醒「读者情绪疲劳，需要缓口气」

**反转检查**：章节有反转时跑四步检查：
1. 铺垫线索够不够（至少 3 个？）
2. 误导方向有没有（读者能被骗到吗？）
3. 反转后回看合不合理（不能为了反转而反转）
4. 情绪冲击够不够（前后的情绪强度差）

### 冲突检测

自动检测以下冲突：

1. **位置冲突**
   - 角色同一时间在不同地点
   - 提示：「角色A第10章在X城，第12章在Y城，缺少移动过程」

2. **时间线冲突**
   - 时间跳跃不合理
   - 提示：「第10章是第5天，第12章是第3天，时间倒流」

3. **角色状态冲突**
   - 已死角色出现
   - 提示：「角色B第10章已死亡，第15章又出现」

4. **物品冲突**
   - 物品归属不一致
   - 提示：「物品「剑」第10章被B获得，第12章还在A背包里」

### 发布闸门

12 门禁的结论不能停留在「我说通过了」——落盘前必须过机械闸门：

```
我：🛡️ 门禁自检 → 生成数据报告 + AI 侧声明
  node scripts/gate-report.js 草稿/第010章.md --emit-ai-template 声明.json          # 先拿骨架（带本稿指纹）
  [填 5 项：verdict + 一段「」引用的正文原文]
  node scripts/gate-report.js 草稿/第010章.md --config configs/天龙传说.json --ai-gates 声明.json --out ...gate-report.json
↓
我：通过才发布（不过就一个字都不写正文目录）
  node scripts/publish-chapter.js configs/天龙传说.json 草稿/第010章.md --ai-gates 声明.json
↓
我：落盘 + 账本留痕（设定/changes/ch010-publish.json）
↓
我：按本章 CHANGES 回写 状态快照.md（发布时加 --apply-changes 就自动做；没加就手抄或单独跑 apply-changes.js。不回写，下一章会被闸门拦在 exit 4）
```

- **退出码**：0 发布成功或重复发布（幂等 no-op）；1 门禁阻断（正文不写，报告仍落盘备查）；3 目标章节已存在且内容变过，须 `--revise`；4 上一章的状态变化没回写快照（正文不写，见下条）；2 用法错误。
- **内容指纹**：`contentFingerprint` = 正文（`---CHANGES---` 之前）的 sha256，CHANGES 块与换行风格不参与。AI 侧声明必须带本稿指纹，正文改一个字旧声明即失效。
- **AI 侧声明**：Gate 2–6 是语义判断，规则扫描替代不了，必须逐项给 `verdict` + ≥6 字 `evidence`；且 `evidence` 要用「」**原样引一段 ≥8 字的本稿正文**（引文在正文里搜不到就阻断——空话过不去）；`skip` 只写不适用的理由（本章无对话这类）。骨架用 `--emit-ai-template` 生成，指纹别手抄。缺声明默认阻断，`--allow-missing-ai` 放行并记 `aiOmitted`。
- **先自检再发布**：`node scripts/gate-report.js 草稿.md --config cfg.json --ai-gates 声明.json` 看到「✅ 门禁不阻断」再去 publish，别拿 publish 当试错工具（阻断虽不落盘，但会留一份失败报告；该章已发布过时，失败报告另存 `chNNN-gate-report-draft-<指纹前8位>.json`，不覆盖发布当时的验收记录）。
- **状态欠账**：发布时账本记下当时的快照指纹；发下一章时若 `状态快照.md` 一个字没改，说明上一章的 CHANGES 没回写——一致性 6 门禁会拿旧事实比对且「全过」，所以闸门 exit 4 拦下。回写完再发（可 `node scripts/apply-changes.js <config> <本章.md> --write`，或发布时 `--apply-changes` 让闸门自己回写）；确认无需回写用 `--allow-stale-snapshot`（账本记 `staleSnapshot: true`）。`--no-gate` 的补救发布不受此拦。
- **发布后复核**：`node scripts/publish-status.js configs/天龙传说.json` 逐章核对账本——报告还在不在、integrity 与账本是否同一份、正文指纹有没有被动过、最新一章的快照回没回写。最新一章快照还没回写只算 `⚠️` 待办（拦截留给下一章的 exit 4），账本与报告真的对不上才 exit 1。账本存着发布时的字数与段数（`metrics`），所以「正文发布后被改动」会连「发布时 N 字，现在 M 字（±X%）」一起报——字数掉了两位数，八成不是精修。发布之外的漂移只有这个脚本抓得到，交付/续写前跑一次。v3.5.36 起还查两样：**伏笔双写**（`伏笔追踪/vID-*.md` 的 `- 状态：` vs 快照伏笔表，打架 exit 1）与**正文未入账**（正文目录有 `第NNN章.md`、账本没记录，只 `⚠️`）。
- **收尾清理（v3.5.33）**：`node scripts/housekeeping.js <config.json>` 默认 dry-run 只报不删，`--write` 才动手——草稿报告 `chNNN-gate-report-draft-*.json` 每章只留最新 3 份（`--keep-drafts N`）、`*.tmp`/`*.partial` 一律清、本地备份目录只留最新 20 个（`--keep-backups N`）。发布当时的验收记录 `chNNN-gate-report.json` 与分章账本**永不在删除范围**；找不到账本的孤儿报告只打 `⚠️`，让你先跑 publish-status 看清楚。`设定/changes/` 攒乱、备份垒成摞时跑一次。
- **连着发几章（v3.5.37）**：`node scripts/publish-batch.js <config.json> --chapters N [--ai-gates 声明目录] --write` 从账本断点起连发 N 章，每章自动带 `--apply-changes --scaffold`——连发最常见的翻车就是漏这两样（下一章 exit 4、新角色撞未登记实体）。默认 dry-run 只列计划；AI 声明按 `chNNN-ai-gates.json` 从目录逐章取，既没目录又没 `--allow-missing-ai` 就一章都不发（声明不能凭空造）。任何一章被打回（exit 1/3/4）立刻停在该章、后面的一个字节不动，改完重跑即从该章续。要「发到第 N 章为止」用 `--to N`（与 `--chapters` 二选一；指向已发过的章直接 exit 2，重发单章用 `publish-chapter.js --revise`）；加 `--stop-on-warn` 则某章出现 warn 也停在该章（exit 0，并点名哪几道门禁）。

- **发完自动体检**：`publish-batch --write` 收尾会跑一遍 `publish-status`，用一行 `📋 账本体检：✅/❌` 告诉你刚发的这批账本还站不站得住（体检结论不改退出码；`--no-status` 关掉）。- **强制通道**：`--no-gate` 全 skip 落盘，报告记 `gatesSkipped`、账本记 `forced: true`，仅用于人工补救。
- **自检**：报告落盘前会过 `verifyReport`（12 项齐全、枚举合法、summary 自洽、integrity 可重算），不过即 exit 2——宁可不发布，也不发布一份假报告。
- `scripts/verify-gate-report.js` 校验的是**文本**报告，与本脚本产出的**数据**报告互补不替代。

### 伏笔提醒

每次写章节后，提醒未揭晓的伏笔：
```
你：写章节 20
我：[写完章节后]
当前有待揭晓伏笔：
- v1-神秘人身份（长线，第5章埋设，预期第30章回收）
- v2-古老咒语（短线，第8章埋设）
- v3-隐藏彩蛋（彩蛋，第15章埋设，可选回收）
```

### 角色等级提醒

角色等级变化后：
```
我：角色A等级变化：筑基期→金丹期（第20章突破）
```

### 完本总结

小说完结时按 [complete-summary-template.md](references/core/complete-summary-template.md) 交总结：基本信息 / 角色 / 伏笔 / 时间线 / 势力 / 地点 / 物品 / 爽点 / 钩子 / 情绪十节。**数字从脚本取，别手估**：爽点与钩子统计跑 `node scripts/book-report.js <config.json> --json`，伏笔与角色跑 `状态快照.md`，章数与总字数以发布账本为准。

---

## 特殊标注

设定文档 / 摘要中使用的标注符号（**不写入正文**，见下方「禁止」第 3 条）：

```
技能：【火球术】
地名：「天龙城」
物品：『神器剑』
伏笔标记：※神秘人线索※
```

---

## 注意事项

### 必须

1. **每次写章节前校验配置**：检查配置文件存在性、格式正确性
2. **写章节前按需加载设定**：只加载相关角色/地点，不全量加载
3. **写完后更新设定**：必须询问确认
4. **更新追踪数据**：写完章节后更新 `written_chapters` 和所有追踪字段（爽点/钩子/情绪）
5. **写完跑冲突检测**：设定更新后自动跑冲突检测，有冲突报错让用户决定
6. **去AI味自动执行**：写完后自动过 6 Gate 门禁，输出摘要不询问
7. **设定变更通知**：用户手动改设定（语雀/本地文件）后，必须通知我「设定已更新」
8. **切换小说时清缓存**：避免上一本小说的设定污染新会话

### 禁止

1. **禁止默默更新设定**：必须询问确认
2. **禁止无声配置**：配置变更时提示用户
3. **禁止在正文里加设定标签**：特殊标注（【】「」『』※）不会出现在正文
4. **禁止忽略冲突**：检测到冲突必须提示
5. **禁止全量加载设定**：长篇小说设定庞大，必须按需加载

### 询问节点

1. 创建知识库前
2. 创建设定文档前
3. 写章节前（大纲确认）
4. 写章节后（设定变更确认）
5. 新角色出现时
6. 检测到冲突时
7. 设定变更影响较大时

---

## 最佳实践

1. **初始化时耐心回答**：设定越完整，后期一致性越好
2. **定期检查设定**：每写完一定章节主动查设定完整性
3. **关注追踪数据**：定期查看爽点/钩子/情绪追踪，发现警报及时调整
4. **及时记录伏笔**：埋下伏笔时立即记录
5. **冲突早处理**：发现冲突立即处理，不要积累
6. **保持配置简洁**：配置文件只放核心配置，详细设定放设定文档

---

## 参考资料

以下文件在 `references/` 目录下，**按主题分子目录**存放；按需加载（不全量加载避免 Token 爆炸）。
**加载优先级速查** → 见 [references/README.md](references/README.md)。

| 子目录 | 主题 |
|--------|------|
| [references/core/](references/core/) | 核心协议与模板 |
| [references/outline/](references/outline/) | 大纲与剧情设计 |
| [references/structure/](references/structure/) | 故事结构理论 |
| [references/hook/](references/hook/) | 钩子与期待感 |
| [references/opening/](references/opening/) | 开篇与上架物料 |
| [references/genre/](references/genre/) | 题材框架 |
| [references/character/](references/character/) | 角色设计 |
| [references/style/](references/style/) | 风格与写法 |
| [references/quality/](references/quality/) | 质量与去 AI |
| [references/notes/](references/notes/) | 作者经验与心态 |
| [references/integrations/](references/integrations/) | 语雀集成（可选） |

### core/ — 核心协议与模板

| 文件 | 何时加载 |
|------|----------|
| [references/core/changes-protocol.md](references/core/changes-protocol.md) | CHANGES 格式、写作技巧速查、字数节奏、开头结尾类型（写/续写章节时） |
| [references/core/state-snapshot.md](references/core/state-snapshot.md) | 状态快照格式与更新规则（写章节回写 / 续写读交接包时） |
| [references/core/setup-templates.md](references/core/setup-templates.md) | 所有设定文档模板（新建小说 / 补建设定时） |
| [references/core/new-novel-flow.md](references/core/new-novel-flow.md) | 新建小说的 14 步问答与配置细节（首次建书时） |
| [references/core/complete-summary-template.md](references/core/complete-summary-template.md) | 完本总结模板与各节统计口径（完本时） |

### core/commands/ — 命令详解

| 文件 | 何时加载 |
|------|----------|
| [references/core/commands/init.md](references/core/commands/init.md) | 新建小说 / 切换小说 / 状态：8 问顺序、配置确认、目录创建、书名查重 |
| [references/core/commands/outline.md](references/core/commands/outline.md) | 写大纲 / 查大纲：三步大纲、蓝图出场清单、细纲表列 |
| [references/core/commands/writing.md](references/core/commands/writing.md) | 写章节 / 续写 / 回溯：动笔前的读取清单、自检五项、发布顺序、回写 7 个追踪档 |
| [references/core/commands/settings.md](references/core/commands/settings.md) | 更新设定 / 补充设定 / 查设定 / 查冲突：改哪几份档案、冲突怎么判 |
| [references/core/commands/other.md](references/core/commands/other.md) | 更新图：Mermaid 关系图类型与生成规则 |

### outline/ — 大纲与剧情设计

| 文件 | 何时加载 |
|------|----------|
| [references/outline/outline-arrangement.md](references/outline/outline-arrangement.md) | 大纲排布：五步大纲法+故事结构分级+剧情质量控制+升级感+节点设计+矛盾设计 |
| [references/outline/outline-arrangement-2.md](references/outline/outline-arrangement-2.md) | 进阶：反派视角/黄金五章/核心梗三分/升级文技法 |
| [references/outline/outline-arrangement-3.md](references/outline/outline-arrangement-3.md) | 工程化：桥段节奏/多线写长/卖点需求/开篇切入点 |
| [references/outline/expectation-techniques.md](references/outline/expectation-techniques.md) | 期待感设计：铺垫/爽点/多线期待+信息差+情绪模型 |
| [references/outline/advanced-plot-techniques.md](references/outline/advanced-plot-techniques.md) | 高级技法：小纲四步法+高潮逆推+情绪拉扯+金手指+双线+AB交织法 |
| [references/outline/micro-innovation.md](references/outline/micro-innovation.md) | 题材微创新+差异化设计 |
| [references/outline/reversal-toolkit.md](references/outline/reversal-toolkit.md) | 反转类型+时机+误导底层路径 |
| [references/outline/emotional-arc-design.md](references/outline/emotional-arc-design.md) | 情绪曲线设计+弧形模板+期待感管理+题材赛道策略 |

### structure/ — 故事结构理论

| 文件 | 何时加载 |
|------|----------|
| [references/structure/story-structure.md](references/structure/story-structure.md) | 故事结构：大纲设计/循环写法/并列式/节奏控制/情绪驱动/爽点/双线/分镜 |
| [references/structure/story-structure-2.md](references/structure/story-structure-2.md) | 剧情过渡/拉长剧情/换地图/长线节奏/矛盾设计 |
| [references/structure/story-structure-3.md](references/structure/story-structure-3.md) | 八节点结构+实用技巧（五重驱动/真相逆推/细纲实务） |
| [references/structure/story-structure-4.md](references/structure/story-structure-4.md) | 经验笔记（上）：拆书/三幕五幕/主线类型/冲突结构（卖报笔记已并入 maibao-live-notes.md） |
| [references/structure/story-structure-5.md](references/structure/story-structure-5.md) | 经验笔记（下）：故事本质论/核心梗/阵营手牌/矛盾理论/悬念冲突 |

### hook/ — 钩子与期待感

| 文件 | 何时加载 |
|------|----------|
| [references/hook/hook-techniques.md](references/hook/hook-techniques.md) | 钩子系统：章尾钩子13式+章首钩子7式+段落级钩子+悬念编排+钩子禁忌 |
| [references/hook/hook-techniques-2.md](references/hook/hook-techniques-2.md) | 期待感体系：期待感模型+心理操控+反预判+高潮+情绪波浪 |
| [references/hook/hook-techniques-3.md](references/hook/hook-techniques-3.md) | 进阶钩子：上瘾模型+狗哨理论+看点爽点+金手指替换（三翻四震/钩子链已并入 writing-craft / expectation-techniques） |

### opening/ — 开篇与上架物料

| 文件 | 何时加载 |
|------|----------|
| [references/opening/opening-design.md](references/opening/opening-design.md) | 开头设计：黄金一章法则+六大标准+开头模板+诊断 |
| [references/opening/genre-opening-database.md](references/opening/genre-opening-database.md) | 8大题材开头模板+真实范例+决策树+书名起名法 |
| [references/opening/book-name-vetting.md](references/opening/book-name-vetting.md) | 书名查重（番茄上线前必做）：查重方法+判据+改名准则+实弹记录 |
| [references/opening/description-tags.md](references/opening/description-tags.md) | 简介 Tag 生成策略（番茄小说）：阅读标签规则+四类选项列表+选 tag 决策准则+实战示例 |

### genre/ — 题材框架

| 文件 | 何时加载 |
|------|----------|
| [references/genre/genre-frameworks-unified.md](references/genre/genre-frameworks-unified.md) | 题材框架：追妻/重生/婚恋/世情/仙侠/高武/霸总/同人/脑洞/凡人流/历史/文娱 |
| [references/genre/genre-frameworks-unified-2.md](references/genre/genre-frameworks-unified-2.md) | 核心梗解析+事业线/爱情线设计 |
| [references/genre/genre-frameworks-unified-3.md](references/genre/genre-frameworks-unified-3.md) | 扩展题材：规则怪谈/长生流/西幻/新媒体/搞笑/飞卢/刺猬猫+进阶补充 |

### character/ — 角色设计

| 文件 | 何时加载 |
|------|----------|
| [references/character/character-design.md](references/character/character-design.md) | 人物全流程：主角/配角/反派+人物关系+动机链+性格体系+配角功能 |
| [references/character/character-design-2.md](references/character/character-design-2.md) | 角色成长：主角调子/反派分量/感情流/男频女频/群像 |
| [references/character/character-design-3.md](references/character/character-design-3.md) | 经验笔记（上）：九维人设/以梗塑造/金手指与人设/大师课（卖报笔记已并入 maibao-live-notes.md） |
| [references/character/character-design-4.md](references/character/character-design-4.md) | 经验笔记（下）：男频恋爱文/装逼打脸/移情标签/爽点模板 |

### style/ — 风格与写法

| 文件 | 何时加载 |
|------|----------|
| [references/style/style-modules.md](references/style/style-modules.md) | 风格模块：幽默/悬疑/言情/推理/恐怖/奇幻/现实/升级流 8 大题材风格 |
| [references/style/style-modules-2.md](references/style/style-modules-2.md) | 代入感/期待/装逼/爽点/爱情线/毒点/救赎/边界感 |
| [references/style/style-modules-3.md](references/style/style-modules-3.md) | 轻小说/沙雕/赛博朋克/盘点/模拟/直播/网站差异/打斗智斗 |
| [references/style/style-modules-4.md](references/style/style-modules-4.md) | 镜头式写作/基础技巧/舞台搭建/战斗描写/文笔 |
| [references/style/style-modules-5.md](references/style/style-modules-5.md) | 经验笔记（上）：新媒体文/商业写作/书名（**格式大全权威版**）/留存/情绪技法（卖报笔记已并入 maibao-live-notes.md） |
| [references/style/style-modules-6.md](references/style/style-modules-6.md) | 经验笔记（下）：黄金三章/市场定位/题材本质/文笔解析/新人全流程 |
| [references/style/dialogue-mastery.md](references/style/dialogue-mastery.md) | 对话节奏/潜台词/信息控制+对话模式数据库 |
| [references/style/writing-craft.md](references/style/writing-craft.md) | 写作心法+毒点清单+断期待（权威版）+三翻四震+心态（按需） |

### quality/ — 质量与去 AI

| 文件 | 何时加载 |
|------|----------|
| [references/quality/quality-checklist.md](references/quality/quality-checklist.md) | 质量检查+毒点排查+常见问题速查 |
| [references/quality/anti-ai-gates.md](references/quality/anti-ai-gates.md) | 6 Gate 门禁细则+质量维度+7 种 AI 模式检测+高压区 1-7（含揭晓体）+快速自检口诀（含证伪）（门禁必读） |
| [references/quality/anti-ai-polish.md](references/quality/anti-ai-polish.md) | 去AI味：可编辑范围分级+信息账本+修补顺序+三遍法+改写范例库（门禁打回/润色/重写时读） |

### notes/ — 作者经验与心态

| 文件 | 何时加载 |
|------|----------|
| [references/notes/maibao-live-notes.md](references/notes/maibao-live-notes.md) | 卖报小郎君直播笔记合并归档：人物塑造/题材解析/黄金开篇/节奏与高潮/悬念与伏笔/创作实务（2026-10-11 由 6 文件合并） |
| [references/notes/writer-psychology.md](references/notes/writer-psychology.md) | 写作心理建设+职业规划+码字习惯（卖报笔记已并入 maibao-live-notes.md） |

### integrations/ — 语雀集成（可选）

| 文件 | 何时加载 |
|------|----------|
| [references/integrations/yuque-integration.md](references/integrations/yuque-integration.md) | 语雀/both 模式（save_location=yuque/both）时全流程必读；**纯本地模式无需加载** |
---

_版本：v3.5.49_
