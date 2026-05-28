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
exports.collectFencedBlock = collectFencedBlock;
exports.detectParallelFlag = detectParallelFlag;
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
// v1.0: large refactor.
//   1. Async execution + progress + cancel (replaces execSync).
//   2. CodeLens "Run" / "Dry-run" on every executable list line.
//   3. settings.json (VS Code configuration) with backward-compat for the
//      legacy ~/.code-lc4ri/config.json file.
//   4. Workspace-Trust aware + dangerous-command guard / allow / deny lists.
//   5. Named variables, {$PREV} / {$STATUS} / {$DATE}, "→ {name}" binding,
//      `- assert: ...` directives.
//   6. Status bar profile switcher (extends the OS-keyed `template`).
//   7. Pure helpers are `export`ed so they can be unit-tested.
//   8. HTML/Markdown report export, plus a minimal CLI entry point
//      (bin/code-lc4ri) that reuses the same parser.
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
let activeProfile = ''; // empty string ⇒ legacy `template` is used
const runningProcs = new Set();
const reportEntries = [];
let codeLensEmitter;
/**
 * Tracked current working directory across command executions.
 * `undefined` means "not yet initialised"; will be set on first run to the
 * workspace folder (or process.cwd() as a fallback).  Each subsequent `cd`
 * command updates this value so the next command starts from the same place.
 */
let currentCwd = undefined;
/**
 * Tracked environment variables set via `export VAR=value` commands.
 * These are merged with `process.env` for every subsequent command execution,
 * so that variables exported in one step are visible in later steps — just
 * as they would be in an interactive shell session.
 */
let currentEnv = {};
/**
 * Persistent named and numbered variables set via `cmd → {NAME}` or
 * `1. cmd → {NAME}` bindings.  These survive horizontal-rule boundaries
 * and across multiple `runFromCursor` invocations, mirroring the behaviour
 * of `currentCwd` and `currentEnv`.
 *
 * `$PREV` and `$STATUS` are intentionally NOT persisted here — they reflect
 * the immediately preceding command result and would be misleading if carried
 * across unrelated executions.
 */
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
    ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:', // fork bomb
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
    // ---------- Status bar profile picker --------------------------------
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'extension.lc4ri.switchProfile';
    statusBarItem.tooltip = 'code-lc4ri: switch execution profile';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // ---------- CodeLens --------------------------------------------------
    codeLensEmitter = new vscode.EventEmitter();
    const codeLensProvider = new LC4RICodeLensProvider(codeLensEmitter.event);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'file' }, codeLensProvider), vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'untitled' }, codeLensProvider));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('lc4ri')) {
            codeLensEmitter === null || codeLensEmitter === void 0 ? void 0 : codeLensEmitter.fire();
            updateStatusBar();
        }
    }));
    // ---------- Commands --------------------------------------------------
    context.subscriptions.push(vscode.commands.registerCommand('extension.lc4ri', (_arg) => runFromCursor({ dryRun: false })), vscode.commands.registerCommand('extension.lc4ri.dryRun', () => runFromCursor({ dryRun: true })), vscode.commands.registerCommand('extension.lc4ri.runLine', (uri, line, dryRun) => runSingleLine(uri, line, dryRun === true)), vscode.commands.registerCommand('extension.lc4ri.cancel', cancelAll), vscode.commands.registerCommand('extension.lc4ri.switchProfile', switchProfile), vscode.commands.registerCommand('extension.lc4ri.clearOutput', clearOutputBlock), vscode.commands.registerCommand('extension.lc4ri.exportReport', exportReport), vscode.commands.registerCommand('extension.lc4ri.exportReportMd', () => exportReport('md')), vscode.commands.registerCommand('extension.lc4ri.exportReportHtml', () => exportReport('html')));
    // Ensure the legacy config file is created on first run, like the
    // previous version did.
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
// Configuration loading (settings.json first, legacy file fallback)
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
    try {
        const configPath = legacyConfigPath();
        if (!fs.existsSync(configPath)) {
            return {};
        }
        const raw = fs.readFileSync(configPath, 'utf8');
        const obj = JSON.parse(raw);
        return obj !== null && obj !== void 0 ? obj : {};
    }
    catch (err) {
        outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] legacy config parse error: ${String(err)} — using defaults`);
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
        fs.writeFileSync(file, JSON.stringify({
            timeout: DEFAULT_CONFIG.timeout,
            template: {},
            profiles: {},
            changeWord: {},
            toutf8: true,
            toterminal: false
        }, null, 2), 'utf8');
    }
}
function legacyConfigPath() {
    const home = safeHome();
    if (!home) {
        return '';
    }
    return process.platform === 'win32'
        ? path.join(home, '.code-lc4ri', 'config.json')
        : path.join(home, '.code-lc4ri', 'config.json');
}
function safeHome() {
    try {
        const h = os.homedir();
        if (h && h.length) {
            return h;
        }
    }
    catch (_) { /* ignore */ }
    // last-resort: the previous behaviour of echoing the env var
    try {
        const com = process.platform === 'win32' ? 'echo %USERPROFILE%' : 'echo $HOME';
        const out = (0, child_process_1.execSync)(com).toString().replace(/\r\n|\r|\n/, '');
        return out;
    }
    catch (_) {
        return '';
    }
}
// =============================================================================
// Parsing helpers (pure, exported for tests)
// =============================================================================
/** Match a "- " at depth `cnt` (0 = top-level, 1 = one tab in, ...) */
function regTab(cnt) {
    let s = '^';
    for (let i = 0; i < cnt; i++) {
        s += '\t';
    }
    return s + '- ';
}
/**
 * Default number of spaces that equal one indentation level (= 1 tab).
 * Used by {@link normalizeIndent}.  4 matches VS Code's default `editor.tabSize`
 * and the most common Markdown authoring conventions.
 */
exports.DEFAULT_INDENT_SPACES = 2;
/**
 * Normalise the leading whitespace of a line so that the rest of the parser
 * (which is tab-aware via {@link regTab}) can treat space-indented Markdown
 * the same way as tab-indented Markdown.
 *
 *   "    - foo"  → "\t- foo"    (4 spaces = 1 level)
 *   "  - foo"    → "\t- foo"    (any non-empty indent = at least 1 level)
 *   "        - foo" → "\t\t- foo"  (8 spaces = 2 levels)
 *   "\t- foo"    → "\t- foo"    (already tabbed — unchanged)
 *   "\t  - foo"  → "\t\t- foo"  (mixed)
 *
 * This is what makes the AND-chain example
 *
 *     - CommandA
 *         - RouteA
 *     - RouteB
 *
 * behave the same as if the inner item had been indented with a tab.
 */
function normalizeIndent(line, tabWidth = exports.DEFAULT_INDENT_SPACES) {
    const m = line.match(/^([ \t]*)(.*)$/);
    if (!m) {
        return line;
    }
    const ws = m[1];
    const rest = m[2];
    if (ws.length === 0) {
        return line;
    }
    // Resolve every char to a logical column count.  A tab snaps the column to
    // the next multiple of `tabWidth`, which matches how text editors render.
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
    const tabs = Math.ceil(col / tabWidth);
    return '\t'.repeat(tabs) + rest;
}
/** Markdown horizontal rule? (***, ---, * * *, ...) */
function horizonCheck(line) {
    return /^(?:\*\s?){3,}\s*$/.test(line) || /^(?:-\s?){3,}\s*$/.test(line);
}
/**
 * Unix-style backslash line continuation.
 *
 *   ls \
 *    -la
 *
 * is treated as a single logical command `ls -la`.  Starting from index
 * `startIdx`, this scans forward while the current line ends in `\` (with
 * optional trailing whitespace), strips that trailing backslash, joins the
 * next line (with its leading whitespace removed) using a single space, and
 * returns the merged line plus the number of source lines that were consumed.
 *
 * For lines that do not end with `\`, `consumed` is 1 and `joined` is the
 * original line unchanged.
 */
function joinContinuedLines(lines, startIdx) {
    var _a, _b;
    let line = (_a = lines[startIdx]) !== null && _a !== void 0 ? _a : '';
    let consumed = 1;
    // A trailing backslash counts as a continuation marker.  Even number of
    // trailing backslashes (\\, \\\\) means the user really intended literal
    // backslashes, so we only treat *odd*-count trailing backslashes as a
    // continuation.
    while (hasContinuationBackslash(line) && startIdx + consumed < lines.length) {
        // Strip the trailing "\" *and* any whitespace that immediately
        // precedes it, so that joining always produces a single space
        // between the two halves.
        const stripped = line.replace(/\s*\\\s*$/, '');
        const next = ((_b = lines[startIdx + consumed]) !== null && _b !== void 0 ? _b : '').replace(/^\s+/, '');
        line = stripped + ' ' + next;
        consumed++;
    }
    return { joined: line, consumed };
}
function hasContinuationBackslash(line) {
    const m = line.match(/(\\+)\s*$/);
    if (!m) {
        return false;
    }
    return m[1].length % 2 === 1;
}
/**
 * Detect a list-command line, return its tab depth and command body
 * (without the leading "- "). Returns null when this is not a list line.
 */
function detectListCommand(line) {
    const m = line.match(/^(\t*)- (.*)$/);
    if (!m) {
        return null;
    }
    return { depth: m[1].length, body: m[2] };
}
/** Detect "N. command" where N is 1-9. */
function detectNumbered(line) {
    const m = line.match(/^([1-9])\.\s+(.*)$/);
    if (!m) {
        return null;
    }
    return { idx: m[1], body: m[2] };
}
/**
 * A trailing " → {name}" (or " -> {name}") binds the command's output to a
 * named variable. Return the body without the binder + the captured name.
 */
function extractBinding(body) {
    const m = body.match(/\s*(?:→|->)\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/);
    if (!m) {
        return { body, bindName: null };
    }
    return { body: body.slice(0, m.index), bindName: m[1] };
}
/** `assert: contains "ok"` / `assert: status == 0` / `assert: regex /.../` */
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
/** Parse a .env-style file and return key → value pairs. */
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
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (key) {
            result[key] = val;
        }
    }
    return result;
}
/**
 * Detect a "- write: path" directive line.
 * Returns the tab depth and file path (variables already substituted by the caller).
 */
function parseWriteDirective(line) {
    const m = line.match(/^(\t*)- write:\s+(.+)$/i);
    if (!m) {
        return null;
    }
    return { depth: m[1].length, filePath: m[2].trim() };
}
/**
 * Collect content from a fenced code block (``` or ~~~) starting at `startIdx`.
 * Skips blank lines before the opening fence.
 * Strips up to `fenceIndent` spaces of common leading indentation from each content line.
 * Returns the content string and how many lines were consumed (opening fence through closing fence).
 * Returns `{ content: null, consumed: 0 }` when no valid fence block is found.
 */
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
/** Detect the `[parallel]` flag prefix on a list-command body. */
function detectParallelFlag(body) {
    const m = body.match(/^\[parallel\]\s*/i);
    if (!m) {
        return { body, parallel: false };
    }
    return { body: body.slice(m[0].length), parallel: true };
}
/** Replace {1}-{9}, {name}, and built-ins like {$PREV}. */
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
/** Apply changeWord substitution map. */
function applyChangeWord(line, map) {
    for (const k of Object.keys(map)) {
        // global replacement so multiple #HOME# in one line are all replaced
        const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        line = line.replace(new RegExp(safe, 'g'), map[k]);
    }
    return line;
}
/**
 * Wrap the resolved command with the chosen profile / OS template.
 * Active profile takes precedence; otherwise fall back to per-OS template.
 */
function applyTemplate(cmd, cfg, profile) {
    if (profile && cfg.profiles[profile]) {
        return cfg.profiles[profile].replace('{COMMAND}', cmd);
    }
    if (cfg.template && cfg.template[process.platform]) {
        return cfg.template[process.platform].replace('{COMMAND}', cmd);
    }
    return cmd;
}
// =============================================================================
// Security (allow / deny / dangerous patterns)
// =============================================================================
function matchesAny(s, patterns) {
    for (const p of patterns) {
        try {
            if (new RegExp(p).test(s)) {
                return p;
            }
        }
        catch (_) {
            // bad pattern — ignore but log
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] bad regex skipped: ${p}`);
        }
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
// Async exec (spawn-based) with timeout and cancellation
// =============================================================================
function execAsync(cmd, cfg, token, cwd, onData, env) {
    return new Promise((resolve) => {
        var _a, _b, _c;
        const shellCmd = (_a = cfg.shell) !== null && _a !== void 0 ? _a : (process.platform === 'win32' ? true : '/bin/sh');
        // If cwd is provided but the directory doesn't exist, spawn will throw
        // synchronously and emit an `error` event.  We guard with fs.existsSync
        // to fall back to the parent process's cwd instead.
        let effectiveCwd = cwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) {
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] tracked cwd "${effectiveCwd}" does not exist — falling back to process cwd`);
            effectiveCwd = undefined;
        }
        // Merge tracked exported variables with process.env so that variables
        // set by earlier `export` commands are visible to this child process.
        const effectiveEnv = env && Object.keys(env).length > 0
            ? { ...process.env, ...env }
            : undefined;
        const child = (0, child_process_1.spawn)(cmd, {
            shell: shellCmd,
            windowsHide: true,
            cwd: effectiveCwd,
            ...(effectiveEnv ? { env: effectiveEnv } : {})
        });
        runningProcs.add(child);
        let stdoutBuf = Buffer.alloc(0);
        let stderrBuf = Buffer.alloc(0);
        let timedOut = false;
        let cancelled = false;
        const killAll = (signal = 'SIGTERM') => {
            try {
                child.kill(signal);
            }
            catch (_) { /* ignore */ }
            if (process.platform === 'win32' && child.pid) {
                try {
                    (0, child_process_1.execSync)(`taskkill /pid ${child.pid} /T /F`);
                }
                catch (_) { /* ignore */ }
            }
        };
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            killAll('SIGKILL');
        }, Math.max(0, cfg.timeout));
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => {
            cancelled = true;
            killAll('SIGTERM');
        });
        (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (b) => {
            stdoutBuf = Buffer.concat([stdoutBuf, b]);
            if (onData) {
                onData(b.toString(), false);
            }
        });
        (_c = child.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (b) => {
            stderrBuf = Buffer.concat([stderrBuf, b]);
            if (onData) {
                onData(b.toString(), true);
            }
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({
                stdout: convToUTF(stdoutBuf, cfg),
                stderr: convToUTF(stderrBuf, cfg),
                code: code !== null && code !== void 0 ? code : (signal ? 130 : -1),
                timedOut,
                cancelled
            });
        });
        child.on('error', (err) => {
            var _a;
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({
                stdout: '',
                stderr: String((_a = err.message) !== null && _a !== void 0 ? _a : err),
                code: -1,
                timedOut,
                cancelled
            });
        });
    });
}
function convToUTF(buf, cfg) {
    if (!cfg.toutf8) {
        return buf.toString();
    }
    try {
        const converted = Encoding.convert(buf, {
            from: 'AUTO',
            to: 'UNICODE',
            type: 'string'
        });
        return converted;
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
        catch (_) { /* ignore */ }
    }
    runningProcs.clear();
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine('[lc4ri] all running commands cancelled');
}
// =============================================================================
// Current working directory tracking (feature: `cd` persistence)
// =============================================================================
/**
 * Return the current tracked cwd, initialising it on first call from the
 * VS Code workspace folder (or process.cwd() as a fallback).
 */
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
/** Test-only helper: override the tracked cwd directly. */
function setCurrentCwd(p) {
    currentCwd = p;
}
/**
 * Return the accumulated environment variables set by `export` commands
 * during this session.  These are merged with `process.env` before each
 * child-process launch so that later commands see earlier exports.
 */
function getCurrentEnv() {
    return currentEnv;
}
/** Test-only helper: override the tracked env directly. */
function setCurrentEnv(env) {
    currentEnv = { ...env };
}
/** Return the persistent named/numbered variable store (test helper). */
function getPersistentVars() {
    return { num: { ...persistentVars.num }, named: { ...persistentVars.named } };
}
/** Override the persistent variable store directly (test helper). */
function setPersistentVars(v) {
    persistentVars = { num: { ...v.num }, named: { ...v.named } };
}
/**
 * Detect whether the resolved command is "purely" an `export` invocation —
 * meaning it has no shell control operators (&&, ||, ;, |) and consists only
 * of one or more `export VAR=value` (or `export VAR`) assignments.
 *
 * Examples that match:
 *   `export FOO=bar`
 *   `export FOO=bar BAZ=qux`
 *   `export PATH=/usr/local/bin:$PATH`
 *   `export MY_VAR`          (re-export without value — retained as-is)
 *
 * Examples that do NOT match:
 *   `export FOO=bar && echo $FOO`
 *   `echo hi; export X=1`
 *   `unset FOO`
 */
function isPureExportCommand(cmd) {
    const trimmed = cmd.trim();
    if (!/^export(\s|$)/.test(trimmed)) {
        return false;
    }
    // Reject if shell control operators appear outside of quoted strings.
    let inSingle = false;
    let inDouble = false;
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
        if (c === ';' || c === '|' || c === '&') {
            return false;
        }
        if (c === '>' || c === '<') {
            return false;
        }
    }
    return true;
}
/**
 * Parse a pure `export` command and return the key-value pairs it defines.
 * Uses a real shell (via the existing execAsync infrastructure) to expand
 * variable references like `export PATH=/usr/local/bin:$PATH` correctly.
 *
 * Strategy: run `<exportCmd> && env` in the current environment so that the
 * shell performs all expansions, then diff the output against the process env
 * to find the newly exported names (we only track names that appear explicitly
 * in the export command, not transitive side-effects).
 */
async function resolveExport(exportCmd, cfg, token) {
    const baseCwd = getCurrentCwd();
    // Merge already-tracked exports into the environment for the resolution
    // so that chained exports (`export B=$A` after `export A=1`) work.
    const baseEnv = Object.keys(currentEnv).length > 0
        ? { ...process.env, ...currentEnv }
        : undefined;
    // We run: <exportCmd> && env
    // and parse the resulting env dump to find the keys that changed.
    const probeCmd = `${exportCmd} && env`;
    // Build a temporary execAsync call that accepts an explicit env map.
    const res = await new Promise((resolve) => {
        var _a, _b, _c;
        const shellCmd = (_a = cfg.shell) !== null && _a !== void 0 ? _a : (process.platform === 'win32' ? true : '/bin/sh');
        let effectiveCwd = baseCwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) {
            effectiveCwd = undefined;
        }
        const child = (0, child_process_1.spawn)(probeCmd, {
            shell: shellCmd,
            windowsHide: true,
            cwd: effectiveCwd,
            ...(baseEnv ? { env: baseEnv } : {})
        });
        runningProcs.add(child);
        let stdoutBuf = Buffer.alloc(0);
        let stderrBuf = Buffer.alloc(0);
        let timedOut = false;
        let cancelled = false;
        const killAll = (signal = 'SIGTERM') => {
            try {
                child.kill(signal);
            }
            catch (_) { /* ignore */ }
        };
        const timeoutTimer = setTimeout(() => { timedOut = true; killAll('SIGKILL'); }, Math.max(0, cfg.timeout));
        const cancelSub = token === null || token === void 0 ? void 0 : token.onCancellationRequested(() => { cancelled = true; killAll('SIGTERM'); });
        (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.on('data', (b) => { stdoutBuf = Buffer.concat([stdoutBuf, b]); });
        (_c = child.stderr) === null || _c === void 0 ? void 0 : _c.on('data', (b) => { stderrBuf = Buffer.concat([stderrBuf, b]); });
        child.on('close', (code, signal) => {
            clearTimeout(timeoutTimer);
            cancelSub === null || cancelSub === void 0 ? void 0 : cancelSub.dispose();
            runningProcs.delete(child);
            resolve({ stdout: convToUTF(stdoutBuf, cfg), stderr: convToUTF(stderrBuf, cfg),
                code: code !== null && code !== void 0 ? code : (signal ? 130 : -1), timedOut, cancelled });
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
        return {
            ok: false,
            vars: {},
            output: (res.stderr || res.stdout || `export failed (exit ${res.code})`).replace(/\r?\n+$/, '')
        };
    }
    // Parse the `env` dump.  Lines may be multi-line if a value contains \n,
    // so we use a simple state machine: a new var starts when we see "KEY=".
    const envDump = {};
    let currentKey = null;
    let currentVal = [];
    for (const rawLine of res.stdout.split(/\r?\n/)) {
        const eqIdx = rawLine.indexOf('=');
        // A valid env key contains only word chars — use that to detect new entries.
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
    // Extract the variable names explicitly listed in the export command.
    // Pattern: export [NAME | NAME=...] ...
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
    const summary = Object.entries(captured)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    return { ok: true, vars: captured, output: summary || '(no variables captured)' };
}
/**
 * Detect whether the resolved command is "purely" a `cd` invocation —
 * meaning it has no shell control operators (&&, ||, ;, |) and starts with cd.
 * Examples that match:
 *   `cd`
 *   `cd /tmp`
 *   `cd "with spaces"`
 *   `cd ../foo`
 *   `cd -`
 * Examples that do NOT match:
 *   `cd foo && ls`
 *   `cd foo; ls`
 *   `ls && cd foo`
 */
function isPureCdCommand(cmd) {
    const trimmed = cmd.trim();
    if (!/^cd(\s|$)/.test(trimmed)) {
        return false;
    }
    // No shell control operators outside of (single/double) quoted strings.
    let inSingle = false;
    let inDouble = false;
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
        if (c === ';' || c === '|' || c === '&') {
            return false;
        }
        if (c === '>' || c === '<') {
            return false;
        }
    }
    return true;
}
/**
 * Resolve a pure `cd` command using a real shell so that `~`, env vars,
 * `cd -`, relative paths, etc. work exactly as the user expects.  The current
 * tracked cwd is used as the base directory for the resolution.
 */
async function resolveCd(cdCmd, cfg, token) {
    var _a;
    const baseCwd = getCurrentCwd();
    const printPwd = process.platform === 'win32' ? 'cd' : 'pwd';
    const fullCmd = `${cdCmd} && ${printPwd}`;
    const res = await execAsync(fullCmd, cfg, token, baseCwd, undefined, currentEnv);
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return {
            ok: false,
            output: (res.stderr || res.stdout || `cd failed (exit ${res.code})`).replace(/\r?\n+$/, '')
        };
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
            execCount: 0,
            execFlag: false,
            horizonFlag: -1,
            startLine: 0,
            endLine: 0,
            nowLine: position.line,
            assertionFailed: false
        };
        await runLines(lines, ctx);
        if (ctx.execFlag) {
            await writeBackOutput(editor, doc, ctx);
        }
    });
}
async function runLines(lines, ctx) {
    for (let i = 0; i < lines.length; i++) {
        if (ctx.token.isCancellationRequested) {
            Object.assign(persistentVars.num, ctx.vars.num);
            Object.assign(persistentVars.named, ctx.vars.named);
            break;
        }
        // ---- Unix backslash line continuation ----------------------------
        // If a list/numbered command line ends with "\", merge subsequent
        // continuation lines into a single logical line before the rest of
        // the parser sees it.  We must also advance i and ctx.nowLine for the
        // extra lines we just consumed, because the outer for-loop only
        // increments them once per iteration.
        const cont = joinContinuedLines(lines, i);
        let line = cont.joined;
        if (cont.consumed > 1) {
            i += cont.consumed - 1;
            ctx.nowLine += cont.consumed - 1;
        }
        // ---- Normalise indentation (space → tab) -----------------------
        // The downstream depth check uses tab-aware regexes via regTab(); by
        // converting leading spaces to tab-equivalent levels here, the same
        // AND-chain logic applies regardless of whether the author indented
        // the inner list item with tabs or spaces.
        line = normalizeIndent(line);
        if (horizonCheck(line)) {
            ctx.horizonFlag = ctx.nowLine;
            Object.assign(persistentVars.num, ctx.vars.num);
            Object.assign(persistentVars.named, ctx.vars.named);
            break;
        }
        // Env file directive: # env: <path>
        const envMatch = line.match(/^#\s*env:\s*(.+)$/);
        if (envMatch) {
            const envPath = envMatch[1].trim();
            const resolved = path.isAbsolute(envPath) ? envPath : path.join(getCurrentCwd(), envPath);
            try {
                const content = fs.readFileSync(resolved, 'utf8');
                const envVars = parseEnvFile(content);
                Object.assign(ctx.vars.named, envVars);
                outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] loaded env: ${resolved} (${Object.keys(envVars).length} vars)`);
            }
            catch (_) {
                outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] env file not found: ${resolved}`);
            }
            ctx.nowLine++;
            continue;
        }
        // 1. number-list creates {N}
        const numHit = detectNumbered(line);
        if (numHit) {
            await handleNumberedAssignment(numHit, ctx);
        }
        // expand variables ({N}, {name}, {$PREV} ...)
        line = substituteVars(line, ctx.vars);
        line = applyChangeWord(line, ctx.cfg.changeWord);
        // write: directive — write fenced block content to a file
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
            const resolved = path.isAbsolute(filePath)
                ? filePath
                : path.join(getCurrentCwd(), filePath);
            ctx.execFlag = true;
            const header = `\n[ write: ${filePath} ] ${getDate()}\n`;
            if (blk.content === null) {
                ctx.consoles += header + `(no fenced block found after write:)\n`;
                ctx.execCount = 0;
            }
            else if (ctx.dryRun) {
                const n = blk.content.split('\n').length;
                ctx.consoles += header + `[dry-run] would write ${n} line${n !== 1 ? 's' : ''} to ${resolved}\n`;
                i += blk.consumed;
                ctx.nowLine += blk.consumed;
                ctx.execCount = depth + 1;
            }
            else {
                try {
                    fs.mkdirSync(path.dirname(resolved), { recursive: true });
                    fs.writeFileSync(resolved, blk.content + '\n', 'utf8');
                    const n = blk.content.split('\n').length;
                    ctx.consoles += header + `wrote ${n} line${n !== 1 ? 's' : ''} to ${resolved}\n`;
                    pushReport({
                        command: `write: ${filePath}`, rendered: `write: ${filePath}`,
                        output: `wrote ${n} line(s) to ${resolved}`, code: 0, ts: getDate(), ok: true
                    });
                    i += blk.consumed;
                    ctx.nowLine += blk.consumed;
                    ctx.execCount = depth + 1;
                }
                catch (err) {
                    ctx.consoles += header + `error: ${String(err)}\n`;
                    pushReport({
                        command: `write: ${filePath}`, rendered: `write: ${filePath}`,
                        output: String(err), code: 1, ts: getDate(), ok: false
                    });
                    ctx.execCount = 0;
                }
            }
            ctx.nowLine++;
            continue;
        }
        // - assert: ... support inside an indented chain
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
            if (isFenceLine(line)) { /* never */ }
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
                // Sync vars before breaking so the final command's results persist.
                Object.assign(persistentVars.num, ctx.vars.num);
                Object.assign(persistentVars.named, ctx.vars.named);
                break;
            }
        }
        // Sync named/numbered variables into persistent store so they survive
        // horizontal-rule boundaries and subsequent runFromCursor invocations.
        Object.assign(persistentVars.num, ctx.vars.num);
        Object.assign(persistentVars.named, ctx.vars.named);
        ctx.nowLine++;
    }
}
function isFenceLine(s) { return /^```/.test(s); }
async function handleNumberedAssignment(hit, ctx) {
    var _a;
    const { body, bindName } = extractBinding(hit.body);
    const cmd = applyChangeWord(substituteVars(body, ctx.vars), ctx.cfg.changeWord);
    const finalCmd = applyTemplate(cmd, ctx.cfg, ctx.profile);
    const sec = checkSecurity(finalCmd, ctx.cfg);
    if (!sec.ok) {
        ctx.vars.num[hit.idx] = `(blocked: ${(_a = sec.reason) !== null && _a !== void 0 ? _a : 'security'})`;
        outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] blocked: ${finalCmd} (${sec.reason})`);
        return;
    }
    if (sec.dangerous && ctx.cfg.confirmDangerous && !ctx.dryRun) {
        const ok = await confirmDangerous(finalCmd, sec.dangerous);
        if (!ok) {
            ctx.vars.num[hit.idx] = '(cancelled by user)';
            return;
        }
    }
    if (ctx.dryRun) {
        const dry = `[dry-run] ${finalCmd}`;
        ctx.vars.num[hit.idx] = dry;
        if (bindName) {
            ctx.vars.named[bindName] = dry;
        }
        return;
    }
    // Pure cd: update tracked cwd, bind the resulting path to the variable
    if (isPureCdCommand(finalCmd)) {
        ctx.progress.report({ message: `cd: ${finalCmd}` });
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd;
            ctx.vars.num[hit.idx] = currentCwd;
            if (bindName) {
                ctx.vars.named[bindName] = currentCwd;
            }
            ctx.vars.prev = currentCwd;
            ctx.vars.status = 0;
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: `cwd changed to ${currentCwd}`,
                code: 0, ts: getDate(), ok: true
            });
        }
        else {
            ctx.vars.num[hit.idx] = `(cd failed: ${cdRes.output})`;
            if (bindName) {
                ctx.vars.named[bindName] = ctx.vars.num[hit.idx];
            }
            ctx.vars.status = 1;
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: cdRes.output, code: 1, ts: getDate(), ok: false
            });
        }
        return;
    }
    // Pure export: capture env vars for subsequent commands
    if (isPureExportCommand(finalCmd)) {
        ctx.progress.report({ message: `export: ${finalCmd}` });
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.vars.num[hit.idx] = expRes.output;
            if (bindName) {
                ctx.vars.named[bindName] = expRes.output;
            }
            ctx.vars.prev = expRes.output;
            ctx.vars.status = 0;
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] export: ${expRes.output}`);
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: expRes.output, code: 0, ts: getDate(), ok: true
            });
        }
        else {
            ctx.vars.num[hit.idx] = `(export failed: ${expRes.output})`;
            if (bindName) {
                ctx.vars.named[bindName] = ctx.vars.num[hit.idx];
            }
            ctx.vars.status = 1;
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: expRes.output, code: 1, ts: getDate(), ok: false
            });
        }
        return;
    }
    ctx.progress.report({ message: `setting {${hit.idx}}: ${finalCmd}` });
    const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), (chunk, isStderr) => outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(isStderr ? `[stderr] ${chunk}` : chunk), currentEnv);
    const trimmed = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
    ctx.vars.num[hit.idx] = trimmed;
    if (bindName) {
        ctx.vars.named[bindName] = trimmed;
    }
    ctx.vars.prev = res.stdout;
    ctx.vars.status = res.code;
    pushReport({
        command: finalCmd, rendered: finalCmd,
        output: trimmed, code: res.code,
        ts: getDate(),
        ok: res.code === 0 && !res.timedOut && !res.cancelled
    });
}
async function runOneCommand(rawLine, depth, ctx) {
    var _a, _b;
    const stripRe = new RegExp(regTab(depth));
    const rawBody = rawLine.replace(stripRe, '');
    const { body: noParallelBody } = detectParallelFlag(rawBody);
    const { body: cleanBody, bindName } = extractBinding(noParallelBody);
    // runbook include: "include: path/to/other.md"
    if (/^include:\s+/i.test(noParallelBody)) {
        const includePath = noParallelBody.replace(/^include:\s+/i, '').trim();
        await runInclude(includePath, ctx);
        ctx.execFlag = true;
        ctx.execCount = depth + 1;
        return;
    }
    // file open in new tab: "open: path"
    if (/^open:\s+/i.test(cleanBody)) {
        const fname = cleanBody.replace(/^open:\s+/i, '').trim();
        await openFileTab(fname);
        ctx.execFlag = true;
        ctx.execCount = depth + 1;
        return;
    }
    // terminal passthrough: "! command"  (sends to active terminal, no output capture)
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
        const ok = await confirmDangerous(finalCmd, sec.dangerous);
        if (!ok) {
            ctx.consoles += '(cancelled by user)\n';
            ctx.execCount = 0;
            return;
        }
    }
    if (ctx.dryRun) {
        ctx.consoles += `[dry-run] ${finalCmd}\n`;
        if (isPureCdCommand(finalCmd)) {
            ctx.consoles += `(dry-run: cwd would be resolved from "${getCurrentCwd()}")\n`;
        }
        if (isPureExportCommand(finalCmd)) {
            ctx.consoles += `(dry-run: environment variable would be exported)\n`;
        }
        ctx.execCount = depth + 1;
        return;
    }
    // When the user enabled toTerminal we still want the command to appear in
    // the terminal panel for visibility, but the post-execution output must
    // also be written back to the Markdown buffer.  We therefore mirror the
    // command into the terminal here, then continue with the regular spawn
    // execution below so that stdout/stderr can be captured.
    if (ctx.cfg.toterminal) {
        (_b = vscode.window.activeTerminal) === null || _b === void 0 ? void 0 : _b.sendText(finalCmd);
        ctx.consoles += `(sent to terminal)\n`;
    }
    // ---- Pure `cd` command: update tracked cwd without running it twice. ----
    if (isPureCdCommand(finalCmd)) {
        ctx.progress.report({ message: `cd: ${finalCmd}` });
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd;
            ctx.consoles += `(cwd → ${currentCwd})\n`;
            ctx.vars.prev = currentCwd;
            ctx.vars.status = 0;
            if (bindName) {
                ctx.vars.named[bindName] = currentCwd;
            }
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: `cwd changed to ${currentCwd}`,
                code: 0, ts: getDate(), ok: true
            });
            ctx.execCount = depth + 1;
        }
        else {
            ctx.consoles += `${cdRes.output}\n[cd failed]\n`;
            ctx.vars.status = 1;
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: cdRes.output,
                code: 1, ts: getDate(), ok: false
            });
            ctx.execCount = 0;
        }
        return;
    }
    // ---- Pure `export` command: capture env vars for subsequent commands. ----
    if (isPureExportCommand(finalCmd)) {
        ctx.progress.report({ message: `export: ${finalCmd}` });
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.consoles += `(env → ${expRes.output})\n`;
            ctx.vars.prev = expRes.output;
            ctx.vars.status = 0;
            if (bindName) {
                ctx.vars.named[bindName] = expRes.output;
            }
            outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] export: ${expRes.output}`);
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: expRes.output, code: 0, ts: getDate(), ok: true
            });
            ctx.execCount = depth + 1;
        }
        else {
            ctx.consoles += `${expRes.output}\n[export failed]\n`;
            ctx.vars.status = 1;
            pushReport({
                command: finalCmd, rendered: finalCmd,
                output: expRes.output, code: 1, ts: getDate(), ok: false
            });
            ctx.execCount = 0;
        }
        return;
    }
    ctx.progress.report({ message: finalCmd });
    const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), (chunk, isStderr) => outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.append(isStderr ? `[stderr] ${chunk}` : chunk), currentEnv);
    const out = res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : '');
    ctx.consoles += out;
    if (res.timedOut) {
        ctx.consoles += `\n[timeout after ${ctx.cfg.timeout}ms]\n`;
    }
    if (res.cancelled) {
        ctx.consoles += `\n[cancelled]\n`;
    }
    if (res.code !== 0 && !res.cancelled && !res.timedOut) {
        ctx.consoles += `\n[exit ${res.code}]\n`;
    }
    ctx.vars.prev = res.stdout;
    ctx.vars.status = res.code;
    if (bindName) {
        ctx.vars.named[bindName] = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
    }
    pushReport({
        command: finalCmd, rendered: finalCmd,
        output: out, code: res.code,
        ts: getDate(),
        ok: res.code === 0 && !res.timedOut && !res.cancelled
    });
    if (res.code === 0 && !res.timedOut && !res.cancelled) {
        ctx.execCount = depth + 1;
    }
    else {
        ctx.execCount = 0;
    }
}
async function runInclude(includePath, ctx) {
    const resolved = path.isAbsolute(includePath)
        ? includePath
        : path.join(getCurrentCwd(), includePath);
    if (!fs.existsSync(resolved)) {
        ctx.consoles += `\n[include: file not found: ${resolved}]\n`;
        return;
    }
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] including: ${resolved}`);
    ctx.consoles += `\n[ include: ${resolved} ] ${getDate()}\n`;
    let content;
    try {
        content = fs.readFileSync(resolved, 'utf8');
    }
    catch (err) {
        ctx.consoles += `\n[include: read error: ${String(err)}]\n`;
        return;
    }
    const includedLines = content.split(/\r?\n/);
    const subCtx = {
        ...ctx,
        consoles: '',
        execCount: 0,
        execFlag: false,
        horizonFlag: -1,
        startLine: 0,
        endLine: 0,
        nowLine: 0,
        assertionFailed: false
    };
    await runLines(includedLines, subCtx);
    ctx.consoles += subCtx.consoles;
    ctx.vars = subCtx.vars;
    ctx.execFlag = ctx.execFlag || subCtx.execFlag;
}
async function runParallelGroup(rawLines, depth, ctx) {
    ctx.execFlag = true;
    const depthRe = new RegExp(regTab(depth));
    const tasks = rawLines.map(async (rawLine) => {
        const rawBody = rawLine.replace(depthRe, '');
        const { body: noParallelBody } = detectParallelFlag(rawBody);
        const { body: cleanBody, bindName } = extractBinding(noParallelBody);
        const substituted = substituteVars(cleanBody, ctx.vars);
        const afterChange = applyChangeWord(substituted, ctx.cfg.changeWord);
        const finalCmd = applyTemplate(afterChange, ctx.cfg, ctx.profile);
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
        const out = res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : '');
        let suffix = '';
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
        pushReport({ command: finalCmd, rendered: finalCmd, output: out + suffix, code: res.code, ts: getDate(), ok });
        return { header, output: out + suffix, ok, bindName, bindVal };
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
    const bodyForCheck = firstLine.replace(depthRe, '');
    const { parallel } = detectParallelFlag(bodyForCheck);
    if (!parallel) {
        await runOneCommand(firstLine, depth, ctx);
        return { newIdx: curIdx, extraNowLine: 0 };
    }
    const parallelLines = [firstLine];
    let j = curIdx + 1;
    let extraNowLine = 0;
    while (j < lines.length && !ctx.token.isCancellationRequested) {
        const nextCont = joinContinuedLines(lines, j);
        const nextLine = normalizeIndent(nextCont.joined);
        if (horizonCheck(nextLine)) {
            break;
        }
        if (!depthRe.test(nextLine)) {
            break;
        }
        const nextBody = nextLine.replace(depthRe, '');
        const { parallel: nextParallel } = detectParallelFlag(nextBody);
        if (!nextParallel) {
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
        vscode.window.showWarningMessage(`code-lc4ri: cannot resolve "${fname}" — no workspace open.`);
        return;
    }
    const fullPath = path.isAbsolute(fname) ? fname : path.join(folder.uri.fsPath, fname);
    try {
        const uri = vscode.Uri.file(fullPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    }
    catch (err) {
        vscode.window.showWarningMessage(`code-lc4ri: cannot open "${fname}": ${String(err)}`);
    }
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
// write back: same wrap-in-fences semantics as the original
// -----------------------------------------------------------------------------
async function writeBackOutput(editor, doc, ctx) {
    let body = ctx.consoles;
    let startLine = ctx.startLine;
    let endLine = ctx.endLine;
    if (startLine === 0 && endLine === 0) {
        if (ctx.horizonFlag > -1) {
            startLine = ctx.horizonFlag - 1;
            endLine = ctx.horizonFlag;
        }
        else {
            startLine = doc.lineCount - 1;
            endLine = doc.lineCount;
        }
        if (ctx.cfg.outputFormat === 'collapsible') {
            body = `\n<details><summary>output ${getDate()}</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>\n`;
        }
        else {
            body = `\n\`\`\`\n${body}\n\`\`\`\n`;
        }
    }
    const startPos = new vscode.Position(startLine + 1, 0);
    const endPos = new vscode.Position(Math.max(0, endLine - 1), 10000);
    const sel = new vscode.Selection(startPos, endPos);
    await editor.edit(edit => { edit.replace(sel, body); });
}
// =============================================================================
// runSingleLine: invoked by the CodeLens "▶ Run" / "Dry-run" actions
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
    // Move cursor onto the requested line, then re-use runFromCursor.
    const pos = new vscode.Position(line, 0);
    newEditor.selection = new vscode.Selection(pos, pos);
    await runFromCursor({ dryRun });
}
// =============================================================================
// CodeLens provider
// =============================================================================
class LC4RICodeLensProvider {
    constructor(emitter) {
        this.onDidChangeCodeLenses = emitter;
    }
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
                lenses.push(new vscode.CodeLens(range, {
                    title: '▶ Run',
                    command: 'extension.lc4ri.runLine',
                    arguments: [doc.uri, i, false]
                }));
                lenses.push(new vscode.CodeLens(range, {
                    title: 'Dry-run',
                    command: 'extension.lc4ri.runLine',
                    arguments: [doc.uri, i, true]
                }));
            }
        }
        return lenses;
    }
}
// =============================================================================
// Status bar / profile switcher
// =============================================================================
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    const cfg = readConfig();
    const profileNames = Object.keys(cfg.profiles);
    const label = activeProfile
        ? `$(terminal) lc4ri: ${activeProfile}`
        : (profileNames.length ? '$(terminal) lc4ri: (none)' : '$(terminal) lc4ri');
    statusBarItem.text = label;
}
async function switchProfile() {
    const cfg = readConfig();
    const items = [
        { label: '(none)', description: 'use legacy OS-keyed template only' },
        ...Object.keys(cfg.profiles).map(k => ({ label: k, description: cfg.profiles[k] }))
    ];
    const pick = await vscode.window.showQuickPick(items, {
        title: 'code-lc4ri: switch execution profile',
        placeHolder: activeProfile || '(none)'
    });
    if (!pick) {
        return;
    }
    activeProfile = pick.label === '(none)' ? '' : pick.label;
    updateStatusBar();
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[lc4ri] active profile -> ${activeProfile || '(none)'}`);
}
// =============================================================================
// Misc commands
// =============================================================================
async function clearOutputBlock() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const doc = editor.document;
    const cursor = editor.selection.active.line;
    // find the nearest ``` ... ``` block that contains or follows the cursor
    let start = -1, end = -1;
    for (let i = cursor; i < doc.lineCount; i++) {
        if (/^```/.test(doc.lineAt(i).text)) {
            start = i;
            break;
        }
    }
    if (start === -1) {
        return;
    }
    for (let i = start + 1; i < doc.lineCount; i++) {
        if (/^```/.test(doc.lineAt(i).text)) {
            end = i;
            break;
        }
    }
    if (end === -1) {
        return;
    }
    const range = new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, doc.lineAt(end).text.length));
    await editor.edit(b => b.replace(range, '```\n```'));
}
function getDate() {
    return new Date(Date.now()).toString();
}
function pushReport(entry) {
    reportEntries.push(entry);
    outputChannel === null || outputChannel === void 0 ? void 0 : outputChannel.appendLine(`[${entry.ts}] (${entry.ok ? 'ok' : 'NG'} code=${entry.code}) ${entry.command}`);
}
// =============================================================================
// Export report  (Markdown / HTML)
// =============================================================================
async function exportReport(kind = 'html') {
    var _a;
    if (reportEntries.length === 0) {
        vscode.window.showInformationMessage('code-lc4ri: nothing to export yet.');
        return;
    }
    const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
    const dir = folder ? folder.uri.fsPath : os.tmpdir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = path.join(dir, `lc4ri-report-${stamp}.${kind}`);
    const body = kind === 'md' ? buildMarkdownReport() : buildHtmlReport();
    fs.writeFileSync(fname, body, 'utf8');
    const open = await vscode.window.showInformationMessage(`code-lc4ri: report saved to ${fname}`, 'Open');
    if (open === 'Open') {
        const doc = await vscode.workspace.openTextDocument(fname);
        await vscode.window.showTextDocument(doc);
    }
}
function buildMarkdownReport() {
    let s = `# code-lc4ri execution report\n\n`;
    s += `- generated: ${new Date().toISOString()}\n`;
    s += `- profile:   ${activeProfile || '(none)'}\n`;
    s += `- host:      ${os.hostname()}\n`;
    s += `- user:      ${os.userInfo().username}\n\n`;
    for (const e of reportEntries) {
        s += `## ${e.ok ? '✅' : '❌'} ${e.command}\n\n`;
        s += `- at: ${e.ts}\n- exit: ${e.code}\n\n\`\`\`\n${e.output}\n\`\`\`\n\n`;
    }
    return s;
}
function buildHtmlReport() {
    const rows = reportEntries.map(e => `
        <section class="${e.ok ? 'ok' : 'ng'}">
            <h3>${escapeHtml(e.command)}</h3>
            <p class="meta">at ${escapeHtml(e.ts)} — exit ${e.code}</p>
            <pre>${escapeHtml(e.output)}</pre>
        </section>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>lc4ri report</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:920px;margin:2em auto;padding:0 1em;}
  h1{border-bottom:1px solid #ccc;}
  section{border-left:4px solid #aaa;margin:1em 0;padding:0.5em 1em;}
  section.ok{border-color:#3a3;background:#f3fbf3;}
  section.ng{border-color:#c33;background:#fbf3f3;}
  pre{background:#111;color:#eee;padding:1em;overflow:auto;}
  .meta{color:#666;font-size:0.9em;}
</style></head><body>
<h1>code-lc4ri execution report</h1>
<p><b>generated:</b> ${escapeHtml(new Date().toISOString())}<br>
<b>profile:</b> ${escapeHtml(activeProfile || '(none)')}<br>
<b>host:</b> ${escapeHtml(os.hostname())}<br>
<b>user:</b> ${escapeHtml(os.userInfo().username)}</p>
${rows}
</body></html>`;
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
//# sourceMappingURL=extension.js.map