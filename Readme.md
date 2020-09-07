# code-lc4ri

**code-lc4ri: Markdown + LC4RI for VS Code**.

# solution

Do you often use "**jupyter notebook**" when choosing a documentation tool for your operations manual?
But, this include problems

 - document used splited to like a card. So, when insert document, insert card every. I don't fit in this operation.
 - In case of operation of the order, I have to switch the cards up and down. I wish to edit like a text editer.
 - I wish to use ecosystem(lint tool, etc). But, not easy preparation.

jupyter is very excellent tool, but I know more usefull for text edit. **it's VSCode!**
My idea is, **Markdown + LC4RI on VSCode's ecosystem** is more better solution!

# features

This extention, usually write markdown document. and additional commands can be executed.

- write document on markdown format.
- list format on markdown is can run command.
- command output to auto apply to document.
- can use variable.

# installation

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

[Basic. You can write markdown usually](https://www.markdownguide.org/basic-syntax/), but it's can run following.

### list format

- list strings can be run. 

```
- ls
```

note) If not exists code section after list, will create code section and output to it.<br>
note) Tab indents means, If command success is next indent run. (AND rule)<br>

```
- ls existsfile.txt
	- rm existsfile.txt
```

If "ls existsfile.txt" is success, next indent run.

### horizon line

If you write horizon line, split commands.

```
- ls

*** 

- uname
````

note) In this case, run command to the horizon line.

### variable

number list is create variable value.

```
1. uname
```

create variable {1}.

```
- echo {1}
```

variable {1} output.

note) variable can use 1-9 integer.

# LICENSE

MIT License
