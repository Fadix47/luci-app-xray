#!/usr/bin/ucode
// apply.uc <sub_id> [profile_title] [update_interval_hours] — stdin: parse.uc JSON;
// stdout: {changes,added,deleted,reload}; exit 10 if reload needed, 0 no-op, else error.

const fs = require("fs");
const uci_mod = require("uci");
const digest = require("digest");

let sub_id = ARGV[0];
let profile_title = ARGV[1] || "";
let interval_hours = ARGV[2] || "";

if (!sub_id) {
    printf('{"error":"missing sub_id"}\n');
    exit(2);
}

let text = fs.stdin.read("all") || "[]";
let incoming;
try { incoming = json(text); } catch (e) { incoming = []; }
if (type(incoming) != "array") incoming = [];

const CANON_FIELDS = [
    "protocol", "server", "server_port", "username", "password", "transport",
    "vless_encryption", "vless_tls", "vless_flow_tls", "vless_flow_reality",
    "vless_tls_host", "vless_tls_fingerprint", "vless_tls_insecure", "vless_tls_alpn",
    "vless_reality_server_name", "vless_reality_public_key", "vless_reality_short_id",
    "vless_reality_spider_x", "vless_reality_fingerprint",
    "vmess_security", "vmess_tls", "vmess_tls_host", "vmess_tls_fingerprint",
    "trojan_tls", "trojan_tls_host", "trojan_tls_fingerprint",
    "shadowsocks_security",
    "ws_path", "ws_host", "h2_path", "h2_host", "grpc_service_name", "grpc_multi_mode",
    "httpupgrade_path", "httpupgrade_host",
    "xhttp_path", "xhttp_host", "xhttp_mode",
    "xhttp_extra_sc_max_concurrent_posts", "xhttp_extra_sc_max_each_post_bytes",
    "xhttp_extra_sc_min_posts_interval_ms", "xhttp_extra_no_sse_header",
    "xhttp_extra_x_padding_bytes", "xhttp_extra_json",
    "xhttp_download_address", "xhttp_download_port",
    "xhttp_download_path", "xhttp_download_host",
    "tcp_guise", "http_host", "http_path",
    "mkcp_guise", "mkcp_seed", "quic_security", "quic_key", "quic_guise",
    "hysteria_up_mbps", "hysteria_down_mbps", "hysteria_udp_idle_timeout",
    "hysteria_tls", "hysteria_tls_host", "hysteria_tls_fingerprint",
    "hysteria_tls_insecure", "hysteria_tls_alpn",
    "hysteria_obfs_type", "hysteria_obfs_password",
    "hysteria_congestion", "hysteria_bbr_profile",
    "hysteria_brutal_up", "hysteria_brutal_down",
    "hysteria_udphop_port", "hysteria_udphop_interval",
    "hysteria_quic_max_idle_timeout", "hysteria_quic_keep_alive_period",
    "hysteria_quic_max_incoming_streams",
    "hysteria_quic_init_stream_recv_window", "hysteria_quic_max_stream_recv_window",
    "hysteria_quic_init_conn_recv_window", "hysteria_quic_max_conn_recv_window",
    "hysteria_quic_disable_mtu_discovery", "hysteria_quic_debug"
];

function canon_hash(s) {
    let parts = [];
    for (let k in CANON_FIELDS) {
        let v = s[k];
        if (v == null) v = "";
        else if (type(v) == "array") v = join(",", v);
        push(parts, k + "=" + v);
    }
    return digest.sha256(join("\n", parts));
}

// Normalise UCI values to canonical strings so hashes match regardless of
// scalar/list storage shape (server_port is a DynamicList after modal save).
function as_canon(v) {
    if (v == null) return "";
    if (type(v) == "array") return join(",", v);
    return "" + v;
}

// Stable identity: protocol + endpoint + credential + transport (alias may hold quota emoji).
function canon_identity(s) {
    return digest.sha256(join("|", [
        as_canon(s.protocol),
        as_canon(s.server),
        as_canon(s.server_port),
        as_canon(s.password),
        as_canon(s.transport)
    ]));
}

const SYSTEM_KEYS = { ".name": 1, ".type": 1, ".anonymous": 1, ".index": 1,
                      "subscription_id": 1, "subscription_hash": 1 };

function update_section_fields(c, sec_name, srv) {
    // Drop UCI options that the new descriptor doesn't carry (so e.g. switching
    // a server from reality→tls actually clears the stale reality_* keys).
    let cur = c.get_all("xray_core", sec_name) || {};
    for (let k in cur) {
        if (SYSTEM_KEYS[k]) continue;
        if (!exists(srv, k)) c.delete("xray_core", sec_name, k);
    }
    for (let k in srv) {
        let v = srv[k];
        if (v == null) continue;
        if (type(v) == "array") c.set("xray_core", sec_name, k, v);
        else                    c.set("xray_core", sec_name, k, "" + v);
    }
}

function safe_name(s) {
    let out = "";
    for (let i = 0; i < length(s); i++) {
        let c = substr(s, i, 1);
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "_") {
            out += c;
        } else {
            out += "_";
        }
    }
    return out;
}

const BALANCER_FIELDS = ["tcp_balancer_v4", "udp_balancer_v4", "tcp_balancer_v6", "udp_balancer_v6"];

let c = uci_mod.cursor();
c.load("xray_core");

// === STEP 1: snapshot balancer state (identity for our sub's entries, literal
// name for foreign refs). STEP 5 replays it after sections may have been renamed.
let balancer_snapshot = [];
c.foreach("xray_core", "general", function(g) {
    let gname = g[".name"];
    for (let bf in BALANCER_FIELDS) {
        let bl = g[bf];
        if (bl == null) continue;
        if (type(bl) != "array") bl = [bl];
        let tokens = [];
        for (let item in bl) {
            let item_sub = as_canon(c.get("xray_core", item, "subscription_id"));
            if (item_sub == sub_id) {
                let s = c.get_all("xray_core", item);
                push(tokens, { kind: "id", value: s ? canon_identity(s) : "" });
            } else {
                // Other sub or a hand-added section — preserve verbatim.
                push(tokens, { kind: "name", value: item });
            }
        }
        push(balancer_snapshot, { gname: gname, bf: bf, tokens: tokens });
    }
});

// === STEP 2: index existing sections. as_canon is needed because ucode-mod-uci
// may return list-stored options as one-element arrays.
let existing_by_hash = {};
let existing_by_id   = {};
let existing_names   = {};
let total_iterated   = 0;
c.foreach("xray_core", "servers", function(s) {
    total_iterated++;
    if (as_canon(s.subscription_id) != sub_id) return;
    let name = s[".name"];
    existing_names[name] = true;
    let h = as_canon(s.subscription_hash);
    if (h != "") existing_by_hash[h] = name;
    existing_by_id[canon_identity(s)] = name;
});
warn(sprintf("xray-sub apply [%s]: c.foreach saw %d server sections total, indexed %d for this sub\n",
    sub_id, total_iterated, length(existing_names)));

// === STEP 3: walk incoming, decide for each one: keep / update-in-place / create.
let new_sections      = [];
let new_section_by_id = {};
let kept_sections     = {};
let added             = [];
let updated           = [];
let matched_by_hash   = 0;
let matched_by_id     = 0;
let safe_sub          = safe_name(sub_id);

for (let srv in incoming) {
    let h    = canon_hash(srv);
    let id   = canon_identity(srv);
    let sec_name;

    if (existing_by_hash[h]) {
        sec_name = existing_by_hash[h];
        matched_by_hash++;
    } else if (existing_by_id[id] && existing_names[existing_by_id[id]]) {
        sec_name = existing_by_id[id];
        update_section_fields(c, sec_name, srv);
        c.set("xray_core", sec_name, "subscription_hash", h);
        push(updated, sec_name);
        matched_by_id++;
    } else {
        sec_name = "sub_" + safe_sub + "_" + substr(h, 0, 12);
        c.set("xray_core", sec_name, "servers");
        for (let k in srv) {
            let v = srv[k];
            if (v == null) continue;
            if (type(v) == "array") c.set("xray_core", sec_name, k, v);
            else                    c.set("xray_core", sec_name, k, "" + v);
        }
        c.set("xray_core", sec_name, "subscription_id", sub_id);
        c.set("xray_core", sec_name, "subscription_hash", h);
        push(added, sec_name);
    }
    kept_sections[sec_name] = true;
    new_section_by_id[id]   = sec_name;
    push(new_sections, sec_name);
}

warn(sprintf("xray-sub apply [%s]: %d in / %d kept / %d updated / %d new\n",
    sub_id, length(incoming), matched_by_hash, matched_by_id, length(added)));

// === STEP 4: delete sections that didn't survive (genuinely removed from sub).
let deleted = [];
for (let name in existing_names) {
    if (!kept_sections[name]) {
        c.delete("xray_core", name);
        push(deleted, name);
    }
}

// === STEP 4.5: reorder to match subscription order — libuci appends new
// sections at the end, so without this middle-inserted servers land at bottom.
let base = -1;
let abs_idx = 0;
c.foreach("xray_core", null, function(s) {
    if (base == -1
        && s[".type"] == "servers"
        && as_canon(s.subscription_id) == sub_id
        && kept_sections[s[".name"]]) {
        base = abs_idx;
    }
    abs_idx++;
});
if (base >= 0) {
    for (let i = 0; i < length(new_sections); i++) {
        c.reorder("xray_core", new_sections[i], base + i);
    }
}

// === STEP 5: replay balancer snapshot — resolve identity → new section name,
// drop only if the logical server truly disappeared. Foreign refs pass through.
let balancer_changed = false;
let restored_count   = 0;
let dropped_count    = 0;
for (let snap in balancer_snapshot) {
    let new_bl = [];
    for (let t in snap.tokens) {
        if (t.kind == "name") {
            push(new_bl, t.value);
        } else if (t.kind == "id" && new_section_by_id[t.value]) {
            push(new_bl, new_section_by_id[t.value]);
            restored_count++;
        } else {
            dropped_count++;
        }
    }
    let cur = c.get("xray_core", snap.gname, snap.bf);
    if (type(cur) != "array") cur = (cur != null && cur != "") ? [cur] : [];
    if (join(",", new_bl) != join(",", cur)) {
        c.set("xray_core", snap.gname, snap.bf, new_bl);
        balancer_changed = true;
    }
}
if (restored_count > 0 || dropped_count > 0) {
    warn(sprintf("xray-sub apply [%s]: balancer replay — %d restored, %d dropped\n",
        sub_id, restored_count, dropped_count));
}

// === STEP 6: first-import bootstrap. Only fires when every balancer is empty
// (true on a fresh add, or after the user dropped every entry manually).
if (length(new_sections) > 0) {
    let any_balancer_set = false;
    c.foreach("xray_core", "general", function(g) {
        for (let bf in BALANCER_FIELDS) {
            let bl = g[bf];
            if (bl == null) continue;
            if (type(bl) == "array" && length(bl) > 0) any_balancer_set = true;
            else if (type(bl) != "array" && bl != "") any_balancer_set = true;
        }
    });
    if (!any_balancer_set) {
        let pick = [new_sections[0]];
        c.foreach("xray_core", "general", function(g) {
            for (let bf in BALANCER_FIELDS) {
                c.set("xray_core", g[".name"], bf, pick);
            }
            balancer_changed = true;
        });
    }
}

let meta_changed = false;
if (profile_title != "") {
    let cur = c.get("xray_core", sub_id, "profile_title") || "";
    if (cur != profile_title) {
        c.set("xray_core", sub_id, "profile_title", profile_title);
        meta_changed = true;
    }
}
if (interval_hours != "") {
    let cur = c.get("xray_core", sub_id, "update_interval_hours") || "";
    if (cur != interval_hours) {
        c.set("xray_core", sub_id, "update_interval_hours", interval_hours);
        meta_changed = true;
    }
}

let server_changes = length(added) + length(deleted) + length(updated);
let need_reload = server_changes > 0 || balancer_changed;

if (server_changes > 0 || meta_changed || balancer_changed) {
    c.save("xray_core");
    c.commit("xray_core");
}

printf('{"added":%d,"updated":%d,"deleted":%d,"meta_changed":%s,"reload":%s}\n',
    length(added), length(updated), length(deleted),
    meta_changed ? "true" : "false",
    need_reload ? "true" : "false");

exit(need_reload ? 10 : 0);
