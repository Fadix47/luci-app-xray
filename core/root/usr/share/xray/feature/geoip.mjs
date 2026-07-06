"use strict";

import { readfile, writefile, stat, mkdir } from "fs";

// Expand geoip.dat protobuf codes → literal CIDRs for nftables. Cached at
// /tmp/xray_geoip_cache.json keyed on mtime+size to fit router RAM.

const GEOIP_DAT = "/usr/share/xray/geoip.dat";
const CACHE_FILE = "/tmp/xray_geoip_cache.json";

let _shared_buf = null;
let _shared_stamp = null;

function geoip_stamp() {
    const s = stat(GEOIP_DAT);
    if (!s) return null;
    return sprintf("%d:%d", s.mtime, s.size);
}

function load_buf(stamp) {
    if (_shared_buf != null && _shared_stamp === stamp) return _shared_buf;
    _shared_buf = readfile(GEOIP_DAT);
    _shared_stamp = stamp;
    return _shared_buf;
}

function load_cache(stamp) {
    const raw = readfile(CACHE_FILE);
    if (!raw) return { stamp: stamp, codes: {} };
    let parsed;
    try { parsed = json(raw); } catch (e) { parsed = null; }
    if (type(parsed) != "object" || parsed.stamp !== stamp || type(parsed.codes) != "object") {
        // stamp mismatch — geoip.dat changed, drop the whole cache.
        return { stamp: stamp, codes: {} };
    }
    return parsed;
}

function save_cache(cache) {
    // Best-effort: failure to write the cache just means the next call
    // re-parses. Don't fail the firewall reload over it.
    try { writefile(CACHE_FILE, sprintf("%J", cache)); } catch (e) { }
}

function read_varint(buf, pos) {
    let result = 0;
    let shift = 0;
    while (pos < length(buf)) {
        const byte = ord(buf, pos);
        pos++;
        result = result | ((byte & 0x7F) << shift);
        if ((byte & 0x80) == 0) {
            return [result, pos];
        }
        shift += 7;
    }
    return [result, pos];
}

function ipv4_to_str(bytes) {
    return sprintf("%d.%d.%d.%d",
        ord(bytes, 0), ord(bytes, 1), ord(bytes, 2), ord(bytes, 3));
}

function ipv6_to_str(bytes) {
    // Expanded IPv6 form — nft accepts it and it avoids zero-run compression bugs.
    let parts = [];
    for (let i = 0; i < 16; i += 2) {
        push(parts, sprintf("%x", (ord(bytes, i) << 8) | ord(bytes, i + 1)));
    }
    return join(":", parts);
}

function decode_cidr(msg) {
    let pos = 0;
    let ip = "";
    let prefix = 0;
    while (pos < length(msg)) {
        const t = read_varint(msg, pos);
        pos = t[1];
        const field = t[0] >> 3;
        const wire = t[0] & 0x7;
        if (field == 1 && wire == 2) {
            const lenv = read_varint(msg, pos);
            pos = lenv[1];
            ip = substr(msg, pos, lenv[0]);
            pos += lenv[0];
        } else if (field == 2 && wire == 0) {
            const v = read_varint(msg, pos);
            prefix = v[0];
            pos = v[1];
        } else {
            break;
        }
    }
    return { ip: ip, prefix: prefix };
}

function decode_geoip_entry(msg) {
    let pos = 0;
    let code = "";
    let cidrs = [];
    while (pos < length(msg)) {
        const t = read_varint(msg, pos);
        pos = t[1];
        const field = t[0] >> 3;
        const wire = t[0] & 0x7;
        if (field == 1 && wire == 2) {
            const lenv = read_varint(msg, pos);
            pos = lenv[1];
            code = substr(msg, pos, lenv[0]);
            pos += lenv[0];
        } else if (field == 2 && wire == 2) {
            const lenv = read_varint(msg, pos);
            pos = lenv[1];
            push(cidrs, decode_cidr(substr(msg, pos, lenv[0])));
            pos += lenv[0];
        } else if (field == 3 && wire == 0) {
            // reverse_match not supported (would emit millions of CIDRs) — skip.
            const v = read_varint(msg, pos);
            pos = v[1];
        } else {
            break;
        }
    }
    return { country_code: lc(code), cidrs: cidrs };
}

// Parse geoip.dat for `want_codes` only, filling `cache.codes` in place.
function parse_into_cache(buf, want_codes, cache) {
    let pending = {};
    let pending_count = 0;
    for (let c in want_codes) {
        pending[c] = true;
        pending_count++;
    }
    let pos = 0;
    while (pos < length(buf) && pending_count > 0) {
        const t = read_varint(buf, pos);
        pos = t[1];
        const field = t[0] >> 3;
        const wire = t[0] & 0x7;
        if (field != 1 || wire != 2) break;
        const lenv = read_varint(buf, pos);
        pos = lenv[1];
        const entry = decode_geoip_entry(substr(buf, pos, lenv[0]));
        pos += lenv[0];
        if (!pending[entry.country_code]) continue;
        let v4 = [];
        let v6 = [];
        for (let cidr in entry.cidrs) {
            if (length(cidr.ip) == 4) {
                push(v4, sprintf("%s/%d", ipv4_to_str(cidr.ip), cidr.prefix));
            } else if (length(cidr.ip) == 16) {
                push(v6, sprintf("%s/%d", ipv6_to_str(cidr.ip), cidr.prefix));
            }
        }
        cache.codes[entry.country_code] = { v4: v4, v6: v6 };
        delete pending[entry.country_code];
        pending_count--;
    }
    // Codes missing from the .dat — cache empty to skip re-parsing next time.
    for (let c in keys(pending)) {
        cache.codes[c] = { v4: [], v6: [] };
    }
}

// Expand `geoip:CC` entries to CIDRs; non-geoip entries go to `passthrough`.
// `disabled=true` drops all geoip: entries (honors the user toggle). Returns {v4, v6, passthrough}.
export function expand_geoip_codes(entries, disabled) {
    let want = {};
    let passthrough = [];
    for (let e in (entries || [])) {
        if (substr(e, 0, 6) != "geoip:") {
            push(passthrough, e);
            continue;
        }
        if (disabled) continue;
        // `!CC` reverse match isn't materialisable as an nft set — warn and skip.
        let code = lc(substr(e, 6));
        if (substr(code, 0, 1) == "!") {
            warn(sprintf("xray-geoip: '!' reverse match (%s) is not supported in nftables sets — entry ignored\n", e));
            continue;
        }
        if (code != "") want[code] = true;
    }
    if (length(keys(want)) == 0) {
        return { v4: [], v6: [], passthrough: passthrough };
    }

    const stamp = geoip_stamp();
    if (!stamp) {
        warn(sprintf("xray-geoip: %s missing — geoip:* entries ignored\n", GEOIP_DAT));
        return { v4: [], v6: [], passthrough: passthrough };
    }

    let cache = load_cache(stamp);

    // Which requested codes need a parse?
    let missing = {};
    let any_missing = false;
    for (let c in keys(want)) {
        if (!exists(cache.codes, c)) {
            missing[c] = true;
            any_missing = true;
        }
    }

    if (any_missing) {
        const buf = load_buf(stamp);
        if (!buf || length(buf) == 0) {
            warn(sprintf("xray-geoip: %s unreadable — geoip:* entries ignored\n", GEOIP_DAT));
            return { v4: [], v6: [], passthrough: passthrough };
        }
        parse_into_cache(buf, missing, cache);
        save_cache(cache);
    }

    let v4 = [];
    let v6 = [];
    for (let c in keys(want)) {
        const e = cache.codes[c];
        if (e == null) continue;
        push(v4, ...(e.v4 || []));
        push(v6, ...(e.v6 || []));
    }
    return { v4: v4, v6: v6, passthrough: passthrough };
};

// Re-parse cached codes against current geoip.dat — called post-update
// to keep the cron-time firewall reload light. Reads cache directly to bypass stamp check.
export function refresh_cache() {
    const stamp = geoip_stamp();
    if (!stamp) return false;
    const raw = readfile(CACHE_FILE);
    if (!raw) return true;
    let old;
    try { old = json(raw); } catch (e) { return true; }
    if (type(old) != "object" || type(old.codes) != "object") return true;
    const old_codes = keys(old.codes);
    if (length(old_codes) == 0) return true;
    let cache = { stamp: stamp, codes: {} };
    let want = {};
    for (let c in old_codes) want[c] = true;
    const buf = load_buf(stamp);
    if (!buf || length(buf) == 0) return false;
    parse_into_cache(buf, want, cache);
    save_cache(cache);
    return true;
};
