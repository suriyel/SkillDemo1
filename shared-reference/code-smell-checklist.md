# 代码异味清单（多语言正则库）

> 由 refactor SKILL 的"§异味自检"阶段读取，调 `_code-smells.cjs` 按本项目 `project-context.md` 里的 `language` 字段选对应正则集合扫源码。
> 设计原则：**报告但不阻塞** —— 异味是 advisory，由 refactor reviewer 子代理判真 bug 还是误报，写进 ticket 给后续 gate_behavior 整合采证。

---

## 1. 通用语义（与栈无关）

| 异味类型 | 含义 | 风险 |
|---|---|---|
| **空 catch / 注释 catch** | 异常被捕获但无任何处理（不重抛、不日志、不补救） | 真 bug 被沉默吞掉，触发后排查难 |
| **吞异常的 catch** | catch 后只有 `// TODO` 类注释或 `pass` | 同上 |
| **调试遗留 println / print / log** | 临时调试输出残留 | 生产噪音；可能泄露敏感信息 |
| **TODO / FIXME / XXX / HACK 注释** | 未完成或临时方案 | 真实债务 |
| **被禁用的测试** | `@Disabled` / `@Ignore` / `xit` / `xdescribe` / `skip` | 测试失效掩盖回归 |
| **死代码** | 未被引用的 export / 函数 / 类 | 维护成本 + 误导 |
| **过宽的异常捕获** | `catch (Exception)` / `except:` 无类型 | 漏过真正应处理的具体异常 |

---

## 2. 按语言的正则库

> `_code-smells.cjs` 按 `project-context.md` 的 `language` 字段选对应节扫源码（排除 `.harness` / `node_modules` / `dist` / `target` / `build` / `.git` / `__pycache__` / `venv` 等）。

### 2.1 java

```yaml
language: java
extensions: [.java]
patterns:
  - id: empty-catch
    description: 空 catch 块（异常被沉默吞掉）
    regex: 'catch\s*\([^)]+\)\s*\{\s*\}'
    severity: high
  - id: comment-only-catch
    description: catch 块内仅注释，无任何处理
    regex: 'catch\s*\([^)]+\)\s*\{\s*//[^\n]*\n\s*\}'
    severity: high
  - id: println-debug
    description: System.out.println 调试输出
    regex: 'System\.out\.println'
    severity: medium
  - id: printstacktrace-only
    description: 仅 printStackTrace 而无重抛/日志
    regex: 'catch\s*\([^)]+\)\s*\{\s*\w+\.printStackTrace\(\);?\s*\}'
    severity: high
  - id: disabled-test
    description: @Disabled / @Ignore 测试
    regex: '@(Disabled|Ignore)\b'
    severity: medium
  - id: wide-catch
    description: catch (Exception) 过宽
    regex: 'catch\s*\(\s*Exception\s+\w+\s*\)'
    severity: low
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.2 python

```yaml
language: python
extensions: [.py]
patterns:
  - id: bare-except
    description: 裸 except 捕获所有异常
    regex: 'except\s*:'
    severity: high
  - id: except-pass
    description: except 后仅 pass，沉默吞异常
    regex: 'except[^:]*:\s*pass(?:\s|$)'
    severity: high
  - id: except-only-comment
    description: except 后仅注释
    regex: 'except[^:]*:\s*#[^\n]*\n\s*(?:pass)?'
    severity: high
  - id: print-debug
    description: print 调试遗留（排除 # 后的注释）
    regex: '(?<!#)\s*print\s*\('
    severity: low
  - id: skip-test
    description: pytest.skip / @pytest.mark.skip
    regex: '(@pytest\.mark\.skip|pytest\.skip\()'
    severity: medium
  - id: wide-except
    description: except Exception 过宽
    regex: 'except\s+Exception\s*[:as]'
    severity: low
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '#.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.3 javascript / typescript

```yaml
language: javascript
extensions: [.js, .jsx, .mjs, .cjs, .ts, .tsx]
patterns:
  - id: empty-catch
    description: 空 catch 块
    regex: 'catch\s*\([^)]*\)\s*\{\s*\}'
    severity: high
  - id: comment-only-catch
    description: catch 块内仅注释
    regex: 'catch\s*\([^)]*\)\s*\{\s*//[^\n]*\n\s*\}'
    severity: high
  - id: console-log-debug
    description: console.log 调试遗留
    regex: '\bconsole\.(log|debug)\s*\('
    severity: low
  - id: xit-xdescribe
    description: 跳过的测试（xit / xdescribe / it.skip / describe.skip）
    regex: '\b(xit|xdescribe|it\.skip|describe\.skip|test\.skip)\s*\('
    severity: medium
  - id: ts-ignore
    description: '@ts-ignore / @ts-nocheck'
    regex: '//\s*@ts-(ignore|nocheck)'
    severity: medium
  - id: ts-any
    description: 显式 any 类型
    regex: ':\s*any\b'
    severity: low
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.4 go

```yaml
language: go
extensions: [.go]
patterns:
  - id: err-ignored
    description: 错误返回被丢弃（_ = ... 形式）
    regex: '_\s*=\s*\w+\([^)]*\)'
    severity: medium
  - id: err-no-handle
    description: 'if err != nil 块为空'
    regex: 'if\s+err\s*!=\s*nil\s*\{\s*\}'
    severity: high
  - id: fmt-println-debug
    description: fmt.Println 调试遗留（应改 log）
    regex: '\bfmt\.Println\s*\('
    severity: low
  - id: skip-test
    description: t.Skip
    regex: '\bt\.Skip\s*\('
    severity: medium
  - id: panic-recover-empty
    description: 'recover() 后无处理'
    regex: 'recover\(\)\s*[;\n]\s*\}'
    severity: high
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.5 rust

```yaml
language: rust
extensions: [.rs]
patterns:
  - id: unwrap-prod
    description: '.unwrap() 调用（生产代码应换为 ? 或显式 match）'
    regex: '\.unwrap\(\)'
    severity: medium
  - id: expect-debug-msg
    description: '.expect("TODO") 调试遗留'
    regex: '\.expect\s*\(\s*"(TODO|FIXME|todo|fixme)'
    severity: high
  - id: println-debug
    description: println! 调试遗留
    regex: '\bprintln!\s*\('
    severity: low
  - id: ignored-test
    description: '#[ignore] 跳过测试'
    regex: '#\[\s*ignore\s*\]'
    severity: medium
  - id: todo-macro
    description: 'todo!() / unimplemented!() / unreachable!()'
    regex: '\b(todo!|unimplemented!|unreachable!)\s*\('
    severity: high
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.6 c（纯 C，无 try/catch）

```yaml
language: c
extensions: [.c, .h]
patterns:
  - id: unchecked-return
    description: 函数返回值未检查的常见高风险调用（malloc/realloc/fopen/open）
    regex: '^\s*(malloc|realloc|calloc|fopen|open|socket|pipe)\s*\([^;]*\)\s*;'
    severity: high
  - id: unsafe-str
    description: 不安全字符串函数（strcpy/strcat/sprintf/gets 无 bounds check）
    regex: '\b(strcpy|strcat|sprintf|gets)\s*\('
    severity: high
  - id: empty-err-handle
    description: errno/err 判断分支为空
    regex: 'if\s*\([^)]*\b(errno|err)\b[^)]*\)\s*\{\s*\}'
    severity: high
  - id: goto-fail
    description: 'goto 跳到 fail/cleanup 但 cleanup 块为空（典型空清理路径）'
    regex: '^\s*(fail|cleanup|error|out|done)\s*:\s*\n\s*return'
    severity: medium
  - id: printf-debug
    description: 'printf 调试遗留（含 DEBUG / TODO / FIXME 字样）'
    regex: '\b(printf|fprintf)\s*\(\s*(stderr\s*,\s*)?"(DEBUG|TODO|FIXME|XXX)'
    severity: medium
  - id: magic-buffer-size
    description: 'magic number 当缓冲大小（如 char buf[1024]）—— 仅 advisory'
    regex: 'char\s+\w+\s*\[\s*(\d{3,})\s*\]'
    severity: low
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b|/\*.*\b(TODO|FIXME|XXX|HACK)\b.*\*/'
    severity: low
```

### 2.7 cpp（C++，可有 try/catch + RAII + 现代 C++ 特性）

```yaml
language: cpp
extensions: [.cpp, .cc, .cxx, .hpp, .hh, .ipp, .tpp]
patterns:
  - id: empty-catch
    description: 空 catch 块（异常被沉默吞掉）
    regex: 'catch\s*\([^)]*\)\s*\{\s*\}'
    severity: high
  - id: catch-ellipsis-empty
    description: catch (...) 后无任何处理
    regex: 'catch\s*\(\s*\.\.\.\s*\)\s*\{\s*\}'
    severity: high
  - id: comment-only-catch
    description: catch 块内仅注释，无任何处理
    regex: 'catch\s*\([^)]*\)\s*\{\s*//[^\n]*\n\s*\}'
    severity: high
  - id: new-without-delete
    description: '裸 new 调用（推荐 std::make_unique / std::make_shared）'
    regex: '(?<![:>\w])new\s+[A-Za-z_]\w*\s*[\(\[]'
    severity: medium
  - id: c-style-cast
    description: 'C-style cast（推荐 static_cast/dynamic_cast/reinterpret_cast/const_cast）'
    regex: '\(\s*(int|float|double|char|long|short|unsigned|signed|void\s*\*|[A-Z]\w*\s*\*?)\s*\)\s*[a-zA-Z_]'
    severity: low
  - id: null-vs-nullptr
    description: '使用 NULL 而非 nullptr（C++11+ 推荐 nullptr）'
    regex: '(?<![\w"])NULL(?![\w"])'
    severity: low
  - id: auto-ptr-deprecated
    description: std::auto_ptr 已弃用（用 std::unique_ptr）
    regex: 'std::auto_ptr\b'
    severity: high
  - id: using-namespace-std-in-header
    description: header 文件中 using namespace std（污染消费方命名空间）
    regex: '^using\s+namespace\s+std\s*;'
    severity: medium
  - id: cout-debug
    description: std::cout 调试遗留（含 DEBUG / TODO / FIXME）
    regex: 'std::cout\s*<<\s*"(DEBUG|TODO|FIXME|XXX)'
    severity: medium
  - id: disabled-gtest
    description: 'GoogleTest 禁用测试（DISABLED_ 前缀）'
    regex: '\b(TEST|TEST_F|TEST_P)\s*\(\s*\w+\s*,\s*DISABLED_'
    severity: medium
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b|/\*.*\b(TODO|FIXME|XXX|HACK)\b.*\*/'
    severity: low
```

> **`language: c++` 别名**：若 `project-context.md` 用 `language: c++` 写法，需在脚本侧把 `c++` 归一化为 `cpp`（已在 `gate_init.cjs` VALID_LANGUAGES 兼容，`_code-smells.cjs` 内部以 lowercase 严格匹配——填表时统一写 `cpp` 以避免分支）。

### 2.8 csharp / dotnet

```yaml
language: csharp
extensions: [.cs]
patterns:
  - id: empty-catch
    description: 空 catch 块
    regex: 'catch\s*\([^)]*\)\s*\{\s*\}'
    severity: high
  - id: catch-throw
    description: 'catch + throw（无附加上下文）'
    regex: 'catch\s*\([^)]+\)\s*\{\s*throw\s*;\s*\}'
    severity: low
  - id: console-debug
    description: Console.WriteLine 调试遗留
    regex: 'Console\.WriteLine'
    severity: low
  - id: ignored-test
    description: '[Ignore]'
    regex: '\[\s*Ignore\b'
    severity: medium
  - id: todo-fixme
    description: TODO/FIXME/XXX/HACK 注释
    regex: '//.*\b(TODO|FIXME|XXX|HACK)\b'
    severity: low
```

### 2.9 stack=other（兜底）

不给具体正则，给抽象指引：

- 找你的语言对应的"异常处理"语法 + 没有任何处理体的形态
- 找调试输出函数（print / log / console / writeline 等）
- 找跳过测试的注解/装饰器
- 找未完成标记（TODO/FIXME 在注释里）

自行参照 §2.1~2.7 的格式补一节，提 PR 加进本表。

---

## 3. severity 等级与处理

| severity | 含义 | refactor 处理 |
|---|---|---|
| `high` | 沉默吞异常 / 强烈推荐立即修 | reviewer 必须看；写进 ticket 标红 |
| `medium` | 调试遗留 / 跳过测试 / 过宽异常 | reviewer 应看；写进 ticket |
| `low` | TODO / 风格性问题 | 仅汇总不细查 |

输出 JSON 格式（`_code-smells.cjs` 产出，refactor SKILL 读）：

```json
{
  "language": "java",
  "scanned_files": 87,
  "findings": [
    {"file": "src/main/.../SimulationCore.java", "line": 281, "id": "comment-only-catch", "severity": "high", "snippet": "} catch (final Exception e) { // Move blocked... }"}
  ],
  "summary": {"high": 1, "medium": 3, "low": 7}
}
```

---

## 4. 加新语言 = 加一节

在 §2 加 `2.x` 一节，按上方 YAML 格式给：

- `language` —— 与 `project-context.md` 的 `language` 字段对齐
- `extensions` —— 该语言常见源文件扩展名
- `patterns` —— 每条 `{id, description, regex, severity}`

**禁止**：在 `_code-smells.cjs` 脚本里硬编正则——必须经本表登记。
