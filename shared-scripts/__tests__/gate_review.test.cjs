// gate_review.cjs 单元测试（long-task-simple：无 design §9 NFR / 状态机 / feature-tests.json B 维）
// 仅测保留下来的纯函数：环境/边界签名、then 期望 token 抽取、当前 task 定位、
// 工作区 BDD 标记扫描、断言深度。
// 运行：node --test blueprints/user/long-task-simple/shared-scripts/__tests__/gate_review.test.cjs

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isEnvFailure, hasBoundaryContractSignal, assertionDepth,
  extractExpectedTokens, scanWorkspaceLocations, pickCurrentTask,
  classifyFailKind,
} = require('../gate_review.cjs');

// ---- isEnvFailure ----
test('isEnvFailure: 命中环境签名', () => {
  assert.equal(isEnvFailure('bash: pytest: command not found'), true);
  assert.equal(isEnvFailure('Error: Cannot find module "express"'), true);
  assert.equal(isEnvFailure('ModuleNotFoundError: No module named foo'), true);
});
test('isEnvFailure: 普通断言失败不算环境', () => {
  assert.equal(isEnvFailure('AssertionError: expected 200 but got 500'), false);
  assert.equal(isEnvFailure(''), false);
});

// ---- hasBoundaryContractSignal ----
test('hasBoundaryContractSignal: NPE / 5xx / unhandled 命中', () => {
  assert.equal(hasBoundaryContractSignal('java.lang.NullPointerException at ...'), true);
  assert.equal(hasBoundaryContractSignal('HTTP 500 Internal Server Error'), true);
  assert.equal(hasBoundaryContractSignal('unhandled rejection: TypeError'), true);
});
test('hasBoundaryContractSignal: 普通失败不命中', () => {
  assert.equal(hasBoundaryContractSignal('expected foo to equal bar'), false);
});

// ---- extractExpectedTokens（从 then/examples 抽取可观察值字面量）----
test('extractExpectedTokens: 抽数字 / 引号串 / 枚举', () => {
  const { tokens, raw } = extractExpectedTokens({
    then: ['返回 200 且 body.user_id 等于 42'],
    examples: ['输入 "admin" → 状态 ACTIVE'],
  });
  assert.ok(tokens.includes('200'));
  assert.ok(tokens.includes('42'));
  assert.ok(tokens.includes('admin'));
  assert.ok(tokens.includes('ACTIVE'));
  assert.ok(raw.length >= 2);
});
test('extractExpectedTokens: 空场景返回空 tokens', () => {
  const { tokens } = extractExpectedTokens({ then: [], examples: [] });
  assert.deepEqual(tokens, []);
});

// ---- pickCurrentTask（从 state.loops 定位当前 task）----
test('pickCurrentTask: 取活跃 loop 的 taskIndex 指向的 task', () => {
  const state = { loops: { iter: { tasks: [{ id: 1 }, { id: 2 }], taskIndex: 1, exited: false } } };
  assert.deepEqual(pickCurrentTask(state), { id: 2 });
});
test('pickCurrentTask: 已退出 loop / 越界 → null', () => {
  assert.equal(pickCurrentTask({ loops: { iter: { tasks: [{ id: 1 }], taskIndex: 0, exited: true } } }), null);
  assert.equal(pickCurrentTask({ loops: {} }), null);
});

// ---- scanWorkspaceLocations（grep BDD-id 标记）----
test('scanWorkspaceLocations: 扫到源码/测试里的 BDD 标记', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-scan-'));
  fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'tests', 'a.test.js'),
    '// BDD-001 happy\ntest("x", () => { expect(pos).toEqual([5,6]); });\n', 'utf8');
  const locs = scanWorkspaceLocations(cwd);
  assert.ok(locs.has('BDD-001'));
  assert.equal(locs.get('BDD-001')[0].file.replace(/\\/g, '/'), 'tests/a.test.js');
});

// ---- classifyFailKind（test 维→ut / impl 维→impl / impl 优先 / env→blocked）----
test('classifyFailKind: 仅测试编写缺口（漏标记/浅断言/then无命中）→ FAILKIND: test（折返 ut）', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: true, hasImplBehaviorGap: false, hasTestEnvFail: false });
  assert.match(r.cls, /FAILKIND: test/);
  assert.equal(r.envFixable, false);
});
test('classifyFailKind: 实现行为缺口（测试不绿/边界违约）→ FAILKIND: impl（折返 impl）', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: false, hasImplBehaviorGap: true, hasTestEnvFail: false });
  assert.match(r.cls, /FAILKIND: impl/);
  assert.equal(r.envFixable, false);
});
test('classifyFailKind: test 维与 impl 维并存 → impl 优先', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: true, hasImplBehaviorGap: true, hasTestEnvFail: false });
  assert.match(r.cls, /FAILKIND: impl/);
});
test('classifyFailKind: 纯环境签名 → FAILKIND: env + envFixable=true（blocked）', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: false, hasImplBehaviorGap: false, hasTestEnvFail: true });
  assert.match(r.cls, /FAILKIND: env/);
  assert.equal(r.envFixable, true);
});
test('classifyFailKind: env 与内容缺口并存 → 内容缺口优先、不判 env（envFixable=false）', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: true, hasImplBehaviorGap: false, hasTestEnvFail: true });
  assert.match(r.cls, /FAILKIND: test/);
  assert.equal(r.envFixable, false);
});
test('classifyFailKind: 无任何缺口 → 空前缀', () => {
  const r = classifyFailKind({ hasTestAuthoringGap: false, hasImplBehaviorGap: false, hasTestEnvFail: false });
  assert.equal(r.cls, '');
  assert.equal(r.envFixable, false);
});

// ---- assertionDepth（真断言 vs 重言式/占位）----
test('assertionDepth: 真断言 ok', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-depth-'));
  const f = path.join(cwd, 'a.test.js');
  fs.writeFileSync(f, '// BDD-001\nexpect(result).toBe(42);\n', 'utf8');
  const r = assertionDepth([{ line: 1, _full: f }]);
  assert.equal(r.ok, true);
});
test('assertionDepth: 仅重言式 → not ok', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-depth2-'));
  const f = path.join(cwd, 'b.test.py');
  fs.writeFileSync(f, '# BDD-002\nassert True\n', 'utf8');
  const r = assertionDepth([{ line: 1, _full: f }]);
  assert.equal(r.ok, false);
  assert.match(r.why, /重言式|永真/);
});
