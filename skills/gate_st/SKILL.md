---
name: gate_st
description: ST 验收对账硬门 — 脚本门禁 review skill：运行 gate_st.cjs，逐字段机检结构化 JSON 验收报告 st-acceptance.json 的 bdd_reconcile[] 是否覆盖 bdd.json 全部场景且均 verdict=PASS + evidence 非空、整体非 No-Go、无未关闭 Critical/Major，并真跑全量回归兜底；缺失/FAIL/无证据即打回 st，按 OK/FAIL/BLOCKED 三态回报框架。本蓝图无 SRS / Design：无 L3 重量级签收。
---

# ST BDD 对账硬门（顶层，置于 st 之后）

校验系统测试是否在真实集成环境对**每一条** BDD 场景做了行为对账——这是与 loop 内 `gate_review`（单测/特性级）互补的系统级闸，捕获「单测真断言但集成接线断了」的逃逸。本蓝图无 SRS / Design，故**不做** L3 重量级签收（l3-signoff.json / NFR 实测 / 状态机 lifecycle / 外依赖 stub 证据），唯一对账权威源是 `bdd.json`。

<!-- gate-wrapper: shared-scripts/gate_st.cjs -->
## 门禁校验（本节点唯一职责）
1. 运行校验脚本：`node {{SCRIPTS}}/gate_st.cjs`。脚本做 **BDD 对账验证 + 全量回归兜底**：
   - st-acceptance.json 的 `bdd_reconcile[]` 覆盖 bdd.json 全部场景且均 `verdict=PASS` + `evidence` 非空、整体非 No-Go、无未关闭 Critical/Major
   - 真跑全量回归测试套件（多语言多 build 根）：哪怕 bdd_reconcile 全标 PASS，测试套件真跑非全绿就一票否决
2. 阅读脚本输出（stdout 末行 JSON `{pass, message, blocked}`），按三态收尾：
   - **`pass === true`** → {{ADVANCE_OK}}
   - **`pass === false && blocked === false`**（BDD 对账有缺：场景未对账 / 判为 FAIL / PASS 但无 evidence / 整体 No-Go / 有未关闭 Critical/Major / 回归不绿）→ {{ADVANCE_FAIL notes=<把未对账或 FAIL 的 scenario id 与整改要点写清，回传上游 st 节点>}}（引擎 onFail 把 st 节点回卷——st 会据失败 seed bugfix-task 进 iter）
   - **`blocked === true`**（st-acceptance.json 缺失 / 非合法 JSON / bdd.json 不可读 / 无法判定）→ {{ADVANCE_BLOCKED notes=<原因>}}
3. 不要臆测脚本结果，必须真正运行脚本后再判定；bp-advance 是本回合最后一个动作，调用后立即结束本回合。
