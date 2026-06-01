#!/usr/bin/env node
// gate_st.cjs —— ST 验收对账硬门（顶层，置于 st 之后）—— long-task-simple 精简版
// 校验 st 节点产出的**结构化 JSON 验收报告** st-acceptance.json：
//   bdd.json 中每条 scenario.id 都在 bdd_reconcile[] 有一条 verdict=="PASS" 且 evidence 非空的记录；
//   且整体 verdict 非 "No-Go"、无未关闭 Critical/Major 缺陷；并真跑全量回归做机械兜底。
//
// 本蓝图无 SRS / Design：**不做** L3 重量级签收（l3-signoff.json）、design §9.1 NFR 实测、
// design §9.2 状态机 lifecycle trace、design §9.3 外依赖 stub 证据，也不做 critical 场景独立证据/rubric。
// 唯一对账权威源 = bdd.json 场景 then/examples。
//
// v10 风格：由 review skill 的 LLM 直接 `node` 运行（无框架 stdin）。cwd 即蓝图工作区。
// stdout: 最后一行 JSON {pass, message, blocked}
// exit:   0 always（LLM 读 stdout 决定三态）
// 语言无关：解析的是 JSON 验收报告，不依赖任何技术栈。

const fs = require('fs');
const path = require('path');
const { runAllTests } = require('./_test-runner.cjs');

const MAX_REPORT = 40;
const ACCEPTANCE_REL = '.harness/memory/plans/st-acceptance.json';

function emit(pass, message, blocked) {
  process.stdout.write(JSON.stringify({ pass: !!pass, message: String(message || ''), blocked: !!blocked }) + '\n');
  process.exit(0);
}
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function upper(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

(async () => {
  try {
    const cwd = process.cwd();

    // ---- bdd.json → 全部 scenario id ----
    const bddPath = path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json');
    if (!fs.existsSync(bddPath)) emit(false, 'bdd.json 缺失（应由上游 bdd 节点产出）：' + path.relative(cwd, bddPath), true);
    let bdd;
    try { bdd = JSON.parse(fs.readFileSync(bddPath, 'utf8')); }
    catch (e) { emit(false, 'bdd.json 不是合法 JSON：' + e.message, true); }
    if (!bdd || typeof bdd !== 'object' || !Array.isArray(bdd.features)) emit(false, 'bdd.json 结构异常（features 非数组）', true);

    const scenarios = new Map(); // 大写 id -> 可读标签
    for (const feat of bdd.features) {
      if (!feat || typeof feat !== 'object' || !Array.isArray(feat.scenarios)) continue;
      const fname = isNonEmptyString(feat.feature) ? feat.feature.trim() : '?';
      for (const sc of feat.scenarios) {
        if (!sc || typeof sc !== 'object' || !isNonEmptyString(sc.id)) continue;
        const sid = upper(sc.id);
        scenarios.set(sid, fname + ' / ' + (isNonEmptyString(sc.scenario) ? sc.scenario.trim() : sc.id.trim()));
      }
    }
    if (scenarios.size === 0) emit(false, 'bdd.json 无任何 scenario（异常，应由 gate_bdd 拦下）', true);

    // ---- st-acceptance.json（结构化验收报告）----
    const accPath = path.join(cwd, ACCEPTANCE_REL);
    if (!fs.existsSync(accPath)) {
      emit(false, '验收报告缺失：' + ACCEPTANCE_REL + '（st 节点应产出结构化 JSON：含 bdd_reconcile[]，每条 {id, verdict, expected, actual, evidence}）', true);
    }
    let acc;
    try { acc = JSON.parse(fs.readFileSync(accPath, 'utf8')); }
    catch (e) { emit(false, '验收报告不是合法 JSON：' + ACCEPTANCE_REL + ' — ' + e.message, true); }
    if (!acc || typeof acc !== 'object' || !Array.isArray(acc.bdd_reconcile)) {
      emit(false, '验收报告结构异常：缺数组字段 bdd_reconcile[]（每条 {id, verdict:"PASS"|"FAIL", expected, actual, evidence}）', true);
    }

    // 索引 bdd_reconcile：id -> entry（重复 id 取最后一条）
    const byId = new Map();
    for (const r of acc.bdd_reconcile) {
      if (r && typeof r === 'object' && isNonEmptyString(r.id)) byId.set(upper(r.id), r);
    }

    // ---- 逐 scenario 核对 ----
    const missing = [];          // bdd_reconcile 无此 id
    const failed = [];           // verdict != PASS
    const noEvidence = [];       // PASS 但 evidence 空（不可核实）
    const passed = [];
    for (const [id, label] of scenarios) {
      const r = byId.get(id);
      if (!r) { missing.push(id + '（' + label + '）'); continue; }
      const verdict = upper(r.verdict);
      if (verdict !== 'PASS') { failed.push(id + '（' + label + '，verdict=' + (r.verdict || '(空)') + '）'); continue; }
      if (!isNonEmptyString(r.evidence)) { noEvidence.push(id + '（' + label + '）'); continue; }
      passed.push(id);
    }
    // bdd_reconcile 里引用了 bdd.json 不存在的 id（笔误/陈旧）
    const ghost = [];
    for (const id of byId.keys()) if (!scenarios.has(id)) ghost.push(id);

    // ---- 整体裁决 + 未关闭 Critical/Major ----
    const overall = upper(acc.verdict);
    const openBlocking = Array.isArray(acc.defects)
      ? acc.defects.filter(d => d && typeof d === 'object'
          && ['CRITICAL', 'MAJOR'].includes(upper(d.severity))
          && !['FIXED', 'DEFERRED', 'CLOSED'].includes(upper(d.status)))
      : [];

    // ---- 真跑全量回归（多语言 + 多 build 根）——ST 不能只信 LLM 自报的 st-acceptance.json ----
    // 这是顶层验收的机械兜底：哪怕 bdd_reconcile 全标 PASS，测试套件真跑非全绿就一票否决。
    const tr = runAllTests(cwd);

    const problems = [];
    if (tr.anyFailed) problems.push('全量回归测试未通过（真跑）：\n' + tr.info + (tr.tail ? '\n' + tr.tail.slice(-1500) : ''));
    if (missing.length) problems.push('未对账（bdd_reconcile 缺，' + missing.length + '）：' + missing.slice(0, MAX_REPORT).join('；'));
    if (failed.length) problems.push('对账判 FAIL（' + failed.length + '）：' + failed.slice(0, MAX_REPORT).join('；'));
    if (noEvidence.length) problems.push('PASS 但无 evidence 不可核实（' + noEvidence.length + '）：' + noEvidence.slice(0, MAX_REPORT).join('；'));
    if (ghost.length) problems.push('bdd_reconcile 含 bdd.json 不存在的 id：' + ghost.slice(0, MAX_REPORT).join(', '));
    if (overall === 'NO-GO') problems.push('整体 verdict=No-Go');
    if (openBlocking.length) problems.push('存在未关闭 Critical/Major 缺陷 ' + openBlocking.length + ' 个');

    if (problems.length === 0) {
      const trNote = tr.ran
        ? '；全量回归真跑全绿（' + tr.results.filter((r) => r.ran).map((r) => r.stack + ' exit=0').join('、') + '）'
        : '；（注：未发现可机械运行的测试栈，仅做 JSON 对账——若本应有可跑测试请核查 build 根）';
      emit(true, 'ST 验收对账通过：bdd.json 全部 ' + scenarios.size + ' 条场景在 st-acceptance.json 中均 verdict=PASS 且附 evidence'
        + (overall ? '；整体 verdict=' + acc.verdict : '')
        + trNote + '。');
    }

    // 缺对账/无证据/FAIL 多为可整改的对账缺口（rewind st）；JSON 不可读/结构坏才算环境型 BLOCKED（已在上方提前 emit）。
    emit(false, 'ST 验收对账未通过：' + problems.join(' | ')
      + `（已 PASS ${passed.length}/${scenarios.size}；请在 st 节点补全/修正 st-acceptance.json 后重跑）`, false);
  } catch (e) {
    emit(false, 'gate_st 内部错误（请检查 bdd.json / st-acceptance.json 可读性）：' + (e && e.message ? e.message : String(e)), true);
  }
})();
