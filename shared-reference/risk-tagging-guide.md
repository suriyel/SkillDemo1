# 风险等级判定指南（FR / scenario / task 通用）

**用途**：给每条 FR / scenario / task 赋 `risk: critical | normal | trivial`，让下游 gate_bdd / gate_st / review 按权重分层判定，避免"30 条 BDD 均匀对待"导致关键场景被稀释。

**核心判据**：影响范围 × 失败代价 × 可逆性。三维独立打分、按下方决策树合成等级。**不要按业务直觉拍**——业务直觉容易把"自己最熟悉的"标 critical、把"刚学的"标 trivial。

---

## 三个维度

### 维度 A：影响范围（Scope）

| 等级 | 判别 |
|---|---|
| **broad** | 影响所有用户 / 所有数据 / 系统主路径 / 核心契约 |
| **medium** | 影响某子集（部分角色 / 部分场景 / 部分数据类） |
| **narrow** | 影响单一边缘场景 / 单一非主要用户群 |

### 维度 B：失败代价（Cost-if-broken）

| 等级 | 判别 |
|---|---|
| **severe** | 数据损坏 / 资金损失 / 人身风险 / 法务后果 / 安全事故 / 完全不可用 |
| **moderate** | 体验恶化但有降级路径 / 单次失败可重试 / 显著功能缺失但有 workaround |
| **mild** | 美观瑕疵 / 性能边缘退化 / 非关键日志缺失 |

### 维度 C：可逆性（Reversibility）

| 等级 | 判别 |
|---|---|
| **irreversible** | 一旦发生不可撤销（数据被删、消息已发、款项已转、外部状态已变） |
| **hard** | 可逆但代价高（需人工介入 / 长时间补偿 / 数据回滚链复杂） |
| **easy** | 重试 / 重启 / 撤销操作即可恢复 |

---

## 等级判定决策树

按以下顺序判定，命中即定级、不再向下：

1. **任一维度命中"红线"** → `critical`
   - 失败代价 = severe（数据损坏 / 资金 / 人身 / 法务 / 安全）
   - 或 可逆性 = irreversible 且 影响范围 ≥ medium
   - 或 涉及"用户没察觉但系统行为已偏离预期"的隐性失效（如"路过危险区无任何反馈"——失败时用户毫不知情，无补救窗口）

2. **影响范围 = broad 且 失败代价 ≥ moderate** → `critical`
   - 主路径上多人受影响的功能性失效

3. **失败代价 = moderate 且 可逆性 ≤ hard** → `normal`
   - 体验恶化但可恢复

4. **维度全部温和**（影响窄 + 代价轻 + 易恢复） → `trivial`
   - 美化、文案、边缘配置项

---

## 跨领域示例（领域无关定级）

| 场景 | 影响 | 代价 | 可逆 | 等级 | 理由 |
|---|---|---|---|---|---|
| 移动端登录主流程鉴权失败 | broad | severe | hard | critical | 全员阻塞 |
| 后台报表加载慢 5 秒 | medium | mild | easy | normal | 体验降级有 workaround |
| 物联网设备进入"危险区"无告警 | broad | severe | irreversible | critical | **隐性失效**：用户不知道事故已发生 |
| 离线数据同步幂等失败 → 重复导入 | medium | severe | irreversible | critical | 数据污染难恢复 |
| 错误码文案错别字 | narrow | mild | easy | trivial | 美观瑕疵 |
| API 文档示例代码版本旧 | narrow | mild | easy | trivial | 用户可对照真实 schema 修正 |
| 一组同源 CRUD 接口中"删除"未实现 | medium | moderate | easy | normal | 缺一个动作但可手工补 |
| 服务端定时任务漏跑一次 | broad | moderate | hard | normal | 下次能补但本次窗口缺失 |
| 算法库在某极端输入下溢出返回错误结果 | medium | severe | irreversible | critical | 调用方信赖错误结果继续计算 |
| CLI 命令的进度条卡顿 | narrow | mild | easy | trivial | 不影响实际产物 |
| 数据管道某记录字段丢失但仍写入下游 | broad | severe | irreversible | critical | 静默污染下游 |
| 编辑器主题色稍偏 | narrow | mild | easy | trivial | 美化 |

---

## 用法规则

### 在 req 节点

- **每条 FR 必须有 `risk` 字段**，由模型按上述决策树推断、在 §4.1 表格 / EARS 主体附近显式标出
- 模型不确定时，**问用户一次**（在 Step 3 Gap Fill 内）：「这条若失败会怎样？用户能否察觉？多久能恢复？」据此推断
- 标 critical 的 FR 需在 SRS 中附**一句失败影响说明**（≤30 字）

### 在 bdd 节点

- scenario `risk` 默认继承自所属 feature 的 `fr[]` 中**最高等级**（critical > normal > trivial）
- 也可显式覆盖（如某 normal FR 下的一个 negative scenario 单独标 critical）
- gate_bdd 硬门：critical FR 必须有 ≥1 happy + ≥2 negative 场景（normal ≥1 negative，trivial 可只 happy）

### 在 design / wd / task 节点

- task `risk` 从 task.bdd_ids[] 中**最高等级**继承
- critical task 在 wd 阶段需明确"独立验证证据"形态（参见 evidence-independence-recipes.md）

### 在 gate_st

- critical 场景的 evidence 必须含 `independence_kind` 字段（独立验证渠道），不能只是"测试报告 PASS"
- normal 场景按现有 evidence 非空即可
- trivial 场景豁免 evidence 字段（但仍需 verdict）

---

## 反模式

| 合理化 | 正确动作 |
|---|---|
| "全部标 critical 最安全" | risk 是分层信号；全 critical = 无分层 = 等于没标 |
| "用户没说重要性就一律 normal" | 按决策树客观判，不依赖用户主观重要性 |
| "performance 都不算 critical 因为'又不会坏'" | 看失败代价 + 可逆性：算法库错误结果 / 实时控制超时确属 critical |
| "按 MoSCoW 的 Must 直接映射 critical" | MoSCoW 是优先级（要不要做），risk 是质量门权重（做完了要查多深）；不重叠 |
| "trivial 就不查了" | trivial 仍要 ≥1 happy 测试；只是不强制独立证据和 negative 分层 |

---

## 扩展机制

- 三维度可加权重（团队若有偏好可在末尾追加权重表）
- 决策树阶可加新分支（如"涉及外部资金流"= 强制 critical）
- 跨领域示例表用户可扩充本团队的典型场景
