"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const { execSync } = require('child_process');
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    // ●段落、改行、見出し、引用、強調　→　このまま
    // ●コード　stdout
    // ●水平線　区切り
    // ●リスト　コマンド
    // ●TABで&&条件
    // ●変数
    const disposable = vscode.commands.registerCommand('extension.lc4ri', () => {
        let editor = vscode.window.activeTextEditor;
        if (editor == null) {
            throw new Error();
        }
        const position = editor.selection.active;
        let doc = editor.document;
        let startPos = new vscode.Position(position.line, 0);
        let endPos = new vscode.Position(doc.lineCount - 1, 10000);
        let cur_selection = new vscode.Selection(startPos, endPos);
        let text = doc.getText(cur_selection);
        let nowLine = position.line;
        let startLine = 0;
        let endLine = 0;
        let texts = text.split(/\r\n|\r|\n/);
        let consoles = "";
        let execFlag = false;
        let execCount = 0;
        let horizonFlag = -1;
        let numVar = {};
        for (let i = 0; i < texts.length; i++) {
            let lines = texts[i];
            if (horizonCheck(lines) == true) {
                horizonFlag = nowLine;
                break;
            }
            const regA = /^[1-9]. /;
            if (lines.search(regA) > -1) {
                numVar = numberListCheck(lines, numVar);
            }
            const regB = /\{[1-9]\}/;
            if (lines.search(regB) > -1) {
                lines = changeList(lines, numVar);
                console.log(lines);
            }
            const regC = new RegExp(regTab(execCount));
            if (lines.search(regC) > -1) {
                execFlag = true;
                try {
                    const stdout = execSync(lines.replace(regC, ""));
                    consoles += stdout.toString();
                    execCount++;
                }
                catch (err) {
                    consoles += err.stderr.toString();
                    execCount = 0;
                }
            }
            else {
                execCount = 0;
                const regD = new RegExp(regTab(execCount));
                if (lines.search(regD) > -1) {
                    execFlag = true;
                    consoles = doShell(execCount, lines, consoles);
                }
            }
            const regE = /^```/;
            if (lines.search(regE) > -1) {
                if (startLine == 0) {
                    startLine = nowLine;
                }
                else {
                    endLine = nowLine;
                    break;
                }
            }
            nowLine++;
        }
        if (execFlag == true) {
            if (startLine == 0 && endLine == 0) {
                if (horizonFlag > -1) {
                    startLine = horizonFlag - 1;
                    endLine = horizonFlag;
                }
                else {
                    startLine = doc.lineCount - 1;
                    endLine = doc.lineCount;
                }
                consoles = "\n```\n" + consoles + "\n```\n";
            }
            startPos = new vscode.Position(startLine + 1, 0);
            endPos = new vscode.Position(endLine - 1, 10000);
            cur_selection = new vscode.Selection(startPos, endPos);
            editor.edit(edit => {
                edit.replace(cur_selection, consoles);
            });
            if (horizonFlag > -1) {
                return;
            }
        }
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
function doShell(execCount, strs, consoles) {
    const regA = new RegExp(regTab(execCount));
    if (strs.search(regA) > -1) {
        try {
            const stdout = execSync(strs.replace(regA, ""));
            consoles += stdout.toString();
            execCount++;
        }
        catch (err) {
            consoles += err.stderr.toString();
            execCount = 0;
        }
    }
    return consoles;
}
function regTab(cnt) {
    let strs;
    strs = "^";
    for (let i = 0; i < cnt; i++) {
        strs = strs + "\t";
    }
    return strs + "- ";
}
function horizonCheck(strs) {
    const regA = /^\* \* \*/;
    const regB = /^\*\*\*/;
    const regC = /^\*\*\*\*/;
    const regD = /^- - -/;
    if (strs.search(regA) > -1) {
        return true;
    }
    if (strs.search(regB) > -1) {
        return true;
    }
    if (strs.search(regC) > -1) {
        return true;
    }
    if (strs.search(regD) > -1) {
        return true;
    }
    return false;
}
function changeList(strs, numVar) {
    const nums = strs.split(/{/)[1].split(/}/)[0];
    return strs.replace("{" + nums + "}", numVar[nums].toString());
}
function numberListCheck(strs, numVar) {
    const nums = strs.split(/. /);
    try {
        const stdout = execSync(nums[1]);
        numVar[nums[0]] = stdout.toString();
        numVar[nums[0]] = numVar[nums[0]].replace(/\r\n|\r|\n/, "");
    }
    catch (err) {
        numVar[nums[0]] = err.stderr.toString();
    }
    return numVar;
}
//# sourceMappingURL=extension.js.map