# code-lc4ri

<!-- # Short Description -->

**code-lc4ri: Markdown + LC4RI for VS Code**

<!-- # Badges -->

[![Github issues](https://img.shields.io/github/issues/yasutakatou/code-lc4ri)](https://github.com/yasutakatou/code-lc4ri/issues)
[![Github forks](https://img.shields.io/github/forks/yasutakatou/code-lc4ri)](https://github.com/yasutakatou/code-lc4ri/network/members)
[![Github stars](https://img.shields.io/github/stars/yasutakatou/code-lc4ri)](https://github.com/yasutakatou/code-lc4ri/stargazers)
[![Github top language](https://img.shields.io/github/languages/top/yasutakatou/code-lc4ri)](https://github.com/yasutakatou/code-lc4ri/)
[![Github license](https://img.shields.io/github/license/yasutakatou/code-lc4ri)](https://github.com/yasutakatou/code-lc4ri/)

# Tags

`vscode` `vscode-extension` `typescript` `nodejs` `lc4ri` `markdown`

# Demo

![lc4ri](https://github.com/yasutakatou/code-lc4ri/raw/pic/lc4ri2.gif)

Do you often use "**jupyter notebook**" when choosing a documentation tool for your operations manual?<br>
But, this include problems<br>

 - document used splited to like a card. So, when insert document, insert card every. I don't fit in this operation.
 - In case of operation of the order, I have to switch the cards up and down. I wish to edit like a text editer.
 - I wish to use ecosystem(lint tool, etc). But, not easy preparation.

jupyter is very excellent tool, but I know more usefull for text edit. **it's VSCode!**<br>
My idea is, **Markdown + LC4RI on VSCode's ecosystem** is more better solution!<br>

# Advantages

This extention, usually write markdown document. and additional commands can be executed.

- write document on markdown format.
- **list format on markdown is can run command**.
- **command output to auto apply to document**.
- **can use variable**.

# Installation

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=yasutakatou.code-lc4ri)

[download vsix from release page](https://github.com/yasutakatou/code-lc4ri/releases).<br>
save vsix file, [install how to](https://code.visualstudio.com/docs/editor/extension-gallery#_install-from-a-vsix).<br>

# uninstall

[uninstalld extension](https://code.visualstudio.com/docs/editor/extension-gallery#_uninstall-an-extension).<br>

# use case

## recommendation

set **keybindings.json**, enable it's shortcut do.

```
[
	{
		"key": "ctrl+shift+a",
		"command": "extension.lc4ri",
		"args": "code-lc4ri: LC4RI for VS Code"
	}
]
```

## formats

[Basic. You can write markdown usually](https://www.markdownguide.org/basic-syntax/), but it's can run following.<br>
run this extension, line search, if match rule line, run commands. **start line is editor's cursor position**.

### list format

- **list strings can be run**. 

```
- ls
```

![1](https://github.com/yasutakatou/code-lc4ri/raw/pic/1.png)

note) If not exists code section after list, will **create code section and output to it**.<br>
note) **Tab indents** means, If command success is **next indent run. (AND rule)**<br>

```
- ls existsfile.txt
	- rm existsfile.txt
```

If "ls existsfile.txt" is success, next indent run.

### horizon line

If you write horizon line, **split commands**.

```
- ls

*** 

- uname
````

![2](https://github.com/yasutakatou/code-lc4ri/raw/pic/2.png)

![3](https://github.com/yasutakatou/code-lc4ri/raw/pic/3.png)

note) In this case, run command to the horizon line.

### variable

**number list is create variable value**.

```
1. uname
```

create variable **{1}**.

```
- echo {1}
```

variable **{1}** output.

![4](https://github.com/yasutakatou/code-lc4ri/raw/pic/4.png)

note) variable can use **1-9 integer**.

### file open (v0.91-)

To the top "!" at the beginning opens the specified file in a new tab

```
- ! \code.txt
```

![image](https://github.com/user-attachments/assets/b30a49ea-4df4-4d20-a2eb-d0f0fb0f90a0)

# v0.5: "config file" support!

This extension easier use, support config file.

# sample setting

json format.

```
{
  "timeout": 10000,
  "template": {
    "linux": "ssh user@192.168.0.1 {COMMAND}"
  },
  "changeWord": {
    "#HOME#": "/home/user"
  },
  "toutf8": true,
  "toterminal": true
}
```

## file create

**If does not exist, it will be created** in the following folder.

- Windows
	- %USERPROFILE%/.code-lc4ri/config.json
		- ex) C:\Users\(USER NAME)\.code-lc4ri\config.json
- Other OS
	- $HOME/.code-lc4ri/config.json
		- ex) /home/user/.code-lc4ri/config.json

## file load

When **VSCode run**, loading config.

## options

options detail following.

### timeout

This option is the **timeout time** when the command is executed.<br>
Units are in **milliseconds**.

10000 -> 10 seconds.

### template

This option is **default commands template**, and can be defined on a per-OS.<br>
For example, you want to execute every commands on SSH destination.<br>
In case of can set this option.<br>

```
	"OS type":"template"
```

"OS Type" is following.<br>

[process.platform](https://nodejs.org/api/process.html#process_process_platform)

**{COMMAND}** included the original commands.

```
	"linux": "ssh user@192.168.0.1 {COMMAND}"
```

- normal
	- \- ls
- define
	- ssh user@192.168.0.1 "{COMMAND}"
- execute commands
	- ssh user@192.168.0.1 ls

### chageWord

This option is **convert keywords list**.<br>
If server address changes often, If you don't want to use commands that are dangerous to execute.<br>
In case of can set this option.<br>
Defines a set of words before and after conversion.<br>

```
	"pre word": "after word"
```

- normal
	- \- ls #HOME#
- define
	- "#HOME#": "/home/user"
- execute commands
	- ls /home/user

### toutf8 (v0.91-)

If set to **false**, force UTF-8 conversion process to be skipped (default is **true**)<br>
However, it is not working properly on my Windows...

### toterminal (v0.91-)

If true, the command execution results are not returned to the markdown, but are **executed directly on the open terminal**.<br>

![image](https://github.com/user-attachments/assets/82413d23-a4eb-48c1-bd89-3b9b2362c300)

# v0.6: executed time auto print.

![5](https://github.com/yasutakatou/code-lc4ri/raw/pic/5.png)

It can be used as evidence of execution time.

<br>

---

# v1.0: major refactor — what's new

This release rewrites the core runner. **All existing v0.x documents keep working** (list / number list / `***` separator / `! file` / `template` / `changeWord` / `toutf8` / `toterminal` are unchanged). The new features are additive.

## 1. Asynchronous execution + progress + cancel

The old `execSync` loop is gone. Commands are now spawned and the UI no longer freezes.

- A toast appears in the bottom-right showing the currently running command.
- The toast has a **Cancel** button. Clicking it sends `SIGTERM` to every running child process.
- Timeouts are still honoured (`lc4ri.timeout`), but a timeout now records `[timeout after Nms]` in the output instead of throwing.
- Non-zero exits are recorded as `[exit N]`.

New command: `code-lc4ri: Cancel running commands` (`extension.lc4ri.cancel`).

## 2. Inline ▶ Run / Dry-run buttons (CodeLens)

Every `- command` / `1. command` line in a Markdown file gets an inline action:

```
▶ Run | Dry-run
- uname -a
```

You no longer need to move the cursor and trigger the global shortcut for a one-off line. Disable with `"lc4ri.showCodeLens": false`.

## 3. settings.json migration (backward-compatible)

The extension now reads its configuration from **VS Code settings** first, then falls back to the legacy `~/.code-lc4ri/config.json`. Both work. Settings UI is auto-generated.

```jsonc
// settings.json
{
  "lc4ri.timeout": 15000,
  "lc4ri.profiles": {
    "prod-ssh": "ssh ops@prod.example.com {COMMAND}",
    "docker":   "docker exec -i app sh -c \"{COMMAND}\""
  },
  "lc4ri.changeWord": { "#HOME#": "/home/user" },
  "lc4ri.outputFormat": "collapsible",
  "lc4ri.confirmDangerous": true,
  "lc4ri.showCodeLens": true
}
```

Other hardening: `JSON.parse` failures no longer crash activation, `workspaceFolders` is null-checked, `err.stderr` is no longer assumed to be a string.

## 4. Workspace Trust + dangerous-command guard

- The extension declares `"untrustedWorkspaces": { "supported": "limited" }` — in **Restricted Mode**, only dry-run is allowed. This blocks "open the doc → it runs `rm -rf /`" attacks.
- Commands matching `lc4ri.dangerousPatterns` raise a modal confirmation. A reasonable default list ships out of the box (`rm -rf /`, `dd if=`, `mkfs.`, fork bombs, `curl | sh`, raw block-device writes, etc.).
- `lc4ri.denyList` flatly refuses matching commands; `lc4ri.allowList`, when non-empty, only lets matching commands run. Both accept JavaScript regex strings.
- Every executed command is mirrored to the **code-lc4ri** Output channel for auditing.

## 5. Named variables, built-ins, output binding

Previously variables were limited to `{1}` … `{9}`. Now:

| syntax | meaning |
|---|---|
| `1. cmd → {host}` | bind the output of the numbered command to **both** `{1}` and `{host}` |
| `- cmd → {files}` | bind the output of a list command to `{files}` |
| `{$PREV}` | stdout of the previous command |
| `{$STATUS}` | exit code of the previous command |
| `{$DATE}` / `{$CWD}` / `{$USER}` / `{$HOST}` | runtime values |

Example:

```markdown
1. hostname → {host}
- echo working on {host}
- false
- assert: status == 1
```

## 6. Assertions (`- assert: ...`)

Verify the previous command's output / exit code inside an indented chain:

```markdown
- curl -s http://api.local/health
    - assert: contains "ok"
    - assert: status == 0
    - assert: regex /version: \d+/
```

Assertion outcomes are written into the output block (`✓ pass` / `✗ FAIL`) and a failure breaks the AND-chain just like a failed command does.

## 7. Status-bar profile switcher

A `lc4ri: <profile>` item appears on the right side of the status bar. Click it to pick a profile defined in `lc4ri.profiles`. The active profile wraps each command with its `{COMMAND}` template — useful for SSH / Docker / kubectl context switching without editing the doc.

The legacy per-OS `template` still applies when no profile is selected.

## 8. Report export

Generate a timestamped execution report from this session:

- `code-lc4ri: Export execution report (HTML)` → styled HTML with ✓/✗ markers per command.
- `code-lc4ri: Export execution report (Markdown)` → plain Markdown.

The report contains every command executed since activation (including timestamps and exit codes) — useful as operational evidence or as a CI artefact.

## 9. CLI runner (headless / CI)

A `code-lc4ri` binary is shipped that re-uses the same parser:

```
npx code-lc4ri run runbook.md
npx code-lc4ri run runbook.md --dry-run
npx code-lc4ri run runbook.md --profile prod-ssh --report report.html
```

Exit code is non-zero if any command failed or any `assert:` failed, so it slots into CI directly. Run `npm run compile` once before using the CLI from source.

## 10. New commands cheatsheet

| Command | What it does |
|---|---|
| `extension.lc4ri` | Run from cursor (the original behaviour) |
| `extension.lc4ri.dryRun` | Run from cursor, but only show the resolved commands |
| `extension.lc4ri.runLine` | Run a single line (used by CodeLens) |
| `extension.lc4ri.cancel` | Cancel every running child process |
| `extension.lc4ri.switchProfile` | Pick an execution profile |
| `extension.lc4ri.clearOutput` | Empty the nearest ```` ``` ```` block below the cursor |
| `extension.lc4ri.exportReport` | Export an HTML report |
| `extension.lc4ri.exportReportMd` | Export a Markdown report |

## 11. New settings cheatsheet

| Key | Default | Description |
|---|---|---|
| `lc4ri.timeout` | `10000` | Per-command timeout in ms |
| `lc4ri.template` | `{}` | Legacy per-OS template (`{ "linux": "ssh u@h {COMMAND}" }`) |
| `lc4ri.profiles` | `{}` | Named profiles selectable from the status bar |
| `lc4ri.changeWord` | `{}` | Pre→post substitution map |
| `lc4ri.toUtf8` | `true` | Auto-detect encoding and convert to UTF-8 |
| `lc4ri.toTerminal` | `false` | Send to active terminal instead of capturing |
| `lc4ri.outputFormat` | `codeblock` | `codeblock` or `collapsible` (uses `<details>`) |
| `lc4ri.dangerousPatterns` | _(see below)_ | Regex patterns that prompt a confirmation |
| `lc4ri.allowList` | `[]` | If non-empty, only matching commands run |
| `lc4ri.denyList` | `[]` | Matching commands never run |
| `lc4ri.confirmDangerous` | `true` | Show a modal for dangerous matches |
| `lc4ri.showCodeLens` | `true` | Show ▶ Run / Dry-run on list lines |
| `lc4ri.shell` | `null` | Shell binary (null = system default) |

Default dangerous patterns: `rm -rf /`, `dd if=`, `mkfs.`, `shutdown`, `reboot`, fork bombs, `curl|sh`, `wget|sh`, `> /dev/sd*`.

## 12. Developer-side changes

- `engines.vscode` raised to `^1.74.0`; `@types/vscode` and `@types/node` updated; `typescript` bumped to 5.x; `eslint` to 8.x; redundant `iconv` / `iconv-lite` / `jschardet` removed.
- Pure helpers (`regTab`, `horizonCheck`, `detectListCommand`, `detectNumbered`, `extractBinding`, `substituteVars`, `applyChangeWord`, `applyTemplate`, `checkSecurity`, `parseAssert`) are now `export`ed.
- `npm test` runs a stand-alone Node test runner (`src/test/runUnit.ts`) over those helpers — 32 cases, no `vscode` host required.

## 13. Migration notes

Nothing to do — your existing documents and `~/.code-lc4ri/config.json` keep working as before. To opt into the new features, add the relevant `lc4ri.*` keys to your `settings.json`. To migrate **off** the legacy file entirely, copy its contents under the matching `lc4ri.*` keys and delete the file.

<br>

---

# v1.1: New features

## 1. Command execution prefix

Prefix your prompt to control how Bash calls are dispatched in the current turn:

| Prefix | Behavior |
|---|---|
| `& <message>` | All Bash calls in this turn run in **background** |
| `! <command>` | Run directly in the **user's terminal** (Claude Code built-in) |
| _(none)_ | Normal **foreground** execution (default) |

## 2. `.env` file loading

Write the following anywhere in a runbook to load environment variables from a file:

```markdown
# env: .env.prod
- echo {DB_HOST}
```

`parseEnvFile()` is exported and usable from the CLI as well.

## 3. Runbook include

Inline-execute another Markdown file. Variable bindings set inside the included file propagate back to the parent scope:

```markdown
- include: setup.md
- echo setup complete
```

Circular references are detected and blocked by the CLI.

## 4. Parallel execution

Lines prefixed with `[parallel]` are grouped and executed with `Promise.all`:

```markdown
- [parallel] ssh server1 uptime
- [parallel] ssh server2 uptime
- [parallel] ssh server3 uptime
```

All commands must succeed for the AND-chain to continue; one failure resets it.

## 5. File open and terminal send directives

| Runbook syntax | Behavior |
|---|---|
| `- ! path.md` / `- open: path.md` | Open the file in a **new VS Code tab** |
| `- ! command` | Send to the **active terminal** (no output capture) |

Terminal send uses `vscode.window.activeTerminal?.sendText()`. In CLI mode `- ! command` runs as a normal shell command.

## 6. AND-chain indent fix (`tabWidth` default changed to 2)

`DEFAULT_INDENT_SPACES` was changed from **4 to 2** so that standard 2-space Markdown indentation maps correctly to AND-chain depth:

| Spaces | Old (tabWidth=4) | New (tabWidth=2) |
|---|---|---|
| 2 spaces | depth 1 | depth 1 |
| 4 spaces | depth 1 ← bug | depth 2 ✓ |
| 6 spaces | depth 2 | depth 3 |

Example:

```markdown
- echo a       ← depth 0: always runs
  - echo b     ← depth 1: runs only if a succeeds
    - echo c   ← depth 2: runs only if b succeeds
- echo d       ← depth 0: always runs
```

Users who prefer 4-space indentation can restore the previous behaviour with `"lc4ri.tabWidth": 4`.

## 7. `write:` directive

Write the contents of a fenced code block to a file directly from a runbook:

````markdown
- write: output/config.yaml
  ```yaml
  database:
    host: localhost
    port: 5432
  ```
````

- The fenced block (`` ``` `` or `~~~`) content is written verbatim to the specified file.
- Variable substitution (`{varName}`, `{$PREV}`, etc.) is supported in the file path.
- Missing parent directories are created automatically.
- Participates in AND-chain — an indented `write:` only runs if the parent command succeeded.
- `--dry-run` shows the resolved path and content without writing.

<br>

<br>

# v1.2: New features

## 1. Input / Prompt Directive

Pause execution and ask the user to type a value, storing the answer in a named variable.

```markdown
- prompt: {TARGET_HOST} Enter the hostname to connect to
- ssh {TARGET_HOST} uptime
```

The cursor-position AND-chain rules apply — a `prompt:` at an indented level only fires when the parent command succeeded.

### Syntax

```
- prompt: {VARIABLE_NAME} <message shown to the user>
```

| Option | Example | Description |
|---|---|---|
| _(none)_ | `- prompt: {NAME} Enter name` | Shows an input box; typed text is stored in `{NAME}` |
| `secret` | `- prompt: secret {PASS} Enter password` | Input is masked (password field) |

If the user dismisses the dialog without entering a value, the AND-chain is broken and `(cancelled by user)` is recorded in the output block.

### Dry-run behaviour

In dry-run mode no dialog appears. The output block records `[dry-run] would prompt: <message>` so you can verify the variable name and prompt text without side effects.

### Example

```markdown
1. hostname → {host}
- prompt: {DEPLOY_ENV} Deploy to which environment? (staging/prod)
- echo deploying {host} → {DEPLOY_ENV}
```

---

## 2. Retry / Wait Directive

Prefix any list command with `[retry: N]` to re-run it up to N additional times if it exits with a non-zero code.

### Syntax

```
- [retry: <count>] command
- [retry: <count>, <interval>] command
- [retry: <count>, interval: <interval>] command
```

| Part | Example | Description |
|---|---|---|
| `count` | `[retry: 5]` | Maximum number of **retries** (total attempts = count + 1) |
| `interval` (ms) | `[retry: 3, 500]` | Wait 500 ms between each retry |
| `interval` (s)  | `[retry: 3, 2s]`  | Wait 2 seconds between each retry |

The interval unit suffix is optional — a bare number is treated as milliseconds.

### Behaviour

- If the command **succeeds** (exit 0) on any attempt, retrying stops immediately and the AND-chain continues normally.
- If all attempts fail, the AND-chain is broken as usual.
- Each wait period is recorded in the output block as `[retry N/M wait Xms...]` so the log is self-explanatory.
- The progress toast shows `command (try N)` during retries.
- Combining with `[parallel]` is supported — add both prefixes in any order.

### Examples

```markdown
- [retry: 3] curl -sf http://api.local/health
    - echo service is up

- [retry: 5, 2s] kubectl rollout status deployment/app
```

Retry until a health-check passes, with a 2-second pause between attempts:

```markdown
- [retry: 10, interval: 2s] curl -sf http://db:5432/ready
    - echo database is ready
    - [retry: 3, 500] psql -c "SELECT 1"
```

---

## 3. Real-time Output Streaming

Command output is written into the Markdown document **as it arrives**, rather than after the command finishes. This is especially useful for long-running commands like log tails, build scripts, or test runners.

### How it works

- A 200 ms interval timer flushes accumulated stdout/stderr chunks into the nearest output code block below the command.
- The output block is created on the first flush if it does not already exist.
- Subsequent flushes replace the existing block in-place rather than appending, so the document stays tidy.
- A final sync runs after `runLines` completes to ensure the last chunk is always written.
- `[stderr]` lines are prefixed so they are visually distinguishable from stdout.

### No configuration required

Streaming is always active. There are no extra settings to enable.

### Interaction with other features

| Feature | Behaviour with streaming |
|---|---|
| Retry | Each attempt's output is appended live; the `[retry N/M wait Xms...]` marker appears in real-time before the next attempt starts |
| Cancel | Clicking **Cancel** in the progress toast stops the child process; whatever has already been streamed remains in the document |
| `collapsible` output format | The `<details>` wrapper is written on the first flush and updated in-place on subsequent flushes |
| `toterminal` | Output is sent to the terminal and also streamed back into the document |

# v1.3: Code Block Execution and Auto-Write

## 1. Execute bash/sh/zsh blocks sequentially
You can directly execute the contents of a fenced code block without needing to prefix each line with - . This is extremely convenient for longer shell scripts.

Variables ({VAR_NAME}) inside the block are resolved, and line-continuations (\) are automatically supported. Execution stops immediately if any command within the block fails.

Markdown
```bash
echo "Installing dependencies..."
curl -sL [http://api.local/tarball.gz](http://api.local/tarball.gz) | tar -xz \
    -C /opt/app \
    --strip-components=1
echo "Finished!"
```
## 2. Auto-write yaml/conf/json blocks
Fenced code blocks for configuration files (yaml, conf, json) are automatically detected and saved to disk.

Markdown
```yaml config/settings.yml
database:
  host: {DB_HOST}
  port: 5432
```
If you omit the filename from the fence definition, code-lc4ri will automatically generate a unique alphabetic filename (e.g. gHJkLmNa.yaml) and write the output block so you can trace what file was generated.

Markdown
```json
{
  "status": "ready",
  "enabled": true
}
```
# v1.4: New features

Four new panels and tooling features have been added for visibility and debuggability of runbook execution. **All existing documents and settings continue to work without any changes.**

## 1. Variable Inspector Panel

Open a live side panel that shows every variable in the current session at a glance.

**How to open:** Command Palette → `code-lc4ri: Show Variable Inspector` (`extension.lc4ri.showVarInspector`), or set a keybinding.

The panel opens beside the active editor and stays in sync as commands run. It is divided into four sections:

| Section | Contents |
|---|---|
| **Numbered variables** | `{1}` – `{9}` and their current values |
| **Named variables** | Every `{name}` bound via `→ {name}` or `prompt:` |
| **Built-in values** | `{$PREV}`, `{$STATUS}`, `{$CWD}` updated in real-time |
| **Environment (session)** | Variables injected via `export:` or `.env` loading |

The filter box at the top narrows the list by name instantly. Long values are truncated with a **more / less** toggle. The timestamp in the top-right corner shows when the panel was last refreshed.

The panel refreshes automatically after every command execution and after every `prompt:` input, so you never need to reopen it.

## 2. Execution History Browser

Browse, search, and re-examine past execution sessions without leaving VS Code.

**How to open:** Command Palette → `code-lc4ri: Show Execution History` (`extension.lc4ri.showHistory`).

### What is recorded

Every time `Run from cursor` or `▶ Run` (CodeLens) is triggered, a new session is created. When execution finishes, the session is saved to **`.lc4ri-history.json`** in the workspace root (or `$HOME` if no workspace is open). Up to **50 sessions** are retained; older sessions are dropped automatically.

Each session records:

- Runbook filename, start/end timestamps, active profile
- Per-command: command text, exit code, duration, OK/fail flag

### Using the panel

- **Expand / collapse** a session row to see its individual commands.
- Use the **search box** to filter by command text across all sessions.
- Use the **status filter** (`All / ✅ OK only / ❌ Failed only`) to narrow by result.
- Click **Timeline** on any session row to open the waterfall view for that session (see feature 4).
- Click **Clear All** to wipe the history file and reset the list.

### Commands

| Command | Description |
|---|---|
| `extension.lc4ri.showHistory` | Open the history browser panel |
| `extension.lc4ri.clearHistory` | Clear all saved history |

## 3. Output Block Search

Search inside the output code block that follows a command, with inline highlight and next/previous navigation — without leaving the Markdown file.

**How to use:**

- Click the **🔍 Search output** CodeLens that appears above every output code block (`` ``` `` … `` ``` ``), **or**
- Run `code-lc4ri: Search Output Block` (`extension.lc4ri.searchOutput`) from the Command Palette with the cursor inside or above an output block.

An input box appears. Type a keyword and press Enter.

### Behaviour

- All matches are highlighted using VS Code's standard find-match colours.
- The current match is shown in a brighter colour; the others are dimmed.
- An information toast shows `"keyword" — N/M matches` with **Next ↓** and **Prev ↑** buttons to step through each match.
- Clicking **Clear** (or dismissing the toast) removes all decorations.
- If the keyword is not found, a warning message is shown and no decorations are applied.

### CodeLens integration

The `🔍 Search output` and `🗑 Clear` lenses appear on the opening fence line of every output block. They are shown alongside the existing `▶ Run` and `Dry-run` lenses and can be disabled globally with `"lc4ri.showCodeLens": false`.

```
🔍 Search output  🗑 Clear
```
```
[ ls -la ] Mon Jun 01 14:32:00 2026
total 48
drwxr-xr-x 12 user user 4096 ...
```

## 4. Execution Timeline (Waterfall)

Visualise the duration and sequence of every command in a session as an interactive waterfall chart.

**How to open:**

- Command Palette → `code-lc4ri: Show Execution Timeline` (`extension.lc4ri.showTimeline`) to see the **current session**.
- Click **Timeline** on any row in the History Browser to see a **past session**.

### Reading the chart

Each command is drawn as a horizontal bar. The bar starts at the command's wall-clock start time and ends at its finish time, relative to the beginning of the session.

| Colour | Meaning |
|---|---|
| 🟢 Teal | Sequential command, exit 0 |
| 🔵 Blue | Parallel command (`[parallel]`), exit 0 |
| 🔴 Red | Failed command (any exit code ≠ 0) |
| Grey background | Parallel group — commands that ran with `Promise.all` |

Parallel groups are indicated with a translucent box spanning all commands in the group. A group number is shown in the tooltip.

### Tooltip

Hover over any bar to see a tooltip with:

- Command text
- OK / Failed status and exit code
- Duration in ms or seconds
- Parallel group number (if applicable)
- Up to 200 characters of the command's output

### Summary bar

The header area shows the total number of commands, the wall-clock duration of the whole session, and the ✅ / ❌ counts.

Duration labels (e.g. `1.23s`, `450ms`) are printed inside bars that are wide enough to accommodate them.

## 5. New commands summary (v1.4)

| Command | Description |
|---|---|
| `extension.lc4ri.showVarInspector` | Open the Variable Inspector side panel |
| `extension.lc4ri.showHistory` | Open the Execution History browser |
| `extension.lc4ri.clearHistory` | Clear all saved execution history |
| `extension.lc4ri.searchOutput` | Search inside the nearest output block |
| `extension.lc4ri.showTimeline` | Open the Timeline waterfall for the current session |

## 6. Changes in v1.5.0 — Terminal-first execution

v1.5.0 fully commits to running all commands through the visible VS Code terminal.
Background shell execution (`spawn`) has been removed entirely.

### What changed

| Area | v1.4 and earlier | v1.5.0 |
|---|---|---|
| Command execution | Background `spawn` (default) or terminal (opt-in via `toTerminal`) | Always the active terminal |
| Output capture | stdout/stderr pipes for background mode | `onDidWriteTerminalData` + sentinel markers |
| Remote support | Background mode did not work in AWS CloudShell | Sentinel mode works in any terminal including CloudShell custom PTY |
| Removed settings | `lc4ri.toTerminal`, `lc4ri.shell`, `lc4ri.template`, `lc4ri.toUtf8` | — |
| Kept settings | `lc4ri.profiles`, `lc4ri.changeWord`, `lc4ri.timeout`, security settings | All kept |

### New behaviour for `cd` and `export`

Both commands now run in the active terminal (via `execViaTerminal`) instead of a hidden subprocess.  
The extension still tracks the working directory and exported variables for variable substitution.

### AWS CloudShell support

The sentinel capture strategy (`onDidWriteTerminalData` proposed API) is required for custom PTY terminals like AWS CloudShell.  
Launch VS Code with the flag below to enable it:

```
code --enable-proposed-api yasutakatou.code-lc4ri
```

Without the flag the extension falls back to the temp-file polling strategy (works for local and Remote SSH but not CloudShell).

### Removed dependencies

`encoding-japanese` has been removed from the runtime dependencies.

# v1.5.1: タイムアウト処理の改善

## 1. アクティビティベースのタイムアウト

v1.5.0 まではコマンド起動時点から一定時間で打ち切る「固定タイムアウト」でした。  
v1.5.1 では**出力が届いている限りタイマーをリセットする「無活動タイムアウト」**に変更しました。

| モード | タイマーリセット条件 |
|---|---|
| Shell Integration モード | `execution.read()` から非空チャンクを受信するたび |
| テンポラリファイル fallback モード | 出力ファイルのサイズが増加するたび |

### 変更前後の挙動比較

| 状況 | v1.5.0 (固定) | v1.5.1 (無活動) |
|---|---|---|
| ログを垂れ流す長時間コマンド | `lc4ri.timeout` 経過後に強制終了 | 出力が続く限り実行継続 |
| 途中でフリーズしたコマンド | `lc4ri.timeout` 経過後に強制終了 | 最後の出力から `lc4ri.timeout` 経過後に強制終了 |
| 無音で長時間動くコマンド（ビルド等） | 早期タイムアウトの可能性あり | 変わらず早期タイムアウトの可能性あり → `lc4ri.timeout` を大きくする |

### 注意

`lc4ri.timeout` の意味が変わりました。以前は「コマンド開始からの最大待機時間」でしたが、v1.5.1 以降は「**最後の出力から次の出力が来るまでの最大待機時間（無活動時間）**」です。  
完全に無音で動く長時間バッチ処理がある場合は、`lc4ri.timeout` を処理時間よりも大きく設定してください。

---

# v1.5.2: Windows / PowerShell 対応

v1.5.2 はすべての機能を Windows 環境（PowerShell / CMD）で動作させることを目的とした互換性リリースです。**既存の Linux / macOS ドキュメントと設定はそのまま動作します。**

## 1. テンポラリファイル fallback の Windows 対応

Shell Integration API が利用できない場合に使用する fallback 実行経路を Windows 対応しました。

| 項目 | v1.5.1 | v1.5.2 |
|---|---|---|
| 一時ファイル置き場 | `/tmp` ハードコード | `os.tmpdir()`（Windows では `%TEMP%`）|
| ファイルパス生成 | `folder.uri.path`（URI 形式） | `folder.uri.fsPath`（OS ネイティブ区切り）|
| シェルラッパー構文 | POSIX sh のみ | PowerShell / POSIX sh を自動切り替え |

PowerShell 用ラッパーは `Out-File -Encoding utf8` と `$LASTEXITCODE` を使用します。

## 2. `cd` 追跡の PowerShell 対応

`cd` コマンドの実行後に新しい作業ディレクトリを取得する方法を PowerShell 向けに変更しました。

```
# bash / zsh (変更なし)
cd <path> && pwd

# PowerShell (新規)
try { cd <path> } catch { exit 1 }; (Get-Location).Path
```

`&&` は PowerShell 5.1 で未対応のため `try/catch` に切り替えています。`cd` が失敗した場合は `exit 1` で即座に非ゼロ終了します。

## 3. `export` / 環境変数取得の PowerShell 対応

`export VAR=val` 実行後に環境変数の一覧を取得するコマンドを PowerShell 向けに変更しました。

```
# bash / zsh (変更なし)
export VAR=val && env

# PowerShell (新規)
$env:VAR = 'val'; Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }
```

出力フォーマットは `NAME=VALUE` 形式で統一されているため、変数キャプチャの解析ロジックはそのまま動作します。

## 4. PowerShell `$env:` 代入のネイティブ追跡

PowerShell の `$env:VARNAME = value` 構文を `export VAR=val` と同様にネイティブ追跡するようになりました。

```markdown
- $env:KUBECONFIG = 'C:\Users\me\.kube\config'
    - kubectl get nodes
```

`isPurePsEnvCommand()` が代入を検出し、`resolvePsEnv()` が変数値をキャプチャして拡張機能内部の環境変数テーブルに保存します。セミコロン・パイプ・`&` を含む複合文は対象外（通常コマンドとして実行）です。

## 5. `lc4ri.shell` 設定の追加

アクティブターミナルのシェル種別を明示的に指定できる設定を追加しました。

| 値 | 動作 |
|---|---|
| `null`（デフォルト）| OS を自動判定（Windows → PowerShell、その他 → bash）|
| `"powershell"` | Windows でも macOS/Linux でも PowerShell 構文を使用 |
| `"bash"` | Windows 上で Git Bash / WSL を使用している場合に指定 |
| `"cmd"` | CMD を使用（将来拡張用）|

```jsonc
// Windows で Git Bash を使う場合
{ "lc4ri.shell": "bash" }

// macOS で PowerShell Core を使う場合
{ "lc4ri.shell": "powershell" }
```

## 6. `lc4ri.template` 設定の復活

v1.5.0 で削除された OS 別コマンドラッパー設定 `lc4ri.template` を復活させました。プロファイル未選択時に `process.platform` をキーとして参照されます。

```jsonc
{
  "lc4ri.template": {
    "win32":  "wsl -e {COMMAND}",
    "linux":  "ssh ops@prod {COMMAND}",
    "darwin": "ssh ops@prod {COMMAND}"
  }
}
```

プロファイルが選択されている場合はプロファイルが優先されます（`applyTemplate` の優先順位: プロファイル → OS テンプレート → そのまま）。

## 7. Windows 向け危険パターンの追加

`lc4ri.dangerousPatterns` のデフォルトセットに Windows 固有の危険コマンドを追加しました。

| パターン | 対象コマンド例 |
|---|---|
| `rd /s /q` | `rd /s /q C:\Windows` |
| `format <ドライブ>:` | `format D:` |
| `del /f /s /q` | `del /f /s /q C:\tmp\*` |
| `Remove-Item -Recurse -Force` | `Remove-Item ./critical -Recurse -Force` |

## 8. 動作環境まとめ

| 環境 | Shell Integration あり | Shell Integration なし（fallback） |
|---|---|---|
| Linux / macOS — bash / zsh | ✅ 完全動作 | ✅ 完全動作 |
| Windows — PowerShell | ✅ 完全動作 | ✅ v1.5.2 で対応 |
| Windows — Git Bash / WSL | ✅ 完全動作（`lc4ri.shell: "bash"` 推奨） | ✅ bash モードで動作 |
| Windows — CMD | ✅ 実行可能 | ⚠ cd/export 追跡は未対応 |

## 9. 開発者向け変更

- `isWindowsShell(cfg)` をエクスポート — シェル種別を返すヘルパー
- `applyTemplate()` をエクスポート（`applyProfile` は deprecated alias として残存）
- `isPurePsEnvCommand()` をエクスポート — PowerShell `$env:` 代入検出
- テストケース数: 147 → 164

---

# LICENSE

MIT License

# Contributors

- [yasutakatou](https://github.com/yasutakatou)
