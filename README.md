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

# LICENSE

MIT License

# Contributors

- [yasutakatou](https://github.com/yasutakatou)

<!-- CREATED_BY_LEADYOU_README_GENERATOR -->
