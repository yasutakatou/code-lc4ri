"use strict";
// =============================================================================
// code-lc4ri — Markdown + LC4RI for VS Code
// -----------------------------------------------------------------------------
// v1.4: Added ① Variable Inspector Panel, ② Execution History Browser,
//        ③ Collapsible Output with Search, ④ Execution Timeline (waterfall).
// =============================================================================

import * as vscode from 'vscode';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as Encoding from 'encoding-japanese';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LC4RIConfig {
    timeout: number;
    template: { [k: string]: string };
    profiles: { [k: string]: string };
    changeWord: { [k: string]: string };
    toutf8: boolean;
    toterminal: boolean;
    outputFormat: 'codeblock' | 'collapsible';
    dangerousPatterns: string[];
    allowList: string[];
    denyList: string[];
    confirmDangerous: boolean;
    showCodeLens: boolean;
    shell: string | null;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
    timedOut: boolean;
    cancelled: boolean;
}

export interface Variables {
    num: { [k: string]: string };
    named: { [k: string]: string };
    prev: string;
    status: number;
}

interface ReportEntry {
    command: string;
    rendered: string;
    output: string;
    code: number;
    ts: string;
    ok: boolean;
    // ④ Timeline: execution timing information
    startMs: number;
    endMs: number;
    isParallel: boolean;
    parallelGroup: number;
}

// ② History Browser: session-level history entry
interface HistorySession {
    id: string;
    startTs: string;
    endTs: string;
    profile: string;
    runbookFile: string;
    entries: ReportEntry[];
    totalOk: number;
    totalFail: number;
}

// -----------------------------------------------------------------------------
// Module-level state
// -----------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let activeProfile: string = '';
const runningProcs = new Set<ChildProcess>();
const reportEntries: ReportEntry[] = [];
let codeLensEmitter: vscode.EventEmitter<void> | undefined;
let currentCwd: string | undefined = undefined;
let currentEnv: Record<string, string> = {};

let persistentVars: { num: Record<string, string>; named: Record<string, string> } = {
    num: {},
    named: {}
};

// ① Variable Inspector Panel
let varInspectorPanel: vscode.WebviewPanel | undefined;
let varInspectorEmitter: vscode.EventEmitter<void> | undefined;

// ② Execution History Browser
let historyPanel: vscode.WebviewPanel | undefined;
const historySessions: HistorySession[] = [];
let currentSession: HistorySession | undefined;
const HISTORY_FILE_NAME = '.lc4ri-history.json';

// ④ Timeline: parallel group counter
let parallelGroupCounter = 0;

// -----------------------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------------------

export const DEFAULT_DANGEROUS_PATTERNS: string[] = [
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

const DEFAULT_CONFIG: LC4RIConfig = {
    timeout: 10000,
    template: {},
    profiles: {},
    changeWord: {},
    toutf8: true,
    toterminal: false,
    outputFormat: 'codeblock',
    dangerousPatterns: DEFAULT_DANGEROUS_PATTERNS,
    allowList: [],
    denyList: [],
    confirmDangerous: true,
    showCodeLens: true,
    shell: null
};

// =============================================================================
// Activate / Deactivate
// =============================================================================

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('code-lc4ri');
    outputChannel.appendLine(`[lc4ri] activated at ${new Date().toISOString()}`);

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'extension.lc4ri.switchProfile';
    statusBarItem.tooltip = 'code-lc4ri: switch execution profile';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    codeLensEmitter = new vscode.EventEmitter<void>();
    varInspectorEmitter = new vscode.EventEmitter<void>();

    const codeLensProvider = new LC4RICodeLensProvider(codeLensEmitter.event);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'file' }, codeLensProvider),
        vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'untitled' }, codeLensProvider)
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('lc4ri')) {
                codeLensEmitter?.fire();
                updateStatusBar();
            }
        })
    );

    // Load persisted history on activation
    loadHistory(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.lc4ri', (_arg?: unknown) => runFromCursor({ dryRun: false })),
        vscode.commands.registerCommand('extension.lc4ri.dryRun', () => runFromCursor({ dryRun: true })),
        vscode.commands.registerCommand('extension.lc4ri.runLine', (uri: vscode.Uri, line: number, dryRun?: boolean) => runSingleLine(uri, line, dryRun === true)),
        vscode.commands.registerCommand('extension.lc4ri.cancel', cancelAll),
        vscode.commands.registerCommand('extension.lc4ri.switchProfile', switchProfile),
        vscode.commands.registerCommand('extension.lc4ri.clearOutput', clearOutputBlock),
        vscode.commands.registerCommand('extension.lc4ri.exportReport', exportReport),
        vscode.commands.registerCommand('extension.lc4ri.exportReportMd', () => exportReport('md')),
        vscode.commands.registerCommand('extension.lc4ri.exportReportHtml', () => exportReport('html')),
        // ① Variable Inspector
        vscode.commands.registerCommand('extension.lc4ri.showVarInspector', () => showVarInspector(context)),
        // ② History Browser
        vscode.commands.registerCommand('extension.lc4ri.showHistory', () => showHistoryBrowser(context)),
        vscode.commands.registerCommand('extension.lc4ri.clearHistory', () => clearHistory(context)),
        // ③ Output block search
        vscode.commands.registerCommand('extension.lc4ri.searchOutput', searchOutputBlock),
        // ④ Timeline
        vscode.commands.registerCommand('extension.lc4ri.showTimeline', () => showTimeline(context))
    );

    try { ensureLegacyConfigFile(); } catch (e) {
        outputChannel.appendLine(`[lc4ri] legacy config init skipped: ${String(e)}`);
    }
}

export function deactivate() {
    cancelAll();
    outputChannel?.dispose();
    statusBarItem?.dispose();
    codeLensEmitter?.dispose();
    varInspectorEmitter?.dispose();
    varInspectorPanel?.dispose();
    historyPanel?.dispose();
    currentEnv = {};
    persistentVars = { num: {}, named: {} };
}

// =============================================================================
// Configuration loading
// =============================================================================
export function readConfig(): LC4RIConfig {
    const ws = vscode.workspace.getConfiguration('lc4ri');
    const legacy = readLegacyConfig();
    const merged: LC4RIConfig = {
        timeout:           ws.get<number>('timeout',           legacy.timeout            ?? DEFAULT_CONFIG.timeout),
        template:          ws.get<{[k:string]:string}>('template', legacy.template       ?? DEFAULT_CONFIG.template),
        profiles:          ws.get<{[k:string]:string}>('profiles', legacy.profiles       ?? DEFAULT_CONFIG.profiles),
        changeWord:        ws.get<{[k:string]:string}>('changeWord', legacy.changeWord   ?? DEFAULT_CONFIG.changeWord),
        toutf8:            ws.get<boolean>('toUtf8',           legacy.toutf8             ?? DEFAULT_CONFIG.toutf8),
        toterminal:        ws.get<boolean>('toTerminal',       legacy.toterminal         ?? DEFAULT_CONFIG.toterminal),
        outputFormat:      ws.get<'codeblock' | 'collapsible'>('outputFormat', legacy.outputFormat ?? DEFAULT_CONFIG.outputFormat),
        dangerousPatterns: ws.get<string[]>('dangerousPatterns', legacy.dangerousPatterns ?? DEFAULT_CONFIG.dangerousPatterns),
        allowList:         ws.get<string[]>('allowList',       legacy.allowList          ?? DEFAULT_CONFIG.allowList),
        denyList:          ws.get<string[]>('denyList',        legacy.denyList           ?? DEFAULT_CONFIG.denyList),
        confirmDangerous:  ws.get<boolean>('confirmDangerous', legacy.confirmDangerous   ?? DEFAULT_CONFIG.confirmDangerous),
        showCodeLens:      ws.get<boolean>('showCodeLens',     legacy.showCodeLens       ?? DEFAULT_CONFIG.showCodeLens),
        shell:             ws.get<string | null>('shell',      legacy.shell              ?? DEFAULT_CONFIG.shell)
    };
    return merged;
}

function readLegacyConfig(): Partial<LC4RIConfig> {
    try {
        const configPath = legacyConfigPath();
        if (!fs.existsSync(configPath)) { return {}; }
        return JSON.parse(fs.readFileSync(configPath, 'utf8')) ?? {};
    } catch (err) {
        return {};
    }
}

function ensureLegacyConfigFile(): void {
    const homePath = safeHome();
    if (!homePath) { return; }
    const dir = path.join(homePath, '.code-lc4ri');
    const file = path.join(dir, 'config.json');
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify({ timeout: DEFAULT_CONFIG.timeout, template: {}, profiles: {}, changeWord: {}, toutf8: true, toterminal: false }, null, 2), 'utf8');
    }
}

function legacyConfigPath(): string {
    const home = safeHome();
    if (!home) { return ''; }
    return path.join(home, '.code-lc4ri', 'config.json');
}

function safeHome(): string {
    try {
        const h = os.homedir();
        if (h && h.length) { return h; }
    } catch (_) { }
    try {
        const com = process.platform === 'win32' ? 'echo %USERPROFILE%' : 'echo $HOME';
        return execSync(com).toString().replace(/\r\n|\r|\n/, '');
    } catch (_) { return ''; }
}

// =============================================================================
// Parsing helpers
// =============================================================================

export function regTab(cnt: number): string {
    let s = '^';
    for (let i = 0; i < cnt; i++) { s += '\t'; }
    return s + '- ';
}

export const DEFAULT_INDENT_SPACES = 2;

export function normalizeIndent(line: string, tabWidth: number = DEFAULT_INDENT_SPACES): string {
    const m = line.match(/^([ \t]*)(.*)$/);
    if (!m) { return line; }
    const ws = m[1], rest = m[2];
    if (ws.length === 0) { return line; }
    let col = 0;
    for (const c of ws) {
        if (c === '\t') { col += tabWidth - (col % tabWidth); } else { col++; }
    }
    if (col === 0) { return rest; }
    return '\t'.repeat(Math.ceil(col / tabWidth)) + rest;
}

export function horizonCheck(line: string): boolean {
    return /^(?:\*\s?){3,}\s*$/.test(line) || /^(?:-\s?){3,}\s*$/.test(line);
}

export function joinContinuedLines(lines: string[], startIdx: number): { joined: string; consumed: number } {
    let line = lines[startIdx] ?? '';
    let consumed = 1;
    while (hasContinuationBackslash(line) && startIdx + consumed < lines.length) {
        const stripped = line.replace(/\s*\\\s*$/, '');
        const next = (lines[startIdx + consumed] ?? '').replace(/^\s+/, '');
        line = stripped + ' ' + next;
        consumed++;
    }
    return { joined: line, consumed };
}

function hasContinuationBackslash(line: string): boolean {
    const m = line.match(/(\\+)\s*$/);
    return !!m && m[1].length % 2 === 1;
}

export function detectListCommand(line: string): { depth: number; body: string } | null {
    const m = line.match(/^(\t*)- (.*)$/);
    if (!m) { return null; }
    return { depth: m[1].length, body: m[2] };
}

export function detectNumbered(line: string): { idx: string; body: string } | null {
    const m = line.match(/^([1-9])\.\s+(.*)$/);
    if (!m) { return null; }
    return { idx: m[1], body: m[2] };
}

export function extractBinding(body: string): { body: string; bindName: string | null } {
    const m = body.match(/\s*(?:→|->)\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*$/);
    if (!m) { return { body, bindName: null }; }
    return { body: body.slice(0, m.index), bindName: m[1] };
}

export function parseAssert(body: string): | { kind: 'contains'; arg: string } | { kind: 'equals'; arg: string } | { kind: 'status'; arg: number } | { kind: 'regex'; arg: RegExp } | null {
    const m = body.match(/^assert\s*:\s*(.+)$/i);
    if (!m) { return null; }
    const rest = m[1].trim();
    let r = rest.match(/^contains\s+(?:"([^"]*)"|'([^']*)'|(\S.*))$/i);
    if (r) { return { kind: 'contains', arg: (r[1] ?? r[2] ?? r[3]).trim() }; }
    r = rest.match(/^equals\s+(?:"([^"]*)"|'([^']*)'|(\S.*))$/i);
    if (r) { return { kind: 'equals', arg: (r[1] ?? r[2] ?? r[3]).trim() }; }
    r = rest.match(/^status\s*(?:==|=)\s*(-?\d+)$/i);
    if (r) { return { kind: 'status', arg: parseInt(r[1], 10) }; }
    r = rest.match(/^regex\s+\/(.+)\/([imsu]*)$/i);
    if (r) { return { kind: 'regex', arg: new RegExp(r[1], r[2]) }; }
    return null;
}

export function parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) { continue; }
        const eq = line.indexOf('=');
        if (eq < 1) { continue; }
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (key) { result[key] = val; }
    }
    return result;
}

export function parseWriteDirective(line: string): { depth: number; filePath: string } | null {
    const m = line.match(/^(\t*)- write:\s+(.+)$/i);
    if (!m) { return null; }
    return { depth: m[1].length, filePath: m[2].trim() };
}

export function parsePromptDirective(line: string): { depth: number; bindName: string; message: string; secret: boolean } | null {
    const m = line.match(/^(\t*)- prompt:\s+(secret\s+)?\{([A-Za-z_][A-Za-z0-9_]*)\}\s+(.+)$/i);
    if (!m) { return null; }
    return { depth: m[1].length, secret: !!m[2], bindName: m[3], message: m[4].trim() };
}

export function collectFencedBlock(lines: string[], startIdx: number): { content: string; consumed: number } | { content: null; consumed: 0 } {
    let idx = startIdx;
    while (idx < lines.length && lines[idx].trim() === '') { idx++; }
    if (idx >= lines.length) { return { content: null, consumed: 0 }; }

    const openMatch = lines[idx].match(/^(\s*)(`{3,}|~{3,})[^\n]*$/);
    if (!openMatch) { return { content: null, consumed: 0 }; }

    const fenceIndent = openMatch[1].length;
    const fenceChar = openMatch[2][0];
    const fenceLen = openMatch[2].length;
    const closingRe = new RegExp(`^\\s{0,${fenceIndent}}[${fenceChar}]{${fenceLen},}\\s*$`);

    idx++;
    const contentLines: string[] = [];
    while (idx < lines.length) {
        const l = lines[idx];
        if (closingRe.test(l)) { return { content: contentLines.join('\n'), consumed: idx - startIdx + 1 }; }
        const lead = l.match(/^( *)/)?.[1].length ?? 0;
        contentLines.push(lead >= fenceIndent ? l.slice(fenceIndent) : l);
        idx++;
    }
    return { content: null, consumed: 0 };
}

export function detectParallelFlag(body: string): { body: string; parallel: boolean } {
    const m = body.match(/^\[parallel\]\s*/i);
    if (!m) { return { body, parallel: false }; }
    return { body: body.slice(m[0].length), parallel: true };
}

export function detectRetryFlag(body: string): { body: string; retryCount: number; retryInterval: number } {
    const m = body.match(/^\[retry:\s*(\d+)(?:\s*,\s*(?:interval:)?\s*(\d+)(s|ms)?)?\]\s*/i);
    if (!m) { return { body, retryCount: 0, retryInterval: 0 }; }
    let interval = 0;
    if (m[2]) {
        interval = parseInt(m[2], 10);
        if (m[3] === 's') { interval *= 1000; }
    }
    return { body: body.slice(m[0].length), retryCount: parseInt(m[1], 10), retryInterval: interval };
}

export function substituteVars(line: string, vars: Variables): string {
    return line.replace(/\{([^{}\s]+)\}/g, (whole, key: string) => {
        if (key.startsWith('$')) {
            switch (key) {
                case '$PREV':   return vars.prev.replace(/\r?\n+$/, '');
                case '$STATUS': return String(vars.status);
                case '$DATE':   return new Date().toISOString();
                case '$CWD':    return process.cwd();
                case '$USER':   return os.userInfo().username || '';
                case '$HOST':   return os.hostname();
                default:        return whole;
            }
        }
        if (/^[1-9]$/.test(key) && vars.num[key] !== undefined) { return vars.num[key]; }
        if (vars.named[key] !== undefined) { return vars.named[key]; }
        return whole;
    });
}

export function applyChangeWord(line: string, map: { [k: string]: string }): string {
    for (const k of Object.keys(map)) {
        const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        line = line.replace(new RegExp(safe, 'g'), map[k]);
    }
    return line;
}

export function applyTemplate(cmd: string, cfg: LC4RIConfig, profile: string): string {
    if (profile && cfg.profiles[profile]) { return cfg.profiles[profile].replace('{COMMAND}', cmd); }
    if (cfg.template && cfg.template[process.platform]) { return cfg.template[process.platform].replace('{COMMAND}', cmd); }
    return cmd;
}

function generateRandomAlpha(length: number): string {
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

export function matchesAny(s: string, patterns: string[]): string | null {
    for (const p of patterns) {
        try { if (new RegExp(p).test(s)) { return p; } } catch (_) { }
    }
    return null;
}

export interface SecurityVerdict { ok: boolean; reason?: string; dangerous?: string }
export function checkSecurity(cmd: string, cfg: LC4RIConfig): SecurityVerdict {
    const deny = matchesAny(cmd, cfg.denyList);
    if (deny) { return { ok: false, reason: `denyList match: /${deny}/` }; }
    if (cfg.allowList.length > 0) {
        const allow = matchesAny(cmd, cfg.allowList);
        if (!allow) { return { ok: false, reason: `not in allowList` }; }
    }
    const dangerous = matchesAny(cmd, cfg.dangerousPatterns);
    if (dangerous) { return { ok: true, dangerous }; }
    return { ok: true };
}

async function confirmDangerous(cmd: string, pattern: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
        `⚠ This command matches a dangerous pattern: /${pattern}/\n\n${cmd}\n\nExecute anyway?`,
        { modal: true }, 'Run', 'Cancel'
    );
    return pick === 'Run';
}

// =============================================================================
// Async exec (spawn-based)
// =============================================================================

function execAsync(
    cmd: string, cfg: LC4RIConfig, token?: vscode.CancellationToken, cwd?: string,
    onData?: (chunk: string, isStderr: boolean) => void, env?: Record<string, string>
): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
        const shellCmd = cfg.shell ?? (process.platform === 'win32' ? true : '/bin/sh');
        let effectiveCwd: string | undefined = cwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) { effectiveCwd = undefined; }
        const effectiveEnv = env && Object.keys(env).length > 0 ? { ...process.env, ...env } as NodeJS.ProcessEnv : undefined;
        
        const child: ChildProcess = spawn(cmd, {
            shell: shellCmd as unknown as string,
            windowsHide: true, cwd: effectiveCwd, ...(effectiveEnv ? { env: effectiveEnv } : {})
        });
        runningProcs.add(child);

        let stdoutBuf = Buffer.alloc(0), stderrBuf = Buffer.alloc(0);
        let timedOut = false, cancelled = false;

        const killAll = (signal: NodeJS.Signals = 'SIGTERM') => {
            try { child.kill(signal); } catch (_) { }
            if (process.platform === 'win32' && child.pid) {
                try { execSync(`taskkill /pid ${child.pid} /T /F`); } catch (_) { }
            }
        };

        const timeoutTimer = setTimeout(() => { timedOut = true; killAll('SIGKILL'); }, Math.max(0, cfg.timeout));
        const cancelSub = token?.onCancellationRequested(() => { cancelled = true; killAll('SIGTERM'); });

        child.stdout?.on('data', (b: Buffer) => {
            stdoutBuf = Buffer.concat([stdoutBuf, b]);
            if (onData) { onData(convToUTF(b, cfg), false); }
        });
        child.stderr?.on('data', (b: Buffer) => {
            stderrBuf = Buffer.concat([stderrBuf, b]);
            if (onData) { onData(convToUTF(b, cfg), true); }
        });

        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(timeoutTimer); cancelSub?.dispose(); runningProcs.delete(child);
            resolve({ stdout: convToUTF(stdoutBuf, cfg), stderr: convToUTF(stderrBuf, cfg), code: code ?? (signal ? 130 : -1), timedOut, cancelled });
        });

        child.on('error', (err: Error) => {
            clearTimeout(timeoutTimer); cancelSub?.dispose(); runningProcs.delete(child);
            resolve({ stdout: '', stderr: String(err.message ?? err), code: -1, timedOut, cancelled });
        });
    });
}

function convToUTF(buf: Buffer, cfg: LC4RIConfig): string {
    if (!cfg.toutf8) { return buf.toString(); }
    try {
        return Encoding.convert(buf, { from: 'AUTO', to: 'UNICODE', type: 'string' }) as unknown as string;
    } catch (_) { return buf.toString(); }
}

function cancelAll(): void {
    for (const p of Array.from(runningProcs)) { try { p.kill('SIGTERM'); } catch (_) { } }
    runningProcs.clear();
    outputChannel?.appendLine('[lc4ri] all running commands cancelled');
}

// =============================================================================
// Current working directory / env tracking
// =============================================================================

export function getCurrentCwd(): string {
    if (currentCwd && fs.existsSync(currentCwd)) { return currentCwd; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const resolved: string = folder ? folder.uri.fsPath : process.cwd();
    currentCwd = resolved;
    return resolved;
}
export function setCurrentCwd(p: string | undefined): void { currentCwd = p; }
export function getCurrentEnv(): Record<string, string> { return currentEnv; }
export function setCurrentEnv(env: Record<string, string>): void { currentEnv = { ...env }; }
export function getPersistentVars(): { num: Record<string, string>; named: Record<string, string> } { return { num: { ...persistentVars.num }, named: { ...persistentVars.named } }; }
export function setPersistentVars(v: { num: Record<string, string>; named: Record<string, string> }): void { persistentVars = { num: { ...v.num }, named: { ...v.named } }; }

export function isPureExportCommand(cmd: string): boolean {
    const trimmed = cmd.trim();
    if (!/^export(\s|$)/.test(trimmed)) { return false; }
    let inSingle = false, inDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === '\\') { i++; continue; }
        if (!inDouble && c === "'") { inSingle = !inSingle; continue; }
        if (!inSingle && c === '"') { inDouble = !inDouble; continue; }
        if (inSingle || inDouble) { continue; }
        if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') { return false; }
    }
    return true;
}

async function resolveExport(exportCmd: string, cfg: LC4RIConfig, token?: vscode.CancellationToken): Promise<{ ok: boolean; vars: Record<string, string>; output: string }> {
    const baseCwd = getCurrentCwd();
    const baseEnv = Object.keys(currentEnv).length > 0 ? { ...process.env, ...currentEnv } as NodeJS.ProcessEnv : undefined;
    const probeCmd = `${exportCmd} && env`;
    const res = await new Promise<ExecResult>((resolve) => {
        const shellCmd = cfg.shell ?? (process.platform === 'win32' ? true : '/bin/sh');
        let effectiveCwd: string | undefined = baseCwd;
        if (effectiveCwd && !fs.existsSync(effectiveCwd)) { effectiveCwd = undefined; }
        const child: ChildProcess = spawn(probeCmd, { shell: shellCmd as unknown as string, windowsHide: true, cwd: effectiveCwd, ...(baseEnv ? { env: baseEnv } : {}) });
        runningProcs.add(child);
        let stdoutBuf = Buffer.alloc(0), stderrBuf = Buffer.alloc(0);
        let timedOut = false, cancelled = false;
        const killAll = (signal: NodeJS.Signals = 'SIGTERM') => { try { child.kill(signal); } catch (_) { } };
        const timeoutTimer = setTimeout(() => { timedOut = true; killAll('SIGKILL'); }, Math.max(0, cfg.timeout));
        const cancelSub = token?.onCancellationRequested(() => { cancelled = true; killAll('SIGTERM'); });
        child.stdout?.on('data', (b: Buffer) => { stdoutBuf = Buffer.concat([stdoutBuf, b]); });
        child.stderr?.on('data', (b: Buffer) => { stderrBuf = Buffer.concat([stderrBuf, b]); });
        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(timeoutTimer); cancelSub?.dispose(); runningProcs.delete(child);
            resolve({ stdout: convToUTF(stdoutBuf, cfg), stderr: convToUTF(stderrBuf, cfg), code: code ?? (signal ? 130 : -1), timedOut, cancelled });
        });
        child.on('error', (err: Error) => {
            clearTimeout(timeoutTimer); cancelSub?.dispose(); runningProcs.delete(child);
            resolve({ stdout: '', stderr: String(err.message ?? err), code: -1, timedOut, cancelled });
        });
    });

    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, vars: {}, output: (res.stderr || res.stdout || `export failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const envDump: Record<string, string> = {};
    let currentKey: string | null = null, currentVal: string[] = [];
    for (const rawLine of res.stdout.split(/\r?\n/)) {
        const eqIdx = rawLine.indexOf('=');
        if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawLine.slice(0, eqIdx))) {
            if (currentKey !== null) { envDump[currentKey] = currentVal.join('\n'); }
            currentKey = rawLine.slice(0, eqIdx);
            currentVal = [rawLine.slice(eqIdx + 1)];
        } else if (currentKey !== null) {
            currentVal.push(rawLine);
        }
    }
    if (currentKey !== null) { envDump[currentKey] = currentVal.join('\n'); }
    const exportedNames: string[] = [];
    const body = exportCmd.replace(/^export\s+/, '');
    for (const token of body.split(/\s+/)) {
        const name = token.split('=')[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { exportedNames.push(name); }
    }
    const captured: Record<string, string> = {};
    for (const name of exportedNames) { if (name in envDump) { captured[name] = envDump[name]; } }
    const summary = Object.entries(captured).map(([k, v]) => `${k}=${v}`).join(', ');
    return { ok: true, vars: captured, output: summary || '(no variables captured)' };
}

export function isPureCdCommand(cmd: string): boolean {
    const trimmed = cmd.trim();
    if (!/^cd(\s|$)/.test(trimmed)) { return false; }
    let inSingle = false, inDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed[i];
        if (c === '\\') { i++; continue; }
        if (!inDouble && c === "'") { inSingle = !inSingle; continue; }
        if (!inSingle && c === '"') { inDouble = !inDouble; continue; }
        if (inSingle || inDouble) { continue; }
        if (c === ';' || c === '|' || c === '&' || c === '>' || c === '<') { return false; }
    }
    return true;
}

async function resolveCd(cdCmd: string, cfg: LC4RIConfig, token?: vscode.CancellationToken): Promise<{ ok: boolean; newCwd?: string; output: string }> {
    const baseCwd = getCurrentCwd();
    const printPwd = process.platform === 'win32' ? 'cd' : 'pwd';
    const fullCmd = `${cdCmd} && ${printPwd}`;
    const res = await execAsync(fullCmd, cfg, token, baseCwd, undefined, currentEnv);
    if (res.code !== 0 || res.timedOut || res.cancelled) {
        return { ok: false, output: (res.stderr || res.stdout || `cd failed (exit ${res.code})`).replace(/\r?\n+$/, '') };
    }
    const lines = res.stdout.replace(/\r?\n+$/, '').split(/\r?\n/);
    const newCwd = lines[lines.length - 1]?.trim();
    if (!newCwd) { return { ok: false, output: 'could not determine new cwd' }; }
    return { ok: true, newCwd, output: newCwd };
}

// =============================================================================
// Main: run from cursor
// =============================================================================

interface RunOptions { dryRun: boolean }

async function runFromCursor(opts: RunOptions): Promise<void> {
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
        const ctx: RunContext = {
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

        const syncInterval = setInterval(async () => {
            if (!editor || !doc || ctx.isSyncing) return;
            ctx.isSyncing = true;
            try { await syncOutput(editor, doc, ctx); }
            finally { ctx.isSyncing = false; }
        }, 200);

        await runLines(lines, ctx);

        clearInterval(syncInterval);
        
        if (ctx.execFlag) {
            while (ctx.isSyncing) { await new Promise(r => setTimeout(r, 50)); }
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
        if (historySessions.length > 50) { historySessions.splice(50); }
        saveHistory();
        // Refresh history panel if open
        if (historyPanel) { postHistoryData(); }
        currentSession = undefined;
    }
}

interface RunContext {
    cfg: LC4RIConfig;
    profile: string;
    dryRun: boolean;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
    vars: Variables;
    consoles: string;
    lastRenderedConsoles: string;
    outputBlockStartLine: number;
    outputBlockEndLine: number;
    outputMarkerRange: boolean;
    isSyncing: boolean;
    
    execCount: number;
    execFlag: boolean;
    horizonFlag: number;
    startLine: number;
    endLine: number;
    nowLine: number;
    assertionFailed: boolean;
}

async function runLines(lines: string[], ctx: RunContext): Promise<void> {
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
            } catch (_) { }
            ctx.nowLine++;
            continue;
        }

        const fenceExecMatch = line.match(/^([ \t]*)(`{3,}|~{3,})\s*(bash|zsh|sh|yaml|conf|json)\b(?:\s+(.+))?\s*$/i);
        if (fenceExecMatch) {
            const depthMatch = fenceExecMatch[1];
            let depth = 0;
            for (const c of depthMatch) { if (c === '\t') depth++; }
            
            const lang = fenceExecMatch[3].toLowerCase();
            const argPath = fenceExecMatch[4]?.trim();

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
                    } else {
                        try {
                            fs.mkdirSync(path.dirname(resolved), { recursive: true });
                            fs.writeFileSync(resolved, blk.content + '\n', 'utf8');
                            const n = blk.content.split('\n').length;
                            ctx.consoles += header + `wrote ${n} line(s) to ${resolved}\n`;
                            pushReport({ command: `write: ${filename}`, rendered: `write: ${filename}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true, startMs: Date.now(), endMs: Date.now(), isParallel: false, parallelGroup: -1 });
                        } catch (err) {
                            ctx.consoles += header + `error: ${String(err)}\n`;
                        }
                    }
                    ctx.execCount = depth + 1;
                } else {
                    ctx.execFlag = true;
                    const blockLines = blk.content.split(/\r?\n/);
                    const logicalCommands: string[] = [];
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
                        if (ctx.token.isCancellationRequested) break;
                        
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
            const atTop      = new RegExp(regTab(0)).test(line);
            if (!atExpected && !atTop) {
                ctx.execCount = 0;
                ctx.nowLine++;
                continue;
            }
            if (!atExpected) { ctx.execCount = 0; }

            ctx.execFlag = true;
            if (ctx.dryRun) {
                ctx.consoles += `\n[ prompt: {${bindName}} ] ${getDate()}\n[dry-run] would prompt: ${message}\n`;
                ctx.execCount = depth + 1;
            } else {
                const val = await vscode.window.showInputBox({ prompt: message, password: secret, ignoreFocusOut: true });
                if (val === undefined) {
                    ctx.consoles += `\n[ prompt: {${bindName}} ] ${getDate()}\n(cancelled by user)\n`;
                    ctx.execCount = 0;
                } else {
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
        if (numHit) { await handleNumberedAssignment(numHit, ctx); }

        line = substituteVars(line, ctx.vars);
        line = applyChangeWord(line, ctx.cfg.changeWord);

        const writeDir = parseWriteDirective(line);
        if (writeDir !== null) {
            const { depth, filePath } = writeDir;
            const atExpected = new RegExp(regTab(ctx.execCount)).test(line);
            const atTop      = new RegExp(regTab(0)).test(line);
            if (!atExpected && !atTop) {
                ctx.execCount = 0; ctx.nowLine++; continue;
            }
            if (!atExpected) { ctx.execCount = 0; }

            const blk = collectFencedBlock(lines, i + 1);
            const resolved = path.isAbsolute(filePath) ? filePath : path.join(getCurrentCwd(), filePath);
            ctx.execFlag = true;
            const header = `\n[ write: ${filePath} ] ${getDate()}\n`;

            if (blk.content === null) {
                ctx.consoles += header + `(no fenced block found after write:)\n`;
                ctx.execCount = 0;
            } else if (ctx.dryRun) {
                const n = blk.content.split('\n').length;
                ctx.consoles += header + `[dry-run] would write ${n} line(s) to ${resolved}\n`;
                i += blk.consumed; ctx.nowLine += blk.consumed; ctx.execCount = depth + 1;
            } else {
                try {
                    fs.mkdirSync(path.dirname(resolved), { recursive: true });
                    fs.writeFileSync(resolved, blk.content + '\n', 'utf8');
                    const n = blk.content.split('\n').length;
                    ctx.consoles += header + `wrote ${n} line(s) to ${resolved}\n`;
                    pushReport({ command: `write: ${filePath}`, rendered: `write: ${filePath}`, output: `wrote ${n} line(s)`, code: 0, ts: getDate(), ok: true, startMs: Date.now(), endMs: Date.now(), isParallel: false, parallelGroup: -1 });
                    i += blk.consumed; ctx.nowLine += blk.consumed; ctx.execCount = depth + 1;
                } catch (err) {
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
            if (!passed) { ctx.assertionFailed = true; ctx.execCount = 0; }
            ctx.progress.report({ message: `assert ${passed ? 'pass' : 'FAIL'}` });
            ctx.nowLine++;
            continue;
        }

        const expectedDepthRe = new RegExp(regTab(ctx.execCount));
        if (expectedDepthRe.test(line)) {
            const { newIdx, extraNowLine } = await runOrParallel(line, ctx.execCount, lines, i, ctx);
            i = newIdx; ctx.nowLine += extraNowLine;
        } else {
            ctx.execCount = 0;
            const topRe = new RegExp(regTab(0));
            if (topRe.test(line)) {
                const { newIdx, extraNowLine } = await runOrParallel(line, 0, lines, i, ctx);
                i = newIdx; ctx.nowLine += extraNowLine;
            }
        }

        if (isFenceLine(line)) {
            if (ctx.startLine === 0) {
                ctx.startLine = ctx.nowLine;
            } else {
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

function isFenceLine(s: string): boolean { return /^```\s*$/.test(s); }

async function handleNumberedAssignment(hit: { idx: string; body: string }, ctx: RunContext): Promise<void> {
    const { body, bindName } = extractBinding(hit.body);
    const cmd = applyChangeWord(substituteVars(body, ctx.vars), ctx.cfg.changeWord);
    const finalCmd = applyTemplate(cmd, ctx.cfg, ctx.profile);
    const sec = checkSecurity(finalCmd, ctx.cfg);
    if (!sec.ok) {
        ctx.vars.num[hit.idx] = `(blocked: ${sec.reason ?? 'security'})`;
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
        if (bindName) { ctx.vars.named[bindName] = ctx.vars.num[hit.idx]; }
        return;
    }

    if (isPureCdCommand(finalCmd)) {
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd; ctx.vars.num[hit.idx] = currentCwd;
            if (bindName) { ctx.vars.named[bindName] = currentCwd; }
            ctx.vars.prev = currentCwd; ctx.vars.status = 0;
        } else {
            ctx.vars.status = 1;
        }
        return;
    }

    if (isPureExportCommand(finalCmd)) {
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.vars.num[hit.idx] = expRes.output;
            if (bindName) { ctx.vars.named[bindName] = expRes.output; }
            ctx.vars.prev = expRes.output; ctx.vars.status = 0;
        } else { ctx.vars.status = 1; }
        return;
    }

    ctx.progress.report({ message: `setting {${hit.idx}}: ${finalCmd}` });
    const startMs = Date.now();
    const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(), undefined, currentEnv);
    const endMs = Date.now();
    const trimmed = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
    ctx.vars.num[hit.idx] = trimmed;
    if (bindName) { ctx.vars.named[bindName] = trimmed; }
    ctx.vars.prev = res.stdout;
    ctx.vars.status = res.code;
    // ① Refresh inspector after numbered assignment
    refreshVarInspector(ctx.vars);
    pushReport({ command: finalCmd, rendered: finalCmd, output: trimmed, code: res.code, ts: getDate(), ok: res.code === 0 && !res.timedOut && !res.cancelled, startMs, endMs, isParallel: false, parallelGroup: -1 });
}

async function runOneCommand(rawLine: string, depth: number, ctx: RunContext): Promise<void> {
    const stripRe = new RegExp(regTab(depth));
    const rawBody = rawLine.replace(stripRe, '');
    const { body: noParallelBody } = detectParallelFlag(rawBody);
    
    const { body: noRetryBody, retryCount, retryInterval } = detectRetryFlag(noParallelBody);
    const { body: cleanBody, bindName } = extractBinding(noRetryBody);

    if (/^include:\s+/i.test(cleanBody)) {
        await runInclude(cleanBody.replace(/^include:\s+/i, '').trim(), ctx);
        ctx.execFlag = true; ctx.execCount = depth + 1;
        return;
    }
    if (/^open:\s+/i.test(cleanBody)) {
        await openFileTab(cleanBody.replace(/^open:\s+/i, '').trim());
        ctx.execFlag = true; ctx.execCount = depth + 1;
        return;
    }
    if (/^!\s+/.test(cleanBody)) {
        const termCmd = cleanBody.replace(/^!\s+/, '').trim();
        ctx.consoles += `\n[ ! ${termCmd} ] ${getDate()}\n`;
        ctx.execFlag = true;
        if (ctx.dryRun) { ctx.consoles += `[dry-run: terminal] ${termCmd}\n`; } 
        else { vscode.window.activeTerminal?.sendText(termCmd); ctx.consoles += `(sent to terminal)\n`; }
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
        ctx.execCount = 0; return;
    }
    if (sec.dangerous && ctx.cfg.confirmDangerous && !ctx.dryRun) {
        if (!(await confirmDangerous(finalCmd, sec.dangerous))) {
            ctx.consoles += '(cancelled by user)\n';
            ctx.execCount = 0; return;
        }
    }

    if (ctx.dryRun) {
        ctx.consoles += `[dry-run] ${finalCmd}\n`;
        ctx.execCount = depth + 1; return;
    }
    if (ctx.cfg.toterminal) {
        vscode.window.activeTerminal?.sendText(finalCmd);
        ctx.consoles += `(sent to terminal)\n`;
    }

    if (isPureCdCommand(finalCmd)) {
        const cdRes = await resolveCd(finalCmd, ctx.cfg, ctx.token);
        if (cdRes.ok && cdRes.newCwd) {
            currentCwd = cdRes.newCwd; ctx.consoles += `(cwd → ${currentCwd})\n`;
            ctx.vars.prev = currentCwd; ctx.vars.status = 0;
            if (bindName) { ctx.vars.named[bindName] = currentCwd; }
            ctx.execCount = depth + 1;
        } else {
            ctx.consoles += `${cdRes.output}\n[cd failed]\n`;
            ctx.vars.status = 1; ctx.execCount = 0;
        }
        return;
    }
    if (isPureExportCommand(finalCmd)) {
        const expRes = await resolveExport(finalCmd, ctx.cfg, ctx.token);
        if (expRes.ok) {
            Object.assign(currentEnv, expRes.vars);
            ctx.consoles += `(env → ${expRes.output})\n`;
            ctx.vars.prev = expRes.output; ctx.vars.status = 0;
            if (bindName) { ctx.vars.named[bindName] = expRes.output; }
            ctx.execCount = depth + 1;
        } else {
            ctx.consoles += `${expRes.output}\n[export failed]\n`;
            ctx.vars.status = 1; ctx.execCount = 0;
        }
        return;
    }

    let attempts = 0;
    let maxAttempts = retryCount > 0 ? retryCount + 1 : 1;
    let res: ExecResult | null = null;
    const startMs = Date.now();

    while (attempts < maxAttempts && !ctx.token.isCancellationRequested) {
        if (attempts > 0) {
            const waitMsg = `\n[retry ${attempts}/${retryCount} wait ${retryInterval}ms...]\n`;
            ctx.consoles += waitMsg;
            await new Promise(r => setTimeout(r, retryInterval));
        }
        ctx.progress.report({ message: `${finalCmd}${retryCount > 0 ? ` (try ${attempts + 1})` : ''}` });
        
        res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(),
            (chunk, isStderr) => {
                const text = isStderr ? `[stderr] ${chunk}` : chunk;
                outputChannel?.append(text);
                ctx.consoles += text;
            },
            currentEnv);

        let suffix = "";
        if (res.timedOut)  { suffix += `\n[timeout after ${ctx.cfg.timeout}ms]\n`; }
        if (res.cancelled) { suffix += `\n[cancelled]\n`; }
        if (res.code !== 0 && !res.cancelled && !res.timedOut) { suffix += `\n[exit ${res.code}]\n`; }
        ctx.consoles += suffix;

        if (res.code === 0 && !res.timedOut && !res.cancelled) { break; }
        attempts++;
    }

    const endMs = Date.now();

    if (res) {
        ctx.vars.prev = res.stdout;
        ctx.vars.status = res.code;
        if (bindName) { ctx.vars.named[bindName] = (res.stdout || res.stderr).replace(/\r?\n+$/, ''); }

        pushReport({
            command: finalCmd, rendered: finalCmd,
            output: res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ''), code: res.code, ts: getDate(),
            ok: res.code === 0 && !res.timedOut && !res.cancelled,
            startMs, endMs, isParallel: false, parallelGroup: -1
        });

        ctx.execCount = (res.code === 0 && !res.timedOut && !res.cancelled) ? depth + 1 : 0;
    }
}

async function runInclude(includePath: string, ctx: RunContext): Promise<void> {
    const resolved = path.isAbsolute(includePath) ? includePath : path.join(getCurrentCwd(), includePath);
    if (!fs.existsSync(resolved)) { ctx.consoles += `\n[include: file not found: ${resolved}]\n`; return; }
    ctx.consoles += `\n[ include: ${resolved} ] ${getDate()}\n`;
    try {
        const subCtx: RunContext = { ...ctx, consoles: '', execCount: 0, execFlag: false, horizonFlag: -1, startLine: 0, endLine: 0, nowLine: 0, assertionFailed: false };
        await runLines(fs.readFileSync(resolved, 'utf8').split(/\r?\n/), subCtx);
        ctx.consoles += subCtx.consoles; ctx.vars = subCtx.vars; ctx.execFlag = ctx.execFlag || subCtx.execFlag;
    } catch (err) {
        ctx.consoles += `\n[include: read error: ${String(err)}]\n`;
    }
}

async function runParallelGroup(rawLines: string[], depth: number, ctx: RunContext): Promise<void> {
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

        if (ctx.dryRun) { return { header, output: `[dry-run] ${finalCmd}\n`, ok: true, bindName, bindVal: '', startMs: groupStartMs, endMs: groupStartMs }; }
        const sec = checkSecurity(finalCmd, ctx.cfg);
        if (!sec.ok) { return { header, output: `(blocked: ${sec.reason})\n`, ok: false, bindName, bindVal: '', startMs: groupStartMs, endMs: Date.now() }; }

        ctx.progress.report({ message: `[parallel] ${finalCmd}` });
        const taskStart = Date.now();
        const res = await execAsync(finalCmd, ctx.cfg, ctx.token, getCurrentCwd(),
            (chunk, isStderr) => outputChannel?.append(isStderr ? `[${finalCmd}][stderr] ${chunk}` : `[${finalCmd}] ${chunk}`), currentEnv);
        const taskEnd = Date.now();

        let suffix = "";
        if (res.timedOut)  { suffix += `\n[timeout after ${ctx.cfg.timeout}ms]\n`; }
        if (res.cancelled) { suffix += `\n[cancelled]\n`; }
        if (res.code !== 0 && !res.cancelled && !res.timedOut) { suffix += `\n[exit ${res.code}]\n`; }

        const bindVal = (res.stdout || res.stderr).replace(/\r?\n+$/, '');
        const ok = res.code === 0 && !res.timedOut && !res.cancelled;
        const output = res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : '') + suffix;
        pushReport({ command: finalCmd, rendered: finalCmd, output, code: res.code, ts: getDate(), ok, startMs: taskStart, endMs: taskEnd, isParallel: true, parallelGroup: groupId });
        return { header, output, ok, bindName, bindVal, startMs: taskStart, endMs: taskEnd };
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
        ctx.consoles += r.header + r.output;
        if (r.bindName) { ctx.vars.named[r.bindName] = r.bindVal; }
    }
    ctx.execCount = results.every(r => r.ok) ? depth + 1 : 0;
}

async function runOrParallel(firstLine: string, depth: number, lines: string[], curIdx: number, ctx: RunContext): Promise<{ newIdx: number; extraNowLine: number }> {
    const depthRe = new RegExp(regTab(depth));
    if (!detectParallelFlag(firstLine.replace(depthRe, '')).parallel) {
        await runOneCommand(firstLine, depth, ctx);
        return { newIdx: curIdx, extraNowLine: 0 };
    }

    const parallelLines: string[] = [firstLine];
    let j = curIdx + 1;
    let extraNowLine = 0;
    while (j < lines.length && !ctx.token.isCancellationRequested) {
        const nextCont = joinContinuedLines(lines, j);
        const nextLine = normalizeIndent(nextCont.joined);
        if (horizonCheck(nextLine) || !depthRe.test(nextLine) || !detectParallelFlag(nextLine.replace(depthRe, '')).parallel) { break; }
        parallelLines.push(nextLine); extraNowLine += nextCont.consumed; j += nextCont.consumed;
    }
    await runParallelGroup(parallelLines, depth, ctx);
    return { newIdx: j - 1, extraNowLine };
}

async function openFileTab(fname: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return; }
    try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.isAbsolute(fname) ? fname : path.join(folder.uri.fsPath, fname))));
    } catch (err) { }
}

function evaluateAssert(a: NonNullable<ReturnType<typeof parseAssert>>, ctx: RunContext): boolean {
    switch (a.kind) {
        case 'contains': return ctx.vars.prev.indexOf(a.arg) !== -1;
        case 'equals':   return ctx.vars.prev.trim() === a.arg;
        case 'status':   return ctx.vars.status === a.arg;
        case 'regex':    return a.arg.test(ctx.vars.prev);
    }
}
function describeAssert(a: NonNullable<ReturnType<typeof parseAssert>>): string {
    switch (a.kind) {
        case 'contains': return `contains "${a.arg}"`;
        case 'equals':   return `equals "${a.arg}"`;
        case 'status':   return `status == ${a.arg}`;
        case 'regex':    return `regex ${a.arg.toString()}`;
    }
}

// -----------------------------------------------------------------------------
// Live streaming markdown write back
// -----------------------------------------------------------------------------

async function syncOutput(editor: vscode.TextEditor, doc: vscode.TextDocument, ctx: RunContext): Promise<void> {
    if (!ctx.execFlag || ctx.consoles === ctx.lastRenderedConsoles) return;
    
    let body = ctx.consoles;
    if (ctx.startLine === 0 && ctx.endLine === 0) {
        if (ctx.cfg.outputFormat === 'collapsible') {
            body = `\n<details><summary>output ${getDate()}</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>\n`;
        } else {
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
            } else {
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
    } else {
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

async function runSingleLine(uri: vscode.Uri, line: number, dryRun: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) { await vscode.window.showTextDocument(uri); }
    const newEditor = vscode.window.activeTextEditor;
    if (!newEditor) { return; }
    const pos = new vscode.Position(line, 0);
    newEditor.selection = new vscode.Selection(pos, pos);
    await runFromCursor({ dryRun });
}

class LC4RICodeLensProvider implements vscode.CodeLensProvider {
    public onDidChangeCodeLenses?: vscode.Event<void>;
    constructor(emitter: vscode.Event<void>) { this.onDidChangeCodeLenses = emitter; }
    provideCodeLenses(doc: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
        const cfg = readConfig();
        if (!cfg.showCodeLens) { return []; }
        const lenses: vscode.CodeLens[] = [];
        let insideOutputBlock = false;
        let blockOpenLine = -1;

        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text;

            // ③ Detect output code block (``` followed by content lines then ```)
            if (/^```\s*$/.test(line)) {
                if (!insideOutputBlock) {
                    insideOutputBlock = true;
                    blockOpenLine = i;
                } else {
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
            if (insideOutputBlock) { continue; }

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

function updateStatusBar(): void {
    if (!statusBarItem) { return; }
    const cfg = readConfig();
    const profileNames = Object.keys(cfg.profiles);
    statusBarItem.text = activeProfile ? `$(terminal) lc4ri: ${activeProfile}` : (profileNames.length ? '$(terminal) lc4ri: (none)' : '$(terminal) lc4ri');
}

async function switchProfile(): Promise<void> {
    const cfg = readConfig();
    const items: vscode.QuickPickItem[] = [{ label: '(none)', description: 'use legacy OS-keyed template only' }, ...Object.keys(cfg.profiles).map(k => ({ label: k, description: cfg.profiles[k] }))];
    const pick = await vscode.window.showQuickPick(items, { title: 'code-lc4ri: switch execution profile', placeHolder: activeProfile || '(none)' });
    if (!pick) { return; }
    activeProfile = pick.label === '(none)' ? '' : pick.label;
    updateStatusBar();
}

async function clearOutputBlock(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const doc = editor.document;
    const cursor = editor.selection.active.line;
    let start = -1, end = -1;
    for (let i = cursor; i < doc.lineCount; i++) { if (/^```\s*$/.test(doc.lineAt(i).text)) { start = i; break; } }
    if (start === -1) { return; }
    for (let i = start + 1; i < doc.lineCount; i++) { if (/^```\s*$/.test(doc.lineAt(i).text)) { end = i; break; } }
    if (end === -1) { return; }
    await editor.edit(b => b.replace(new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, doc.lineAt(end).text.length)), '```\n```'));
}

function getDate(): string { return new Date(Date.now()).toString(); }

function pushReport(entry: ReportEntry): void {
    reportEntries.push(entry);
    // ② Also add to current session
    if (currentSession) {
        currentSession.entries.push(entry);
    }
    outputChannel?.appendLine(`[${entry.ts}] (${entry.ok ? 'ok' : 'NG'} code=${entry.code}) ${entry.command}`);
}

// =============================================================================
// Export report
// =============================================================================

async function exportReport(kind: 'md' | 'html' = 'html'): Promise<void> {
    if (reportEntries.length === 0) { vscode.window.showInformationMessage('code-lc4ri: nothing to export yet.'); return; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const fname = path.join(folder ? folder.uri.fsPath : os.tmpdir(), `lc4ri-report-${new Date().toISOString().replace(/[:.]/g, '-')}.${kind}`);
    fs.writeFileSync(fname, kind === 'md' ? buildMarkdownReport() : buildHtmlReport(), 'utf8');
    if (await vscode.window.showInformationMessage(`code-lc4ri: report saved to ${fname}`, 'Open') === 'Open') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fname));
    }
}

function buildMarkdownReport(): string {
    let s = `# code-lc4ri execution report\n\n- generated: ${new Date().toISOString()}\n- profile:   ${activeProfile || '(none)'}\n- host:      ${os.hostname()}\n- user:      ${os.userInfo().username}\n\n`;
    for (const e of reportEntries) { s += `## ${e.ok ? '✅' : '❌'} ${e.command}\n\n- at: ${e.ts}\n- exit: ${e.code}\n- duration: ${e.endMs - e.startMs}ms\n\n\`\`\`\n${e.output}\n\`\`\`\n\n`; }
    return s;
}

function buildHtmlReport(): string {
    const rows = reportEntries.map(e => `<section class="${e.ok ? 'ok' : 'ng'}"><h3>${escapeHtml(e.command)}</h3><p class="meta">at ${escapeHtml(e.ts)} — exit ${e.code} — ${e.endMs - e.startMs}ms</p><pre>${escapeHtml(e.output)}</pre></section>`).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>lc4ri report</title><style>body{font-family:system-ui,sans-serif;max-width:920px;margin:2em auto;padding:0 1em;} h1{border-bottom:1px solid #ccc;} section{border-left:4px solid #aaa;margin:1em 0;padding:0.5em 1em;} section.ok{border-color:#3a3;background:#f3fbf3;} section.ng{border-color:#c33;background:#fbf3f3;} pre{background:#111;color:#eee;padding:1em;overflow:auto;} .meta{color:#666;font-size:0.9em;}</style></head><body><h1>code-lc4ri execution report</h1><p><b>generated:</b> ${escapeHtml(new Date().toISOString())}<br><b>profile:</b> ${escapeHtml(activeProfile || '(none)')}<br><b>host:</b> ${escapeHtml(os.hostname())}<br><b>user:</b> ${escapeHtml(os.userInfo().username)}</p>${rows}</body></html>`;
}

function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

// =============================================================================
// ① Variable Inspector Panel
// =============================================================================

function showVarInspector(context: vscode.ExtensionContext): void {
    if (varInspectorPanel) {
        varInspectorPanel.reveal(vscode.ViewColumn.Beside);
        postVarData({ num: persistentVars.num, named: persistentVars.named, prev: '', status: 0 });
        return;
    }

    varInspectorPanel = vscode.window.createWebviewPanel(
        'lc4riVarInspector',
        'lc4ri: Variable Inspector',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    varInspectorPanel.webview.html = buildVarInspectorHtml();
    varInspectorPanel.onDidDispose(() => { varInspectorPanel = undefined; }, null, context.subscriptions);

    // Send current vars immediately
    postVarData({ num: persistentVars.num, named: persistentVars.named, prev: '', status: 0 });
}

function refreshVarInspector(vars: Variables): void {
    if (!varInspectorPanel) { return; }
    postVarData(vars);
}

function postVarData(vars: Variables): void {
    if (!varInspectorPanel) { return; }
    varInspectorPanel.webview.postMessage({
        type: 'update',
        num: vars.num,
        named: vars.named,
        prev: vars.prev,
        status: vars.status,
        cwd: getCurrentCwd(),
        env: currentEnv,
        ts: new Date().toISOString()
    });
}

function buildVarInspectorHtml(): string {
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
  section { border-bottom: 1px solid var(--vscode-panel-border); }
  section summary { padding: 7px 14px; cursor: pointer; font-weight: 600; font-size: 12px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; user-select: none; list-style: none; display: flex; align-items: center; gap: 6px; }
  section summary::-webkit-details-marker { display: none; }
  section summary::before { content: '▶'; font-size: 9px; transition: transform 0.15s; }
  section[open] summary::before { transform: rotate(90deg); }
  .var-table { width: 100%; border-collapse: collapse; }
  .var-table td { padding: 4px 14px; vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.1)); }
  .var-table tr:last-child td { border-bottom: none; }
  .var-table tr:hover td { background: var(--vscode-list-hoverBackground); }
  .var-name { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-symbolIcon-variableForeground, #9CDCFE); font-weight: 500; white-space: nowrap; width: 120px; }
  .var-val { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; max-height: 80px; overflow: hidden; position: relative; }
  .var-val.expanded { max-height: none; }
  .expand-btn { font-size: 10px; color: var(--vscode-textLink-foreground); cursor: pointer; opacity: 0.7; background: none; border: none; padding: 0 2px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; margin-left: 4px; }
  .badge-ok { background: rgba(50,200,100,0.2); color: #5db; }
  .badge-ng { background: rgba(220,60,60,0.2); color: #e88; }
  .badge-num { background: rgba(100,150,250,0.15); color: #9af; }
  .badge-named { background: rgba(200,150,50,0.15); color: #ec9; }
  .empty { padding: 10px 14px; opacity: 0.45; font-style: italic; font-size: 12px; }
  .hidden { display: none; }
  .env-row td:first-child { color: var(--vscode-symbolIcon-constantForeground, #4ec9b0); }
</style>
</head>
<body>
<header>
  <h1>Variable Inspector</h1>
  <span class="ts" id="ts">—</span>
</header>
<div class="search-bar">
  <input type="text" id="filter" placeholder="Filter variables…" oninput="applyFilter(this.value)">
</div>

<details open id="sec-num">
  <summary>Numbered variables</summary>
  <table class="var-table" id="tbl-num"><tr class="empty-row"><td class="empty" colspan="2">No numbered variables yet.</td></tr></table>
</details>

<details open id="sec-named">
  <summary>Named variables</summary>
  <table class="var-table" id="tbl-named"><tr class="empty-row"><td class="empty" colspan="2">No named variables yet.</td></tr></table>
</details>

<details open id="sec-builtin">
  <summary>Built-in values</summary>
  <table class="var-table" id="tbl-builtin">
    <tr><td class="var-name">{$PREV}</td><td class="var-val" id="bv-prev">—</td></tr>
    <tr><td class="var-name">{$STATUS}</td><td class="var-val" id="bv-status">—</td></tr>
    <tr><td class="var-name">{$CWD}</td><td class="var-val" id="bv-cwd">—</td></tr>
  </table>
</details>

<details id="sec-env">
  <summary>Environment (session)</summary>
  <table class="var-table" id="tbl-env"><tr class="empty-row"><td class="empty" colspan="2">No session env vars set.</td></tr></table>
</details>

<script>
const vscode = acquireVsCodeApi();
let lastFilter = '';

function applyFilter(q) {
  lastFilter = q.toLowerCase();
  document.querySelectorAll('.var-row').forEach(tr => {
    const name = tr.dataset.name || '';
    tr.classList.toggle('hidden', !!q && !name.toLowerCase().includes(lastFilter));
  });
}

function renderTable(tbId, rows, badgeClass) {
  const tb = document.getElementById(tbId);
  if (!rows.length) {
    tb.innerHTML = '<tr class="empty-row"><td class="empty" colspan="2">—</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(([k, v]) => {
    const safe = String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const needExpand = safe.length > 200;
    return '<tr class="var-row' + (lastFilter && !k.toLowerCase().includes(lastFilter) ? ' hidden' : '') + '" data-name="' + k + '">'
      + '<td class="var-name"><span class="badge ' + badgeClass + '">' + k + '</span></td>'
      + '<td class="var-val" id="val-' + k + '">'
      + (needExpand ? safe.slice(0,200) + '<span class="ellipsis">…</span>' : safe)
      + (needExpand ? ' <button class="expand-btn" onclick="toggleExpand(this,\'' + k + '\')">more</button>' : '')
      + '</td></tr>';
  }).join('');
}

function toggleExpand(btn, key) {
  const cell = document.getElementById('val-' + key);
  cell.classList.toggle('expanded');
  btn.textContent = cell.classList.contains('expanded') ? 'less' : 'more';
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type !== 'update') return;

  document.getElementById('ts').textContent = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';

  renderTable('tbl-num',
    Object.entries(msg.num || {}).map(([k,v]) => ['{' + k + '}', v]),
    'badge-num');

  renderTable('tbl-named',
    Object.entries(msg.named || {}).map(([k,v]) => ['{' + k + '}', v]),
    'badge-named');

  const statusEl = document.getElementById('bv-status');
  const code = msg.status ?? 0;
  statusEl.innerHTML = code + ' <span class="badge ' + (code === 0 ? 'badge-ok' : 'badge-ng') + '">' + (code === 0 ? 'OK' : 'FAIL') + '</span>';

  document.getElementById('bv-prev').textContent = (msg.prev || '').slice(0, 400) || '—';
  document.getElementById('bv-cwd').textContent  = msg.cwd || '—';

  renderTable('tbl-env',
    Object.entries(msg.env || {}).map(([k,v]) => [k, v]),
    'badge-named');
  document.querySelectorAll('#tbl-env .var-name').forEach(td => td.classList.add('env-row'));
});
</script>
</body>
</html>`;
}

// =============================================================================
// ② Execution History Browser
// =============================================================================

function historyFilePath(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const base = folder ? folder.uri.fsPath : (safeHome() || os.tmpdir());
    return path.join(base, HISTORY_FILE_NAME);
}

function loadHistory(context: vscode.ExtensionContext): void {
    try {
        const p = historyFilePath();
        if (!fs.existsSync(p)) { return; }
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(raw)) {
            historySessions.push(...raw.slice(0, 50));
        }
    } catch (_) { }
}

function saveHistory(): void {
    try {
        fs.writeFileSync(historyFilePath(), JSON.stringify(historySessions.slice(0, 50), null, 2), 'utf8');
    } catch (_) { }
}

function clearHistory(context: vscode.ExtensionContext): void {
    historySessions.length = 0;
    saveHistory();
    if (historyPanel) { postHistoryData(); }
    vscode.window.showInformationMessage('code-lc4ri: history cleared.');
}

function showHistoryBrowser(context: vscode.ExtensionContext): void {
    if (historyPanel) {
        historyPanel.reveal(vscode.ViewColumn.Beside);
        postHistoryData();
        return;
    }

    historyPanel = vscode.window.createWebviewPanel(
        'lc4riHistory',
        'lc4ri: Execution History',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    historyPanel.webview.html = buildHistoryHtml();
    historyPanel.onDidDispose(() => { historyPanel = undefined; }, null, context.subscriptions);

    // Handle messages from webview (replay / open timeline)
    historyPanel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'openTimeline') {
            showTimeline(context, msg.sessionId);
        }
        if (msg.type === 'clearHistory') {
            clearHistory(context);
        }
    }, null, context.subscriptions);

    postHistoryData();
}

function postHistoryData(): void {
    if (!historyPanel) { return; }
    historyPanel.webview.postMessage({ type: 'history', sessions: historySessions });
}

function buildHistoryHtml(): string {
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
  .session { border-bottom: 1px solid var(--vscode-panel-border); }
  .session-header { padding: 8px 14px; display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .session-header:hover { background: var(--vscode-list-hoverBackground); }
  .session-title { flex: 1; font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-meta { font-size: 11px; opacity: 0.6; white-space: nowrap; }
  .ok-count { color: #5db; background: rgba(50,200,100,0.15); padding: 1px 6px; border-radius: 10px; }
  .ng-count { color: #e88; background: rgba(220,60,60,0.15); padding: 1px 6px; border-radius: 10px; }
  .session-body { display: none; background: var(--vscode-editor-background); padding: 4px 0; }
  .session.open .session-body { display: block; }
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
  .chev { font-size: 10px; transition: transform 0.15s; opacity: 0.5; }
  .session.open .chev { transform: rotate(90deg); }
  .profile-badge { font-size: 10px; padding: 1px 6px; background: rgba(100,150,250,0.15); color: var(--vscode-textLink-foreground); border-radius: 10px; }
</style>
</head>
<body>
<header>
  <h1>Execution History</h1>
  <button class="btn" onclick="clearAll()">Clear All</button>
</header>
<div class="toolbar">
  <input type="text" id="q" placeholder="Search commands…" oninput="applyFilter()">
  <select id="statusFilter" onchange="applyFilter()">
    <option value="">All</option>
    <option value="ok">✅ OK only</option>
    <option value="ng">❌ Failed only</option>
  </select>
</div>
<div id="list"><div class="empty">No history yet. Run some commands first.</div></div>

<script>
const vscode = acquireVsCodeApi();
let sessions = [];

function dur(ms) { return ms < 1000 ? ms + 'ms' : (ms/1000).toFixed(1) + 's'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function applyFilter() {
  const q = document.getElementById('q').value.toLowerCase();
  const sf = document.getElementById('statusFilter').value;
  document.querySelectorAll('.session').forEach(el => {
    const rows = el.querySelectorAll('.cmd-row');
    let visible = 0;
    rows.forEach(r => {
      const cmd = (r.dataset.cmd || '').toLowerCase();
      const ok  = r.dataset.ok === '1';
      const matchQ  = !q  || cmd.includes(q);
      const matchSf = !sf || (sf === 'ok' ? ok : !ok);
      r.classList.toggle('hidden', !(matchQ && matchSf));
      if (matchQ && matchSf) visible++;
    });
    el.classList.toggle('hidden', !!q && visible === 0);
  });
}

function toggleSession(id) {
  const el = document.getElementById('s-' + id);
  if (el) el.classList.toggle('open');
}

function openTimeline(sessionId) {
  vscode.postMessage({ type: 'openTimeline', sessionId });
}

function clearAll() {
  vscode.postMessage({ type: 'clearHistory' });
}

function render() {
  const list = document.getElementById('list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty">No history yet. Run some commands first.</div>';
    return;
  }
  list.innerHTML = sessions.map((s, i) => {
    const file = s.runbookFile ? s.runbookFile.split(/[/\\\\]/).pop() : '—';
    const d = s.endTs && s.startTs ? dur(new Date(s.endTs) - new Date(s.startTs)) : '?';
    const cmds = (s.entries || []).map(e =>
      '<div class="cmd-row' + (lastFilter(e) ? '' : '') + '" data-cmd="' + esc(e.command) + '" data-ok="' + (e.ok ? '1':'0') + '">'
      + '<span class="cmd-icon">' + (e.ok ? '✅' : '❌') + '</span>'
      + '<span class="cmd-text">' + esc(e.command) + '</span>'
      + '<span class="cmd-dur">' + dur(e.endMs - e.startMs) + '</span>'
      + '<span class="cmd-code">exit ' + e.code + '</span>'
      + '</div>'
    ).join('');
    return '<div class="session" id="s-' + s.id + '">'
      + '<div class="session-header" onclick="toggleSession(\'' + s.id + '\')">'
      + '<span class="chev">▶</span>'
      + '<div class="session-title">' + esc(file) + '</div>'
      + '<span class="profile-badge">' + esc(s.profile) + '</span>'
      + '<span class="ok-count">✅ ' + s.totalOk + '</span>'
      + (s.totalFail ? '<span class="ng-count">❌ ' + s.totalFail + '</span>' : '')
      + '<span class="session-meta">' + d + '</span>'
      + '<button class="btn" onclick="event.stopPropagation();openTimeline(\'' + s.id + '\')">Timeline</button>'
      + '</div>'
      + '<div class="session-body">' + (cmds || '<div class="empty" style="padding:8px 14px;">No commands recorded.</div>') + '</div>'
      + '</div>';
  }).join('');
}

function lastFilter(e) { return true; }

window.addEventListener('message', msg => {
  const d = msg.data;
  if (d.type === 'history') { sessions = d.sessions || []; render(); }
});
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

async function searchOutputBlock(startLine?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    // Capture a non-null reference before the first await so TypeScript
    // knows it cannot become undefined inside nested functions below.
    const activeEditor: vscode.TextEditor = editor;

    const q = await vscode.window.showInputBox({
        prompt: 'Search in output block',
        placeHolder: 'keyword…',
        validateInput: v => (v && v.trim().length > 0 ? null : 'Enter a keyword')
    });
    if (!q || !q.trim()) { return; }

    const doc = activeEditor.document;
    // Determine search origin: use provided line, cursor, or scan from top
    const origin = startLine !== undefined ? startLine : activeEditor.selection.active.line;
    let blockStart = -1, blockEnd = -1;

    // Find the nearest ``` fence at or below origin
    for (let i = origin; i < doc.lineCount; i++) {
        if (/^```/.test(doc.lineAt(i).text)) { blockStart = i; break; }
    }
    // Also search above if not found below
    if (blockStart === -1) {
        for (let i = origin - 1; i >= 0; i--) {
            if (/^```/.test(doc.lineAt(i).text)) { blockStart = i; break; }
        }
    }
    if (blockStart === -1) {
        vscode.window.showWarningMessage('code-lc4ri: No output block found near cursor.');
        return;
    }
    for (let i = blockStart + 1; i < doc.lineCount; i++) {
        if (/^```\s*$/.test(doc.lineAt(i).text)) { blockEnd = i; break; }
    }
    if (blockEnd === -1) { blockEnd = doc.lineCount - 1; }

    // Collect all matches
    const matches: vscode.Range[] = [];
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

    function revealMatch(idx: number): void {
        const m = matches[idx];
        activeEditor.selection = new vscode.Selection(m.start, m.end);
        activeEditor.revealRange(m, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        // All matches dimly highlighted; current match brightly highlighted
        activeEditor.setDecorations(decorationType, matches.filter((_, i) => i !== idx));
        activeEditor.setDecorations(focusType, [m]);
    }

    revealMatch(0);

    // Show navigation message
    const label = (i: number) => `${i + 1}/${matches.length}`;
    const prompt = async (): Promise<void> => {
        const pick = await vscode.window.showInformationMessage(
            `code-lc4ri: "${q}" — ${label(currentIdx)} match${matches.length > 1 ? 'es' : ''}`,
            ...(matches.length > 1 ? ['Next ↓', 'Prev ↑'] : []),
            'Clear'
        );
        if (pick === 'Next ↓') {
            currentIdx = (currentIdx + 1) % matches.length;
            revealMatch(currentIdx);
            await prompt();
        } else if (pick === 'Prev ↑') {
            currentIdx = (currentIdx - 1 + matches.length) % matches.length;
            revealMatch(currentIdx);
            await prompt();
        } else {
            decorationType.dispose();
            focusType.dispose();
        }
    };
    await prompt();
}

// =============================================================================
// ④ Execution Timeline (Waterfall)
// =============================================================================

function showTimeline(context: vscode.ExtensionContext, sessionId?: string): void {
    // Determine which entries to show
    let entries: ReportEntry[] = reportEntries;
    let title = 'lc4ri: Timeline (current session)';

    if (sessionId) {
        const sess = historySessions.find(s => s.id === sessionId);
        if (sess) {
            entries = sess.entries;
            title = `lc4ri: Timeline — ${sess.runbookFile.split(/[/\\]/).pop()}`;
        }
    }

    const panel = vscode.window.createWebviewPanel(
        'lc4riTimeline',
        title,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );

    panel.webview.html = buildTimelineHtml(entries);
}

function buildTimelineHtml(entries: ReportEntry[]): string {
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
