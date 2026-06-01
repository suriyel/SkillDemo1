#!/usr/bin/env node
// _code-smells.cjs —— 多语言代码异味扫描（按 shared-reference/code-smell-checklist.md 驱动）
//
// 设计：完全 reference-driven —— 本脚本不硬编任何语言或正则，
// 只读 `shared-reference/code-smell-checklist.md` 的 YAML-in-markdown 节，按 project-context.md
// 的 `language` 字段选对应节，跑节里的 patterns[] 正则。
//
// 用途：review skill 采证（advisory，不阻塞）；gate_review 代码气味整合段读其输出。
//
// stdout: 多行扫描进度 + 末行 JSON {language, scanned_files, findings:[{file,line,id,severity,snippet}], summary:{high,medium,low}}
// exit:   0 always（advisory）；扫不到 checklist 或 language 不识别 → 仍 emit JSON 但 findings 为空

const fs = require('fs');
const path = require('path');

// 与 gate_review 对齐
const IGNORE_DIRS = new Set([
  '.harness', 'node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', 'coverage', '.next', '.nuxt',
  '.idea', '.vscode', '.gradle', 'bin', 'obj', 'vendor', '.tox', '.mypy_cache',
]);
const MAX_FILE = 1024 * 1024; // 1MB
const FILE_BUDGET = 20000;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(0);
}

// 语言别名归一（与 checklist 节名对齐）
const LANG_ALIASES = {
  'c++': 'cpp',
  'cxx': 'cpp',
  'js': 'javascript',
  'ts': 'javascript',          // typescript 与 javascript 共用 §2.3 节
  'typescript': 'javascript',
  'py': 'python',
  'cs': 'csharp',
  'dotnet': 'csharp',
  'rs': 'rust',
  'kt': 'java',                // kotlin 共用 java 节（patterns 大致兼容）
  'kotlin': 'java',
};
function normalizeLanguage(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  return LANG_ALIASES[k] || k;
}

function readProjectLanguage(cwd) {
  // 从 project-context.md 的 `language: <value>` 行读
  const ctxPath = path.join(cwd, '.harness', 'memory', 'plans', 'project-context.md');
  if (!fs.existsSync(ctxPath)) return null;
  let txt;
  try { txt = fs.readFileSync(ctxPath, 'utf8'); } catch (_) { return null; }
  const m = txt.match(/^\s*-\s*language:\s*(\S+)/m);
  return m ? normalizeLanguage(m[1]) : null;
}

// 解析 checklist.md 的 YAML-in-markdown：找 ```yaml 块 language: <X> 的 patterns[]
function loadChecklist(checklistPath, language) {
  if (!fs.existsSync(checklistPath)) return null;
  let txt;
  try { txt = fs.readFileSync(checklistPath, 'utf8'); } catch (_) { return null; }
  // 提取所有 ```yaml ... ``` 块
  const re = /```yaml\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const yaml = m[1];
    // 极简 YAML 解析（够本表用，不引外部依赖）：取 language 行，匹配 language 则提 patterns
    const langMatch = yaml.match(/^language:\s*(\S+)/m);
    if (!langMatch || langMatch[1].toLowerCase() !== language) continue;
    const extMatch = yaml.match(/^extensions:\s*\[([^\]]+)\]/m);
    const exts = extMatch
      ? extMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      : [];
    // patterns 块：抓 `- id: ... \n description: ... \n regex: ... \n severity: ...` 重复块
    const patterns = [];
    const pre = /-\s*id:\s*(\S+)\s*\n\s*description:\s*([^\n]+)\n\s*regex:\s*(?:'([^']+)'|"([^"]+)")\s*\n\s*severity:\s*(\S+)/g;
    let p;
    while ((p = pre.exec(yaml)) !== null) {
      patterns.push({
        id: p[1].trim(),
        description: p[2].trim(),
        regex: p[3] !== undefined ? p[3] : p[4],
        severity: p[5].trim().toLowerCase(),
      });
    }
    return { language, extensions: exts, patterns };
  }
  return null;
}

function walk(dir, exts, budget, onFile) {
  if (budget.files <= 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (budget.files <= 0) return;
    if (e.isSymbolicLink && e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, exts, budget, onFile);
    } else if (e.isFile()) {
      if (exts.length && !exts.includes(path.extname(e.name).toLowerCase())) continue;
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (st.size > MAX_FILE) continue;
      budget.files--;
      onFile(full);
    }
  }
}

(async () => {
  const cwd = process.cwd();
  process.stderr.write('[_code-smells] cwd=' + cwd + '\n');

  // 找 checklist：优先 cwd/.harness/.../shared-reference，否则用环境变量 BP_SHARE_REFERENCE，否则脚本同级 ../shared-reference
  let checklistPath = null;
  const candidates = [
    process.env.BP_SHARE_REFERENCE && path.join(process.env.BP_SHARE_REFERENCE, 'code-smell-checklist.md'),
    path.join(__dirname, '..', 'shared-reference', 'code-smell-checklist.md'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) { checklistPath = c; break; }
  }
  if (!checklistPath) {
    emit({ language: null, scanned_files: 0, findings: [], summary: { high: 0, medium: 0, low: 0 }, error: 'code-smell-checklist.md not found in any candidate path' });
  }

  const language = readProjectLanguage(cwd);
  if (!language) {
    emit({ language: null, scanned_files: 0, findings: [], summary: { high: 0, medium: 0, low: 0 }, error: 'project-context.md not readable or language field missing' });
  }
  process.stderr.write('[_code-smells] language=' + language + ' checklist=' + checklistPath + '\n');

  const spec = loadChecklist(checklistPath, language);
  if (!spec || !spec.patterns.length) {
    emit({ language, scanned_files: 0, findings: [], summary: { high: 0, medium: 0, low: 0 }, error: `no patterns for language=${language} in checklist (add a section)` });
  }
  process.stderr.write('[_code-smells] patterns=' + spec.patterns.length + ' exts=' + spec.extensions.join(',') + '\n');

  // 编译正则
  const compiled = spec.patterns.map((p) => {
    try { return { ...p, re: new RegExp(p.regex, 'gm') }; }
    catch (e) { process.stderr.write(`[_code-smells] bad regex for ${p.id}: ${e.message}\n`); return null; }
  }).filter(Boolean);

  const findings = [];
  let scanned = 0;
  const budget = { files: FILE_BUDGET };
  walk(cwd, spec.extensions, budget, (full) => {
    let txt;
    try { txt = fs.readFileSync(full, 'utf8'); } catch (_) { return; }
    scanned++;
    const rel = path.relative(cwd, full);
    const lines = txt.split(/\r?\n/);
    for (const p of compiled) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(txt)) !== null) {
        // 行号：matched index → 行号
        const before = txt.slice(0, m.index);
        const line = before.split(/\r?\n/).length;
        const snippet = (lines[line - 1] || '').trim().slice(0, 200);
        findings.push({ file: rel.replace(/\\/g, '/'), line, id: p.id, severity: p.severity, description: p.description, snippet });
        // 同行单 regex 多 match 防爆：每条规则每文件最多 50 个 finding
        if (findings.filter((f) => f.file === rel && f.id === p.id).length >= 50) break;
      }
    }
  });

  const summary = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity === 'high') summary.high++;
    else if (f.severity === 'medium') summary.medium++;
    else summary.low++;
  }

  emit({ language, scanned_files: scanned, findings, summary });
})();
