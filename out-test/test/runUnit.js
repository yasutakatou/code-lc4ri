"use strict";
// =============================================================================
// Minimal stand-alone unit tests for the pure helpers in extension.ts.
// Runs under plain Node: `npm test`.  No mocha / vscode dependency required.
//
// Compile via tsconfig.test.json:  npx tsc -p ./tsconfig.test.json
// Run via:                         node ./out-test/test/runUnit.js
// =============================================================================
// We must avoid pulling in the `vscode` module (which only exists inside the
// host) at test time.  The helpers we want to test are defined at the top of
// extension.ts and do not touch `vscode`, but Node will still resolve the
// import.  We stub it out with a Proxy before requiring the module.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') {
        // Return a path to an empty stub written below.
        return require.resolve('./vscode-stub');
    }
    return origResolve.call(this, request, ...rest);
};
// `tsconfig.test.json` keeps rootDir at the project root, so test/runUnit.ts
// compiles to  out-test/test/runUnit.js  and  src/extension.ts  to
// out-test/src/extension.js  — that's why we ../src/extension here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ext = require('../src/extension');
let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passed++;
        console.log(`  ✓ ${name}`);
    }
    else {
        failed++;
        console.log(`  ✗ ${name}\n      got: ${a}\n      exp: ${e}`);
    }
}
function truthy(name, v) {
    if (v) {
        passed++;
        console.log(`  ✓ ${name}`);
    }
    else {
        failed++;
        console.log(`  ✗ ${name} (got ${String(v)})`);
    }
}
console.log('regTab / horizonCheck');
eq('regTab(0)', ext.regTab(0), '^- ');
eq('regTab(2)', ext.regTab(2), '^\t\t- ');
truthy('horizon ***', ext.horizonCheck('***'));
truthy('horizon * * *', ext.horizonCheck('* * *'));
truthy('horizon ---', ext.horizonCheck('---'));
truthy('horizon plain', !ext.horizonCheck('hello'));
console.log('detectListCommand / detectNumbered');
eq('detect "- ls"', ext.detectListCommand('- ls'), { depth: 0, body: 'ls' });
eq('detect "\\t- rm"', ext.detectListCommand('\t- rm'), { depth: 1, body: 'rm' });
eq('detect plain', ext.detectListCommand('hello'), null);
eq('detect "1. uname"', ext.detectNumbered('1. uname'), { idx: '1', body: 'uname' });
eq('detect "9. ls"', ext.detectNumbered('9. ls'), { idx: '9', body: 'ls' });
eq('detect "0. ls"', ext.detectNumbered('0. ls'), null);
console.log('extractBinding / substituteVars');
eq('binding "ls → {files}"', ext.extractBinding('ls → {files}'), { body: 'ls', bindName: 'files' });
eq('binding "ls -> {f}"', ext.extractBinding('ls -> {f}'), { body: 'ls', bindName: 'f' });
eq('no binding', ext.extractBinding('ls'), { body: 'ls', bindName: null });
const vars = { num: { '1': 'host42' }, named: { greeting: 'hi' }, prev: 'last\n', status: 0 };
eq('subst {1}', ext.substituteVars('echo {1}', vars), 'echo host42');
eq('subst named', ext.substituteVars('say {greeting}', vars), 'say hi');
eq('subst $PREV', ext.substituteVars('x={$PREV}', vars), 'x=last');
eq('subst $STATUS', ext.substituteVars('rc={$STATUS}', vars), 'rc=0');
eq('subst unknown', ext.substituteVars('keep {unknown}', vars), 'keep {unknown}');
console.log('applyChangeWord');
eq('changeWord one', ext.applyChangeWord('ls #HOME#', { '#HOME#': '/h/u' }), 'ls /h/u');
eq('changeWord none', ext.applyChangeWord('ls', {}), 'ls');
console.log('parseAssert');
const a1 = ext.parseAssert('assert: contains "ok"');
truthy('contains kind', a1 && a1.kind === 'contains' && a1.arg === 'ok');
const a2 = ext.parseAssert('assert: status == 0');
truthy('status kind', a2 && a2.kind === 'status' && a2.arg === 0);
const a3 = ext.parseAssert('assert: regex /foo/i');
truthy('regex kind', a3 && a3.kind === 'regex' && a3.arg.test('FOO'));
truthy('no match', ext.parseAssert('plain') === null);
console.log('applyTemplate (profile beats per-OS template)');
const cfg = {
    timeout: 0, template: { linux: 'L({COMMAND})', win32: 'W({COMMAND})', darwin: 'D({COMMAND})' },
    profiles: { ssh: 'ssh host {COMMAND}' },
    changeWord: {}, toutf8: false, toterminal: false, outputFormat: 'codeblock',
    dangerousPatterns: [], allowList: [], denyList: [], confirmDangerous: false,
    showCodeLens: true, shell: null
};
eq('with profile', ext.applyTemplate('ls', cfg, 'ssh'), 'ssh host ls');
const osTemplate = cfg.template[process.platform];
if (osTemplate) {
    eq('no profile -> os', ext.applyTemplate('ls', cfg, ''), osTemplate.replace('{COMMAND}', 'ls'));
}
console.log('checkSecurity');
const sec = ext.checkSecurity('rm -rf /', { ...cfg, dangerousPatterns: ext.DEFAULT_DANGEROUS_PATTERNS });
truthy('rm -rf flagged', sec.ok && !!sec.dangerous);
const denied = ext.checkSecurity('shutdown -h now', { ...cfg, denyList: ['shutdown'] });
truthy('deny works', denied.ok === false);
const allow = ext.checkSecurity('ls', { ...cfg, allowList: ['^ls$'] });
truthy('allow works', allow.ok === true);
const notAllowed = ext.checkSecurity('rm', { ...cfg, allowList: ['^ls$'] });
truthy('not in allow', notAllowed.ok === false);
console.log('normalizeIndent');
eq('no indent', ext.normalizeIndent('- a'), '- a');
// Default tabWidth=2: 2 spaces = depth 1, 4 spaces = depth 2
eq('2 spaces', ext.normalizeIndent('  - a'), '\t- a');
eq('4 spaces', ext.normalizeIndent('    - a'), '\t\t- a');
eq('6 spaces', ext.normalizeIndent('      - a'), '\t\t\t- a');
eq('1 tab', ext.normalizeIndent('\t- a'), '\t- a');
eq('8 spaces', ext.normalizeIndent('        - a'), '\t\t\t\t- a');
eq('tab+spaces', ext.normalizeIndent('\t    - a'), '\t\t\t- a');
eq('non-list line', ext.normalizeIndent('hello'), 'hello');
eq('empty line', ext.normalizeIndent(''), '');
// Explicit tabWidth=4: 4 spaces = depth 1
eq('tw4: 2 spaces', ext.normalizeIndent('  - a', 4), '\t- a');
eq('tw4: 4 spaces', ext.normalizeIndent('    - a', 4), '\t- a');
eq('tw4: 8 spaces', ext.normalizeIndent('        - a', 4), '\t\t- a');
console.log('joinContinuedLines');
{
    const r1 = ext.joinContinuedLines(['- ls \\', '   -la'], 0);
    eq('basic continuation joined', r1.joined, '- ls -la');
    eq('basic continuation consumed', r1.consumed, 2);
    const r2 = ext.joinContinuedLines(['echo hi', 'second'], 0);
    eq('no continuation joined', r2.joined, 'echo hi');
    eq('no continuation consumed', r2.consumed, 1);
    const r3 = ext.joinContinuedLines(['a \\', 'b \\', 'c'], 0);
    eq('triple-chain joined', r3.joined, 'a b c');
    eq('triple-chain consumed', r3.consumed, 3);
    // Even number of trailing backslashes = literal, no continuation
    const r4 = ext.joinContinuedLines(['echo done \\\\', 'next'], 0);
    eq('literal \\\\ no continuation', r4.consumed, 1);
    // Odd number of trailing backslashes (\\\\\) = continuation marker
    const r5 = ext.joinContinuedLines(['echo \\\\\\', 'next'], 0);
    eq('odd backslashes continuation', r5.consumed, 2);
    // Trailing whitespace after backslash is tolerated; the joiner
    // collapses whitespace around the continuation to a single space.
    const r6 = ext.joinContinuedLines(['cmd \\   ', 'next'], 0);
    eq('trailing whitespace after \\', r6.joined, 'cmd next');
    // Backslash on the very last line: no continuation possible
    const r7 = ext.joinContinuedLines(['only \\'], 0);
    eq('lone trailing backslash', r7.consumed, 1);
}
console.log('isPureCdCommand');
truthy('cd alone', ext.isPureCdCommand('cd'));
truthy('cd path', ext.isPureCdCommand('cd /tmp'));
truthy('cd ~', ext.isPureCdCommand('cd ~'));
truthy('cd dash', ext.isPureCdCommand('cd -'));
truthy('cd quoted', ext.isPureCdCommand('cd "with spaces"'));
truthy('cd relative', ext.isPureCdCommand('cd ../foo'));
truthy('cd && ls is NOT', !ext.isPureCdCommand('cd foo && ls'));
truthy('cd ; ls is NOT', !ext.isPureCdCommand('cd foo; ls'));
truthy('cd | ls is NOT', !ext.isPureCdCommand('cd foo | ls'));
truthy('ls && cd is NOT', !ext.isPureCdCommand('ls && cd foo'));
truthy('cdrom is NOT', !ext.isPureCdCommand('cdrom -l'));
truthy('plain ls is NOT', !ext.isPureCdCommand('ls -la'));
truthy('cd > out is NOT', !ext.isPureCdCommand('cd > out.txt'));
console.log('parseEnvFile');
eq('simple key=val', ext.parseEnvFile('FOO=bar\nBAZ=qux'), { FOO: 'bar', BAZ: 'qux' });
eq('quoted double', ext.parseEnvFile('A="hello world"'), { A: 'hello world' });
eq('quoted single', ext.parseEnvFile("B='it works'"), { B: 'it works' });
eq('skip comment', ext.parseEnvFile('# comment\nX=1'), { X: '1' });
eq('skip empty line', ext.parseEnvFile('\n\nY=2\n'), { Y: '2' });
eq('no value', ext.parseEnvFile('=nope'), {});
eq('empty value', ext.parseEnvFile('EMPTY='), { EMPTY: '' });
console.log('detectParallelFlag');
eq('no flag', ext.detectParallelFlag('ls -la'), { body: 'ls -la', parallel: false });
eq('with flag lower', ext.detectParallelFlag('[parallel] ls'), { body: 'ls', parallel: true });
eq('with flag upper', ext.detectParallelFlag('[PARALLEL] ls'), { body: 'ls', parallel: true });
eq('flag only', ext.detectParallelFlag('[parallel]'), { body: '', parallel: true });
eq('flag with spaces', ext.detectParallelFlag('[parallel]  cmd'), { body: 'cmd', parallel: true });
eq('partial not flag', ext.detectParallelFlag('[para] cmd'), { body: '[para] cmd', parallel: false });
console.log('parseWriteDirective');
eq('top-level write', ext.parseWriteDirective('- write: out.txt'), { depth: 0, filePath: 'out.txt' });
eq('indented write', ext.parseWriteDirective('\t- write: sub/file.txt'), { depth: 1, filePath: 'sub/file.txt' });
eq('write with spaces', ext.parseWriteDirective('- write: my file.txt'), { depth: 0, filePath: 'my file.txt' });
eq('not write', ext.parseWriteDirective('- ls -la'), null);
eq('write no path', ext.parseWriteDirective('- write:'), null);
console.log('collectFencedBlock');
eq('basic block', ext.collectFencedBlock(['```', 'line1', 'line2', '```'], 0), { content: 'line1\nline2', consumed: 4 });
eq('with lang tag', ext.collectFencedBlock(['```sh', 'echo hi', '```'], 0), { content: 'echo hi', consumed: 3 });
eq('indented fence strips indent', ext.collectFencedBlock(['  ```', '  hello', '  world', '  ```'], 0), { content: 'hello\nworld', consumed: 4 });
eq('skips leading blank lines', ext.collectFencedBlock(['', '  ', '```', 'content', '```'], 0), { content: 'content', consumed: 5 });
eq('no fence returns null', ext.collectFencedBlock(['just text', 'more text'], 0), { content: null, consumed: 0 });
eq('unclosed fence returns null', ext.collectFencedBlock(['```', 'line1'], 0), { content: null, consumed: 0 });
eq('empty block', ext.collectFencedBlock(['```', '```'], 0), { content: '', consumed: 2 });
eq('startIdx offset', ext.collectFencedBlock(['- write: foo', '```', 'body', '```'], 1), { content: 'body', consumed: 3 });
console.log('isPureExportCommand');
truthy('export VAR=val', ext.isPureExportCommand('export FOO=bar'));
truthy('export multiple', ext.isPureExportCommand('export FOO=bar BAZ=qux'));
truthy('export PATH', ext.isPureExportCommand('export PATH=/usr/local/bin:$PATH'));
truthy('export no value', ext.isPureExportCommand('export MY_VAR'));
truthy('export quoted value', ext.isPureExportCommand('export MSG="hello world"'));
truthy('export alone is pure', ext.isPureExportCommand('export'));
truthy('export && echo is NOT', !ext.isPureExportCommand('export FOO=bar && echo $FOO'));
truthy('export ; echo is NOT', !ext.isPureExportCommand('export FOO=bar; echo $FOO'));
truthy('export | cat is NOT', !ext.isPureExportCommand('export FOO=bar | cat'));
truthy('unset is NOT', !ext.isPureExportCommand('unset FOO'));
truthy('echo export is NOT', !ext.isPureExportCommand('echo export'));
truthy('exportfoo is NOT', !ext.isPureExportCommand('exportfoo=1'));
console.log('getCurrentEnv / setCurrentEnv');
ext.setCurrentEnv({});
eq('initial env empty', ext.getCurrentEnv(), {});
ext.setCurrentEnv({ FOO: 'bar' });
eq('setCurrentEnv sets value', ext.getCurrentEnv(), { FOO: 'bar' });
ext.setCurrentEnv({ FOO: 'bar', BAZ: '42' });
eq('setCurrentEnv multiple', ext.getCurrentEnv(), { FOO: 'bar', BAZ: '42' });
// setCurrentEnv should not share reference (mutation safety)
const envSnap = ext.getCurrentEnv();
ext.setCurrentEnv({});
truthy('setCurrentEnv is not shared ref', envSnap.FOO === 'bar');
eq('cleared env is empty', ext.getCurrentEnv(), {});
console.log('getPersistentVars / setPersistentVars');
ext.setPersistentVars({ num: {}, named: {} });
eq('initial persistent vars empty', ext.getPersistentVars(), { num: {}, named: {} });
ext.setPersistentVars({ num: { '1': 'host' }, named: { host: 'myhost' } });
eq('setPersistentVars sets values', ext.getPersistentVars(), { num: { '1': 'host' }, named: { host: 'myhost' } });
const pvSnap = ext.getPersistentVars();
ext.setPersistentVars({ num: {}, named: {} });
truthy('getPersistentVars is not shared ref (num)', pvSnap.num['1'] === 'host');
truthy('getPersistentVars is not shared ref (named)', pvSnap.named.host === 'myhost');
eq('cleared persistent vars', ext.getPersistentVars(), { num: {}, named: {} });
console.log('buildVarInspectorHtml — empty snapshot');
const html = ext.buildVarInspectorHtml();
truthy('html is non-empty string', typeof html === 'string' && html.length > 0);
truthy('contains tbl-num', html.includes('id="tbl-num"'));
truthy('contains tbl-named', html.includes('id="tbl-named"'));
truthy('contains tbl-builtin', html.includes('id="tbl-builtin"'));
truthy('contains tbl-env', html.includes('id="tbl-env"'));
truthy('contains bv-prev', html.includes('id="bv-prev"'));
truthy('contains bv-status', html.includes('id="bv-status"'));
truthy('contains bv-cwd', html.includes('id="bv-cwd"'));
truthy('contains filter input', html.includes('id="filter"'));
truthy('uses <details> not <section>', html.includes('<details') && !html.includes('<section'));
truthy('CSS uses details selector', html.includes('details summary') && html.includes('details[open]'));
truthy('no dead section CSS', !html.includes('section summary') && !html.includes('section[open]'));
truthy('no dead env-row class', !html.includes('.env-row'));
truthy('contains applyFilter fn', html.includes('function applyFilter'));
truthy('no acquireVsCodeApi call', !html.includes('acquireVsCodeApi'));
truthy('no postMessage call', !html.includes('postMessage'));
truthy('shows empty-num message', html.includes('No numbered variables yet.'));
truthy('shows empty-named message', html.includes('No named variables yet.'));
console.log('buildVarInspectorHtml — with snapshot');
const snap = ext.buildVarInspectorHtml({
    num: { '1': 'host42', '2': 'prod' },
    named: { greeting: 'hello', target: 'world' },
    prev: 'last output\n', status: 0, cwd: '/tmp', env: { MY_ENV: 'val' }, ts: new Date().toISOString()
});
truthy('snap: num var {1} rendered', snap.includes('{1}') && snap.includes('host42'));
truthy('snap: num var {2} rendered', snap.includes('{2}') && snap.includes('prod'));
truthy('snap: named {greeting}', snap.includes('{greeting}') && snap.includes('hello'));
truthy('snap: named {target}', snap.includes('{target}') && snap.includes('world'));
truthy('snap: prev rendered', snap.includes('last output'));
truthy('snap: status OK badge', snap.includes('badge-ok') && snap.includes('OK'));
truthy('snap: cwd rendered', snap.includes('/tmp'));
truthy('snap: env MY_ENV rendered', snap.includes('MY_ENV') && snap.includes('val'));
truthy('snap: ts rendered (not —)', !snap.includes('<span class="ts" id="ts">—</span>'));
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
//# sourceMappingURL=runUnit.js.map