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

// Merge cached public_lists (community_lists selection) into forwarded_domain_rules
// and wan_fw_ips so downstream consumers see one flat lookup. Merge is daemon-side only.
function enrich_public_lists(config) {
    const general_key = filter(keys(config), k => config[k][".type"] == "general")[0];
    if (!general_key) return config;
    const general = config[general_key];

    let selected = general["community_lists"] || [];
    if (!length(selected)) return config;

    let extra_domains = [];
    let extra_subnets = [];

    for (let id in selected) {
        // Defensive sanitisation — ids are URL path components in the
        // fetcher, never trust UCI values to be alnum.
        if (!match(id, /^[A-Za-z0-9._-]+$/)) continue;
        push(extra_domains, ...read_lines(`${CACHE_DIR}/${id}.domains`));
        push(extra_subnets, ...read_lines(`${CACHE_DIR}/${id}.subnets`));
    }

    if (length(extra_domains) > 0) {
        general["forwarded_domain_rules"] = uniq([
            ...(general["forwarded_domain_rules"] || []),
            ...extra_domains,
        ]);
    }
    if (length(extra_subnets) > 0) {
        general["wan_fw_ips"] = uniq([
            ...(general["wan_fw_ips"] || []),
            ...extra_subnets,
        ]);
    }

    return config;
}

export function load_config() {
    const uci = cursor();
    uci.load("xray_core");
    return enrich_public_lists(uci.get_all("xray_core") || {});
};
