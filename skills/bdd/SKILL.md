---
name: bdd
description: "long-task-simple 的需求规约节点（取代 req）：直接据用户输入文档产出结构化 BDD 可执行规约（bdd.json：按 feature 分组、每场景含 given/when/then/examples/derivation；FIRST 原则、聚焦关键功能点、含多域组合场景），用输入/验证反推完备性；缺口当场用 AskUserQuestion 向用户澄清（无 SRS、无 req 可打回），完备后交人评审。下游有 gate_bdd 硬门校验产物规范性。BDD-xxx 场景 id 是全程唯一溯源货币。"
---

**语言规则**：用中文（简体）回复用户。用例的描述文本（feature/scenario 名、given/when/then/examples 的值、报告与面向用户的输出）用中文；**JSON 字段名（key）、代码标识符、`BDD-xxx` 编号保持英文**。

# 用户输入 → BDD 可执行规约

输入：**用户输入文档**（启动原话 `{{HARNESS_MEMORY_DIR}}/intent/user-original-intent.md` + 本会话粘贴/上传的需求文档）+ scan 节点产出的存量约定 + 存量代码库。
动作：把用户输入文档的关键功能点直接翻成可执行行为规约（BDD 场景，Gherkin 语义），落成**结构化 JSON**（`{{HARNESS_MEMORY_DIR}}/plans/bdd.json`，便于下游 `gate_bdd` 硬门机器校验规范性）；在「写得出 / 写不出 given-when-then」的过程中反推完备性——能写全的留作评审产物，写不全的（不明确 / 未提及的场景）**当场用 `AskUserQuestion` 向用户澄清**（本蓝图无 SRS、无独立 req 节点可打回）。

> **本蓝图无 SRS / Design**。用户输入文档即唯一权威需求源；BDD 场景即可执行规约；`BDD-xxx` 场景 id 是 decompose / init / impl / gate_review / st 全程的唯一溯源货币（无 `FR-xxx`）。

<HARD-GATE>
BDD 描述的是「系统应当表现出的可观察行为（WHAT/行为）」，不是「如何实现（HOW）」。**禁止读取或依赖任何设计/实现层文档**（即便因重跑 / brownfield 残留而存在）。唯一允许的需求来源：用户输入文档 + `notes/rules/`（scan 存量约定）+ 存量代码既定行为。
在向用户呈现并取得评审批准之前（Step 6），不得调用任何实现 skill、编写任何代码。
</HARD-GATE>

## Step 0 — 重跑去重（gate_bdd 打回回流）

本节点可能被下游 `gate_bdd` 因「规范性不达标」打回重跑（无 req 节点，故不存在需求侧打回回流）。

1. 运行 {{TICKETS_GET}} —— 枚举指向本节点的历史打回单（多来自 gate_bdd），把曾提出的整改点汇成参考。
2. 若 `{{HARNESS_MEMORY_DIR}}/plans/bdd.json` 已存在（上一轮产物），Read 它，把已写好的用例作为本轮基线（**增量更新，不推倒重写**）。**已存在场景的 `id` 原样保留、不得重新编号**（下游测试已按 id 打标），仅给本轮新增场景续号。被 gate_bdd 打回时，重点按其 message 修正 JSON 结构/字段。基线中若有旧场景尚无 `derivation`，须为其逐条补写推导链（缺失会被 gate_bdd 打回）。
3. 无任何 ticket 且无旧 bdd.json → 本轮为首次执行，照常往下。

## Step 1 — 落盘权威原文 + 读输入

1. Read `{{HARNESS_MEMORY_DIR}}/intent/user-original-intent.md`（启动原话）。
2. 收集用户在**本会话内粘贴 / 上传**的需求文档。
3. **Write `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`**：把启动原话 + 各会话粘贴文档**逐字**合并落盘，每个来源前加一行 `## 来源: <start-prompt | 会话粘贴-1 | …>`，正文一字不改。这是 BDD 场景 `derivation` 溯源的**行号锚地基**（`derivation` 引用 `original-requirements.md L<起>-L<止>`）。仅有启动原话时照样落盘（单一来源段）。
4. 逐段标注输入文档：哪些是目标声明、哪些是行为规约、哪些是约束、哪些是实现偏好。**后续所有「原文」引用与行号均以 `original-requirements.md` 为准。**
5. 检查 `{{HARNESS_MEMORY_DIR}}/notes/rules/`（若存在）：scan 节点提取的存量代码库约定，作为「存量系统已确立行为」的依据。

## Step 2 — 存量交互探索（理清与存量系统的交互关系）

目的：① 为「多域组合用例」提供新需求 ↔ 存量模块的真实交互面；② 完备性自补背景——很多看似「需求没说」的行为，其实存量系统已有既定规则，**先自解、不打扰用户**。

1. 先复用已有产物（不重复扫描）：Read `{{HARNESS_MEMORY_DIR}}/plans/codebase-scan.md` 与 `{{HARNESS_MEMORY_DIR}}/notes/codebase-research.md`（若存在）。
2. 若上述产物未覆盖本需求触及的交互面（典型：新能力要调用 / 修改 / 依赖某存量模块、复用既有鉴权 / 数据 / 配置通道），则做**针对性补充探索**（非阻塞）：

   加载并执行技能 explore-guide，按其流程顺序执行探索阶段（结构扫描 → 维度分析 → 综合 → 输出）。

   参数：
   - Depth: {省略，让 LOC 自检}
   - Focus: `domain,architecture,integration`（交互/集成视角——重点找新需求与存量模块的调用边界、共享状态、契约）
   - Path: {从用户输入推导的存量子树或 "."}
   - User question: "为给用户需求写 BDD 行为用例，识别这些需求与存量系统的交互点（被调用 / 调用方、共享数据与状态、既有错误处理与默认值），以及输入文档假定但代码实际可能不同的行为。"
   - output_path: `{{HARNESS_MEMORY_DIR}}/notes/bdd-interaction-research.md`
   - rules_dir: `{{HARNESS_MEMORY_DIR}}/notes/rules/`
   - report_template: `{{SHARE-REFERENCE}}/explore-report-template.md`

3. 产出（内部态）：**交互面清单** —— 每条记 `{新需求 → 存量符号 file:line → 交互方式（调用 / 被调 / 共享状态 / 复用契约）→ 存量既定行为（默认值 / 错误处理 / 边界）}`。
4. BLOCKED / 无有用结果 → 静默跳过，仍照常进入 Step 3（此步非阻塞）；但 Step 4 不得把「本可由探索澄清却因跳过而未澄清」的项当作缺口去打扰用户。

## Step 3 — 生成 BDD 用例 JSON（聚焦关键功能点）

按下述 **JSON schema** 与原则，把用户输入文档的关键功能点写成结构化 BDD 用例，落 `{{HARNESS_MEMORY_DIR}}/plans/bdd.json`。**按 feature 分组**（= 需求单元），每个 scenario 承载 Gherkin 语义（given/when/then）+ 具体取值（examples）。

### 3.1 JSON Schema（严格遵循 — gate_bdd 据此校验规范性）

```json
{
  "features": [
    {
      "feature": "<一个能力 / 一组强相关能力的名称（= 需求单元）>",
      "risk": "critical",
      "scenarios": [
        {
          "id": "BDD-001",
          "risk": "critical",
          "scenario": "<一个具体、可判定的行为场景名>",
          "given": ["<前置状态 / 已有数据 — 完整到可复现>"],
          "when": ["<触发的单一事件 / 操作>"],
          "then": ["<可观察、可判定的预期结果（断言）>"],
          "derivation": ["<推导链：引用支配本场景的明文规则——`original-requirements.md L<起>-L<止> |「逐字原文」`（连同关键取值），或 scan 存量约定 file:line；从 given 初态出发依次施加 when 每一步算出结果；断言该结果 == then>"],
          "examples": ["<具体取值：输入 → 预期>", "<另一组：输入 → 预期>"]
        },
        {
          "id": "BDD-002",
          "scenario": "<跨域组合场景：与存量模块交互>",
          "cross_domain": "<存量符号，形如 模块名 @ src/foo.js:42>",
          "given": ["<存量侧状态>"],
          "when": ["<触发新行为>"],
          "then": ["<新需求结果 + 对存量状态的影响>"],
          "derivation": ["<推导链：引用规则（含取值）→ 从存量侧 given 施加 when → 推出新需求结果及对存量状态的影响 == then>"],
          "examples": ["<输入 → 预期>"]
        },
        {
          "id": "BDD-003",
          "kind": "negative",
          "scenario": "<异常/边界/错误场景：非法输入被拒 / 越界 / 依赖失败 / 错误恢复>",
          "given": ["<前置>"],
          "when": ["<触发非法或边界条件>"],
          "then": ["<明确的拒绝 / 报错 / 边界停止 结果断言>"],
          "derivation": ["<推导链：非法/边界输入命中输入文档/scan 约定的拒绝或边界规则 → 系统拒绝并报错 E（或在边界停止）；故 then 断言该拒绝/边界结果>"],
          "examples": ["<非法或边界输入 → 预期错误或边界结果>"]
        }
      ]
    }
  ],
  "clarifications": ["<能力/场景>: <缺什么> — <为何写不出 given/then>"]
}
```

**字段硬规则（gate_bdd 逐条校验，违反即打回 bdd 重出）**：
- 合法 JSON、顶层对象；`features` 非空数组；`clarifications` 为字符串数组（无缺口则 `[]`）。
- 每个 feature：`feature` 非空字符串；`scenarios` 非空数组；**`risk` 必填**，取值 `critical | normal | trivial`（判定依据见 `{{SHARE-REFERENCE}}/risk-tagging-guide.md`）。**无 `fr` 字段**——本蓝图无 SRS / FR-id，feature 自身即需求单元。
- 每个 scenario：`id` 非空且匹配 `^BDD-\d+$`、**全局唯一**（跨 feature 也不重号）；`scenario` 非空字符串；`given` / `when` / `then` / `examples` 均为**非空字符串数组**；`risk` 可选（缺省继承所属 feature；可显式覆盖）。
- 每个 scenario 还须含 `derivation`：**非空字符串数组**，逐步推导链——引用支配本场景状态变化的明文规则（`original-requirements.md L<起>-L<止>` + 逐字原文与关键取值，或 scan 存量约定及其 `file:line`），从 `given` 出发依次施加 `when` 推出结果，并断言该结果 == `then`。gate_bdd 硬校验其存在且非空（缺失/为空即打回 bdd）；脚本不验推导对错（由 gate_bdd 的 LLM 复核照 `derivation` 核对）。
- `cross_domain` 可选；若存在须为非空字符串（形如 `"模块名 @ src/foo.js:42"`）。
- `kind` 可选（`happy` | `negative` | `boundary` | `error`）；缺省视为 `happy`，**只需给异常类场景标注**（happy 可不标）。标错值仅告警。
- **场景密度按 feature.risk 分层**（gate_bdd 硬门校验，堵「关键场景与琐碎场景一样深度」）：
  - `risk=critical` 的 feature：必须 ≥1 happy + ≥2 异常类（negative / boundary / error）；**确无异常路径的不可豁免**——critical 业务无异常路径意味着没识别透，当场向用户追问 negative 行为
  - `risk=normal` 的 feature：≥1 happy + ≥1 异常类；纯只读查询可加 `"no_negative_rationale": "<理由>"` 豁免
  - `risk=trivial` 的 feature：≥1 happy 即可，异常类可豁免
- **不得为绕门硬编无意义场景**。

> **场景 `id` 是下游唯一追溯锚点**：decompose 据此把场景分组成 feature、init 写入 `task.bdd_ids`、impl 用该 id 给对应单元测试打标，环内 `gate_review` 与末段 `gate_st` 据此机检「每个场景都有测试覆盖 / 都被对账」。故 **id 一旦分配不得变动**——重跑（被 gate_bdd 打回）时保留既有场景 id，只给本轮新增场景续号。

### 3.2 FIRST 原则（适配 BDD 场景质量）

| 字母 | 含义 | 本场景必须满足 |
|---|---|---|
| **F** | Focused 聚焦 | 只为**关键功能点**写用例。不堆砌穷举、不为 trivial 项单列场景。 |
| **I** | Independent 独立 | 每个 scenario 自洽，不依赖其他 scenario 的顺序或残留；`given` 自带全部前置。 |
| **R** | Repeatable 可复现 | `given` 设全前置、结果**确定**，不依赖隐含环境 / 时钟 / 随机；`examples` 给确定的输入→预期。 |
| **S** | Self-validating 自验证 | `then` 是**明确二元断言**（可判定通过/失败），不写「应该正常工作」这类模糊措辞。 |
| **T** | Traceable 可追溯 | 每个 scenario 的 `derivation` 引用 `original-requirements.md` 行号 / scan 约定，形成**输入文档→用例**映射（取代 SRS 的 FR 溯源）。 |

### 3.3 组织方式：按「能力 → 用例」

- 以用户输入文档的能力点为骨架：每个关键能力（或一组强相关能力）一个 feature 条目，`risk` 标注其业务等级（判定依据见 `{{SHARE-REFERENCE}}/risk-tagging-guide.md`）。
- 每个 feature 至少覆盖：**正常路径** + 关键**异常/边界路径**（错误处理、约束触发、接口失败），各用一个 scenario 表达。异常类场景标 `kind`（negative/boundary/error），happy 可不标。
- **gate_bdd 按 feature.risk 分层校验场景密度**：critical → ≥1 happy + ≥2 异常类（无豁免）；normal → ≥1 happy + ≥1 异常类（纯只读可 `no_negative_rationale` 豁免）；trivial → ≥1 happy 即可。
- `examples` 每条给一组具体取值「输入 → 预期」，让验收无歧义；同一行为的多组数据并列多条 example 字符串。

### 3.4 多域间组合用例（强制）

依据 Step 2 的交互面清单，在所属 feature 内产出**跨越「新需求 ↔ 存量模块」边界**的 scenario（置 `cross_domain` 字段标存量符号）：

- 新能力调用 / 依赖存量模块时：`given` 设存量侧状态，`when` 触发新行为，`then` 同时断言**新需求结果 + 对存量状态的影响**（双侧验证）。
- 复用既有通道（鉴权 / 数据 / 配置 / 事件）时：写「契约被遵守」与「契约被违背时的失败行为」两类 scenario。
- `cross_domain` 填涉及的存量符号（`"模块名 @ file:line"`，非空）。
- 若本需求经 Step 2 确认**确无任何存量交互**（纯 greenfield 孤立功能），可不产出 cross_domain 场景——gate_bdd 对此仅告警不打回。

### 3.5 场景逻辑自洽自检 —— 落盘 `derivation` 推导链（强制）

自洽**不能靠「心里过一遍」打勾**——必须把推导**写进每个 scenario 的 `derivation` 字段**，让推导可见、可被 gate_bdd 照着复核。每个场景落盘前执行三步：

1. **锚定规则**：找出支配本场景状态变化的明文规则——用户输入文档某段（`original-requirements.md L<起>-L<止>`，连同其**关键取值**，如「字段 X 在条件 C 下 → 取值 V」，逐字引用原文），或 scan 节点登记的存量约定（含 `file:line`）。把规则与其取值**原样**记入 `derivation`，不要只写来源。
2. **逐步推演**：从 `given` 初态出发，**依次**施加 `when` 的每一步，按上面的规则算出每一步后的具体状态/结果（多步场景逐步写出中间态）。把这条「初态 → 施加操作 → 推出结果」的链写进 `derivation`。
3. **断言一致**：确认推导出的最终结果与 `then` 写的断言**逐字段一致**。一旦推导值与 `then` 不符（典型：`then` 改动了与 `given`/规则不相干的维度），即为场景自相矛盾。

发现矛盾的处置：

- **能在规则下修正**的 → 改写 `then`/`given`/`when` 或拆分场景，使 `derivation` 自洽。**`then` 必须等于推导值，不得反过来编一个「恰好成立」的推导去迁就错误的 `then`**。
- **因输入文档规则缺失/含糊而无法推导**的 → 不臆造规则，按 Step 4 当场向用户澄清。

> `derivation` 不是注释，是「证明」。写不出某场景的 `derivation`，等于该场景在现有规则下不可判定——要么修正、要么澄清，**绝不落盘一个无法推导的 scenario**。下游 gate_bdd 会照着 `derivation` 复核：推导造假 / 与规则取值不符同样会被打回。

## Step 4 — 完备性反推（用输入/验证倒逼）

写用例的过程本身就是完备性探针。对每个能力，逐一尝试写出 given / when / then / examples。**写不下去的地方就是需求缺口**，归两类：

- **(A) 不明确场景**：输入文档提到了，但**输入取值范围 / 默认值 / 触发条件 / 预期结果 / 错误处理**未定，导致 given/then/examples 无法写成确定断言。
- **(B) 未提及场景**：从用户原话或存量交互**显然应当存在**、但输入文档完全没写的行为（典型：并发/重复操作、越权、空/超限输入、存量契约冲突、回滚/补偿路径）。

**缺口过滤（顺序严格）**：

1. **先自解**：用 Step 2 的存量既定行为回填——若存量系统对该输入/边界已有确定规则（默认值 / 错误处理 / 约束），则**该 gap 视为已澄清**，在用例里按存量行为写 then，并在 examples 注明 `（沿用存量行为：file:line）`，**不打扰用户**。
2. **再去重**：剩余 gap 与历史 ticket 中已澄清过的项比对，已澄清的剔除。
3. **只留真缺口**：经 1、2 过滤后仍**不明确**的项，进 Step 5/6 当场用 `AskUserQuestion` 向用户澄清。

每条 gap 落成 `clarifications[]` 的一个字符串：`"<能力/场景>: <缺什么，具体到字段/边界/路径> — <为何写不出 given/then>"`。

## Step 5 — 落盘 + 交活前自检

把 Step 3 的 `features` + Step 4 过滤后的真缺口（`clarifications`，无缺口则 `[]`）组装成完整 JSON，写入 `{{HARNESS_MEMORY_DIR}}/plans/bdd.json`。务必是**合法 JSON**（无注释、无尾逗号、UTF-8）。先落盘，**进度不丢**。

**落盘后、收尾前过一遍自检（不通过就地补，别留给下游硬门打回）**：

1. **能力→场景覆盖矩阵**：逐 feature 列出其场景，按 `kind` 计数（happy / negative / boundary / error 各几条）。验证：每个 feature ≥1 条 happy；**每个 feature ≥1 条异常类**（negative/boundary/error），否则补一条或标 `no_negative_rationale`（critical 不可豁免）。
2. 每条 `then` 是明确二元断言（具体值 / 状态 / 错误码），无「应正常工作」类虚词。
3. **每条 scenario 含非空 `derivation`，且其推导值与 `then` 逐字段一致**（then 必由 derivation 推得，无凭空断言）。
4. 场景 `id` 全局唯一；重跑保留既有 id，仅给新增续号。
5. 合法 JSON（无注释 / 尾逗号）；**无 `fr` 字段残留**。

## Step 6 — 收尾（本回合最后一个动作）

依据 Step 4 结果分支：

- **有真缺口（待澄清清单非空）**→ 用 **AskUserQuestion**（≤4 问/轮）当场向用户澄清这些 gap；把答案**增量合并**进 `bdd.json` 对应 feature/场景（补 given/then、定死取值/默认值/错误处理、必要时新增 feature/场景并续号）；改完重跑本步自检。若一轮内仍有未答清的，继续追问，**直到无真缺口**——本蓝图无 req 节点，缺口在 bdd 内闭环解决，不打回。
- **无缺口（完备）**→ 用 **AskUserQuestion** 向用户呈现评审：JSON 对人不友好，呈现时**把 `bdd.json` 渲染成可读 Gherkin 文本**（按 feature 列出各 scenario 的 Given-When-Then + Examples 摘要）放进问题描述，请其评审。选项：**批准 / 指出需调整的场景 / 补充澄清后重审**：
  - 批准 → {{ADVANCE_OK artifact={{HARNESS_MEMORY_DIR}}/plans/bdd.json}}（随后进入 `gate_bdd` 规范性硬门）
  - 指出需调整 → 按反馈改 `bdd.json` 后重新呈现（不退出本回合）
  - 补充澄清后重审：若用户的补充暴露新缺口 → 追加澄清、合并进 bdd.json 后重新呈现
- **读不到用户输入文档 / 无法判定**（如 user-original-intent.md 缺失或不可读）→ {{ADVANCE_BLOCKED notes=<原因>}}

> **本节点只汇报 `ADVANCE_OK` 或 `ADVANCE_BLOCKED`，从不 `ADVANCE_FAIL`**：本蓝图无 req 可打回、引擎不允许 rewind 到自身，缺口一律在 bdd 内用 `AskUserQuestion` 闭环；若汇报 failed 会因无折返边而 halt（失败保险，非正常路径）。
> 不要臆测：必须真正读完输入文档、做完探索与完备性反推后再判定。
> 注意分工：本节点 ADVANCE_OK 后由 `gate_bdd` 机器校验 JSON **规范性**（结构/字段/examples 非空），若不规范会打回本节点修正——故 Step 5 落盘务必产出合法、字段齐全的 JSON。

## 反模式

| 合理化 | 正确回应 |
|--------|---------|
| "先写个 design 再补全场景" | HARD-GATE 禁止。BDD 只描述需求行为；缺的场景是需求 gap，当场问用户，不能私自设计填平。 |
| "给 feature 加个 fr 字段更规范" | 本蓝图无 SRS / FR-id。feature 自身即需求单元；溯源靠场景 `derivation` 引 `original-requirements.md` 行号。加 `fr` 反而引入不存在的 FR 概念。 |
| "把输入文档的句子直接抄成 then 就行" | 翻译式照搬不是行为用例。要写出可复现的 given + 可判定的 then + 具体 examples，照搬发现不了完备性缺口。 |
| "每个能力都写满 scenario" | 违反 F（聚焦）。只覆盖关键功能点 + 关键异常路径；trivial 项不单列。 |
| "存量没说清的也问用户" | 先做 Step 2 自解：存量已有既定行为的，按存量写 then 并标注来源，不打扰用户。 |
| "有缺口也先让用户评审完整版" | 有真缺口先用 AskUserQuestion 澄清并合并，再呈现评审，避免让用户反复审残缺产物。 |
| "then 写'应正常返回'即可" | 违反 S（自验证）。then 必须是明确二元断言（具体值 / 状态 / 错误码）。 |
| "examples 留空或写'见上'" | examples 每场景必填非空，给具体「输入 → 预期」取值；gate_bdd 校验非空，空则打回。 |
| "组合场景太麻烦，只写单域" | 多域组合是本节点核心价值之一。Step 3.4：有存量交互就必须产出带 cross_domain 的场景；仅纯 greenfield 无交互可豁免。 |
| "多步场景凭直觉写就行 / derivation 随便填一句" | 违反 Step 3.5。`derivation` 必须写出「引用规则(含取值)→从 given 逐步施加 when→推出结果==then」的真实推导链；推不通就改写或拆分，规则缺失则问用户。 |
| "then 先写好，derivation 凑一个能圆上的" | 反了。`derivation` 从 `given`+规则**正向**推，`then` 必须等于推导值。 |
