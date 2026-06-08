---
name: requirements
description: Extract a brief requirements doc from the user prompt and write it to {{HARNESS_MEMORY_DIR}}/plans/requirements.md.
---

# 需求提取

从用户最新消息中识别核心需求，产出 **1 页 markdown** 作为下游 design 阶段的输入。

## 步骤

1. 执行 `mkdir -p {{HARNESS_MEMORY_DIR}}/plans/`，若目录创建失败则调用 `bp-advance failed "创建 plans 目录失败"`。
2. 写入 `{{HARNESS_MEMORY_DIR}}/plans/requirements.md`，内容含：
   - **项目目标**（1-2 句）
   - **核心功能**（3-5 条）
   - **非功能要求**（性能/安全/兼容性，可省）
   若文件写入失败则调用 `bp-advance failed "写入 requirements.md 失败"`。
3. 调用 `bp-advance ok` 结束本节点。