#!/usr/bin/ucode
"use strict";

import { cursor } from "uci";
import { server_outbound } from "../feature/outbound.mjs";

const sid = getenv("AWG_PROXY_SID");
const port = int(getenv("AWG_PROXY_PORT") || "19080");
if (!sid) die("AWG_PROXY_SID not set");

const uci = cursor();
uci.load("xray_core");
const server = uci.get_all("xray_core")[sid];
if (!server) die(`unknown server section ${sid}`);

printf("%.4J", {
    log: { loglevel: "error" },
    inbounds: [{
        listen: "127.0.0.1",
        port: port,
        protocol: "socks",
        settings: { udp: false },
        tag: "awg_reg_socks"
    }],
    outbounds: server_outbound(server, "awg_reg_proxy")
});
