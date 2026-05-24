"use strict";
// Same stub as src/test/vscode-stub.ts, but as plain JS for the CLI.
const noop = () => undefined;
const handler = {
    get: () => new Proxy(noop, handler),
    apply: () => new Proxy({}, handler),
    construct: () => new Proxy({}, handler)
};
const mod = new Proxy({}, handler);
mod.StatusBarAlignment = { Right: 2, Left: 1 };
mod.ProgressLocation = { Notification: 15 };
mod.EventEmitter = class { constructor() { this.event = noop; this.fire = noop; this.dispose = noop; } };
module.exports = mod;
