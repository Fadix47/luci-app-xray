"use strict";

import { access } from "fs";
import { fake_dns_domains } from "./fake_dns.mjs";
import { direct_outbound } from "./outbound.mjs";

const fallback_fast_dns = "8.8.8.8:53";
const fallback_secure_dns = "8.8.8.8:53";
const fallback_default_dns = "1.1.1.1:53";
const geoip_existence = access("/usr/share/xray/geoip.dat") || false;
const geosite_existence = access("/usr/share/xray/geosite.dat") || false;

function parse_ip_port(val, port_default) {
    const split_dot = split(val, ".");
    if (length(split_dot) > 1) {
        const split_ipv4 = split(val, ":");
        // Bare IPv4 like `8.8.8.8` has no port — fall back explicitly to avoid `port: 0`.
        const port = length(split_ipv4) > 1 ? int(split_ipv4[1]) : port_default;
        return {
            ip: split_ipv4[0],
            port: port || port_default
        };
    }
    const split_ipv6_port = split(val, "]:");
    if (length(split_ipv6_port) == 2) {
        return {
            ip: ltrim(split_ipv6_port[0], "["),
            port: int(split_ipv6_port[1]) || port_default,
        };
    }
    return {
        ip: val,
        port: port_default
    };
}

function default_port_for(method) {
    if (method === "https" || method === "https+local") return 443;
    if (method === "tls" || method === "tls+local") return 853;
    return 53;
}

function format_dns(method, val) {
    const parsed = parse_ip_port(val, default_port_for(method));
    if (method === "udp") {
        return {
            address: parsed["ip"],
            port: parsed["port"]
        };
    }
    let url_suffix = "";
    if (substr(method, 0, 5) === "https") {
        url_suffix = "/dns-query";
    }
    // Rebuild host:port for DoH/DoT default ports (443/853); wrap IPv6 with [].
    const host = (index(parsed["ip"], ":") !== -1) ? `[${parsed["ip"]}]` : parsed["ip"];
    return {
        address: `${method}://${host}:${parsed["port"]}${url_suffix}`
    };
}

function domain_rules(proxy, k) {
    if (proxy[k] === null) {
        return [];
    }
    // `geo_disabled=1` strips geosite: entries even if the .dat is on disk.
    const geo_off = (proxy["geo_disabled"] === "1");
    return filter(proxy[k], function (x) {
        if (substr(x, 0, 8) === "geosite:") {
            return geosite_existence && !geo_off;
        }
        return true;
    });
}

export function secure_domain_rules(proxy) {
    return domain_rules(proxy, "forwarded_domain_rules");
};

export function fast_domain_rules(proxy) {
    return domain_rules(proxy, "bypassed_domain_rules");
};

export function dns_server_inbounds(proxy) {
    let result = [];
    const dns_port = int(proxy["dns_port"] || 5300);
    const dns_count = int(proxy["dns_count"] || 3);
    const default_dns = format_dns("udp", proxy["default_dns"] || fallback_default_dns);
    for (let i = dns_port; i <= dns_port + dns_count; i++) {
        push(result, {
            port: i,
            protocol: "dokodemo-door",
            tag: sprintf("dns_server_inbound:%d", i),
            settings: {
                address: default_dns["address"],
                port: default_dns["port"],
                network: "tcp,udp"
            }
        });
    }
    return result;
};

export function dns_rules(proxy, tcp_hijack_inbound_tags, udp_hijack_inbound_tags) {
    const dns_port = int(proxy["dns_port"] || 5300);
    const dns_count = int(proxy["dns_count"] || 3);
    const fast_dns = parse_ip_port(proxy["fast_dns"] || fallback_fast_dns, 53);
    const secure_dns = parse_ip_port(proxy["secure_dns"] || fallback_secure_dns, 53);
    let dns_server_tags = [];
    for (let i = dns_port; i <= dns_port + dns_count; i++) {
        push(dns_server_tags, sprintf("dns_server_inbound:%d", i));
    }
    let result = [
        {
            type: "field",
            inboundTag: ["dns_conf_inbound"],
            ip: [fast_dns["ip"]],
            port: `${fast_dns["port"]}`,
            outboundTag: "dynamic_direct"
        },
        {
            type: "field",
            inboundTag: ["dns_conf_inbound"],
            ip: [secure_dns["ip"]],
            port: `${secure_dns["port"]}`,
            balancerTag: "udp_outbound_v4"
        },
        {
            type: "field",
            inboundTag: dns_server_tags,
            outboundTag: "dns_server_outbound"
        },
        // xray-internal DNS queries → direct; otherwise hostname servers black-hole.
        {
            type: "field",
            inboundTag: ["xray_internal_dns"],
            outboundTag: "direct"
        },
    ];
    if (proxy.dns_tcp_hijack) {
        push(result, {
            type: "field",
            port: "53",
            inboundTag: tcp_hijack_inbound_tags,
            outboundTag: "dns_tcp_hijack_outbound"
        });
    }
    if (proxy.dns_udp_hijack) {
        push(result, {
            type: "field",
            port: "53",
            inboundTag: udp_hijack_inbound_tags,
            outboundTag: "dns_udp_hijack_outbound"
        });
    }
    return result;
};

export function dns_server_outbounds(proxy) {
    // nonIPQuery/blockTypes deprecated upstream — handled via dns_rules now.
    let result = [
        {
            protocol: "dns",
            streamSettings: {
                sockopt: {
                    mark: 254
                }
            },
            tag: "dns_server_outbound"
        }
    ];
    if (proxy.dns_tcp_hijack) {
        push(result, direct_outbound("dns_tcp_hijack_outbound", proxy.dns_tcp_hijack, false));
    }
    if (proxy.dns_udp_hijack) {
        push(result, direct_outbound("dns_udp_hijack_outbound", proxy.dns_udp_hijack, false));
    }
    return result;
};

export function dns_conf(proxy, config, manual_tproxy, fakedns) {
    const fast_dns_method = proxy["fast_dns_method"] || "udp";
    const default_dns_method = proxy["default_dns_method"] || "udp";
    const fast_dns_object = format_dns(fast_dns_method, proxy["fast_dns"] || fallback_fast_dns);
    const default_dns_object = format_dns(default_dns_method, proxy["default_dns"] || fallback_default_dns);

    let domain_names_set = {};
    let domain_extra_options = {};

    for (let server in filter(values(config), i => i[".type"] === "servers")) {
        if (iptoarr(server["server"])) {
            continue;
        }
        if (server["domain_resolve_dns"]) {
            domain_extra_options[server["server"]] = `${server["domain_resolve_dns_method"] || "udp"};${server["domain_resolve_dns"]};${join(",", server["domain_resolve_expect_ips"] || [])}`;
        } else {
            domain_names_set[`domain:${server["server"]}`] = true;
        }
    }

    let resolve_merged = {};
    for (let k in keys(domain_extra_options)) {
        const v = domain_extra_options[k];
        let original = resolve_merged[v] || [];
        push(original, `domain:${k}`);
        resolve_merged[v] = original;
    }

    // Tag every server so dns_rules() can route xray's own DNS queries to `direct`;
    // untagged entries hit blackhole and any hostname-addressed server fails to resolve.
    const tag_internal_dns = "xray_internal_dns";
    let servers = [
        // Forward/bypass domains piggy-back on the FakeDNS pool for per-class dispatch.
        ...fake_dns_domains(fakedns,
                            secure_domain_rules(proxy),
                            fast_domain_rules(proxy)),
        ...map(keys(resolve_merged), function (k) {
            const dns_split = split(k, ";");
            const resolve_dns_object = format_dns(dns_split[0], dns_split[1]);
            let result = {
                address: resolve_dns_object["address"],
                port: resolve_dns_object["port"],
                domains: uniq(resolve_merged[k]),
                skipFallback: true,
                tag: tag_internal_dns,
            };
            if (length(dns_split[2]) > 0) {
                const expect_ips = filter(split(dns_split[2], ",") || [], function (i) {
                    if (!geoip_existence) {
                        if (substr(i, 0, 6) === "geoip:") {
                            return false;
                        }
                    }
                    return true;
                });
                result["expectIPs"] = expect_ips;
            }
            return result;
        }),
        {
            ...default_dns_object,
            tag: tag_internal_dns,
        },
        {
            // expectIPs (geoip_direct) removed — IP filter was a poor proxy for country
            // given CDN churn.
            address: fast_dns_object["address"],
            port: fast_dns_object["port"],
            domains: [...keys(domain_names_set), ...fast_domain_rules(proxy)],
            skipFallback: true,
            tag: tag_internal_dns,
        },
    ];

    if (length(secure_domain_rules(proxy)) > 0) {
        const secure_dns_method = proxy["secure_dns_method"] || "udp";
        const secure_dns_object = format_dns(secure_dns_method, proxy["secure_dns"] || fallback_secure_dns);
        push(servers, {
            address: secure_dns_object["address"],
            port: secure_dns_object["port"],
            domains: secure_domain_rules(proxy),
            tag: tag_internal_dns,
        });
    }

    let hosts = {};

    for (let v in manual_tproxy) {
        if (v.domain_names != null) {
            for (let d in v.domain_names) {
                if (index(v.source_addr, ":") === -1) {
                    hosts[d] = [v.source_addr];
                }
            }
        }
    }

    return {
        hosts: hosts,
        servers: servers,
        tag: "dns_conf_inbound",
        queryStrategy: "UseIP"
    };
};

export function dns_direct_servers(config) {
    let result = [];
    // Find the general section to read the main DNS settings.
    const general = filter(values(config), v => v[".type"] === "general")[0] || {};

    // Bypass fast/secure/default DNS so xray queries escape tproxy; pick per-protocol default port.
    const dns_entries = [
        [general["fast_dns"] || "8.8.8.8:53",     general["fast_dns_method"] || "udp"],
        [general["secure_dns"] || "8.8.8.8:53",   general["secure_dns_method"] || "udp"],
        [general["default_dns"] || "1.1.1.1:53",  general["default_dns_method"] || "udp"],
    ];
    for (let e in dns_entries) {
        const port_default = default_port_for(e[1]);
        const p = parse_ip_port(e[0], port_default);
        // parse_ip_port returns 0 for input without :port — fall back to protocol default.
        if (!p.port) p.port = port_default;
        push(result, p);
    }

    for (let server in filter(values(config), i => i[".type"] === "servers")) {
        if (iptoarr(server["server"])) {
            continue;
        }
        if (server["domain_resolve_dns"]) {
            if (index(server["domain_resolve_dns_method"], "local") > 1) {
                push(result, parse_ip_port(server["domain_resolve_dns"]));
            }
        }
    }
    return result;
};
