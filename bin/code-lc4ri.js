#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * code-lc4ri CLI runner
 * ---------------------------------------------------------------------------
 * Re-uses the parser from extension.ts so a Markdown LC4RI document can be
 * executed headlessly (e.g. in CI). Designed to share semantics with the
 * VS Code command of the same name.
 *
 *   $ npx code-lc4ri run path/to/runbook.md
 *   $ npx code-lc4ri run runbook.md --dry-run
 *   $ npx code-lc4ri run runbook.md --profile prod-ssh --report report.html
 *
 * NOTE: when run from source you must compile first (`npm run compile`).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

// We require the compiled output: the same parser the extension uses.
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
    if (req === "vscode") { return require.resolve("./vscode-stub.js"); }
    return origResolve.call(this, req, ...rest);
};

let ext;
try {
    ext = require(path.resolve(__dirname, "..", "out", "extension.js"));
} catch (e) {
    console.error("code-lc4ri: please run `npm run compile` first.");
    process.exit(2);
}

function usage() {
    console.log(`Usage:
  code-lc4ri run <file.md> [--dry-run] [--profile NAME] [--report FILE]
  code-lc4ri --help`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] !== "run") { usage(); process.exit(1); }
const file = args[1];
if (!file) { usage(); process.exit(1); }

const dryRun  = args.includes("--dry-run");
const profIdx = args.indexOf("--profile");
const profile = profIdx > -1 ? args[profIdx + 1] || "" : "";
const repIdx  = args.indexOf("--report");
const report  = repIdx > -1 ? args[repIdx + 1] : null;

const cfg = {
    timeout: 30000,
    template: {},
    profiles: {},
    changeWord: {},
    toutf8: true,
    toterminal: false,
    outputFormat: "codeblock",
    dangerousPatterns: ext.DEFAULT_DANGEROUS_PATTERNS,
    allowList: [],
    denyList: [],
    confirmDangerous: false,
    showCodeLens: false,
    shell: null
};

// ---------------------------------------------------------------------------
// Random filename generator for auto-write blocks (```yaml / ```conf / ```json
// with no explicit path) — mirrors extension.ts's generateRandomAlpha().
// ---------------------------------------------------------------------------
function randomAlpha(length) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ---------------------------------------------------------------------------
// Async spawn helper (streaming stdout to console, returns full output)
// ---------------------------------------------------------------------------
function spawnAsync(cmd) {
    return new Promise((resolve) => {
        const child = spawn(cmd, { shell: true });
        let stdoutBuf = Buffer.alloc(0);
        let stderrBuf = Buffer.alloc(0);
        const timer = setTimeout(() => child.kill("SIGKILL"), cfg.timeout);

        child.stdout.on("data", (b) => {
            stdoutBuf = Buffer.concat([stdoutBuf, b]);
            process.stdout.write(b);
        });
        child.stderr.on("data", (b) => {
            stderrBuf = Buffer.concat([stderrBuf, b]);
            process.stderr.write(b);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ stdout: stdoutBuf.toString(), stderr: stderrBuf.toString(), status: code ?? -1 });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ stdout: "", stderr: String(err), status: -1 });
        });
    });
}

// ---------------------------------------------------------------------------
// prompt: directive — CLI has no VS Code input box. Prefer an environment
// variable named after the binding (handy for CI); fall back to an
// interactive readline prompt when stdin is a TTY; otherwise fail loudly.
// (Secret masking is not implemented in this fallback.)
// ---------------------------------------------------------------------------
function promptForValue(bindName, message, secret) {
    return new Promise((resolve) => {
        if (process.env[bindName] !== undefined) {
            console.log(`[ prompt: {${bindName}} ] using value from environment variable ${bindName}`);
            resolve(process.env[bindName]);
            return;
        }
        if (!process.stdin.isTTY) {
            console.error(`[ prompt: {${bindName}} ] no TTY and no ${bindName} env var set; cannot prompt in non-interactive mode`);
            resolve(null);
            return;
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${message}${secret ? " (secret)" : ""} [{${bindName}}]: `, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// ---------------------------------------------------------------------------
// Recursive file runner
// ---------------------------------------------------------------------------
async function runFile(filePath, vars, entries, seenFiles) {
    const resolved = path.resolve(filePath);
    if (seenFiles.has(resolved)) {
        console.error(`[include: circular reference detected: ${resolved}]`);
        return 0;
    }
    seenFiles.add(resolved);

    const text = fs.readFileSync(resolved, "utf8");
    const lines = text.split(/\r\n|\r|\n/);
    const baseCwd = path.dirname(resolved);
    // execCount is a *ceiling*: any list line whose indentation depth is <=
    // execCount is reachable (this allows several sibling steps at the same
    // depth to run one after another, not just a single child before you
    // must go one level deeper). It advances to (depth + 1) after a
    // successful step at that depth, and resets to 0 on failure.
    let execCount = 0;
    let failures = 0;

    for (let i = 0; i < lines.length; i++) {
        const cont = ext.joinContinuedLines(lines, i);
        const raw = ext.normalizeIndent(cont.joined);
        if (cont.consumed > 1) { i += cont.consumed - 1; }

        if (ext.horizonCheck(raw)) { execCount = 0; continue; }

        // Env file directive: # env: <path>
        const envMatch = raw.match(/^#\s*env:\s*(.+)$/);
        if (envMatch) {
            const envPath = envMatch[1].trim();
            const envResolved = path.isAbsolute(envPath) ? envPath : path.join(baseCwd, envPath);
            try {
                const content = fs.readFileSync(envResolved, "utf8");
                Object.assign(vars.named, ext.parseEnvFile(content));
                console.log(`[lc4ri] loaded env: ${envResolved}`);
            } catch (_) {
                console.error(`[lc4ri] env file not found: ${envResolved}`);
            }
            continue;
        }

        // Fenced block auto-exec: ```bash / ```zsh / ```sh / ```yaml / ```conf / ```json
        // (mirrors extension.ts's fenceExecMatch — v1.3 "Code Block Execution and Auto-Write")
        const fenceMatch = raw.match(/^([ \t]*)(`{3,}|~{3,})\s*(bash|zsh|sh|yaml|conf|json)\b(?:\s+(.+))?\s*$/i);
        if (fenceMatch) {
            let fenceDepth = 0;
            for (const c of fenceMatch[1]) { if (c === "\t") { fenceDepth++; } }
            if (fenceDepth > execCount) { execCount = 0; continue; }

            const lang = fenceMatch[3].toLowerCase();
            const argPath = fenceMatch[4] ? fenceMatch[4].trim() : "";
            const blk = ext.collectFencedBlock(lines, i);
            if (blk.content === null) { continue; }

            if (["yaml", "conf", "json"].includes(lang)) {
                const isRandom = !argPath;
                const extName = lang === "conf" ? "conf" : lang;
                const filename = argPath || `${randomAlpha(8)}.${extName}`;
                const resolved = path.isAbsolute(filename) ? filename : path.join(baseCwd, filename);
                const rendered = ext.substituteVars(blk.content, vars);
                const n = rendered.split("\n").length;
                const tag = isRandom ? " (auto-generated)" : "";
                if (dryRun) {
                    console.log(`[ write: ${filename}${tag} ] [dry-run] would write ${n} line(s) to ${resolved}`);
                } else {
                    fs.mkdirSync(path.dirname(resolved), { recursive: true });
                    fs.writeFileSync(resolved, rendered + "\n", "utf8");
                    console.log(`[ write: ${filename}${tag} ] wrote ${n} line(s) to ${resolved}`);
                    entries.push({ command: `write: ${filename}`, output: `wrote ${n} line(s) to ${resolved}`, code: 0, ts: new Date().toISOString(), ok: true });
                }
                execCount = fenceDepth + 1;
            } else {
                const blockLines = blk.content.split(/\r?\n/);
                const logicalCommands = [];
                for (let b = 0; b < blockLines.length; b++) {
                    let cmd = blockLines[b];
                    while (/\\\s*$/.test(cmd) && b + 1 < blockLines.length) {
                        cmd = cmd.replace(/\\\s*$/, "") + blockLines[b + 1];
                        b++;
                    }
                    const trimmed = cmd.trim();
                    if (trimmed.length > 0 && !trimmed.startsWith("#")) { logicalCommands.push(trimmed); }
                }

                execCount = fenceDepth + 1;
                for (const rawCmd of logicalCommands) {
                    const sub = ext.applyChangeWord(ext.substituteVars(rawCmd, vars), cfg.changeWord);
                    const final = ext.applyTemplate(sub, cfg, profile);
                    console.log(`▶ ${final}`);
                    if (dryRun) {
                        console.log(`[dry-run] ${final}`);
                        continue;
                    }
                    const r = await spawnAsync(final);
                    const code = r.status;
                    const outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
                    vars.prev = r.stdout || "";
                    vars.status = code;
                    entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
                    if (code !== 0) {
                        failures++;
                        execCount = 0;
                        break;
                    }
                }
            }
            i += blk.consumed - 1;
            continue;
        }

        // Numbered assignment: 1. cmd
        const numHit = ext.detectNumbered(raw);
        if (numHit) {
            const sub = ext.substituteVars(numHit.body, vars);
            const final = ext.applyTemplate(sub, cfg, profile);
            if (dryRun) { vars.num[numHit.idx] = `[dry-run] ${final}`; continue; }
            const r = await spawnAsync(final);
            vars.num[numHit.idx] = (r.stdout || r.stderr || "").trim();
            vars.prev = r.stdout || "";
            vars.status = r.status;
            continue;
        }

        // prompt: {VAR} message  (checked pre-substitution, like extension.ts)
        const promptDir = ext.parsePromptDirective(raw);
        if (promptDir) {
            const { depth, bindName, message, secret } = promptDir;
            if (depth > execCount) { execCount = 0; continue; }

            if (dryRun) {
                console.log(`[ prompt: {${bindName}} ] [dry-run] would prompt: ${message}`);
                execCount = depth + 1;
                continue;
            }
            const val = await promptForValue(bindName, message, secret);
            if (val === null) {
                console.error(`[ prompt: {${bindName}} ] cancelled / unavailable`);
                failures++;
                execCount = 0;
            } else {
                vars.named[bindName] = val;
                console.log(`[ prompt: {${bindName}} ] input received`);
                execCount = depth + 1;
            }
            continue;
        }

        // Substitute {VAR}/{$VAR} and changeWord mappings once, then reuse for
        // everything else on this line (write:, assert:, include:, commands...).
        const subLine = ext.applyChangeWord(ext.substituteVars(raw, vars), cfg.changeWord);

        // write: path  +  fenced block on the following line(s)
        const writeDir = ext.parseWriteDirective(subLine);
        if (writeDir) {
            const { depth, filePath: wPath } = writeDir;
            if (depth > execCount) { execCount = 0; continue; }

            const blk = ext.collectFencedBlock(lines, i + 1);
            const wResolved = path.isAbsolute(wPath) ? wPath : path.join(baseCwd, wPath);
            if (blk.content === null) {
                console.error(`[ write: ${wPath} ] no fenced block found after write:`);
                failures++;
                execCount = 0;
                continue;
            }
            // {VAR} placeholders in the written content (e.g. from a preceding
            // prompt:) must be substituted with the *current* variables.
            const rendered = ext.substituteVars(blk.content, vars);
            const n = rendered.split("\n").length;
            if (dryRun) {
                console.log(`[ write: ${wPath} ] [dry-run] would write ${n} line(s) to ${wResolved}`);
            } else {
                try {
                    fs.mkdirSync(path.dirname(wResolved), { recursive: true });
                    fs.writeFileSync(wResolved, rendered + "\n", "utf8");
                    console.log(`[ write: ${wPath} ] wrote ${n} line(s) to ${wResolved}`);
                    entries.push({ command: `write: ${wPath}`, output: `wrote ${n} line(s) to ${wResolved}`, code: 0, ts: new Date().toISOString(), ok: true });
                } catch (err) {
                    console.error(`[ write: ${wPath} ] error: ${String(err)}`);
                    failures++;
                    execCount = 0;
                    i += blk.consumed;
                    continue;
                }
            }
            i += blk.consumed;
            execCount = depth + 1;
            continue;
        }

        const listMatch = subLine.match(/^(\t*)- /);
        if (!listMatch) { continue; }
        const curDepth = listMatch[1].length;
        if (curDepth > execCount) { execCount = 0; continue; }

        const body = subLine.replace(/^\t*- /, "");
        const { body: noRetryBody, retryCount, retryInterval } = ext.detectRetryFlag(body);
        const { body: cleanBody, parallel } = ext.detectParallelFlag(noRetryBody);

        // Assertion: - assert: ...  (depth already validated above)
        const assertHit = ext.parseAssert(cleanBody);
        if (assertHit) {
            let ok;
            switch (assertHit.kind) {
                case "contains": ok = vars.prev.indexOf(assertHit.arg) !== -1; break;
                case "equals":   ok = vars.prev.trim() === assertHit.arg; break;
                case "status":   ok = vars.status === assertHit.arg; break;
                case "regex":    ok = assertHit.arg.test(vars.prev); break;
            }
            const tag = ok ? "✓ assert" : "✗ ASSERT FAILED";
            console.log(`${tag}: ${cleanBody}`);
            if (!ok) { failures++; execCount = 0; } else { execCount = curDepth + 1; }
            continue;
        }

        // Runbook include: - include: path/to/other.md
        if (/^include:\s+/i.test(cleanBody)) {
            const includePath = cleanBody.replace(/^include:\s+/i, "").trim();
            const inclResolved = path.isAbsolute(includePath) ? includePath : path.join(baseCwd, includePath);
            console.log(`\n[ include: ${inclResolved} ]`);
            const subVars = { num: { ...vars.num }, named: { ...vars.named }, prev: vars.prev, status: vars.status };
            const subFailures = await runFile(inclResolved, subVars, entries, seenFiles);
            failures += subFailures;
            Object.assign(vars.num, subVars.num);
            Object.assign(vars.named, subVars.named);
            vars.prev = subVars.prev;
            vars.status = subVars.status;
            execCount = curDepth + 1;
            continue;
        }

        // File open (VS Code only — skip in CLI)
        if (/^open:\s+/i.test(cleanBody)) {
            console.log(`[open: ${cleanBody.replace(/^open:\s+/i, "").trim()} — skipped in CLI mode]`);
            execCount = curDepth + 1;
            continue;
        }

        // Terminal passthrough: run as a regular command in CLI (no active terminal)
        if (/^!\s+/.test(cleanBody)) {
            const termCmd = cleanBody.replace(/^!\s+/, "").trim();
            const final = ext.applyTemplate(termCmd, cfg, profile);
            console.log(`▶ [terminal] ${final}`);
            if (dryRun) {
                console.log(`[dry-run] ${final}`);
                execCount = curDepth + 1;
            } else {
                const r = await spawnAsync(final);
                const code = r.status;
                const outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
                vars.prev = r.stdout || "";
                vars.status = code;
                entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
                if (code !== 0) { failures++; }
                execCount = code === 0 ? curDepth + 1 : 0;
            }
            continue;
        }

        // Parallel group: - [parallel] cmd
        if (parallel) {
            const depthRe = new RegExp(ext.regTab(curDepth));
            const parallelItems = [cleanBody];

            let j = i + 1;
            while (j < lines.length) {
                const nextRaw = ext.normalizeIndent(lines[j]);
                if (!depthRe.test(nextRaw)) { break; }
                const nextRawBody = nextRaw.replace(depthRe, "");
                const { body: nextNoRetryBody } = ext.detectRetryFlag(nextRawBody);
                const { body: nextBody, parallel: nextParallel } = ext.detectParallelFlag(nextNoRetryBody);
                if (!nextParallel) { break; }
                parallelItems.push(nextBody);
                j++;
            }
            i = j - 1;

            if (dryRun) {
                for (const pb of parallelItems) {
                    const final = ext.applyTemplate(ext.applyChangeWord(ext.substituteVars(pb, vars), cfg.changeWord), cfg, profile);
                    console.log(`▶ [parallel][dry-run] ${final}`);
                }
                execCount = curDepth + 1;
                continue;
            }

            const tasks = parallelItems.map(async (pb) => {
                const sub = ext.applyChangeWord(ext.substituteVars(pb, vars), cfg.changeWord);
                const final = ext.applyTemplate(sub, cfg, profile);
                console.log(`▶ [parallel] ${final}`);
                const r = await spawnAsync(final);
                const code = r.status;
                const outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
                entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
                return { code, stdout: r.stdout };
            });

            const results = await Promise.all(tasks);
            const allOk = results.every(r => r.code === 0);
            if (!allOk) { failures += results.filter(r => r.code !== 0).length; }
            vars.prev = results[results.length - 1]?.stdout || "";
            vars.status = results[results.length - 1]?.code ?? 0;
            execCount = allOk ? curDepth + 1 : 0;
            continue;
        }

        // Regular command, with optional [retry: N, Ns] support
        const final = ext.applyTemplate(cleanBody, cfg, profile);
        console.log(`▶ ${final}${retryCount > 0 ? ` [retry up to ${retryCount}x every ${retryInterval}ms]` : ""}`);
        let outText = "";
        let code = 0;
        if (dryRun) {
            outText = `[dry-run] ${final}`;
            console.log(outText);
        } else {
            const maxAttempts = retryCount > 0 ? retryCount + 1 : 1;
            let attempts = 0;
            let r;
            do {
                if (attempts > 0) {
                    console.log(`[retry ${attempts}/${retryCount}] waiting ${retryInterval}ms...`);
                    await new Promise((res) => setTimeout(res, retryInterval));
                }
                r = await spawnAsync(final);
                attempts++;
            } while (r.status !== 0 && attempts < maxAttempts);
            outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
            code = r.status;
            vars.prev = r.stdout || "";
            vars.status = code;
            if (code !== 0) { failures++; }
        }
        entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
        execCount = (code === 0 || dryRun) ? curDepth + 1 : 0;
    }

    seenFiles.delete(resolved);
    return failures;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function main() {
    const vars = { num: {}, named: {}, prev: "", status: 0 };
    const entries = [];
    const seenFiles = new Set();

    const failures = await runFile(file, vars, entries, seenFiles);

    if (report) {
        const isHtml = report.endsWith(".html");
        if (isHtml) {
            const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
            const rows = entries.map(e => `<section class="${e.ok?'ok':'ng'}"><h3>${esc(e.command)}</h3><pre>${esc(e.output)}</pre></section>`).join("\n");
            fs.writeFileSync(report, `<!doctype html><meta charset=utf-8><style>section{border-left:4px solid #aaa;padding:.5em 1em;margin:1em 0}.ok{border-color:#3a3}.ng{border-color:#c33}pre{background:#111;color:#eee;padding:1em;overflow:auto}</style><h1>lc4ri report</h1>${rows}`);
        } else {
            let md = `# lc4ri report\n\n`;
            for (const e of entries) {
                md += `## ${e.ok?'✅':'❌'} ${e.command}\n\n\`\`\`\n${e.output}\n\`\`\`\n\n`;
            }
            fs.writeFileSync(report, md);
        }
        console.log(`report written to ${report}`);
    }

    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
