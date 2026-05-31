"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_INDENT_SPACES = exports.DEFAULT_DANGEROUS_PATTERNS = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
exports.readConfig = readConfig;
exports.regTab = regTab;
exports.normalizeIndent = normalizeIndent;
exports.horizonCheck = horizonCheck;
exports.joinContinuedLines = joinContinuedLines;
exports.detectListCommand = detectListCommand;
exports.detectNumbered = detectNumbered;
exports.extractBinding = extractBinding;
exports.parseAssert = parseAssert;
exports.parseEnvFile = parseEnvFile;
exports.parseWriteDirective = parseWriteDirective;
exports.parsePromptDirective = parsePromptDirective;
exports.collectFencedBlock = collectFencedBlock;
exports.detectParallelFlag = detectParallelFlag;
exports.detectRetryFlag = detectRetryFlag;
exports.substituteVars = substituteVars;
exports.applyChangeWord = applyChangeWord;
exports.applyTemplate = applyTemplate;
exports.matchesAny = matchesAny;
exports.checkSecurity = checkSecurity;
exports.getCurrentCwd = getCurrentCwd;
exports.setCurrentCwd = setCurrentCwd;
exports.getCurrentEnv = getCurrentEnv;
exports.setCurrentEnv = setCurrentEnv;
exports.getPersistentVars = getPersistentVars;
exports.setPersistentVars = setPersistentVars;
exports.isPureExportCommand = isPureExportCommand;
exports.isPureCdCommand = isPureCdCommand;
// =============================================================================
// code-lc4ri — Markdown + LC4RI for VS Code
// -----------------------------------------------------------------------------
// v1.3+: Added Code Block Execution (bash/zsh/sh) and Auto-Write (yaml/conf/json).
// =============================================================================
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const Encoding = __importStar(require("encoding-japanese"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// -----------------------------------------------------------------------------
// Module-level state
// -----------------------------------------------------------------------------
let outputChannel;
let statusBarItem;
let activeProfile = '';
const runningProcs = new Set();
const reportEntries = [];
let codeLensEmitter;
let currentCwd = undefined;
let currentEnv = {};
let persistentVars = {
    num: {},
    named: {}
};
// -----------------------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------------------
exports.DEFAULT_DANGEROUS_PATTERNS = [
    '\\brm\\s+-rf?\\s+/',
    '\\bdd\\s+if=',
    '\\bmkfs\\.',
    '\\bshutdown\\b',
    '\\breboot\\b',
    ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
    'curl\\s+[^|]+\\|\\s*(?:sh|bash)',
    'wget\\s+[^|]+\\|\\s*(?:sh|bash)',
    '>\\s*/dev/sd[a-z]'
];
const DEFAULT_CONFIG = {
    timeout: 10000,
    template: {},
    profiles: {},
    changeWord: {},
    toutf8: true,
    toterminal: false,
    outputFormat: 'codeblock',
    dangerousPatterns: exports.DEFAULT_DANGEROUS_PATTERNS,
    allowList: [],
    denyList: [],
    confirmDangerous: true,
    showCodeLens: true,
    shell: null
};
// =============================================================================
// Activate / Deactivate
// =============================================================================
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('code-lc4ri');
    outputChannel.appendLine(`[lc4ri] activated at ${new Date().toISOString()}`);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'extension.lc4ri.switchProfile';
    statusBarItem.tooltip = 'code-lc4ri: switch execution profile';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    codeLensEmitter = new vscode.EventEmitter();
    const codeLensProvider = new LC4RICodeLensProvider(codeLensEmitter.event);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'file' }, codeLensProvider), vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'untitled' }, codeLensProvider));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('lc4ri')) {
            codeLensEmitter === null || codeLensEmitter === void 0 ? void 0 : codeLensEmitter.fire();
            updateStatusBar();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.lc4ri', (_arg) => runFromCursor({ dryRun: false })), vscode.commands.registerCommand('extension.lc4ri.dryRun', () => runFromCursor({ dryRun: true })), vscode.commands.registerCommand('extension.lc4ri.runLine', (uri, line, dryRun) => runSingleLine(uri, line, dryRun === true)), vscode.commands.registerCommand('extension.lc4ri.cancel', cancelAll), vscode.commands.registerCommand('extension.lc4ri.switchProfile', switchProfile), vscode.commands.registerCommand('extension.lc4ri.clearOutput', clearOutputBlock), vscode.commands.registerCommand('extension.lc4ri.exportReport', exportReport), vscode.commands.registerCommand('extension.lc4ri.exportReportMd', () => exportReport('md')), vscode.commands.registerCommand('extension.lc4ri.exportReportHtml', () => exportReport('html')));
    try {
        ensureLegacyConfigFile();
    }
    catch (e) {
        outputChannel.appendLine(`[lc4ri] legacy config init skipped: ${String(e)}`);
    }
}
function deactivate() {
    cancelAll();
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.dispose();
    statusBarItem === null || statusBarItem === void 0 ? void 0 : statusBarItem.dispose();
    codeLensEmitter === null || codeLensEmitter === void 0 ? void 0 : codeLensEmitter.dispose();
    currentEnv = {};
    persistentVars = { num: {}, named: {} };
}
// =============================================================================
// Configuration loading
// =============================================================================
function readConfig() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const ws = vscode.workspace.getConfiguration('lc4ri');
    const legacy = readLegacyConfig();
    const merged = {
        timeout: ws.get('timeout', (_a = legacy.timeout) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG.timeout),
        template: ws.get('template', (_b = legacy.template) !== null && _b !== void 0 ? _b : DEFAULT_CONFIG.template),
        profiles: ws.get('profiles', (_c = legacy.profiles) !== null && _c !== void 0 ? _c : DEFAULT_CONFIG.profiles),
        changeWord: ws.get('changeWord', (_d = legacy.changeWord) !== null && _d !== void 0 ? _d : DEFAULT_CONFIG.changeWord),
        toutf8: ws.get('toUtf8', (_e = legacy.toutf8) !== null && _e !== void 0 ? _e : DEFAULT_CONFIG.toutf8),
        toterminal: ws.get('toTerminal', (_f = legacy.toterminal) !== null && _f !== void 0 ? _f : DEFAULT_CONFIG.toterminal),
        outputFormat: ws.get('outputFormat', (_g = legacy.outputFormat) !== null && _g !== void 0 ? _g : DEFAULT_CONFIG.outputFormat),
        dangerousPatterns: ws.get('dangerousPatterns', (_h = legacy.dangerousPatterns) !== null && _h !== void 0 ? _h : DEFAULT_CONFIG.dangerousPatterns),
        allowList: ws.get('allowList', (_j = legacy.allowList) !== null && _j !== void 0 ? _j : DEFAULT_CONFIG.allowList),
        denyList: ws.get('denyList', (_k = legacy.denyList) !== null && _k !== void 0 ? _k : DEFAULT_CONFIG.denyList),
        confirmDangerous: ws.get('confirmDangerous', (_l = legacy.confirmDangerous) !== null && _l !== void 0 ? _l : DEFAULT_CONFIG.confirmDangerous),
        showCodeLens: ws.get('showCodeLens', (_m = legacy.showCodeLens) !== null && _m !== void 0 ? _m : DEFAULT_CONFIG.showCodeLens),
        shell: ws.get('shell', (_o = legacy.shell) !== null && _o !== void 0 ? _o : DEFAULT_CONFIG.shell)
    };
    return merged;
}
function readLegacyConfig() {
    var _a;
    try {
        const configPath = legacyConfigPath();
        if (!fs.existsSync(configPath)) {
            return {};
        }
        return (_a = JSON.parse(fs.readFileSync(configPath, 'utf8'))) !== null && _a !== void 0 ? _a : {};
    }
    catch (err) {
        return {};
    }
}
function ensureLegacyConfigFile() {
    const homePath = safeHome();
    if (!homePath) {
        return;
    }
    const dir = path.join(homePath, '.code-lc4ri');
    const file = path.join(dir, 'config.json');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify({ timeout: DEFAULT_CONFIG.timeout, template: {}, profiles: {}, changeWord: {}, toutf8: true, toterminal: false }, null, 2), 'utf8');
    }
}
function legacyConfigPath() {
    const home = safeHome();
    if (!home) {
        return '';
    }
    return path.join(home, '.code-lc4ri', 'config.json');
}
function safeHome() {
    try {
        const h = os.homedir();
        if (h && h.length) {
            return h;
        }
    }
    catch (_) { }
    try {
        const com = process.platform === 'win32' ? 'echo %USERPROFILE%' : 'echo $HOME';
        return (0, child_process_1.execSync)(com).toString().replace(/\r\n|\r|\n/, '');
    }
    catch (_) {
        return '';
    }
}
// =============================================================================
// Parsing helpers
// =============================================================================
function regTab(cnt) {
    let s = '^';
    for (let i = 0; i < cnt; i++) {
        s += '\t';
    }
    return s + '- ';
}
exports.DEFAULT_INDENT_SPACES = 2;
function normalizeIndent(line, tabWidth = exports.DEFAULT_INDENT_SPACES) {
    const m = line.match(/^([ \t]*)(.*)$/);
    if (!m) {
        return line;
    }
    const ws = m[1], rest = m[2];
    if (ws.length === 0) {
        return line;
    }
    let col = 0;
    for (const c of ws) {
        if (c === '\t') {
            col += tabWidth - (col % tabWidth);
        }
        else {
            col++;
        }
    }
    if (col === 0) {
        return rest;
    }
    return '\t'.repeat(Math.ceil(col / tabWidth)) + rest;
}
function horizonCheck(line) {
    return /^(?:\*\s?){3,}\s*$/.test(line) || /^(?:-\s?){3,}\s*$/.test(line);
}
function joinContinuedLines(lines, startIdx) {
    var _a, _b;
    let line = (_a = lines[startIdx]) !== null && _a !== void 0 ? _a : '';
    let consumed = 1;
    while (hasContinuationBackslash(line) && startIdx + consumed < lines.length) {
        const stripped = line.replace(/\s*\\\s*$/, '');
        const next = ((_b = lines[startIdx + consumed]) !== null && _b !== void 0 ? _b : '').replace(/^\s+/, '');
        line = stripped + ' ' + next;
        consumed++;
    }
    return { joined: line, consumed };
}
function hasContinuationBackslash(line) {
    const m = line.match(/(\\+)\s*$/);
    return !!m && m[1].length % 2 === 1;
}
function detectListCommand(line) {
    const m = line.match(/^(\t*)- (.*)$/);
    if (!m) {
        return null;
    }
    return { depth: m[1].length, body: m[2] };
}
function detectNumbered(line) {
    const m = line.match(/^([1-9])\.\s+(.*)$/);
    if (!m) {
        return null;
    }
    return { idx: m[1], body: m[2] };
}
function extractBinding(body) {
    const m = body.match(/\s*(?:→|->)\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/);
    if (!m) {
        return { body, bindName: null };
    }
    return { body: body.slice(0, m.index), bindName: m[1] };
}
function parseAssert(body) {
    var _a, _b, _c, _d;
    const m = body.match(/^assert\s*:\s*(.+)$/i);
    if (!m) {
        return null;
    }
    const rest = m[1].trim();
    let r = rest.match(/^contains\s+(?:"([^"]*)"|'([^']*)'|(\S.*))$/i);
    if (r) {
        return { kind: 'contains', arg: ((_b = (_a = r[1]) !== null && _a !== void 0 ? _a : r[2]) !== null && _b !== void 0 ? _b : r[3]).trim() };
    }
    r = rest.match(/^equals\s+(?:"([^"]*)"|'([^']*)'|(\S.*))$/i);
    if (r) {
        return { kind: 'equals', arg: ((_d = (_c = r[1]) !== null && _c !== void 0 ? _c : r[2]) !== null && _d !== void 0 ? _d : r[3]).trim() };
    }
    r = rest.match(/^status\s*(?:==|=)\s*(-?\d+)$/i);
    if (r) {
        return { kind: 'status', arg: parseInt(r[1], 10) };
    }
    r = rest.match(/^regex\s+\/(.+)\/([imsu]*)$/i);
    if (r) {
        return { kind: 'regex', arg: new RegExp(r[1], r[2]) };
    }
    return null;
}
function parseEnvFile(content) {
    const result = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const eq = line.indexOf('=');
        if (eq < 1) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (key) {
            result[key] = val;
        }
    }
    return result;
}
function parseWriteDirective(line) {
    const m = line.match(/^(\t*)- write:\s+(.+)$/i);
    if (!m) {
        return null;
    }
    return { depth: m[1].length, filePath: m[2].trim() };
}
function parsePromptDirective(line) {
    const m = line.match(/^(\t*)- prompt:\s+(secret\s+)?\{([A-Za-z_][A-Za-z0-9_]*)\}\s+(.+)$/i);
    if (!m) {
        return null;
    }
    return { depth: m[1].length, secret: !!m[2], bindName: m[3], message: m[4].trim() };
}
function collectFencedBlock(lines, startIdx) {
    var _a, _b;
    let idx = startIdx;
    while (idx < lines.length && lines[idx].trim() === '') {
        idx++;
    }
    if (idx >= lines.length) {
        return { content: null, consumed: 0 };
    }
    const openMatch = lines[idx].match(/^(\s*)(`{3,}|~{3,})[^\n]*$/);
    if (!openMatch) {
        return { content: null, consumed: 0 };
    }
    const fenceIndent = openMatch[1].length;
    const fenceChar = openMatch[2][0];
    const fenceLen = openMatch[2].length;
    const closingRe = new RegExp(`^\\s{0,${fenceIndent}}[${fenceChar}]{${fenceLen},}\\s*$`);
    idx++;
    const contentLines = [];
    while (idx < lines.length) {
        const l = lines[idx];
        if (closingRe.test(l)) {
            return { content: contentLines.join('\n'), consumed: idx - startIdx + 1 };
        }
        const lead = (_b = (_a = l.match(/^( *)/)) === null || _a === void 0 ? void 0 : _a[1].length) !== null && _b !== void 0 ? _b : 0;
        contentLines.push(lead >= fenceIndent ? l.slice(fenceIndent) : l);
        idx++;
    }
    return { content: null, consumed: 0 };
}
function detectParallelFlag(body) {
    const m = body.match(/^\[parallel\]\s*/i);
    if (!m) {
        return { body, parallel: false };
    }
    return { body: body.slice(m[0].length), parallel: true };
}
function detectRetryFlag(body) {
    const m = body.match(/^\[retry:\s*(\d+)(?:\s*,\s*(?:interval:)?\s*(\d+)(s|ms)?)?\]\s*/i);
    if (!m) {
        return { body, retryCount: 0, retryInterval: 0 };
    }
    let interval = 0;
    if (m[2]) {
        interval = parseInt(m[2], 10);
        if (m[3] === 's') {
            interval *= 1000;
        }
    }
    return { body: body.slice(m[0].length), retryCount: parseInt(m[1], 10), retryInterval: interval };
}
function substituteVars(line, vars) {
    return line.replace(/\{([^{}\s]+)\}/g, (whole, key) => {
        if (key.startsWith('$')) {
            switch (key) {
                case '$PREV': return vars.prev.replace(/\r?\n+$/, '');
                case '$STATUS': return String(vars.status);
                case '$DATE': return new Date().toISOString();
                case '$CWD': return process.cwd();
                case '$USER': return os.userInfo().username || '';
                case '$HOST': return os.hostname();
                default: return whole;
            }
        }
        if (/^[1-9]$/.test(key) && vars.num[key] !== undefined) {
            return vars.num[key];
        }
        if (vars.named[key] !== undefined) {
            return vars.named[key];
        }
        return whole;
    });
}
function applyChangeWord(line, map) {
    for (const k of Object.keys(map)) {
        const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        line = line.replace(new RegExp(safe, 'g'), map[k]);
    }
    return line;
}
function applyTemplate(cmd, cfg, profile) {
    if (profile && cfg.profiles[profile]) {
        return cfg.profiles[profile].replace('{COMMAND}', cmd);
    }
    if (cfg.template && cfg.template[process.platform]) {
        return cfg.template[process.platform].replace('{COMMAND}', cmd);
    }
    return cmd;
}
function generateRandomAlpha(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
// =============================================================================
// Security
// =============================================================================
function matchesAny(s, patterns) {
    for (const p of patterns) {
        try {
            if (new RegExp(p).test(s)) {
                return p;
            }
        }
        catch (_) { }
    }
    return null;
}
function checkSecurity(cmd, cfg) {
    const deny = matchesAny(cmd, cfg.denyList);
    if (deny) {
        return { ok: false, reason: `denyList match: /${deny}/` };
    }
    if (cfg.allowList.length > 0) {
        const allow = matchesAny(cmd, cfg.allowList);
        if (!allow) {
            return { ok: false, reason: `not in allowList` };
        }
    }
    const dangerous = matchesAny(cmd, cfg.dangerousPatterns);
    if (dangerous) {
        return { ok: true, dangerous };
    }
    return { ok: true };
}
async function confirmDangerous(cmd, pattern) {
    const pick = await vscode.window.showWarningMessage(`⚠ This command matches a dangerous pattern: /${pattern}/\n\n${cmd}\n\nExecute anyway?`, { modal: true }, 'Run', 'Cancel');
    return pick === 'Run';
}
// =============================================================================
// Async exec (spawn-based)
// =============================================================================
function execAsync(cmd, cfg, token, cwd, onData, env) {
    return new Promise((resolve) => {
        var _a, _b, _c;
        const shellCmd = (_a = cfg.shell) !== null && _a !== void 0 ? _a : (process.platform === 'win32' ? true : '/bin/sh');
        let effectiveCwd = cwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) {
            effectiveCwd = undefined;
        }
        const effectiveEnv = env && Object.keys(env).length > 0 ? { ...process.env, ...env } : undefined;
        const child = (0, child_process_1.spawn)(cmd, {
            shell: shellCmd,
            windowsHide: true, cwd: effectiveCwd, ...(effectiveEnv ? { env: effectiveEnv } : {})
        });
        runningProcs.add(child);
        let stdoutBuf = Buffer.alloc(0), stderrBuf = Buffer.alloc(0);
        let timedOut = false, cancelled = false;
        const killAll = (signal = 'SIGTERM') => {
            try {
                child.kill(signal);
            }
            catch (_) { }
            if (process.platform === 'win32' && child.pid) {
                try {
                    (0, child_process_1.execSync)(`taskkill /pid ${child.pid} /T /F`);
                }
                catch (_) { }
            }
        };
        const timeoutTimer = setTimeout(() => { timedOut = true; killAll('SIGKILL'); }, Math.max(0, cfg.timeout));
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => { cancelled = true; killAll('SIGTERM'); });
        (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (b) => {
            stdoutBuf = Buffer.concat([stdoutBuf, b]);
            if (onData) {
                onData(convToUTF(b, cfg), false);
            }
        });
        (_c = child.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (b) => {
            stderrBuf = Buffer.concat([stderrBuf, b]);
            if (onData) {
                onData(convToUTF(b, cfg), true);
            }
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({ stdout: convToUTF(stdoutBuf, cfg), stderr: convToUTF(stderrBuf, cfg), code: code !== null && code !== void 0 ? code : (signal ? 130 : -1), timedOut, cancelled });
        });
        child.on('error', (err) => {
            var _a;
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({ stdout: '', stderr: String((_a = err.message) !== null && _a !== void 0 ? _a : err), code: -1, timedOut, cancelled });
        });
    });
}
function convToUTF(buf, cfg) {
    if (!cfg.toutf8) {
        return buf.toString();
    }
    try {
        return Encoding.convert(buf, { from: 'AUTO', to: 'UNICODE', type: 'string' });
    }
    catch (_) {
        return buf.toString();
    }
}
function cancelAll() {
    for (const p of Array.from(runningProcs)) {
        try {
            p.kill('SIGTERM');
        }
        catch (_) { }
    }
    runningProcs.clear();
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine('[lc4ri] all running commands cancelled');
}
// =============================================================================
// Current working directory / env tracking
// =============================================================================
function getCurrentCwd() {
    var _a;
    if (currentCwd && fs.existsSync(currentCwd)) {
        return currentCwd;
    }
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    const resolved = folder ? folder.uri.fsPath : process.cwd();
    currentCwd = resolved;
    return resolved;
}
function setCurrentCwd(p) { currentCwd = p; }
function getCurrentEnv() { return currentEnv; }
function setCurrentEnv(env) { currentEnv = { ...env }; }
function getPersistentVars() { return { num: { ...persistentVars.num }, named: { ...persistentVars.named } }; }
function setPersistentVars(v) { persistentVars = { num: { ...v.num }, named: { ...v.named } }; }
function isPureExportCommand(cmd) {
    const trimmed = cmd.trim();
    if (!/^export(\s|$)/.test(trimmed)) {
        return false;
    }
    let inSingle = false, inDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (!inDouble && c === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && c === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (inSingle || inDouble) {
            continue;
        }
        if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') {
            return false;
        }
    }
    return true;
}
async function resolveExport(exportCmd, cfg, token) {
    const baseCwd = getCurrentCwd();
    const baseEnv = Object.keys(currentEnv).length > 0 ? { ...process.env, ...currentEnv } : undefined;
    const probeCmd = `${exportCmd} && env`;
    const res = await new Promise((resolve) => {
        var _a, _b, _c;
        const shellCmd = (_a = cfg.shell) !== null && _a !== void 0 ? _a : (process.platform === 'win32' ? true : '/bin/sh');
        let effectiveCwd = baseCwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) {
            effectiveCwd = undefined;
        }
        const child = (0, child_process_1.spawn)(probeCmd, { shell: shellCmd, windowsHide: true, cwd: effectiveCwd, ...(baseEnv ? { env: baseEnv } : {}) });
        runningProcs.add(child);
        let stdoutBuf = Buffer.alloc(0), stderrBuf = Buffer.alloc(0);
        let timedOut = false, cancelled = false;
        const killAll = (signal = 'SIGTERM') => { try {
            child.kill(signal);
        }
        catch (_) { } };
        const timeoutTimer = setTimeout(() => { timedOut = true; killAll('SIGKILL'); }, Math.max(0, cfg.timeout));
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => { cancelled = true; killAll('SIGTERM'); });
        (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (b) => { stdoutBuf = Buffer.concat([stdoutBuf, b]); });
        (_c = child.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (b) => { stderrBuf = Buffer.concat([stderrBuf, b]); });
        child.on('close', (code, signal) => {
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({ stdout: convToUTF(stdoutBuf, cfg), stderr: convToUTF(stderrBuf, cfg), code: code !== null && code !== void 0 ? code : (signal ? 130 : -1), timedOut, cancelled });
        });
        child.on('error', (err) => {
            var _a;
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({ stdout: '', stderr: String((_a = err.message) !== null && _a !== void 0 ? _a : err), code: -1, timedOut, cancelled });
        });
    });
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, vars: {}, output: (res.stderr || res.stdout || `export failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const envDump = {};
    let currentKey = null, currentVal = [];
    for (const rawLine of res.stdout.split(/\r?\n/)) {
        const eqIdx = rawLine.indexOf('=');
        if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawLine.slice(0, eqIdx))) {
            if (currentKey !== null) {
                envDump[currentKey] = currentVal.join('\n');
            }
            currentKey = rawLine.slice(0, eqIdx);
            currentVal = [rawLine.slice(eqIdx + 1)];
        }
        else if (currentKey !== null) {
            currentVal.push(rawLine);
        }
    }
    if (currentKey !== null) {
        envDump[currentKey] = currentVal.join('\n');
    }
    const exportedNames = [];
    const body = exportCmd.replace(/^export\s+/, '');
    for (const token of body.split(/\s+/)) {
        const name = token.split('=')[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            exportedNames.push(name);
        }
    }
    const captured = {};
    for (const name of exportedNames) {
        if (name in envDump) {
            captured[name] = envDump[name];
        }
    }
    const summary = Object.entries(captured).map(([k, v]) => `${k}=${v}`).join(', ');
    return { ok: true, vars: captured, output: summary || '(no variables captured)' };
}
function isPureCdCommand(cmd) {
    const trimmed = cmd.trim();
    if (!/^cd(\s|$)/.test(trimmed)) {
        return false;
    }
    let inSingle = false, inDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (!inDouble && c === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && c === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (inSingle || inDouble) {
            continue;
        }
        if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') {
            return false;
        }
    }
    return true;
}
async function resolveCd(cdCmd, cfg, token) {
    var _a;
    const baseCwd = getCurrentCwd();
    const printPwd = process.platform === 'win32' ? 'cd' : 'pwd';
    const fullCmd = `${cdCmd} && ${printPwd}`;
    const res = await execAsync(fullCmd, cfg, token, baseCwd, undefined, currentEnv);
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, output: (res.stderr || res.stdout || `cd failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const lines = res.stdout.replace(/\r?\n+$/, '').split(/\r?\n/);
    const newCwd = (_a = lines[lines.length - 1]) === null || _a === void 0 ? void 0 : _a.trim();
    if (!newCwd) {
        return { ok: false, output: 'could not determine new cwd' };
    }
    return { ok: true, newCwd, output: newCwd };
}
async function runFromCursor(opts) {
    const cfg = readConfig();
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('code-lc4ri: no active editor.');
        return;
    }
    if (!opts.dryRun && !vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage('code-lc4ri: this workspace is not trusted — only dry-run is available.');
        opts = { dryRun: true };
    }
    const doc = editor.document;
    const position = editor.selection.active;
    const startPos = new vscode.Position(position.line, 0);
    const endPos = new vscode.Position(doc.lineCount - 1, 10000);
    const range = new vscode.Selection(startPos, endPos);
    const text = doc.getText(range);
    const lines = text.split(/\r\n|\r|\n/);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: opts.dryRun ? 'code-lc4ri (dry-run)' : 'code-lc4ri',
        cancellable: true
    }, async (progress, token) => {
        const ctx = {
            cfg,
            profile: activeProfile,
            dryRun: opts.dryRun,
            progress,
            token,
            vars: { num: { ...persistentVars.num }, named: { ...persistentVars.named }, prev: '', status: 0 },
            consoles: '',
            lastRenderedConsoles: '',
            outputBlockStartLine: 0,
            outputBlockEndLine: 0,
            outputMarkerRange: false,
            isSyncing: false,
            execCount: 0,
            execFlag: false,
            horizonFlag: -1,
            startLine: 0,
            endLine: 0,
            nowLine: position.line,
            assertionFailed: false
        };
        // Live stream updates in the markdown editor
        const syncInterval = setInterval(async () => {
            if (!editor || !doc || ctx.isSyncing)
                return;
            ctx.isSyncing = true;
            try {
                await syncOutput(editor, doc, ctx);
            }
            finally {
                ctx.isSyncing = false;
            }
        }, 200);
        await runLines(lines, ctx);
        clearInterval(syncInterval);
        // Final sync
        if (ctx.execFlag) {
            while (ctx.isSyncing) {
                await new Promise(r => setTimeout(r, 50));
            }
            await syncOutput(editor, doc, ctx);
        }
    });
}
async function runLines(lines, ctx) {
    var _a;
    for (let i = 0; i < lines.length; i++) {
        if (ctx.token.isCancellationRequested) {
            Object.assign(persistentVars.num, ctx.vars.num);
            Object.assign(persistentVars.named, ctx.vars.named);
            break;
        }
        const cont = joinContinuedLines(lines, i);
        let line = cont.joined;
        if (cont.consumed > 1) {
            i += cont.consumed - 1;
            ctx.nowLine += cont.consumed - 1;
        }
        line = normalizeIndent(line);
        if (horizonCheck(line)) {
            ctx.horizonFlag = ctx.nowLine;
            Object.assign(persistentVars.num, ctx.vars.num);
            Object.assign(persistentVars.named, ctx.vars.named);
            break;
        }
        const envMatch = line.match(/^#\s*env:\s*(.+)$/);
        if (envMatch) {
            const envPath = envMatch[1].trim();
            const resolved = path.isAbsolute(envPath) ? envPath : path.join(getCurrentCwd(), envPath);
            try {
                const content = fs.readFileSync(resolved, 'utf8');
                Object.assign(ctx.vars.named, parseEnvFile(content));
            }
            catch (_) { }
            ctx.nowLine++;
            continue;
        }
        // NEW: Code Block parsing for Execution (bash/zsh/sh) and Write (yaml/conf/json)
        const fenceExecMatch = line.match(/^([ \t]*)(`{3,}|~{3,})\s*(bash|zsh|sh|yaml|conf|json)\b(?:\s+(.+))?\s*$/i);
        if (fenceExecMatch) {
            const depthMatch = fenceExecMatch[1];
            let depth = 0;
            for (const c of depthMatch) {
                if (c === '\t')
                    depth++;
            }
            const lang = fenceExecMatch[3].toLowerCase();
            const argPath = (_a = fenceExecMatch[4]) === null || _a === void 0 ? void 0 : _a.trim();
            const blk = collectFencedBlock(lines, i);
            if (blk.content !== null) {
                if (['yaml', 'conf', 'json'].includes(lang)) {
                    // --- Feature 2: yaml/conf/json -> write file ---
                    const isRandom = !argPath;
                    const ext = lang === 'conf' ? 'conf' : lang;
                    const randomName = generateRandomAlpha(8);
                    const filename = argPath || `${randomName}.${ext}`;
                    const resolved = path.isAbsolute(filename) ? filename : path.join(getCurrentCwd(), filename);
                    ctx.execFlag = true;
                    const header = `\n[ write: ${filename}${isRandom ? ' (auto-generated)' : ''} ] ${getDate()}\n`;
                    if (ctx.dryRun) {
                        const n = blk.content.split('\n').length;
                        ctx.consoles += header + `[dry-run] would write ${n} line(s) to ${resolved}\n`;
                    }
                    else {
                        try {
                            fs.mkdirSync(path.dirname(resolved), { recursive: true });
                            fs.writeFileSync(resolved, blk.content + '\n', 'utf8');
                            const n = blk.content.split('\n').length;
                            ctx.consoles += header + `wrote ${n} line(s) to ${resolved}\n`;
                            pushReport({ command: `write: ${filename}`, rendered: `write: ${filename}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true });
                        }
                        catch (err) {
                            ctx.consoles += header + `error: ${String(err)}\n`;
                        }
                    }
                    ctx.execCount = depth + 1;
                }
                else {
                    // --- Feature 1: bash/zsh/sh -> execute ---
                    ctx.execFlag = true;
                    const blockLines = blk.content.split(/\r?\n/);
                    const logicalCommands = [];
                    for (let b = 0; b < blockLines.length; b++) {
                        let cmd = blockLines[b];
                        // Handle line continuation with backslash
                        while (cmd.match(/\\\s*$/) && b + 1 < blockLines.length) {
                            cmd = cmd.replace(/\\\s*$/, '') + blockLines[b + 1];
                            b++;
                        }
                        const trimmed = cmd.trim();
                        if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                            logicalCommands.push(trimmed);
                        }
                    }
                    ctx.execCount = depth + 1; // Mark block initiation success
                    for (const rawCmd of logicalCommands) {
                        if (ctx.token.isCancellationRequested)
                            break;
                        let finalCmd = substituteVars(rawCmd, ctx.vars);
                        finalCmd = applyChangeWord(finalCmd, ctx.cfg.changeWord);
                        // Pass with dummy list marker "- " so runOneCommand handles it normally
                        await runOneCommand(`- ${finalCmd}`, 0, ctx);
                        // If execution fails, stop processing the rest of the block
                        if (ctx.vars.status !== 0) {
                            ctx.execCount = 0;
                            break;
                        }
                    }
                }
                i += blk.consumed - 1;
                ctx.nowLine += blk.consumed - 1;
                continue;
            }
        }
        const promptDir = parsePromptDirective(line);
        if (promptDir !== null) {
            const { depth, bindName, message, secret } = promptDir;
            const atExpected = new RegExp(regTab(ctx.execCount)).test(line);
            const atTop = new RegExp(regTab(0)).test(line);
            if (!atExpected && !atTop) {
                ctx.execCount = 0;
                ctx.nowLine++;
                continue;
            }
            if (!atExpected) {
                ctx.execCount = 0;
            }
            ctx.execFlag = true;
            if (ctx.dryRun) {
                ctx.consoles += `\n[ prompt: {${bindName}} ] ${getDate()}\n[dry-run] would prompt: ${message}\n`;
                ctx.execCount = depth + 1;
            }
            else {
                const val = await vscode.window.showInputBox({ prompt: message, password: secret, ignoreFocusOut: true });
                if (val === undefined) {
                    ctx.consoles += `\n[ prompt: {${bindName}} ] ${getDate()}\n(cancelled by user)\n`;
                    ctx.execCount = 0;
                }
                else {
                    ctx.vars.named[bindName] = val;
                    ctx.consoles += `\n[ prompt: {${bindName}} ] ${getDate()}\n(input received)\n`;
                    ctx.execCount = depth + 1;
                }
            }
            ctx.nowLine++;
            continue;
        }
        const numHit = detectNumbered(line);
        if (numHit) {
            await handleNumberedAssignment(numHit, ctx);
        }
        line = substituteVars(line, ctx.vars);
        line = applyChangeWord(line, ctx.cfg.changeWord);
        const writeDir = parseWriteDirective(line);
        if (writeDir !== null) {
            const { depth, filePath } = writeDir;
            const atExpected = new RegExp(regTab(ctx.execCount)).test(line);
            const atTop = new RegExp(regTab(0)).test(line);
            if (!atExpected && !atTop) {
                ctx.execCount = 0;
                ctx.nowLine++;
                continue;
            }
            if (!atExpected) {
                ctx.execCount = 0;
            }
            const blk = collectFencedBlock(lines, i + 1);
            const resolved = path.isAbsolute(filePath) ? filePath : path.join(getCurrentCwd(), filePath);
            ctx.execFlag = true;
            const header = `\n[ write: ${filePath} ] ${getDate()}\n`;
            if (blk.content === null) {
                ctx.consoles += header + `(no fenced block found after write:)\n`;
                ctx.execCount = 0;
            }
            else if (ctx.dryRun) {
                const n = blk.content.split('\n').length;
                ctx.consoles += header + `[dry-run] would write ${n} line(s) to ${resolved}\n`;
                i += blk.consumed;
                ctx.nowLine += blk.consumed;
                ctx.execCount = depth + 1;
            }
            else {
                try {
                    fs.mkdirSync(path.dirname(resolved), { recursive: true });
                    fs.writeFileSync(resolved, blk.content + '\n', 'utf8');
                    const n = blk.content.split('\n').length;
                    ctx.consoles += header + `wrote ${n} line(s) to ${resolved}\n`;
                    pushReport({ command: `write: ${filePath}`, rendered: `write: ${filePath}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true });
                    i += blk.consumed;
                    ctx.nowLine += blk.consumed;
                    ctx.execCount = depth + 1;
                }
                catch (err) {
                    ctx.consoles += header + `error: ${String(err)}\n`;
                    ctx.execCount = 0;
                }
            }
            ctx.nowLine++;
            continue;
        }
        const assertHit = parseAssert(line.replace(/^\t*- /, ''));
        if (assertHit && line.match(/^\t*- /)) {
            const passed = evaluateAssert(assertHit, ctx);
            const header = `\n[ assert: ${describeAssert(assertHit)} ] ${getDate()}\n`;
            ctx.consoles += header + (passed ? '✓ pass\n' : '✗ FAIL\n');
            ctx.execFlag = true;
            if (!passed) {
                ctx.assertionFailed = true;
                ctx.execCount = 0;
            }
            ctx.progress.report({ message: `assert ${passed ? 'pass' : 'FAIL'}` });
            ctx.nowLine++;
            continue;
        }
        const expectedDepthRe = new RegExp(regTab(ctx.execCount));
        if (expectedDepthRe.test(line)) {
            const { newIdx, extraNowLine } = await runOrParallel(line, ctx.execCount, lines, i, ctx);
            i = newIdx;
            ctx.nowLine += extraNowLine;
        }
        else {
            ctx.execCount = 0;
            const topRe = new RegExp(regTab(0));
            if (topRe.test(line)) {
                const { newIdx, extraNowLine } = await runOrParallel(line, 0, lines, i, ctx);
                i = newIdx;
                ctx.nowLine += extraNowLine;
            }
        }
        if (isFenceLine(line)) {
            if (ctx.startLine === 0) {
                ctx.startLine = ctx.nowLine;
            }
            else {
                ctx.endLine = ctx.nowLine;
                Object.assign(persistentVars.num, ctx.vars.num);
                Object.assign(persistentVars.named, ctx.vars.named);
                break;
            }
        }
        Object.assign(persistentVars.num, ctx.vars.num);
        Object.assign(persistentVars.named, ctx.vars.named);
        ctx.nowLine++;
    }
}
function isFenceLine(s) { return /^```\s*$/.test(s); }
async function handleNumberedAssignment(hit, ctx) {
    var _a;
    const { body, bindName } = extractBinding(hit.body);
    const cmd = applyChangeWord(substituteVars(body, ctx.vars), ctx.cfg.changeWord);
    const finalCmd = applyTemplate(cmd, ctx.cfg, ctx.profile);
    const sec = checkSecurity(finalCmd, ctx.cfg);
    if (!sec.ok) {
        ctx.vars.num[hit.idx] = `(blocked: ${(_a = sec.reason) !== null && _a !== void 0 ? _a : 'security'})`;
        return;
    }
    if (sec.dangerous && ctx.cfg.confirmDangerous && !ctx.dryRun) {
        if (!(await confirmDangerous(finalCmd, sec.dangerous))) {
            ctx.vars.num[hit.idx] = '(cancelled by user)';
            return;
        }
    }
    if (ctx.dryRun) {
        ctx.vars.num[hit.idx] = `[dry-run] ${finalCmd}`;
        if (bindName) {
            ctx.vars.named[bindName] = ctx.vars.num[hit.idx];
        }
        return;
    }
    if (isPureCdCommand(finalCmd)) {
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd;
            ctx.vars.num[hit.idx] = currentCwd;
            if (bindName) {
                ctx.vars.named[bindName] = currentCwd;
            }
            ctx.vars.prev = currentCwd;
            ctx.vars.status = 0;
        }
        else {
            ctx.vars.status = 1;
        }
        return;
    }
    if (isPureExportCommand(finalCmd)) {
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.vars.num[hit.idx] = expRes.output;
            if (bindName) {
                ctx.vars.named[bindName] = expRes.output;
            }
            ctx.vars.prev = expRes.output;
            ctx.vars.status = 0;
        }
        else {
            ctx.vars.status = 1;
        }
        return;
    }
    ctx.progress.report({ message: `setting {${hit.idx}}: ${finalCmd}` });
    const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), undefined, currentEnv);
    const trimmed = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
    ctx.vars.num[hit.idx] = trimmed;
    if (bindName) {
        ctx.vars.named[bindName] = trimmed;
    }
    ctx.vars.prev = res.stdout;
    ctx.vars.status = res.code;
    pushReport({ command: finalCmd, rendered: finalCmd, output: trimmed, code: res.code, ts: getDate(), ok: res.code === 0 && !res.timedOut && !res.cancelled });
}
async function runOneCommand(rawLine, depth, ctx) {
    var _a, _b;
    const stripRe = new RegExp(regTab(depth));
    const rawBody = rawLine.replace(stripRe, '');
    const { body: noParallelBody } = detectParallelFlag(rawBody);
    const { body: noRetryBody, retryCount, retryInterval } = detectRetryFlag(noParallelBody);
    const { body: cleanBody, bindName } = extractBinding(noRetryBody);
    if (/^include:\s+/i.test(cleanBody)) {
        await runInclude(cleanBody.replace(/^include:\s+/i, '').trim(), ctx);
        ctx.execFlag = true;
        ctx.execCount = depth + 1;
        return;
    }
    if (/^open:\s+/i.test(cleanBody)) {
        await openFileTab(cleanBody.replace(/^open:\s+/i, '').trim());
        ctx.execFlag = true;
        ctx.execCount = depth + 1;
        return;
    }
    if (/^!\s+/.test(cleanBody)) {
        const termCmd = cleanBody.replace(/^!\s+/, '').trim();
        ctx.consoles += `\n[ ! ${termCmd} ] ${getDate()}\n`;
        ctx.execFlag = true;
        if (ctx.dryRun) {
            ctx.consoles += `[dry-run: terminal] ${termCmd}\n`;
        }
        else {
            (_a = vscode.window.activeTerminal) === null || _a === void 0 ? void 0 : _a.sendText(termCmd);
            ctx.consoles += `(sent to terminal)\n`;
        }
        ctx.execCount = depth + 1;
        return;
    }
    const baseCmd = cleanBody;
    const finalCmd = applyTemplate(baseCmd, ctx.cfg, ctx.profile);
    const sec = checkSecurity(finalCmd, ctx.cfg);
    ctx.execFlag = true;
    ctx.consoles += `\n[ ${finalCmd} ] ${getDate()}\n`;
    if (!sec.ok) {
        ctx.consoles += `(blocked by security: ${sec.reason})\n`;
        ctx.execCount = 0;
        return;
    }
    if (sec.dangerous && ctx.cfg.confirmDangerous && !ctx.dryRun) {
        if (!(await confirmDangerous(finalCmd, sec.dangerous))) {
            ctx.consoles += '(cancelled by user)\n';
            ctx.execCount = 0;
            return;
        }
    }
    if (ctx.dryRun) {
        ctx.consoles += `[dry-run] ${finalCmd}\n`;
        ctx.execCount = depth + 1;
        return;
    }
    if (ctx.cfg.toterminal) {
        (_b = vscode.window.activeTerminal) === null || _b === void 0 ? void 0 : _b.sendText(finalCmd);
        ctx.consoles += `(sent to terminal)\n`;
    }
    if (isPureCdCommand(finalCmd)) {
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd;
            ctx.consoles += `(cwd → ${currentCwd})\n`;
            ctx.vars.prev = currentCwd;
            ctx.vars.status = 0;
            if (bindName) {
                ctx.vars.named[bindName] = currentCwd;
            }
            ctx.execCount = depth + 1;
        }
        else {
            ctx.consoles += `${cdRes.output}\n[cd failed]\n`;
            ctx.vars.status = 1;
            ctx.execCount = 0;
        }
        return;
    }
    if (isPureExportCommand(finalCmd)) {
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.consoles += `(env → ${expRes.output})\n`;
            ctx.vars.prev = expRes.output;
            ctx.vars.status = 0;
            if (bindName) {
                ctx.vars.named[bindName] = expRes.output;
            }
            ctx.execCount = depth + 1;
        }
        else {
            ctx.consoles += `${expRes.output}\n[export failed]\n`;
            ctx.vars.status = 1;
            ctx.execCount = 0;
        }
        return;
    }
    let attempts = 0;
    let maxAttempts = retryCount > 0 ? retryCount + 1 : 1;
    let res = null;
    while (attempts < maxAttempts && !ctx.token.isCancellationRequested) {
        if (attempts > 0) {
            const waitMsg = `\n[retry ${attempts}/${retryCount} wait ${retryInterval}ms...]\n`;
            ctx.consoles += waitMsg;
            await new Promise(r => setTimeout(r, retryInterval));
        }
        ctx.progress.report({ message: `${finalCmd}${retryCount > 0 ? ` (try ${attempts + 1})` : ''}` });
        res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), (chunk, isStderr) => {
            const text = isStderr ? `[stderr] ${chunk}` : chunk;
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(text);
            ctx.consoles += text;
        }, currentEnv);
        let suffix = "";
        if (res.timedOut) {
            suffix += `\n[timeout after ${ctx.cfg.timeout}ms]\n`;
        }
        if (res.cancelled) {
            suffix += `\n[cancelled]\n`;
        }
        if (res.code !== 0 && !res.cancelled && !res.timedOut) {
            suffix += `\n[exit ${res.code}]\n`;
        }
        ctx.consoles += suffix;
        if (res.code === 0 && !res.timedOut && !res.cancelled) {
            break;
        }
        attempts++;
    }
    if (res) {
        ctx.vars.prev = res.stdout;
        ctx.vars.status = res.code;
        if (bindName) {
            ctx.vars.named[bindName] = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
        }
        pushReport({
            command: finalCmd, rendered: finalCmd,
            output: res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ''), code: res.code, ts: getDate(), ok: res.code === 0 && !res.timedOut && !res.cancelled
        });
        ctx.execCount = (res.code === 0 && !res.timedOut && !res.cancelled) ? depth + 1 : 0;
    }
}
async function runInclude(includePath, ctx) {
    const resolved = path.isAbsolute(includePath) ? includePath : path.join(getCurrentCwd(), includePath);
    if (!fs.existsSync(resolved)) {
        ctx.consoles += `\n[include: file not found: ${resolved}]\n`;
        return;
    }
    ctx.consoles += `\n[ include: ${resolved} ] ${getDate()}\n`;
    try {
        const subCtx = { ...ctx, consoles: '', execCount: 0, execFlag: false, horizonFlag: -1, startLine: 0, endLine: 0, nowLine: 0, assertionFailed: false };
        await runLines(fs.readFileSync(resolved, 'utf8').split(/\r?\n/), subCtx);
        ctx.consoles += subCtx.consoles;
        ctx.vars = subCtx.vars;
        ctx.execFlag = ctx.execFlag || subCtx.execFlag;
    }
    catch (err) {
        ctx.consoles += `\n[include: read error: ${String(err)}]\n`;
    }
}
async function runParallelGroup(rawLines, depth, ctx) {
    ctx.execFlag = true;
    const depthRe = new RegExp(regTab(depth));
    const tasks = rawLines.map(async (rawLine) => {
        const rawBody = rawLine.replace(depthRe, '');
        const { body: cleanBody, bindName } = extractBinding(detectParallelFlag(rawBody).body);
        const finalCmd = applyTemplate(applyChangeWord(substituteVars(cleanBody, ctx.vars), ctx.cfg.changeWord), ctx.cfg, ctx.profile);
        const header = `\n[ ${finalCmd} ] ${getDate()}\n`;
        if (ctx.dryRun) {
            return { header, output: `[dry-run] ${finalCmd}\n`, ok: true, bindName, bindVal: '' };
        }
        const sec = checkSecurity(finalCmd, ctx.cfg);
        if (!sec.ok) {
            return { header, output: `(blocked: ${sec.reason})\n`, ok: false, bindName, bindVal: '' };
        }
        ctx.progress.report({ message: `[parallel] ${finalCmd}` });
        const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), (chunk, isStderr) => outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(isStderr ? `[${finalCmd}][stderr] ${chunk}` : `[${finalCmd}] ${chunk}`), currentEnv);
        let suffix = "";
        if (res.timedOut) {
            suffix += `\n[timeout after ${ctx.cfg.timeout}ms]\n`;
        }
        if (res.cancelled) {
            suffix += `\n[cancelled]\n`;
        }
        if (res.code !== 0 && !res.cancelled && !res.timedOut) {
            suffix += `\n[exit ${res.code}]\n`;
        }
        const bindVal = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
        const ok = res.code === 0 && !res.timedOut && !res.cancelled;
        const output = res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : '') + suffix;
        pushReport({ command: finalCmd, rendered: finalCmd, output, code: res.code, ts: getDate(), ok });
        return { header, output, ok, bindName, bindVal };
    });
    const results = await Promise.all(tasks);
    for (const r of results) {
        ctx.consoles += r.header + r.output;
        if (r.bindName) {
            ctx.vars.named[r.bindName] = r.bindVal;
        }
    }
    ctx.execCount = results.every(r => r.ok) ? depth + 1 : 0;
}
async function runOrParallel(firstLine, depth, lines, curIdx, ctx) {
    const depthRe = new RegExp(regTab(depth));
    if (!detectParallelFlag(firstLine.replace(depthRe, '')).parallel) {
        await runOneCommand(firstLine, depth, ctx);
        return { newIdx: curIdx, extraNowLine: 0 };
    }
    const parallelLines = [firstLine];
    let j = curIdx + 1;
    let extraNowLine = 0;
    while (j < lines.length && !ctx.token.isCancellationRequested) {
        const nextCont = joinContinuedLines(lines, j);
        const nextLine = normalizeIndent(nextCont.joined);
        if (horizonCheck(nextLine) || !depthRe.test(nextLine) || !detectParallelFlag(nextLine.replace(depthRe, '')).parallel) {
            break;
        }
        parallelLines.push(nextLine);
        extraNowLine += nextCont.consumed;
        j += nextCont.consumed;
    }
    await runParallelGroup(parallelLines, depth, ctx);
    return { newIdx: j - 1, extraNowLine };
}
async function openFileTab(fname) {
    var _a;
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    if (!folder) {
        return;
    }
    try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.isAbsolute(fname) ? fname : path.join(folder.uri.fsPath, fname))));
    }
    catch (err) { }
}
function evaluateAssert(a, ctx) {
    switch (a.kind) {
        case 'contains': return ctx.vars.prev.indexOf(a.arg) !== -1;
        case 'equals': return ctx.vars.prev.trim() === a.arg;
        case 'status': return ctx.vars.status === a.arg;
        case 'regex': return a.arg.test(ctx.vars.prev);
    }
}
function describeAssert(a) {
    switch (a.kind) {
        case 'contains': return `contains "${a.arg}"`;
        case 'equals': return `equals "${a.arg}"`;
        case 'status': return `status == ${a.arg}`;
        case 'regex': return `regex ${a.arg.toString()}`;
    }
}
// -----------------------------------------------------------------------------
// Live streaming markdown write back
// -----------------------------------------------------------------------------
async function syncOutput(editor, doc, ctx) {
    if (!ctx.execFlag || ctx.consoles === ctx.lastRenderedConsoles)
        return;
    let body = ctx.consoles;
    if (ctx.startLine === 0 && ctx.endLine === 0) {
        if (ctx.cfg.outputFormat === 'collapsible') {
            body = `\n<details><summary>output ${getDate()}</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>\n`;
        }
        else {
            body = `\n\`\`\`\n${body}\n\`\`\`\n`;
        }
    }
    if (!ctx.outputMarkerRange) {
        let startL = ctx.startLine;
        let endL = ctx.endLine;
        if (startL === 0 && endL === 0) {
            if (ctx.horizonFlag > -1) {
                startL = ctx.horizonFlag - 1;
                endL = ctx.horizonFlag;
            }
            else {
                startL = doc.lineCount - 1;
                endL = doc.lineCount;
            }
        }
        const insertPos = new vscode.Position(startL + 1, 0);
        const endPos = new vscode.Position(Math.max(0, endL - 1), 10000);
        const success = await editor.edit(b => b.replace(new vscode.Range(insertPos, endPos), body));
        if (success) {
            ctx.lastRenderedConsoles = ctx.consoles;
            const lineCount = body.split('\n').length - 1;
            ctx.outputBlockStartLine = insertPos.line;
            ctx.outputBlockEndLine = insertPos.line + lineCount;
            ctx.outputMarkerRange = true;
        }
    }
    else {
        const r = new vscode.Range(ctx.outputBlockStartLine, 0, ctx.outputBlockEndLine, 10000);
        const success = await editor.edit(b => b.replace(r, body));
        if (success) {
            ctx.lastRenderedConsoles = ctx.consoles;
            const lineCount = body.split('\n').length - 1;
            ctx.outputBlockEndLine = ctx.outputBlockStartLine + lineCount;
        }
    }
}
// =============================================================================
// CodeLens provider / runSingleLine
// =============================================================================
async function runSingleLine(uri, line, dryRun) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) {
        await vscode.window.showTextDocument(uri);
    }
    const newEditor = vscode.window.activeTextEditor;
    if (!newEditor) {
        return;
    }
    const pos = new vscode.Position(line, 0);
    newEditor.selection = new vscode.Selection(pos, pos);
    await runFromCursor({ dryRun });
}
class LC4RICodeLensProvider {
    constructor(emitter) { this.onDidChangeCodeLenses = emitter; }
    provideCodeLenses(doc) {
        const cfg = readConfig();
        if (!cfg.showCodeLens) {
            return [];
        }
        const lenses = [];
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;
            if (detectListCommand(line) || detectNumbered(line)) {
                const range = doc.lineAt(i).range;
                lenses.push(new vscode.CodeLens(range, { title: '▶ Run', command: 'extension.lc4ri.runLine', arguments: [doc.uri, i, false] }));
                lenses.push(new vscode.CodeLens(range, { title: 'Dry-run', command: 'extension.lc4ri.runLine', arguments: [doc.uri, i, true] }));
            }
        }
        return lenses;
    }
}
// =============================================================================
// Status bar / profile switcher / clear output
// =============================================================================
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    const cfg = readConfig();
    const profileNames = Object.keys(cfg.profiles);
    statusBarItem.text = activeProfile ? `$(terminal) lc4ri: ${activeProfile}` : (profileNames.length ? '$(terminal) lc4ri: (none)' : '$(terminal) lc4ri');
}
async function switchProfile() {
    const cfg = readConfig();
    const items = [{ label: '(none)', description: 'use legacy OS-keyed template only' }, ...Object.keys(cfg.profiles).map(k => ({ label: k, description: cfg.profiles[k] }))];
    const pick = await vscode.window.showQuickPick(items, { title: 'code-lc4ri: switch execution profile', placeHolder: activeProfile || '(none)' });
    if (!pick) {
        return;
    }
    activeProfile = pick.label === '(none)' ? '' : pick.label;
    updateStatusBar();
}
async function clearOutputBlock() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const doc = editor.document;
    const cursor = editor.selection.active.line;
    let start = -1, end = -1;
    for (let i = cursor; i < doc.lineCount; i++) {
        if (/^```\s*$/.test(doc.lineAt(i).text)) {
            start = i;
            break;
        }
    }
    if (start === -1) {
        return;
    }
    for (let i = start + 1; i < doc.lineCount; i++) {
        if (/^```\s*$/.test(doc.lineAt(i).text)) {
            end = i;
            break;
        }
    }
    if (end === -1) {
        return;
    }
    await editor.edit(b => b.replace(new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, doc.lineAt(end).text.length)), '```\n```'));
}
function getDate() { return new Date(Date.now()).toString(); }
function pushReport(entry) {
    reportEntries.push(entry);
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[${entry.ts}] (${entry.ok ? 'ok' : 'NG'} code=${entry.code}) ${entry.command}`);
}
// =============================================================================
// Export report
// =============================================================================
async function exportReport(kind = 'html') {
    var _a;
    if (reportEntries.length === 0) {
        vscode.window.showInformationMessage('code-lc4ri: nothing to export yet.');
        return;
    }
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    const fname = path.join(folder ? folder.uri.fsPath : os.tmpdir(), `lc4ri-report-${new Date().toISOString().replace(/[:.]/g, '-')}.${kind}`);
    fs.writeFileSync(fname, kind === 'md' ? buildMarkdownReport() : buildHtmlReport(), 'utf8');
    if (await vscode.window.showInformationMessage(`code-lc4ri: report saved to ${fname}`, 'Open') === 'Open') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fname));
    }
}
function buildMarkdownReport() {
    let s = `# code-lc4ri execution report\n\n- generated: ${new Date().toISOString()}\n- profile:   ${activeProfile || '(none)'}\n- host:      ${os.hostname()}\n- user:      ${os.userInfo().username}\n\n`;
    for (const e of reportEntries) {
        s += `## ${e.ok ? '✅' : '❌'} ${e.command}\n\n- at: ${e.ts}\n- exit: ${e.code}\n\n\`\`\`\n${e.output}\n\`\`\`\n\n`;
    }
    return s;
}
function buildHtmlReport() {
    const rows = reportEntries.map(e => `<section class="${e.ok ? 'ok' : 'ng'}"><h3>${escapeHtml(e.command)}</h3><p class="meta">at ${escapeHtml(e.ts)} — exit ${e.code}</p><pre>${escapeHtml(e.output)}</pre></section>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>lc4ri report</title><style>body{font-family:system-ui,sans-serif;max-width:920px;margin:2em auto;padding:0 1em;} h1{border-bottom:1px solid #ccc;} section{border-left:4px solid #aaa;margin:1em 0;padding:0.5em 1em;} section.ok{border-color:#3a3;background:#f3fbf3;} section.ng{border-color:#c33;background:#fbf3f3;} pre{background:#111;color:#eee;padding:1em;overflow:auto;} .meta{color:#666;font-size:0.9em;}</style></head><body><h1>code-lc4ri execution report</h1><p><b>generated:</b> ${escapeHtml(new Date().toISOString())}<br><b>profile:</b> ${escapeHtml(activeProfile || '(none)')}<br><b>host:</b> ${escapeHtml(os.hostname())}<br><b>user:</b> ${escapeHtml(os.userInfo().username)}</p>${rows}</body></html>`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
//# sourceMappingURL=extension.js.map