# BDD → UI 自动化骨架桥接

> 当 `project-context.md` 的 `has_frontend_ui: true` 时，wd 阶段把每条 L3 BDD scenario 桥接成一个 UI 自动化测试骨架。
> 具体工具（playwright / cypress / selenium 等）由 `test-tier-recipes.md` §6 按 stack 选；本表给"GWT → UI 自动化"的**通用转换规则** + 各 stack 的语法范例。

---

## 1. 通用转换规则（与 UI 工具无关）

| BDD 步骤 | UI 自动化对应 |
|---|---|
| **Given**（前置状态） | 1. 浏览器导航到目标 URL（或路由）<br>2. 准备 fixture（登录、种子数据、特定环境变量）<br>3. 等待页面就绪（DOM ready / 关键元素可见） |
| **When**（用户操作） | 用户交互动作：click / type / select / drag / scroll / upload / key press |
| **Then**（可观察断言） | 1. 元素可见性 / 文本内容 / 属性值断言<br>2. URL / 标题 / cookie / localStorage 断言<br>3. 网络请求被发出（可选） |

### 1.1 选择器策略（**最重要**——避免脆弱测试）

按优先级选定位方式：

1. **`data-testid`**（首选）—— 在生产代码里显式打标的稳定 id
2. **语义角色（role + accessible name）** —— 如 "按钮 命名为 提交"
3. **可见文本** —— 精确匹配显示文字
4. CSS class / XPath —— **不推荐**（耦合实现细节，刷新易碎）

### 1.2 等待策略

- **禁止** `sleep(N秒)` 类固定等待
- 用工具的"显式等待"机制：等元素可见 / 等网络空闲 / 等条件满足
- 设合理超时上限（通常 5~30s）

### 1.3 断言粒度（沿用 L3 精确断言原则）

- 文本：精确字符串比对（不接受 substring）
- 数字：精确值（不接受范围模糊）
- 列表：长度 + 关键项内容
- 状态：精确枚举（如 `selected / hovered / disabled`）

---

## 2. UI 骨架文件命名 + 路径约定

| 项 | 约定 |
|---|---|
| 路径 | `tests/e2e-ui/` 或 `e2e/` 或 stack 惯例（`tool-commands-guide.md` 注明） |
| 文件名 | `<feature-name>.spec.<ext>` 或 `<bdd-id>.<ext>`（一文件一 feature 或一文件一 scenario） |
| 测试用例命名 | `given_<前置>_when_<触发>_then_<期望>`（与 L1/L2 三段式一致） |
| BDD 追溯打标 | 测试函数上紧邻注释 `// BDD-001` 或 `# BDD-001`（同 red SKILL 约定） |
| tag | 用本栈"测试分组"机制标 `tier=L3` + `ui=true`（如 playwright `test.describe.configure({ mode: 'serial', tag: '@L3-UI' })`） |

---

## 3. 按 stack 的骨架范例（仅作示例，**具体工具由 `tool-commands-guide.md` 指定**）

### 3.1 playwright（node/python/java）通用思路

```
// BDD-001 用户登录后看到主页
test('given_logged_in_when_visit_home_then_see_dashboard', async ({ page }) => {
  // Given
  await page.goto('/login');
  await page.fill('[data-testid=username]', 'alice');
  await page.fill('[data-testid=password]', 'pwd123');
  await page.click('[data-testid=login-btn]');

  // When
  await page.goto('/');

  // Then —— 精确断言
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('[data-testid=welcome-msg]')).toHaveText('欢迎 alice');
});
```

### 3.2 cypress（node）

```
// BDD-001 用户登录后看到主页
describe('login flow', () => {
  it('given_logged_in_when_visit_home_then_see_dashboard', () => {
    // Given
    cy.visit('/login');
    cy.get('[data-testid=username]').type('alice');
    cy.get('[data-testid=password]').type('pwd123');
    cy.get('[data-testid=login-btn]').click();

    // When
    cy.visit('/');

    // Then
    cy.url().should('include', '/dashboard');
    cy.get('[data-testid=welcome-msg]').should('have.text', '欢迎 alice');
  });
});
```

### 3.3 selenium（任意 stack 通用）

```
# BDD-001 用户登录后看到主页
def test_given_logged_in_when_visit_home_then_see_dashboard(driver):
    # Given
    driver.get(f'{base_url}/login')
    driver.find_element(By.CSS_SELECTOR, '[data-testid=username]').send_keys('alice')
    driver.find_element(By.CSS_SELECTOR, '[data-testid=password]').send_keys('pwd123')
    driver.find_element(By.CSS_SELECTOR, '[data-testid=login-btn]').click()

    # When
    driver.get(f'{base_url}/')

    # Then
    WebDriverWait(driver, 10).until(EC.url_contains('/dashboard'))
    welcome = driver.find_element(By.CSS_SELECTOR, '[data-testid=welcome-msg]')
    assert welcome.text == '欢迎 alice'
```

### 3.4 跨语言通用骨架（伪代码 stack=other）

```
# BDD-001 用户登录后看到主页
test "given_logged_in_when_visit_home_then_see_dashboard":
  # Given
  navigate to "/login"
  fill   "[data-testid=username]" with "alice"
  fill   "[data-testid=password]" with "pwd123"
  click  "[data-testid=login-btn]"

  # When
  navigate to "/"

  # Then  (精确值)
  assert current_url contains "/dashboard"
  assert element "[data-testid=welcome-msg]" has text "欢迎 alice"
```

---

## 4. 自动生成 vs 手工填充

| 阶段 | 谁来做 | 做什么 |
|---|---|---|
| **wd** | wd skill | 按本表 §1 通用规则，为每条 L3 BDD scenario **生成测试函数骨架**：含 GWT 注释、测试函数名、追溯标记、tag——但 selector / 具体 input 值 / 断言精确值**留 `_TODO_FILL_BY_RED_` 占位** |
| **red** | red skill | 填充 selector / input 值 / 断言精确值（参照 §1.1 优先用 `data-testid`）；**不留 `_TODO_FILL_BY_RED_`**——下游 gate_red 静态查这个 token，残留即 fail |
| **green** | green skill | 实现产生 UI 元素必须有对应 `data-testid`（与 red 协商一致）；让测试转绿 |
| **refactor** | refactor skill | 检查 `data-testid` 命名一致性 |
| **st (L3 签收)** | st skill | 在真实运行时跑全部 L3 UI 测试，归入 `l3-signoff.json` |

---

## 5. wd 阶段的 UI 骨架生成步骤（给 wd SKILL 写得很死避免 LLM 跑偏）

1. 读 `project-context.md` 的 `has_frontend_ui` —— 若 `false` 跳过本节
2. 读 wd §测试清单，挑所有 `层级 = L3` 且涉及"用户可视交互"的行（reviewer 子代理可帮判）
3. 对每条 L3 BDD 写一个 UI 骨架文件 / 测试函数：
   - 文件路径按 §2 约定
   - 内容按 §1.1 模板（选 `data-testid` 优先）
   - selector / input / assertion 用 `_TODO_FILL_BY_RED_` 占位
   - 函数顶部注释 `BDD-xxx`
   - tag 按本栈机制标 `@L3-UI`
4. 写 ticket 到 `.harness/blueprint/state.json` 记录"已生成 UI 骨架数 vs L3 BDD 数"（red / gate_red 据此核对）

---

## 6. wd / red / gate_red 怎么校验"L3 UI 骨架完整"

| 节点 | 怎么校验 |
|---|---|
| wd 自检 | `has_frontend_ui=true` 时 §测试清单里每条 L3 BDD 必有 UI 骨架对应 |
| red 自检 | grep `tests/e2e-ui/` 下所有文件，对每条 L3 BDD-xxx 必有打标的测试函数 |
| gate_red.cjs | 现有 BDD-id 覆盖检查自动适用——只要 UI 文件里有 `BDD-xxx` 标记就过 |
| gate_st.cjs | 跑 L3 时统计 UI 测试运行数；若 `has_frontend_ui=true` 且 UI 测试运行数 < L3 BDD 数 → fail |

---

## 7. 加新 UI 自动化工具 = 在 §3 加一节

按 §3.1~3.3 格式给：

- 一个登录场景骨架
- selector 写法
- 断言写法
- 等待策略

**禁止**：在 SKILL 或脚本里硬编工具名——必须经本表登记 + `test-tier-recipes.md` §6 注册。
