// _lang-normalize.cjs —— Init 门禁的语言名归一化 + 未知降级
//
// gate_init.cjs 用本模块替代原硬白名单：未知语言不再 fail，
// 而是降级为 'todo'（下游 _code-smells / _test-runner 已天然容忍）。
//
// API:
//   normalizeLanguage(raw) → { normalized, original, isKnown, isCoerced }
//     - isKnown=true 且 isCoerced=false: 原值已是标准值（含 case 归一） → 不写回
//     - isKnown=true 且 isCoerced=true : 别名命中标准值（如 cxx→cpp） → 写回标准名
//     - isKnown=false                  : 未知语言 → normalized='todo'，调用方写回并发 [ENV-FIXABLE] advisory
//
//   isKnownLanguage(lang) → bool（已归一化后判，主要给单测）
//
// 设计原则：
//   - 与下游 _code-smells.cjs 的 LANG_ALIASES 同源借鉴但不跨脚本依赖，保持 shared-scripts 自治
//   - 标准值集合（KNOWN_LANGUAGES）与本蓝图的 gate_init.cjs VALID_LANGUAGES 完全对齐
//   - 大小写不敏感；trim 后 toLowerCase 再比对

// lite 标准值集合（与 gate_init.cjs L25 一致）
const KNOWN_LANGUAGES = new Set([
  'python', 'java', 'javascript', 'typescript',
  'c', 'cpp', 'c++',
  'todo', // sentinel: 未定 / 兜底
]);

// 别名 → 标准值（仅列「映射目标在 KNOWN 内」才生效；
// 映射目标不在 KNOWN 内的项目（如 lite/flow 的 golang→go），将由调用方走未知兜底）
const LANG_ALIASES = {
  cxx: 'cpp',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  golang: 'go',     // lite/flow: go 不在 KNOWN → 实际走 todo 兜底
  kt: 'java',       // kotlin 走 JVM 同根（与 _code-smells.cjs 一致）
  kotlin: 'java',
};

function normalizeLanguage(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { normalized: 'todo', original: '', isKnown: false, isCoerced: true };
  }
  const original = String(raw).trim();
  const lower = original.toLowerCase();

  // 已是标准值（含 case 归一，但 case 差异不算 coerce，避免无谓 churn）
  if (KNOWN_LANGUAGES.has(lower)) {
    return { normalized: lower, original, isKnown: true, isCoerced: false };
  }

  // 别名命中，且映射目标也在标准集
  const mapped = LANG_ALIASES[lower];
  if (mapped && KNOWN_LANGUAGES.has(mapped)) {
    return { normalized: mapped, original, isKnown: true, isCoerced: true };
  }

  // 未知（含别名映射目标不在 KNOWN 的情形，例如 lite 的 golang→go 但 go 不在 KNOWN）
  return { normalized: 'todo', original, isKnown: false, isCoerced: true };
}

function isKnownLanguage(lang) {
  if (lang == null) return false;
  return KNOWN_LANGUAGES.has(String(lang).trim().toLowerCase());
}

module.exports = { normalizeLanguage, isKnownLanguage, KNOWN_LANGUAGES, LANG_ALIASES };
