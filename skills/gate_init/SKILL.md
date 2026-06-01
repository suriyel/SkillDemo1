---
name: gate_init
description: Init 硬门 — 脚本门禁 review skill：运行 gate_init.cjs 校验产物，并按 OK/FAIL/BLOCKED 三态回报框架。
---

# Init 硬门

<!-- gate-wrapper: shared-scripts/gate_init.cjs -->
## 门禁校验（本节点唯一职责）
1. 运行校验脚本：`node {{SCRIPTS}}/gate_init.cjs`。
2. 阅读脚本输出（stdout / 退出码，可能是 JSON 也可能是纯文本），自行判定校验结论，按三态收尾：
   - **通过** → {{ADVANCE_OK}}
   - **未通过**（脚本明确判定不达标）→ {{ADVANCE_FAIL notes=<把不达标原因/整改要点写清，回传上游>}}（触发整改打回）
   - **脚本跑不起来 / 缺依赖 / 无法判定** → {{ADVANCE_BLOCKED notes=<原因>}}（若属一步可修的依赖缺失，可先修后重跑，勿反复空耗）
3. 不要臆测脚本结果，必须真正运行脚本后再判定；bp-advance 是本回合最后一个动作，调用后立即结束本回合。
