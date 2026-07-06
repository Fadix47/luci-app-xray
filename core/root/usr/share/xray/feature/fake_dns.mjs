"use strict";

import { balancer } from "./system.mjs";

// FakeDNS pipeline: dnsmasq→fake IP→FakeDNS inbound recovers domain→route by class.

export function fake_dns_domains(fakedns, forwarded_extra, bypassed_extra) {
    let domains = [];
    for (let f in fakedns) {
        push(domains, ...f["fake_dns_domain_names"]);
    }
    if (forwarded_extra) push(domains, ...forwarded_extra);
    if (bypassed_extra)  push(domains, ...bypassed_extra);
    if (length(domains) === 0) {
        return [];
    }
    return [
        {
            "address": "fakedns",
            "domains": uniq(domains),
            "skipFallback": true
        }
    ];
};

export function fake_dns_rules(fakedns, forwarded_extra, bypassed_extra) {
    let result = [];
    for (let f in fakedns) {
        push(result, {
            type: "field",
            inboundTag: ["tproxy_tcp_inbound_f4", "tproxy_tcp_inbound_f6"],
            domain: f["fake_dns_domain_names"],
            balancerTag: `fake_dns_balancer:${f[".name"]}@tcp_balancer`
        }, {
            type: "field",
            inboundTag: ["tproxy_udp_inbound_f4", "tproxy_udp_inbound_f6"],
            domain: f["fake_dns_domain_names"],
            balancerTag: `fake_dns_balancer:${f[".name"]}@udp_balancer`
        });
    }
    // bypassed → forwarded ordering: domains on both lists win as "direct".
    if (bypassed_extra && length(bypassed_extra) > 0) {
        push(result, {
            type: "field",
            inboundTag: ["tproxy_tcp_inbound_f4", "tproxy_tcp_inbound_f6",
                         "tproxy_udp_inbound_f4", "tproxy_udp_inbound_f6"],
            domain: bypassed_extra,
            outboundTag: "direct"
        });
    }
    if (forwarded_extra && length(forwarded_extra) > 0) {
        push(result, {
            type: "field",
            inboundTag: ["tproxy_tcp_inbound_f4", "tproxy_tcp_inbound_f6"],
            domain: forwarded_extra,
            balancerTag: "tcp_outbound_v4"
        }, {
            type: "field",
            inboundTag: ["tproxy_udp_inbound_f4", "tproxy_udp_inbound_f6"],
            domain: forwarded_extra,
            balancerTag: "udp_outbound_v4"
        });
    }
    return result;
};

export function fake_dns_balancers(fakedns) {
    let result = [];
    for (let f in fakedns) {
        push(result, {
            "tag": `fake_dns_balancer:${f[".name"]}@tcp_balancer`,
            "selector": balancer(f, "fake_dns_forward_server_tcp", `fake_dns_tcp:${f[".name"]}`),
            "strategy": {
                "type": f["fake_dns_balancer_strategy"] || "random"
            }
        }, {
            "tag": `fake_dns_balancer:${f[".name"]}@udp_balancer`,
            "selector": balancer(f, "fake_dns_forward_server_udp", `fake_dns_udp:${f[".name"]}`),
            "strategy": {
                "type": f["fake_dns_balancer_strategy"] || "random"
            }
        });
    }
    return result;
};

export function fake_dns_conf(proxy) {
    return [
        {
            "ipPool": proxy.pool_v4 || "198.18.0.0/15",
            "poolSize": int(proxy.pool_v4_size) || 65535
        },
        {
            "ipPool": proxy.pool_v6 || "2001:2::/48",
            "poolSize": int(proxy.pool_v6_size) || 65535
        }
    ];
};
