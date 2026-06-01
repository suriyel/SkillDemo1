#!/usr/bin/env node
// init_project.cjs — 从 SRS + Design 解析结果生成 project-context.md
//
// 照搬 scripts/init_project.py 的 md 渲染相关逻辑（LANG_PRESETS、UTF-8 stdout、
// 模板填充），裁掉物理脚手架（CLAUDE.md/AGENTS.md/scripts/examples/docs）
// —— harness 用不到。仅产出一个 md 文件供下游 wd 节点消费。
//
// Usage:
//   node init_project.cjs <project-name> \
//     --memory-dir=<path> \
//     [--lang=<python|java|javascript|typescript|c|cpp>] \
//     [--test-framework=<...>] [--coverage-tool=<...>] \
//     [--constraints-file=<path>] [--assumptions-file=<path>]
//
// stdout: 一行 JSON {ok:true, written:[...], project, lang}
// exit:   0 success | 1 invalid input / IO error

const fs = require('fs');
const path = require('path');

// 强制 stdout/stderr UTF-8（参考 init_project.py:32-37）—— Windows cp936 / LANG=C
// 下 CJK 文本不被乱码。Node 默认 utf-8，此处仅保险。
if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');
if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding('utf8');

// LANG_PRESETS — 与 init_project.py:119-155 一致，去掉 mutation_tool
const LANG_PRESETS = {
  python:     { test_framework: 'pytest',  coverage_tool: 'pytest-cov' },
  java:       { test_framework: 'junit',   coverage_tool: 'jacoco' },
  javascript: { test_framework: 'jest',    coverage_tool: 'c8-jest' },
  typescript: { test_framework: 'vitest',  coverage_tool: 'c8' },
  c:          { test_framework: 'ctest',   coverage_tool: 'gcov' },
  cpp:        { test_framework: 'gtest',   coverage_tool: 'gcov' },
  'c++':      { test_framework: 'gtest',   coverage_tool: 'gcov' },
};

function die(msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const out = { project: null, memoryDir: null, lang: 'TODO',
                testFramework: null, coverageTool: null,
                constraintsFile: null, assumptionsFile: null };
  let positional = 0;
  for (const a of argv) {
    if (a.startsWith('--memory-dir='))        out.memoryDir = a.slice('--memory-dir='.length);
    else if (a.startsWith('--lang='))         out.lang = a.slice('--lang='.length);
    else if (a.startsWith('--test-framework=')) out.testFramework = a.slice('--test-framework='.length);
    else if (a.startsWith('--coverage-tool=')) out.coverageTool = a.slice('--coverage-tool='.length);
    else if (a.startsWith('--constraints-file=')) out.constraintsFile = a.slice('--constraints-file='.length);
    else if (a.startsWith('--assumptions-file=')) out.assumptionsFile = a.slice('--assumptions-file='.length);
    else if (a.startsWith('--')) die('unknown flag: ' + a);
    else if (positional === 0) { out.project = a; positional++; }
    else die('unexpected positional arg: ' + a);
  }
  if (!out.project) die('missing <project-name> (positional arg 1)');
  if (!out.memoryDir) die('missing --memory-dir=<path>');
  return out;
}

function readJsonArray(file, label) {
  if (!file) return [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { die(label + ': cannot read ' + file + ': ' + e.message); }
  let arr;
  try { arr = JSON.parse(raw); }
  catch (e) { die(label + ': invalid JSON in ' + file + ': ' + e.message); }
  if (!Array.isArray(arr)) die(label + ': must be JSON array of strings, got ' + typeof arr);
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string') die(label + '[' + i + ']: must be string, got ' + typeof arr[i]);
  }
  return arr;
}

function renderContextMd(b) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('# Project Context');
  lines.push('');
  lines.push('> 由 init_project.cjs 生成于 ' + date + '。scanner-vs-design 解析后权威源。');
  lines.push('');
  lines.push('## Project');
  lines.push(b.project);
  lines.push('');
  lines.push('## Tech Stack');
  lines.push('- language: ' + b.lang);
  lines.push('- test_framework: ' + b.testFramework);
  lines.push('- coverage_tool: ' + b.coverageTool);
  lines.push('');
  lines.push('## Constraints');
  if (b.constraints.length === 0) {
    lines.push('- (none)');
  } else {
    for (const c of b.constraints) lines.push('- ' + c);
  }
  lines.push('');
  lines.push('## Assumptions');
  if (b.assumptions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of b.assumptions) lines.push('- ' + a);
  }
  lines.push('');
  return lines.join('\n');
}

(function main() {
  const args = parseArgs(process.argv.slice(2));

  // 解析 tech_stack：--lang 命中 preset 时自动填默认；显式 flag 覆盖 preset
  const preset = LANG_PRESETS[args.lang.toLowerCase()] || {};
  const testFramework = args.testFramework || preset.test_framework || 'TODO';
  const coverageTool = args.coverageTool || preset.coverage_tool || 'TODO';

  const constraints = readJsonArray(args.constraintsFile, 'constraints');
  const assumptions = readJsonArray(args.assumptionsFile, 'assumptions');

  const bundle = {
    project: args.project,
    lang: args.lang,
    testFramework,
    coverageTool,
    constraints,
    assumptions,
  };

  const plansDir = path.join(args.memoryDir, 'plans');
  try { fs.mkdirSync(plansDir, { recursive: true }); }
  catch (e) { die('cannot create ' + plansDir + ': ' + e.message); }

  const outPath = path.join(plansDir, 'project-context.md');
  try { fs.writeFileSync(outPath, renderContextMd(bundle), 'utf8'); }
  catch (e) { die('cannot write ' + outPath + ': ' + e.message); }

  process.stdout.write(JSON.stringify({
    ok: true,
    written: [path.relative(args.memoryDir, outPath).replace(/\\/g, '/')],
    project: args.project,
    lang: args.lang,
  }) + '\n');
  process.exit(0);
})();
