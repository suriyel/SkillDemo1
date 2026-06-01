'use strict';
// _test-runner.cjs —— 蓝图原生 · 多语言「真跑测试」共享模块
//
// 由 gate_review.cjs / gate_st.cjs / review skill require。解决 RC2：原 detectAndRunTests
// 只认 npm/pytest/cargo 且只看 cwd 根 → 对 Java/Maven（且 pom 常在子目录）
// 整条管线从不真跑测试，质量证书全是 LLM 自报。本模块：
//   1) 有界递归找出工作区下**所有** build 根（处理子目录嵌套 + 多语言 polyglot）；
//   2) 每根优先用 init 产出的 tool-commands-guide.md 里的实配测试命令，否则按栈默认；
//   3) 真跑、按 exit code 分三态（ran/ok/blocked），多根聚合。
//
// 语言无关：检测靠 marker 文件，运行靠 spawnSync，不解析任何源码 AST。
// 穿刺实证（puncture-multilang-testrunner）：maven(根/子目录)/node/go/python/polyglot 均通过。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SH = process.platform === 'win32';

// 与 gate_review 对齐的扫描排除目录。
const IGNORE_DIRS = new Set([
  '.harness', 'node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', 'coverage', '.next', '.nuxt',
  '.idea', '.vscode', '.gradle', 'bin', 'obj', 'vendor', '.tox', '.mypy_cache',
]);
const MAX_DEPTH = 5;        // LLM 产物通常嵌 1-2 层（adas-project/、adas-simulator/）
const TAIL_MAX = 1200;      // 单根输出尾部上限

// 栈 → 默认测试命令 + 超时（ms）。Maven/Gradle/.NET 给足首跑拉依赖 / 编译时间。
const STACK = {
  maven:  { bin: 'mvn',    args: ['-q', '-B', '-ntp', 'test'],  timeout: 600000 },
  gradle: { bin: 'gradle', args: ['test', '--console=plain'],   timeout: 600000 },
  go:     { bin: 'go',     args: ['test', './...'],             timeout: 300000 },
  cargo:  { bin: 'cargo',  args: ['test', '--quiet'],           timeout: 300000 },
  python: { bin: 'python', args: ['-m', 'pytest', '-q'],        timeout: 300000 },
  dotnet: { bin: 'dotnet', args: ['test', '--nologo'],          timeout: 600000 },
  node:   { bin: 'npm',    args: ['test', '--silent'],          timeout: 300000 },
};

function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(-n) + '' : s; }

// 判定某目录是哪种栈的 build 根（仅看其直接 marker 文件）。
function stackOf(dir) {
  const has = (f) => { try { return fs.existsSync(path.join(dir, f)); } catch (_) { return false; } };
  if (has('pom.xml')) return 'maven';
  if (has('build.gradle') || has('build.gradle.kts')) return 'gradle';
  if (has('go.mod')) return 'go';
  if (has('Cargo.toml')) return 'cargo';
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg') || has('tox.ini')) return 'python';
  // .NET：扫一层找 *.sln / *.csproj
  try {
    if (fs.readdirSync(dir).some((f) => /\.(sln|csproj)$/i.test(f))) return 'dotnet';
  } catch (_) { /* ignore */ }
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test && !/no test specified/i.test(pkg.scripts.test)) return 'node';
    } catch (_) { /* ignore */ }
    return null; // package.json 无可用 test 脚本
  }
  return null;
}

// 有界递归收集 build 根。规则：同一栈只取最浅根（祖先覆盖子模块，避免多模块 maven
// 重复跑），但**继续向下找其它栈的根**（覆盖 polyglot：maven 根下的 node 子根）。
function findBuildRoots(root) {
  const roots = [];
  (function walk(dir, depth, coveredStacks) {
    if (depth > MAX_DEPTH) return;
    const s = stackOf(dir);
    let covered = coveredStacks;
    if (s && !coveredStacks.has(s)) {
      roots.push({ dir, stack: s });
      covered = new Set(coveredStacks);
      covered.add(s);
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.isSymbolicLink && e.isSymbolicLink()) continue;
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1, covered);
    }
  })(root, 0, new Set());
  return roots;
}

// 尽力从 tool-commands-guide.md 抽取某栈的实配测试命令（处理 -P/profile/surefire 自定义）。
// 仅当能干净抽到「以该栈 bin 开头且含 test」的命令行时才用，否则回退默认。返回 null 表示无。
function configuredCmd(cwd, stack) {
  const guide = path.join(cwd, '.harness', 'memory', 'notes', 'tool-commands-guide.md');
  let txt;
  try { txt = fs.readFileSync(guide, 'utf8'); } catch (_) { return null; }
  const bin = STACK[stack] && STACK[stack].bin;
  if (!bin) return null;
  // 候选：fenced/inline 中以 bin 开头、含独立单词 test 的行（mvn test / npm test / go test ./... / python -m pytest）。
  const binRe = stack === 'python' ? /(python\d?\s+-m\s+pytest|pytest)\b[^\n`]*/i
    : new RegExp('\\b' + bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[^\\n`]*', 'i');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*\-]+/, '').replace(/`/g, '').trim();
    if (!binRe.test(line)) continue;
    if (!/\btest\b|pytest/i.test(line)) continue;
    // 排除明显是说明性而非命令的行（含中文冒号叙述/箭头）
    if (/[：]|->|—/.test(line)) continue;
    return line;
  }
  return null;
}

// 跑单个根。configured 优先（整行经 shell 跑），否则默认 bin+args。
function runOne(rootInfo) {
  const { dir, stack } = rootInfo;
  const def = STACK[stack];
  const timeout = def ? def.timeout : 300000;
  const cfg = configuredCmd(dir, stack);
  // gradle 子节点用 wrapper（若在）。
  let cmdLabel, r;
  const t0 = Date.now();
  if (cfg) {
    cmdLabel = cfg + '  (来自 tool-commands-guide.md)';
    r = spawnSync(cfg, [], { cwd: dir, encoding: 'utf8', shell: true, timeout });
  } else if (stack === 'gradle') {
    const wrapper = SH ? 'gradlew.bat' : './gradlew';
    const useWrapper = fs.existsSync(path.join(dir, SH ? 'gradlew.bat' : 'gradlew'));
    const bin = useWrapper ? wrapper : 'gradle';
    cmdLabel = bin + ' test --console=plain';
    r = spawnSync(bin, ['test', '--console=plain'], { cwd: dir, encoding: 'utf8', shell: true, timeout });
  } else {
    cmdLabel = def.bin + ' ' + def.args.join(' ');
    r = spawnSync(def.bin, def.args, { cwd: dir, encoding: 'utf8', shell: true, timeout });
  }
  const ms = Date.now() - t0;
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    return {
      stack, dir, ran: false, ok: false, blocked: true, exit: null, ms,
      cmd: cmdLabel,
      info: `[${stack}] ${cmdLabel} → ${timedOut ? '超时(' + Math.round(timeout / 1000) + 's)' : '无法执行(' + (r.error.code || r.error.message) + ')'} ⇒ blocked`,
      tail: '',
    };
  }
  const out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  const ok = r.status === 0;
  return {
    stack, dir, ran: true, ok, blocked: false, exit: r.status, ms,
    cmd: cmdLabel,
    info: `[${stack}] ${cmdLabel} → exit=${r.status} (${ms}ms) ⇒ ${ok ? 'ok' : 'FAILED'}`,
    tail: clip(out, TAIL_MAX),
  };
}

// 入口：在 cwd 下找出所有 build 根并逐根跑，返回聚合三态。
//   ran      : 至少一根真的跑起来了
//   ok       : 有根跑起来 且 所有跑起来的根全绿
//   anyFailed: 有根跑起来但 exit≠0（真质量信号 → 该折返/打回）
//   blocked  : 一个根都没跑起来（无栈/无工具/超时）—— 环境型，交人工
// 兼容旧 detectAndRunTests 的字段（ran/ok/info/tail），新增 anyFailed/blocked/results。
function runAllTests(cwd) {
  const roots = findBuildRoots(cwd);
  if (roots.length === 0) {
    return {
      ran: false, ok: false, anyFailed: false, blocked: true, results: [],
      info: '未发现任何 build 根（pom.xml/package.json(test)/go.mod/Cargo.toml/pyproject.toml/*.csproj/build.gradle）—未运行测试，仅静态证据',
      tail: '',
    };
  }
  const results = roots.map(runOne);
  const ranResults = results.filter((x) => x.ran);
  const ran = ranResults.length > 0;
  const anyFailed = ranResults.some((x) => !x.ok);
  const ok = ran && ranResults.every((x) => x.ok);
  const blocked = !ran; // 没有任何根跑起来
  const header = `发现 ${roots.length} 个 build 根：` + roots.map((r) => `[${r.stack}]${path.relative(cwd, r.dir) || '.'}`).join('、');
  const info = header + '\n' + results.map((r) => '  ' + r.info).join('\n');
  const tail = results.filter((r) => r.tail).map((r) => `--- ${r.stack} @ ${path.relative(cwd, r.dir) || '.'} ---\n` + r.tail).join('\n');
  return { ran, ok, anyFailed, blocked, results, info, tail };
}

module.exports = { runAllTests, findBuildRoots, stackOf, STACK };
