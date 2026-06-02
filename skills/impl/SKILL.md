---
name: impl
description: "据用户需求文档（original-requirements.md，按 task.req_refs 定位）为当前 task 直接写实现代码，一次交付；第 2 轮起读上一轮 review 报告 + gate_review 失败摘要里的 impl 维项做定点修正。本节点只写实现、不写测试（测试由下游 ut 节点据 BDD 独立编写），不读 bdd.json。本蓝图无 wd 特性设计文档 / 无 design.md。"
---

# Direct Implementation（环内首节点）

为**当前任务**直接据**用户需求文档**一次性交付实现代码。本节点**只写实现、不写测试**——测试由下游 `ut` 节点据 `bdd.json` 独立编写（让测试成为独立对抗面，而非代码作者的自证）。下游 review（LLM 对抗审查）与 gate_review（脚本机检硬门）联合核验实现是否满足 BDD。

> **权威源 = 用户需求文档**。本蓝图无 SRS / design.md / wd；行为契约以 `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md` 原文为准。**impl 不读 `bdd.json`**——BDD 是下游验证的 oracle，让 impl 看它会把实现天花板压到 BDD 的离散场景上、漏掉散文需求里的隐含细节。

**开始时宣告**："I'm using the impl skill. Let me orient myself."

解析 `{{TASK_GET}}` 输出的 JSON，取 `task.id` / `task.title` / `task.description` / `task.req_refs[]` / 其他业务字段。loop 引擎已挑好当前任务，无需手动管理任务状态。

**静默执行协议**：每一次构建、编译、检查命令都重定向到 `/tmp/<slug>-$$.log` + exit 文件。永不向主 agent 倾倒完整输出；只在失败时摘 100 行尾部。

## 输入读取（单次全量 Read）

1. **行为权威唯一源 —— 用户需求文档**：`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`。**按 `task.req_refs[]` 定位本 task 负责的需求片段并逐段精读（必读）**：每项 req_ref 形如 `original-requirements.md L<起>-L<止> | <摘要>` 或 scan 约定 `file:line`。实现须**忠实于原文整体意图**（含散文里未被拆成离散条目的约束、默认值、边界、错误处理），不是只满足某几条显式断言。
2. **项目上下文**：`{{HARNESS_MEMORY_DIR}}/plans/project-context.md`（tech_stack / has_frontend_ui / 项目级约束 + 假设）。
3. **代码库约定**（如存在）：`{{HARNESS_MEMORY_DIR}}/notes/rules/*.md`、`{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md`（构建/编译命令、约定、重启协议）。
4. **不读**：`bdd.json`（BDD 是 ut/review/gate_review 的验证 oracle，不是 impl 的实现依据）；`task.bdd_ids` / `task.verification_steps`（BDD 派生，供下游验证，非本节点输入）。

## 轮次检测 — review 报告与 gate_review ticket 读取

本节点可能是第 1 轮（首次实现）也可能是第 N≥2 轮（上一轮的 **impl 维**缺口被 review 或 gate_review 打回到本节点）。**先确定身份再开干**：

1. **review 报告**：`ls -1 .harness/memory/notes/ 2>/dev/null | grep -E "^feature-${TASK_ID}-review-r[0-9]+\.md$"`，取序号最大那一份
   - 存在 → 上一轮 review 评审报告，**优先逐条修正其中 `failkind=impl` 的 Issue**（行为与需求不符、NPE/5xx、漏实现等），不重做已通过项
   - 报告里 `failkind=test` 的 Issue **不归本节点**——那是测试断错 observable / 测试浅，已由引擎折返到 `ut` 修测试；本节点**不为迁就测试去改正确的实现**
2. **gate_review ticket**：`{{TICKETS_GET}}` 取本 task 内最新的 open ticket；标题含「回 impl 修实现」（impl 维：测试不绿因实现行为错 / 边界契约违约）→ ticket notes 内有「机检失败项摘要」，**与 review 报告并列作为本轮修正源**
   - 标题含「回 ut」的 ticket 不归本节点
3. 两者都不存在 → 第 1 轮，按需求文档从零实现

## 强制接地存量代码

- `git status --porcelain` 取「已开发文件」清单
- 按需求涉及的领域实体 locate 真实实现；brownfield 复用既有接口/数据/配置通道
- **禁止静默 mock 内部模块**：被消费的真实接口绑定真实实现；找不到且 Provider 待实现 → 起最小 stub 加 TODO，但产出可观察行为的真实模块绝不可被整模块顶替（下游 ut 会以真实可观察面写测试，桩掉它会让测试无从落地）

## 直接实现一次到位（据需求文档）

逐条 `task.req_refs[]` 把需求片段翻成实现：

1. **按需求原文建/改所需的数据结构、流程与状态**，让系统表现出原文描述的行为；落实原文给出的取值（默认值、范围、枚举、错误处理、边界）。
2. **整体意图对齐**：需求文档没显式列成条目、但从上下文显然成立的约束/默认/异常路径，也要实现到位——这正是「走 skill 比直接 prompt 漏得多」要堵的缺口。
3. **遵守 project-context 约束/假设 + scan 约定**：强制内部库、命名、错误处理模式按 `notes/rules/*.md` 与 project-context `## Constraints` 落实。
4. **跨域**：实现要真实贯通新行为与存量模块的边界（新结果 + 对存量状态的影响）。
5. **本节点不写测试**：不要写单测/集成测试，不要给代码打 `# BDD-xxx` 标记——那是下游 `ut` 节点的职责。

## 第 2 轮起 — 按 review 报告 + gate_review ticket 的 impl 维项定点修正

读取上一轮 review 报告的 "## 问题清单" 中 `failkind=impl` 项 + gate_review ticket notes 的「机检失败项（impl 维）」：

1. **合并去重**两者 Issue，按 file:line 排序
2. **只改实现，不碰测试**：
   - 行为与需求不符（实现产出的可观察值 ≠ 需求要求）→ 修业务实现使行为正确
   - 测试运行暴露 NPE / 5xx / unhandled（边界契约违约）→ 修实现的边界处理
   - 漏实现某需求片段 → 补实现
   - **`failkind=test` 的项不处理**（已折返 ut；本节点改正确代码去迁就错测试是空转的根因）
3. **修一项标一项**：在评审报告对应 Issue 下加脚注 `<!-- fixed: r<N-1> Issue #<k> (impl) -->`（review 下一轮读到此标记即不重复打回）；机检失败项在本轮 commit message 内列举
4. **通过项不重做**（避免引入新回归）

## 编译/语法自校（pre-flight，提交前必做）

本节点不跑测试套件（那是 ut/gate_review 的事），但须保证交付的实现**能编译/解析**，否则下游 ut 无法写测试：

1. 按 `{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md` 的构建/类型检查命令静默跑一次编译/typecheck（解释型语言跑 import/语法检查）
2. **通过** → 进收尾
3. **失败**：
   - 单纯实现 bug（自己代码里某行错了 / 类型错 / 语法错）→ **本地修、再编译；最多 3 轮自修**
   - 环境问题（缺依赖 / 工具未装）→ 修环境（参考 `{{HARNESS_MEMORY_DIR}}/notes/env-guide.md`，不存在则新建）

## 交活前自检（pre-flight checklist）

照下列项目当场核对，问题就地修，把对抗轮次降到最低：

1. **逐 `task.req_refs[]` 核**：每个需求片段都有对应实现产出其要求的可观察行为（默认值/边界/错误处理都落实）
2. **整体意图核**：需求原文里隐含但未列成条目的约束/异常路径也实现了
3. **可观察面无私自 mock**：实现里没有为图省事把真实模块换成桩
4. **代码能编译/解析**；git status 无未提交的相关实现文件
5. **未写测试**（确认没误写测试文件——测试是 ut 的职责）

## 收尾

- `git add` 实现文件 + 可能的 env-guide.md/scripts（**不含测试文件**）
- `git commit -m "feat: task#<id> r<N> <title>"`（第 2 轮起 commit message 加 `- fixed review r<N-1> Issue #<k> (impl)` / `- fixed gate_review <item>` 行）
- 自修后达成本节点目标 → `{{ADVANCE_OK artifact=<主要实现文件相对路径>}}`
- 若某需求片段在现有规则下**自相矛盾、无法实现**（极少见；非自身 bug、非环境问题）→ `{{ADVANCE_BLOCKED notes=<req_ref + 矛盾点：需回 bdd/需求澄清或用户裁决>}}`（本蓝图无 wd 可折返，故此类需人工介入）

## 关键约束

- **行为权威唯一源 = 用户需求文档**（original-requirements.md，按 req_refs 定位）：无 srs.md / design.md / wd / bdd.json 输入；约束/假设以 project-context.md + scan rules 为准
- **只写实现、不写测试**：测试由下游 ut 据 BDD 独立编写；本节点写测试会破坏「实现/测试双作者」的独立对抗性
- **不读 bdd.json**：BDD 是下游验证 oracle，不是实现依据
- **可观察面不可私自 mock**：仅外部真实边界可 stub
- **本节点只汇报 `ADVANCE_OK` 或 `ADVANCE_BLOCKED`，从不 `ADVANCE_FAIL`**（环内首节点、引擎不允许 rewind 到自身，故 failed 会因无折返边而 halt——这是「出现了不该出现的状态」的失败保险，不是正常路径）：编译/语法/明显 bug / 环境问题一律**本地修**；需求本身不可实现才 `ADVANCE_BLOCKED` 上报人工

## 红旗信号

| 逃避 | 正确动作 |
|---|---|
| "我顺手把测试也写了，效率高" | 不行。测试是 ut 的职责；impl 写测试 = 自证（测试只确认作者本意）。只交付实现 |
| "需求文档太长，我看 task.bdd_ids 对应的 BDD 场景更省事" | 禁止读 bdd.json。BDD 漏的需求 impl 会跟着漏；必须据 original-requirements.md 原文实现 |
| "review 报告里 failkind=test 的项我也顺手改了实现" | 不要。test 维已折返 ut 修测试；改正确的实现去迁就错测试是空转根因 |
| "review 反馈我看不懂，先按自己想法重写" | 必须严格按 review 报告 impl 维 Issue 逐项响应；看不懂就引用清单原文上报 BLOCKED |
| "同一需求点 review 多次打回，我跳过它" | 反复打回意味着对抗未收敛，要么真修要么 ADVANCE_BLOCKED 上报该需求不可实现 |
| "把这个内部 helper mock 掉就好写了" | 内部 helper 通常是可观察面；桩掉它下游 ut/review/gate_review 都会打回 |
| "先把骨架实现了，细节下轮补" | 本节点一次交付完整实现；需求片段都要落实，别留半成品 |
| "上一轮的 fix 标记我懒得加" | 不加，review 下一轮会把该 Issue 当作未修又写一遍，浪费对抗轮次 |
