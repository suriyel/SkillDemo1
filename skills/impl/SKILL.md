---
name: impl
description: "据 bdd.json 场景 + 用户输入文档直接为当前 task 写实现代码 + 配套测试，一次交付而非 TDD R/G/R；第 2 轮起读上一轮 review 报告 + gate_review 失败摘要做定点修正。本蓝图无 wd 特性设计文档 / 无 design.md。"
---

# Direct Implementation（环内首节点）

为**当前任务**直接据 `bdd.json` 的行为场景 + 用户输入文档一次性交付实现代码 + 配套测试。下游 review（LLM 对抗审查）与 gate_review（脚本机检硬门）联合核验。**本蓝图无 wd 特性设计文档、无 SRS / design.md**——行为契约即 BDD 场景的 `then`/`examples`，意图依据是用户输入文档。

**开始时宣告**："I'm using the impl skill. Let me orient myself."

解析 `{{TASK_GET}}` 输出的 JSON，取 `task.id` / `task.title` / `task.description` / `task.bdd_ids[]` / 其他业务字段。loop 引擎已挑好当前任务，无需手动管理任务状态。

**静默执行协议**：每一次构建、测试、检查命令都重定向到 `/tmp/<slug>-$$.log` + exit 文件。永不向主 agent 倾倒完整输出；只在失败时摘 100 行尾部。

## 输入读取（单次全量 Read）

1. **行为契约唯一源 — `{{HARNESS_MEMORY_DIR}}/plans/bdd.json`**：逐 id 取 `task.bdd_ids[]` 对应 scenario。每个 scenario 的 `given`/`when`/`then`/`examples` 是实现 + 测试的**权威规约**：`then`/`examples` 的精确可观察值即测试断言源；`derivation` 给出该行为依据的规则。
2. **意图依据 — 用户输入文档**：`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`（理解 BDD 场景背后的用户原意；BDD 含糊时以原文为准）。
3. **项目上下文**：`{{HARNESS_MEMORY_DIR}}/plans/project-context.md`（tech_stack / has_frontend_ui / 项目级约束 + 假设）。
4. **代码库约定**（如存在）：`{{HARNESS_MEMORY_DIR}}/notes/rules/*.md`、`{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md`（构建/测试命令、UT 风格、重启协议）。
5. **共享参考**：
   - `{{SHARE-REFERENCE}}/iron-law.md`（断言铁律）
   - `{{SHARE-REFERENCE}}/testing-anti-patterns.md`（反模式 6：可观察面不可整模块 mock）
   - `{{SHARE-REFERENCE}}/test-tier-recipes.md`（L1/L2/L3 落地）

## 轮次检测 — review 报告与 gate_review ticket 读取

本节点可能是第 1 轮（首次实现）也可能是第 N≥2 轮（上一轮被 review 或 gate_review 打回）。**先确定身份再开干**：

1. **review 报告**：`ls -1 .harness/memory/notes/ 2>/dev/null | grep -E "^feature-${TASK_ID}-review-r[0-9]+\.md$"`，取序号最大那一份
   - 存在 → 这是上一轮 review 评审报告，**优先逐条修正其中 Issue**（见下方"按报告定点修正"），不重做已通过项
2. **gate_review ticket**：`{{TICKETS_GET}}` 取本 task 内最新的 open ticket；若 `ticketTitle` 含 "Gate_review 机检未通过" → ticket notes 内有「机检失败项摘要」，**必须与 review 报告并列作为本轮修正源**
   - gate_review 抓的是 review 漏判的客观事实（漏 BDD id / 断言过浅 / mock 可观察面 / 测试不绿），绝不能跳过
3. 两者都不存在 → 第 1 轮，按 BDD 场景从零实现

## 强制接地存量代码

- `git status --porcelain` 取「已开发文件」清单
- 按 BDD 场景的 `cross_domain`（若有，形如 `模块 @ src/foo.js:42`）与场景涉及的领域实体 locate 真实实现；brownfield 复用既有接口/数据/配置通道
- **禁止静默 mock 内部模块**：被消费的真实接口绑定真实实现；找不到且 Provider 待实现 → 起最小 stub 加 TODO，但**不得 mock 任何可观察面**（产出 BDD then 的真实模块绝不可被 `vi.mock` / `jest.mock` / `mock.patch` 整模块顶替）

## 直接实现一次到位（据 BDD 场景）

逐 `task.bdd_ids[]` 把每个 BDD 场景翻成实现：

1. **按 `given` 建/改所需的数据结构与初始状态**；按 `when` 实现触发的操作；让系统在该操作后产出 `then`/`examples` 断言的精确可观察值。
2. **`derivation` 是实现依据**：场景 `derivation` 引用的规则（输入文档行号 / scan 约定）给出取值与边界——实现须落实这些取值（默认值、范围、枚举、错误处理）。
3. **跨域场景**（`cross_domain`）：实现要真实贯通新行为与存量模块的边界，`then` 同时覆盖新结果 + 对存量状态的影响。
4. **遵守 project-context 约束/假设 + scan 约定**：强制内部库、命名、错误处理模式按 `notes/rules/*.md` 与 project-context `## Constraints` 落实。
5. **意图对齐**：BDD 场景未覆盖到的实现细节，回看用户输入文档原意推断；切忌自创与原文相悖的行为。

## 配套写测试（与实现同提交）

**测试与实现是一个原子提交，禁止"先提实现等下次再补测试"。**

1. 按 `task.bdd_ids[]` **逐场景写测试方法**（一场景至少一方法；多 examples 可多方法/参数化）：
   - 功能性/集成内 L1/L2 行为在本节点跑绿
   - 需真实集成环境（外部服务/UI 端到端）的 L3 行为写好测试代码但**允许暂不绿**（st 阶段统一跑）
2. **每个测试方法必须带 BDD 标记**：方法体内或紧邻注释加 `# BDD-xxx` / `// BDD-xxx`（取场景 id，语言相关），让下游 grep 静态扫得到。一条 BDD 可有多个层级的测试，每个都打标记。
3. **断言必须用场景 `then`/`examples` 的精确值，且断的是 `then` 指定的可观察量**（精确字符串/状态码/返回结构/持久化记录）：
   - **断对 observable**：断言检查的字段/路径/坐标轴必须就是 `then` 描述的可观察量——**不得错轴/错字段/错端点**（如 `then` 说位置到 (5,6) 即断 `position==(5,6)`，不要去断别的轴）。错 observable = 测试天生错，下游会判 `FAILKIND: test` 打回。
   - **禁止** `assert True` / `expect(true).toBe(true)` / 仅断言 "被调用过"；禁止把 mock 返回值当期望值（自证陷阱）。
4. **可观察面禁 mock**：产出 BDD then 的真实模块/符号绝不能被整模块 mock 顶替；只允许在更外层真实边界（网络/三方/时钟/文件系统）打 stub
5. **覆盖异常场景**：BDD 中标 `kind=negative|boundary|error` 的场景同样逐条写测试，断言其拒绝/报错/边界结果。

## 第 2 轮起 — 按 review 报告 + gate_review ticket 定点修正

读取上一轮 review 报告的 "## 问题清单" + gate_review ticket notes 的「机检失败项」：

1. **合并去重**两者 Issue，按 file:line 排序
2. **先看 FAILKIND 决定改哪儿**：
   - **`FAILKIND: test`（B 维，关键）→ 改的是测试、不是业务实现**：测试断言检查了错的 observable（错轴/错字段/错端点）或测试本身 race/错 setup。按 BDD 场景 `then` 把测试断言**对齐到正确的可观察量**。**业务实现若已满足 spec 就不要动**——为满足错测试去改对的代码是空转的根因。
   - 其余 → 按下方逐项修业务实现 + 测试。
3. **逐项执行修正建议**：
   - 测试断言过浅 → 改成场景 `then`/`examples` 的精确值（且断 then 指定的量）
   - mock 反模式 → 删除 `vi.mock(...)` / `mock.patch(...)`，换成真实调用（仅外层边界 stub）
   - 漏 BDD id 标记 → 补 `# BDD-xxx` 注释
   - 行为与场景 `then` 不符 → 修业务实现使可观察值匹配 then
4. **修一项标一项**：在评审报告对应 Issue 下加脚注 `<!-- fixed: r<N-1> Issue #<k> -->`（review 下一轮读到此标记即不重复打回）；机检失败项在本轮 commit message 内列举
5. **通过项不重做**（避免引入新回归）

## 跑测试自校（pre-flight，提交前必做）

1. 按 `{{HARNESS_MEMORY_DIR}}/notes/tool-commands-guide.md` 的"运行命令"（已排除 L3 tag）静默跑 L1+L2
2. **全绿** → 进收尾
3. **失败** → 摘 100 行尾部诊断：
   - 单纯实现 bug（自己代码里某行错了）→ **本地修、再跑；最多 3 轮自修**（编译/语法/明显 bug 自行修复，不上报）
   - 环境问题（缺依赖 / 工具未装）→ 修环境（参考 `{{HARNESS_MEMORY_DIR}}/notes/env-guide.md`，不存在则新建）

## 交活前自检（pre-flight checklist）

照下列项目当场核对，问题就地修，把对抗轮次降到最低：

1. **逐 `task.bdd_ids[]` 核**：
   - 每个 id 在工作区**至少有一个测试方法**带 `# BDD-xxx` 标记
   - 每个标记附近 25 行内有真断言（非 `assert True` / 重言式 / 占位 `pass`）
   - 断言值是该场景 `then`/`examples` 的精确可观察值
2. **行为对账**：每个场景的实现产出的可观察值与其 `then` 逐字段一致
3. **可观察面无 mock**：grep `vi.mock` / `jest.mock` / `mock.patch` 出现位置确认未顶替真实模块
4. **git status 检漏**：无未提交的相关文件

## 收尾

- `git add` 实现文件 + 测试文件 + 可能的 env-guide.md/scripts
- `git commit -m "feat: task#<id> r<N> <title>"`（第 2 轮起 commit message 加 `- fixed review r<N-1> Issue #<k>` / `- fixed gate_review <item>` 行）
- 自修后达成本节点目标 → `{{ADVANCE_OK artifact=<主要实现文件相对路径>}}`
- 若某 BDD 场景在现有规则下**自相矛盾、无法实现**（极少见；非自身 bug、非环境问题）→ `{{ADVANCE_BLOCKED notes=<场景 id + 矛盾点：需要回 bdd 修正该场景或用户澄清>}}`（本蓝图无 wd 可折返，故此类需人工介入）

## 关键约束

- **行为契约唯一源 = bdd.json 场景**：无 srs.md / design.md / wd 设计文档；约束/假设以 project-context.md + scan rules 为准
- **实现 + 测试同提交**：禁止分两次推进
- **可观察面不可 mock**：仅外部真实边界可 stub
- **断言忠实 then**：测试断 `then` 指定的可观察量，用 `then`/`examples` 的精确值
- **本节点只汇报 `ADVANCE_OK` 或 `ADVANCE_BLOCKED`，从不 `ADVANCE_FAIL`**（环内首节点、引擎不允许 rewind 到自身，故 failed 会因无折返边而 halt——这是「出现了不该出现的状态」的失败保险，不是正常路径）：编译/语法/明显 bug / 环境问题一律**本地修**；BDD 场景本身不可实现才 `ADVANCE_BLOCKED` 上报人工

## 红旗信号

| 逃避 | 正确动作 |
|---|---|
| "review 反馈我看不懂，先按自己想法重写" | 必须严格按 review 报告 Issue 清单逐项响应；看不懂就引用清单原文上报 BLOCKED |
| "review 多次打回同一个 BDD-id，我跳过它" | 同一 id 反复打回意味着对抗未收敛，要么真修要么 ADVANCE_BLOCKED 上报该场景不可实现 |
| "gate_review 抓回的项 review 没说，是误报" | 不是。review 是主观挑刺、gate_review 是客观事实兜底；机检项必须修 |
| "BDD-005 没法精确断言，就 assert True 吧" | 场景 `then`/`examples` 是精确值；写虚 → review 必打回 |
| "把这个内部 helper mock 掉测就过了" | 内部 helper 通常是可观察面；mock 它 = 反模式 6，review + gate_review 都会打回 |
| "L3 测试我直接 skip" | L3 写测试但允许不绿；不可 skip，gate_review 会查 |
| "先把骨架实现了，测试下次写" | 实现 + 测试必须同提交；本节点不分两次推进 |
| "上一轮的 fix 标记我懒得加" | 不加，review 下一轮会把该 Issue 当作未修又写一遍，浪费对抗轮次 |
