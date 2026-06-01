# 测试三层级 + 自治边界 · 配方表

> 本表是 wd / red / refactor / gate_behavior / st / gate_st 各 SKILL 与脚本的**共同权威源**。
> 上游 SKILL 引用层级 / 边界 / stub 概念时一律从本表落地，**禁止在 SKILL 或脚本里直接写 framework/library/具体类名**——加新栈、新产物类型时只动本表。

---

## 1. 三层级抽象定义（与栈完全解耦）

| 层级 | 范围 | 自治边界内 mock 准则 | 触发节奏 |
|---|---|---|---|
| **L1 轻量 UT** | 验证"单个被测单元的内部逻辑"，可在被测进程内构造任意 fake/in-memory 依赖 | 业务逻辑禁 mock；纯 IO / 时钟 / 随机源可 mock | 每次 R/G/R |
| **L2 中量组件接线** | 验证"多个被测单元的依赖装配 / 配置加载 / 跨组件协议"，在被测进程内拉起真实的依赖图，不跨进程 | **模块边界禁 mock**（同进程内组件之间必须真实接线）；跨进程依赖可用内存替身 | 每个 task 完成时（gate_behavior） |
| **L3 重量端到端** | 验证"对外可观察的端到端行为"——起独立进程 / 真实运行时，从产物对外契约表面发起调用，断言最终态 / 中间态 / 不变式 / 状态机闭环 / NFR | **自治边界内 0 mock**（见 §2）；**边界外不可控依赖必须用契约级 stub**（见 §3）；ad-hoc inline mock 视为 fail | 仅签收阶段（st + gate_st） |

> 与 st SKILL §5 现有的 "L4 BDD 对账" 关系：**L4 是 L3 的子集**——L3 包含 BDD 对账（L4）+ 状态机闭环 + NFR 真断言 + UI 自动化（如有）等"所有需要真实运行时的"验证。

### 1.1 层级判定提示词（给 wd SKILL 用）

按 BDD scenario 的 `then` 描述判：

- `then` 涉及的可观察值"只读单元内部"（返回值 / 内部数据结构 / 内部计算结果）→ **L1**
- `then` 涉及"依赖装配、配置加载、跨组件协议、模块边界契约"→ **L2**
- `then` 涉及"对外契约的可观察行为、长序列状态机闭环、NFR 阈值、UI 上可见的状态变化"→ **L3**
- 一条 BDD 可有**多个层级**；若 `then` 描述了"对外可观察的最终态"则 **L3 不可省**
- 整条 feature 的所有 BDD 加起来 **L3 行数 ≥ 1**（或显式声明 `L3 N/A 因为…`）

---

## 2. 自治边界（self-contained boundary）

产物的**可被自身代码 + 测试环境完全控制**的范围。

| 在自治边界内（必须真实，L3 0 mock） | 在自治边界外（L3 允许契约级 stub） |
|---|---|
| 被测产物自身的入口表面（HTTP 路由 / CLI / public API / UI） | 第三方 SaaS API（如外部 LLM / 支付 / CRM / 邮件等） |
| 自己写的所有 controller / service / repo / domain | 不可达的内部上游系统（mainframe / 专有 ERP 等） |
| 自己 own 的 DB（可在测试环境真跑） | 硬件设备 / 物联网传感器 |
| 自己 own 的消息队列 / 缓存 / 配置中心 | 受访问限额 / 付费 / 灰度的 API |
| 自己 own 的密钥仓库（测试用密钥） | 跨组织接口、跨网络分区的服务 |

### 2.1 边界判定规则（三选一即归外）

1. 测试环境能否启动一个该依赖的真实实例（哪怕 docker 化）？→ **不能** → 边界外
2. 调用该依赖是否有真实代价（钱、配额、风险）？→ **有** → 边界外
3. 该依赖是否非本产物 own 的代码资产？→ **是** → 边界外

> 若三条都否则归边界内。**模糊归外，避免把"假装能跑"的依赖当真**。

---

## 3. 契约级 stub 策略（与"随手 mock"严格区分）

L3 在自治边界外的 stub **必须同时满足**：

| 约束 | 含义 | 反例 |
|---|---|---|
| **契约来源可追溯** | stub 必须基于真实契约文档（OpenAPI / gRPC proto / SDK 接口 / 官方示例响应 / 录制 cassette） | 测试里随手编一个返回值，无任何契约引用 |
| **行为可重放** | 用 VCR cassette / wiremock recording / contract test 等记录方式，**证据归档到 `.harness/l3-stubs/<dep-name>/`** | inline `return {ok: true}`，无可重放证据 |
| **stub 集中清单** | design.md §自治边界 + 外依赖契约清单 列出每个外依赖：`name / boundary=external / contract_source / stub_strategy / evidence_path` | 测试代码各处散落 mock，无集中清单 |
| **不允许 ad-hoc inline mock** | 测试代码里 inline 写 `mock.return_value=…` / `vi.mock(...)` 顶替外依赖 → 视为 fail（必须走集中策略） | `from unittest.mock import patch; @patch('requests.post')` 直接顶替外部 API 调用 |

> **关键**：L3 的"0 mock"理想保护**自治边界内**部分；边界外现实主义允许契约级 stub。两者绝对不混淆——边界内的任何 mock 仍是 L3 fail。

---

## 4. 死循环逃生通道（gate_st 触发，详见 gate_st SKILL）

同一个 task 在 L3 mandatory 上连续打回 ≥ **3 次**（可由 `BP_L3_MAX_RETRIES` env 调，默认 3），自动触发降级评审：

| 选项 | 含义 | 路由 | 留痕 |
|---|---|---|---|
| **A. stub 升级** | 把某外依赖从轻量 stub 升级为契约级 stub + 真实重放 cassette | 回 wd 改 §外依赖契约清单 | `.harness/l3-escapes/<runId>-A-<taskId>.md` 记录原因 |
| **B. 边界重划** | 该依赖被错判为"自治边界外"或"内"——重划边界 | 回 design 修 §自治边界清单 | `.harness/l3-escapes/<runId>-B-<taskId>.md` |
| **C. 显式降级到 L2.5** | 本特性的 L3 在当前阶段确无法真跑——明示降级 | 进 deferred-backlog 跟踪，不阻塞 st | `.harness/l3-escapes/<runId>-C-<taskId>.md` + deferred-backlog 票据 |
| **D. 阻塞 + 人工接管** | 工程或基础设施问题超出本蓝图能力 | `BLOCKED` 通知人工 | `.harness/l3-escapes/<runId>-D-<taskId>.md` |

> **关键**：每次降级都留痕——避免"逃生通道"被滥用成"任意绕过"。蓝图可周期性统计 `.harness/l3-escapes/` 下文件数作为健康指标。

---

## 5. 按 product_type × stack × has_frontend_ui 的落地配方

> 表中工具名仅作**示例选项**——具体项目可在 design.md §11.7 / `tool-commands-guide.md` 里替换为自选工具，只要符合层级语义即可。
> 蓝图脚本读 `tool-commands-guide.md` 取实际命令，**不硬编**任何工具名。

### 5.1 product_type=network-service（HTTP / gRPC / 消息队列服务）

| stack | UI | L1 落地示例 | L2 落地示例 | L3 落地示例 | L3 边界外 stub 工具示例 |
|---|---|---|---|---|---|
| java/maven | false | junit unit | spring test context (`webEnvironment=NONE`) | 独立 jvm + http client | wiremock / restassured-cassette |
| java/maven | true | + L1 ui-unit | + L2 controller test | + L3-UI 浏览器自动化驱动 | 同上 + ui mock-server |
| node/npm | false | jest/vitest unit | supertest（app instance） | `npm start` + httpx/fetch + assertions | msw / nock-cassette |
| node/npm | true | + 组件单测 | + 路由组件挂载测 | + L3-UI 浏览器自动化驱动 | 同上 |
| python/pytest | false | pytest unit | app fixture（`TestClient` 类） | uvicorn/gunicorn + httpx | responses / vcrpy |
| python/pytest | true | + 组件单测 | + page-render fixture | + L3-UI | 同上 |
| go | false | `go test ./...` unit | `httptest.Server` | 独立 binary + http client | mockable interface + recorded responses |
| rust/cargo | false | `cargo test` unit | `axum::Router::oneshot` 类 | 独立 binary + reqwest | wiremock-rs |
| dotnet | false | mstest/xunit unit | `WebApplicationFactory` | 独立 host + HttpClient | wiremock.net |
| c / cmake | false | unity / cmocka / criterion unit | 真实 socket / pipe in test fixture | 独立 binary + libcurl / `curl` shell 调 | mock-server / wiremock standalone |
| cpp / cmake | false | gtest / catch2 unit | `httplib::Client` 内嵌测试 | 独立 binary + cpr / libcurl | wiremock standalone / pact-cpp |

### 5.2 product_type=cli

| stack | L1 | L2 | L3 | L3 边界外 stub 示例 |
|---|---|---|---|---|
| python | unittest/pytest | `click.testing.CliRunner` 类 | subprocess 真调命令 + 真 FS | responses / vcrpy |
| node | jest unit | `commander`/`yargs` 内部调用 | 真子进程 + 真 FS | nock |
| go | `go test` unit | command 函数直接调 | `exec.Command` 真跑 | gock |
| rust | `cargo test` unit | command 函数直调 | `assert_cmd` 真跑 | wiremock-rs |
| c / cmake | unity / cmocka 单元 | 函数级直接调 | 真 binary + shell 测试（含 stdout/stderr/exit 断言） | mock-server / 文件 fixture |
| cpp / cmake | gtest / catch2 单元 | 函数级直接调 | 真 binary + shell/python 驱动测试 | 同上 |

### 5.3 product_type=library

| stack | L1 | L2 | L3 |
|---|---|---|---|
| 任意 | 单元为主（最重） | integration test 互调 | **通常 N/A**（端到端验证由消费方负责）；若有 demo/example 项目可在那里跑 L3 |
| c 静态/动态库 (.a/.so/.dll) | unity / cmocka / criterion | 与消费 C 程序 link 测试 | demo 程序 + valgrind / ASan / UBSan 跑 |
| cpp 静态/动态库 / header-only | gtest / catch2 / doctest | 模板实例化测试 + ABI 兼容性测 | demo 程序 + sanitizer 套件 |

> Library 类项目 wd 可显式声明 `L3 N/A 因为是 library，端到端由消费侧验证`；gate_st 条件触发跳过 L3 mandatory。

### 5.4 product_type=webapp（前端为主）

| stack | L1 | L2 | L3（必含 UI 自动化） |
|---|---|---|---|
| react/vue/svelte + vite/webpack | 组件单测（jest/vitest） | 路由+组件挂载测（react-testing-library / vue test utils） | 浏览器自动化（playwright / cypress / selenium 等） + 真 backend（或契约 stub backend） |
| 同上但用 SSR/Astro/Next | 同上 | 同上 + SSR fixture | 同上 |

### 5.5 product_type=daemon / worker（无网络入口）

| stack | L1 | L2 | L3 |
|---|---|---|---|
| 任意 | 单元为主 | 调度器+处理器接线测 | 起真实 daemon 进程 + 投递真实事件/信号 + 观察输出 |

### 5.6 product_type=sdk / plugin

| stack | L1 | L2 | L3 |
|---|---|---|---|
| 任意 | 单元 | 与 host 框架的接线测 | 起最小 host 实例真加载 plugin + 触发回调验证 |

### 5.7 stack=other（兜底）

不给具体工具，给抽象规则：

- **L1** = 本语言/框架原生的单元测试运行器
- **L2** = 同进程内拉起真实依赖容器/上下文/DI 的测试范式
- **L3** = 起独立进程/真实运行时，从对外契约表面发起调用
- **stub** = 任何能保真重放契约的工具（cassette / mock server / contract testing）
- **tag** = 本栈惯用的"测试分组"机制（如 JUnit `@Tag` / pytest mark / Go build tag / vitest config / jest projects）

---

## 6. UI 自动化桥接（`has_frontend_ui=true` 时强制）

详见 `ui-automation-bdd-bridge.md`——本表只给"按 stack 选工具"的指引：

| stack | UI 自动化驱动示例 |
|---|---|
| node + react/vue 等 | playwright / cypress |
| python | playwright-python / selenium |
| java | playwright-java / selenium-java |
| go | rod / chromedp |
| rust | thirtyfour / fantoccini |

具体选哪个由项目自决，写进 `tool-commands-guide.md`，蓝图脚本读它取启动+执行命令。

---

## 7. SKILL / 脚本如何读本表

| 角色 | 读本表的方式 |
|---|---|
| **wd SKILL** | 按 `project-context.md` 的 `product_type + stack + has_frontend_ui` 查 §5 对应行，把"L1/L2/L3 落地示例"作为 §测试清单各行"类别"列的语义补充（L1-FUNC / L2-INTG / L3-INTG 等） |
| **red SKILL** | 同上；编写测试时按 §3 stub 准则选 stub 工具，禁 ad-hoc inline mock |
| **refactor SKILL** | 与本表无直接 IO，仅做异味自检（读 `code-smell-checklist.md`） |
| **gate_behavior.cjs** | 读 §1.1 层级判定 + §2 边界判定 + §3 stub 准则，扫工作区按这些规则采证；具体命令从 `tool-commands-guide.md` 取 |
| **st SKILL** | 按 §1 L3 定义跑签收；按 §3 stub 策略管外依赖；按 §6 起 UI 自动化（若有） |
| **gate_st.cjs** | §4 死循环逃生通道在此触发；统计 `.harness/l3-escapes/` 健康指标 |

---

## 8. 加新栈 / 新产物类型 = 零脚本零 SKILL 改

| 你要做的 | 改哪里 |
|---|---|
| 加 product_type（如 `mobile` / `desktop`）| 在 §5 加一节 |
| 加 stack（如 `kotlin/gradle` / `elixir/mix`）| 在对应 product_type 表加一行 |
| 加 stub 工具 | 在 §3 反例下方补一行 + `external-dependency-contracts.md` 加映射 |
| 加 UI 自动化驱动 | 在 §6 加一行 + `ui-automation-bdd-bridge.md` 加语法节 |

**禁止**：改任何 SKILL.md / 任何 gate_*.cjs / 任何 _\*.cjs 共享件——若必须改它们才能加新栈，说明本表设计有缺陷，提 issue。
