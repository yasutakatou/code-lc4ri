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
exports.isWindowsShell = isWindowsShell;
exports.applyTemplate = applyTemplate;
exports.applyProfile = applyProfile;
exports.matchesAny = matchesAny;
exports.checkSecurity = checkSecurity;
exports.getCurrentCwd = getCurrentCwd;
exports.setCurrentCwd = setCurrentCwd;
exports.getCurrentEnv = getCurrentEnv;
exports.setCurrentEnv = setCurrentEnv;
exports.getPersistentVars = getPersistentVars;
exports.setPersistentVars = setPersistentVars;
exports.isPureExportCommand = isPureExportCommand;
exports.isPurePsEnvCommand = isPurePsEnvCommand;
exports.isPureCdCommand = isPureCdCommand;
exports.buildVarInspectorHtml = buildVarInspectorHtml;
// =============================================================================
// code-lc4ri — Markdown + LC4RI for VS Code
// -----------------------------------------------------------------------------
// v1.4: Added ① Variable Inspector Panel, ② Execution History Browser,
//        ③ Collapsible Output with Search, ④ Execution Timeline (waterfall).
// =============================================================================
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// -----------------------------------------------------------------------------
// Module-level state
// -----------------------------------------------------------------------------
let outputChannel;
let statusBarItem;
let activeProfile = '';
const reportEntries = [];
let codeLensEmitter;
let currentCwd = undefined;
let currentEnv = {};
let persistentVars = {
    num: {},
    named: {}
};
// Most recent complete variable snapshot (for poll-based webview refresh)
let lastKnownVars = { num: {}, named: {}, prev: '', status: 0 };
// ① Variable Inspector Panel
let varInspectorPanel;
// ② Execution History Browser
let historyPanel;
const historySessions = [];
let currentSession;
const HISTORY_FILE_NAME = '.lc4ri-history.json';
// ④ Timeline: parallel group counter
let parallelGroupCounter = 0;
// -----------------------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------------------
exports.DEFAULT_DANGEROUS_PATTERNS = [
    // Unix / Linux
    '\\brm\\s+-rf?\\s+/',
    '\\bdd\\s+if=',
    '\\bmkfs\\.',
    '\\bshutdown\\b',
    '\\breboot\\b',
    ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
    'curl\\s+[^|]+\\|\\s*(?:sh|bash)',
    'wget\\s+[^|]+\\|\\s*(?:sh|bash)',
    '>\\s*/dev/sd[a-z]',
    // Windows
    '\\brd\\s+/s\\s+/q\\b',
    '\\bformat\\s+[A-Za-z]:',
    '\\bdel\\s+/[fFsS].*\\s+/[fFsS]',
    'Remove-Item\\b.*-Recurse\\b.*-Force\\b',
    'Remove-Item\\b.*-Force\\b.*-Recurse\\b',
];
const DEFAULT_CONFIG = {
    timeout: 10000,
    profiles: {},
    template: {},
    changeWord: {},
    outputFormat: 'codeblock',
    dangerousPatterns: exports.DEFAULT_DANGEROUS_PATTERNS,
    allowList: [],
    denyList: [],
    confirmDangerous: true,
    showCodeLens: true,
    shell: null,
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
    // Load persisted history on activation
    loadHistory(context);
    context.subscriptions.push(vscode.commands.registerCommand('extension.lc4ri', (_arg) => runFromCursor({ dryRun: false })), vscode.commands.registerCommand('extension.lc4ri.dryRun', () => runFromCursor({ dryRun: true })), vscode.commands.registerCommand('extension.lc4ri.runLine', (uri, line, dryRun) => runSingleLine(uri, line, dryRun === true)), vscode.commands.registerCommand('extension.lc4ri.cancel', cancelAll), vscode.commands.registerCommand('extension.lc4ri.switchProfile', switchProfile), vscode.commands.registerCommand('extension.lc4ri.clearOutput', clearOutputBlock), vscode.commands.registerCommand('extension.lc4ri.exportReport', exportReport), vscode.commands.registerCommand('extension.lc4ri.exportReportMd', () => exportReport('md')), vscode.commands.registerCommand('extension.lc4ri.exportReportHtml', () => exportReport('html')), 
    // ① Variable Inspector
    vscode.commands.registerCommand('extension.lc4ri.showVarInspector', () => showVarInspector(context)), 
    // ② History Browser
    vscode.commands.registerCommand('extension.lc4ri.showHistory', () => showHistoryBrowser(context)), vscode.commands.registerCommand('extension.lc4ri.clearHistory', () => clearHistory(context)), 
    // ③ Output block search
    vscode.commands.registerCommand('extension.lc4ri.searchOutput', searchOutputBlock), 
    // ④ Timeline
    vscode.commands.registerCommand('extension.lc4ri.showTimeline', () => showTimeline(context)));
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
    varInspectorPanel === null || varInspectorPanel === void 0 ? void 0 : varInspectorPanel.dispose();
    historyPanel === null || historyPanel === void 0 ? void 0 : historyPanel.dispose();
    currentEnv = {};
    persistentVars = { num: {}, named: {} };
    lastKnownVars = { num: {}, named: {}, prev: '', status: 0 };
}
// =============================================================================
// Configuration loading
// =============================================================================
function readConfig() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const ws = vscode.workspace.getConfiguration('lc4ri');
    const legacy = readLegacyConfig();
    const merged = {
        timeout: ws.get('timeout', (_a = legacy.timeout) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG.timeout),
        profiles: ws.get('profiles', (_b = legacy.profiles) !== null && _b !== void 0 ? _b : DEFAULT_CONFIG.profiles),
        template: ws.get('template', (_c = legacy.template) !== null && _c !== void 0 ? _c : DEFAULT_CONFIG.template),
        changeWord: ws.get('changeWord', (_d = legacy.changeWord) !== null && _d !== void 0 ? _d : DEFAULT_CONFIG.changeWord),
        outputFormat: ws.get('outputFormat', (_e = legacy.outputFormat) !== null && _e !== void 0 ? _e : DEFAULT_CONFIG.outputFormat),
        dangerousPatterns: ws.get('dangerousPatterns', (_f = legacy.dangerousPatterns) !== null && _f !== void 0 ? _f : DEFAULT_CONFIG.dangerousPatterns),
        allowList: ws.get('allowList', (_g = legacy.allowList) !== null && _g !== void 0 ? _g : DEFAULT_CONFIG.allowList),
        denyList: ws.get('denyList', (_h = legacy.denyList) !== null && _h !== void 0 ? _h : DEFAULT_CONFIG.denyList),
        confirmDangerous: ws.get('confirmDangerous', (_j = legacy.confirmDangerous) !== null && _j !== void 0 ? _j : DEFAULT_CONFIG.confirmDangerous),
        showCodeLens: ws.get('showCodeLens', (_k = legacy.showCodeLens) !== null && _k !== void 0 ? _k : DEFAULT_CONFIG.showCodeLens),
        shell: ws.get('shell', DEFAULT_CONFIG.shell),
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
        fs.writeFileSync(file, JSON.stringify({ timeout: DEFAULT_CONFIG.timeout, profiles: {}, changeWord: {} }, null, 2), 'utf8');
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
/** Returns true when the active shell is PowerShell (explicit config or Windows default). */
function isWindowsShell(cfg) {
    return cfg.shell === 'powershell' || (cfg.shell === null && process.platform === 'win32');
}
/** Wrap cmd with a named profile, an OS-specific template, or return cmd as-is. */
function applyTemplate(cmd, cfg, profile) {
    var _a;
    if (profile && cfg.profiles[profile]) {
        return cfg.profiles[profile].replace('{COMMAND}', cmd);
    }
    const tpl = (_a = cfg.template) === null || _a === void 0 ? void 0 : _a[process.platform];
    if (tpl) {
        return tpl.replace('{COMMAND}', cmd);
    }
    return cmd;
}
/** @deprecated Use applyTemplate */
function applyProfile(cmd, cfg, profile) {
    return applyTemplate(cmd, cfg, profile);
}
function generateRandomAlpha(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
function generateNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
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
function cancelAll() {
    var _a;
    (_a = vscode.window.activeTerminal) === null || _a === void 0 ? void 0 : _a.sendText('\x03', false);
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine('[lc4ri] all running commands cancelled');
}
// =============================================================================
// Terminal execution mode
// =============================================================================
/** Strip ANSI/VT escape sequences and normalize line endings. */
function stripAnsi(s) {
    return s
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[()][0-9A-Za-z]/g, '')
        .replace(/\x1b[^[\]()]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n\r/g, '\n')
        .replace(/\r/g, '\n');
}
/** Return the currently active terminal, or show an error and return undefined. */
function getActiveTerminal() {
    const t = vscode.window.activeTerminal;
    if (t) {
        return t;
    }
    vscode.window.showErrorMessage('lc4ri terminal mode: no terminal is open. ' +
        'Please open a terminal (Ctrl+` / Cmd+`) and try again.');
    return undefined;
}
/** Wait up to `timeoutMs` for the terminal's shell integration to become active. */
function waitForShellIntegration(terminal, timeoutMs) {
    if (terminal.shellIntegration) {
        return Promise.resolve(terminal.shellIntegration);
    }
    return new Promise(resolve => {
        const timer = setTimeout(() => { sub.dispose(); resolve(undefined); }, timeoutMs);
        const sub = vscode.window.onDidChangeTerminalShellIntegration(e => {
            if (e.terminal === terminal) {
                clearTimeout(timer);
                sub.dispose();
                resolve(e.shellIntegration);
            }
        });
    });
}
/**
 * Build the shell command that runs `cmd`, captures stdout+stderr to `outPath`,
 * writes the exit code to `rcPath`, then prints the output file.
 * Generates PowerShell syntax on Windows, POSIX sh syntax elsewhere.
 */
function buildFallbackWrapperCommand(cmd, outPath, rcPath, cfg) {
    if (isWindowsShell(cfg)) {
        // PowerShell: backtick-escape backticks/double-quotes inside the path
        const esc = (p) => p.replace(/`/g, '``').replace(/"/g, '`"');
        const out = esc(outPath);
        const rc = esc(rcPath);
        // Pipe merges stderr into stdout stream; $LASTEXITCODE is preserved across pipes for native executables
        return `${cmd} 2>&1 | Out-File -LiteralPath "${out}" -Encoding utf8; $LASTEXITCODE | Set-Content -LiteralPath "${rc}" -NoNewline; Get-Content "${out}"`;
    }
    // POSIX sh
    const outQ = `'${outPath.replace(/'/g, "'\\''")}'`;
    const rcQ = `'${rcPath.replace(/'/g, "'\\''")}'`;
    return `{ ${cmd}; } > ${outQ} 2>&1; echo $? > ${rcQ}; cat ${outQ}`;
}
/**
 * Fallback execution using workspace-folder-relative temp files.
 */
async function execViaTerminalFallback(cmd, cfg, terminal, token, onData) {
    var _a;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    let outUri;
    let rcUri;
    let outShellPath;
    let rcShellPath;
    if (folder) {
        const tmpDir = vscode.Uri.joinPath(folder.uri, '.lc4ri_tmp');
        try {
            await vscode.workspace.fs.createDirectory(tmpDir);
        }
        catch (_) { }
        outUri = vscode.Uri.joinPath(tmpDir, `${id}.out`);
        rcUri = vscode.Uri.joinPath(tmpDir, `${id}.rc`);
        // Use fsPath (OS-native separators) so the shell can consume the path directly
        outShellPath = path.join(folder.uri.fsPath, '.lc4ri_tmp', `${id}.out`);
        rcShellPath = path.join(folder.uri.fsPath, '.lc4ri_tmp', `${id}.rc`);
    }
    else {
        // Use os.tmpdir() — avoids the hardcoded /tmp that doesn't exist on Windows
        const tmpBase = os.tmpdir();
        outUri = vscode.Uri.file(path.join(tmpBase, `.lc4ri_${id}.out`));
        rcUri = vscode.Uri.file(path.join(tmpBase, `.lc4ri_${id}.rc`));
        outShellPath = path.join(tmpBase, `.lc4ri_${id}.out`);
        rcShellPath = path.join(tmpBase, `.lc4ri_${id}.rc`);
    }
    const wrapped = buildFallbackWrapperCommand(cmd, outShellPath, rcShellPath, cfg);
    terminal.sendText(wrapped, true);
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] terminal fallback: temp files at ${outShellPath}`);
    return new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
            if (done) {
                return;
            }
            done = true;
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            vscode.workspace.fs.delete(outUri, { recursive: false }).then(() => { }, () => { });
            vscode.workspace.fs.delete(rcUri, { recursive: false }).then(() => { }, () => { });
            resolve(result);
        };
        let timeoutHandle;
        const resetTimeout = () => {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            timeoutHandle = setTimeout(() => {
                terminal.sendText('\x03', false);
                finish({ stdout: '', stderr: '', code: -1, timedOut: true, cancelled: false });
            }, Math.max(0, cfg.timeout));
        };
        resetTimeout();
        let lastOutSize = 0;
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => {
            terminal.sendText('\x03', false);
            finish({ stdout: '', stderr: '', code: 130, timedOut: false, cancelled: true });
        });
        const poll = async () => {
            if (done) {
                return;
            }
            try {
                const rcBytes = await vscode.workspace.fs.readFile(rcUri);
                const code = parseInt(new TextDecoder().decode(rcBytes).trim(), 10);
                let stdout = '';
                try {
                    const outBytes = await vscode.workspace.fs.readFile(outUri);
                    stdout = new TextDecoder().decode(outBytes);
                    if (onData) {
                        onData(stdout, false);
                    }
                }
                catch (_) { }
                finish({ stdout: stdout.trimEnd(), stderr: '', code: isNaN(code) ? 1 : code, timedOut: false, cancelled: false });
            }
            catch (_) {
                if (!done) {
                    try {
                        const stat = await vscode.workspace.fs.stat(outUri);
                        if (stat.size > lastOutSize) {
                            lastOutSize = stat.size;
                            resetTimeout();
                        }
                    }
                    catch (_) { }
                    setTimeout(poll, 200);
                }
            }
        };
        setTimeout(poll, 200);
    });
}
/** Execute a command in the active VSCode terminal.
 * Uses Shell Integration API when available; falls back to temp-file capture. */
async function execViaTerminal(cmd, cfg, token, onData) {
    const terminal = getActiveTerminal();
    if (!terminal) {
        return { stdout: '', stderr: 'no terminal open', code: 1, timedOut: false, cancelled: false };
    }
    // Shell Integration API gives the cleanest output streaming.
    // For established terminals it is already active (instant return).
    // For freshly opened terminals wait up to 5 s for initialization.
    const shellInt = await waitForShellIntegration(terminal, 5000);
    if (shellInt) {
        return execViaShellIntegration(cmd, cfg, terminal, shellInt, token, onData);
    }
    // Shell integration is unavailable.
    // Fall back to polling a temp file via vscode.workspace.fs.
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine('[lc4ri] terminal mode: shell integration unavailable, using temp-file fallback');
    return execViaTerminalFallback(cmd, cfg, terminal, token, onData);
}
function execViaShellIntegration(cmd, cfg, terminal, shellInt, token, onData) {
    return new Promise((resolve) => {
        const execution = shellInt.executeCommand(cmd);
        let outputBuffer = '';
        let resolved = false;
        let timedOut = false;
        let cancelled = false;
        let capturedExitCode;
        const finish = (to, ca) => {
            if (resolved) {
                return;
            }
            resolved = true;
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            endSub.dispose();
            resolve({
                stdout: outputBuffer.replace(/\n+$/, ''),
                stderr: '',
                code: to ? -1 : (ca ? 130 : (capturedExitCode !== null && capturedExitCode !== void 0 ? capturedExitCode : 0)),
                timedOut: to,
                cancelled: ca
            });
        };
        let timeoutHandle;
        const resetTimeout = () => {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                terminal.sendText('\x03', false);
                finish(true, false);
            }, Math.max(0, cfg.timeout));
        };
        resetTimeout();
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => {
            cancelled = true;
            terminal.sendText('\x03', false);
            finish(false, true);
        });
        // Record exit code when reported, but resolve only after read() drains fully
        const endSub = vscode.window.onDidEndTerminalShellExecution(event => {
            if (event.execution === execution) {
                capturedExitCode = event.exitCode;
            }
        });
        (async () => {
            for await (const chunk of execution.read()) {
                const clean = stripAnsi(chunk);
                if (clean) {
                    resetTimeout();
                }
                outputBuffer += clean;
                if (onData && !resolved) {
                    onData(clean, false);
                }
            }
            finish(timedOut, cancelled);
        })().catch(err => {
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine('[lc4ri] terminal read error: ' + String(err));
            finish(false, false);
        });
    });
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
    // PowerShell does not have `export` or `env`; use PS-compatible equivalents.
    const win = isWindowsShell(cfg);
    const sep = win ? '; ' : ' && ';
    const envDump = win
        ? `Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }`
        : 'env';
    const probeCmd = `${exportCmd}${sep}${envDump}`;
    const res = await execViaTerminal(probeCmd, cfg, token);
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, vars: {}, output: (res.stderr || res.stdout || `export failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const parsedEnv = {};
    let currentKey = null, currentVal = [];
    for (const rawLine of res.stdout.split(/\r?\n/)) {
        const eqIdx = rawLine.indexOf('=');
        if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawLine.slice(0, eqIdx))) {
            if (currentKey !== null) {
                parsedEnv[currentKey] = currentVal.join('\n');
            }
            currentKey = rawLine.slice(0, eqIdx);
            currentVal = [rawLine.slice(eqIdx + 1)];
        }
        else if (currentKey !== null) {
            currentVal.push(rawLine);
        }
    }
    if (currentKey !== null) {
        parsedEnv[currentKey] = currentVal.join('\n');
    }
    const exportedNames = [];
    const body = exportCmd.replace(/^export\s+/, '');
    for (const tok of body.split(/\s+/)) {
        const name = tok.split('=')[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            exportedNames.push(name);
        }
    }
    const captured = {};
    for (const name of exportedNames) {
        if (name in parsedEnv) {
            captured[name] = parsedEnv[name];
        }
    }
    const summary = Object.entries(captured).map(([k, v]) => `${k}=${v}`).join(', ');
    return { ok: true, vars: captured, output: summary || '(no variables captured)' };
}
/** Detect PowerShell `$env:VARNAME = value` assignment (pure, no pipes/semicolons). */
function isPurePsEnvCommand(cmd) {
    const trimmed = cmd.trim();
    if (!/^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.test(trimmed)) {
        return false;
    }
    // Reject if there are unquoted statement separators after the first =
    let inSingle = false, inDouble = false;
    let pastEq = false;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === '`') {
            i++;
            continue;
        } // PS escape
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
        if (!pastEq && c === '=') {
            pastEq = true;
            continue;
        }
        if (pastEq && (c === ';' || c === '|' || c === '&')) {
            return false;
        }
    }
    return true;
}
/** Execute a PowerShell $env: assignment and capture the new value. */
async function resolvePsEnv(psCmd, cfg, token) {
    const m = psCmd.trim().match(/^\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) {
        return { ok: false, varName: '', varVal: '', output: 'invalid $env: assignment' };
    }
    const varName = m[1];
    const probeCmd = `${psCmd}; $env:${varName}`;
    const res = await execViaTerminal(probeCmd, cfg, token);
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, varName, varVal: '', output: (res.stderr || res.stdout || `$env:${varName} assignment failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const varVal = res.stdout.replace(/\r?\n+$/, '');
    return { ok: true, varName, varVal, output: `${varName}=${varVal}` };
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
    // On PowerShell: `&&` is PS7+ only; use try/catch so a failed cd exits non-zero.
    // `(Get-Location).Path` outputs just the path string without any object formatting.
    const fullCmd = isWindowsShell(cfg)
        ? `try { ${cdCmd} } catch { exit 1 }; (Get-Location).Path`
        : `${cdCmd} && pwd`;
    const res = await execViaTerminal(fullCmd, cfg, token);
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
    // ② Start a new history session
    const sessionId = `session-${Date.now()}`;
    currentSession = {
        id: sessionId,
        startTs: new Date().toISOString(),
        endTs: '',
        profile: activeProfile || '(none)',
        runbookFile: doc.fileName,
        entries: [],
        totalOk: 0,
        totalFail: 0
    };
    // ④ Reset parallel group counter for this run
    parallelGroupCounter = 0;
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
            vars: { num: {}, named: {}, prev: '', status: 0 },
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
        if (ctx.execFlag) {
            while (ctx.isSyncing) {
                await new Promise(r => setTimeout(r, 50));
            }
            await syncOutput(editor, doc, ctx);
        }
        // ① Notify variable inspector of updates
        refreshVarInspector(ctx.vars);
    });
    // ② Finalize and save session
    if (currentSession) {
        currentSession.endTs = new Date().toISOString();
        currentSession.totalOk = currentSession.entries.filter(e => e.ok).length;
        currentSession.totalFail = currentSession.entries.filter(e => !e.ok).length;
        historySessions.unshift(currentSession);
        // Keep last 50 sessions
        if (historySessions.length > 50) {
            historySessions.splice(50);
        }
        saveHistory();
        // Refresh history panel if open
        if (historyPanel) {
            postHistoryData();
        }
        currentSession = undefined;
    }
}
async function runLines(lines, ctx) {
    var _a;
    for (let i = 0; i < lines.length; i++) {
        if (ctx.token.isCancellationRequested) {
            persistentVars.num = { ...ctx.vars.num };
            persistentVars.named = { ...ctx.vars.named };
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
            persistentVars.num = { ...ctx.vars.num };
            persistentVars.named = { ...ctx.vars.named };
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
                            pushReport({ command: `write: ${filename}`, rendered: `write: ${filename}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true, startMs: Date.now(), endMs: Date.now(), isParallel: false, parallelGroup: -1 });
                        }
                        catch (err) {
                            ctx.consoles += header + `error: ${String(err)}\n`;
                        }
                    }
                    ctx.execCount = depth + 1;
                }
                else {
                    ctx.execFlag = true;
                    const blockLines = blk.content.split(/\r?\n/);
                    const logicalCommands = [];
                    for (let b = 0; b < blockLines.length; b++) {
                        let cmd = blockLines[b];
                        while (cmd.match(/\\\s*$/) && b + 1 < blockLines.length) {
                            cmd = cmd.replace(/\\\s*$/, '') + blockLines[b + 1];
                            b++;
                        }
                        const trimmed = cmd.trim();
                        if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                            logicalCommands.push(trimmed);
                        }
                    }
                    ctx.execCount = depth + 1;
                    for (const rawCmd of logicalCommands) {
                        if (ctx.token.isCancellationRequested)
                            break;
                        let finalCmd = substituteVars(rawCmd, ctx.vars);
                        finalCmd = applyChangeWord(finalCmd, ctx.cfg.changeWord);
                        await runOneCommand(`- ${finalCmd}`, 0, ctx);
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
                    // ① Refresh inspector after prompt input
                    refreshVarInspector(ctx.vars);
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
                    pushReport({ command: `write: ${filePath}`, rendered: `write: ${filePath}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true, startMs: Date.now(), endMs: Date.now(), isParallel: false, parallelGroup: -1 });
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
                persistentVars.num = { ...ctx.vars.num };
                persistentVars.named = { ...ctx.vars.named };
                break;
            }
        }
        persistentVars.num = { ...ctx.vars.num };
        persistentVars.named = { ...ctx.vars.named };
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
        refreshVarInspector(ctx.vars);
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
        refreshVarInspector(ctx.vars);
        return;
    }
    if (isPurePsEnvCommand(finalCmd)) {
        const psRes = await resolvePsEnv(finalCmd, ctx.cfg, ctx.token);
        if (psRes.ok) {
            currentEnv[psRes.varName] = psRes.varVal;
            ctx.vars.num[hit.idx] = psRes.varVal;
            if (bindName) {
                ctx.vars.named[bindName] = psRes.varVal;
            }
            ctx.vars.prev = psRes.varVal;
            ctx.vars.status = 0;
        }
        else {
            ctx.vars.status = 1;
        }
        refreshVarInspector(ctx.vars);
        return;
    }
    ctx.progress.report({ message: `setting {${hit.idx}}: ${finalCmd}` });
    const startMs = Date.now();
    const res = await execViaTerminal(finalCmd, ctx.cfg, ctx.token);
    const endMs = Date.now();
    const trimmed = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
    ctx.vars.num[hit.idx] = trimmed;
    if (bindName) {
        ctx.vars.named[bindName] = trimmed;
    }
    ctx.vars.prev = res.stdout;
    ctx.vars.status = res.code;
    // ① Refresh inspector after numbered assignment
    refreshVarInspector(ctx.vars);
    pushReport({ command: finalCmd, rendered: finalCmd, output: trimmed, code: res.code, ts: getDate(), ok: res.code === 0 && !res.timedOut && !res.cancelled, startMs, endMs, isParallel: false, parallelGroup: -1 });
}
async function runOneCommand(rawLine, depth, ctx) {
    var _a;
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
        refreshVarInspector(ctx.vars);
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
        refreshVarInspector(ctx.vars);
        return;
    }
    if (isPurePsEnvCommand(finalCmd)) {
        const psRes = await resolvePsEnv(finalCmd, ctx.cfg, ctx.token);
        if (psRes.ok) {
            currentEnv[psRes.varName] = psRes.varVal;
            ctx.consoles += `(env → ${psRes.output})\n`;
            ctx.vars.prev = psRes.varVal;
            ctx.vars.status = 0;
            if (bindName) {
                ctx.vars.named[bindName] = psRes.varVal;
            }
            ctx.execCount = depth + 1;
        }
        else {
            ctx.consoles += `${psRes.output}\n[$env: assignment failed]\n`;
            ctx.vars.status = 1;
            ctx.execCount = 0;
        }
        refreshVarInspector(ctx.vars);
        return;
    }
    let attempts = 0;
    let maxAttempts = retryCount > 0 ? retryCount + 1 : 1;
    let res = null;
    const startMs = Date.now();
    while (attempts < maxAttempts && !ctx.token.isCancellationRequested) {
        if (attempts > 0) {
            const waitMsg = `\n[retry ${attempts}/${retryCount} wait ${retryInterval}ms...]\n`;
            ctx.consoles += waitMsg;
            await new Promise(r => setTimeout(r, retryInterval));
        }
        ctx.progress.report({ message: `${finalCmd}${retryCount > 0 ? ` (try ${attempts + 1})` : ''}` });
        res = await execViaTerminal(finalCmd, ctx.cfg, ctx.token, (chunk, isStderr) => {
            const text = isStderr ? `[stderr] ${chunk}` : chunk;
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(text);
            ctx.consoles += text;
        });
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
    const endMs = Date.now();
    if (res) {
        ctx.vars.prev = res.stdout;
        ctx.vars.status = res.code;
        if (bindName) {
            ctx.vars.named[bindName] = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
        }
        // ① Refresh variable inspector after every command so bindings are visible immediately
        refreshVarInspector(ctx.vars);
        pushReport({
            command: finalCmd, rendered: finalCmd,
            output: res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ''), code: res.code, ts: getDate(),
            ok: res.code === 0 && !res.timedOut && !res.cancelled,
            startMs, endMs, isParallel: false, parallelGroup: -1
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
    // ④ Assign a group id for timeline waterfall
    const groupId = ++parallelGroupCounter;
    const groupStartMs = Date.now();
    const tasks = rawLines.map(async (rawLine) => {
        const rawBody = rawLine.replace(depthRe, '');
        const { body: cleanBody, bindName } = extractBinding(detectParallelFlag(rawBody).body);
        const finalCmd = applyTemplate(applyChangeWord(substituteVars(cleanBody, ctx.vars), ctx.cfg.changeWord), ctx.cfg, ctx.profile);
        const header = `\n[ ${finalCmd} ] ${getDate()}\n`;
        if (ctx.dryRun) {
            return { header, output: `[dry-run] ${finalCmd}\n`, ok: true, bindName, bindVal: '', startMs: groupStartMs, endMs: groupStartMs };
        }
        const sec = checkSecurity(finalCmd, ctx.cfg);
        if (!sec.ok) {
            return { header, output: `(blocked: ${sec.reason})\n`, ok: false, bindName, bindVal: '', startMs: groupStartMs, endMs: Date.now() };
        }
        ctx.progress.report({ message: `[parallel] ${finalCmd}` });
        const taskStart = Date.now();
        const res = await execViaTerminal(finalCmd, ctx.cfg, ctx.token, (chunk, isStderr) => outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(isStderr ? `[${finalCmd}][stderr] ${chunk}` : `[${finalCmd}] ${chunk}`));
        const taskEnd = Date.now();
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
        pushReport({ command: finalCmd, rendered: finalCmd, output, code: res.code, ts: getDate(), ok, startMs: taskStart, endMs: taskEnd, isParallel: true, parallelGroup: groupId });
        return { header, output, ok, bindName, bindVal, startMs: taskStart, endMs: taskEnd };
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
    refreshVarInspector(ctx.vars);
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
        let insideOutputBlock = false;
        let blockOpenLine = -1;
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;
            // ③ Detect output code block (``` followed by content lines then ```)
            if (/^```\s*$/.test(line)) {
                if (!insideOutputBlock) {
                    insideOutputBlock = true;
                    blockOpenLine = i;
                }
                else {
                    // Closing fence: add Search + Clear lenses on the opening line
                    if (blockOpenLine >= 0) {
                        const range = doc.lineAt(blockOpenLine).range;
                        lenses.push(new vscode.CodeLens(range, {
                            title: '🔍 Search output',
                            command: 'extension.lc4ri.searchOutput',
                            arguments: [blockOpenLine]
                        }));
                        lenses.push(new vscode.CodeLens(range, {
                            title: '🗑 Clear',
                            command: 'extension.lc4ri.clearOutput',
                            arguments: []
                        }));
                    }
                    insideOutputBlock = false;
                    blockOpenLine = -1;
                }
                continue;
            }
            // Reset if we hit a non-empty non-fence line before finding the block open
            if (insideOutputBlock) {
                continue;
            }
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
    // ② Also add to current session
    if (currentSession) {
        currentSession.entries.push(entry);
    }
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
        s += `## ${e.ok ? '✅' : '❌'} ${e.command}\n\n- at: ${e.ts}\n- exit: ${e.code}\n- duration: ${e.endMs - e.startMs}ms\n\n\`\`\`\n${e.output}\n\`\`\`\n\n`;
    }
    return s;
}
function buildHtmlReport() {
    const rows = reportEntries.map(e => `<section class="${e.ok ? 'ok' : 'ng'}"><h3>${escapeHtml(e.command)}</h3><p class="meta">at ${escapeHtml(e.ts)} — exit ${e.code} — ${e.endMs - e.startMs}ms</p><pre>${escapeHtml(e.output)}</pre></section>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>lc4ri report</title><style>body{font-family:system-ui,sans-serif;max-width:920px;margin:2em auto;padding:0 1em;} h1{border-bottom:1px solid #ccc;} section{border-left:4px solid #aaa;margin:1em 0;padding:0.5em 1em;} section.ok{border-color:#3a3;background:#f3fbf3;} section.ng{border-color:#c33;background:#fbf3f3;} pre{background:#111;color:#eee;padding:1em;overflow:auto;} .meta{color:#666;font-size:0.9em;}</style></head><body><h1>code-lc4ri execution report</h1><p><b>generated:</b> ${escapeHtml(new Date().toISOString())}<br><b>profile:</b> ${escapeHtml(activeProfile || '(none)')}<br><b>host:</b> ${escapeHtml(os.hostname())}<br><b>user:</b> ${escapeHtml(os.userInfo().username)}</p>${rows}</body></html>`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// =============================================================================
// ① Variable Inspector Panel
// =============================================================================
function showVarInspector(context) {
    const html = buildVarInspectorHtml({
        num: { ...persistentVars.num },
        named: { ...persistentVars.named },
        prev: lastKnownVars.prev,
        status: lastKnownVars.status,
        cwd: getCurrentCwd(),
        env: { ...currentEnv },
        ts: new Date().toISOString()
    });
    if (varInspectorPanel) {
        varInspectorPanel.reveal(vscode.ViewColumn.Beside);
        varInspectorPanel.webview.html = html;
        return;
    }
    varInspectorPanel = vscode.window.createWebviewPanel('lc4riVarInspector', 'lc4ri: Variable Inspector', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    varInspectorPanel.webview.html = html;
    varInspectorPanel.onDidDispose(() => { varInspectorPanel = undefined; }, null, context.subscriptions);
}
function refreshVarInspector(vars) {
    var _a, _b, _c, _d;
    // Replace (not merge) so the panel always shows exactly what the current
    // run has defined — no stale values from previous runs bleed through.
    persistentVars.num = { ...vars.num };
    persistentVars.named = { ...vars.named };
    lastKnownVars = {
        num: { ...vars.num },
        named: { ...vars.named },
        prev: (_a = vars.prev) !== null && _a !== void 0 ? _a : '',
        status: (_b = vars.status) !== null && _b !== void 0 ? _b : 0
    };
    if (!varInspectorPanel) {
        return;
    }
    // Rebuild the entire HTML with current data — no JS message-passing needed.
    varInspectorPanel.webview.html = buildVarInspectorHtml({
        num: { ...vars.num },
        named: { ...vars.named },
        prev: (_c = vars.prev) !== null && _c !== void 0 ? _c : '',
        status: (_d = vars.status) !== null && _d !== void 0 ? _d : 0,
        cwd: getCurrentCwd(),
        env: { ...currentEnv },
        ts: new Date().toISOString()
    });
}
function buildVarInspectorHtml(snapshot) {
    var _a, _b, _c, _d, _e, _f, _g;
    const nonce = generateNonce();
    const num = (_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.num) !== null && _a !== void 0 ? _a : {};
    const named = (_b = snapshot === null || snapshot === void 0 ? void 0 : snapshot.named) !== null && _b !== void 0 ? _b : {};
    const prev = (_c = snapshot === null || snapshot === void 0 ? void 0 : snapshot.prev) !== null && _c !== void 0 ? _c : '';
    const status = (_d = snapshot === null || snapshot === void 0 ? void 0 : snapshot.status) !== null && _d !== void 0 ? _d : 0;
    const cwd = (_e = snapshot === null || snapshot === void 0 ? void 0 : snapshot.cwd) !== null && _e !== void 0 ? _e : '';
    const env = (_f = snapshot === null || snapshot === void 0 ? void 0 : snapshot.env) !== null && _f !== void 0 ? _f : {};
    const ts = (_g = snapshot === null || snapshot === void 0 ? void 0 : snapshot.ts) !== null && _g !== void 0 ? _g : '';
    const h = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const varRows = (entries, badge, labelFn, emptyMsg) => {
        if (!entries.length) {
            return `<tr class="empty-row"><td class="empty" colspan="2">${emptyMsg}</td></tr>`;
        }
        return entries.map(([k, v]) => {
            const label = labelFn(k);
            const safe = h(String(v).slice(0, 500));
            return `<tr class="var-row" data-name="${h(label)}"><td class="var-name"><span class="badge ${badge}">${h(label)}</span></td><td class="var-val">${safe}</td></tr>`;
        }).join('');
    };
    const statusBadge = `${status} <span class="badge ${status === 0 ? 'badge-ok' : 'badge-ng'}">${status === 0 ? 'OK' : 'FAIL'}</span>`;
    const tsLabel = ts ? new Date(ts).toLocaleTimeString() : '—';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Variable Inspector</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, monospace); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; }
  header { padding: 10px 14px 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 10; }
  header h1 { font-size: 13px; font-weight: 600; opacity: 0.9; }
  .ts { font-size: 11px; opacity: 0.5; }
  .search-bar { padding: 6px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .search-bar input { width: 100%; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; font-size: 12px; outline: none; }
  .search-bar input:focus { border-color: var(--vscode-focusBorder); }
  details { border-bottom: 1px solid var(--vscode-panel-border); }
  details summary { padding: 7px 14px; cursor: pointer; font-weight: 600; font-size: 12px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; user-select: none; list-style: none; display: flex; align-items: center; gap: 6px; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: '▶'; font-size: 9px; transition: transform 0.15s; }
  details[open] summary::before { transform: rotate(90deg); }
  .var-table { width: 100%; border-collapse: collapse; }
  .var-table td { padding: 4px 14px; vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.1)); }
  .var-table tr:last-child td { border-bottom: none; }
  .var-table tr:hover td { background: var(--vscode-list-hoverBackground); }
  .var-name { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-symbolIcon-variableForeground, #9CDCFE); font-weight: 500; white-space: nowrap; width: 120px; }
  .var-val { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; margin-left: 4px; }
  .badge-ok { background: rgba(50,200,100,0.2); color: #5db; }
  .badge-ng { background: rgba(220,60,60,0.2); color: #e88; }
  .badge-num { background: rgba(100,150,250,0.15); color: #9af; }
  .badge-named { background: rgba(200,150,50,0.15); color: #ec9; }
  .empty { padding: 10px 14px; opacity: 0.45; font-style: italic; font-size: 12px; }
  .hidden { display: none; }
</style>
</head>
<body>
<header>
  <h1>Variable Inspector</h1>
  <span class="ts" id="ts">${tsLabel}</span>
</header>
<div class="search-bar">
  <input type="text" id="filter" placeholder="Filter variables…" oninput="applyFilter(this.value)">
</div>

<details open id="sec-num">
  <summary>Numbered variables</summary>
  <table class="var-table" id="tbl-num">
    ${varRows(Object.entries(num), 'badge-num', k => `{${k}}`, 'No numbered variables yet.')}
  </table>
</details>

<details open id="sec-named">
  <summary>Named variables</summary>
  <table class="var-table" id="tbl-named">
    ${varRows(Object.entries(named), 'badge-named', k => `{${k}}`, 'No named variables yet.')}
  </table>
</details>

<details open id="sec-builtin">
  <summary>Built-in values</summary>
  <table class="var-table" id="tbl-builtin">
    <tr><td class="var-name">{$PREV}</td><td class="var-val" id="bv-prev">${prev ? h(String(prev).slice(0, 400)) : '—'}</td></tr>
    <tr><td class="var-name">{$STATUS}</td><td class="var-val" id="bv-status">${statusBadge}</td></tr>
    <tr><td class="var-name">{$CWD}</td><td class="var-val" id="bv-cwd">${cwd ? h(cwd) : '—'}</td></tr>
  </table>
</details>

<details id="sec-env">
  <summary>Environment (session)</summary>
  <table class="var-table" id="tbl-env">
    ${varRows(Object.entries(env), 'badge-named', k => k, 'No session env vars set.')}
  </table>
</details>

<script nonce="${nonce}">
function applyFilter(q) {
  var ql = q.toLowerCase();
  document.querySelectorAll('.var-row').forEach(function(tr) {
    var name = (tr.dataset.name || '').toLowerCase();
    tr.classList.toggle('hidden', !!ql && !name.includes(ql));
  });
}
</script>
</body>
</html>`;
}
// =============================================================================
// ② Execution History Browser
// =============================================================================
function historyFilePath() {
    var _a;
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    const base = folder ? folder.uri.fsPath : (safeHome() || os.tmpdir());
    return path.join(base, HISTORY_FILE_NAME);
}
function loadHistory(context) {
    try {
        const p = historyFilePath();
        if (!fs.existsSync(p)) {
            return;
        }
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(raw)) {
            historySessions.push(...raw.slice(0, 50));
        }
    }
    catch (_) { }
}
function saveHistory() {
    try {
        fs.writeFileSync(historyFilePath(), JSON.stringify(historySessions.slice(0, 50), null, 2), 'utf8');
    }
    catch (_) { }
}
function clearHistory(context) {
    historySessions.length = 0;
    saveHistory();
    if (historyPanel) {
        postHistoryData();
    }
    vscode.window.showInformationMessage('code-lc4ri: history cleared.');
}
function showHistoryBrowser(context) {
    const html = buildHistoryHtml(historySessions);
    if (historyPanel) {
        historyPanel.reveal(vscode.ViewColumn.Beside);
        historyPanel.webview.html = html;
        return;
    }
    historyPanel = vscode.window.createWebviewPanel('lc4riHistory', 'lc4ri: Execution History', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    historyPanel.webview.html = html;
    historyPanel.onDidDispose(() => { historyPanel = undefined; }, null, context.subscriptions);
    historyPanel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'openTimeline') {
            showTimeline(context, msg.sessionId);
        }
        if (msg.type === 'clearHistory') {
            clearHistory(context);
        }
    }, null, context.subscriptions);
}
function postHistoryData() {
    if (!historyPanel) {
        return;
    }
    historyPanel.webview.html = buildHistoryHtml(historySessions);
}
function buildHistoryHtml(sessions) {
    const nonce = generateNonce();
    const h = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const durStr = (ms) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    const renderSession = (s) => {
        var _a;
        const file = s.runbookFile ? ((_a = s.runbookFile.split(/[/\\]/).pop()) !== null && _a !== void 0 ? _a : '—') : '—';
        const d = s.endTs && s.startTs
            ? durStr(new Date(s.endTs).getTime() - new Date(s.startTs).getTime())
            : '?';
        const cmds = s.entries.length
            ? s.entries.map(e => `<div class="cmd-row" data-cmd="${h(e.command)}" data-ok="${e.ok ? '1' : '0'}">`
                + `<span class="cmd-icon">${e.ok ? '✅' : '❌'}</span>`
                + `<span class="cmd-text">${h(e.command)}</span>`
                + `<span class="cmd-dur">${durStr(e.endMs - e.startMs)}</span>`
                + `<span class="cmd-code">exit ${e.code}</span>`
                + `</div>`).join('')
            : '<div class="empty" style="padding:8px 14px;">No commands recorded.</div>';
        return `<details class="session" id="s-${h(s.id)}">`
            + `<summary class="session-header">`
            + `<span class="session-title">${h(file)}</span>`
            + `<span class="profile-badge">${h(s.profile)}</span>`
            + `<span class="ok-count">✅ ${s.totalOk}</span>`
            + (s.totalFail ? `<span class="ng-count">❌ ${s.totalFail}</span>` : '')
            + `<span class="session-meta">${d}</span>`
            + `<button class="btn tlbtn" data-sid="${h(s.id)}" onclick="event.preventDefault()">Timeline</button>`
            + `</summary>`
            + `<div class="session-body">${cmds}</div>`
            + `</details>`;
    };
    const listHtml = sessions.length
        ? sessions.map(renderSession).join('')
        : '<div class="empty">No history yet. Run some commands first.</div>';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Execution History</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { padding: 10px 14px 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 10px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 10; }
  header h1 { font-size: 13px; font-weight: 600; flex: 1; }
  .toolbar { padding: 6px 14px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; }
  .toolbar input { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; font-size: 12px; outline: none; }
  .toolbar input:focus { border-color: var(--vscode-focusBorder); }
  .toolbar select { padding: 4px 6px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, #555); border-radius: 3px; font-size: 12px; }
  details.session { border-bottom: 1px solid var(--vscode-panel-border); }
  details.session summary { padding: 8px 14px; display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
  details.session summary::-webkit-details-marker { display: none; }
  details.session summary:hover { background: var(--vscode-list-hoverBackground); }
  .session-title { flex: 1; font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
  .ok-count { color: #5db; background: rgba(50,200,100,0.15); padding: 1px 6px; border-radius: 10px; }
  .ng-count { color: #e88; background: rgba(220,60,60,0.15); padding: 1px 6px; border-radius: 10px; }
  .session-body { background: var(--vscode-editor-background); padding: 4px 0; }
  .cmd-row { display: flex; align-items: flex-start; padding: 4px 14px 4px 28px; gap: 8px; }
  .cmd-row:hover { background: var(--vscode-list-hoverBackground); }
  .cmd-icon { font-size: 11px; margin-top: 2px; }
  .cmd-text { flex: 1; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-all; }
  .cmd-dur { font-size: 11px; opacity: 0.5; white-space: nowrap; }
  .cmd-code { font-size: 11px; opacity: 0.6; white-space: nowrap; }
  .btn { padding: 3px 10px; font-size: 11px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .empty { padding: 24px; text-align: center; opacity: 0.4; font-style: italic; }
  .hidden { display: none; }
  .profile-badge { font-size: 10px; padding: 1px 6px; background: rgba(100,150,250,0.15); color: var(--vscode-textLink-foreground); border-radius: 10px; }
</style>
</head>
<body>
<header>
  <h1>Execution History</h1>
  <button class="btn" id="clear-btn">Clear All</button>
</header>
<div class="toolbar">
  <input type="text" id="q" placeholder="Search commands…" oninput="applyFilter()">
  <select id="statusFilter" onchange="applyFilter()">
    <option value="">All</option>
    <option value="ok">✅ OK only</option>
    <option value="ng">❌ Failed only</option>
  </select>
</div>
<div id="list">${listHtml}</div>

<script nonce="${nonce}">
var api = null;
try { api = acquireVsCodeApi(); } catch(e) {}
function send(msg) { if (api) api.postMessage(msg); }

var clearBtn = document.getElementById('clear-btn');
if (clearBtn) clearBtn.onclick = function() { send({ type: 'clearHistory' }); };

document.querySelectorAll('.tlbtn').forEach(function(btn) {
  btn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    send({ type: 'openTimeline', sessionId: this.dataset.sid });
  });
});

function applyFilter() {
  var q  = document.getElementById('q').value.toLowerCase();
  var sf = document.getElementById('statusFilter').value;
  document.querySelectorAll('details.session').forEach(function(el) {
    var rows = el.querySelectorAll('.cmd-row');
    var visible = 0;
    rows.forEach(function(r) {
      var cmd = (r.dataset.cmd || '').toLowerCase();
      var ok  = r.dataset.ok === '1';
      var show = (!q || cmd.includes(q)) && (!sf || (sf === 'ok' ? ok : !ok));
      r.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    el.style.display = (q && visible === 0) ? 'none' : '';
  });
}
</script>
</body>
</html>`;
}
// =============================================================================
// ③ Output Block Search Helper (injected into markdown output)
// =============================================================================
// The search UI is available as a VS Code command that opens an input box
// and highlights matches in the active editor's current output block.
// ③ Output Block Search
// Called via command palette or CodeLens. Optional `startLine` lets CodeLens
// pass the opening fence line directly so the user doesn't have to place the
// cursor manually.
async function searchOutputBlock(startLine) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    // Capture in a const with a non-nullable type annotation.
    // TypeScript's strictNullChecks can lose narrowing across async boundaries
    // and inside nested functions, so we pin the reference here.
    const activeEditor = editor;
    const q = await vscode.window.showInputBox({
        prompt: 'Search in output block',
        placeHolder: 'keyword…',
        validateInput: v => (v && v.trim().length > 0 ? null : 'Enter a keyword')
    });
    if (!q || !q.trim()) {
        return;
    }
    const doc = activeEditor.document;
    // Determine search origin: use provided line, cursor, or scan from top
    const origin = startLine !== undefined ? startLine : activeEditor.selection.active.line;
    let blockStart = -1, blockEnd = -1;
    // Find the nearest ``` fence at or below origin
    for (let i = origin; i < doc.lineCount; i++) {
        if (/^```/.test(doc.lineAt(i).text)) {
            blockStart = i;
            break;
        }
    }
    // Also search above if not found below
    if (blockStart === -1) {
        for (let i = origin - 1; i >= 0; i--) {
            if (/^```/.test(doc.lineAt(i).text)) {
                blockStart = i;
                break;
            }
        }
    }
    if (blockStart === -1) {
        vscode.window.showWarningMessage('code-lc4ri: No output block found near cursor.');
        return;
    }
    for (let i = blockStart + 1; i < doc.lineCount; i++) {
        if (/^```\s*$/.test(doc.lineAt(i).text)) {
            blockEnd = i;
            break;
        }
    }
    if (blockEnd === -1) {
        blockEnd = doc.lineCount - 1;
    }
    // Collect all matches
    const matches = [];
    for (let i = blockStart + 1; i < blockEnd; i++) {
        const text = doc.lineAt(i).text;
        let idx = text.indexOf(q);
        while (idx !== -1) {
            matches.push(new vscode.Range(i, idx, i, idx + q.length));
            idx = text.indexOf(q, idx + 1);
        }
    }
    if (matches.length === 0) {
        vscode.window.showInformationMessage(`code-lc4ri: "${q}" not found in output block.`);
        return;
    }
    // Decoration for all matches
    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
    });
    // Decoration for current focused match (brighter)
    const focusType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
        fontWeight: 'bold'
    });
    let currentIdx = 0;
    function revealMatch(idx) {
        const m = matches[idx];
        activeEditor.selection = new vscode.Selection(m.start, m.end);
        activeEditor.revealRange(m, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        // All matches dimly highlighted; current match brightly highlighted
        activeEditor.setDecorations(decorationType, matches.filter((_, i) => i !== idx));
        activeEditor.setDecorations(focusType, [m]);
    }
    revealMatch(0);
    // Show navigation message
    const label = (i) => `${i + 1}/${matches.length}`;
    const prompt = async () => {
        const pick = await vscode.window.showInformationMessage(`code-lc4ri: "${q}" — ${label(currentIdx)} match${matches.length > 1 ? 'es' : ''}`, ...(matches.length > 1 ? ['Next ↓', 'Prev ↑'] : []), 'Clear');
        if (pick === 'Next ↓') {
            currentIdx = (currentIdx + 1) % matches.length;
            revealMatch(currentIdx);
            await prompt();
        }
        else if (pick === 'Prev ↑') {
            currentIdx = (currentIdx - 1 + matches.length) % matches.length;
            revealMatch(currentIdx);
            await prompt();
        }
        else {
            decorationType.dispose();
            focusType.dispose();
        }
    };
    await prompt();
}
// =============================================================================
// ④ Execution Timeline (Waterfall)
// =============================================================================
function showTimeline(context, sessionId) {
    // Determine which entries to show
    let entries = reportEntries;
    let title = 'lc4ri: Timeline (current session)';
    if (sessionId) {
        const sess = historySessions.find(s => s.id === sessionId);
        if (sess) {
            entries = sess.entries;
            title = `lc4ri: Timeline — ${sess.runbookFile.split(/[/\\]/).pop()}`;
        }
    }
    const panel = vscode.window.createWebviewPanel('lc4riTimeline', title, vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = buildTimelineHtml(entries);
}
function buildTimelineHtml(entries) {
    const safeEntries = entries.map(e => ({
        command: e.command,
        ok: e.ok,
        code: e.code,
        startMs: e.startMs,
        endMs: e.endMs,
        isParallel: e.isParallel,
        parallelGroup: e.parallelGroup,
        output: e.output.slice(0, 500)
    }));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Execution Timeline</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); overflow-x: hidden; }
  header { padding: 10px 14px 8px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 10px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 10; }
  header h1 { font-size: 13px; font-weight: 600; flex: 1; }
  .summary { padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; display: flex; gap: 16px; }
  .summary span { opacity: 0.7; }
  .summary b { opacity: 1; }
  #canvas-wrap { padding: 14px; overflow-x: auto; }
  canvas { display: block; cursor: crosshair; }
  .tooltip { position: fixed; background: var(--vscode-editorHoverWidget-background, #1e1e1e); border: 1px solid var(--vscode-editorHoverWidget-border, #444); color: var(--vscode-editorHoverWidget-foreground, #ccc); padding: 8px 12px; border-radius: 4px; font-size: 12px; font-family: var(--vscode-editor-font-family, monospace); pointer-events: none; display: none; z-index: 100; max-width: 420px; word-break: break-all; line-height: 1.6; }
  .legend { padding: 6px 14px 10px; display: flex; gap: 16px; font-size: 11px; opacity: 0.7; }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 2px; }
</style>
</head>
<body>
<header><h1>Execution Timeline</h1></header>
<div class="summary" id="summary"></div>
<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#4ec9b0"></div>OK (sequential)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#569cd6"></div>OK (parallel)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#f44747"></div>Failed</div>
  <div class="legend-item"><div class="legend-dot" style="background:rgba(100,100,100,0.3)"></div>Parallel group</div>
</div>
<div id="canvas-wrap"><canvas id="cv"></canvas></div>
<div class="tooltip" id="tip"></div>

<script>
const RAW = ${JSON.stringify(safeEntries)};

const ROW_H = 34;
const LABEL_W = 220;
const PAD = 10;
const BAR_H = 18;
const BAR_PAD = (ROW_H - BAR_H) / 2;
const TICK_H = 24;

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function dur(ms) { return ms < 1000 ? ms + 'ms' : (ms/1000).toFixed(2) + 's'; }

function render() {
  if (!RAW.length) {
    document.getElementById('canvas-wrap').innerHTML = '<div style="padding:24px;opacity:0.4;font-style:italic">No entries to display.</div>';
    return;
  }

  const minMs = Math.min(...RAW.map(e => e.startMs));
  const maxMs = Math.max(...RAW.map(e => e.endMs));
  const totalMs = Math.max(maxMs - minMs, 1);

  // Summary
  const totalDur = maxMs - minMs;
  const okCount  = RAW.filter(e => e.ok).length;
  const ngCount  = RAW.length - okCount;
  document.getElementById('summary').innerHTML =
    '<span>Commands: <b>' + RAW.length + '</b></span>' +
    '<span>Total time: <b>' + dur(totalDur) + '</b></span>' +
    '<span style="color:#5db">✅ <b>' + okCount + '</b></span>' +
    (ngCount ? '<span style="color:#e88">❌ <b>' + ngCount + '</b></span>' : '');

  const cv = document.getElementById('cv');
  const canvasW = Math.max(700, (document.getElementById('canvas-wrap').clientWidth || 800) - 28);
  const barW = canvasW - LABEL_W - PAD * 2;

  // Group parallel rows together
  const groups = {};
  RAW.forEach(e => { if (e.isParallel && e.parallelGroup >= 0) { groups[e.parallelGroup] = (groups[e.parallelGroup] || []).concat(e); } });

  const canvasH = TICK_H + PAD + RAW.length * ROW_H + PAD;
  cv.width  = canvasW;
  cv.height = canvasH;

  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);

  const isDark = document.body.style.colorScheme !== 'light';
  const textColor     = getComputedStyle(document.body).getPropertyValue('--vscode-foreground') || '#ccc';
  const subColor      = 'rgba(150,150,150,0.6)';
  const gridColor     = 'rgba(150,150,150,0.15)';
  const parallelBg    = 'rgba(100,100,200,0.08)';

  // Tick marks
  const ticks = 6;
  ctx.fillStyle = subColor;
  ctx.font = '10px ' + (getComputedStyle(document.body).fontFamily || 'monospace');
  ctx.textAlign = 'left';
  for (let t = 0; t <= ticks; t++) {
    const x = LABEL_W + PAD + (barW * t / ticks);
    const ms = (totalMs * t / ticks);
    const label = dur(ms);
    ctx.fillStyle = subColor;
    ctx.textAlign = t === ticks ? 'right' : (t === 0 ? 'left' : 'center');
    ctx.fillText(label, x, 14);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, TICK_H); ctx.lineTo(x, canvasH - PAD); ctx.stroke();
  }

  // Parallel group backgrounds
  Object.entries(groups).forEach(([gid, gevents]) => {
    const gStart = Math.min(...gevents.map(e => e.startMs));
    const gEnd   = Math.max(...gevents.map(e => e.endMs));
    const xStart = LABEL_W + PAD + ((gStart - minMs) / totalMs) * barW;
    const xEnd   = LABEL_W + PAD + ((gEnd   - minMs) / totalMs) * barW;
    const firstIdx = RAW.findIndex(e => e.isParallel && e.parallelGroup === parseInt(gid));
    const lastIdx  = RAW.reduce((acc, e, i) => e.isParallel && e.parallelGroup === parseInt(gid) ? i : acc, firstIdx);
    const yTop    = TICK_H + PAD + firstIdx * ROW_H;
    const yBottom = TICK_H + PAD + (lastIdx + 1) * ROW_H;
    ctx.fillStyle = parallelBg;
    ctx.fillRect(xStart - 2, yTop, (xEnd - xStart) + 4, yBottom - yTop);
    ctx.strokeStyle = 'rgba(86,156,214,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(xStart - 2, yTop, (xEnd - xStart) + 4, yBottom - yTop);
  });

  // Bars
  RAW.forEach((e, i) => {
    const y = TICK_H + PAD + i * ROW_H;
    const xStart = LABEL_W + PAD + ((e.startMs - minMs) / totalMs) * barW;
    const width  = Math.max(2, ((e.endMs - e.startMs) / totalMs) * barW);

    // Label
    const label = (e.command.length > 28 ? e.command.slice(0, 26) + '…' : e.command);
    ctx.fillStyle = textColor;
    ctx.font = '12px ' + (getComputedStyle(document.body).fontFamily || 'monospace');
    ctx.textAlign = 'left';
    ctx.fillText(label, PAD, y + BAR_PAD + BAR_H / 2 + 4);

    // Bar
    const color = !e.ok ? '#f44747' : (e.isParallel ? '#569cd6' : '#4ec9b0');
    ctx.fillStyle = color;
    ctx.beginPath();
    roundRect(ctx, xStart, y + BAR_PAD, width, BAR_H, 3);
    ctx.fill();

    // Duration label inside bar if wide enough
    const dLabel = dur(e.endMs - e.startMs);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.font = '10px ' + (getComputedStyle(document.body).fontFamily || 'monospace');
    ctx.textAlign = 'left';
    if (width > 40) { ctx.fillText(dLabel, xStart + 4, y + BAR_PAD + BAR_H - 4); }
  });

  // Tooltip
  const tip = document.getElementById('tip');
  cv.addEventListener('mousemove', ev => {
    const rect = cv.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const row = Math.floor((my - TICK_H - PAD) / ROW_H);
    if (row < 0 || row >= RAW.length) { tip.style.display = 'none'; return; }
    const e = RAW[row];
    const xStart = LABEL_W + PAD + ((e.startMs - minMs) / totalMs) * barW;
    const width  = Math.max(2, ((e.endMs - e.startMs) / totalMs) * barW);
    if (mx < xStart - 10 || mx > xStart + width + 10) { tip.style.display = 'none'; return; }

    tip.innerHTML =
      '<b>' + esc(e.command) + '</b><br>' +
      (e.ok ? '✅ OK' : '❌ Failed (exit ' + e.code + ')') + '<br>' +
      'Duration: <b>' + dur(e.endMs - e.startMs) + '</b>' +
      (e.isParallel ? '<br>⚡ Parallel group ' + e.parallelGroup : '') +
      (e.output ? '<br><br><span style="opacity:0.7">' + esc(e.output.slice(0,200)) + '</span>' : '');
    tip.style.display = 'block';
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 440) + 'px';
    tip.style.top  = Math.min(ev.clientY + 10, window.innerHeight - 160) + 'px';
  });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

render();
window.addEventListener('resize', render);
</script>
</body>
</html>`;
}
//# sourceMappingURL=extension.js.map