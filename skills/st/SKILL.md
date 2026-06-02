---
name: st
description: "当所有 task 均 passing 后运行一次 — 跨特性 / 系统级测试 + BDD 行为对账：在真实集成环境逐条 replay bdd.json 场景，确认整体系统行为与用例一致，产出结构化 JSON 验收报告 st-acceptance.json（含 bdd_reconcile/defects/verdict）供 gate_st 机检核实。本蓝图无 SRS / Design：不做系统级 NFR / L3 签收，仅 BDD 行为对账。"
---

**语言规则**：用中文（简体）回复用户；生成的文档与报告用中文。代码标识符、JSON 字段名保持英文。

# 系统测试 —— 跨特性校验 + BDD 行为对账

loop 内每个 task 已在 `gate_review` 单测/特性级核验过自身 BDD 行为。本阶段聚焦逐 task **无法**覆盖的：跨特性交互、多特性 E2E、探索性测试，**以及在真实集成环境对全部 BDD 场景做一次行为对账**——堵住「单测真断言但集成接线断了」的逃逸（Mock-Leaked / Integration 类）。本蓝图无 SRS / Design，故不做系统级 NFR 实测与 L3 重量级签收，对账唯一权威源是 `bdd.json`。

## 输入

- 任务全集：`{{TASKS_GET}}`（读 `bdd_ids` / `dependencies` / `category`；本蓝图无 `srs_trace`）
- **BDD 用例：`{{HARNESS_MEMORY_DIR}}/plans/bdd.json`**（行为对账的**唯一**权威源）
- 用户输入文档：`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`（角色/术语/约束背景）
- 项目上下文：`{{HARNESS_MEMORY_DIR}}/plans/project-context.md`（tech_stack / 约束 / 假设）

## Checklist（按序，每步建 TodoWrite）

### 1. 就绪关卡
- `{{TASKS_GET}}` 全部 `status == "passing"`；否则停止本节点，{{ADVANCE_BLOCKED notes=<列出未通过 task>}}。
- **被测运行时必须是「最新源码干净重启」的——按 `{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md` 的 Service Lifecycle 4 步重启协议执行**（有长驻服务时；CLI/纯库项目跳过本条，但仍须对最新构建产物测试、不复用旧二进制）：① **Kill** 停掉**任何残留**服务进程（按 PID/端口，含上一轮 ST/iter 留下的）→ ② **Verify dead** → ③ **用最新源码 Rebuild + Start**（长驻 dev server 不热加载，必须重建+重启，否则对账打的是旧编译产物→已修缺陷被误报为未修复、催生重复 bugfix-task）→ ④ **Verify alive**（健康检查）。**回 iter 修完重入本节点时尤其必走此协议，绝不复用上一轮服务进程**。起不来 / 验不活 → 记 BLOCKED，不在旧/残留进程上对账。
- 读 `{{SHARE-REFERENCE}}/test-tier-recipes.md` §1 + §5（按 product_type × stack × has_frontend_ui 取本项目 L3 落地配方）。

### 2. 回归
- 用项目测试命令跑**全量**测试套件；零失败、零错误；覆盖率阈值达标。任一失败 = 回归 → 先诊断。

### 3. 集成 / 全链路冒烟
- 对每对共享数据/状态/接口的 task（按 `dependencies[]` 图）：用**真实**资源（真实 DB/网络/文件系统，非 mock）校验跨边界数据流与契约。
- 至少 1 条真实端到端冒烟路径（input → 处理 → 持久化 → 读回 → output），全程无 mock。失败 = Critical。

### 4. 跨特性 E2E
- 抽取**跨多特性**的主工作流（happy + 错误恢复），设初态 → 执行 → 校验中间与最终态 → 清理。
- UI 特性：用真实渲染环境（如 jsdom/happy-dom 或 Chrome DevTools MCP，视项目而定）做基于界面的 E2E。

### 5. **BDD 行为对账（本阶段核心，唯一硬产物来源）**
Read `{{HARNESS_MEMORY_DIR}}/plans/bdd.json`，对**每一条** scenario，在**真实集成环境**（不 mock 产出可观察结果的表面；UI 用真实渲染环境、服务用真实服务/真实 I/O）逐条 replay：
1. 按 `given` 建初始状态；
2. 按 `when` 触发；
3. **断言 `then`/`examples` 的精确可观察值**（精确字符串/状态码/返回结构/持久化记录等，随技术栈而定）。
对账须落到**实测证据**：记录每条 scenario 的 `expected`（取自 then/examples 的精确值）、`actual`（真实环境实测值）、`evidence`（测试/命令/路径），判 `PASS` / `FAIL`。任一 `then` 在真实环境不匹配 = **Critical 缺陷**（典型：单测 mock 了可观察面而集成下真实实现偏离用例）。结果在 Step 8 落成结构化 JSON。

### 6. 探索性（可选）
- 每主特性区一个 charter，时间盒 15-30 分钟，记录发现。
- 兼容性：仅当用户输入文档明确要求多平台/浏览器/runtime 时逐目标跑；否则跳过。
- 本蓝图**不做系统级 NFR 实测、不产 l3-signoff.json**（无 SRS NFR 表 / 无 design §9 状态机·外依赖契约）。

### 7. 缺陷 Triage + 逃逸分析
- 按 Critical/Major/Minor/Cosmetic 分级；Critical/Major 阻塞 Go。
- 每个缺陷标 **Escaped From**（Unit / Behavior-Gate / Mock-Leaked / Integration / Spec）以暴露系统性缺口。
- 存在 Critical/Major（含任一真实环境 BDD 对账 FAIL）：本节点**不改实现代码**（ST 期间无新特性）；改为按 Step 9 为每个根因缺陷建一条 `bugfix-task` 追加进 `iter` loop，由引擎回卷走 iter loop（impl→ut→review→gate_review）定向修复并补回归测试。

### 8. 验收报告（结构化 JSON —— 权威产物，供 gate_st 机检核实）
生成 `{{HARNESS_MEMORY_DIR}}/plans/st-acceptance.json`（**这是 gate_st 校验的权威验收报告**，字段如下）：

```json
{
  "schemaVersion": 1,
  "reconciledAt": "<ISO8601 时间>",
  "environment": "<真实环境描述，如 jsdom / 真实服务 + 真实 DB>",
  "bdd_reconcile": [
    {
      "id": "BDD-001",
      "verdict": "PASS",                 // PASS | FAIL（大小写不敏感）
      "expected": "<then/examples 的精确可观察值>",
      "actual": "<真实环境实测值>",
      "evidence": "<测试名/命令/输出片段/文件路径等可核实证据，非空>"
    }
    // bdd.json 中每条 scenario 一条，不得遗漏
  ],
  "defects": [                            // 缺陷（如有）
    { "severity": "Critical", "escaped_from": "Mock-Leaked", "desc": "<描述>", "status": "open" }
  ],
  "verdict": "Go"                         // Go | Conditional-Go | No-Go
}
```

**硬约束（gate_st 逐字段机检）**：bdd.json 每条 `scenario.id` 在 `bdd_reconcile[]` 都有一条 `verdict=="PASS"` 且 `evidence` 非空的记录；整体 `verdict != "No-Go"`；`defects[]` 中无未关闭（status ∉ fixed/deferred/closed）的 Critical/Major。

（可选）另产出人读版 `{{HARNESS_MEMORY_DIR}}/plans/st-report.md` 作为叙述视图——但**验收核实以 st-acceptance.json 为准**，gate 不校验它。

### 9. Verdict + 收尾
- 按出口标准（回归全绿 / 每边界真实集成 / 全部 BDD 场景对账 PASS / 无未关闭 Critical/Major）给 Go / Conditional-Go / No-Go，写入报告。
- **收尾按三态分流**（status 纪律：`failed` 必须先 seed bugfix-task 再报、否则回卷到空 iter 是死路；`blocked` → halt 交人工、不回卷；二者不可混）：

  **A. Go / Conditional-Go**（`st-acceptance.json` 齐全、无未关闭 Critical/Major）→ {{ADVANCE_OK artifact={{HARNESS_MEMORY_DIR}}/plans/st-acceptance.json}}（进入 `gate_st` 对账硬门）。

  **B. 存在真实缺陷**（任一真实环境 BDD 对账 FAIL，或未关闭 Critical/Major）→ 为**每个根因缺陷**建一条 `bugfix-task` 追加进 `iter` loop 回卷修复，**不在本节点改代码**：
  1. 读 {{TASKS_GET}} 拿现有任务（取已用 id 以避免冲突）。
     - **去重（关键，杜绝同一 bug 反复开单）**：每个失败 bdd_id 先查 {{TASKS_GET}} / {{TICKETS_GET}} 是否**已有**针对同一 bdd_id（或同一根因）的 bugfix-task——**已有则不重复建**，只在 notes 注明复发。**Step 1 已强制干净重启**，故已修缺陷不应再因陈旧产物复现；若某 bdd_id 此前已修复验证、本轮在**新产物**上**仍 FAIL**（确非陈旧所致）→ 是真·顽固缺陷，**不再机械重开同款 task**，改 {{ADVANCE_BLOCKED notes=<bdd_id X 多轮修复在新产物上仍不过，需人工诊断根因>}} 交人工。
  2. **归因**：把失败 bdd_id 映射到**拥有它的 work-unit task**（查 {{TASKS_GET}} 各 task 的 `bdd_ids[]`），bugfix-task 的 `dependencies` 指向该 owner task；**`req_refs` 取该失败 bdd_id 对应 `bdd.json` 场景的 `derivation` 需求锚点**（`original-requirements.md L…`）——取不到则沿用 owner task 的 `req_refs`。这是回卷后 impl 据以读权威需求的指针，**不可缺**（impl 不读 bdd.json）。
  3. 构造 items 数组写入 `.harness/blueprint/tasks/iter-add.json`，每条形如（保持泛化，按实际缺陷填）：
     ```json
     [{
       "id": "<新 id：现有数值 id 的 max+1，或 fix-<场景id>；若同名已存在则换新后缀>",
       "status": "failing",
       "category": "bugfix",
       "title": "修复 <失败场景id>：<一句缺陷摘要>",
       "description": "<根因 + 定向修复方案 + 复现步骤>",
       "req_refs": ["original-requirements.md L<起>-L<止> | <该缺陷涉及的需求摘要>"],
       "bdd_ids": ["<失败场景 id>"],
       "dependencies": ["<拥有该 bdd_id 的 owner task id>"]
     }]
     ```
  4. 增量追加进 loop（不动既有任务）：{{TASKS_ADD loop=iter file=.harness/blueprint/tasks/iter-add.json}}
  5. 上报失败触发回卷（引擎按 `onFail.rewindTo=iter` 重入 loop 挑中 bugfix-task）：{{ADVANCE_FAIL notes=<已建 bugfix-task 的 id 与其覆盖的场景；回 iter 修复后将重对账>}}

  **C. 无法推进**（环境起不来 / 全量测试根本跑不动等非代码缺陷）→ {{ADVANCE_BLOCKED notes=<原因>}}。

## 关键规则
- **证据导向裁决** —— 每个 PASS 必有实测证据；"看着行"不是证据。
- **BDD 对账不可遗漏** —— bdd.json 每条 scenario 都须在真实环境 replay 并在 `st-acceptance.json` 的 `bdd_reconcile[]` 留 PASS + evidence；`gate_st` 逐 id 机检该 JSON。
- **可观察面禁 mock** —— 对账 replay 中产出 `then` 可观察结果的表面不得 mock（见 `{{SHARE-REFERENCE}}/testing-anti-patterns.md` 反模式 6）。
- **所有 bug 都必须修** —— ST 中发现的任何缺陷（前端/后端/集成）发布前必修，无"不是我的代码"豁免。
- **ST 期间无新特性** —— 按原样测试已集成系统。
