'use strict';
'require baseclass';
'require form';

function transport_tcp(transport, sub_section, tab_name) {
    transport.value("tcp", "TCP (RAW)");

    let tcp_guise = sub_section.taboption(tab_name, form.ListValue, "tcp_guise", _("[tcp] Fake Header Type"));
    tcp_guise.depends("transport", "tcp");
    tcp_guise.value("none", _("None"));
    tcp_guise.value("http", "HTTP");
    tcp_guise.modalonly = true;

    let http_host = sub_section.taboption(tab_name, form.DynamicList, "http_host", _("[tcp][fake_http] Host"));
    http_host.depends("tcp_guise", "http");
    http_host.rmempty = false;
    http_host.modalonly = true;

    let http_path = sub_section.taboption(tab_name, form.DynamicList, "http_path", _("[tcp][fake_http] Path"));
    http_path.depends("tcp_guise", "http");
    http_path.modalonly = true;
}

function transport_mkcp(transport, sub_section, tab_name) {
    transport.value("mkcp", "mKCP");

    let mkcp_guise = sub_section.taboption(tab_name, form.ListValue, "mkcp_guise", _("[mkcp] Fake Header Type"));
    mkcp_guise.depends("transport", "mkcp");
    mkcp_guise.value("none", _("None"));
    mkcp_guise.value("srtp", _("VideoCall (SRTP)"));
    mkcp_guise.value("utp", _("BitTorrent (uTP)"));
    mkcp_guise.value("wechat-video", _("WechatVideo"));
    mkcp_guise.value("dtls", "DTLS 1.2");
    mkcp_guise.value("wireguard", "WireGuard");
    mkcp_guise.modalonly = true;

    let mkcp_mtu = sub_section.taboption(tab_name, form.Value, "mkcp_mtu", _("[mkcp] Maximum Transmission Unit"));
    mkcp_mtu.datatype = "uinteger";
    mkcp_mtu.depends("transport", "mkcp");
    mkcp_mtu.placeholder = 1350;
    mkcp_mtu.modalonly = true;

    let mkcp_tti = sub_section.taboption(tab_name, form.Value, "mkcp_tti", _("[mkcp] Transmission Time Interval"));
    mkcp_tti.datatype = "uinteger";
    mkcp_tti.depends("transport", "mkcp");
    mkcp_tti.placeholder = 50;
    mkcp_tti.modalonly = true;

    let mkcp_uplink_capacity = sub_section.taboption(tab_name, form.Value, "mkcp_uplink_capacity", _("[mkcp] Uplink Capacity"));
    mkcp_uplink_capacity.datatype = "uinteger";
    mkcp_uplink_capacity.depends("transport", "mkcp");
    mkcp_uplink_capacity.placeholder = 5;
    mkcp_uplink_capacity.modalonly = true;

    let mkcp_downlink_capacity = sub_section.taboption(tab_name, form.Value, "mkcp_downlink_capacity", _("[mkcp] Downlink Capacity"));
    mkcp_downlink_capacity.datatype = "uinteger";
    mkcp_downlink_capacity.depends("transport", "mkcp");
    mkcp_downlink_capacity.placeholder = 20;
    mkcp_downlink_capacity.modalonly = true;

    let mkcp_read_buffer_size = sub_section.taboption(tab_name, form.Value, "mkcp_read_buffer_size", _("[mkcp] Read Buffer Size"));
    mkcp_read_buffer_size.datatype = "uinteger";
    mkcp_read_buffer_size.depends("transport", "mkcp");
    mkcp_read_buffer_size.placeholder = 2;
    mkcp_read_buffer_size.modalonly = true;

    let mkcp_write_buffer_size = sub_section.taboption(tab_name, form.Value, "mkcp_write_buffer_size", _("[mkcp] Write Buffer Size"));
    mkcp_write_buffer_size.datatype = "uinteger";
    mkcp_write_buffer_size.depends("transport", "mkcp");
    mkcp_write_buffer_size.placeholder = 2;
    mkcp_write_buffer_size.modalonly = true;

    let mkcp_congestion = sub_section.taboption(tab_name, form.Flag, "mkcp_congestion", _("[mkcp] Congestion Control"));
    mkcp_congestion.depends("transport", "mkcp");
    mkcp_congestion.modalonly = true;

    let mkcp_seed = sub_section.taboption(tab_name, form.Value, "mkcp_seed", _("[mkcp] Seed"));
    mkcp_seed.depends("transport", "mkcp");
    mkcp_seed.modalonly = true;
}

function transport_ws(transport, sub_section, tab_name) {
    transport.value("ws", "WebSocket");

    let ws_host = sub_section.taboption(tab_name, form.Value, "ws_host", _("[websocket] Host"));
    ws_host.depends("transport", "ws");
    ws_host.modalonly = true;

    let ws_path = sub_section.taboption(tab_name, form.Value, "ws_path", _("[websocket] Path"));
    ws_path.depends("transport", "ws");
    ws_path.modalonly = true;
}

function transport_h2(transport, sub_section, tab_name) {
    transport.value("h2", "HTTP/2");

    let h2_host = sub_section.taboption(tab_name, form.DynamicList, "h2_host", _("[http2] Host"));
    h2_host.depends("transport", "h2");
    h2_host.modalonly = true;

    let h2_path = sub_section.taboption(tab_name, form.Value, "h2_path", _("[http2] Path"));
    h2_path.depends("transport", "h2");
    h2_path.modalonly = true;

    let h2_health_check = sub_section.taboption(tab_name, form.Flag, "h2_health_check", _("[h2] Health Check"));
    h2_health_check.depends("transport", "h2");
    h2_health_check.modalonly = true;

    let h2_read_idle_timeout = sub_section.taboption(tab_name, form.Value, "h2_read_idle_timeout", _("[h2] Read Idle Timeout"));
    h2_read_idle_timeout.depends({ "transport": "h2", "h2_health_check": "1" });
    h2_read_idle_timeout.modalonly = true;
    h2_read_idle_timeout.placeholder = 10;
    h2_read_idle_timeout.datatype = 'integer';

    let h2_health_check_timeout = sub_section.taboption(tab_name, form.Value, "h2_health_check_timeout", _("[h2] Health Check Timeout"));
    h2_health_check_timeout.depends({ "transport": "h2", "h2_health_check": "1" });
    h2_health_check_timeout.modalonly = true;
    h2_health_check_timeout.placeholder = 20;
    h2_health_check_timeout.datatype = 'integer';
}

function transport_quic(transport, sub_section, tab_name) {
    transport.value("quic", "QUIC");

    let quic_security = sub_section.taboption(tab_name, form.ListValue, "quic_security", _("[quic] Security"));
    quic_security.depends("transport", "quic");
    quic_security.value("none", "none");
    quic_security.value("aes-128-gcm", "aes-128-gcm");
    quic_security.value("chacha20-poly1305", "chacha20-poly1305");
    quic_security.rmempty = false;
    quic_security.modalonly = true;

    let quic_key = sub_section.taboption(tab_name, form.Value, "quic_key", _("[quic] Key"));
    quic_key.depends("transport", "quic");
    quic_key.modalonly = true;

    let quic_guise = sub_section.taboption(tab_name, form.ListValue, "quic_guise", _("[quic] Fake Header Type"));
    quic_guise.depends("transport", "quic");
    quic_guise.value("none", _("None"));
    quic_guise.value("srtp", _("VideoCall (SRTP)"));
    quic_guise.value("utp", _("BitTorrent (uTP)"));
    quic_guise.value("wechat-video", _("WechatVideo"));
    quic_guise.value("dtls", "DTLS 1.2");
    quic_guise.value("wireguard", "WireGuard");
    quic_guise.default = "none";
    quic_guise.modalonly = true;
}

function transport_grpc(transport, sub_section, tab_name) {
    transport.value("grpc", "gRPC");

    let grpc_service_name = sub_section.taboption(tab_name, form.Value, "grpc_service_name", _("[grpc] Service Name"));
    grpc_service_name.depends("transport", "grpc");
    grpc_service_name.modalonly = true;

    let grpc_multi_mode = sub_section.taboption(tab_name, form.Flag, "grpc_multi_mode", _("[grpc] Multi Mode"));
    grpc_multi_mode.depends("transport", "grpc");
    grpc_multi_mode.modalonly = true;

    let grpc_health_check = sub_section.taboption(tab_name, form.Flag, "grpc_health_check", _("[grpc] Health Check"));
    grpc_health_check.depends("transport", "grpc");
    grpc_health_check.modalonly = true;

    let grpc_idle_timeout = sub_section.taboption(tab_name, form.Value, "grpc_idle_timeout", _("[grpc] Idle Timeout"));
    grpc_idle_timeout.depends({ "transport": "grpc", "grpc_health_check": "1" });
    grpc_idle_timeout.modalonly = true;
    grpc_idle_timeout.placeholder = 10;
    grpc_idle_timeout.datatype = 'integer';

    let grpc_health_check_timeout = sub_section.taboption(tab_name, form.Value, "grpc_health_check_timeout", _("[grpc] Health Check Timeout"));
    grpc_health_check_timeout.depends({ "transport": "grpc", "grpc_health_check": "1" });
    grpc_health_check_timeout.modalonly = true;
    grpc_health_check_timeout.placeholder = 20;
    grpc_health_check_timeout.datatype = 'integer';

    let grpc_permit_without_stream = sub_section.taboption(tab_name, form.Flag, "grpc_permit_without_stream", _("[grpc] Permit Without Stream"));
    grpc_permit_without_stream.depends({ "transport": "grpc", "grpc_health_check": "1" });
    grpc_permit_without_stream.modalonly = true;

    let grpc_initial_windows_size = sub_section.taboption(tab_name, form.Value, "grpc_initial_windows_size", _("[grpc] Initial Windows Size"), _("Set to 524288 to avoid Cloudflare sending ENHANCE_YOUR_CALM."));
    grpc_initial_windows_size.depends("transport", "grpc");
    grpc_initial_windows_size.modalonly = true;
    grpc_initial_windows_size.placeholder = 0;
    grpc_initial_windows_size.datatype = 'integer';
}

function transport_httpupgrade(transport, sub_section, tab_name) {
    transport.value("httpupgrade", "HTTPUpgrade");

    let httpupgrade_host = sub_section.taboption(tab_name, form.Value, "httpupgrade_host", _("[httpupgrade] Host"));
    httpupgrade_host.depends("transport", "httpupgrade");
    httpupgrade_host.modalonly = true;

    let httpupgrade_path = sub_section.taboption(tab_name, form.Value, "httpupgrade_path", _("[httpupgrade] Path"));
    httpupgrade_path.depends("transport", "httpupgrade");
    httpupgrade_path.modalonly = true;
}

function transport_xhttp(transport, sub_section, tab_name) {
    transport.value("xhttp", "XHTTP");

    let xhttp_host = sub_section.taboption(tab_name, form.Value, "xhttp_host", _("[xhttp] Host"));
    xhttp_host.depends("transport", "xhttp");
    xhttp_host.modalonly = true;

    let xhttp_path = sub_section.taboption(tab_name, form.Value, "xhttp_path", _("[xhttp] Path"));
    xhttp_path.depends("transport", "xhttp");
    xhttp_path.modalonly = true;

    let xhttp_mode = sub_section.taboption(tab_name, form.ListValue, "xhttp_mode", _("[xhttp] Mode"));
    xhttp_mode.depends("transport", "xhttp");
    xhttp_mode.value("auto", "auto");
    xhttp_mode.value("packet-up", "packet-up");
    xhttp_mode.value("stream-up", "stream-up");
    xhttp_mode.value("stream-one", "stream-one");
    xhttp_mode.default = "auto";
    xhttp_mode.modalonly = true;

    let sc_max_concurrent_posts = sub_section.taboption(tab_name, form.Value, "xhttp_extra_sc_max_concurrent_posts", _("[xhttp extra] scMaxConcurrentPosts"));
    sc_max_concurrent_posts.depends("transport", "xhttp");
    sc_max_concurrent_posts.datatype = "integer";
    sc_max_concurrent_posts.rmempty = true;
    sc_max_concurrent_posts.modalonly = true;

    let sc_max_each_post_bytes = sub_section.taboption(tab_name, form.Value, "xhttp_extra_sc_max_each_post_bytes", _("[xhttp extra] scMaxEachPostBytes"));
    sc_max_each_post_bytes.depends("transport", "xhttp");
    sc_max_each_post_bytes.datatype = "integer";
    sc_max_each_post_bytes.rmempty = true;
    sc_max_each_post_bytes.modalonly = true;

    let sc_min_posts_interval_ms = sub_section.taboption(tab_name, form.Value, "xhttp_extra_sc_min_posts_interval_ms", _("[xhttp extra] scMinPostsIntervalMs"));
    sc_min_posts_interval_ms.depends("transport", "xhttp");
    sc_min_posts_interval_ms.datatype = "integer";
    sc_min_posts_interval_ms.rmempty = true;
    sc_min_posts_interval_ms.modalonly = true;

    let no_sse_header = sub_section.taboption(tab_name, form.Flag, "xhttp_extra_no_sse_header", _("[xhttp extra] noSSEHeader"));
    no_sse_header.depends("transport", "xhttp");
    no_sse_header.rmempty = true;
    no_sse_header.modalonly = true;

    let x_padding_bytes = sub_section.taboption(tab_name, form.Value, "xhttp_extra_x_padding_bytes", _("[xhttp extra] xPaddingBytes"), _("e.g. 100-1000"));
    x_padding_bytes.depends("transport", "xhttp");
    x_padding_bytes.rmempty = true;
    x_padding_bytes.modalonly = true;

    let extra_json = sub_section.taboption(tab_name, form.TextValue, "xhttp_extra_json", _("[xhttp extra] Raw JSON"), _("Full <code>extra</code> object passed through unchanged from the subscription. Preserves fields the generator does not know about (e.g. <code>xPaddingObfsMode</code>, <code>xPaddingMethod</code>, <code>xPaddingHeader</code>, <code>scMaxBufferedPosts</code>, <code>scStreamUpServerSecs</code>, <code>xmux</code>, custom <code>headers</code>). Fields above (sc*, noSSEHeader, xPaddingBytes) override matching keys here, so edits in the UI win over what came from the URL. If this field is empty after a subscription fetch, run <code>logread -e xray-sub</code> to see whether parse.uc saw the <code>extra=</code> parameter."));
    extra_json.depends("transport", "xhttp");
    extra_json.monospace = true;
    extra_json.rows = 8;
    extra_json.rmempty = true;
    extra_json.modalonly = true;
    extra_json.validate = function(_sid, v) {
        if (!v) return true;
        try { JSON.parse(v); return true; } catch (e) { return _('Must be valid JSON: ') + e; }
    };

    let download_address = sub_section.taboption(tab_name, form.Value, "xhttp_download_address", _("[xhttp download] Address"), _("Enable split upload/download mode by setting a download address."));
    download_address.depends("transport", "xhttp");
    download_address.datatype = "host";
    download_address.rmempty = true;
    download_address.modalonly = true;

    let download_port = sub_section.taboption(tab_name, form.Value, "xhttp_download_port", _("[xhttp download] Port"));
    download_port.depends("transport", "xhttp");
    download_port.datatype = "port";
    download_port.placeholder = "443";
    download_port.rmempty = true;
    download_port.modalonly = true;

    let download_path = sub_section.taboption(tab_name, form.Value, "xhttp_download_path", _("[xhttp download] Path"));
    download_path.depends("transport", "xhttp");
    download_path.rmempty = true;
    download_path.modalonly = true;

    let download_host = sub_section.taboption(tab_name, form.Value, "xhttp_download_host", _("[xhttp download] Host"));
    download_host.depends("transport", "xhttp");
    download_host.rmempty = true;
    download_host.modalonly = true;
}

function transport_hysteria(transport, sub_section, tab_name) {
    transport.value("hysteria", "Hysteria2");

    // Bandwidth. Field names kept as *_mbps so they line up with config
    // generation (stream.mjs) and subscription import (parse.uc / apply.uc).
    let hysteria_up = sub_section.taboption(tab_name, form.Value, "hysteria_up_mbps", _("[hysteria] Up Speed Limit"), _("Unit in Mbps; Leave both up and down empty to disable Brutal congestion control."));
    hysteria_up.depends("transport", "hysteria");
    hysteria_up.placeholder = "";
    hysteria_up.datatype = "uinteger";
    hysteria_up.rmempty = true;
    hysteria_up.modalonly = true;

    let hysteria_down = sub_section.taboption(tab_name, form.Value, "hysteria_down_mbps", _("[hysteria] Down Speed Limit"), _("Unit in Mbps; Leave both up and down empty to disable Brutal congestion control."));
    hysteria_down.depends("transport", "hysteria");
    hysteria_down.placeholder = "";
    hysteria_down.datatype = "uinteger";
    hysteria_down.rmempty = true;
    hysteria_down.modalonly = true;

    let hysteria_udp_idle_timeout = sub_section.taboption(tab_name, form.Value, "hysteria_udp_idle_timeout", _("[hysteria] UDP Idle Timeout"), _("Seconds (2-600). Default 60."));
    hysteria_udp_idle_timeout.depends("transport", "hysteria");
    hysteria_udp_idle_timeout.placeholder = "60";
    hysteria_udp_idle_timeout.datatype = "range(2,600)";
    hysteria_udp_idle_timeout.rmempty = true;
    hysteria_udp_idle_timeout.modalonly = true;

    // --- Obfuscation (Salamander). Must match the server's obfs-password. ---
    let hysteria_obfs_type = sub_section.taboption(tab_name, form.ListValue, "hysteria_obfs_type", _("[hysteria] Obfuscation"));
    hysteria_obfs_type.depends("transport", "hysteria");
    hysteria_obfs_type.value("", _("Off"));
    hysteria_obfs_type.value("salamander", "Salamander");
    hysteria_obfs_type.rmempty = true;
    hysteria_obfs_type.modalonly = true;

    let hysteria_obfs_password = sub_section.taboption(tab_name, form.Value, "hysteria_obfs_password", _("[hysteria] Obfs Password"), _("Salamander obfuscation password. Must match the server (obfs-password)."));
    hysteria_obfs_password.depends("hysteria_obfs_type", "salamander");
    hysteria_obfs_password.rmempty = true;
    hysteria_obfs_password.modalonly = true;

    // --- QUIC congestion control ---
    let hysteria_congestion = sub_section.taboption(tab_name, form.ListValue, "hysteria_congestion", _("[hysteria] Congestion"));
    hysteria_congestion.depends("transport", "hysteria");
    hysteria_congestion.value("", _("Default"));
    hysteria_congestion.value("bbr", "BBR");
    hysteria_congestion.value("brutal", "Brutal");
    hysteria_congestion.value("force-brutal", "Force-Brutal");
    hysteria_congestion.value("reno", "Reno");
    hysteria_congestion.rmempty = true;
    hysteria_congestion.modalonly = true;

    let hysteria_bbr_profile = sub_section.taboption(tab_name, form.ListValue, "hysteria_bbr_profile", _("[hysteria] BBR Profile"));
    hysteria_bbr_profile.depends("hysteria_congestion", "bbr");
    hysteria_bbr_profile.value("conservative", _("Conservative"));
    hysteria_bbr_profile.value("standard", _("Standard"));
    hysteria_bbr_profile.value("aggressive", _("Aggressive"));
    hysteria_bbr_profile.rmempty = true;
    hysteria_bbr_profile.modalonly = true;

    let hysteria_brutal_up = sub_section.taboption(tab_name, form.Value, "hysteria_brutal_up", _("[hysteria] Brutal Up"), _("e.g. <code>60 mbps</code>"));
    hysteria_brutal_up.depends("hysteria_congestion", "brutal");
    hysteria_brutal_up.depends("hysteria_congestion", "force-brutal");
    hysteria_brutal_up.placeholder = "60 mbps";
    hysteria_brutal_up.rmempty = true;
    hysteria_brutal_up.modalonly = true;

    let hysteria_brutal_down = sub_section.taboption(tab_name, form.Value, "hysteria_brutal_down", _("[hysteria] Brutal Down"), _("e.g. <code>100 mbps</code>"));
    hysteria_brutal_down.depends("hysteria_congestion", "brutal");
    hysteria_brutal_down.depends("hysteria_congestion", "force-brutal");
    hysteria_brutal_down.placeholder = "100 mbps";
    hysteria_brutal_down.rmempty = true;
    hysteria_brutal_down.modalonly = true;

    // --- UDP port hopping (v2rayN mport) ---
    let hysteria_udphop_port = sub_section.taboption(tab_name, form.Value, "hysteria_udphop_port", _("[hysteria] UDP Hop"), _("Port Range"));
    hysteria_udphop_port.depends("transport", "hysteria");
    hysteria_udphop_port.placeholder = "20000-50000";
    hysteria_udphop_port.datatype = "portrange";
    hysteria_udphop_port.rmempty = true;
    hysteria_udphop_port.modalonly = true;

    let hysteria_udphop_interval = sub_section.taboption(tab_name, form.Value, "hysteria_udphop_interval", _("[hysteria] UDP Hop Interval"), _("seconds"));
    hysteria_udphop_interval.depends("transport", "hysteria");
    hysteria_udphop_interval.placeholder = "30";
    hysteria_udphop_interval.datatype = "uinteger";
    hysteria_udphop_interval.rmempty = true;
    hysteria_udphop_interval.modalonly = true;

    // --- Advanced QUIC parameters (leave empty for fork defaults) ---
    let hysteria_quic_max_idle_timeout = sub_section.taboption(tab_name, form.Value, "hysteria_quic_max_idle_timeout", _("[hysteria] QUIC Max Idle Timeout"), _("seconds"));
    hysteria_quic_max_idle_timeout.depends("transport", "hysteria");
    hysteria_quic_max_idle_timeout.placeholder = "30";
    hysteria_quic_max_idle_timeout.datatype = "uinteger";
    hysteria_quic_max_idle_timeout.rmempty = true;
    hysteria_quic_max_idle_timeout.modalonly = true;

    let hysteria_quic_keep_alive_period = sub_section.taboption(tab_name, form.Value, "hysteria_quic_keep_alive_period", _("[hysteria] QUIC Keep-Alive Period"), _("seconds"));
    hysteria_quic_keep_alive_period.depends("transport", "hysteria");
    hysteria_quic_keep_alive_period.placeholder = "10";
    hysteria_quic_keep_alive_period.datatype = "uinteger";
    hysteria_quic_keep_alive_period.rmempty = true;
    hysteria_quic_keep_alive_period.modalonly = true;

    let hysteria_quic_max_incoming_streams = sub_section.taboption(tab_name, form.Value, "hysteria_quic_max_incoming_streams", _("[hysteria] QUIC Max Incoming Streams"));
    hysteria_quic_max_incoming_streams.depends("transport", "hysteria");
    hysteria_quic_max_incoming_streams.placeholder = "1024";
    hysteria_quic_max_incoming_streams.datatype = "uinteger";
    hysteria_quic_max_incoming_streams.rmempty = true;
    hysteria_quic_max_incoming_streams.modalonly = true;

    let hysteria_quic_init_stream_recv_window = sub_section.taboption(tab_name, form.Value, "hysteria_quic_init_stream_recv_window", _("[hysteria] QUIC Init Stream Recv Window"));
    hysteria_quic_init_stream_recv_window.depends("transport", "hysteria");
    hysteria_quic_init_stream_recv_window.placeholder = "8388608";
    hysteria_quic_init_stream_recv_window.datatype = "uinteger";
    hysteria_quic_init_stream_recv_window.rmempty = true;
    hysteria_quic_init_stream_recv_window.modalonly = true;

    let hysteria_quic_max_stream_recv_window = sub_section.taboption(tab_name, form.Value, "hysteria_quic_max_stream_recv_window", _("[hysteria] QUIC Max Stream Recv Window"));
    hysteria_quic_max_stream_recv_window.depends("transport", "hysteria");
    hysteria_quic_max_stream_recv_window.placeholder = "8388608";
    hysteria_quic_max_stream_recv_window.datatype = "uinteger";
    hysteria_quic_max_stream_recv_window.rmempty = true;
    hysteria_quic_max_stream_recv_window.modalonly = true;

    let hysteria_quic_init_conn_recv_window = sub_section.taboption(tab_name, form.Value, "hysteria_quic_init_conn_recv_window", _("[hysteria] QUIC Init Conn Recv Window"));
    hysteria_quic_init_conn_recv_window.depends("transport", "hysteria");
    hysteria_quic_init_conn_recv_window.placeholder = "20971520";
    hysteria_quic_init_conn_recv_window.datatype = "uinteger";
    hysteria_quic_init_conn_recv_window.rmempty = true;
    hysteria_quic_init_conn_recv_window.modalonly = true;

    let hysteria_quic_max_conn_recv_window = sub_section.taboption(tab_name, form.Value, "hysteria_quic_max_conn_recv_window", _("[hysteria] QUIC Max Conn Recv Window"));
    hysteria_quic_max_conn_recv_window.depends("transport", "hysteria");
    hysteria_quic_max_conn_recv_window.placeholder = "20971520";
    hysteria_quic_max_conn_recv_window.datatype = "uinteger";
    hysteria_quic_max_conn_recv_window.rmempty = true;
    hysteria_quic_max_conn_recv_window.modalonly = true;

    let hysteria_quic_disable_mtu_discovery = sub_section.taboption(tab_name, form.Flag, "hysteria_quic_disable_mtu_discovery", _("[hysteria] Disable Path MTU Discovery"));
    hysteria_quic_disable_mtu_discovery.depends("transport", "hysteria");
    hysteria_quic_disable_mtu_discovery.rmempty = true;
    hysteria_quic_disable_mtu_discovery.modalonly = true;

    let hysteria_quic_debug = sub_section.taboption(tab_name, form.Flag, "hysteria_quic_debug", _("[hysteria] QUIC Debug"));
    hysteria_quic_debug.depends("transport", "hysteria");
    hysteria_quic_debug.rmempty = true;
    hysteria_quic_debug.modalonly = true;
}

return baseclass.extend({
    init: function (transport, sub_section, tab_name) {
        transport_tcp(transport, sub_section, tab_name);
        transport_mkcp(transport, sub_section, tab_name);
        transport_ws(transport, sub_section, tab_name);
        transport_h2(transport, sub_section, tab_name);
        transport_quic(transport, sub_section, tab_name);
        transport_grpc(transport, sub_section, tab_name);
        transport_xhttp(transport, sub_section, tab_name);
        transport_httpupgrade(transport, sub_section, tab_name);
        transport_hysteria(transport, sub_section, tab_name);
    }
});
