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

/home/pi/code-lc4ri/code-lc4ri-0.5.0.vsix

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
  }
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

# v0.6: executed time auto print.

![5](https://github.com/yasutakatou/code-lc4ri/raw/pic/5.png)

It can be used as evidence of execution time.

<br>

# LICENSE

MIT License

# Contributors

- [yasutakatou](https://github.com/yasutakatou)

<!-- CREATED_BY_LEADYOU_README_GENERATOR -->
