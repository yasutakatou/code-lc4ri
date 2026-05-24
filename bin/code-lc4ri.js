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
    let execCount = 0;
    let failures = 0;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];

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

        const expectRe = new RegExp(ext.regTab(execCount));
        if (!expectRe.test(raw)) { execCount = 0; }
        const depthRe = new RegExp(ext.regTab(execCount));
        if (!depthRe.test(raw)) { continue; }

        const body = raw.replace(depthRe, "");
        const { body: noParallelBody, parallel } = ext.detectParallelFlag(body);

        // Runbook include: - include: path/to/other.md
        if (/^include:\s+/i.test(noParallelBody)) {
            const includePath = noParallelBody.replace(/^include:\s+/i, "").trim();
            const inclResolved = path.isAbsolute(includePath) ? includePath : path.join(baseCwd, includePath);
            console.log(`\n[ include: ${inclResolved} ]`);
            const subVars = { num: { ...vars.num }, named: { ...vars.named }, prev: vars.prev, status: vars.status };
            const subFailures = await runFile(inclResolved, subVars, entries, seenFiles);
            failures += subFailures;
            Object.assign(vars.num, subVars.num);
            Object.assign(vars.named, subVars.named);
            vars.prev = subVars.prev;
            vars.status = subVars.status;
            execCount++;
            continue;
        }

        // File open (VS Code only — skip in CLI)
        if (/^open:\s+/i.test(noParallelBody)) {
            console.log(`[open: ${noParallelBody.replace(/^open:\s+/i, "").trim()} — skipped in CLI mode]`);
            execCount++;
            continue;
        }

        // Terminal passthrough: run as a regular command in CLI (no active terminal)
        if (/^!\s+/.test(noParallelBody)) {
            const termCmd = noParallelBody.replace(/^!\s+/, "").trim();
            const sub = ext.applyChangeWord(ext.substituteVars(termCmd, vars), cfg.changeWord);
            const final = ext.applyTemplate(sub, cfg, profile);
            console.log(`▶ [terminal] ${final}`);
            if (dryRun) {
                console.log(`[dry-run] ${final}`);
                execCount++;
            } else {
                const r = await spawnAsync(final);
                const code = r.status;
                const outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
                vars.prev = r.stdout || "";
                vars.status = code;
                entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
                if (code !== 0) { failures++; }
                execCount = code === 0 ? execCount + 1 : 0;
            }
            continue;
        }

        // Assertion: - assert: ...
        const assertHit = ext.parseAssert(noParallelBody);
        if (assertHit) {
            let ok;
            switch (assertHit.kind) {
                case "contains": ok = vars.prev.indexOf(assertHit.arg) !== -1; break;
                case "equals":   ok = vars.prev.trim() === assertHit.arg; break;
                case "status":   ok = vars.status === assertHit.arg; break;
                case "regex":    ok = assertHit.arg.test(vars.prev); break;
            }
            const tag = ok ? "✓ assert" : "✗ ASSERT FAILED";
            console.log(`${tag}: ${noParallelBody}`);
            if (!ok) { failures++; execCount = 0; }
            continue;
        }

        // Parallel group: - [parallel] cmd
        if (parallel) {
            const depth = execCount;
            const parallelItems = [noParallelBody];

            let j = i + 1;
            while (j < lines.length) {
                if (!depthRe.test(lines[j])) { break; }
                const nextRawBody = lines[j].replace(depthRe, "");
                const { body: nextBody, parallel: nextParallel } = ext.detectParallelFlag(nextRawBody);
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
                execCount = depth + 1;
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
            execCount = allOk ? depth + 1 : 0;
            continue;
        }

        // Regular command
        const sub = ext.applyChangeWord(ext.substituteVars(noParallelBody, vars), cfg.changeWord);
        const final = ext.applyTemplate(sub, cfg, profile);
        console.log(`▶ ${final}`);
        let outText = "";
        let code = 0;
        if (dryRun) {
            outText = `[dry-run] ${final}`;
            console.log(outText);
        } else {
            const r = await spawnAsync(final);
            outText = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : "");
            code = r.status;
            vars.prev = r.stdout || "";
            vars.status = code;
            if (code !== 0) { failures++; }
        }
        entries.push({ command: final, output: outText, code, ts: new Date().toISOString(), ok: code === 0 });
        execCount = (code === 0 || dryRun) ? execCount + 1 : 0;
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
