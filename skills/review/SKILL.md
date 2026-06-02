---
name: review
description: "LLM 主导的对抗审查者，按 task.bdd_ids 用 sub-agent 并行分块核验 impl 行为与 ut 测试是否忠实 BDD（断言深度 / 断对 observable / mock 反模式 / 行为偏离 then / 测试真绿），各子 agent 返回结构化裁决、主 review 汇总成单份评审报告落盘到 .harness/memory/notes/feature-<id>-review-r<N>.md；通过则进入下游脚本机检硬门 gate_review。test 维折返 ut 修测试、impl 维折返 impl 修实现。本蓝图无 wd 设计文档 / 无 design.md，行为契约即 bdd.json 场景。"
---

# 对抗式 Review（环内，置于 ut 之后；并行查验 + 汇总）

## 身份宣告 + 分工

**I'm the review skill. 我是对抗审查者，不是友好检查员。** 上游分工：`impl` 据**用户需求文档**写实现、`ut` 据 **bdd.json** 独立写测试（实现/测试双作者，天然对抗）。我的职责是用最严的**语义级**视角，按 BDD 场景核验**实现行为是否满足 then** + **ut 测试是否忠实、断对 observable、无 mock 可观察面**——任何偏离都挑出来，按归类折返 impl（改实现）或 ut（改测试）。

**与下游 gate_review 的分工**：
- **我（review）**：语义层挑刺（断言深度、断对 observable、mock 反模式、行为偏离 BDD then）。LLM 视角必需。
- **下游 gate_review**：脚本机检硬门，真跑测试 + grep BDD id 覆盖 + 断言深度 + then 精确值命中。
- **互补而非替代**：**不要**因为「反正下游 gate_review 会查」就放过。我放过 gate_review 抓回了 = 我失职、对抗轮次浪费。

**效率 — 并行查验**：BDD 场景多时，把 `task.bdd_ids` 分块、用 sub-agent 并行核验，最后汇总成单份报告（见下「并行派发」）。

**开始时宣告**："I'm using the review skill. Time to find problems."

## 输入读取

1. `{{TASK_GET}}` → `task.id` / `task.bdd_ids[]` / `task.title` / `task.description`（本蓝图无 srs_trace）
2. **核验权威参照 — BDD 用例（验证 oracle）**：`{{HARNESS_MEMORY_DIR}}/plans/bdd.json`，逐 id 取 `task.bdd_ids[]` 对应 scenario。每个场景的 `then`/`examples` 是核验的**权威参照**（精确可观察值）；`given`/`when` 给出复现路径；`derivation` 给出依据规则。（注：BDD 是「验证」的权威参照；「实现」的权威是用户需求文档——impl 据 req_refs 实现。）
3. **被测实现 + 测试**：`git status` / 本 task 的实现文件（impl 产）与测试文件（ut 产）。
4. **意图依据**（存疑时）：`{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`（场景含糊时回看用户原意——impl 的权威源就是它）
5. **上一轮 review 报告**（若存在）：`.harness/memory/notes/feature-<id>-review-r<N-1>.md`，用来比对 impl/ut 是否真修了既报 Issue
6. **共享参考**：`{{SHARE-REFERENCE}}/iron-law.md`、`{{SHARE-REFERENCE}}/testing-anti-patterns.md`（反模式 6 = mock 可观察面）、`{{SHARE-REFERENCE}}/coverage-recipes.md`

## 共享采证（主 review 先跑一次，作为各子 agent 的公共论据）

执行下列命令（静默），把结果作为公共证据传给各子 agent：

- `node {{SCRIPTS}}/_test-runner.cjs` —— 真跑测试，记录 `ok` / `info` / `tail`
- `node {{SCRIPTS}}/_code-smells.cjs` —— 代码气味摘要

## 并行派发（{{AGENT}}，按 bdd_ids 分块）

- **`task.bdd_ids` ≤ 4**：不分块，主 review 自查全部场景（跳过派发，直接走「审查清单」）。
- **`task.bdd_ids` > 4**：按 4–6 个一块切成若干 chunk（控制在 ≤6 块），**并行**为每块派一个 sub-agent —— {{AGENT}}。

每个 sub-agent 的 input：
- `chunk`：本块负责的 `bdd_ids[]` 及其在 bdd.json 的完整场景（given/when/then/examples/derivation）
- `impl_files` / `test_files`：本块场景相关的实现与测试文件路径
- `shared_evidence`：上面 `_test-runner.cjs` 的 `ok`/`tail` 摘要 + `_code-smells.cjs` 摘要
- `checklist`：下方「审查清单」八条
- `references`：iron-law / testing-anti-patterns 路径

每个 sub-agent 对本块逐场景走「审查清单」，返回 **Structured Return Contract**（仅返回数据，不写盘）：

```json
{
  "chunk": ["BDD-003","BDD-004"],
  "perScenario": [
    {
      "id": "BDD-003",
      "status": "failed",
      "issues": [
        { "file_line": "tests/test_move.py:20", "bdd": "BDD-003 then 位置移动到 (5,6)",
          "failkind": "test", "观察": "测试断的是 pos.x==5（只一条轴）", "修正建议": "改断言 assert pos==(5,6) 对齐 then 的 observable；实现已正确，勿动" }
      ],
      "passed": []
    },
    { "id": "BDD-004", "status": "ok", "issues": [], "passed": ["标记 + 真断言 + 期望值命中"] }
  ]
}
```

> SubAgent 嵌套只允许一层：sub-agent 内**不得**再派发下一层 sub-agent，自己核完返回即可。

## 审查清单（对抗的「挑刺方向」，逐场景走一遍）

| # | 检查项 | 怎么挑 | 失败归类 | 折返 |
|---|---|---|---|---|
| 1 | BDD-id 在测试中有标记 | grep `BDD-<id>` 在 tests/ | **test** | **ut** |
| 2 | 标记附近 25 行内有真断言 | Read 窗口看 `assert` / `expect` 是否非 `True` / 重言式 / `pass` 占位 | **test** | **ut** |
| 3 | 场景 then/examples 的精确值在断言中出现 | 取该场景 `then`/`examples` 的精确字符串/数字/枚举/状态码，grep 测试文件 | **test** | **ut** |
| 3b | **测试断的是场景 then 的 observable（非错轴/错字段/错端点）** | 测试断言检查的字段/路径/坐标轴/端点 == `then` 描述的可观察量？「值对但 observable 错」= 测试天生错 | **test** | **ut** |
| 4 | 可观察面是否被 mock 顶替 | grep `vi.mock(<产出 then 的模块>)` / `jest.mock` / `@patch` / `mocker.patch` | **test** | **ut**（mock 在测试里，删 mock 是改测试）|
| 5 | **实现行为与场景 then 一致** | 据 given→when 复现路径核**实现**产出的可观察值确实 == then（非仅「看起来对」）| **impl** | **impl** |
| 6 | L1+L2 测试是否全绿 | `_test-runner.cjs` 末行 `ok` 字段；红测试要分清「实现没满足 then」(impl) 还是「测试断错」(test) | impl / test | impl / ut |
| 7 | 测试 tail 是否含 NPE/5xx/unhandled | 看 `tail` 是否含边界契约违约签名 → 实现边界处理缺失 | **impl** | **impl** |
| 8 | 上一轮报告 Issue 是否都修了 | 比对 r<N-1> 报告 Issue 清单与当前工作树（impl 维看实现、test 维看测试）| 按原 Issue | 对应节点 |

> 本蓝图无 wd 设计文档 / 无 design.md，故**不审**接口契约字面对齐、数据模型字面对齐、NFR §9.1 实现痕迹、状态机 §9.2 闭环。审查全部围绕「BDD 场景 then 是否被真实、精确、断对 observable 地验证 + 实现行为是否真满足 then」。

## 汇总（主 review，关键）

收齐全部 sub-agent 的 Structured Return Contract（或自查结果）后：

1. **合并** 所有 `perScenario`，按 bdd_id 排序；**去重** 同一 file:line 的重复 Issue。
2. **归类计数**：统计 `failkind=impl` 与 `failkind=test` 各几条。
3. 落盘成**单份**报告（格式见下）——下游 impl / ut 各读自己 failkind 的 Issue。

## FAILKIND 归类规则（本蓝图两类有效路由：test→ut / impl→impl）

- **`FAILKIND: test`（折返 ut）**：检查项 #1/#2/#3/#3b/#4 命中——测试漏标记 / 断言过浅 / 没断 then 精确值 / 断错 observable / mock 顶替可观察面，**根因在测试**。回 ut 修测试，**不让 impl 改业务代码**。
- **`FAILKIND: impl`（折返 impl）**：检查项 #5/#7 命中——实现产出的可观察值 ≠ then / 边界契约违约（NPE/5xx）。回 impl 修实现。
- **同时存在 impl 维与 test 维 Issue → 整体判 `FAILKIND: impl`（impl 优先）**：实现行为是更根本的缺口，先修实现；test 维 Issue 留在报告里，待 impl 维清零后下一轮整体判 `FAILKIND: test` 折返 ut。（这样路由确定、收敛可控。）
- **`FAILKIND: env`**：仅当所有内容缺口都不成立、但 `_test-runner.cjs` tail 命中 ENV 签名。本节点不自修环境，仍 ADVANCE_FAIL（默认折返 impl 修环境）。
- 本蓝图**无 `FAILKIND: design`**：若某 BDD 场景在现有规则下根本不可实现 / 不可写测试（极少见），在报告点明，impl 或 ut 下一轮据此 ADVANCE_BLOCKED 上报人工。

## 产物落盘（关键 — 对抗循环的载体）

落盘到 `.harness/memory/notes/feature-<id>-review-r<N>.md`：
- **N 推断**：`ls -1 .harness/memory/notes/ 2>/dev/null | grep -E "^feature-${TASK_ID}-review-r[0-9]+\.md$"` 取最大序号 + 1；不存在历史则 N=1

报告格式（impl/ut 下一轮 + 后续 review 复审都按此契约读取）：

```markdown
---
task_id: <id>
round: <N>
prev_round: <N-1 | null>
status: failed | ok
failkind: impl | test | env | null    # 整体路由 failkind（impl 优先）
---

# Feature-<id> Review Round <N>

## 总体判定
- **status**: failed | ok
- **failkind**: impl | test | env | null（整体路由；impl 维与 test 维并存时取 impl）
- **reasoning**: 一段话说明本轮核心论据（如「BDD-005 实现返回 user_id 缺失=impl 维；BDD-003 测试断错轴=test 维；本轮整体 impl 优先」）
- **覆盖**: 本轮 N 个 bdd_id 由 M 个 sub-agent 并行核验

## 问题清单（按优先级；每条标 failkind 供对应节点认领）

### Issue #1 — BDD-005 实现未产出 then 要求的 user_id
- **file:line**: `src/foo.py:42`
- **bdd**: BDD-005 then "返回 200 且 body.user_id 等于已创建用户 id"
- **failkind**: impl
- **观察**: 实现 200 但响应体无 user_id 字段
- **修正建议**: 实现里把 created_user.id 写入响应体 user_id

### Issue #2 — BDD-003 测试断错 observable（test 维）
- **file:line**: `tests/test_move.py:20`
- **bdd**: BDD-003 then "位置移动到 (5,6)"
- **failkind**: test
- **观察**: 测试断的是 `pos.x == 5`（只一条轴），未断 `pos == (5,6)`
- **修正建议**: 改测试断言为 `assert pos == (5, 6)` 对齐 then 的 observable；实现已正确，勿动

## 通过项
- BDD-001 ✓ 标记 + 真断言 + 期望值命中 + 实现行为符 then

## 与上一轮比对（仅当 N≥2）
- r<N-1> Issue #1（impl 行为缺口）→ ✓ 已修（commit <sha>）
- r<N-1> Issue #2（test 断错轴）→ ✗ 未修，再次列入本轮
```

## 收尾与 ADVANCE

落盘评审报告后：

- **全部通过**（#1-8 无 Issue，测试全绿，实现行为符 then）→ `{{ADVANCE_OK}}`
- **不通过**（整体 failkind 按上「impl 优先」规则定）：
  - 整体 failkind=impl → `{{ADVANCE_FAIL notes=ROUND <N> FAILKIND: impl — 实现行为不符 then/边界违约，回 impl 修实现；见 .harness/memory/notes/feature-<id>-review-r<N>.md}}`
  - 整体 failkind=test → `{{ADVANCE_FAIL notes=ROUND <N> FAILKIND: test — 测试不忠实 spec（漏标记/浅断言/错 observable/mock 可观察面），回 ut 修测试、勿改实现；见 .harness/memory/notes/feature-<id>-review-r<N>.md}}`
  - 整体 failkind=env → `{{ADVANCE_FAIL notes=ROUND <N> FAILKIND: env — 见 .harness/memory/notes/feature-<id>-review-r<N>.md}}`

> 注意 notes 里的 `FAILKIND:` token 决定折返目标（引擎按 onFail 候选匹配：含 `FAILKIND: test` → ut，否则 → impl）。务必只写一个、与整体判定一致。

## 红旗信号

| 逃避 | 正确动作 |
|---|---|
| "impl 看起来差不多了，放过吧" | review 是对抗者不是友善者，**默认严格**。任何 then 不被精确断言 / 实现行为偏离 then = 打回 |
| "场景多，我只抽查几个" | 必须覆盖全部 task.bdd_ids；多就用 {{AGENT}} 并行分块，别抽查 |
| "sub-agent 内我再派一层 sub-agent 细分" | 禁止。嵌套只允许一层；本块自己核完返回 |
| "impl 维和 test 维都有，我两个 FAILKIND 都写" | 只写一个：并存时取 impl（impl 优先）；test 维留报告，下轮再折返 ut |
| "测试红了一律判 impl" | 要分清：实现没满足 then=impl；测试断错 observable=test。判前确认实现是否真满足 then |
| "evidence 我懒得给具体行号" | 必须给 `file:line`，Issue 报告是 impl/ut 下一轮的导航；无行号 = 无法定位 |
| "把 issue 写得很泛，让对应节点自己理解" | 必须精确到「在 X 文件 Y 行改 Z」；泛化建议 = 浪费对抗轮次 |
