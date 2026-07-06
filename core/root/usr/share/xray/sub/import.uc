#!/usr/bin/ucode
// import.uc — stdin: parse.uc JSON array; creates one standalone (manual)
// `servers` section per descriptor. Unlike apply.uc these carry no
// subscription_id, so they behave exactly like hand-added servers.
// stdout: {"added":N}; exit 10 if anything was added (caller reloads), else 0.

const fs = require("fs");
const uci_mod = require("uci");
const digest = require("digest");

let text = fs.stdin.read("all") || "[]";
let incoming;
try { incoming = json(text); } catch (e) { incoming = []; }
if (type(incoming) != "array") incoming = [];

let c = uci_mod.cursor();
c.load("xray_core");

// Stable section name from the descriptor so re-importing an identical link
// updates in place instead of piling up duplicates. Named-section creation via
// set(config, name, type) mirrors apply.uc — the ucode uci binding's proven path.
function section_name(srv) {
    let h = digest.sha256(sprintf("%J", srv));
    return "manual_" + substr(h, 0, 12);
}

let added = 0;
for (let srv in incoming) {
    if (type(srv) != "object") continue;
    let sec = section_name(srv);
    c.set("xray_core", sec, "servers");
    for (let k in srv) {
        let v = srv[k];
        if (v == null) continue;
        if (type(v) == "array") c.set("xray_core", sec, k, v);
        else                    c.set("xray_core", sec, k, "" + v);
    }
    added++;
}

if (added > 0) {
    c.save("xray_core");
    c.commit("xray_core");
}

printf('{"added":%d}\n', added);
exit(added > 0 ? 10 : 0);
