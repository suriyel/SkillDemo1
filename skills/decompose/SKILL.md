---
name: decompose
description: "当 BDD 已批准、尚未生成 task 列表时使用 — 按【用户需求文档 original-requirements.md】的能力切分 work-unit feature（每个 ≈ 一个 Worker 会话能独立做完的需求单元），为每个 work-unit 记需求锚点 req_refs（impl 的权威指针）并映射其覆盖的 bdd_ids（仅供下游验证），产出 feature-plan.json 供下游 init 机械灌入 loop。本节点是颗粒度的单一决策点，不可跳过。本蓝图无 SRS / FR-id：切分主轴是用户需求，BDD 退为验证 oracle。"
---

**语言规则**：用中文（简体）回复用户。所有面向用户的输出用中文。Skill 名称、代码标识符、JSON 字段名保持英文。

# 需求 → Feature 分组（按需求切、按预算控大小）

把**用户需求文档**（`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`）的能力切分成一组 **work-unit feature**——每个 work-unit feature ≈ **一个 Worker 会话能独立做完**的需求单元。

> **切分主轴 = 用户需求（不是 BDD）**。本蓝图无 SRS / FR-id：以 `original-requirements.md` 的能力（段落/章节）为原子单位贪心合并成内聚的 work-unit，**为每个 work-unit 记 `req_refs`（覆盖的需求行号区间 + 摘要）——这是下游 impl 的权威实现指针**。`bdd.json` 场景退为「验证 oracle」：每个 work-unit 再**映射**出其覆盖的 `bdd_ids[]`（取 derivation 锚点落在本 work-unit 需求区间内的场景），仅供下游 ut/review/gate_review/st 验证用，**不是分组依据、也不是 impl 实现依据**。
>
> 为何不再「按 bdd 切」：BDD 是散文需求被拆成的离散场景，按它切会让 work-unit 变成「一袋可能不完整的场景」、丢掉散文里的隐含需求——直接 prompt 全对、走流程漏一片的根因。按需求切 + impl 读原文，才忠实。

**预算只用来控大小、不改主轴**：仍按真实上下文预算把 work-unit 控制在「一个会话能装下」（用其映射的 BDD 场景数估投影），避免单 work-unit 过肥；但**不为吃满窗口而把不相关的需求并进来**。

产物是 `{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json`。本节点**不**判 tech_stack、不写 tool-commands-guide、不生成 project-context.md、不灌 loop——这些都在下游 init。

## 输入

| 文档 | 位置 | 用途 |
|------|------|------|
| 用户需求文档 | `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md` | **切分主轴**：按能力点（带行号区间）切 work-unit、算 `req_refs`、命名、判优先级/依赖 |
| BDD | `{{HARNESS_MEMORY_DIR}}/plans/bdd.json` | 验证 oracle：据 `scenarios[].derivation` 的需求锚点把场景**映射**到所属 work-unit 算 `bdd_ids[]`、并估场景数控大小（`features[].risk` 供优先级映射）|
| 拆分策略 | `{{HARNESS_MEMORY_DIR}}/plans/split-strategy.json` | conservative / balanced / aggressive（缺则兜底 aggressive） |
| 校准 | `{{HARNESS_MEMORY_DIR}}/plans/calibration.json` | 实测 perScenarioTokens（若 calibrate 节点产出；本蓝图默认无 calibrate → unmeasured，用策略默认值）|

## Step 0 — 单轮判定（最先判定）

本蓝图无 SRS 元数据承载「单轮」选择，故由本节点据总场景预算判定并在 Step 4 向用户呈现：

1. 从 `bdd.json` 取全部 `scenarios[].id` 去重，得总场景数 M。
2. 跑 `node {{SCRIPTS}}/_context-budget.cjs --fixed-bytes <bdd.json + original-requirements.md + rules 字节>` 取 `maxScenariosPerFeature`、`overflowCeil`、`windowTokens`。
3. **若 M ≤ `maxScenariosPerFeature`**（全部场景投影 ≤ 一个会话预算）→ 在 Step 4 向用户给出「单轮（合为一个 feature、iter 一轮做完）/ 多 feature」选项，默认建议单轮。用户选单轮 → 顶层 `single_round: true`，`features` 仅一项（`bdd_ids`=全部场景）。
4. **若 M > `maxScenariosPerFeature`** → 顶层 `single_round: false`，照常进入下面的多 feature 分组（不再给单轮选项）。

## Step 1 — 读策略与校准

1. Read `split-strategy.json` 取 `strategy`；缺失 / 损坏 → 兜底 `aggressive`，并在 Step 2 预算行附提示「⚠️ 未发现 split-strategy.json，按激进档兜底」。
2. Read `calibration.json`（信息性，本蓝图通常无 calibrate）：`status == "measured"` → 记下 `perScenarioTokens` 与来源；否则知会「本次用策略默认 per-scenario（未校准）」。

## Step 2 — 取预算

跑（`--strategy` 用 Step 1 的策略；`--fixed-bytes` 传 bdd.json + `original-requirements.md` + `notes/rules/*.md` 的字节数合计估值——**不含 srs.md / design.md，本蓝图无此二者**）：

```bash
node {{SCRIPTS}}/_context-budget.cjs --strategy <策略> --fixed-bytes <固定文档字节>
```

拿到本次运行的 `windowTokens` / `tokensPerFeatureBudget`(=planningBudget) / `perScenarioTokens` / `perScenarioSource`(calibrated|strategy) / `overflowCeil` / `maxScenariosPerFeature`（单 feature 可容 BDD 场景上限）。

**一句话亮给用户**（避免黑盒），例：
> 「当前模型窗口 200K，策略=激进，单 feature 预算 ~150K token，单场景成本 5.5K（未校准默认），单 feature 可容约 27 个 BDD 场景；下面按此预算分组。」

## Step 3 — 按需求切分组建议

1. **精读 `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`，列出用户需求的能力点**（每个能力记其在原文的行号区间 `L<起>-L<止>` + 一句摘要）。这是切分的原子单位。
2. **在内聚边界内**（共享同一接口 / 角色 / 领域实体 / 用户目标）贪心合并相关能力，使每个 work-unit 是「一个会话能独立做完」的连贯需求单元。
3. **用预算控大小**：为每个候选 work-unit 估其映射的 BDD 场景数（Step 5 的映射规则：derivation 锚点落在本 work-unit 需求区间内的场景去重计数），让投影 ≤ `overflowCeil × 窗口`（规划目标，非硬门）；某能力映射场景过多致超窗 → 把该能力按子能力再切。**填充强度按策略**：激进 ~90%、平衡 ~70-80%、保守 ≤70%。
4. **硬约束**：
   - **切分主轴是需求，不是凑满窗口**：**不为凑满把不相关需求并进来**（伤内聚、加跨节点漂移）。
   - 投影超 `overflowCeil × 窗口` → 下游 gate_decompose **只告警、不强制拆**。
   - 避免过度碎片化：一堆只覆盖极少需求/场景的薄 work-unit 会被 gate_decompose 按 S5 同源兄弟聚合打回——同源（同接口/角色/实体）的薄需求应合并成一个「特性族」work-unit。

呈现建议分组（按需求 + 摘要 + 映射场景数）：
```
Feature 1：[title] — 覆盖需求「登录」「会话」(original-requirements.md L12-L46；共同领域) → 映射 ~12 场景 BDD-001..012
Feature 2：[title] — 覆盖需求「导出」(L80-L120；独立功能) → 映射 ~8 场景
...
```

## Step 4 — 用户批准

通过 AskUserQuestion 或自由响应让用户确认 / 调整分组（合并、重命名、重排、改依赖）。若 Step 0 判定可单轮，把「单轮 / 多 feature」选项一并呈现。

## Step 5 — 算 req_refs（impl 权威指针）+ 映射 bdd_ids（验证 oracle）

对每个 work-unit feature：

1. **`req_refs`（权威实现指针，必产）**：本 work-unit 覆盖的需求在 `original-requirements.md` 的行号区间 + 摘要，每项形如 `"original-requirements.md L<起>-L<止> | <一句摘要>"`（或对存量约定 `notes/rules/<file>:line | <摘要>`）。**这是下游 impl 据以读原文实现的权威指针**——impl 不读 bdd.json，全靠 req_refs 定位要实现的需求片段。
2. **`bdd_ids`（验证 oracle，映射得到）**：取 `bdd.json` 中 `derivation` 锚点（`original-requirements.md L<x>` 或存量 `file:line`）**落在本 work-unit 的 req_refs 区间内**的场景 id，去重。
   - **全覆盖铁律**：`bdd.json` 每条场景都必须被某个 work-unit 的 `bdd_ids` 认领（gate_decompose 硬门：有孤立场景即 fail）。某场景 derivation 锚点不清晰/锚到 scan → 归到拥有其相关能力的 work-unit，**不得漏**。
   - `bdd_ids` 仅供下游 ut（写测试）/ review / gate_review / st（验证）使用，**非 impl 实现依据、非分组主轴**。

## Step 6 — 落盘 feature-plan.json

Write `{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json`（⚠ 本形态是 decompose 写 / gate_decompose 校 / init 读 的共享契约，改字段须三处同步）：

```json
{
  "single_round": false,
  "strategy": "aggressive",
  "perScenarioTokens": 5500,
  "perScenarioSource": "strategy",
  "features": [
    {
      "title": "登录与会话",
      "req_refs": [
        "original-requirements.md L12-L28 | 邮箱+密码登录字段与校验规则",
        "original-requirements.md L40-L46 | 登录成功后的会话维持与登出"
      ],
      "bdd_ids": ["BDD-001", "BDD-007"],
      "priority": "high",
      "dependencies": [],
      "description": "邮箱+密码登录、会话维持、登出"
    }
  ],
  "ts": "<ISO-8601>",
  "selected_by": "decompose"
}
```

字段规则：
- 顶层 `single_round`（布尔）：单轮模式 = `true`（Step 0/4 判定写入）；多 feature = `false`。下游 gate_decompose 据此放宽碎片化判定、init 据此传播标志。
- `req_refs`（**必产、非空数组**）：Step 5 的需求锚点，每项形如 `"original-requirements.md L<起>-L<止> | <摘要>"` 或 `"<file>:line | <摘要>"`。**这是下游 impl 的权威实现指针**（gate_decompose 硬校验存在+非空+锚点格式）。
- `bdd_ids`：Step 5 映射出的去重场景 id，**非空**（每个 work-unit 至少覆盖一个场景）；**仅供下游验证**，非 impl 实现依据、非分组主轴。
- `priority`：取该组所覆盖 BDD 场景 `risk` 的最高映射（critical→high / normal→medium / trivial→low），或用户指定；默认 `"medium"`。
- `dependencies`：从输入文档显式依赖或用户指定推断；无则 `[]`（依赖只引用本 plan 内其它 feature 的语义顺序，下游 init 转 task id 时落实）。
- `description`：本 work-unit 的需求范围一句话摘要（自包含，供 review/st 与人读；impl 以 req_refs + 原文为准）。
- **无 `srs_trace` 字段**（本蓝图无 FR-id）。

## Step 7 — 自检后推进

落盘后自检（下游 gate_decompose 会硬门复核同样几条）：
- 每个 feature 的 `req_refs` **非空**且每项锚点格式合法（`original-requirements.md L…` 或 `file:line`）；
- `req_refs` 合起来覆盖了被切分的全部需求能力（无遗漏的用户需求）；
- `bdd.json` 每个场景至少被一个 feature 的 `bdd_ids` 认领，且无 ghost id（不存在的场景 id）；
- 每个 feature 的 `bdd_ids` 非空；
- 无过度碎片化（薄 work-unit 已按 S5 聚合）。（投影超窗只是告警、不阻断。）

自检通过 → {{ADVANCE_OK}}。
输入文档缺失/不可读无法分组 → {{ADVANCE_BLOCKED notes=<原因>}}。

bp-advance 是本回合最后一个动作，调用后立即结束本回合。

## 反模式

| 合理化 | 正确回应 |
|--------|---------|
| "按 bdd.json 的 behavior feature 切最省事" | 切分主轴是**用户需求**（original-requirements.md），不是 BDD。按 bdd 切会丢散文里的隐含需求；用 req_refs 锚需求、bdd_ids 仅映射验证。 |
| "给 feature 加个 srs_trace 才完整" | 本蓝图无 SRS / FR-id。work-unit 靠 `req_refs` 锚需求（impl 指针）+ `bdd_ids` 锚验证场景，srs_trace 是不存在的概念。 |
| "req_refs 我先空着，下游能从 bdd_ids 推" | 不行。impl 不读 bdd.json，全靠 req_refs 定位需求；req_refs 空 = impl 无权威源，gate_decompose 硬 fail。 |
| "一个需求一个 work-unit" | 同源薄需求会引发碎片化 + 浪费每会话固定开销，gate_decompose 会打回按 S5 聚合。 |
| "凑满窗口，把不相关需求也并进来" | 伤内聚、加跨节点漂移；只在共享接口/角色/实体/用户目标的内聚边界内合并。 |
| "校准没测到就不管预算" | unmeasured 时用策略默认 perScenarioTokens 照常按预算控大小，别退回拍脑袋。 |
| "顺手把 items[] 灌进 loop" | 灌 loop 是 init 的职责；本节点只产出 feature-plan.json。 |
