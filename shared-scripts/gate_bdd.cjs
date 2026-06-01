#!/usr/bin/env node
// gate_bdd.cjs —— BDD 规范性硬门
// 校验 bdd 节点产出的 .harness/memory/plans/bdd.json 的结构/字段/取值规范性。
//
// v10: 由 review skill 的 LLM 直接 `node` 运行（无框架 stdin）。
// cwd 即 LLM 运行目录（= 蓝图工作区）。
//
// stdout: 最后一行 JSON {pass: bool, message: string}
// exit:   0 always（LLM 读 stdout 决定 ok/failed/blocked 三态）
//
// schema（按 feature 分组 + examples 数组）：
//   { features: [ { feature, risk, scenarios: [
//       { id:"BDD-xxx", scenario, given:[], when:[], then:[], derivation:[], examples:[], cross_domain? } ] } ],
//     clarifications: [ "<能力/场景>: ..." ] }
//   （本蓝图无 SRS / FR-id：feature 无 fr 字段，derivation 溯源到 original-requirements.md 行号或 scan file:line）
//
// 硬校验（违反即 fail → 打回 bdd 重出规范 JSON）：
//   - 合法 JSON 且顶层为对象
//   - features 非空数组；clarifications 为字符串数组（存在，可空）
//   - 每 feature: feature 非空字符串 + risk(critical|normal|trivial) + scenarios 非空数组（无 fr 字段）
//   - 每 scenario: id 非空且匹配 ^BDD-\d+$、全局唯一（下游测试追溯锚点）;
//                  scenario 非空; given/when/then/examples 均为非空字符串数组;
//                  derivation 非空字符串数组（推导链：引用规则→从 given 施加 when→断言 == then；脚本只验存在/非空，对错由 gate_bdd LLM 复核）;
//                  cross_domain 若存在须为非空字符串
//   - 【P0-B 完备性】每 feature 至少 1 条异常/边界/错误场景（kind ∈ negative|boundary|error，
//     或场景文本含异常语义）——堵「只写 happy path」的范围漂移；纯查询/只读类可用
//     feature.no_negative_rationale（非空字符串）豁免。
//   - scenario.kind 可选（happy|negative|boundary|error）；缺省视为 happy，标错仅告警（A 档不挑格式）。
//   - 【原文引文真伪】derivation 凡引用 original-requirements.md 且带显式引文（「」/""/''）的，
//     引文须为 intent/original-requirements.md 的逐字真子串（恢复 lite gate_srs 溯源校验，不依赖 SRS）。
// 软（仅告警不 fail）：零 cross_domain 场景；引用了原文引文但 original-requirements.md 缺失（无法机检真伪）

const fs = require('fs');
const path = require('path');

const BDD_ID_PATTERN = /^BDD-\d+$/;
// derivation 溯源锚：原文行号 / 存量约定 file:line /（兼容）规则编号。仅用于软告警，非硬规则。
const DERIV_ANCHOR = /(original-requirements\.md|\bL\d+\b|[\w./\\-]+:\d+|[A-Z]{2,4}-\d+)/;
const MAX_REPORT = 25; // 报告的错误条数上限，避免 message 爆长

const VALID_KINDS = new Set(['happy', 'negative', 'boundary', 'error']);
const ABNORMAL_KINDS = new Set(['negative', 'boundary', 'error']);
const VALID_RISK = new Set(['critical', 'normal', 'trivial']);
// 按 risk 分层的异常场景下限（critical 不可豁免；normal/trivial 可用 no_negative_rationale 豁免）
const ABNORMAL_MIN_BY_RISK = { critical: 2, normal: 1, trivial: 0 };
// 「异常语义」文本线索：仅在 scenario 未标 kind 时用来**避免误杀**已有异常覆盖，绝不作硬规则
// （只会让门更宽容、永不凭它判 fail）。中英双语小集，够覆盖常见措辞。
const ABNORMAL_TEXT = /(invalid|illegal|error|reject|refus|fail|out[\s_-]?of[\s_-]?range|overflow|boundary|edge[\s_-]?case|越界|超出|非法|拒绝|失败|错误|异常|无效|边界)/i;

function emit(pass, message) {
  process.stdout.write(JSON.stringify({ pass: !!pass, message: String(message || '') }) + '\n');
  process.exit(0);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function isNonEmptyStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
}

// ---- 原文引文真伪机检（恢复 lite gate_srs 的逐字溯源校验，不依赖 SRS）-----------------
// 本蓝图无 SRS 反向覆盖门；为防 derivation 抄错/造假原文引文，这里机检：凡 derivation 条目
// 引用 original-requirements.md 且带显式引文（「」/""/''）的，引文须为原文的逐字真子串。
// 纯行号引用（无引文）/ 引 scan file:line / 无 original-requirements.md 且无人引用 → 不检（宽松）。
const ORIG_REF_RE = /original-requirements\.md/i;
const QUOTE_RE = /「([^」]*)」|"([^"]*)"|'([^']*)'/g;
function normWs(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}
function readOriginalRequirements(cwd) {
  const p = path.join(cwd, '.harness', 'memory', 'intent', 'original-requirements.md');
  if (!fs.existsSync(p)) return { missing: true };
  try { return { content: fs.readFileSync(p, 'utf8') }; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
function checkDerivationFidelity(doc, cwd) {
  const citing = []; // {scId, quote}
  for (const feat of (Array.isArray(doc.features) ? doc.features : [])) {
    if (!feat || typeof feat !== 'object' || !Array.isArray(feat.scenarios)) continue;
    for (const sc of feat.scenarios) {
      if (!sc || typeof sc !== 'object' || !Array.isArray(sc.derivation)) continue;
      const scId = isNonEmptyString(sc.id) ? sc.id.trim() : '?';
      for (const d of sc.derivation) {
        const s = String(d == null ? '' : d);
        if (!ORIG_REF_RE.test(s)) continue;
        QUOTE_RE.lastIndex = 0;
        let m;
        while ((m = QUOTE_RE.exec(s)) !== null) {
          const q = m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]);
          if (isNonEmptyString(q)) citing.push({ scId, quote: q });
        }
      }
    }
  }
  if (citing.length === 0) return { errors: [], warnings: [] }; // 无显式原文引文 → 不检
  const auth = readOriginalRequirements(cwd);
  if (auth.missing) {
    return { errors: [], warnings: ['derivation 引用了 original-requirements.md 引文，但该文件不存在（bdd Step 1 应逐字落盘原文）——引文真伪无法机检，请确认已写 intent/original-requirements.md'] };
  }
  if (auth.error) return { errors: [], warnings: ['original-requirements.md 读取失败：' + auth.error] };
  const authNorm = normWs(auth.content);
  const errors = [];
  for (const { scId, quote } of citing) {
    for (const frag of String(quote).split(/…+|\.{3,}/)) {
      const q = normWs(frag);
      if (q.length >= 4 && !authNorm.includes(q)) {
        errors.push(scId + ' 的 derivation 引文未命中 original-requirements.md 原文「' + q.slice(0, 30) + (q.length > 30 ? '…' : '') + '」（疑造假/抄错；引文须为原文逐字真子串）');
      }
    }
  }
  return { errors, warnings: [] };
}

(async () => {
  const cwd = process.cwd();
  const bddPath = path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json');
  const rel = path.relative(cwd, bddPath);

  if (!fs.existsSync(bddPath)) {
    emit(false, 'BDD 用例未生成: ' + rel);
  }

  let raw;
  try { raw = fs.readFileSync(bddPath, 'utf8'); }
  catch (e) { emit(false, '读取失败: ' + e.message + '（' + rel + '）'); }

  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { emit(false, 'bdd.json 不是合法 JSON: ' + e.message + '（请去掉注释/尾逗号，' + rel + '）'); }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    emit(false, 'bdd.json 顶层必须是对象 {features, clarifications}');
  }

  const errors = [];
  const warnings = [];

  // ---- 顶层容器 ----
  if (!Array.isArray(doc.features) || doc.features.length === 0) {
    errors.push('顶层 features 必须是非空数组');
  }
  if (!Array.isArray(doc.clarifications)) {
    errors.push('顶层 clarifications 必须是数组（字符串数组，无缺口则 []）');
  } else {
    for (let i = 0; i < doc.clarifications.length; i++) {
      if (!isNonEmptyString(doc.clarifications[i])) errors.push('clarifications[' + i + ']: 必须是非空字符串');
    }
  }

  // 顶层结构若已坏，直接报，不再深入（避免误导性级联报错）
  if (errors.length) {
    emit(false, 'BDD 规范性校验未通过：' + errors.join('；') + '\n（路径：' + rel + '）');
  }

  // ---- 逐 feature / scenario ----
  let scenarioCount = 0;
  let crossDomainCount = 0;
  const scenarioIds = new Set(); // 跨 feature 全局查重

  for (let fi = 0; fi < doc.features.length; fi++) {
    const feat = doc.features[fi];
    const fp = 'features[' + fi + ']';
    if (feat === null || typeof feat !== 'object' || Array.isArray(feat)) {
      errors.push(fp + ': 必须是对象'); continue;
    }
    if (!isNonEmptyString(feat.feature)) errors.push(fp + ': 缺非空 feature（能力名）');
    const fname = isNonEmptyString(feat.feature) ? feat.feature : '?';

    // 本蓝图无 SRS / FR-id：feature 不要求 fr 字段（溯源靠各 scenario.derivation 引 original-requirements.md 行号）。
    // 残留 fr 字段不报错（向后兼容），但不校验。

    // risk：必填 + 取值合法（继承自所属 FR[] 最高等级；判定依据 shared-reference/risk-tagging-guide.md）
    let featRisk = null;
    if (!isNonEmptyString(feat.risk)) {
      errors.push(fp + ' (' + fname + '): 缺 risk 字段（critical | normal | trivial）；下游门按 risk 分层判定场景密度');
    } else {
      const r = feat.risk.trim().toLowerCase();
      if (!VALID_RISK.has(r)) {
        errors.push(fp + ' (' + fname + '): risk="' + feat.risk + '" 非法，应为 critical | normal | trivial');
      } else {
        featRisk = r;
      }
    }

    if (!Array.isArray(feat.scenarios) || feat.scenarios.length === 0) {
      errors.push(fp + ' (' + fname + '): scenarios 必须是非空数组'); continue;
    }

    let featAbnormalCount = 0; // 该 feature 含的异常/边界/错误场景数（按 risk 分层校验下限）

    for (let si = 0; si < feat.scenarios.length; si++) {
      const sc = feat.scenarios[si];
      const sp = fp + '.scenarios[' + si + ']';
      if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) {
        errors.push(sp + ': 必须是对象'); continue;
      }
      scenarioCount++;
      const sname = isNonEmptyString(sc.scenario) ? sc.scenario : '#' + si;

      // id：非空 + 模式 + 全局唯一（下游 impl 打标 / gate_review 机检的追溯锚点）
      if (!isNonEmptyString(sc.id) || !BDD_ID_PATTERN.test(sc.id.trim())) {
        errors.push(sp + ' (' + sname + '): 缺合法 id（须为非空字符串且匹配 ^BDD-\\d+$，如 BDD-001）');
      } else {
        const sid = sc.id.trim();
        if (scenarioIds.has(sid)) errors.push(sp + ' (' + sname + '): id "' + sid + '" 重复（须全局唯一）');
        scenarioIds.add(sid);
      }

      if (!isNonEmptyString(sc.scenario)) errors.push(sp + ': 缺非空 scenario（场景名）');

      // given / when / then / examples：均非空字符串数组
      for (const key of ['given', 'when', 'then', 'examples']) {
        if (!isNonEmptyStringArray(sc[key])) {
          errors.push(sp + ' (' + sname + '): ' + key + ' 必须是非空字符串数组');
        }
      }

      // derivation（本版新增硬字段）：非空字符串数组——每个场景须落「引用规则→从 given 逐步施加 when→推出 then」的推导链。
      // 脚本只验「存在且非空」，不验推导对错（对错由 gate_bdd 的 LLM 复核照 derivation 核对）。
      if (!isNonEmptyStringArray(sc.derivation)) {
        errors.push(sp + ' (' + sname + '): 缺 derivation（须为非空字符串数组：引用 FR/IFR/CON-xxx 或存量约定+规则取值，从 given 逐步施加 when 推出结果并断言 == then）');
      } else if (!sc.derivation.some(d => DERIV_ANCHOR.test(d))) {
        warnings.push(sp + ' (' + sname + '): derivation 未引用任何溯源锚（original-requirements.md 行号 / 存量约定 file:line）——确认其推导确有明文依据');
      }

      // cross_domain 可选；存在则须非空字符串
      if ('cross_domain' in sc) {
        if (!isNonEmptyString(sc.cross_domain)) {
          errors.push(sp + ' (' + sname + '): cross_domain 若存在须为非空字符串（"模块名 @ file:line"）');
        } else {
          crossDomainCount++;
        }
      }

      // kind（可选）：标注了就须是四类之一；标错只告警、不阻塞（A 档不挑格式）
      if ('kind' in sc && !(isNonEmptyString(sc.kind) && VALID_KINDS.has(sc.kind.trim().toLowerCase()))) {
        warnings.push(sp + ' (' + sname + '): kind="' + sc.kind + '" 非法，应为 happy|negative|boundary|error');
      }
      // scenario.risk 可选；标注了就须是三类之一；缺省继承 feature.risk
      if ('risk' in sc && !(isNonEmptyString(sc.risk) && VALID_RISK.has(sc.risk.trim().toLowerCase()))) {
        warnings.push(sp + ' (' + sname + '): risk="' + sc.risk + '" 非法，应为 critical|normal|trivial');
      }
      // 累计该 feature 异常/边界/错误覆盖数：优先看 kind，未标则从场景名/then/examples 文本宽松推断
      {
        const k = isNonEmptyString(sc.kind) ? sc.kind.trim().toLowerCase() : '';
        const txt = [sc.scenario]
          .concat(Array.isArray(sc.then) ? sc.then : [], Array.isArray(sc.examples) ? sc.examples : [])
          .join(' ');
        if (k ? ABNORMAL_KINDS.has(k) : ABNORMAL_TEXT.test(txt)) featAbnormalCount++;
      }

      if (errors.length > MAX_REPORT) break;
    }

    // 【按 risk 分层】完备性硬门：critical 必须 ≥2 异常/边界/错误场景且不可豁免；
    // normal 必须 ≥1 异常类（可 no_negative_rationale 豁免，纯查询/只读）；trivial 无强制。
    // 缺 risk 字段时按 normal 兜底（已在上方错误中标出，不再级联）。
    if (Array.isArray(feat.scenarios) && feat.scenarios.length > 0) {
      const effRisk = featRisk || 'normal';
      const minAbnormal = ABNORMAL_MIN_BY_RISK[effRisk];
      const exempted = isNonEmptyString(feat.no_negative_rationale);
      if (effRisk === 'critical' && featAbnormalCount < minAbnormal) {
        // critical 不可豁免
        errors.push(fp + ' (' + fname + ') [risk=critical]: 异常/边界/错误场景仅 '
          + featAbnormalCount + ' 条，critical 业务必须 ≥' + minAbnormal
          + ' 条（critical 无 no_negative_rationale 豁免；若确无异常路径，回 req 降级为 normal 或重新识别 negative AC）');
      } else if (effRisk === 'normal' && featAbnormalCount < minAbnormal && !exempted) {
        errors.push(fp + ' (' + fname + ') [risk=normal]: 缺至少 ' + minAbnormal
          + ' 条异常/边界/错误场景（标 kind=negative|boundary|error，或加 no_negative_rationale 说明为何无需，如纯查询/只读）');
      }
      // trivial 不强制（≥1 happy 即可，由 scenarios 非空兜底）
    }

    if (errors.length > MAX_REPORT) break;
  }

  // ---- 软告警 ----
  if (crossDomainCount === 0) {
    warnings.push('未产出带 cross_domain 的跨域组合场景（若本需求确无存量交互可忽略；否则应补）');
  }

  // ---- 原文引文真伪机检（造假/悬空引用 → 硬 fail；缺原文文件 → 软告警）----
  const fid = checkDerivationFidelity(doc, cwd);
  for (const w of fid.warnings) warnings.push(w);
  for (const e of fid.errors) errors.push(e);

  if (errors.length) {
    const shown = errors.slice(0, MAX_REPORT);
    const more = errors.length > MAX_REPORT ? `\n…另有 ${errors.length - MAX_REPORT} 条未列出` : '';
    const warn = warnings.length ? '\n[告警] ' + warnings.join('；') : '';
    emit(false, 'BDD 规范性校验未通过（' + errors.length + ' 项）：\n- ' + shown.join('\n- ') + more + warn + '\n（路径：' + rel + '）');
  }

  const warn = warnings.length ? '；[告警] ' + warnings.join('；') : '';
  emit(true, `BDD 规范性校验通过：${doc.features.length} 个 feature / ${scenarioCount} 个 scenario / ${crossDomainCount} 个跨域组合 / ${doc.clarifications.length} 项待澄清${warn}`);
})();
