---
name: gate_review
description: 脚本机检硬门 — loop iter 体内 review 之后；运行 gate_review.cjs 真跑测试 + 静态层（BDD 覆盖+断言深度）+ 动态层（then 期望 token 命中）+ 边界契约违约信号，按机检结果回报 OK / FAIL / BLOCKED 三态。本蓝图无 design：不检状态机/NFR。
---

# 脚本机检硬门（loop 内，置于 review 之后）

本节点是「双层质量保障」的客观事实层：上游 review 是 LLM 主观挑刺，本门是脚本机检客观事实兜底——**review 漏判的客观缺口由本门抓回**。

**与 review 互补**：review 看语义（断言深度判定/断对 observable/mock 反模式），本门看事实（测试是否真绿/BDD id 是否真存在/标记附近是否有真断言/then 精确值是否命中）。**测试由独立的 ut 节点据 bdd.json 编写**（非实现作者 impl 自证），故 grep BDD 标记 / then 精确值的机检合法、保留全部牙齿。本蓝图无 SRS / Design / wd，故**不检**状态机闭环（design §9.2）与 NFR 实现痕迹（design §9.1）。

**开始时宣告**："I'm using the gate_review skill. Time to verify objective facts."

<!-- gate-wrapper: shared-scripts/gate_review.cjs -->

## 门禁校验（本节点唯一职责）

1. 运行机检脚本：`node {{SCRIPTS}}/gate_review.cjs`
2. 读 stdout —— 多行「证据报告」+ 最后一行 JSON `{pass, message, blocked}`
3. 按机检结果分流回报：

   - **`pass === true`** → `{{ADVANCE_OK}}`
   - **`blocked === true`**（脚本判定环境/上下文问题，如 state.json 不可读、bdd.json 缺失、纯 ENV 签名）→ `{{ADVANCE_BLOCKED notes=<message>}}`
   - **`pass === false && blocked === false`**（内容缺口）→ `{{ADVANCE_FAIL notes=<脚本 message 原文>}}`

   脚本 message 已带 `[CONTENT-GAP][FAILKIND: test]` / `[CONTENT-GAP][FAILKIND: impl]` / `[ENV-FIXABLE][FAILKIND: env]` 前缀，**原样回传即可**——blueprint.json 的 onFail 候选据此路由：
   - `FAILKIND: test`（测试编写缺口：漏 BDD 标记 / 断言过浅 / then 精确值无命中）→ 折返 **ut** 补/修测试（测试由独立的 ut 节点据 bdd.json 编写，非代码作者自证，故机检合法）；
   - `FAILKIND: impl`（实现行为缺口：测试不绿非 env / 边界契约违约）→ 折返 **impl** 修实现；
   - 并存时脚本已按 **impl 优先**标 impl。本蓝图无 wd，故无 `FAILKIND: design` 折返。

## 关键约束

- **本节点不改实现代码**（与所有 gate-* 节点一致）
- **必须真跑** `node {{SCRIPTS}}/gate_review.cjs`，不得跳过或仅按上一轮记忆判定
- **末行 JSON 不可解析**（脚本崩溃 / 输出截断）→ `{{ADVANCE_BLOCKED notes=gate_review.cjs 末行非合法 JSON：<前 200 字符>}}`

## 红旗信号

| 逃避 | 正确动作 |
|---|---|
| "脚本判 fail 但我觉得没事 → 放过" | 这是硬门，机检失败必须如实上报；放过 = 失职 |
| "脚本说测试不绿但其实是环境问题，直接 OK" | 不行；若真是 ENV 签名脚本会自动判 blocked；脚本判 fail 而你觉得是 env → ADVANCE_BLOCKED 让上游识别 |
| "review 已经放过了我也跟着放过" | review 是主观挑刺、本门是客观事实兜底；二者独立判定 |
| "脚本 message 的前缀我改一下" | 不要改 FAILKIND 前缀；原样回传，引擎据此路由回 impl |
