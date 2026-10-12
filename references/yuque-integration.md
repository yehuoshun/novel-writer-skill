# 语雀集成（可选）— 操作手册

_参考文件，按需加载。语雀是可选项，`save_location=local` 的用户不需要读本手册。_

> 本手册由 SKILL.md v3.5.17 抽离（2026-10-12）：语雀降级为可选集成，SKILL.md 主流程以本地模式为唯一主线。本手册承载全部语雀专属细节，与主流程一一对应，**零内容丢失**。
>
> 触发加载：`save_location=yuque` / `save_location=both` / `backup.mode=yuque_history`（依赖语雀历史版本）时。

---

## 1. 何时需要语雀

| 场景 | 是否需要语雀 |
|------|--------------|
| `save_location=local` + `backup.mode=local` | 不需要（纯本地） |
| `save_location=local` + `backup.mode=yuque_history`（默认） | 需要语雀历史版本做备份 |
| `save_location=yuque` | 需要（正文+设定都存语雀） |
| `save_location=both` | 需要（双写，语雀+本地互为备份，读优先本地） |

纯本地用户：忽略本手册全部内容，`yuque` 配置块不填。

---

## 2. 配置（`yuque` 块）

```json
{
  "save_location": "yuque",
  "backup": { "mode": "yuque_history" },
  "yuque": {
    "book": "84415848",
    "groups": {
      "content": "…uuid…",
      "protagonist": "…uuid…",
      "antagonist": "…uuid…",
      "supporting": "…uuid…",
      "deceased": "…uuid…",
      "item": "…uuid…",
      "location": "…uuid…",
      "faction": "…uuid…",
      "foreshadowing": "…uuid…",
      "timeline": "…uuid…",
      "outline": "…uuid…",
      "detailed_outline": "…uuid…",
      "key_dialogue": "…uuid…",
      "level_system": "…uuid…",
      "change_log": "…uuid…",
      "sweet_spot": "…uuid…",
      "hook": "…uuid…",
      "emotion": "…uuid…",
      "world_view": "…uuid…",
      "mermaid": "…uuid…",
      "changes": "…uuid…"
    }
  }
}
```

- `yuque.book`：小说知识库 ID 或 namespace（二选一，至少填其一；正文+设定同库）
- `yuque.groups`：语雀分组 UUID 映射（22 个 key 全必填，见第 4 节映射表；新建时从建组 API 响应直接回写，无需手填）
- 完整示例：`configs/example-yuque.json`（语雀模式）/ `configs/example-both.json`（双写模式）
- `save_location=both` 时 `yuque` 和 `local` 两个块都必填

---

## 3. 新建小说（语雀模式）

> 对应 SKILL.md「新建小说」流程第 11 步：语雀模式调用 API 自动创建目录分组，**从响应 data 直接取各分组 UUID 回写配置（无需再读）**。

### 3.1 22 项分组映射全建（= 22 个 TITLE 节点 + 1 个快照 DOC）

21 个 TITLE 对应配置 key——正文/主角组/反派组/配角组/已故角色/物品设定/地点设定/势力设定/伏笔追踪/时间线/大纲/细纲/关键对话/等级体系/变更日志/爽点追踪/钩子追踪/情绪曲线/世界观/Mermaid关系图/变更记录；另需建 **角色设定** 一个 TITLE 作主角组/反派组/配角组/已故角色的**结构父组**（不是配置 key）。

**`snapshot`（快照）是 DOC 不是分组**——用 `yuque_create_doc` 建一篇「状态快照」文档、取其数字 id 作 uuid 回写；**快照 DOC 挂「变更记录」分组下、置于分组首位**（2026-10-12 老板定：与 chXXX-changes 同属运行数据；prependNode 首插；此前建 TOC 根部——把快照当 TITLE 建是错的；漏建「角色设定」父组则 4 个子组挂不上）。

### 3.2 `content`（正文）分组必须第一个建

`content` 分组存正文章节文档（挂 `第XXX章` DOC），**必须第一个建**（`prependNode` 或先建保证 TOC 置顶；2026-10-09 实测：从角色设定开始建会导致正文不置顶，后续要用 `prependNode` 移回）。

其余分组按第 4 节配置表顺序建（注意嵌套：主角组/反派组/配角组/已故角色 挂在 角色设定 下，细纲 挂在 大纲 下；MCP 批建用 `target_title` 指向父组名即可，无需先拿 uuid）。

### 3.3 旧库缺组自动补建

**先 `GET /toc` 查同名节点**（裸 API 同名不复用），存在则复用 UUID、缺失才 appendNode 创建（尤其 `世界观`、`Mermaid关系图`）。

### 3.4 双写模式（both）

语雀和本地两套都创建（本地侧目录树见 SKILL.md「本地设定文件夹」），`yuque` 和 `local` 配置块都必须填全。

### 3.5 简介落库

「生成简介（含发布 tag）」完成后：语雀模式建「简介」DOC（挂 `content` 分组下）；双写两处都写。

### 3.6 询问节点

创建知识库前必须询问用户确认（与 SKILL.md「询问节点」一致）。

---

## 4. 语雀知识库结构（单库模式）

> 语雀没有文件夹概念，用 TOC 树实现：TITLE 节点 = 分组目录，DOC 节点 = 文档。
> 正文和设定存同一个知识库，下面的树中，`/` 结尾的是 TITLE 分组节点，`.md` 结尾的是独立 DOC 文档。

```
小说知识库（根）
├── [TITLE] 正文/             ← 正文章节 DOC（第001章、第002章…）
├── [TITLE] 角色设定/
│   ├── [TITLE] 主角组/
│   ├── [TITLE] 反派组/
│   ├── [TITLE] 配角组/
│   └── [TITLE] 已故角色/
├── [TITLE] 物品设定/
├── [TITLE] 地点设定/
├── [TITLE] 势力设定/
├── [TITLE] 等级体系/
├── [TITLE] 时间线/
├── [TITLE] 伏笔追踪/
├── [TITLE] 爽点追踪/
├── [TITLE] 钩子追踪/
├── [TITLE] 情绪曲线/
├── [TITLE] 大纲/
│   └── [TITLE] 细纲/
├── [TITLE] 关键对话/
├── [TITLE] 世界观/
├── [TITLE] Mermaid关系图/
├── [TITLE] 变更日志/         ← 章节摘要（按卷分篇）
├── [TITLE] 变更记录/         ← TITLE 分组，存每章增量 CHANGES（chXXX-changes）+ 状态快照 DOC（首位）
└── [DOC] 状态快照（挂「变更记录」下、置于分组首位）
```

### groups 映射表（配置文件 `yuque.groups`，22 个 key 全必填，与「22 个分组全建」一一对应）

| key | 分组节点 | 用途 |
|-----|----------|------|
| `content` | 正文/（TITLE） | 正文章节文档 |
| `protagonist` | 角色设定/主角组/（TITLE，嵌套） | 主角档案 |
| `antagonist` | 角色设定/反派组/（TITLE，嵌套） | 反派档案 |
| `supporting` | 角色设定/配角组/（TITLE，嵌套） | 配角档案 |
| `deceased` | 角色设定/已故角色/（TITLE，嵌套） | 已故角色档案 |
| `item` | 物品设定/（TITLE） | 物品档案 |
| `location` | 地点设定/（TITLE） | 地点档案 |
| `faction` | 势力设定/（TITLE） | 势力档案 |
| `foreshadowing` | 伏笔追踪/（TITLE） | 伏笔档案（vX-伏笔名.md） |
| `timeline` | 时间线/（TITLE） | 时间线文档 |
| `outline` | 大纲/（TITLE） | 大纲分组节点（含全书大纲/卷大纲/章节大纲） |
| `detailed_outline` | 大纲/细纲/（TITLE，嵌套） | 细纲分组节点（旧库若平级建过则复用） |
| `key_dialogue` | 关键对话/（TITLE） | 关键台词记录 |
| `level_system` | 等级体系/（TITLE） | 等级设定 |
| `change_log` | 变更日志/（TITLE） | 章节摘要（按卷分篇「章节摘要-第N卷」） |
| `sweet_spot` | 爽点追踪/（TITLE） | 爽点追踪文档 |
| `hook` | 钩子追踪/（TITLE） | 钩子追踪文档 |
| `emotion` | 情绪曲线/（TITLE） | 情绪曲线文档 |
| `world_view` | 世界观/（TITLE） | 世界观文档 |
| `mermaid` | Mermaid关系图/（TITLE） | 关系图 + 地理方位表 |
| `changes` | 变更记录/（TITLE） | chXXX-changes 增量文档（永久保留）+ 状态快照 DOC（首位） |

---

## 5. API 操作速查（2026-10-07~12 实弹验证）

> 优先使用 yuque-mcp 工具（`yuque_create_doc` 建文档 / `yuque_batch_update_toc` 批量建分组等；`createTitle` 是 `yuque_batch_update_toc` 支持的 action——**参数 `ops` 传 JSON 数组**（每项 `{"action":"createTitle","title":"正文"}`，子组加 `target_title:"角色设定"` 按名挂父组），**另必填 `confirm:"RESTRUCTURE"` 安全闸**；批量建 TITLE 自动去重（返回 `results[].new_node_uuid`）、复用已有目录，新建 22 组时优先用它；`yuque_update_toc` 仅透传单条 action：appendNode/prependNode/editNode/removeNode，无 createTitle 封装）。
> MCP 不可用时按下方裸 API 调用（裸 API 与 yuque-mcp **同源**——MCP 即该 API 的封装，2026-10-10 经 `yuque_update_toc` 透传实测行为一致；若所在环境禁止直连 API，则等 MCP 恢复，勿硬闯）。
> 认证：请求头 `X-Auth-Token: <token>`，基地址 `https://www.yuque.com/api/v2`，repo 标识用数字 id 或 namespace 均可。

### 5.1 建分组（新建小说 22 组，含正文组）

- MCP 路径：`yuque_batch_update_toc`（`ops`=JSON 数组；`confirm:"RESTRUCTURE"` 必填；自动去重 + 复用已有目录，`results[].new_node_uuid` 直接回写 `yuque.groups`；嵌套子组用 `target_title` 指向父组名，一次建全）
  - ⚠️ 实测（2026-10-10）：批量建组偶发个别失败（重跑即可，createTitle 自动去重用已有目录，不会重复）；正文组**必须首个建**才能置顶
- 裸 API 路径（MCP 不可用时）：

```
PUT /repos/{book_id}/toc
{
  "action": "appendNode",   // 合法枚举：appendNode/prependNode/appendChild/moveAfter/...
  "action_mode": "child",    // 仅 sibling/child 二选一（必填）
  "type": "TITLE",
  "title": "角色设定"
}
```

- **响应 `data` = 更新后的全量 TOC 节点数组**（含新节点 uuid；appendNode/prependNode/editNode/removeNode 均返回），从数组里取新节点 uuid 回写 `yuque.groups`，无需再 GET（2026-10-10 实测）
- ⚠️ **裸 API 同名不复用**：重复建同名会生成重复节点；旧库缺组补建必须**先 `GET /toc` 查同名**，有则复用 uuid、无才建
- ⚠️ **`action_mode: sibling` 必须配 `target_uuid`（锚点 uuid）**，否则**静默 no-op**——返回 200 + 原 TOC，什么都不建，极易误判成功（2026-10-10 实测）；建组用 `child` 最稳；`prependNode` 已验证可置顶
- 删除节点：`{"action":"removeNode","action_mode":"child","node_uuid":"<uuid>","confirm":"DELETE"}`——**`confirm:"DELETE"` 必填**（缺了报二次确认错误）

### 5.2 创建文档（设定模板 / chXXX 变更记录）

```
POST /repos/{book_id}/docs
{
  "title": "张三",
  "body": "...",
  "slug": "zhangsan"        // 可选，kebab-case；不传自动生成
}
// ⚠️ 2026-10-11 实测：parent_uuid 参数不生效，创建出的文档不在 TOC 树内（孤儿文档）！
// 挂到分组必须第二步：PUT /repos/{book_id}/toc
{"action":"appendNode","action_mode":"child","type":"DOC","target_uuid":"<分组TITLE uuid>","doc_ids":[<doc id>]}
```

### 5.3 更新文档（状态快照覆盖等）

```
PUT /repos/{book_id}/docs/{doc_id}
// doc_id = 文档数字 id 或 slug，均可
{ "title": "...", "body": "...", "slug": "..." }
```

> ⚠️ MCP 路径 `yuque_update_doc` **必须带 `book_id`**（schema 强制，漏传报 -32602 Input validation error；2026-10-09 实测）。参数：`{"book_id": "<数字id或namespace>", "id": "<doc_id>", "title": "...", "body": "...", "slug": "..."}`。另注意：MCP 返回有时平铺有时 `data` 包装，解析 `id`/`doc_id` 时两处都要兼容

### 5.4 读目录（查分组/取 uuid）

```
GET /repos/{book_id}/toc
// 返回节点数组，含 type(TITLE/DOC)/uuid/title
```

### 5.5 一步封装工具（推荐）

`node scripts/yuque-doc.js`（独立工具，与 SKILL.md 主流程解耦）：
- `create-mount --book <id> --title <标题> --file <out.md> --group 正文`：创建文档 + 挂载分组一步完成（自带查分组/异常提示；详情 `node scripts/yuque-doc.js --help`）
- `ls-groups --book <id>`：列全部分组
- `audit --book <id> --local <小说目录>`：双写对账（见第 7 节）
- `sync --book <id> --local <小说目录> [--dry-run]`：批量同步（见第 7 节）

---

## 6. 写章节流程中的语雀差异

### 6.1 语雀模式跑脚本（导出临时目录法）

> 📌 脚本按文件路径工作，须先把本章正文、上一章快照、涉及设定档（角色/地点/物品）导出到临时目录再跑 `check-consistency.js` / `check-indentation.js` / `scan-text-health.js`，`prepare-upload.js` 同理（2026-10-10 纯语雀实弹补注）。

### 6.2 上传前预处理（必做）

先跑 `node scripts/prepare-upload.js <正文.md> <out.md>` 生成可上传正文，再用 out.md 上传（2026-10-09 实弹验证，缺一步语雀就顶格/露协议块）。脚本自动做三件事：

1. **剥离 CHANGES 块**：`---CHANGES---…---END CHANGES---` 不进正文页面（只进 chXXX-changes 文档）；实测不剥离会整块渲染进正文文档
2. **前置占位注释** `<!-- 语雀渲染占位（首段缩进保护） -->`：实测语雀 lake 转换会吃掉「文档第一段」行首的全角空格（其余段落不受影响），注释占位让原第一段变成第二段，缩进全保
3. **内置段首缩进校验**：与 `check-indentation.js` 同规则（自然段段首两全角空格「　　」，标题/空行/列表/引用块/表格/代码块/场景分隔符豁免；规则源为两脚本共用 `scripts/lib/text-format.js`，防两处漂移），退出码非 0 → 先补齐再上传，禁止跳过

### 6.3 正文上传（创建+挂载）

**推荐：`node scripts/yuque-doc.js create-mount --book <id> --title <标题> --file <out.md> --group 正文`** 一步完成「创建+挂载」，自带查分组/异常提示。

手动两步：
1. `POST /repos/{book_id}/docs` 创建（body 用 prepare-upload.js 输出的 out.md，不用原始正文文件；⚠️ 实测 parent_uuid 参数不生效，创建出的文档不在 TOC 树内）
2. `PUT /repos/{book_id}/toc` 挂载：`{"action":"appendNode","action_mode":"child","type":"DOC","target_uuid":"<分组TITLE uuid>","node_uuid":"<TOC节点uuid>"}`——**node_uuid 是 TOC 节点 uuid（非 doc_id），appendNode+doc_ids 对已入树的 doc 无效**（2026-10-12 实弹）

### 6.4 双写（both）的本地侧

正文存**完整版（含 CHANGES 块，工作态）**，另存 prepare-upload.js 剥离版供上传；**CHANGES 只归档到语雀「变更记录」分组（chXXX-changes 文档）——本地不建 changes 目录**（2026-10-12 老板定：语雀是 changes 的权威备份；backup-snapshot 快照时从正文提取 CHANGES 归档）。

### 6.5 快照更新（语雀模式）

更新 `snapshot` 分组下的 DOC，用 `PUT /repos/{book_id}/docs/{doc_id}` 覆盖（doc_id 为文档数字 id 或 slug，均可）。

### 6.6 CHANGES 归档

保存 `ch{001}-changes.md` 到 `变更记录/` 分组（增量日志，永久保留，编号三位零填充：ch001、ch002…ch999）。语雀模式：在 `changes` TITLE 节点下创建 DOC（两步：`POST /repos/{book_id}/docs` 创建 + `PUT /toc` appendNode 挂载，同正文 DOC，见 6.3）。

### 6.7 章节摘要

**按卷分篇**——「章节摘要-第N卷」（每章一节）——语雀挂 `change_log`（变更日志）分组下（⚠️ 2026-10-12 按卷拆：单篇累计后期会过大导致语雀 IO 超时，老板定；第二卷开写时新建「章节摘要-第二卷」）。

### 6.8 追踪文档双写

每章回写必须同步 7 个追踪文档（爽点追踪、钩子追踪、情绪曲线、时间线、等级体系、世界观、关键对话）——语雀/双写模式两处都更新。历史教训：7 个空分组空了两百多章，建库时建了但回写流程没要求填。

### 6.9 改版备份铁律（语雀侧）

正文任何版本改动（朱雀迭代 / 复核修复 / 润色重写）**开始前**，先把**当前版全文**存到语雀「正文版本备份」TITLE 分组（uuid 见各书配置；新建 DOC 命名 `ch{NNN}-v{版本号}`，如 `ch020-v3`），并更新同分组下 `ch{NNN}-版本备份索引`（版本表 + 检测值 + 状态）。v4.1 全文因未备份而不可考（教训：反复覆盖后无法溯源）。本地侧同步留档 `novel/<书>/版本备份/`。

### 6.10 查设定（语雀模式）

数据来源：优先读该实体的详细档案文档（语雀：对应分组 DOC）；档案缺失时回退 `状态快照.md` 摘要（快照只含等级/位置/状态/背包/出场章，不含关系/亲密/动机等详细字段）。

### 6.11 Mermaid 渲染说明

语雀**能渲染正文里的 ` ```mermaid ` 代码块**（**无需 board 画板**；实弹验证：本库「地点关系图」即此写法，可显示）。mermaid 语法合规规则见 SKILL.md「更新图」一节（节点带 id / 中文标签用 [] / 不用中文 subgraph 名 / 避开全角特殊符 / 避开保留字）。

### 6.12 冲突检测中的语雀缺档

`check-conflicts.js` 的档案完整性对账在语雀模式同样适用（实弹：设定/ 曾缺 30+ 份档案且语雀缺苏正档案，靠这招兜底）——语雀模式先把档案导出到临时目录再跑。

---

## 7. 双写（both）对账与批量同步

### 7.1 audit 对账

本地/语雀档案同步前后跑 `node scripts/yuque-doc.js audit --book <id> --local <小说目录>` 验证两侧一致（🟢 一致 / 🔴 本地有语雀无 / 🔵 语雀有本地无）；不一致先处理再进下一步。

### 7.2 sync 批量同步

回写改完本地档案后，`node scripts/yuque-doc.js sync --book <id> --local <小说目录> [--dry-run]` 一键把本地 设定/ 全部推语雀（含 changes，标题头/尾部换行差异自动豁免）；先 `--dry-run` 预演确认差异方向（本地新才推，若语雀新需反向处理），再真跑。

### 7.3 目录镜像铁律（2026-10-12 老板定）

本地 设定/ 目录与语雀分组**一一对应同构**（角色设定/主角组·反派组·配角组·已故角色、物品设定、地点设定、势力设定、伏笔追踪、细纲、大纲、变更日志、爽点追踪、钩子追踪、情绪曲线、时间线、等级体系、世界观、关键对话、Mermaid关系图）；新增档案按类型归对应分组，语雀调整分组时本地同步挪；audit 的路径分组校验会拦不一致。

### 7.4 设定变更通知

用户手动改语雀后，必须通知 AI「设定已更新」（与本地文件改动同规则）。

---

## 8. 参考资料

- `configs/example-yuque.json`：语雀模式完整示例
- `configs/example-both.json`：双写模式完整示例
- `scripts/yuque-doc.js`：创建+挂载/查分组/audit/sync 一步封装工具
- `scripts/prepare-upload.js`：上传前预处理（剥离 CHANGES + 占位注释 + 缩进校验）
- SKILL.md「新建小说」「写章节（阶段四）」「更新图」对应章节
