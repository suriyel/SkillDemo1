---
name: init
description: "当 BDD 已批准、feature-plan.json 已过 gate_decompose、items 未生成时使用 — 从 feature-plan.json 机械生成任务列表并灌入 iter loop。本蓝图无 SRS / Design：tech_stack 由 scan 推断或一次 AskUserQuestion，task 携 bdd_ids（无 srs_trace）。"
---

**语言规则**：你必须用中文（简体）回复用户。所有生成的文档、报告和面向用户的输出必须用中文编写。Skill 名称、代码标识符和 JSON 字段名保持英文。

# 初始化 Long-Task-Simple 项目

在 BDD 批准、decompose 分组（feature-plan.json 过 gate_decompose）后运行一次。从 feature-plan.json 机械生成 task[]（分组与预算已在 decompose 锁定），为迭代 Worker 周期做准备。**本蓝图无 SRS / Design 文档**。

## 输入文档

此 skill 从下列产物读取（**无 srs.md / design.md**）：

| 文档 | 位置 | 提供内容 |
|------|------|---------|
| **Feature 计划** | `{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json` | 上游 decompose 产出、已过 gate_decompose 的权威 work-unit feature 分组（每 feature 含 `bdd_ids` / `priority` / `dependencies` / `title` / `description`；**无 srs_trace**）；本节点据此**机械填充** items[]，不重做分组 |
| **BDD 用例** | `{{HARNESS_MEMORY_DIR}}/plans/bdd.json` | 行为场景（`features[].scenarios[].id` = `BDD-xxx`，每条带 given/when/then/examples）；verification_steps 从对应场景 then 派生 |
| **用户输入文档** | `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`（+ `user-original-intent.md`） | 用户原话；提取项目级约束/假设、背景对齐 |
| **存量约定** | `{{HARNESS_MEMORY_DIR}}/notes/rules/`（若存在） | scan 节点提取的构建/测试/编码约定；tech_stack 与 tool-commands-guide 的首要来源 |

## 检查清单

你必须为每步创建 TodoWrite 任务并按顺序完成：

1. **阅读输入产物**
   - Feature 计划：`{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json` — work-unit feature 分组，第 4 步据此机械填充 items[]
   - BDD 用例：`{{HARNESS_MEMORY_DIR}}/plans/bdd.json` — 行为场景（`BDD-xxx`），verification_steps 来源
   - 用户输入文档：`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md` — 项目级约束/假设、背景对齐
   - 存量约定：`{{HARNESS_MEMORY_DIR}}/notes/rules/`（若存在）— 构建/测试/编码约定

2. **确定 `tech_stack`**（本蓝图无 design.md，按下列优先级取，确定不了就问用户）：
   - **① scan 约定**：若 `{{HARNESS_MEMORY_DIR}}/notes/rules/build-and-compilation.md` 存在，从中提取 `language` / `test_framework` / `coverage_tool`（构建系统、包管理器、测试命令）。
   - **② 项目根清单**：否则从项目根的 `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml` / `Makefile` 等推断语言与测试框架。
   - **③ 问用户**：若 ①② 都推断不出（典型 greenfield 空目录）→ 用**一次 `AskUserQuestion`** 让用户指定 `language` + `test_framework`（必要时 `coverage_tool`）。
   - 把确定的 `tech_stack` 写入每个 item 的 `tech_stack` 字段，并传给第「生成公共上下文 md」步的脚本。

3. **生成工具命令指南** → `{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md`：

   a. **收集配置来源**（优先级顺序）：
      - `{{HARNESS_MEMORY_DIR}}/notes/rules/build-and-compilation.md`（若存在）— 提取构建命令、测试命令、包管理器
      - 项目根的 build / test 命令清单（来自 `package.json` / `pyproject.toml` / `Cargo.toml` / `Makefile` / `pom.xml` 等）
      - 若 ①② 均无（greenfield）→ 按第 2 步确定的 tech_stack 用该语言/框架的标准命令兜底
   b. **指南内容 — 包含以下章节（第 4 章 Service Lifecycle 仅当 product_type 含长驻服务，如 network-service/webapp/daemon；CLI/library 跳过该章）**：
      1. **Test Commands** — quiet 模式（仅出 PASS/FAIL）+ detail 模式（含 traceback）+ 完整测试命令
      2. **UT Style** — 项目特定的 UT 约定：UT + mock 框架（从依赖清单 / 配置文件检测）、mock 风格、**固定约定**（编写前探索现有测试 + 源码、复用 fixture）；若 `coding-constraints.md` 存在用扫描值覆盖
      3. **Caveats** — 项目特定的工具注意事项（**LLM 探查生成，非模板**）：读项目实际配置回答各维度；仅写有实际发现的条目（3-10 条，每条 ≤1 行 `- [类别] 发现 → 结论`）；重点 **必须参数** / **工具冲突** / **项目已有选择**
      4. **Service Lifecycle / 重启协议**（仅 product_type 含长驻服务；CLI/library 跳过）—— 探查实际启停方式后写：**启动命令** + 日志捕获 + **健康检查**；**停止命令**（PID 优先、端口 fallback、跨平台）；**验证已停/已活**；**4 步重启协议**：① Kill 停全部 → ② Verify dead（轮询 ≤5s）→ ③ 用**最新源码 Rebuild + Start** + 捕获输出 + 记 PID/端口 → ④ Verify alive（轮询 ≤10s）。**下游 st 在验收/重对账前、及每次代码改动后必走此协议**——从根上杜绝陈旧产物 / 残留进程干扰。
   c. **不要包含**：实现工作流、验证规则、关键规则、静态分析、persist 步骤 — 这些在下游节点 SKILL.md 里
   d. **自检**：手动确认各章节完整（有长驻服务则含 Service Lifecycle 的 4 步协议 + 跨平台杀进程命令）、Caveats ≤ 10 条、无空章节

4. **从 feature-plan.json 机械填充 `items[]`** — 分组与预算判定已在上游 `decompose` 完成、并过 `gate_decompose` 硬门；本步**只做转写**，不重做分组、不读 split-strategy.json、不算 bdd_ids、不跑 _context-budget.cjs。

   a. **读分组方案**：Read `{{HARNESS_MEMORY_DIR}}/plans/feature-plan.json`，取 `features[]`。
   b. **1:1 转写**：每个 feature 转为一个 item：
      - `bdd_ids` / `title` / `description` / `priority`（缺省 `"medium"`）**原样**取自 feature；**`bdd_ids` 是 impl / review / gate_review 的权威 BDD 指针**（decompose 已算、gate_decompose 已校验）。**无 `srs_trace` 字段**（本蓝图无 FR-id）。
      - `id`：顺序唯一整数（1, 2, 3…）。
      - `status`：始终 `"failing"`。
      - `category`：派生非空（如 `core` / `support`；gate_init REQUIRED_FIELDS 要求非空）。
      - `risk`（可选）：取该 feature 所覆盖 BDD feature 的最高 risk（供下游分层判定）。
      - `dependencies`：把 `feature.dependencies` 里引用的前序 feature 映射为对应 item 的 `id`；无则空数组。
      - `verification_steps`（可选）：把本 task 的 `bdd_ids` 对应 `bdd.json` 场景的 given/when/then 整合为行为场景：
        - 每步必须是含 Given/When/Then 结构的行为场景，非简单断言。
        - 错误：`"Login page displays correctly"`（无动作、无断言）。
        - 正确：`"Given a registered user, when POST /api/orders with valid payload, then response 201 with order ID; and GET /api/orders/{id} returns the created order with correct fields"`。
        - 对有后端依赖的功能：至少一步必须验证跨依赖边界的真实数据流。
        - **最低复杂度**：每个功能应有 ≥ 1 个含 3+ 链式操作的 verification_step。
      - **排序**：按 feature-plan.json 中 features 的顺序；每个功能必须可独立验证且在一个会话内完成。
   c. **单轮标志传播 + 单轮铁律**：读 `feature-plan.json` 顶层 `single_round`（decompose 据预算判定写入）。为 true 时即单轮模式——feature-plan.json 仅含一个 feature → 本步**恒只产出一个 task**、iter 一轮做完；把该值写到该 item 的 `single_round` 字段。**铁律**：单轮下无论收到任何下游 gate 打回（含预算超窗提示），都**不得**把这唯一 feature 拆成多 task；若确需多 task，须回 `decompose` 关闭单轮，而非在此自行拆分。
   d. **轻量自检**（权威颗粒度校验在上游 gate_decompose、转写正确性在下游 gate_init 兜底）：id 唯一、title/description 非空、priority/status 合法枚举、feature-plan.json 中每个 feature 都转写为了一个 item（无遗漏）。

## 任务结构


<!-- tasks-schema: default -->
### Tasks schema "default" — items[] for `bp-tasks set iter`

```json
// items[] 结构（注释即字段语义）
[
  {
    "id": 1, // L1 必填: string | number
    "status": "failing", // L1 必填: string; default "failing"; doneValues=["passing"] 时该 task 视为完成
    "dependencies": [], // L1 必填: array; items: string | number; default []
    "title": "登录表单组件", // L2 optional: string
    "description": "邮箱 + 密码字段、必填校验、submit 触发回调", // L2 optional: string
    "priority": "high", // L2 optional: string; enum=["high","medium","low"]
    "category": "core", // L3 optional: string
    "risk": "critical", // L3 optional: string; enum=["critical","normal","trivial"]
    "bdd_ids": ["BDD-001","BDD-007"], // L3 optional: array; 原样取自 feature-plan.json 该 feature 的 bdd_ids（权威 BDD 指针；本蓝图唯一溯源货币，无 srs_trace）
    "verification_steps": ["页面渲染表单","空提交报错","成功 submit 调回调"], // L3 optional: array
    "tech_stack": {}, // L3 optional: object
    "single_round": false // L3 optional: boolean
  }
]
```

## ⚠️ 灌入 `iter` loop（必须执行，否则 run 卡死）

**漏调后果**：下游 `iter` loop 入口检测 `state.loops.iter.tasks` 为空 → halt（reason: `loop_no_tasks_seeded`）。

**步骤**：
1. 根据上面 schema 结构和你的分析结果，构造 items JSON 数组（每条 task 的 id 必须唯一）
2. **在 `bp-advance` 之前**执行以下命令将 items JSON 直接灌入引擎 state：

{{TASKS_SET loop=iter file=.harness/blueprint/tasks/iter.json}}

> 未声明字段透传，body skill 可用 `{{loop.task.<field>}}` 引用。




## 生成公共上下文 md

把项目级约束 / 假设写到两个临时 JSON 数组文件，然后调脚本生成 `project-context.md`（**本蓝图无 SRS**，约束/假设来源 = scan 存量约定 + 用户输入文档明示项；无则空数组）：

1. Write `{{HARNESS_MEMORY_DIR}}/plans/_constraints.json`，纯字符串数组（取自 `notes/rules/coding-constraints.md` 与 `original-requirements.md` 中明示的硬约束；无则 `[]`）：
   ```json
   ["<约束文本>", "..."]
   ```
2. Write `{{HARNESS_MEMORY_DIR}}/plans/_assumptions.json`，同样字符串数组（取自输入文档中的假设/默认值；无则 `[]`）：
   ```json
   ["<假设文本>", "..."]
   ```
3. 调脚本（`--lang` 命中 preset 时自动填工具默认值，显式 flag 覆盖；语言/框架用第 2 步确定的 tech_stack）：
   ```bash
   node {{SCRIPTS}}/init_project.cjs "<project-name>" \
     --memory-dir={{HARNESS_MEMORY_DIR}} \
     --lang=<python|java|javascript|typescript|c|cpp> \
     --test-framework=<...> --coverage-tool=<...> \
     --constraints-file={{HARNESS_MEMORY_DIR}}/plans/_constraints.json \
     --assumptions-file={{HARNESS_MEMORY_DIR}}/plans/_assumptions.json
   ```
4. 产出：`{{HARNESS_MEMORY_DIR}}/plans/project-context.md`（下游 impl / review / gate_review / st 读取的**权威源**：tech_stack 与项目级 constraints / assumptions 均以此为准；task 对象不再单独承载约束/假设）
