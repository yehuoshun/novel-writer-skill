# 特殊功能 · 发布闸门细则

> 何时加载：准备把草稿落进正文目录时（`publish-chapter.js` / `publish-batch.js`）。命令主干在 [SKILL.md](../../../SKILL.md)「特殊功能 · 发布闸门」。

## 发布闸门

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
