// gate_decompose.cjs 校验器单元测试（long-task-simple：无 SRS / FR 覆盖，BDD 为唯一覆盖货币）
// 运行：node --test blueprints/user/long-task-simple/shared-scripts/__tests__/gate_decompose.test.cjs
//
// 预算确定性：钉 BP_CONTEXT_WINDOW=200000 + BP_SPLIT_STRATEGY=aggressive（env 优先于 disk）。
// 此时 planningBudget=150000、perScenarioTokens=5500；fixedDocBytes=0 时 maxN=floor(150000/5500)=27、
// thinFloor=floor(27*0.25)=6、overflowCeil=floor(0.92*200000)=184000。

process.env.BP_CONTEXT_WINDOW = '200000';
process.env.BP_SPLIT_STRATEGY = 'aggressive';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const G = require('../gate_decompose.cjs');

function mkCwd() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-decompose-'));
  fs.mkdirSync(path.join(cwd, '.harness', 'memory', 'plans'), { recursive: true });
  return cwd;
}
function writeBdd(cwd, features) {
  fs.writeFileSync(path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json'), JSON.stringify({ features }), 'utf8');
}
function bddIds(n) { return Array.from({ length: n }, (_, i) => 'BDD-' + (i + 1)); }

// ---- A. 形状（无 srs_trace；bdd_ids 必填非空）----
test('validateFeaturePlanShape: 合法 features 返回空', () => {
  const errs = G.validateFeaturePlanShape([
    { title: 'A', bdd_ids: ['BDD-001'], priority: 'high', dependencies: [] },
  ]);
  assert.deepEqual(errs, []);
});
test('validateFeaturePlanShape: 空数组 / 缺 title / 坏 bdd_id / 坏 priority 全部报错', () => {
  assert.match(G.validateFeaturePlanShape([])[0], /features 数组为空/);
  const errs = G.validateFeaturePlanShape([
    { title: '', bdd_ids: ['BDD_001'], priority: 'urgent', dependencies: 'no' },
  ]);
  assert.ok(errs.some((e) => /title 缺失/.test(e)));
  assert.ok(errs.some((e) => /bdd_ids\[0\] 应匹配/.test(e)));
  assert.ok(errs.some((e) => /priority "urgent" 非法/.test(e)));
  assert.ok(errs.some((e) => /dependencies 必须是数组/.test(e)));
});
test('validateFeaturePlanShape: bdd_ids 空数组报「每 feature ≥1 个 BDD 场景」', () => {
  const errs = G.validateFeaturePlanShape([{ title: 'A', bdd_ids: [] }]);
  assert.ok(errs.some((e) => /bdd_ids 必须是非空数组/.test(e)));
});
test('validateFeaturePlanShape: 无 srs_trace 字段不报错（本蓝图无 FR-id）', () => {
  const errs = G.validateFeaturePlanShape([{ title: 'A', bdd_ids: ['BDD-001'] }]);
  assert.deepEqual(errs, []);
});

// ---- B. BDD 覆盖（唯一覆盖货币）----
test('validateBddCoverage: 孤立场景 + ghost id', () => {
  const cwd = mkCwd();
  writeBdd(cwd, [{ feature: 'f', risk: 'normal', scenarios: [{ id: 'BDD-001' }, { id: 'BDD-002' }] }]);
  const errs = G.validateBddCoverage([{ title: 'A', bdd_ids: ['BDD-001', 'BDD-009'] }], cwd);
  assert.ok(errs.some((e) => /未被任何 feature 的 bdd_ids 认领/.test(e) && /BDD-002/.test(e)));
  assert.ok(errs.some((e) => /不存在的场景 id/.test(e) && /BDD-009/.test(e)));
});
test('validateBddCoverage: 全覆盖无 ghost → 空', () => {
  const cwd = mkCwd();
  writeBdd(cwd, [{ feature: 'f', risk: 'normal', scenarios: [{ id: 'BDD-001' }, { id: 'BDD-002' }] }]);
  const errs = G.validateBddCoverage([{ title: 'A', bdd_ids: ['BDD-001', 'BDD-002'] }], cwd);
  assert.deepEqual(errs, []);
});

// ---- C. 上下文预算（溢出仅 advisory）----
test('validateContextBudget: 40 场景投影溢出 → 仅 advisory、无 error', () => {
  const cwd = mkCwd(); // 无文档 → F=0 → maxN=27, ceil=184000
  const r = G.validateContextBudget([{ title: '巨', bdd_ids: bddIds(40) }], cwd);
  assert.deepEqual(r.errors, []);
  assert.equal(r.advisories.length, 1);
  assert.match(r.advisories[0], /可能在会话内溢出/);
});
test('validateContextBudget: 10 场景 → 无 error 无 advisory', () => {
  const cwd = mkCwd();
  const r = G.validateContextBudget([{ title: 'ok', bdd_ids: bddIds(10) }], cwd);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.advisories, []);
});

// ---- D. 过度碎片化（硬 fail）----
test('validateFragmentation: 6 个 feature 各 1 场景 → 过度碎片化硬 fail', () => {
  const cwd = mkCwd();
  const feats = bddIds(6).map((_, i) => ({ title: 'f' + i, bdd_ids: ['BDD-' + (i + 1)] }));
  const errs = G.validateFragmentation(feats, cwd);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /过度碎片化/);
  assert.match(errs[0], /S5/);
});
test('validateFragmentation: 2 个 feature（M<3）→ 不触发', () => {
  const cwd = mkCwd();
  const errs = G.validateFragmentation(
    [{ title: 'a', bdd_ids: bddIds(8) }, { title: 'b', bdd_ids: bddIds(8) }], cwd);
  assert.deepEqual(errs, []);
});
test('validateFragmentation: 3 个右-size feature（各 ~15 场景）→ 不触发', () => {
  const cwd = mkCwd(); // maxN=27, thinFloor=6, 15/27≈0.56 中位 > 0.35
  const errs = G.validateFragmentation(
    [{ title: 'a', bdd_ids: bddIds(15) }, { title: 'b', bdd_ids: bddIds(15) }, { title: 'c', bdd_ids: bddIds(14) }], cwd);
  assert.deepEqual(errs, []);
});

// ---- E. 单轮模式（single_round）放宽 ----
test('readSingleRound: 缺省 → false 无 error；true → true；非布尔 → error', () => {
  assert.deepEqual(G.readSingleRound({ features: [] }), { value: false, error: null });
  assert.deepEqual(G.readSingleRound({ single_round: true }), { value: true, error: null });
  assert.deepEqual(G.readSingleRound(null), { value: false, error: null });
  const bad = G.readSingleRound({ single_round: 'yes' });
  assert.equal(bad.value, false);
  assert.match(bad.error, /single_round 必须是布尔/);
});
test('validateFragmentation: 6 薄 feature + singleRound → 短路返回 []', () => {
  const cwd = mkCwd();
  const feats = bddIds(6).map((_, i) => ({ title: 'f' + i, bdd_ids: ['BDD-' + (i + 1)] }));
  assert.deepEqual(G.validateFragmentation(feats, cwd, { singleRound: true }), []);
});
