#!/usr/bin/env node
// gate_decompose.cjs —— Decompose 硬门
//
// 校验 decompose 节点产出的 `.harness/memory/plans/feature-plan.json`（BDD→feature 分组方案，
// loop 此时尚未灌入，故数据来源是磁盘文件而非 state.loops）。本门是「颗粒度」的权威裁决：
//   - 形状（title / bdd_ids / priority / dependencies；本蓝图无 srs_trace / FR-id）
//   - BDD 全覆盖（bdd.json 每个场景被某 feature.bdd_ids 认领、无 ghost id）—— 本蓝图唯一覆盖货币
//   - 上下文预算（按 perScenarioTokens 投影；溢出 → **仅告警、不强制拆**）
//   - 过度碎片化（太多薄 feature / 中位填充率过低 → 硬 fail，必按 S5 同源兄弟聚合）
//
// 单轮（plan.single_round=true）：用户主动选「全部需求合为一个 feature、iter 一轮做完」——
//   碎片化检查短路（合为一个 feature 是 deliberate）；形状 + BDD 覆盖照常。
//   （预算溢出对所有模式都只告警、不打回，故无需单独为单轮放宽。）
//
// 形状/覆盖/预算/碎片化 任一不达标即 fail；偏厚/偏薄但未触红线 = 软建议（不改 pass）。
//
// stdin: 无（由 gate_decompose review skill 的 LLM 直接运行）。cwd 即运行目录。
// stdout: 最后一行 JSON {pass:bool, message:string}
// exit:   0 normal / 2 schema error
//
// ⚠ feature-plan.json 形态是 decompose(写) / 本门(校) / init(读) 三处的共享契约——
//   改字段须三处同步。

const fs = require('fs');
const path = require('path');
const budget = require('./_context-budget.cjs'); // 上下文预算工具（按校准/真实窗口右size）

// ---- 常量 -------------------------------------------------------------------
const BDD_ID_PATTERN = /^BDD-\d+$/;
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

// ---- 工具 -------------------------------------------------------------------
function emit(pass, message) {
  process.stdout.write(JSON.stringify({ pass: !!pass, message: String(message || '') }) + '\n');
  process.exit(0);
}
function readJson(p) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { return { ok: false, error: e.message }; }
}
function median(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// 读 plan 顶层 single_round（单轮：合为一个 feature、iter 一轮）。
// 缺省 → {value:false}；布尔 → {value}；非布尔 → {value:false, error}。
function readSingleRound(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !('single_round' in plan)) {
    return { value: false, error: null };
  }
  const v = plan.single_round;
  if (typeof v !== 'boolean') return { value: false, error: 'single_round 必须是布尔（true/false），当前 "' + v + '"' };
  return { value: v, error: null };
}

// 固定文档字节（impl 每迭代要读的）：bdd.json + project-context.md(可能尚未生成) + intent/original-requirements.md + rules/*.md
// 本蓝图无 srs.md / design.md。
function measureFixedDocBytes(cwd) {
  let bytes = 0;
  const plans = path.join(cwd, '.harness', 'memory', 'plans');
  for (const f of ['bdd.json', 'project-context.md']) {
    try { bytes += fs.statSync(path.join(plans, f)).size; } catch (_) { /* 缺则跳过 */ }
  }
  try { bytes += fs.statSync(path.join(cwd, '.harness', 'memory', 'intent', 'original-requirements.md')).size; } catch (_) { /* 缺则跳过 */ }
  const rulesDir = path.join(cwd, '.harness', 'memory', 'notes', 'rules');
  try {
    for (const e of fs.readdirSync(rulesDir)) {
      if (e.toLowerCase().endsWith('.md')) {
        try { bytes += fs.statSync(path.join(rulesDir, e)).size; } catch (_) { /* skip */ }
      }
    }
  } catch (_) { /* 无 rules 目录 */ }
  return bytes;
}

// ---- A. 形状校验 ------------------------------------------------------------
function validateFeaturePlanShape(features) {
  const errors = [];
  if (!Array.isArray(features)) return ['feature-plan.json: features 必须是数组，当前是 ' + (features === null ? 'null' : typeof features)];
  if (features.length === 0) return ['feature-plan.json: features 数组为空'];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const pfx = 'features[' + i + ']';
    if (f === null || typeof f !== 'object' || Array.isArray(f)) { errors.push(pfx + ': 必须是对象'); continue; }
    if (typeof f.title !== 'string' || !f.title.trim()) errors.push(pfx + ': title 缺失或为空');
    // 本蓝图无 SRS / FR-id：work-unit feature 靠 bdd_ids 锚定覆盖的场景（无 srs_trace），故 bdd_ids 必填非空。
    if (!Array.isArray(f.bdd_ids) || f.bdd_ids.length === 0) {
      errors.push(pfx + ' (title=' + (f.title || '?') + '): bdd_ids 必须是非空数组（每 feature ≥1 个 BDD 场景）');
    } else {
      for (let bi = 0; bi < f.bdd_ids.length; bi++) {
        const b = f.bdd_ids[bi];
        if (typeof b !== 'string' || !BDD_ID_PATTERN.test(b)) {
          errors.push(pfx + ': bdd_ids[' + bi + '] 应匹配 BDD-\\d+，当前 "' + b + '"');
        }
      }
    }
    if (f.priority !== undefined && f.priority !== null && !VALID_PRIORITIES.has(f.priority)) {
      errors.push(pfx + ': priority "' + f.priority + '" 非法，应 ∈ high|medium|low');
    }
    if (f.dependencies !== undefined && f.dependencies !== null && !Array.isArray(f.dependencies)) {
      errors.push(pfx + ': dependencies 必须是数组');
    }
  }
  return errors;
}

// ---- B. BDD 全覆盖（bdd.json 每个场景被某 feature.bdd_ids 认领、无 ghost）--------
function validateBddCoverage(features, cwd) {
  const bddPath = path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json');
  if (!fs.existsSync(bddPath)) return ['bdd.json 缺失（应由上游 bdd 节点产出），无法做 BDD 全覆盖校验'];
  let bdd;
  try { bdd = JSON.parse(fs.readFileSync(bddPath, 'utf8')); }
  catch (e) { return ['bdd.json 不是合法 JSON: ' + e.message]; }
  if (!bdd || typeof bdd !== 'object' || !Array.isArray(bdd.features)) return ['bdd.json 结构异常（features 非数组）'];

  const allScenarioIds = new Set();
  for (const feat of bdd.features) {
    if (!feat || typeof feat !== 'object' || !Array.isArray(feat.scenarios)) continue;
    for (const sc of feat.scenarios) {
      if (sc && typeof sc === 'object' && typeof sc.id === 'string' && sc.id.trim()) {
        allScenarioIds.add(sc.id.trim().toUpperCase());
      }
    }
  }
  if (allScenarioIds.size === 0) return []; // bdd.json 无场景 → 不约束（应由 gate_bdd 拦下）

  const claimed = new Set();
  for (const f of (Array.isArray(features) ? features : [])) {
    if (!f || typeof f !== 'object' || !Array.isArray(f.bdd_ids)) continue;
    for (const b of f.bdd_ids) if (typeof b === 'string' && b.trim()) claimed.add(b.trim().toUpperCase());
  }

  const errors = [];
  const orphan = [];
  for (const id of allScenarioIds) if (!claimed.has(id)) orphan.push(id);
  if (orphan.length) {
    orphan.sort();
    errors.push('BDD 场景未被任何 feature 的 bdd_ids 认领（' + orphan.length + '/' + allScenarioIds.size
      + '）：' + orphan.join(', ') + '（请在 decompose 为相关 feature 补全 bdd_ids）');
  }
  const ghost = [];
  for (const id of claimed) if (!allScenarioIds.has(id)) ghost.push(id);
  if (ghost.length) {
    ghost.sort();
    errors.push('feature.bdd_ids 含 bdd.json 中不存在的场景 id：' + ghost.join(', '));
  }
  return errors;
}

// ---- D. 上下文预算右size（溢出硬 fail；偏厚/偏薄软建议）-------------------------
function validateContextBudget(features, cwd) {
  // 溢出仅告警、不再硬 fail（拆分打回已移除）。errors 恒空，保留返回结构供主流程统一处理。
  const errors = [];
  const advisories = [];
  if (!Array.isArray(features) || features.length === 0) return { errors, advisories };
  const F = measureFixedDocBytes(cwd);
  const W = budget.windowTokens();
  const maxN = budget.maxScenariosPerFeature(F);
  const strat = budget.activeStrategy();
  const ceilRatio = strat.overflowCeil;
  const overflowCeil = Math.floor(W * ceilRatio);
  const thinFloor = Math.max(1, Math.floor(maxN * 0.25));
  const tag = '[策略=' + strat.name + ' ceil=' + Math.round(ceilRatio * 100) + '%] ';
  for (const f of features) {
    if (!f || typeof f !== 'object') continue;
    const n = Array.isArray(f.bdd_ids) ? f.bdd_ids.length : 0;
    if (n === 0) continue; // 无 BDD 场景的纯内部 feature 不参与预算判定
    const projected = budget.estimateFootprint({ fixedDocBytes: F, scenarioCount: n });
    const label = f.title ? ('feature「' + f.title + '」') : 'feature';
    if (projected > overflowCeil) {
      advisories.push(tag + label + '：' + n + ' 个 BDD 场景投影 ~' + projected
        + ' tok > 窗口 ' + W + ' 的 ' + Math.round(ceilRatio * 100)
        + '% → 可能在会话内溢出（仅提示，不强制拆；如需更小切片回 decompose 调整或回 req 改档）');
    } else if (n > maxN) {
      advisories.push(tag + label + '：' + n + ' 个场景略超规划预算（建议上限 ~' + maxN + '），建议拆分');
    } else if (n < thinFloor) {
      advisories.push(tag + label + '：仅 ' + n + ' 个场景、远低于窗口可容 ~' + maxN
        + '，偏薄 → 建议与同源兄弟 feature 合并以摊薄固定开销');
    }
  }
  return { errors, advisories };
}

// ---- E. 过度碎片化硬 fail（颗粒度过细 → 必按 S5 同源兄弟聚合）--------------------
// 仅计有 BDD 场景的 feature（M）；当 M≥3 且（薄 feature 占比≥50% 或 中位填充率<35%）→ 硬 fail。
// 阈值（0.5 / 0.35 / 25% / M≥3）与 gate_init thinFloor=25%、req 5.4「< 1/3 预算占比高」同源，首版可调。
function validateFragmentation(features, cwd, opts = {}) {
  const errors = [];
  if (opts && opts.singleRound) return errors; // 单轮：合为一个 feature 是 deliberate，碎片化检查短路
  if (!Array.isArray(features) || features.length === 0) return errors;
  const F = measureFixedDocBytes(cwd);
  const maxN = budget.maxScenariosPerFeature(F);
  const strat = budget.activeStrategy();
  const tag = '[策略=' + strat.name + ' ceil=' + Math.round(strat.overflowCeil * 100) + '%] ';
  const thinFloor = Math.max(1, Math.floor(maxN * 0.25));
  const counts = features
    .filter((f) => f && typeof f === 'object' && Array.isArray(f.bdd_ids) && f.bdd_ids.length > 0)
    .map((f) => f.bdd_ids.length);
  const M = counts.length;
  if (M < 3) return errors; // 1-2 个计分 feature 的小项目天然不触发
  const fills = counts.map((n) => n / maxN);
  const thinCount = counts.filter((n) => n < thinFloor).length;
  const thinRatio = thinCount / M;
  const med = median(fills);
  if (thinRatio >= 0.5 || med < 0.35) {
    errors.push(tag + '[过度碎片化] ' + M + ' 个计分 feature 中 ' + thinCount + ' 个场景数 < thinFloor(=' + thinFloor
      + ')（' + Math.round(thinRatio * 100) + '%），中位填充率 ' + Math.round(med * 100) + '%（< 35% 即过细）。'
      + '过度拆解浪费每 feature 的固定文档/工具开销。请回 decompose 按 req Step 5.2bis / S5「同源兄弟聚合」'
      + '合并共享同一接口/角色/领域实体的薄 feature（单特性可容约 ' + maxN + ' 个场景）。');
  }
  return errors;
}

// ---- 主流程 ----------------------------------------------------------------
if (require.main === module) {
  const cwd = process.cwd();
  const planPath = path.join(cwd, '.harness', 'memory', 'plans', 'feature-plan.json');
  if (!fs.existsSync(planPath)) {
    emit(false, 'feature-plan.json 未生成: ' + path.relative(cwd, planPath) + '（应由上游 decompose 节点产出）');
  }
  const r = readJson(planPath);
  if (!r.ok) emit(false, 'feature-plan.json 不是合法 JSON: ' + r.error);
  const plan = r.value;
  const features = plan && Array.isArray(plan.features) ? plan.features : plan; // 容错：允许根即数组
  const sr = readSingleRound(plan);
  const singleRound = sr.value;

  const shapeErrors = validateFeaturePlanShape(features).concat(sr.error ? [sr.error] : []);
  // 形状不过则后续覆盖/预算校验意义不大，但仍尽量多报以便一次性整改
  const bddErrors = validateBddCoverage(features, cwd);
  const budgetRes = validateContextBudget(features, cwd); // 溢出仅 advisory，不打回
  const fragErrors = validateFragmentation(features, cwd, { singleRound });

  const advisories = [].concat(budgetRes.advisories || []);
  const advNote = advisories.length ? '\n[预算建议] ' + advisories.join('；') : '';

  const allErrors = []
    .concat(shapeErrors.length ? ['形状: ' + shapeErrors.join('；')] : [])
    .concat(bddErrors.length ? ['BDD 覆盖: ' + bddErrors.join('；')] : [])
    .concat(budgetRes.errors.length ? ['上下文预算: ' + budgetRes.errors.join('；')] : [])
    .concat(fragErrors.length ? ['碎片化: ' + fragErrors.join('；')] : []);

  if (allErrors.length === 0) {
    const strat = budget.activeStrategy();
    const per = budget.activePerScenarioTokens();
    emit(true, 'Decompose 校验通过：形状 + BDD 全覆盖 + 上下文预算 + 碎片化 均合格'
      + '（策略=' + strat.name + '，perScenarioTokens=' + per.value + ' [' + per.source + ']'
      + (singleRound ? '，单轮模式：合为一个 feature、iter 一轮' : '') + '）' + advNote);
  }
  emit(false, allErrors.join(' | ') + advNote);
}

module.exports = {
  validateFeaturePlanShape, validateBddCoverage,
  validateContextBudget, validateFragmentation, measureFixedDocBytes,
  readSingleRound,
};
