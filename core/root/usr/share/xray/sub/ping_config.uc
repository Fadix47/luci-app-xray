#!/usr/bin/ucode
// ping_config.uc <base_port> <sub_id...> — emits a minimal Xray JSON to stdout
// with N http-inbounds on 127.0.0.1:base_port+i for tunnel-ping testing.

const uci_mod = require("uci");

let base_port = int(ARGV[0] || 42000);
let sub_ids = [];
for (let i = 1; i < length(ARGV); i++) push(sub_ids, ARGV[i]);

let c = uci_mod.cursor();
c.load("xray_core");

function first_port(p) {
    if (p == null) return 443;
    if (type(p) == "array") return int(p[0]);
    return int(p);
}

function get_alpn(s, proto) {
    let a = s[proto + "_tls_alpn"];
    if (a == null) return null;
    if (type(a) == "array") return a;
    return [a];
}

function build_xhttp_extra(s) {
    let extra = {};
    let raw = s.xhttp_extra_json || "";
    if (raw != "") {
        try {
            let parsed = json(raw);
            if (type(parsed) == "object") {
                for (let k in parsed) extra[k] = parsed[k];
            }
        } catch (e) { /* ignore */ }
    }
    let v = s.xhttp_extra_sc_max_concurrent_posts || "";
    if (v != "") extra.scMaxConcurrentPosts = int(v);
    v = s.xhttp_extra_sc_max_each_post_bytes || "";
    if (v != "") extra.scMaxEachPostBytes = int(v);
    v = s.xhttp_extra_sc_min_posts_interval_ms || "";
    if (v != "") extra.scMinPostsIntervalMs = int(v);
    if (s.xhttp_extra_no_sse_header == "1") extra.noSSEHeader = true;
    v = s.xhttp_extra_x_padding_bytes || "";
    if (v != "") extra.xPaddingBytes = v;
    return length(extra) > 0 ? extra : null;
}

function build_xhttp_download(s) {
    let addr = s.xhttp_download_address || "";
    if (addr == "") return null;
    let inner = {};
    let p = s.xhttp_download_path || "";
    let h = s.xhttp_download_host || "";
    if (p != "") inner.path = p;
    if (h != "") inner.host = h;
    let port = s.xhttp_download_port || "";
    return {
        address: addr,
        port: port != "" ? int(port) : 443,
        network: "xhttp",
        xhttpSettings: length(inner) > 0 ? inner : null
    };
}

// Mirror common/stream.mjs stream_hysteria() so the ping tunnel matches the
// real outbound (obfs/bandwidth/QUIC must line up or the server drops us).
// Defined before build_stream — ucode resolves these at call time, but this
// module's convention (and safety) is define-before-use.
function build_hysteria_settings(s) {
    let r = { version: 2, auth: s.password || "" };
    let up = s.hysteria_up_mbps || "";
    if (up != "") r.up = up + "mbps";
    let down = s.hysteria_down_mbps || "";
    if (down != "") r.down = down + "mbps";
    let idle = s.hysteria_udp_idle_timeout || "";
    if (idle != "") r.udpIdleTimeout = int(idle);
    let hop = s.hysteria_udphop_port || "";
    if (hop != "") r.udphop = { port: hop, interval: int(s.hysteria_udphop_interval || 30) };
    return r;
}

// Mirror common/stream.mjs stream_finalmask().
function build_finalmask(s) {
    let udp = [];
    if (s.hysteria_obfs_type == "salamander") {
        let pw = s.hysteria_obfs_password || "";
        if (pw != "") push(udp, { type: "salamander", settings: { password: pw } });
    }
    let quic = {};
    let cong = s.hysteria_congestion || "";
    if (cong != "") {
        quic.congestion = cong;
        if (cong == "bbr" && (s.hysteria_bbr_profile || "") != "") quic.bbrProfile = s.hysteria_bbr_profile;
        if (cong == "brutal" || cong == "force-brutal") {
            if ((s.hysteria_brutal_up || "") != "") quic.brutalUp = s.hysteria_brutal_up;
            if ((s.hysteria_brutal_down || "") != "") quic.brutalDown = s.hysteria_brutal_down;
        }
    }
    const intmap = {
        hysteria_quic_max_idle_timeout: "maxIdleTimeout",
        hysteria_quic_keep_alive_period: "keepAlivePeriod",
        hysteria_quic_max_incoming_streams: "maxIncomingStreams",
        hysteria_quic_init_stream_recv_window: "initStreamReceiveWindow",
        hysteria_quic_max_stream_recv_window: "maxStreamReceiveWindow",
        hysteria_quic_init_conn_recv_window: "initConnectionReceiveWindow",
        hysteria_quic_max_conn_recv_window: "maxConnectionReceiveWindow"
    };
    for (let k in intmap) {
        let v = s[k] || "";
        if (v != "") quic[intmap[k]] = int(v);
    }
    if (s.hysteria_quic_disable_mtu_discovery == "1") quic.disablePathMTUDiscovery = true;
    if (s.hysteria_quic_debug == "1") quic.debug = true;
    let r = {};
    if (length(udp) > 0) r.udp = udp;
    if (length(keys(quic)) > 0) r.quicParams = quic;
    if (length(keys(r)) == 0) return null;
    return r;
}

function build_stream(s, proto) {
    let net = s.transport || "tcp";
    if (net == "splithttp") net = "xhttp";
    let sec = s[proto + "_tls"] || "none";

    let stream = { network: net, security: sec };

    if (sec == "tls") {
        let t = {
            serverName: s[proto + "_tls_host"] || "",
            allowInsecure: (s[proto + "_tls_insecure"] || "0") != "0",
            fingerprint: s[proto + "_tls_fingerprint"] || ""
        };
        let alpn = get_alpn(s, proto);
        if (alpn) t.alpn = alpn;
        stream.tlsSettings = t;
    } else if (sec == "reality") {
        stream.realitySettings = {
            serverName: s[proto + "_reality_server_name"] || "",
            publicKey:  s[proto + "_reality_public_key"]  || "",
            shortId:    s[proto + "_reality_short_id"]    || "",
            spiderX:    s[proto + "_reality_spider_x"]    || "",
            fingerprint: s[proto + "_reality_fingerprint"] || ""
        };
    }

    if (net == "ws") {
        let h = null;
        if (s.ws_host != null && s.ws_host != "") h = { Host: s.ws_host };
        stream.wsSettings = { path: s.ws_path || "/", headers: h };
    } else if (net == "grpc") {
        stream.grpcSettings = {
            serviceName: s.grpc_service_name || "",
            multiMode:   (s.grpc_multi_mode || "0") == "1"
        };
    } else if (net == "xhttp") {
        let xs = {
            path: s.xhttp_path || "/",
            host: s.xhttp_host || ""
        };
        let mode = s.xhttp_mode || "auto";
        if (mode != "" && mode != "auto") xs.mode = mode;
        // xhttp servers often reject handshakes missing padding/sc* knobs — must forward them.
        let extra = build_xhttp_extra(s);
        if (extra != null) xs.extra = extra;
        let download = build_xhttp_download(s);
        if (download != null) xs.downloadSettings = download;
        stream.xhttpSettings = xs;
    } else if (net == "httpupgrade") {
        stream.httpupgradeSettings = {
            path: s.httpupgrade_path || "/",
            host: s.httpupgrade_host || ""
        };
    } else if (net == "h2") {
        let host = s.h2_host;
        if (type(host) != "array") host = host ? [host] : [];
        stream.httpSettings = { path: s.h2_path || "/", host: host };
    } else if (net == "hysteria") {
        stream.hysteriaSettings = build_hysteria_settings(s);
        let fm = build_finalmask(s);
        if (fm != null) stream.finalmask = fm;
    }
    return stream;
}

function vless_flow(s) {
    let f = null;
    if (s.vless_tls == "tls") f = s.vless_flow_tls;
    else if (s.vless_tls == "reality") f = s.vless_flow_reality;
    if (f == "none" || f == "") f = null;
    return f;
}

function build_outbound(sid, s, tag) {
    let proto = s.protocol || "";
    let addr  = s.server;
    let port  = first_port(s.server_port);
    if (!addr || !port) return null;

    let stream = build_stream(s, proto);

    if (proto == "vless") {
        return {
            protocol: "vless", tag: tag,
            settings: {
                vnext: [{
                    address: addr, port: port,
                    users: [{
                        id: s.password || "",
                        encryption: s.vless_encryption || "none",
                        flow: vless_flow(s)
                    }]
                }]
            },
            streamSettings: stream
        };
    }
    if (proto == "vmess") {
        return {
            protocol: "vmess", tag: tag,
            settings: {
                vnext: [{
                    address: addr, port: port,
                    users: [{
                        id: s.password || "",
                        security: s.vmess_security || "auto"
                    }]
                }]
            },
            streamSettings: stream
        };
    }
    if (proto == "trojan") {
        return {
            protocol: "trojan", tag: tag,
            settings: {
                servers: [{ address: addr, port: port, password: s.password || "" }]
            },
            streamSettings: stream
        };
    }
    if (proto == "shadowsocks") {
        return {
            protocol: "shadowsocks", tag: tag,
            settings: {
                servers: [{
                    address: addr, port: port,
                    password: s.password || "",
                    method: s.shadowsocks_security || "aes-128-gcm"
                }]
            },
            streamSettings: stream
        };
    }
    if (proto == "hysteria") {
        return {
            protocol: "hysteria", tag: tag,
            settings: { version: 2, address: addr, port: port },
            streamSettings: stream
        };
    }
    return null;
}

let cfg = {
    log: { loglevel: "warning" },
    inbounds: [],
    outbounds: [],
    routing: { rules: [] }
};

let i = 0;
for (let sid in sub_ids) {
    let s = c.get_all("xray_core", sid);
    let port = base_port + i;
    let in_tag  = "in-"  + sid;
    let out_tag = "out-" + sid;

    push(cfg.inbounds, {
        listen: "127.0.0.1",
        port: port,
        protocol: "http",
        tag: in_tag,
        settings: { allowTransparent: false }
    });

    let ob = null;
    if (s) ob = build_outbound(sid, s, out_tag);
    if (!ob) ob = { protocol: "blackhole", tag: out_tag };
    push(cfg.outbounds, ob);

    push(cfg.routing.rules, {
        type: "field",
        inboundTag: [in_tag],
        outboundTag: out_tag
    });
    i++;
}
push(cfg.outbounds, { protocol: "freedom", tag: "direct" });

printf("%J\n", cfg);
