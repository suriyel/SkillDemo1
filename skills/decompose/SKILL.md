---
name: decompose
description: "当 BDD 已批准、尚未生成 task 列表时使用 — 把 bdd.json 的 behavior feature / 场景按上下文预算分组合并为 work-unit feature（每个 ≈ 一个 Worker 会话能独立做完、被一组连贯 BDD 场景独立验证），产出 feature-plan.json 供下游 init 机械灌入 loop。本节点是颗粒度的单一决策点，不可跳过。本蓝图无 SRS / FR-id，分组以 BDD 场景为单位。"
---

**语言规则**：用中文（简体）回复用户。所有面向用户的输出用中文。Skill 名称、代码标识符、JSON 字段名保持英文。

# BDD → Feature 分组（按预算贪心填充）

把已批准 `bdd.json` 的 behavior feature / 场景分组合并成一组 **work-unit feature**——每个 work-unit feature ≈ **一个 Worker 会话能独立做完、且能被一组连贯 BDD 场景独立验证**的单元。本蓝图无 SRS / FR-id：分组的原子单位是 **BDD 场景（`BDD-xxx`）**，每个 work-unit feature 覆盖一组场景（`bdd_ids[]`），按真实上下文预算填到接近窗口上限（吃满窗口、摊薄 impl 每迭代重读 bdd.json / 输入文档的固定开销）。

产物是 `{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json`。本节点**不**判 tech_stack、不写 tool-commands-guide、不生成 project-context.md、不灌 loop——这些都在下游 init。

## 输入

| 文档 | 位置 | 用途 |
|------|------|------|
| BDD | `{{HARNESS_MEMORY_DIR}}/plans/bdd.json` | `features[]`（behavior feature 名 + `risk`）+ `scenarios[].id`；分组的原子单位，据此给每个 work-unit feature 算 `bdd_ids[]` 并估场景数 |
| 输入文档 | `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md` | 能力概览（命名 work-unit feature、判优先级/依赖时参考）|
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

## Step 3 — 分组建议

1. 从 `bdd.json` 列出所有 behavior feature（名 + risk + 其 `scenarios[].id`）。
2. 估每个候选分组的 BDD 场景数 = 并入该组的各 behavior feature 的 `scenarios[]` 去重计数之和。
3. 在**内聚边界内**（共享同一接口 / 角色 / 领域实体）贪心合并相关 behavior feature，使各组场景数接近 `maxScenariosPerFeature`。**填充强度按策略**：激进 ~90%、平衡 ~70-80%、保守 ≤70%。
4. **硬约束**：
   - 尽量让任一组场景数投影 ≤ `overflowCeil × 窗口`（规划目标，非硬门）；超了下游 gate_decompose **只告警、不强制拆**。
   - **不为凑满并入无关 behavior feature**（伤内聚、加跨节点漂移）。
   - 避免过度碎片化：一堆只含 1-2 个场景的薄 feature 会被 gate_decompose 按 S5 同源兄弟聚合打回——同源（同接口/角色/实体）的薄 feature 应合并成一个「特性族」work-unit feature。

呈现建议分组：
```
Feature 1：[title] — 覆盖 behavior「登录」「会话」（理由：共同领域；~12 场景 BDD-001..012）
Feature 2：[title] — 覆盖 behavior「导出」（理由：独立功能；~8 场景）
...
```

## Step 4 — 用户批准

通过 AskUserQuestion 或自由响应让用户确认 / 调整分组（合并、重命名、重排、改依赖）。若 Step 0 判定可单轮，把「单轮 / 多 feature」选项一并呈现。

## Step 5 — 计算每 feature 的 bdd_ids（权威 BDD 指针）

对每个 work-unit feature：`bdd_ids` = 并入本 feature 的各 behavior feature 的所有 `scenarios[].id`，去重。**这是下游 impl / review / gate_review 的权威 BDD 指针——也是本蓝图唯一的需求溯源货币（无 FR / srs_trace）。**

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
- `bdd_ids`：Step 5 算出的去重场景 id，**非空**（每个 work-unit feature 至少覆盖一个场景；本蓝图无「纯内部无场景 feature」概念）。
- `priority`：取该组各 behavior feature `risk` 的最高映射（critical→high / normal→medium / trivial→low），或用户指定；默认 `"medium"`。
- `dependencies`：从输入文档显式依赖或用户指定推断；无则 `[]`（依赖只引用本 plan 内其它 feature 的语义顺序，下游 init 转 task id 时落实）。
- `description`：用户给出或从所覆盖 behavior feature 派生。
- **无 `srs_trace` 字段**（本蓝图无 FR-id）。

## Step 7 — 自检后推进

落盘后自检（下游 gate_decompose 会硬门复核同样几条）：
- `bdd.json` 每个场景至少被一个 feature 的 `bdd_ids` 认领，且无 ghost id（不存在的场景 id）；
- 每个 feature 的 `bdd_ids` 非空；
- 无过度碎片化（薄 feature 已按 S5 聚合）。（投影超窗只是告警、不阻断。）

自检通过 → {{ADVANCE_OK}}。
输入文档缺失/不可读无法分组 → {{ADVANCE_BLOCKED notes=<原因>}}。

bp-advance 是本回合最后一个动作，调用后立即结束本回合。

## 反模式

| 合理化 | 正确回应 |
|--------|---------|
| "给 feature 加个 srs_trace 才完整" | 本蓝图无 SRS / FR-id。work-unit feature 靠 `bdd_ids` 锚定覆盖的场景，srs_trace 是不存在的概念。 |
| "一个 behavior feature 一个 work-unit" | 同源薄 feature 会引发场景碎片化 + 浪费每会话固定开销，gate_decompose 会打回按 S5 聚合。 |
| "凑满窗口，把不相关 behavior 也并进来" | 伤内聚、加跨节点漂移；只在共享接口/角色/实体的内聚边界内合并。 |
| "校准没测到就不管预算" | unmeasured 时用策略默认 perScenarioTokens 照常按预算分组，别退回拍脑袋。 |
| "顺手把 items[] 灌进 loop" | 灌 loop 是 init 的职责；本节点只产出 feature-plan.json。 |
