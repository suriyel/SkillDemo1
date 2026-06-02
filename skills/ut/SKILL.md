---
name: ut
description: "据 bdd.json 场景为当前 task 独立编写配套测试（每方法带 # BDD-xxx 标记，断言 then/examples 的精确可观察值），覆盖 task.bdd_ids 的全部场景。本节点只写测试、不改业务实现（实现由上游 impl 据需求文档写就）——让测试成为独立对抗面而非代码作者的自证。第 2 轮起（因 test 维被打回）按 review/gate_review ticket 修测试断言对齐 then 的 observable。"
---

# 据 BDD 写对抗测试（环内，置于 impl 之后）

上游 `impl` 已据**用户需求文档**写好实现。本节点据 **`bdd.json` 的行为场景**为该实现独立编写配套测试——**实现作者（impl）与测试作者（ut）分离**，让测试成为对实现的独立对抗验证，而不是代码作者「确认自己本意」的自证。

> **测试权威源 = `bdd.json` 场景的 `then`/`examples`**。每个场景的精确可观察值即断言源；`given`/`when` 给出复现路径。**本节点不改业务实现**（实现是 impl 的职责）——若测试照 BDD 写出来后是红的，那是实现没满足 BDD 的真实信号，交由下游 review / gate_review 判定并折返 impl，**不要为让测试变绿去改实现**。

**开始时宣告**："I'm using the ut skill. Time to write adversarial tests from BDD."

解析 `{{TASK_GET}}`，取 `task.id` / `task.title` / `task.bdd_ids[]`。loop 引擎已挑好当前任务。

**静默执行协议**：每一次构建、测试命令都重定向到 `/tmp/<slug>-$$.log` + exit 文件。永不向主 agent 倾倒完整输出；只在失败时摘 100 行尾部。

## 输入读取（单次全量 Read）

1. **行为契约（测试权威源）—— `{{HARNESS_MEMORY_DIR}}/plans/bdd.json`**：逐 id 取 `task.bdd_ids[]` 对应 scenario。每个 scenario 的 `given`/`when`/`then`/`examples` 是测试的**权威规约**：`then`/`examples` 的精确可观察值即断言源。
2. **被测实现**：`git status --porcelain` + 上游 impl 本轮 commit，locate 本 task 实现的真实模块/接口/符号——测试要打到**真实可观察面**。
3. **项目上下文 + 工具命令**：`{{HARNESS_MEMORY_DIR}}/plans/project-context.md`（tech_stack / has_frontend_ui）、`{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md`（测试命令、UT 风格、重启协议）、`{{HARNESS_MEMORY_DIR}}/notes/rules/*.md`（如存在）。
4. **共享参考**：
   - `{{SHARE-REFERENCE}}/iron-law.md`（断言铁律）
   - `{{SHARE-REFERENCE}}/testing-anti-patterns.md`（反模式 6：可观察面不可整模块 mock）
   - `{{SHARE-REFERENCE}}/test-tier-recipes.md`（L1/L2/L3 落地）
   - `{{SHARE-REFERENCE}}/coverage-recipes.md`

## 轮次检测 — test 维打回读取

本节点可能是第 1 轮（首次写测试）也可能是第 N≥2 轮（上一轮 review / gate_review 判 **test 维**——测试断错 observable / 断言过浅 / 漏 BDD 标记——折返到本节点）：

1. **review 报告**：`ls -1 .harness/memory/notes/ 2>/dev/null | grep -E "^feature-${TASK_ID}-review-r[0-9]+\.md$"`，取序号最大那一份；**逐条处理其中 `failkind=test` 的 Issue**（见下「第 2 轮起」）。
2. **gate_review ticket**：`{{TICKETS_GET}}` 取本 task 内最新 open ticket；标题含「回 ut 补/修测试」→ ticket notes 内有「测试编写缺口（漏 BDD id / 断言过浅 / then 精确值无命中）」，必须逐项补。
3. 两者都无相关 test 维项 → 第 1 轮，按 BDD 场景从零写测试。

> `failkind=impl` 的项不归本节点（那是实现行为缺口，已折返 impl）。本节点**永不改业务实现**。

## 逐场景写测试（据 BDD）

逐 `task.bdd_ids[]` 把每个 BDD 场景翻成测试：

1. **逐场景写测试方法**（一场景至少一方法；多 examples 可多方法/参数化）：
   - 功能性 / 集成内 L1/L2 行为在本节点跑（目标绿；红即实现缺口信号，见收尾）
   - 需真实集成环境（外部服务 / UI 端到端）的 L3 行为写好测试代码但**允许暂不绿**（st 阶段统一跑）
2. **每个测试方法必须带 BDD 标记**：方法体内或紧邻注释加 `# BDD-xxx` / `// BDD-xxx`（取场景 id，语言相关），让下游 review/gate_review grep 静态扫得到。一条 BDD 可有多个层级的测试，每个都打标记。
3. **断言必须用场景 `then`/`examples` 的精确值，且断的是 `then` 指定的可观察量**（精确字符串 / 状态码 / 返回结构 / 持久化记录）：
   - **断对 observable**：断言检查的字段 / 路径 / 坐标轴 / 端点必须就是 `then` 描述的可观察量——**不得错轴 / 错字段 / 错端点**（如 `then` 说位置到 (5,6) 即断 `position==(5,6)`，不要去断别的轴）。错 observable = 测试天生错。
   - **禁止** `assert True` / `expect(true).toBe(true)` / 仅断言「被调用过」；禁止把 mock 返回值当期望值（自证陷阱）。
4. **可观察面禁 mock**：产出 BDD then 的真实模块 / 符号绝不能被整模块 mock 顶替；只允许在更外层真实边界（网络 / 三方 / 时钟 / 文件系统）打 stub（见 `{{SHARE-REFERENCE}}/testing-anti-patterns.md` 反模式 6）。
5. **覆盖异常场景**：BDD 中标 `kind=negative|boundary|error` 的场景同样逐条写测试，断言其拒绝 / 报错 / 边界结果。

## 第 2 轮起 — 按 test 维反馈修测试（绝不改实现）

读取上一轮 review 报告 `failkind=test` 的 Issue + gate_review ticket 的「测试编写缺口」：

1. **合并去重**，按 file:line 排序
2. **逐项修测试**：
   - 测试断错 observable（错轴 / 错字段 / 错端点）→ 把断言**对齐到 `then` 指定的可观察量**
   - 断言过浅 → 改成场景 `then`/`examples` 的精确值
   - mock 反模式 → 删除 `vi.mock(...)` / `mock.patch(...)`，换成真实调用（仅外层边界 stub）
   - 漏 BDD id 标记 → 补 `# BDD-xxx` 注释 + 对应断言
   - test race / 错 setup → 修测试编排
3. **修一项标一项**：在评审报告对应 Issue 下加脚注 `<!-- fixed: r<N-1> Issue #<k> (test) -->`
4. **业务实现一律不动**——若发现是实现行为错（非测试错），不要在本节点改实现，在收尾时说明（下一轮 review/gate_review 会判 impl 维折返 impl）

## 跑测试记录（pre-flight，提交前必做）

1. 按 `{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md` 的「运行命令」（已排除 L3 tag）静默跑 L1+L2，记录 pass/fail + 失败尾部 100 行
2. **测试代码本身跑不起来**（语法错 / import 错 / fixture 错）= 测试缺陷 → **本地修测试、再跑；最多 3 轮自修**
3. **测试能跑、但有断言失败** → 这是**实现没满足 BDD 的信号**，不是测试缺陷：**保留该红测试**（它是对抗证据），在收尾 commit message 记「BDD-xxx 红：实现产出 ≠ then，待 review/gate_review 判 impl 维」，**不改实现让它变绿**
4. 环境问题（缺依赖 / 工具未装）→ 修环境（参考 `{{HARNESS_MEMORY_DIR}}/notes/env-guide.md`，不存在则新建）

## 交活前自检（pre-flight checklist）

1. **逐 `task.bdd_ids[]` 核**：每个 id 在工作区**至少有一个测试方法**带 `# BDD-xxx` 标记；标记附近 25 行内有真断言（非 `assert True` / 重言式 / 占位 `pass`）；断言值是该场景 `then`/`examples` 的精确可观察值
2. **断对 observable**：每个断言检查的量就是 `then` 描述的可观察量
3. **可观察面无 mock**：grep `vi.mock` / `jest.mock` / `mock.patch` 确认未顶替产出 then 的真实模块
4. **未改实现**：git status 的暂存改动只含测试文件（无业务实现文件——那是 impl 的）

## 收尾

- `git add` 测试文件（**不含业务实现文件**）+ 可能的 env-guide.md/测试脚手架
- `git commit -m "test: task#<id> r<N> BDD 配套测试 <title>"`（第 2 轮起加 `- fixed review r<N-1> Issue #<k> (test)` / `- fixed gate_review <item>` 行；有红测试时加 `- BDD-xxx 红：实现 ≠ then`）
- 测试写就（无论全绿还是有红测试作为实现缺口的对抗证据）→ `{{ADVANCE_OK artifact=<主要测试文件相对路径>}}`
- 若某 BDD 场景在现有规则下**根本无法写出确定断言**（场景自相矛盾 / 不可判定；极少见，非自身 bug、非环境）→ `{{ADVANCE_BLOCKED notes=<场景 id + 为何无法写测试：需回 bdd 修正该场景或用户澄清>}}`

> **本节点只汇报 `ADVANCE_OK` 或 `ADVANCE_BLOCKED`，从不 `ADVANCE_FAIL`**（环内第 2 节点、引擎不允许 rewind 到自身，故 failed 会因无折返边而 halt——失败保险，非正常路径）：测试代码自身的 bug / 环境问题一律**本地修**；BDD 场景不可写测试才 `ADVANCE_BLOCKED` 上报人工。红测试（实现缺口）不是本节点的失败，照常 `ADVANCE_OK` 交下游判定。

## 关键约束

- **只写测试、不改业务实现**：实现是 impl 的职责；ut 改实现 = 破坏「实现/测试双作者」的独立对抗性，也会把红测试（真实信号）人为抹平
- **测试权威源 = bdd.json 场景**：断 `then` 指定的可观察量，用 `then`/`examples` 的精确值
- **可观察面不可 mock**：仅外部真实边界可 stub
- **红测试是信号、不是缺陷**：实现没满足 BDD 时保留红测试，交下游折返 impl，绝不改实现迁就

## 红旗信号

| 逃避 | 正确动作 |
|---|---|
| "测试红了，我顺手改下实现让它绿" | 禁止。ut 不改实现；红测试是实现缺口的对抗证据，保留它、交 review/gate_review 折返 impl |
| "BDD-005 没法精确断言，就 assert True 吧" | 场景 `then`/`examples` 是精确值；写虚 → review/gate_review 必打回 |
| "把这个内部 helper mock 掉测就过了" | 内部 helper 通常是可观察面；mock 它 = 反模式 6，review + gate_review 都会打回 |
| "L3 测试我直接 skip" | L3 写测试但允许不绿；不可 skip，gate_review 会查覆盖 |
| "只 grep id 不写真断言" | 标记附近 25 行内必须有断 then 精确值的真断言；仅有 id 不够 |
| "review 说 failkind=impl 的项我也改下测试" | impl 维是实现行为错，已折返 impl；本节点只处理 test 维 |
| "上一轮的 fix 标记我懒得加" | 不加，review 下一轮会把该 Issue 当作未修又写一遍，浪费对抗轮次 |
