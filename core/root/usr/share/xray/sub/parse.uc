#!/usr/bin/ucode
// Parse subscription body (stdin) into JSON array matching xray_core servers schema.
// Supports vmess/vless/trojan/ss/socks(5)/http(s)/hysteria2 URIs.

const B64_TBL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64decode(s) {
    if (s == null) return null;
    s = replace(s, "-", "+");
    s = replace(s, "_", "/");
    let pad = length(s) % 4;
    if (pad == 2) s += "==";
    else if (pad == 3) s += "=";
    else if (pad == 1) return null;
    let out = "";
    for (let i = 0; i < length(s); i += 4) {
        let n = 0, valid = 0;
        for (let j = 0; j < 4; j++) {
            let c = substr(s, i + j, 1);
            if (c == "=") break;
            let idx = index(B64_TBL, c);
            if (idx < 0) return null;
            n = (n << 6) | idx;
            valid++;
        }
        n = n << (6 * (4 - valid));
        if (valid >= 2) out += chr((n >> 16) & 0xff);
        if (valid >= 3) out += chr((n >> 8) & 0xff);
        if (valid >= 4) out += chr(n & 0xff);
    }
    return out;
}

function urldecode(s) {
    if (s == null) return null;
    let out = "";
    let i = 0;
    let n = length(s);
    while (i < n) {
        let c = substr(s, i, 1);
        if (c == "%" && i + 2 < n) {
            // ucode's int() is base-10 by default; pass 16 explicitly for hex.
            let hex = substr(s, i + 1, 2);
            let v = int(hex, 16);
            if (v != null && v >= 0 && v <= 255) {
                out += chr(v);
                i += 3;
                continue;
            }
        }
        if (c == "+") { out += " "; i++; continue; }
        out += c;
        i++;
    }
    return out;
}

function parse_query(qs) {
    let m = {};
    if (qs == null || qs == "") return m;
    let parts = split(qs, "&");
    for (let p in parts) {
        if (p == "") continue;
        let eq = index(p, "=");
        if (eq < 0) { m[urldecode(p)] = ""; continue; }
        m[urldecode(substr(p, 0, eq))] = urldecode(substr(p, eq + 1));
    }
    return m;
}

function split_url(line) {
    let scheme_end = index(line, "://");
    if (scheme_end < 0) return null;
    let scheme = substr(line, 0, scheme_end);
    let rest = substr(line, scheme_end + 3);
    let fragment = null;
    let hash_pos = index(rest, "#");
    if (hash_pos >= 0) {
        fragment = urldecode(substr(rest, hash_pos + 1));
        rest = substr(rest, 0, hash_pos);
    }
    let query = null;
    let q_pos = index(rest, "?");
    if (q_pos >= 0) {
        query = substr(rest, q_pos + 1);
        rest = substr(rest, 0, q_pos);
    }
    let userinfo = null;
    let at_pos = -1;
    for (let i = length(rest) - 1; i >= 0; i--) {
        if (substr(rest, i, 1) == "@") { at_pos = i; break; }
    }
    if (at_pos >= 0) {
        userinfo = substr(rest, 0, at_pos);
        rest = substr(rest, at_pos + 1);
    }
    let host = rest;
    let port = null;
    if (substr(host, 0, 1) == "[") {
        let rb = index(host, "]");
        if (rb >= 0) {
            let after = substr(host, rb + 1);
            host = substr(host, 1, rb - 1);
            if (substr(after, 0, 1) == ":") port = int(substr(after, 1));
        }
    } else {
        let colon = index(host, ":");
        if (colon >= 0) {
            port = int(substr(host, colon + 1));
            host = substr(host, 0, colon);
        }
    }
    return {
        scheme: scheme,
        userinfo: userinfo,
        host: host,
        port: port,
        query: parse_query(query),
        fragment: fragment
    };
}

// Stringify any JSON scalar into UCI form. sprintf("%d", str) misbehaves in some ucode builds.
function as_str(v) {
    if (v == null) return "";
    if (type(v) == "bool") return v ? "1" : "0";
    return "" + v;
}

function set_xhttp(out, q) {
    out.xhttp_path = q["path"] || "/";
    out.xhttp_host = q["host"] || "";
    let mode = q["mode"] || "auto";
    out.xhttp_mode = mode;

    if (q["extra"] != null && q["extra"] != "") {
        let extra;
        try { extra = json(q["extra"]); } catch (e) { extra = null; }
        if (type(extra) == "object") {
            // Pass through the whole extras object (minus downloadSettings,
            // which we store in dedicated fields) so unknown keys survive.
            let raw_extra = {};
            for (let k in extra) {
                if (k != "downloadSettings") raw_extra[k] = extra[k];
            }
            if (length(raw_extra) > 0) out.xhttp_extra_json = sprintf("%J", raw_extra);
            if (exists(extra, "scMaxConcurrentPosts"))  out.xhttp_extra_sc_max_concurrent_posts  = as_str(extra.scMaxConcurrentPosts);
            if (exists(extra, "scMaxEachPostBytes"))    out.xhttp_extra_sc_max_each_post_bytes   = as_str(extra.scMaxEachPostBytes);
            if (exists(extra, "scMinPostsIntervalMs"))  out.xhttp_extra_sc_min_posts_interval_ms = as_str(extra.scMinPostsIntervalMs);
            if (exists(extra, "noSSEHeader"))           out.xhttp_extra_no_sse_header            = extra.noSSEHeader ? "1" : "0";
            if (exists(extra, "xPaddingBytes"))         out.xhttp_extra_x_padding_bytes          = as_str(extra.xPaddingBytes);
            if (exists(extra, "downloadSettings") && type(extra.downloadSettings) == "object") {
                let d = extra.downloadSettings;
                if (exists(d, "address")) out.xhttp_download_address = as_str(d.address);
                if (exists(d, "port"))    out.xhttp_download_port    = as_str(d.port);
                let xs = (exists(d, "xhttpSettings") && type(d.xhttpSettings) == "object") ? d.xhttpSettings : d;
                if (exists(xs, "path"))   out.xhttp_download_path = as_str(xs.path);
                if (exists(xs, "host"))   out.xhttp_download_host = as_str(xs.host);
            }
        }
    }
    if (q["downloadSettings"] != null && q["downloadSettings"] != "" && out.xhttp_download_address == null) {
        let d;
        try { d = json(q["downloadSettings"]); } catch (e) { d = null; }
        if (type(d) == "object") {
            if (exists(d, "address")) out.xhttp_download_address = as_str(d.address);
            if (exists(d, "port")) out.xhttp_download_port = as_str(d.port);
            let xs = (exists(d, "xhttpSettings") && type(d.xhttpSettings) == "object") ? d.xhttpSettings : d;
            if (exists(xs, "path")) out.xhttp_download_path = as_str(xs.path);
            if (exists(xs, "host")) out.xhttp_download_host = as_str(xs.host);
        }
    }
}

function apply_transport(out, transport_value, q) {
    let t = transport_value || "tcp";
    if (t == "raw") t = "tcp";
    if (t == "splithttp") t = "xhttp";
    out.transport = t;

    if (t == "ws") {
        out.ws_path = q["path"] || "/";
        out.ws_host = q["host"] || "";
    } else if (t == "grpc") {
        out.grpc_service_name = q["serviceName"] || q["servicename"] || "";
        out.grpc_multi_mode = (q["mode"] == "multi") ? "1" : "0";
    } else if (t == "h2") {
        out.h2_path = q["path"] || "/";
        out.h2_host = q["host"] ? split(q["host"], ",") : [];
    } else if (t == "httpupgrade") {
        out.httpupgrade_path = q["path"] || "/";
        out.httpupgrade_host = q["host"] || "";
    } else if (t == "xhttp") {
        set_xhttp(out, q);
    } else if (t == "tcp") {
        if (q["headerType"] == "http") {
            out.tcp_guise = "http";
            out.http_path = q["path"] || "/";
            out.http_host = q["host"] || "";
        } else {
            out.tcp_guise = "none";
        }
    } else if (t == "mkcp") {
        out.mkcp_guise = q["headerType"] || "none";
        if (q["seed"]) out.mkcp_seed = q["seed"];
    } else if (t == "quic") {
        out.quic_security = q["quicSecurity"] || "none";
        out.quic_key = q["key"] || "";
        out.quic_guise = q["headerType"] || "none";
    }
}

function apply_tls(out, proto_prefix, q) {
    let sec = q["security"] || "none";
    out[proto_prefix + "_tls"] = sec;
    if (sec == "tls") {
        out[proto_prefix + "_tls_host"] = q["sni"] || q["host"] || "";
        out[proto_prefix + "_tls_fingerprint"] = q["fp"] || "";
        if (q["alpn"]) out[proto_prefix + "_tls_alpn"] = split(q["alpn"], ",");
        let insec = q["allowInsecure"] || q["allowinsecure"] || "0";
        out[proto_prefix + "_tls_insecure"] = (insec == "1" || insec == "true") ? "1" : "0";
    } else if (sec == "reality") {
        out[proto_prefix + "_reality_server_name"] = q["sni"] || "";
        out[proto_prefix + "_reality_public_key"] = q["pbk"] || "";
        out[proto_prefix + "_reality_short_id"] = q["sid"] || "";
        out[proto_prefix + "_reality_spider_x"] = q["spx"] || "";
        out[proto_prefix + "_reality_fingerprint"] = q["fp"] || "";
    }
}

function parse_vless(line) {
    let u = split_url(line);
    if (u == null || !u.host || !u.port) return null;
    let q = u.query;
    let out = {
        protocol: "vless",
        alias: u.fragment || (u.host + ":" + u.port),
        server: u.host,
        server_port: u.port,
        username: u.fragment || "",
        password: urldecode(u.userinfo || ""),
        vless_encryption: q["encryption"] || "none",
    };
    apply_transport(out, q["type"], q);
    apply_tls(out, "vless", q);
    let flow = q["flow"] || "none";
    if (out.vless_tls == "tls") out.vless_flow_tls = flow;
    else if (out.vless_tls == "reality") out.vless_flow_reality = flow;
    return out;
}

function parse_vmess(line) {
    let payload = substr(line, 8);
    let decoded = b64decode(payload);
    if (!decoded) return null;
    let v;
    try { v = json(decoded); } catch (e) { v = null; }
    if (type(v) != "object") return null;
    let net = v.net || "tcp";
    if (net == "splithttp") net = "xhttp";
    let out = {
        protocol: "vmess",
        alias: v.ps || (v.add + ":" + v.port),
        server: sprintf("%s", v.add || ""),
        server_port: int(v.port || 0),
        password: sprintf("%s", v.id || ""),
        username: sprintf("%s", v.ps || ""),
        vmess_security: v.scy || "auto",
    };
    if (out.server == "" || out.server_port == 0) return null;
    // Build a synthetic query map so apply_transport can reuse logic
    let q = {
        path: v.path || "/",
        host: v.host || "",
        headerType: v.type || "",
        serviceName: (net == "grpc") ? (v.path || "") : "",
        mode: v.type || "auto",
        extra: v.extra || ""
    };
    apply_transport(out, net, q);
    if (v.tls == "tls" || v.tls == "reality") {
        let tq = { security: v.tls, sni: v.sni || v.host || "", fp: v.fp || "", alpn: v.alpn || "" };
        apply_tls(out, "vmess", tq);
    } else {
        out.vmess_tls = "none";
    }
    return out;
}

function parse_trojan(line) {
    let u = split_url(line);
    if (u == null || !u.host || !u.port) return null;
    let q = u.query;
    if (!q["security"]) q["security"] = "tls";
    let out = {
        protocol: "trojan",
        alias: u.fragment || (u.host + ":" + u.port),
        server: u.host,
        server_port: u.port,
        password: urldecode(u.userinfo || ""),
        username: "",
    };
    apply_transport(out, q["type"], q);
    apply_tls(out, "trojan", q);
    return out;
}

function parse_ss(line) {
    let u = split_url(line);
    if (u == null || !u.host || !u.port) return null;
    let userinfo = u.userinfo || "";
    let method = "", password = "";
    let raw = urldecode(userinfo);
    if (index(raw, ":") >= 0) {
        let parts = split(raw, ":", 2);
        method = parts[0]; password = parts[1] || "";
    } else {
        let dec = b64decode(userinfo);
        if (dec != null && index(dec, ":") >= 0) {
            let parts = split(dec, ":", 2);
            method = parts[0]; password = parts[1] || "";
        }
    }
    return {
        protocol: "shadowsocks",
        alias: u.fragment || (u.host + ":" + u.port),
        server: u.host,
        server_port: u.port,
        username: "",
        password: password,
        shadowsocks_security: method,
        transport: "tcp"
    };
}

function parse_socks_http(line, proto) {
    let u = split_url(line);
    if (u == null || !u.host || !u.port) return null;
    let username = "", password = "";
    if (u.userinfo) {
        let raw = urldecode(u.userinfo);
        let dec = b64decode(u.userinfo);
        let src = (dec != null && index(dec, ":") >= 0) ? dec : raw;
        let parts = split(src, ":", 2);
        username = parts[0] || "";
        password = parts[1] || "";
    }
    return {
        protocol: proto,
        alias: u.fragment || (u.host + ":" + u.port),
        server: u.host,
        server_port: u.port,
        username: username,
        password: password,
        transport: "tcp"
    };
}

// Flatten a finalmask object (as carried in the `fm` query param, mirroring
// re-ui's stream.finalmask) into the flat hysteria_* UCI fields.
function apply_finalmask(out, fm) {
    if (type(fm) != "object") return;
    // Salamander obfs lives in fm.udp = [{type,settings:{password}}].
    if (type(fm.udp) == "array") {
        for (let m in fm.udp) {
            if (type(m) == "object" && m.type == "salamander") {
                out.hysteria_obfs_type = "salamander";
                if (type(m.settings) == "object" && m.settings.password != null && m.settings.password != "") {
                    out.hysteria_obfs_password = as_str(m.settings.password);
                }
            }
        }
    }
    let qp = fm.quicParams;
    if (type(qp) != "object") return;
    if (qp.congestion != null && qp.congestion != "") out.hysteria_congestion = as_str(qp.congestion);
    if (qp.bbrProfile != null && qp.bbrProfile != "") out.hysteria_bbr_profile = as_str(qp.bbrProfile);
    if (qp.brutalUp != null && qp.brutalUp != "") out.hysteria_brutal_up = as_str(qp.brutalUp);
    if (qp.brutalDown != null && qp.brutalDown != "") out.hysteria_brutal_down = as_str(qp.brutalDown);
    if (type(qp.udpHop) == "object") {
        if (qp.udpHop.ports != null && qp.udpHop.ports != "") out.hysteria_udphop_port = as_str(qp.udpHop.ports);
        if (qp.udpHop.interval != null && qp.udpHop.interval != "") out.hysteria_udphop_interval = as_str(qp.udpHop.interval);
    }
    if (qp.maxIdleTimeout != null) out.hysteria_quic_max_idle_timeout = as_str(qp.maxIdleTimeout);
    if (qp.keepAlivePeriod != null) out.hysteria_quic_keep_alive_period = as_str(qp.keepAlivePeriod);
    if (qp.maxIncomingStreams != null) out.hysteria_quic_max_incoming_streams = as_str(qp.maxIncomingStreams);
    if (qp.initStreamReceiveWindow != null) out.hysteria_quic_init_stream_recv_window = as_str(qp.initStreamReceiveWindow);
    if (qp.maxStreamReceiveWindow != null) out.hysteria_quic_max_stream_recv_window = as_str(qp.maxStreamReceiveWindow);
    if (qp.initConnectionReceiveWindow != null) out.hysteria_quic_init_conn_recv_window = as_str(qp.initConnectionReceiveWindow);
    if (qp.maxConnectionReceiveWindow != null) out.hysteria_quic_max_conn_recv_window = as_str(qp.maxConnectionReceiveWindow);
    if (qp.disablePathMTUDiscovery === true) out.hysteria_quic_disable_mtu_discovery = "1";
    if (qp.debug === true) out.hysteria_quic_debug = "1";
}

function parse_hysteria2(line) {
    let u = split_url(line);
    if (u == null || !u.host || !u.port) return null;
    let q = u.query;
    let out = {
        protocol: "hysteria",
        alias: u.fragment || (u.host + ":" + u.port),
        server: u.host,
        server_port: u.port,
        password: urldecode(u.userinfo || ""),
        username: "",
        transport: "hysteria"
    };
    if (q["up"]) out.hysteria_up_mbps = q["up"];
    if (q["down"]) out.hysteria_down_mbps = q["down"];
    // Salamander obfuscation (standard hysteria2 URI params).
    if (q["obfs"] == "salamander") {
        out.hysteria_obfs_type = "salamander";
        let opw = q["obfs-password"] || q["obfsParam"] || "";
        if (opw != "") out.hysteria_obfs_password = opw;
    }
    // v2rayN-style UDP port hopping range.
    if (q["mport"] && q["mport"] != "") out.hysteria_udphop_port = q["mport"];
    // Full finalmask blob (re-ui `fm` param) — fills congestion + QUIC tuning.
    if (q["fm"] != null && q["fm"] != "") {
        let fm;
        try { fm = json(q["fm"]); } catch (e) { fm = null; }
        apply_finalmask(out, fm);
    }
    out.hysteria_tls = "tls";
    out.hysteria_tls_host = q["sni"] || q["peer"] || u.host;
    out.hysteria_tls_insecure = (q["insecure"] == "1" || q["insecure"] == "true") ? "1" : "0";
    if (q["alpn"]) out.hysteria_tls_alpn = split(q["alpn"], ",");
    if (q["fp"]) out.hysteria_tls_fingerprint = q["fp"];
    return out;
}

function parse_line(line) {
    if (line == null) return null;
    line = trim(line);
    if (line == "") return null;
    if (substr(line, 0, 8) == "vmess://") return parse_vmess(line);
    if (substr(line, 0, 8) == "vless://") return parse_vless(line);
    if (substr(line, 0, 9) == "trojan://") return parse_trojan(line);
    if (substr(line, 0, 5) == "ss://") return parse_ss(line);
    if (substr(line, 0, 9) == "socks5://") return parse_socks_http(line, "socks");
    if (substr(line, 0, 8) == "socks://") return parse_socks_http(line, "socks");
    if (substr(line, 0, 7) == "http://" || substr(line, 0, 8) == "https://") return parse_socks_http(line, "http");
    if (substr(line, 0, 12) == "hysteria2://" || substr(line, 0, 6) == "hy2://") return parse_hysteria2(line);
    return null;
}

const fs = require("fs");
let text = fs.stdin.read("all") || "";
let lines = split(text, "\n");
let results = [];
for (let l in lines) {
    let p = parse_line(l);
    if (p != null) push(results, p);
}
printf("%J\n", results);
