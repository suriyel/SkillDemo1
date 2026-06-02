# Blueprint: long-task-simple

`long-task-lite` 的极简变体：**去 SRS / Design / wd 特性设计文档，唯一权威需求源 = 用户输入文档（`original-requirements.md`）**。
`bdd` 节点取代 `req`，据用户输入文档产出 BDD 可执行规约（`bdd.json`）**作为对抗验证 oracle**（非实现依据）。**实现权威是需求文档**：decompose 按需求切 work-unit、每 task 带需求锚点 `req_refs`（impl 据此读原文实现）；`BDD-xxx` 场景 id 是下游验证（ut/review/gate_review/st）的溯源货币（无 FR-id / `srs.md` / `design.md`）。

## 节点拓扑

```
scan → bdd → gate_bdd → decompose → gate_decompose → init → gate_init
  → iter[loop, 50 次]：impl → ut → review → gate_review
  → st → gate_st
```

相对 lite 删除：`req` / `gate_srs`（SRS）、`design` / `gate_design`（Design）、`calibrate`、`wd`（特性设计文档）、`finalize_polish`。

## 各阶段

- **scan** — 代码库约定扫描（brownfield），产 `notes/rules/`
- **bdd** — 读用户输入文档（`intent/user-original-intent.md` + 会话粘贴 + scan 约定）→ 枚举可观察行为 → `bdd.json`（feature 分组 + 场景 + `derivation` 溯源到输入文档行号）。缺口走 bdd 内 `AskUserQuestion` 即时澄清（无 req 可打回）
- **gate_bdd** — BDD 规范性硬门（schema + 场景密度 + derivation 非空；不要求 `feature.fr`）
- **decompose / gate_decompose** — **按用户需求切** work-unit（`feature-plan.json` 带 `req_refs` = 需求锚点 + `bdd_ids` = 映射的验证场景，无 `srs_trace`），按预算控大小；硬门校验 `req_refs` 非空+锚点 + BDD 全覆盖 + 预算 + 过度碎片化
- **init / gate_init** — 生成带 `req_refs` + `bdd_ids` 的 task；`tech_stack` 由 scan 推断或一次 `AskUserQuestion`；`project-context.md` 由输入文档 + scan 生成
- **iter[impl → ut → review → gate_review]** — 见下
- **st / gate_st** — 全部 BDD 场景在真实集成环境逐条 replay + 对账硬门（去 NFR/L3 签收）

## iter 内「实现/测试双作者 + 双层质量保障」

iter 内每个 task 走 **impl → ut → review → gate_review** 四节点（无 wd 文档）：

- **impl** — 以**用户需求文档**为权威、按 `task.req_refs` 必读，**只写实现、不写测试**，不读 `bdd.json`（BDD 漏的需求 impl 会跟着漏——按需求实现才忠实）
- **ut** — 据 `bdd.json` 按 `task.bdd_ids` **独立写对抗测试**（逐 BDD-id 打标，断言 `then`/`examples` 的精确可观察值）；实现/测试双作者，让测试成为独立对抗面而非代码作者自证；**ut 不改实现**，红测试是实现缺口的信号
- **review** — LLM 对抗审查者（**主观挑刺**），用 sub-agent **并行**按 `task.bdd_ids` 分块核 impl 行为与 ut 测试是否忠实 BDD，**汇总**产出 `.harness/memory/notes/feature-<id>-review-r<N>.md`
- **gate_review** — 脚本机检硬门（**客观事实兜底**），真跑测试 + grep BDD id 覆盖 + 断言深度 + then 精确值命中（测试由独立 ut 写，机检合法、保留牙齿）

**review 与 gate_review 互补不替代**：review 看语义，gate_review 看事实。失败按归类折返：**test 维**（漏标记/浅断言/错 observable/mock）→ `ut` 修测试；**impl 维**（行为不符 then/边界违约）→ `impl` 修实现；并存 impl 优先。

## 文件清单

- `blueprint.json` — DAG topology（schemaVersion 3）
- `meta.json` — skill provenance（`bp-long-task-simple/*` 命名空间）
- `skills/<name>/SKILL.md` — 14 个 skill（scan/bdd/gate_bdd/decompose/gate_decompose/init/gate_init/impl/ut/review/gate_review/st/gate_st/explore-guide）
- `shared-scripts/` — 共享脚本（gate_bdd/decompose/init/review/st 已 fork 掉 SRS/design 依赖）
- `shared-reference/` — 跨 skill 共享参考文档

Run via the harness UI (🗺️ 蓝图 panel) or the `/_blueprint/*` HTTP API.
