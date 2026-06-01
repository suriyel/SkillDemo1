'use strict';
// _context-budget.cjs —— 蓝图原生「上下文预算」内置工具（CLI + require 模块）。
//
// 让 init/req 分解 & gate_init 校验按**真实上下文窗口**右size feature，而非硬编 200k。
// claude / opencode 的 skill 都可 `node {{SCRIPTS}}/_context-budget.cjs` 调用（BP_SCRIPTS_DIR 两工具同发）。
//
// 窗口来源（优先级）：
//   1) BP_CONTEXT_WINDOW 环境变量 —— harness 按当前 profile 模型注入（权威；claude/opencode 都有）
//   2) 兜底：由 ANTHROPIC_MODEL 关键词粗映射（claude 家族 / 1m 变体 / 部分 OpenAI）
//   3) 默认 200000
//
// 拆分策略（影响 SAFETY / PER_SCENARIO_TOKENS / overflowCeil 三联值）：
//   优先级：CLI --strategy → BP_SPLIT_STRATEGY env → .harness/memory/plans/split-strategy.json → aggressive（默认档）
//
// 校准覆盖（perScenarioTokens 单旋钮）：
//   若 .harness/memory/plans/calibration.json 存在且 status=="measured" 且 perScenarioTokens 为正数，
//   该实测值覆盖策略表里的硬编 perScenarioTokens（safety / overflowCeil 仍随策略）。由 calibrate 节点产出。
//
// CLI:  node _context-budget.cjs [--strategy <name>] [--fixed-bytes N]   → 打印 JSON
// 模块: const b = require('./_context-budget.cjs'); b.windowTokens(); b.maxScenariosPerFeature(fixedDocBytes); b.activeStrategy(); b.activePerScenarioTokens()

const fs = require('fs');
const path = require('path');

// ---- 策略表（safety / per-scenario / overflow-ceil 三联值的唯一事实源）----
// 三档思路：保守=留更大头寸细分 FR；平衡=现状默认；激进=大胆合并吃满窗口。
// 单一事实源给 SKILL.md 和 gate_init.cjs 同时消费，避免两侧阈值漂移。
const STRATEGIES = {
  conservative: { safety: 0.45, perScenarioTokens: 10000, overflowCeil: 0.70,
    desc: '保守：留更大头寸，细分 FR、降低单 feature 风险' },
  balanced:     { safety: 0.55, perScenarioTokens: 8000,  overflowCeil: 0.85,
    desc: '平衡：现状默认，安全裕度与利用率折中' },
  aggressive:   { safety: 0.75, perScenarioTokens: 5500,  overflowCeil: 0.92,
    desc: '激进：大胆合并、吃满窗口、摊薄固定文档/工具调用开销' },
};
const DEFAULT_STRATEGY = 'aggressive';

// ---- 其余可调常量 ----
const BYTES_PER_TOKEN = 3;        // 字节→token 粗估（CJK/代码混合；偏保守）。
const DEFAULT_WINDOW = 200000;

// 进程级一次性 CLI 覆盖（require 模块时也能透传：先 setCliOverride 再调 activeStrategy）
let _cliStrategyOverride = null;
function setCliStrategyOverride(name) {
  _cliStrategyOverride = (name && STRATEGIES[name]) ? name : null;
}

// 从 cwd 起向上找含 .harness/memory/plans/split-strategy.json 的目录；找到就读。
function readStrategyFromDisk(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;
  while (true) {
    const p = path.join(dir, '.harness', 'memory', 'plans', 'split-strategy.json');
    if (fs.existsSync(p)) {
      try {
        const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        const s = obj && typeof obj.strategy === 'string' ? obj.strategy : null;
        if (s && STRATEGIES[s]) return s;
      } catch (_) { /* 损坏 → fallback */ }
      return null; // 文件存在但无效，不再向上找（避免读到祖父项目的）
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function activeStrategy() {
  // 1) CLI --strategy 覆盖（同进程内最高优先级）
  if (_cliStrategyOverride && STRATEGIES[_cliStrategyOverride]) {
    return { name: _cliStrategyOverride, source: 'cli', ...STRATEGIES[_cliStrategyOverride] };
  }
  // 2) env BP_SPLIT_STRATEGY
  const envName = String(process.env.BP_SPLIT_STRATEGY || '').trim();
  if (envName && STRATEGIES[envName]) {
    return { name: envName, source: 'env', ...STRATEGIES[envName] };
  }
  // 3) disk 兜底
  const diskName = readStrategyFromDisk(process.cwd());
  if (diskName) {
    return { name: diskName, source: 'disk', ...STRATEGIES[diskName] };
  }
  // 4) 默认档（aggressive）
  return { name: DEFAULT_STRATEGY, source: 'default', ...STRATEGIES[DEFAULT_STRATEGY] };
}

// ---- 校准覆盖：实测 perScenarioTokens（calibrate 节点产出）-----------------------
// 从 cwd 起向上找含 .harness/memory/plans/calibration.json 的目录；仅当 status=="measured"
// 且 perScenarioTokens 为正数才返回该数，否则 null（unmeasured / 损坏 → 退回策略默认值）。
function readCalibratedPerScenario(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;
  while (true) {
    const p = path.join(dir, '.harness', 'memory', 'plans', 'calibration.json');
    if (fs.existsSync(p)) {
      try {
        const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (obj && obj.status === 'measured'
            && typeof obj.perScenarioTokens === 'number'
            && Number.isFinite(obj.perScenarioTokens) && obj.perScenarioTokens > 0) {
          return obj.perScenarioTokens;
        }
      } catch (_) { /* 损坏 → 退回策略默认值 */ }
      return null; // 文件存在但无效/unmeasured → 不再向上找（避免读到祖父项目的）
    }
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// 当前生效的 per-scenario token：校准实测优先，否则取当前策略硬编值。
function activePerScenarioTokens() {
  const cal = readCalibratedPerScenario(process.cwd());
  if (cal != null) return { value: cal, source: 'calibrated' };
  return { value: activeStrategy().perScenarioTokens, source: 'strategy' };
}

function windowFromModelKeyword(model) {
  const id = String(model || '');
  if (!id) return null;
  if (/(^|[^0-9])1m\b|-1m\b|\[1m\]|1[\s_-]?million/i.test(id)) return 1000000;
  if (/claude|opus|sonnet|haiku/i.test(id)) return 200000;
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo/i.test(id)) return 128000;
  return null;
}

function windowTokens() {
  const env = parseInt(process.env.BP_CONTEXT_WINDOW || '', 10);
  if (Number.isFinite(env) && env > 0) return env;
  const byModel = windowFromModelKeyword(process.env.ANTHROPIC_MODEL);
  if (byModel) return byModel;
  return DEFAULT_WINDOW;
}

function windowSource() {
  const env = parseInt(process.env.BP_CONTEXT_WINDOW || '', 10);
  if (Number.isFinite(env) && env > 0) return 'BP_CONTEXT_WINDOW';
  if (windowFromModelKeyword(process.env.ANTHROPIC_MODEL)) return 'ANTHROPIC_MODEL';
  return 'default';
}

function planningBudget() { return Math.round(windowTokens() * activeStrategy().safety); }
function tokensOfBytes(bytes) { return Math.ceil((Number(bytes) || 0) / BYTES_PER_TOKEN); }

// 给定每特性固定文档开销 F（字节），返回一个 feature 还能装多少个 BDD 场景。
function maxScenariosPerFeature(fixedDocBytes) {
  const room = planningBudget() - tokensOfBytes(fixedDocBytes);
  const per = activePerScenarioTokens().value;
  return Math.max(1, Math.floor(room / per));
}

// 投影某 feature 的上下文占用（tokens）= 固定文档 + 场景数 × 单场景成本（校准优先）。
function estimateFootprint({ fixedDocBytes = 0, scenarioCount = 0 } = {}) {
  return tokensOfBytes(fixedDocBytes) + (Number(scenarioCount) || 0) * activePerScenarioTokens().value;
}

module.exports = {
  STRATEGIES, DEFAULT_STRATEGY, BYTES_PER_TOKEN, DEFAULT_WINDOW,
  setCliStrategyOverride, activeStrategy,
  readCalibratedPerScenario, activePerScenarioTokens,
  windowTokens, windowSource, planningBudget, tokensOfBytes,
  maxScenariosPerFeature, estimateFootprint,
};

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--fixed-bytes');
  const fixedBytes = (fi >= 0 && args[fi + 1]) ? (parseInt(args[fi + 1], 10) || 0) : 0;
  const si = args.indexOf('--strategy');
  if (si >= 0 && args[si + 1]) {
    const want = String(args[si + 1]).trim();
    if (!STRATEGIES[want]) {
      process.stderr.write('未知策略 "' + want + '"，合法值：' + Object.keys(STRATEGIES).join(' / ') + '\n');
      process.exit(2);
    }
    setCliStrategyOverride(want);
  }
  const strat = activeStrategy();
  const out = {
    source: windowSource(),
    windowTokens: windowTokens(),
    strategy: strat.name,
    strategySource: strat.source,
    strategyDesc: strat.desc,
    safety: strat.safety,
    perScenarioTokens: activePerScenarioTokens().value,
    perScenarioSource: activePerScenarioTokens().source,
    overflowCeil: strat.overflowCeil,
    planningBudget: planningBudget(),
    tokensPerFeatureBudget: planningBudget(), // 同 planningBudget，直观字段名给 SKILL.md 用
    fixedDocBytes: fixedBytes,
    maxScenariosPerFeature: fixedBytes ? maxScenariosPerFeature(fixedBytes) : null,
    availableStrategies: Object.fromEntries(
      Object.entries(STRATEGIES).map(([k, v]) => [k, { safety: v.safety, perScenarioTokens: v.perScenarioTokens, overflowCeil: v.overflowCeil, desc: v.desc }])
    ),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
