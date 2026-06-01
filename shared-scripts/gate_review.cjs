#!/usr/bin/env node
// gate_review.cjs —— 脚本机检硬门（loop iter 体内，置于 review 之后）
//
// 这是「双层质量保障」的客观事实层：上游 review skill 是 LLM 主观挑刺（语义级），
// 本门是脚本机检客观事实兜底——真跑测试 + grep BDD id 覆盖 + 标记附近断言深度
// + then 精确值命中 + 边界契约违约信号。review 漏判的客观缺口由本门抓回。
//
// 失败分类（按 FAILKIND 在 message 前缀标记，供 blueprint.json onFail.candidates 路由）：
//   [CONTENT-GAP][FAILKIND: impl]   —— 漏 BDD id / 断言过浅 / then 精确值无命中 / 测试不绿非 env / 边界契约违约
//   [ENV-FIXABLE][FAILKIND: env]    —— 仅环境签名（缺依赖/工具/服务/shell 解析），无任何内容缺口
//
// 本蓝图无 SRS / Design / wd：不检状态机闭环（design §9.2）、不检 NFR 实现痕迹（design §9.1）、
// 无 feature-tests.json B 维。行为契约 = bdd.json 场景 then/examples；mock 可观察面为 advisory（由 review LLM 判）。
//
// stdout: 多行「证据报告」+ 最后一行 JSON {pass, message, blocked}
// exit:   0 always（gate_review SKILL.md 的 LLM 读 stdout 决定 OK/FAIL/BLOCKED）

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runAllTests } = require('./_test-runner.cjs');

// ============================================================
// 常量段（继承自 gate_behavior + gate_red）
// ============================================================

const ID_TOKEN = /\bBDD-\d+\b/gi;
const MAX_REPORT = 40;
const BLOCK_RADIUS_BEHAVIOR = 16;  // gate_behavior 用：mock + 期望 token 证据窗口
const BLOCK_RADIUS_DEPTH = 25;     // gate_red 用：断言深度检查窗口（红测试方法体常在此内）
const SNIPPET_MAX = 1400;

const IGNORE_DIRS = new Set([
  '.harness', 'node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', 'coverage', '.next', '.nuxt',
  '.idea', '.vscode', '.gradle', 'bin', 'obj', 'vendor', '.tox', '.mypy_cache',
]);
const CODE_EXT = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.java', '.go', '.rs',
  '.rb', '.cs', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh', '.kt', '.kts',
  '.swift', '.php', '.scala', '.m', '.mm', '.feature', '.groovy', '.dart',
  '.ex', '.exs', '.clj', '.cljs', '.lua', '.pl', '.r',
]);
const MAX_FILE = 1024 * 1024;
const FILE_BUDGET = 20000;

// 断言深度（来自 gate_red）
const ASSERT_RE = /\b(assertEquals|assertNotEquals|assertThat|assertTrue|assertFalse|assertNull|assertNotNull|assertThrows|assertRaises|assertSame|assertArrayEquals|assert_eq|assert_ne|expect|should|verify|require)\b|\bassert\b|\bassert[_!]?\s*\(|\bt\.(Error|Errorf|Fatal|Fatalf)\b|\bEXPECT_[A-Z]+\b|\bASSERT_[A-Z]+\b/;
const PLACEHOLDER_RE = /\b(TODO|FIXME|not[\s_-]?implemented|notimplemented|unimplemented)\b|^\s*pass\s*$|\bfail\s*\(\s*['"][^'"]*not[\s_-]?impl/i;
const TAUTOLOGY_RE = /\bassert\s+True\b|\bassert\s*\(\s*true\s*\)|\bassertTrue\s*\(\s*true\s*\)|\bexpect\s*\(\s*(true|1|0)\s*\)\s*\.\s*\w+\s*\(\s*(true|1|0)?\s*\)|\bassert\s+1\s*==\s*1\b|\bassert_eq!\s*\(\s*1\s*,\s*1\s*\)/i;

// 整模块/整符号「打桩」指示（来自 gate_behavior）
const MOCK_PATTERNS = [
  /\bvi\.mock\s*\(/,
  /\bjest\.mock\s*\(/,
  /\bjest\.doMock\s*\(/,
  /\bmock\.module\s*\(/,
  /@\s*patch\s*\(/,
  /@\s*mock\.patch\s*\(/,
  /\bmock\.patch\s*\(/,
  /\bmocker\.patch\s*\(/,
  /\bMockito\.mock\s*\(/,
  /@\s*Mock\b/,
  /\bgomock\b/,
  /\bsinon\.(stub|mock|replace)\s*\(/,
  /\bunittest\.mock\b/,
];

// 环境/工具型失败签名（来自 gate_behavior）
const ENV_SIGNATURES = [
  /was unexpected at this time/i,
  /is not recognized as an internal or external command/i,
  /is not recognized as the name of a cmdlet/i,
  /command not found/i,
  /(^|\n)\s*(\/\S*\/)?(sh|bash|zsh|dash|ksh):[^\n]*\bnot found\b/i,
  /no such file or directory/i,
  /cannot find module/i, /\bMODULE_NOT_FOUND\b/,
  /npm err! enoent/i, /npm error code enoent/i,
  /npm err! missing script/i, /npm error missing script/i,
  /ModuleNotFoundError/, /No module named/i, /\bImportError\b/,
  /Could not resolve dependencies/i, /Non-resolvable/i,
  /Could not find artifact/i, /Could not transfer artifact/i,
  /Plugin .* not found/i, /Could not find or load main class/i,
  /cannot find package/i, /missing go\.sum entry/i,
  /no such command/i, /\bNU1101\b/, /\bMSB1009\b/, /\bMSB3644\b/,
  /ECONNREFUSED/, /Connection refused/i,
];
function isEnvFailure(text) {
  const s = String(text || '');
  return ENV_SIGNATURES.some((re) => re.test(s));
}

// 边界契约违约签名（来自 gate_behavior）
const BOUNDARY_CONTRACT_SIGNATURES = [
  /\bNullPointerException\b/,
  /\bTypeError:\s/i, /Cannot read prop/i, /Cannot invoke .* on null/i,
  /AttributeError:/i, /'NoneType' object has no/i,
  /\b(HTTP\s*)?5\d{2}\b/,
  /\bInternal Server Error\b/i,
  /unhandled\s+(rejection|exception|panic)/i,
  /\bnil pointer dereference\b/i,
];
function hasBoundaryContractSignal(text) {
  const s = String(text || '');
  return BOUNDARY_CONTRACT_SIGNATURES.some((re) => re.test(s));
}

// ============================================================
// 辅助函数
// ============================================================

function emit(pass, message, blocked) {
  process.stdout.write(JSON.stringify({ pass: !!pass, message: String(message || ''), blocked: !!blocked }) + '\n');
  process.exit(0);
}
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + ' …[truncated]' : s; }

function pickCurrentTask(state) {
  const loops = (state && state.loops) || {};
  for (const ls of Object.values(loops)) {
    if (!ls || !Array.isArray(ls.tasks) || ls.exited) continue;
    const idx = (ls.taskIndex != null) ? ls.taskIndex : -1;
    if (idx >= 0 && idx < ls.tasks.length && ls.tasks[idx]) return ls.tasks[idx];
  }
  return null;
}

function scanWorkspaceLocations(root) {
  const locs = new Map();
  const budget = { files: FILE_BUDGET };
  (function walk(dir) {
    if (budget.files <= 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (budget.files <= 0) return;
      if (e.isSymbolicLink && e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        if (!CODE_EXT.has(path.extname(e.name).toLowerCase())) continue;
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (st.size > MAX_FILE) continue;
        budget.files--;
        let txt;
        try { txt = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
        if (!ID_TOKEN.test(txt)) { ID_TOKEN.lastIndex = 0; continue; }
        ID_TOKEN.lastIndex = 0;
        const lines = txt.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(ID_TOKEN);
          if (!m) continue;
          for (const t of m) {
            const id = t.toUpperCase();
            if (!locs.has(id)) locs.set(id, []);
            locs.get(id).push({ file: path.relative(root, full), line: i + 1, _full: full });
          }
        }
      }
    }
  })(root);
  return locs;
}

// 断言深度（来自 gate_red）
function windowTextForId(idLocs) {
  const cache = new Map();
  const chunks = [];
  for (const loc of (idLocs || []).slice(0, 12)) {
    let lines = cache.get(loc._full);
    if (!lines) {
      try { lines = fs.readFileSync(loc._full, 'utf8').split(/\r?\n/); } catch (_) { lines = []; }
      cache.set(loc._full, lines);
    }
    const from = Math.max(0, loc.line - 1 - BLOCK_RADIUS_DEPTH);
    const to = Math.min(lines.length, loc.line - 1 + BLOCK_RADIUS_DEPTH + 1);
    chunks.push(lines.slice(from, to).join('\n'));
  }
  return chunks.join('\n');
}
function assertionDepth(idLocs) {
  const text = windowTextForId(idLocs);
  let realAssert = false, sawPlaceholder = false, sawAnyAssert = false;
  for (const ln of text.split('\n')) {
    if (PLACEHOLDER_RE.test(ln)) sawPlaceholder = true;
    if (ASSERT_RE.test(ln)) {
      sawAnyAssert = true;
      if (!TAUTOLOGY_RE.test(ln)) realAssert = true;
    }
  }
  if (realAssert) return { ok: true };
  const why = sawAnyAssert ? '仅重言式/永真断言（如 assert True / expect(true)）'
    : sawPlaceholder ? '仅占位/未实现（TODO / pass / not implemented）'
    : '标记附近无任何断言构造';
  return { ok: false, why };
}

// mock + 测试块片段（来自 gate_behavior）
function blockEvidence(loc) {
  let lines;
  try { lines = fs.readFileSync(loc._full, 'utf8').split(/\r?\n/); } catch (_) { return null; }
  const from = Math.max(0, loc.line - 1 - BLOCK_RADIUS_BEHAVIOR);
  const to = Math.min(lines.length, loc.line - 1 + BLOCK_RADIUS_BEHAVIOR + 1);
  const window = lines.slice(from, to);
  const snippet = window.join('\n');
  const mocks = [];
  for (let i = 0; i < window.length; i++) {
    for (const re of MOCK_PATTERNS) {
      if (re.test(window[i])) { mocks.push(`${loc.file}:${from + i + 1}: ${window[i].trim()}`); break; }
    }
  }
  return { snippet: clip(snippet, SNIPPET_MAX), mocks };
}

// 期望可观察 token（来自 gate_behavior）
function extractExpectedTokens(sc) {
  const tokens = new Set();
  const raw = [];
  const harvest = (arr, tag) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const s = String(item == null ? '' : item);
      if (s.trim()) raw.push(`${tag}: ${s.trim()}`);
      const qre = /'([^']{1,120})'|"([^"]{1,120})"|“([^”]{1,120})”|「([^」]{1,120})」/g;
      let m;
      while ((m = qre.exec(s)) !== null) {
        const v = m[1] || m[2] || m[3] || m[4];
        if (v && v.trim().length >= 1) tokens.add(v.trim());
      }
      const nre = /(?<![\w.])(-?\d+)(?![\w.])/g;
      let n;
      while ((n = nre.exec(s)) !== null) tokens.add(n[1]);
      const ere = /(?<![\w])([A-Z][A-Z0-9_]{0,15})(?![\w])/g;
      let e;
      while ((e = ere.exec(s)) !== null) {
        if (!/^(BDD|FR|IFR|CON|ASM|AC|TODO|NULL|TRUE|FALSE)$/.test(e[1])) tokens.add(e[1]);
      }
    }
  };
  harvest(sc.then, 'then');
  harvest(sc.examples, 'examples');
  return { tokens: [...tokens], raw };
}

// 调外部脚本采证（来自 gate_behavior）
function callSharedScript(scriptName, cwd, timeoutMs = 60000) {
  const scriptPath = path.join(__dirname, scriptName);
  if (!fs.existsSync(scriptPath)) return { ok: false, error: `script not found: ${scriptName}` };
  const r = spawnSync('node', [scriptPath], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) return { ok: false, error: `${scriptName} exit ${r.status}: ${(r.stderr || '').slice(0, 500)}` };
  const lines = String(r.stdout || '').trim().split(/\r?\n/);
  const last = lines[lines.length - 1] || '';
  try { return { ok: true, json: JSON.parse(last), rawStderr: r.stderr || '' }; }
  catch (e) { return { ok: false, error: `${scriptName} last line not JSON: ${last.slice(0, 200)}` }; }
}

// ============================================================
// 主流程
// ============================================================

if (require.main === module) (async () => {
  try {
    const cwd = process.cwd();
    const out = [];
    out.push('=== gate_review 证据报告（impl + review 之后的客观事实兜底门）===');

    // ---- 当前 task ----
    let state = {};
    try { state = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'blueprint', 'state.json'), 'utf8')); }
    catch (_) { emit(false, '无法读取 .harness/blueprint/state.json（loop 状态不可读，无法定位当前 task）', true); }

    const task = pickCurrentTask(state);
    if (!task) emit(false, '未能在 state.loops 中定位当前 task（tasks 为空或 taskIndex 越界）', true);
    const tid = task.id;
    const bddIds = Array.isArray(task.bdd_ids) ? task.bdd_ids.filter(isNonEmptyString).map(s => s.trim().toUpperCase()) : [];
    out.push(`task#${tid}  bdd_ids=[${bddIds.join(',')}]`);

    // ---- bdd.json ----
    const bddPath = path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json');
    if (!fs.existsSync(bddPath)) emit(false, 'bdd.json 缺失（应由上游 bdd 节点产出）：' + path.relative(cwd, bddPath), true);
    let bdd;
    try { bdd = JSON.parse(fs.readFileSync(bddPath, 'utf8')); }
    catch (e) { emit(false, 'bdd.json 不是合法 JSON：' + e.message, true); }
    if (!bdd || typeof bdd !== 'object' || !Array.isArray(bdd.features)) emit(false, 'bdd.json 结构异常（features 非数组）', true);

    // ---- 相关场景：task.bdd_ids（本蓝图唯一指针，无 srs_trace 回退）----
    const scenarioById = new Map();
    for (const feat of bdd.features) {
      if (!feat || typeof feat !== 'object' || !Array.isArray(feat.scenarios)) continue;
      const fname = isNonEmptyString(feat.feature) ? feat.feature.trim() : '?';
      for (const sc of feat.scenarios) {
        if (!sc || typeof sc !== 'object' || !isNonEmptyString(sc.id)) continue;
        const id = sc.id.trim().toUpperCase();
        scenarioById.set(id, { fname, sc });
      }
    }
    let unknownNote = '';
    let relevant = bddIds.filter(id => scenarioById.has(id));
    const unknown = bddIds.filter(id => !scenarioById.has(id));
    if (unknown.length) {
      unknownNote = `；task.bdd_ids 含 bdd.json 不存在的 id：${unknown.join(',')}`;
      out.push(`⚠ ${unknownNote.slice(1)}`);
    }
    relevant = [...new Set(relevant)];
    if (relevant.length === 0) {
      out.push('相关 BDD 场景：空集 → 本 task 无行为面需核验，通过。');
      process.stdout.write(out.join('\n') + '\n');
      emit(true, `task#${tid} 无相关 BDD 场景，gate_review 跳过${unknownNote}`);
    }
    out.push(`相关 BDD 场景（${relevant.length}）：${relevant.join(', ')}`);

    // ---- 工作区扫描（id -> 位置） ----
    const locs = scanWorkspaceLocations(cwd);

    // ---- 静态层：覆盖 + 断言深度（gate_red 风格，廉价早门）----
    out.push('');
    out.push('[静态层] BDD 覆盖 + 断言深度');
    const flagsMissing = [];
    const flagsShallow = [];
    for (const id of relevant) {
      const idLocs = locs.get(id) || [];
      if (idLocs.length === 0) {
        flagsMissing.push(id);
        out.push(`  - ${id}: ✗ 工作区无标记`);
        continue;
      }
      const depth = assertionDepth(idLocs);
      if (!depth.ok) {
        flagsShallow.push(`${id}（${depth.why}）`);
        out.push(`  - ${id}: ✗ 断言深度 ${depth.why}`);
      } else {
        out.push(`  - ${id}: ok（${idLocs.length} 处标记，断言深度 ok）`);
      }
    }

    // ---- 真跑测试（多语言 + 多 build 根聚合）----
    const t = runAllTests(cwd);
    out.push('');
    out.push('[测试运行] ' + t.info);
    if (t.tail) out.push('  ↳ ' + t.tail.replace(/\n/g, '\n  '));

    // ---- 动态层：逐场景采证（gate_behavior 风格）----
    out.push('');
    out.push('[动态层] 逐场景 mock + 期望 token 命中');
    const flagsMocked = [];
    const flagsNoExact = [];
    for (const id of relevant) {
      const meta = scenarioById.get(id);
      const idLocs = locs.get(id) || [];
      if (!meta || idLocs.length === 0) continue;  // 静态层已记
      const { tokens, raw } = extractExpectedTokens(meta.sc);
      const filesForId = [...new Set(idLocs.map(l => l.file))];

      // mock 采证（窗口内 MOCK_PATTERNS 命中）
      let mocks = [];
      let snippet = null;
      for (const loc of idLocs.slice(0, 10)) {
        const ev = blockEvidence(loc);
        if (!ev) continue;
        if (ev.mocks.length) mocks = mocks.concat(ev.mocks);
        if (!snippet || /(^|[\\/])(tests?|spec|__tests__)([\\/]|$)|\.(test|spec)\./i.test(loc.file)) snippet = ev.snippet;
      }
      mocks = [...new Set(mocks)];
      if (mocks.length) flagsMocked.push(id);

      // 期望 token 是否在相关文件中以字面量出现
      let hitInfo = 'tokens=0';
      if (tokens.length) {
        const fileTexts = filesForId.map(rel => { try { return fs.readFileSync(path.join(cwd, rel), 'utf8'); } catch (_) { return ''; } }).join('\n');
        const hit = tokens.filter(tk => fileTexts.includes(tk));
        const miss = tokens.filter(tk => !fileTexts.includes(tk));
        hitInfo = `tokens=${tokens.length} hit=${hit.length}${miss.length ? ' miss=' + miss.map(x => JSON.stringify(x)).join(',') : ''}`;
        if (hit.length === 0) flagsNoExact.push(id);
      } else {
        hitInfo = 'tokens=0（未能自动抽取——需 LLM 复核）';
      }
      out.push(`  - ${id}: ${hitInfo} mocks=${mocks.length}${mocks.length ? '（首 1：' + mocks[0] + '）' : ''}`);
      if (raw.length) out.push(`      then/examples 原文：${raw.join(' | ')}`);
    }

    // ---- 代码气味（复用 _code-smells.cjs） ----
    out.push('');
    out.push('[代码气味整合]');
    const smellRes = callSharedScript('_code-smells.cjs', cwd, 30000);
    let smellHighFlag = null;
    if (!smellRes.ok) {
      out.push('  ⚠ 调用 _code-smells.cjs 失败：' + smellRes.error);
    } else {
      const sm = smellRes.json;
      if (sm.error) {
        out.push('  ⚠ ' + sm.error);
      } else {
        out.push(`  language=${sm.language} scanned=${sm.scanned_files} high=${sm.summary.high} medium=${sm.summary.medium} low=${sm.summary.low}`);
        for (const f of (sm.findings || []).filter((x) => x.severity === 'high').slice(0, 8)) {
          out.push(`  - [${f.severity}] ${f.file}:${f.line} ${f.id} — ${(f.snippet || '').slice(0, 100)}`);
        }
        if (sm.summary.high >= 3) smellHighFlag = `high 异味 ${sm.summary.high} 处`;
      }
    }

    // ---- 边界契约违约信号（测试 tail 含 NPE/5xx/unhandled） ----
    const boundaryFlag = (t.ran && !t.ok && hasBoundaryContractSignal(t.tail)) ? '测试输出含边界契约违约信号（NPE/5xx/unhandled）' : null;

    // ---- 失败汇总 + FAILKIND 分类 ----
    out.push('');
    const problems = [];
    if (flagsMissing.length) problems.push(`漏覆盖 BDD id：${flagsMissing.join(',')}`);
    if (flagsShallow.length) problems.push(`断言过浅：${flagsShallow.join(' / ')}`);
    // mock 可观察面：脚本仅看 mock 标记是否在标记附近窗口，常误判真实 stub 为反模式 →
    // 本蓝图作 advisory（报告里点出，由 review LLM 检查项 #4 判定是否真打回），不参与机检 fail。
    if (flagsMocked.length) out.push(`[mock advisory] 标记附近含 mock 的 BDD id：${flagsMocked.join(',')}（由 review 人工核是否顶替可观察面）`);
    if (flagsNoExact.length) problems.push(`then 精确值无任一命中 id：${flagsNoExact.join(',')}`);
    if (t.ran && !t.ok) problems.push('测试未全绿');
    if (!t.ran) problems.push('测试未运行（' + t.info + '）');
    if (boundaryFlag) problems.push('[BOUNDARY-CONTRACT] ' + boundaryFlag);
    if (smellHighFlag) problems.push('[CODE-SMELL] ' + smellHighFlag + '（advisory，不必然 fail）');

    const advisoryPass = problems.length === 0
      // 异味独占不当 fail：若仅 smellHigh advisory 也算 advisoryPass
      || (problems.length === 1 && /^\[CODE-SMELL\]/.test(problems[0]));

    // 测试环境失败：测试根本没跑起来 / 非零退出且命中 ENV 签名
    const testEnvFail = (!t.ran) || (t.ran && !t.ok && isEnvFailure(t.tail));
    // 内容缺口（一律归 impl）。本蓝图无 design：不含状态机/NFR；mock 为 advisory 不计入。
    const contentImpl = !!(flagsMissing.length || flagsShallow.length || flagsNoExact.length
      || (t.ran && !t.ok && !isEnvFailure(t.tail))
      || boundaryFlag);

    let cls = '';
    if (contentImpl) cls = '[CONTENT-GAP][FAILKIND: impl] ';
    else if (testEnvFail) cls = '[ENV-FIXABLE][FAILKIND: env] ';

    out.push('[机检初判] ' + (advisoryPass ? 'pass（无机检红旗；review 已主观放过 + gate_review 客观放行 → 出 loop）'
      : cls + 'fail：' + problems.slice(0, MAX_REPORT).join('；')));

    process.stdout.write(out.join('\n') + '\n');

    if (advisoryPass) {
      emit(true, `task#${tid} 的 ${relevant.length} 个相关 BDD 场景：静态层（覆盖+断言深度）+ 动态层（测试+期望值）+ 边界契约 全部通过。${unknownNote}`);
    } else {
      const envFixable = !contentImpl && testEnvFail;
      emit(false, cls + 'gate_review 机检未通过：' + problems.join('；') + unknownNote, envFixable);
    }
  } catch (e) {
    emit(false, 'gate_review 内部错误（请检查 state.json / bdd.json 可读性、测试命令）：' + (e && e.message ? e.message : String(e)), true);
  }
})();

module.exports = {
  isEnvFailure, hasBoundaryContractSignal, assertionDepth,
  extractExpectedTokens, scanWorkspaceLocations, pickCurrentTask,
};
