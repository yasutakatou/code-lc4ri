"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const child_process_1 = require("child_process");
const Encoding = require("encoding-japanese");
const fs = require("fs");
require('date-utils');
let config;
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    const disposable = vscode.commands.registerCommand('extension.lc4ri', () => {
        var _a, _b;
        if (config == null) {
            loadConfig();
        }
        const editor = vscode.window.activeTextEditor;
        if (editor == null) {
            throw new Error();
        }
        const position = editor.selection.active;
        const doc = editor.document;
        let startPos = new vscode.Position(position.line, 0);
        let endPos = new vscode.Position(doc.lineCount - 1, 10000);
        let cur_selection = new vscode.Selection(startPos, endPos);
        const text = doc.getText(cur_selection);
        let nowLine = position.line;
        let startLine = 0;
        let endLine = 0;
        const texts = text.split(/\r\n|\r|\n/);
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
            }
            lines = changeWord(lines);
            const regC = new RegExp(regTab(execCount));
            if (lines.search(regC) > -1) {
                execFlag = true;
                consoles += "\n[ " + tempConv(lines.replace(regC, "")) + " ] " + getDate() + "\n";
                try {
                    const regF = /! .*/;
                    if (lines.search(regF) > -1) {
                        const tmpfilename = text.split("! ");
                        const filename = tmpfilename[1].split("\r\n");
                        let fileUri = vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "/" + filename[0]);
                        if (process.platform === 'win32') {
                            fileUri = vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + filename[0]);
                        }
                        vscode.workspace.openTextDocument(fileUri).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                    else {
                        if (config['toterminal'] === true) {
                            (_a = vscode.window.activeTerminal) === null || _a === void 0 ? void 0 : _a.sendText(tempConv(lines.replace(regC, "")));
                        }
                        else {
                            const stdout = child_process_1.execSync(tempConv(lines.replace(regC, "")), { timeout: config.timeout });
                            let result = stdout.toString();
                            consoles += convToUTF(result);
                        }
                    }
                    execCount++;
                }
                catch (err) {
                    consoles += convToUTF(err.stderr);
                    execCount = 0;
                }
            }
            else {
                execCount = 0;
                const regD = new RegExp(regTab(execCount));
                if (lines.search(regD) > -1) {
                    execFlag = true;
                    const regF = /! .*/;
                    if (lines.search(regF) > -1) {
                        const tmpfilename = text.split("! ");
                        const filename = tmpfilename[1].split("\r\n");
                        let fileUri = vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "/" + filename[0]);
                        if (process.platform === 'win32') {
                            fileUri = vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + filename[0]);
                        }
                        vscode.workspace.openTextDocument(fileUri).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                    else {
                        if (config['toterminal'] === true) {
                            (_b = vscode.window.activeTerminal) === null || _b === void 0 ? void 0 : _b.sendText(lines);
                        }
                        else {
                            consoles = doShell(execCount, lines, consoles);
                        }
                    }
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
        consoles += "\n[ " + tempConv(strs.replace(regA, "")) + " ] " + getDate() + "\n";
        try {
            const stdout = child_process_1.execSync(tempConv(strs.replace(regA, "")), { timeout: config.timeout });
            let result = stdout.toString();
            consoles += convToUTF(result);
            execCount++;
        }
        catch (err) {
            consoles += convToUTF(err.stderr.toString());
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
function getDate() {
    return new Date(Date.now()).toString();
}
function tempConv(strs) {
    Object.keys(config['template']).forEach(function (k) {
        if (process.platform === k) {
            strs = config['template'][k].replace("{COMMAND}", strs);
        }
    });
    return strs;
}
function changeWord(strs) {
    Object.keys(config['changeWord']).forEach(function (k) {
        if (strs.indexOf(k) > -1) {
            strs = strs.replace(k, config['changeWord'][k]);
        }
    });
    return strs;
}
function numberListCheck(strs, numVar) {
    const nums = strs.split(/. /);
    try {
        const stdout = child_process_1.execSync(tempConv(strs.replace(nums[0] + ".", "")), { timeout: config.timeout });
        let result = stdout.toString();
        numVar[nums[0]] = convToUTF(result);
        numVar[nums[0]] = numVar[nums[0]].replace(/\r\n|\r|\n/, "");
    }
    catch (err) {
        numVar[nums[0]] = convToUTF(err.stderr.toString());
    }
    return numVar;
}
function convToUTF(strs) {
    if (config['toutf8'] === false) {
        return strs.toString();
    }
    const stra = Encoding.convert(strs, {
        from: 'SJIS',
        to: 'UNICODE',
        type: 'string'
    });
    return stra.toString();
}
function getHome() {
    let com, result;
    if (process.platform === 'win32') {
        com = "echo %USERPROFILE%";
    }
    else {
        com = "echo $HOME";
    }
    try {
        const stdout = child_process_1.execSync(com);
        result = stdout.toString();
        result = result.replace(/\r\n|\r|\n/, "");
    }
    catch (err) {
        result = "";
    }
    return result;
}
function loadConfig() {
    const homePath = getHome();
    if (homePath === "") {
        vscode.window.showInformationMessage("can't get config directory!: " + homePath);
        return;
    }
    let configDir = homePath + "/.code-lc4ri";
    if (process.platform === 'win32') {
        configDir = homePath + "\\.code-lc4ri";
    }
    if (fs.existsSync(configDir) === false) {
        fs.mkdir(configDir, (err) => {
            if (err) {
                vscode.window.showInformationMessage("can't create config directory!: " + configDir);
                return;
            }
        });
    }
    let configPath = homePath + "/.code-lc4ri/config.json";
    if (process.platform === 'win32') {
        configPath = homePath + "\\.code-lc4ri\\config.json";
    }
    if (fs.existsSync(configPath) === true) {
        const rawdata = fs.readFileSync(configPath, "utf8");
        config = JSON.parse(rawdata);
    }
    else {
        const tmpConfig = '{ "timeout": 10000, "template": { }, "changeWord": { }, "toutf8": true, "toterminal": false }';
        config = JSON.parse(tmpConfig);
        fs.writeFile(configPath, JSON.stringify(config), (err) => {
            console.log(err);
        });
    }
}
//# sourceMappingURL=extension.js.map