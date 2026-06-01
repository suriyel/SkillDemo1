# Blueprint: long-task-simple

`long-task-lite` 的极简变体：**去 SRS / Design / wd 特性设计文档，唯一需求源 = 用户输入文档**。
`bdd` 节点取代 `req`，直接据用户输入文档产出 BDD 可执行规约（`bdd.json`）。**`BDD-xxx` 场景 id 是全程唯一溯源货币**（无 FR-id / `srs.md` / `design.md`）。

## 节点拓扑

```
scan → bdd → gate_bdd → decompose → gate_decompose → init → gate_init
  → iter[loop, 50 次]：impl → review → gate_review
  → st → gate_st
```

相对 lite 删除：`req` / `gate_srs`（SRS）、`design` / `gate_design`（Design）、`calibrate`、`wd`（特性设计文档）、`finalize_polish`。

## 各阶段

- **scan** — 代码库约定扫描（brownfield），产 `notes/rules/`
- **bdd** — 读用户输入文档（`intent/user-original-intent.md` + 会话粘贴 + scan 约定）→ 枚举可观察行为 → `bdd.json`（feature 分组 + 场景 + `derivation` 溯源到输入文档行号）。缺口走 bdd 内 `AskUserQuestion` 即时澄清（无 req 可打回）
- **gate_bdd** — BDD 规范性硬门（schema + 场景密度 + derivation 非空；不要求 `feature.fr`）
- **decompose / gate_decompose** — 把 BDD feature/场景分组成 work-unit feature（`feature-plan.json` 带 `bdd_ids`，无 `srs_trace`），按预算贪心填充；硬门校验 BDD 全覆盖 + 预算 + 过度碎片化
- **init / gate_init** — 生成带 `bdd_ids` 的 task；`tech_stack` 由 scan 推断或一次 `AskUserQuestion`；`project-context.md` 由输入文档 + scan 生成
- **iter[impl → review → gate_review]** — 见下
- **st / gate_st** — 全部 BDD 场景在真实集成环境逐条 replay + 对账硬门（去 NFR/L3 签收）

## iter 内双层质量保障

iter 内每个 task 走 **impl → review → gate_review** 三节点（无 wd 文档）：

- **impl** — 直接据 `bdd.json` 按 `task.bdd_ids` 取的场景 + 用户输入文档写实现 + 配套测试（逐 BDD-id 打标，断言 `then`/`examples` 的精确可观察值）
- **review** — LLM 对抗审查者（**主观挑刺**），按 `task.bdd_ids` 逐条对照代码核 BDD 覆盖与断言深度，产出 `.harness/memory/notes/feature-<id>-review-r<N>.md`
- **gate_review** — 脚本机检硬门（**客观事实兜底**），真跑测试 + grep BDD id 覆盖 + 断言深度 + mock 可观察面

**review 与 gate_review 互补不替代**：review 看语义，gate_review 看事实。任一失败折返 `impl`（带报告路径 / 机检摘要）。

## 文件清单

- `blueprint.json` — DAG topology（schemaVersion 3）
- `meta.json` — skill provenance（`bp-long-task-simple/*` 命名空间）
- `skills/<name>/SKILL.md` — 13 个 skill（scan/bdd/gate_bdd/decompose/gate_decompose/init/gate_init/impl/review/gate_review/st/gate_st/explore-guide）
- `shared-scripts/` — 共享脚本（gate_bdd/decompose/init/review/st 已 fork 掉 SRS/design 依赖）
- `shared-reference/` — 跨 skill 共享参考文档

Run via the harness UI (🗺️ 蓝图 panel) or the `/_blueprint/*` HTTP API.
