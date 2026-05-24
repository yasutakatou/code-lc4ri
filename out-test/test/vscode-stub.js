"use strict";
// Stand-in for the `vscode` module so extension.ts can be required from a
// plain Node test runner.  Only the symbols touched at module top-level are
// stubbed; anything else is provided via a Proxy that returns no-op shims.
const noop = () => undefined;
const handler = {
    get(_t, _p) { return new Proxy(noop, handler); },
    apply() { return new Proxy({}, handler); },
    construct() { return new Proxy({}, handler); }
};
const mod = new Proxy({}, handler);
mod.StatusBarAlignment = { Right: 2, Left: 1 };
mod.ProgressLocation = { Notification: 15, Window: 10, SourceControl: 1 };
mod.EventEmitter = class {
    constructor() {
        this.event = noop;
        this.fire = noop;
        this.dispose = noop;
    }
};
module.exports = mod;
//# sourceMappingURL=vscode-stub.js.map