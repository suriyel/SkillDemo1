// gate_bdd.cjs 集成测试（子进程跑真脚本）——重点覆盖本蓝图新增的「原文引文真伪机检」。
// gate_bdd.cjs 是无防护 IIFE（require 即执行 + process.exit），故只能子进程方式测。
// 运行：node --test blueprints/user/long-task-simple/shared-scripts/__tests__/gate_bdd.test.cjs

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GATE = path.join(__dirname, '..', 'gate_bdd.cjs');

// 一份 schema 完整、能过其它所有硬校验的 bdd.json（feature risk=normal：≥1 happy + ≥1 异常）。
// derivCite 控制两条场景的 derivation 引文（用于构造命中/造假/无引用）。
function bddDoc(derivHappy, derivNeg) {
  return {
    features: [{
      feature: '登录', risk: 'normal', scenarios: [
        { id: 'BDD-001', scenario: '成功登录', given: ['已注册用户'], when: ['提交正确密码'],
          then: ['返回状态 200'], examples: ['admin → 200'], derivation: [derivHappy] },
        { id: 'BDD-002', kind: 'negative', scenario: '密码错误被拒', given: ['已注册用户'], when: ['提交错误密码'],
          then: ['返回状态 401'], examples: ['admin/x → 401'], derivation: [derivNeg] },
      ],
    }],
    clarifications: [],
  };
}

function mkRun(doc, origContent) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-bdd-'));
  fs.mkdirSync(path.join(cwd, '.harness', 'memory', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.harness', 'memory', 'plans', 'bdd.json'), JSON.stringify(doc), 'utf8');
  if (origContent != null) {
    fs.mkdirSync(path.join(cwd, '.harness', 'memory', 'intent'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.harness', 'memory', 'intent', 'original-requirements.md'), origContent, 'utf8');
  }
  let out;
  try { out = execFileSync('node', [GATE], { cwd, encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); }
  const last = out.trim().split(/\r?\n/).pop() || '{}';
  return JSON.parse(last);
}

const ORIG = '## 来源: start-prompt\n登录成功返回 200\n密码错误返回 401\n';

test('引文命中原文 → pass=true', () => {
  const r = mkRun(bddDoc(
    '规则 original-requirements.md L2 |「登录成功返回 200」→ 正确密码 → then 200',
    '规则 original-requirements.md L3 |「密码错误返回 401」→ 错误密码 → then 401'
  ), ORIG);
  assert.equal(r.pass, true);
});

test('引文造假（原文无此句）→ pass=false 且点名未命中', () => {
  const r = mkRun(bddDoc(
    '规则 original-requirements.md L2 |「登录成功返回 999」→ ...',  // 999 原文没有
    '规则 original-requirements.md L3 |「密码错误返回 401」→ ...'
  ), ORIG);
  assert.equal(r.pass, false);
  assert.match(r.message, /引文未命中/);
  assert.match(r.message, /BDD-001/);
});

test('引用原文但 original-requirements.md 缺失 → pass=true + 软告警（不硬 fail）', () => {
  const r = mkRun(bddDoc(
    '规则 original-requirements.md L2 |「登录成功返回 200」→ ...',
    '规则 original-requirements.md L3 |「密码错误返回 401」→ ...'
  ), null); // 不写原文文件
  assert.equal(r.pass, true);
  assert.match(r.message, /original-requirements\.md/);
});

test('derivation 不引原文（引 scan file:line）+ 无原文文件 → pass=true（不检引文真伪）', () => {
  const r = mkRun(bddDoc(
    'scan 约定 src/auth.js:42「正确密码放行」→ then 200',
    'scan 约定 src/auth.js:50「错误密码拒绝」→ then 401'
  ), null);
  assert.equal(r.pass, true);
});
