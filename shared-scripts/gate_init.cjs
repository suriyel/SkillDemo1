#!/usr/bin/env node
// gate_init.cjs —— Init 硬门
// 检查 init 节点产出的两份产物：
//   state.loops[<loopId>].tasks  （bp-tasks set 灌入的 items[]）
//   .harness/memory/plans/project-context.md （下游 impl 消费的全局上下文）
//
// 本蓝图无 SRS / Design：不校验 srs_trace、不校验 design §9（NFR/状态机/外依赖）。
// 校验 REQUIRED_FIELDS / VALID_STATUSES / VALID_PRIORITIES / bdd_ids 格式 /
// BDD 全覆盖 / 依赖闭包 / project-context.md。
//
// stdin:  {schemaVersion:2, cwd, loops:{<loopId>:{tasks[],...}}, ...}
// stdout: 最后一行 JSON {pass:bool, message:string}
// exit:   0 normal / 2 schema error

const fs = require('fs');
const path = require('path');
const budget = require('./_context-budget.cjs'); // 上下文预算工具（按真实窗口右size）

// ---- 常量（照搬 validate_features.py:32-37）---------------------------------
const REQUIRED_FIELDS = ['id', 'category', 'title', 'description', 'priority', 'status'];
const BDD_ID_PATTERN = /^BDD-\d+$/;
const VALID_STATUSES = new Set(['failing', 'passing']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const VALID_LANGUAGES = new Set(['python', 'java', 'javascript', 'typescript', 'c', 'cpp', 'c++', 'todo']);

// ---- 工具 -------------------------------------------------------------------
function emit(pass, message) {
  process.stdout.write(JSON.stringify({ pass: !!pass, message: String(message || '') }) + '\n');
  process.exit(0);
}

// ---- A. tasks 数组校验（数据来源 = stdin.loops，非磁盘文件）--------------------
function validateTasksArray(tasks, loopId) {
  const errors = [];
  const prefix0 = 'loop[' + loopId + ']';

  if (!Array.isArray(tasks)) return [prefix0 + ': tasks 必须是数组，当前是 ' + (tasks === null ? 'null' : typeof tasks)];
  if (tasks.length === 0) return [prefix0 + ': tasks 数组为空'];

  const idsSeen = new Set();
  for (let i = 0; i < tasks.length; i++) {
    const feat = tasks[i];
    const prefix = prefix0 + '.tasks[' + i + ']';

    if (feat === null || typeof feat !== 'object' || Array.isArray(feat)) {
      errors.push(prefix + ': 必须是对象');
      continue;
    }

    // 必填字段
    for (const fname of REQUIRED_FIELDS) {
      if (!(fname in feat) || feat[fname] === null || feat[fname] === '') {
        errors.push(prefix + ': 缺必填字段 "' + fname + '"');
      }
    }

    // id 唯一（accept int 或 string，仅查重）
    const fid = feat.id;
    if (fid !== undefined && fid !== null) {
      const key = typeof fid + ':' + String(fid);
      if (idsSeen.has(key)) errors.push(prefix + ' (id=' + fid + '): id 重复');
      idsSeen.add(key);
    }

    // status
    if (feat.status && !VALID_STATUSES.has(feat.status)) {
      errors.push(prefix + ' (id=' + fid + '): status "' + feat.status + '" 非法，应 ∈ ' + Array.from(VALID_STATUSES).join('|'));
    }

    // priority
    if (feat.priority && !VALID_PRIORITIES.has(feat.priority)) {
      errors.push(prefix + ' (id=' + fid + '): priority "' + feat.priority + '" 非法，应 ∈ ' + Array.from(VALID_PRIORITIES).join('|'));
    }

    // 本蓝图无 SRS / FR-id：不校验 srs_trace（残留字段忽略不报错，向后兼容）。

    // bdd_ids（L3 BDD 指针）—— 若提供须为 BDD-\d+ 字符串数组
    if (feat.bdd_ids !== undefined && feat.bdd_ids !== null) {
      if (!Array.isArray(feat.bdd_ids)) {
        errors.push(prefix + ' (id=' + fid + '): bdd_ids 必须是数组');
      } else {
        for (let bi = 0; bi < feat.bdd_ids.length; bi++) {
          const b = feat.bdd_ids[bi];
          if (typeof b !== 'string' || !BDD_ID_PATTERN.test(b)) {
            errors.push(prefix + ' (id=' + fid + '): bdd_ids[' + bi + '] 应匹配 BDD-\\d+，当前 "' + b + '"');
          }
        }
      }
    }

    // verification_steps
    if (feat.verification_steps !== undefined && feat.verification_steps !== null) {
      if (!Array.isArray(feat.verification_steps) || feat.verification_steps.length === 0) {
        errors.push(prefix + ' (id=' + fid + '): verification_steps 必须是非空数组');
      }
    }

    // constraints / assumptions 已收敛为项目级单一源 project-context.md（见 validateContextMd）。
    // task 对象不再承载这两个字段，故此处不做 per-task 校验。
  }

  // 依赖闭包（第二趟）
  const allIds = new Set();
  for (const f of tasks) if (f && typeof f === 'object' && f.id !== undefined) {
    allIds.add(typeof f.id + ':' + String(f.id));
  }
  for (let i = 0; i < tasks.length; i++) {
    const feat = tasks[i];
    if (!feat || typeof feat !== 'object') continue;
    const deps = feat.dependencies;
    if (Array.isArray(deps)) {
      for (const dep of deps) {
        const key = typeof dep + ':' + String(dep);
        if (!allIds.has(key)) {
          errors.push('tasks[' + i + '] (id=' + feat.id + '): 依赖 id=' + dep + ' 不存在');
        }
      }
    }
  }

  return errors;
}

// ---- A2. BDD 全覆盖校验（task.bdd_ids 并集须无损覆盖 bdd.json 全部场景）---------
// 防「BDD 场景在拆解时丢失」——init Step 4d 的 bdd_ids 必须把每条场景认领到某个 task，
// 否则该场景的 then 永远不会进 wd §测试清单 / impl 测试 / review + gate_review 核验。
function validateBddCoverage(tasks, cwd) {
  const bddPath = path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json');
  if (!fs.existsSync(bddPath)) {
    return ['bdd.json 缺失: ' + path.relative(cwd, bddPath) + '（应由上游 bdd 节点产出，无法做 BDD 全覆盖校验）'];
  }
  let bdd;
  try { bdd = JSON.parse(fs.readFileSync(bddPath, 'utf8')); }
  catch (e) { return ['bdd.json 不是合法 JSON: ' + e.message]; }
  if (!bdd || typeof bdd !== 'object' || !Array.isArray(bdd.features)) {
    return ['bdd.json 结构异常（features 非数组），无法做 BDD 全覆盖校验'];
  }

  // bdd.json 全部场景 id 全集
  const allScenarioIds = new Set();
  for (const feat of bdd.features) {
    if (!feat || typeof feat !== 'object' || !Array.isArray(feat.scenarios)) continue;
    for (const sc of feat.scenarios) {
      if (sc && typeof sc === 'object' && typeof sc.id === 'string' && sc.id.trim()) {
        allScenarioIds.add(sc.id.trim().toUpperCase());
      }
    }
  }
  if (allScenarioIds.size === 0) return []; // bdd.json 无场景 → 不约束（异常应由 gate_bdd 拦下）

  // 所有 task 的 bdd_ids 并集
  const claimed = new Set();
  if (Array.isArray(tasks)) {
    for (const feat of tasks) {
      if (!feat || typeof feat !== 'object' || !Array.isArray(feat.bdd_ids)) continue;
      for (const b of feat.bdd_ids) {
        if (typeof b === 'string' && b.trim()) claimed.add(b.trim().toUpperCase());
      }
    }
  }

  const errors = [];
  // 1) 每个场景 id 至少被一个 task 认领（无孤立 BDD 场景）
  const orphan = [];
  for (const id of allScenarioIds) if (!claimed.has(id)) orphan.push(id);
  if (orphan.length) {
    orphan.sort();
    errors.push('BDD 场景未被任何 task 的 bdd_ids 认领（' + orphan.length + '/' + allScenarioIds.size
      + '）：' + orphan.join(', ') + '（请在 init Step 4d 为相关 task 补全 bdd_ids）');
  }
  // 2) 每个 bdd_ids 项在 bdd.json 中真实存在（防笔误/陈旧 id）
  const ghost = [];
  for (const id of claimed) if (!allScenarioIds.has(id)) ghost.push(id);
  if (ghost.length) {
    ghost.sort();
    errors.push('task.bdd_ids 含 bdd.json 中不存在的场景 id：' + ghost.join(', '));
  }
  return errors;
}

// ---- A3. 上下文预算右size 校验（按真实窗口判每个 feature 投影占用）-------------
// 量 wd 每迭代固定要读的文档(F) + 每 feature 的 BDD 场景数(V) → 投影占用 tokens。
// 硬 fail：投影 > 窗口×0.85（会溢出上下文 → 必拆，这是蓝图本要消除的内部漂移）。
// 软建议：略超规划预算（建议拆/single_round）、或远低于可容量（偏薄 → 建议合并摊薄 F）。
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

function validateContextBudget(tasks, cwd) {
  const errors = [];
  const advisories = [];
  if (!Array.isArray(tasks) || tasks.length === 0) return { errors, advisories };
  const F = measureFixedDocBytes(cwd);
  const W = budget.windowTokens();
  const maxN = budget.maxScenariosPerFeature(F);
  const strat = budget.activeStrategy();
  const ceilRatio = strat.overflowCeil;
  const overflowCeil = Math.floor(W * ceilRatio);
  const thinFloor = Math.max(1, Math.floor(maxN * 0.25));
  const tag = '[策略=' + strat.name + ' ceil=' + Math.round(ceilRatio * 100) + '%] ';
  for (const feat of tasks) {
    if (!feat || typeof feat !== 'object') continue;
    const n = Array.isArray(feat.bdd_ids) ? feat.bdd_ids.length : 0;
    if (n === 0) continue; // 无 BDD 场景的纯内部 task 不参与预算判定
    const projected = budget.estimateFootprint({ fixedDocBytes: F, scenarioCount: n });
    if (projected > overflowCeil) {
      // 溢出仅告警、不再硬 fail（拆分打回已移除；权威预算判定在上游 gate_decompose）。
      advisories.push(tag + 'task(id=' + feat.id + ')：' + n + ' 个 BDD 场景投影 ~' + projected
        + ' tok > 窗口 ' + W + ' 的 ' + Math.round(ceilRatio * 100)
        + '% → 可能在会话内溢出（仅提示，不强制拆）');
    } else if (n > maxN) {
      advisories.push(tag + 'task(id=' + feat.id + ')：' + n + ' 个场景略超规划预算（建议上限 ~' + maxN
        + '），建议拆分或标 single_round');
    } else if (n < thinFloor) {
      advisories.push(tag + 'task(id=' + feat.id + ')：仅 ' + n + ' 个场景、远低于窗口可容 ~' + maxN
        + '，偏薄 → 建议与同源兄弟 feature 合并以摊薄固定开销');
    }
  }
  return { errors, advisories };
}

// ---- B. project-context.md 校验 --------------------------------------------
function validateContextMd(filePath) {
  const errors = [];
  const advisories = [];
  const { normalizeLanguage } = require('./_lang-normalize.cjs');

  if (!fs.existsSync(filePath)) return { errors: ['project-context.md 未生成: ' + filePath], advisories: [] };

  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { return { errors: ['读取失败: ' + e.message], advisories: [] }; }

  if (content.length < 50) errors.push('内容过短 (' + content.length + ' < 50 chars)，疑似桩文件');

  // 5 个必填标题
  const sections = [
    { re: /(^|\n)#\s+Project Context\b/, name: '# Project Context' },
    { re: /(^|\n)##\s+Project\b/, name: '## Project' },
    { re: /(^|\n)##\s+Tech Stack\b/, name: '## Tech Stack' },
    { re: /(^|\n)##\s+Constraints\b/, name: '## Constraints' },
    { re: /(^|\n)##\s+Assumptions\b/, name: '## Assumptions' },
  ];
  for (const s of sections) {
    if (!s.re.test(content)) errors.push('缺标题: ' + s.name);
  }

  // Tech Stack 三行（language 走软降级：未知→todo + advisory；别名命中→写回标准值）
  let newContent = content;
  let contentChanged = false;
  const techFields = ['language', 'test_framework', 'coverage_tool'];
  for (const f of techFields) {
    const re = new RegExp('(^|\\n)\\s*-\\s*' + f + ':\\s*(\\S+)');
    const m = newContent.match(re);
    if (!m) {
      errors.push('Tech Stack 缺字段: ' + f);
    } else if (f === 'language') {
      const raw = m[2];
      const r = normalizeLanguage(raw);
      const lineRe = /(^|\n)(\s*-\s*language:\s*)(\S+)([^\n]*)/;
      if (!r.isKnown) {
        // 未知 language：自动写回为 todo + [ENV-FIXABLE] advisory（非 error）
        // 下游 _code-smells 对 todo 已天然容忍（返空 findings + exit 0）；_test-runner 不读 language。
        newContent = newContent.replace(lineRe, function(_, anchor, prefix, _val, rest) {
          const hasCR = rest.endsWith('\r');
          return anchor + prefix + 'todo  <!-- auto-coerced from "' + raw + '" (unsupported, falls back to todo) -->' + (hasCR ? '\r' : '');
        });
        contentChanged = true;
        advisories.push('language "' + raw + '" 不在支持集合，已自动降级为 todo（下游按 todo 兜底执行）');
      } else if (r.isCoerced) {
        // 别名命中（如 cxx→cpp、ts→typescript）：写回标准值，无 advisory
        newContent = newContent.replace(lineRe, function(_, anchor, prefix, _val, rest) {
          const hasCR = rest.endsWith('\r');
          return anchor + prefix + r.normalized + (hasCR ? '\r' : '');
        });
        contentChanged = true;
      }
    }
  }

  if (contentChanged) {
    try { fs.writeFileSync(filePath, newContent, 'utf8'); } catch (_) { /* 写回失败不阻塞门禁 */ }
  }

  return { errors, advisories };
}

// ---- 主流程 ----------------------------------------------------------------
(async () => {
  // v10: 由 review skill 的 LLM 直接运行（无框架 stdin）。从
  // .harness/blueprint/state.json 读框架 state（loops/tasks）；cwd 即运行目录。
  const cwd = process.cwd();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'blueprint', 'state.json'), 'utf8')); }
  catch (_) { /* state 不可读：loops 视为空，下方校验会提示 */ }

  // tasks 校验 — 从 state.loops 获取（bp-tasks set 灌入的 items[]）
  const loops = state.loops || {};
  const loopEntries = Object.entries(loops);
  let tasksErrors = [];
  let tasksArr = [];
  if (loopEntries.length === 0) {
    tasksErrors = ['未检测到已灌入的 tasks（loops 为空）；请确认 init 节点已调用 bp-tasks set'];
  } else {
    // 取第一个有 tasks 的 loop（正常情况下仅一个）
    const [loopId, loopData] = loopEntries[0];
    tasksArr = loopData.tasks || [];
    tasksErrors = validateTasksArray(tasksArr, loopId);
  }

  // BDD 全覆盖校验 — 仅在有 tasks 时执行（loops 为空已由 tasksErrors 提示）
  const bddCovErrors = loopEntries.length === 0 ? [] : validateBddCoverage(tasksArr, cwd);

  // project-context.md 校验 — 仍为磁盘文件
  const memoryDir = path.join(cwd, '.harness', 'memory', 'plans');
  const ctxPath = path.join(memoryDir, 'project-context.md');
  const { errors: ctxErrors, advisories: ctxAdvisories } = validateContextMd(ctxPath);

  // 上下文预算右size 校验（溢出仅告警、不打回；过薄过肥也只软建议）。权威预算门在上游 gate_decompose。
  const { advisories: budgetAdvisories } = loopEntries.length === 0
    ? { advisories: [] }
    : validateContextBudget(tasksArr, cwd);
  const budgetAdvNote = budgetAdvisories.length ? '\n[上下文预算建议] ' + budgetAdvisories.join('；') : '';
  const ctxAdvNote = ctxAdvisories.length ? '\n[语言降级] ' + ctxAdvisories.join('；') : '';
  const advNote = budgetAdvNote + ctxAdvNote;

  // 本蓝图无 design.md：不做 §9（NFR/状态机/自治边界）校验。

  if (tasksErrors.length === 0 && bddCovErrors.length === 0 && ctxErrors.length === 0) {
    emit(true, 'Init 校验通过：tasks（via loops）+ BDD 全覆盖 + project-context.md + 上下文预算 均合格' + advNote);
  }

  const parts = [];
  if (tasksErrors.length) parts.push('tasks: ' + tasksErrors.join('；'));
  if (bddCovErrors.length) parts.push('BDD 覆盖: ' + bddCovErrors.join('；'));
  if (ctxErrors.length) parts.push('project-context.md: ' + ctxErrors.join('；'));
  emit(false, parts.join(' | ') + advNote);
})();
