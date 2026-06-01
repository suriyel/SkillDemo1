---
name: gate_bdd
description: BDD 硬门 review skill：先运行 gate_bdd.cjs 校验 bdd.json 的结构/字段规范性，再人工复核各场景在用户输入文档规则下的逻辑自洽性，按 OK/FAIL/BLOCKED 三态回报框架。
---

# BDD 规范性硬门

<!-- gate-wrapper: shared-scripts/gate_bdd.cjs -->
## 门禁校验（本节点唯一职责）

1. **结构规范性 + 原文引文真伪（脚本机检）**：运行 `node {{SCRIPTS}}/gate_bdd.cjs`，阅读其输出（stdout / 退出码，可能是 JSON 也可能是纯文本），判定 bdd.json 的结构与字段是否规范。脚本还机检：凡 `derivation` 引用 `original-requirements.md` 且带显式引文的，引文须为 `intent/original-requirements.md` 的逐字真子串（造假/抄错引文 → 硬 fail；原文文件缺失但有人引用 → 软告警，提示 bdd 落盘原文）。

2. **逻辑自洽性（人工复核；脚本只验 `derivation` 存在/非空，不验其对错）**：Read `{{HARNESS_MEMORY_DIR}}/intent/original-requirements.md`（用户输入文档）+ `{{HARNESS_MEMORY_DIR}}/notes/rules/`（若存在）与 bdd.json，逐场景**照其 `derivation` 推导链复核**三点：① `derivation` 引用的规则确在用户输入文档（`original-requirements.md` 对应行号）或 scan 存量约定中存在、且取值无误；② 从 `given` 按该规则逐步施加 `when`，确能推出 `derivation` 写的结果（中途不会被规则拒绝或中断）；③ 该结果与 `then` 逐字段一致。任一环节对不上（规则取值抄错、推导跳步、`then` 与推导值不符），即为明确矛盾。仅就**明确**的矛盾或不可推得判负，并指实矛盾点（哪个场景、`derivation` 哪一步、与哪条规则冲突）。本蓝图无 SRS / FR-id，feature 不含 `fr` 字段属正常。

3. **三态收尾**（本回合最后一个动作）：
   - **结构规范且场景自洽** → {{ADVANCE_OK}}
   - **结构不规范，或存在明确自相矛盾/不可推得的场景** → {{ADVANCE_FAIL notes=<写清不规范原因，或矛盾场景 id、矛盾点与整改方向，回传上游 bdd 节点>}}（触发整改打回 → bdd 修正或重出 JSON）
   - **脚本跑不起来 / 缺依赖 / 读不到 bdd.json / original-requirements.md / 无法判定** → {{ADVANCE_BLOCKED notes=<原因>}}（一步可修的依赖缺失可先修后重跑，勿反复空耗）

不要臆测：必须真正运行脚本、读完用户输入文档与 bdd.json 后再判定。bp-advance 是本回合最后一个动作，调用后立即结束本回合。
