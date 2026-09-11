"use strict";

import { cursor } from "uci";
import { readfile } from "fs";

const CACHE_DIR = "/usr/share/xray/public_lists";

// Read a one-entry-per-line cache file and return its non-empty trimmed lines.
function read_lines(path) {
    const raw = readfile(path);
    if (!raw) return [];
    let out = [];
    for (let line in split(raw, "\n")) {
        let t = trim(line);
        if (length(t) > 0) push(out, t);
    }
    return out;
}

function resolve_public_lists(selected) {
    let domains = [];
    let subnets = [];
    for (let id in (selected || [])) {
        // Defensive sanitisation — ids are URL path components in the
        // fetcher, never trust UCI values to be alnum.
        if (!match(id, /^[A-Za-z0-9._-]+$/)) continue;
        push(domains, ...read_lines(`${CACHE_DIR}/${id}.domains`));
        push(subnets, ...read_lines(`${CACHE_DIR}/${id}.subnets`));
    }
    return { domains: domains, subnets: subnets };
}

function enrich_simple(general) {
    const resolved = resolve_public_lists(general["community_lists"]);
    if (length(resolved.domains) > 0) {
        general["forwarded_domain_rules"] = uniq([
            ...(general["forwarded_domain_rules"] || []),
            ...resolved.domains,
        ]);
    }
    if (length(resolved.subnets) > 0) {
        general["wan_fw_ips"] = uniq([
            ...(general["wan_fw_ips"] || []),
            ...resolved.subnets,
        ]);
    }
}

function enrich_advanced(config, general) {
    let fw_domains = [];
    let fw_subnets = [];
    let bp_domains = [];
    let bp_subnets = [];

    for (let key in keys(config)) {
        const block = config[key];
        if (block[".type"] != "routing_rule") continue;
        if (block["enabled"] == "0") continue;

        const resolved = resolve_public_lists(block["public_lists"]);
        const domains = uniq([...(block["domains"] || []), ...resolved.domains]);
        const ips     = uniq([...(block["ips"] || []),     ...resolved.subnets]);

        block["domains"] = domains;
        block["ips"] = ips;

        if (block["outbound_kind"] == "direct") {
            push(bp_domains, ...domains);
            push(bp_subnets, ...ips);
        } else {
            push(fw_domains, ...domains);
            push(fw_subnets, ...ips);
        }
    }

    general["forwarded_domain_rules"] = uniq(fw_domains);
    general["wan_fw_ips"] = uniq(fw_subnets);
    general["bypassed_domain_rules"] = uniq(bp_domains);
    general["wan_bp_ips"] = uniq(bp_subnets);
}

function enrich_public_lists(config) {
    const general_key = filter(keys(config), k => config[k][".type"] == "general")[0];
    if (!general_key) return config;
    const general = config[general_key];

    if (general["routing_mode"] == "advanced") {
        enrich_advanced(config, general);
    } else {
        enrich_simple(general);
    }
    return config;
}

export function load_config() {
    const uci = cursor();
    uci.load("xray_core");
    return enrich_public_lists(uci.get_all("xray_core") || {});
};
