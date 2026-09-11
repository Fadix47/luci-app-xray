#!/bin/sh
# AmneziaWG / Cloudflare WARP helpers for Advanced Routing.
# Routing: Xray AWG outbounds carry SO_MARK=166 -> table 166 -> dev awg0.

IFACE="awg0"
MARK=166
MARK_HEX="a6"
TABLE=166
PREF=9000
CFG_DIR="/etc/amnezia/amneziawg"
CONF="${CFG_DIR}/${IFACE}.conf"
API="https://api.cloudflareclient.com/v0a2158/reg"
PROXY_PORT="19080"
PROXY_CONF="/tmp/awg_reg_proxy.json"

log() { logger -t xray-awg -- "$1"; echo "$1" >&2; }
fail() { log "ERROR: $1"; exit 1; }

xray_bin() {
    local bin
    bin=$(uci -q get xray_core.@general[0].xray_bin)
    [ -z "${bin}" ] && bin=/usr/bin/xray
    echo "${bin}"
}

rnd() { awk -v lo="$1" -v hi="$2" 'BEGIN{srand();printf "%d", lo+int(rand()*(hi-lo+1))}'; }

AWG_OBF_JC=120
AWG_OBF_JMIN=23
AWG_OBF_JMAX=911
AWG_OBF_S1=0
AWG_OBF_S2=0
AWG_OBF_H1=1
AWG_OBF_H2=2
AWG_OBF_H3=3
AWG_OBF_H4=4
AWG_MTU=1280
AWG_DNS="1.1.1.1, 2606:4700:4700::1111, 1.0.0.1, 2606:4700:4700::1001"
AWG_ENDPOINT="162.159.192.1:500"
AWG_PKG_REPO="https://github.com/Slava-Shchipunov/awg-openwrt"
AWG_I1="<b 0xc2000000011419fa4bb3599f336777de79f81ca9a8d80d91eeec000044c635cef024a885dcb66d1420a91a8c427e87d6cf8e08b563932f449412cddf77d3e2594ea1c7a183c238a89e9adb7ffa57c133e55c59bec101634db90afb83f75b19fe703179e26a31902324c73f82d9354e1ed8da39af610afcb27e6590a44341a0828e5a3d2f0e0f7b0945d7bf3402feea0ee6332e19bdf48ffc387a97227aa97b205a485d282cd66d1c384bafd63dc42f822c4df2109db5b5646c458236ddcc01ae1c493482128bc0830c9e1233f0027a0d262f92b49d9d8abd9a9e0341f6e1214761043c021d7aa8c464b9d865f5fbe234e49626e00712031703a3e23ef82975f014ee1e1dc428521dc23ce7c6c13663b19906240b3efe403cf30559d798871557e4e60e86c29ea4504ed4d9bb8b549d0e8acd6c334c39bb8fb42ede68fb2aadf00cfc8bcc12df03602bbd4fe701d64a39f7ced112951a83b1dbbe6cd696dd3f15985c1b9fef72fa8d0319708b633cc4681910843ce753fac596ed9945d8b839aeff8d3bf0449197bd0bb22ab8efd5d63eb4a95db8d3ffc796ed5bcf2f4a136a8a36c7a0c65270d511aebac733e61d414050088a1c3d868fb52bc7e57d3d9fd132d78b740a6ecdc6c24936e92c28672dbe00928d89b891865f885aeb4c4996d50c2bbbb7a99ab5de02ac89b3308e57bcecf13f2da0333d1420e18b66b4c23d625d836b538fc0c221d6bd7f566a31fa292b85be96041d8e0bfe655d5dc1afed23eb8f2b3446561bbee7644325cc98d31cea38b865bdcc507e48c6ebdc7553be7bd6ab963d5a14615c4b81da7081c127c791224853e2d19bafdc0d9f3f3a6de898d14abb0e2bc849917e0a599ed4a541268ad0e60ea4d147dc33d17fa82f22aa505ccb53803a31d10a7ca2fea0b290a52ee92c7bf4aab7cea4e3c07b1989364eed87a3c6ba65188cd349d37ce4eefde9ec43bab4b4dc79e03469c2ad6b902e28e0bbbbf696781ad4edf424ffb35ce0236d373629008f142d04b5e08a124237e03e3149f4cdde92d7fae581a1ac332e26b2c9c1a6bdec5b3a9c7a2a870f7a0c25fc6ce245e029b686e346c6d862ad8df6d9b62474fbc31dbb914711f78074d4441f4e6e9edca3c52315a5c0653856e23f681558d669f4a4e6915bcf42b56ce36cb7dd3983b0b1d6fdf0f8efddb68e7ca0ae9dd4570fe6978fbb524109f6ec957ca61f1767ef74eb803b0f16abd0087cf2d01bc1db1c01d97ac81b3196c934586963fe7cf2d310e0739621e8bd00dc23fded18576d8c8f285d7bb5f43b547af3c76235de8b6f757f817683b2151600b11721219212bf27558edd439e73fce951f61d582320e5f4d6c315c71129b719277fc144bbe8ded25ab6d29b6e189c9bd9b16538faf60cc2aab3c3bb81fc2213657f2dd0ceb9b3b871e1423d8d3e8cc008721ef03b28e0ee7bb66b8f2a2ac01ef88df1f21ed49bf1ce435df31ac34485936172567488812429c269b49ee9e3d99652b51a7a614b7c460bf0d2d64d8349ded7345bedab1ea0a766a8470b1242f38d09f7855a32db39516c2bd4bcc538c52fa3a90c8714d4b006a15d9c7a7d04919a1cab48da7cce0d5de1f9e5f8936cffe469132991c6eb84c5191d1bcf69f70c58d9a7b66846440a9f0eef25ee6ab62715b50ca7bef0bc3013d4b62e1639b5028bdf757454356e9326a4c76dabfb497d451a3a1d2dbd46ec283d255799f72dfe878ae25892e25a2542d3ca9018394d8ca35b53ccd94947a8>"

# ---- JSON helpers -------------------------------------------
read_field() {
    jsonfilter -i "$1" -e "@.${2}" 2>/dev/null
}

json_kv() {
    AWG_JSON="$1" ucode -e '
        import { readfile } from "fs";
        let d = json(readfile(getenv("AWG_JSON")));
        for (let k in keys(d)) {
            let v = d[k];
            if (v == null) continue;
            print(k + "=" + (type(v) == "object" || type(v) == "array" ? json(v) : v) + "\n");
        }
    ' 2>/dev/null
}

# ---- UCI storage ---------------------------------------------------------
store_uci() {
    # $1..$N are KEY=VALUE pairs of awg section options
    uci -q get "xray_core.${IFACE}" >/dev/null || uci set "xray_core.${IFACE}=awg"
    uci set "xray_core.${IFACE}.iface=${IFACE}"
    local kv
    for kv in "$@"; do
        uci set "xray_core.${IFACE}.${kv%%=*}=${kv#*=}"
    done
    uci set "xray_core.${IFACE}.enabled=1"
    uci commit xray_core
}

render_conf() {
    priv=$(uci -q get "xray_core.${IFACE}.private_key")
    priv=$(uci -q get "xray_core.${IFACE}.private_key")
    v4=$(uci -q get "xray_core.${IFACE}.address_v4")
    v6=$(uci -q get "xray_core.${IFACE}.address_v6")
    pub=$(uci -q get "xray_core.${IFACE}.peer_public_key")
    ep=$(uci -q get "xray_core.${IFACE}.endpoint")
    jc=$(uci -q get "xray_core.${IFACE}.jc")
    jmin=$(uci -q get "xray_core.${IFACE}.jmin")
    jmax=$(uci -q get "xray_core.${IFACE}.jmax")
    s1=$(uci -q get "xray_core.${IFACE}.s1")
    s2=$(uci -q get "xray_core.${IFACE}.s2")
    h1=$(uci -q get "xray_core.${IFACE}.h1")
    h2=$(uci -q get "xray_core.${IFACE}.h2")
    h3=$(uci -q get "xray_core.${IFACE}.h3")
    h4=$(uci -q get "xray_core.${IFACE}.h4")
    i1=$(uci -q get "xray_core.${IFACE}.i1")
    mtu=$(uci -q get "xray_core.${IFACE}.mtu")
    [ -z "${i1}" ] && i1="${AWG_I1}"
    [ -z "${mtu}" ] && mtu="${AWG_MTU}"
    [ -n "${priv}" ] && [ -n "${pub}" ] && [ -n "${ep}" ] || fail "awg section incomplete (need private_key, peer_public_key, endpoint)"

    addr=""
    case "${v4}" in
        */*) addr="${v4}" ;;
        *) [ -n "${v4}" ] && addr="${v4}/32" ;;
    esac
    case "${v6}" in
        */*) addr="${addr:+${addr}, }${v6}" ;;
        *) [ -n "${v6}" ] && addr="${addr:+${addr}, }${v6}/128" ;;
    esac

    mkdir -p "${CFG_DIR}"
    chmod 700 "${CFG_DIR}"
    cat > "${CONF}" <<EOF
[Interface]
PrivateKey = ${priv}
${addr:+Address = ${addr}}
Jc = ${jc:-4}
Jmin = ${jmin:-50}
Jmax = ${jmax:-1000}
S1 = ${s1:-88}
S2 = ${s2:-88}
H1 = ${h1:-1}
H2 = ${h2:-2}
H3 = ${h3:-3}
H4 = ${h4:-4}
I1 = ${i1}
MTU = ${mtu}
DNS = ${AWG_DNS}

[Peer]
PublicKey = ${pub}
Endpoint = ${ep}
AllowedIPs = 0.0.0.0/0, ::/0
EOF
    chmod 600 "${CONF}"
    grep -v -E '^(Address|DNS|Table|MTU) = ' "${CONF}" > "${CONF}.setconf"
}

awg_up() {
    command -v awg >/dev/null 2>&1 || fail "awg not found — install AmneziaWG tools (WARP panel or awg_warp.sh install)"
    [ -d /sys/module/amneziawg ] || modprobe amneziawg 2>/dev/null || \
        log "WARNING: amneziawg kernel module not loaded"
    render_conf
    # IPv6 is opt-in (awg0.use_ipv6='1').
    local use6=0
    [ "$(uci -q get "xray_core.${IFACE}.use_ipv6")" = "1" ] && use6=1
    AWG_USE6=${use6}
    if [ -x /lib/netifd/proto/amneziawg.sh ]; then
        netifd_register
    else
        if ! ip link show dev "${IFACE}" >/dev/null 2>&1; then
            ip link add "${IFACE}" type amneziawg || fail "ip link add ${IFACE} type amneziawg failed (kernel module present?)"
        fi
        awg setconf "${IFACE}" "${CONF}.setconf" || fail "awg setconf failed"
        [ -n "${v4}" ] && ip addr replace "${v4}/32" dev "${IFACE}" 2>/dev/null
        [ "${use6}" = 1 ] && [ -n "${v6}" ] && ip -6 addr replace "${v6}/128" dev "${IFACE}" 2>/dev/null
        ip link set dev "${IFACE}" mtu "${mtu}" up
    fi
    ip rule show | grep -q "fwmark 0x${MARK_HEX}" || \
        ip rule add pref "${PREF}" fwmark "${MARK}" table "${TABLE}"
    # Hold marked traffic until the tunnel actually handshakes: routing it into
    # a freshly created (not yet connected) awg0 races the WARP handshake.
    if awg_handshake_recent; then
        ip route replace default dev "${IFACE}" table "${TABLE}"
    else
        ip route replace unreachable default table "${TABLE}"
        awg_watch_start
        log "AWG handshake pending, holding table ${TABLE} unreachable (watcher armed)"
    fi
    if [ "${use6}" = 1 ]; then
        ip -6 rule show 2>/dev/null | grep -q "fwmark 0x${MARK_HEX}" || \
            ip -6 rule add pref "${PREF}" fwmark "${MARK}" table "${TABLE}" 2>/dev/null
        ip -6 route replace default dev "${IFACE}" table "${TABLE}" 2>/dev/null
    fi
    log "AmneziaWG ${IFACE} up (fwmark ${MARK} -> table ${TABLE}, ipv6 ${use6})"
}

# True when awg0 completed a handshake recently (age in seconds, 0..600 ok).
awg_handshake_recent() {
    local age
    age=$(awg show "${IFACE}" 2>/dev/null | awk '/latest handshake:/ {print $3}')
    [ -n "${age}" ] && [ "${age}" -ge 0 ] 2>/dev/null && [ "${age}" -le 600 ]
}

# Detached watcher: swaps the unreachable hold-route for the real one as soon as the tunnel handshakes.
awg_watch_start() {
    local old_pid
    if [ -s /tmp/awg_watch.pid ]; then
        old_pid=$(cat /tmp/awg_watch.pid)
        if [ -n "${old_pid}" ] && kill -0 "${old_pid}" 2>/dev/null; then
            return 0
        fi
    fi
    setsid /usr/share/xray/sub/awg_warp.sh watch >/dev/null 2>&1 &
    echo $! > /tmp/awg_watch.pid
}

awg_watch_stop() {
    if [ -s /tmp/awg_watch.pid ]; then
        kill "$(cat /tmp/awg_watch.pid)" 2>/dev/null
        rm -f /tmp/awg_watch.pid
    fi
}

awg_watch_run() {
    local i=0
    while [ ${i} -lt 3600 ]; do
        if awg_handshake_recent; then
            ip route replace default dev "${IFACE}" table "${TABLE}"
            log "AWG handshake completed, table ${TABLE} enabled"
            rm -f /tmp/awg_watch.pid
            return 0
        fi
        sleep 5
        i=$((i + 5))
    done
    log "WARNING: no AWG handshake within 1h, table ${TABLE} still unreachable"
    rm -f /tmp/awg_watch.pid
}

netifd_register() {
    if [ "$(uci -q get network.awg_warp.proto)" = "none" ]; then
        uci -q delete network.awg_warp
    fi
    uci -q get network.awg0 >/dev/null || uci set network.awg0=interface
    uci set network.awg0.proto=amneziawg
    uci set network.awg0.label="AmneziaWG (WARP)"
    uci set network.awg0.private_key="${priv}"
    uci -q delete network.awg0.addresses
    [ -n "${v4}" ] && uci add_list network.awg0.addresses="${v4}/32"
    [ "${AWG_USE6:-0}" = 1 ] && [ -n "${v6}" ] && uci add_list network.awg0.addresses="${v6}/128"
    uci set network.awg0.mtu="${mtu}"
    uci set network.awg0.awg_jc="${jc:-4}"
    uci set network.awg0.awg_jmin="${jmin:-50}"
    uci set network.awg0.awg_jmax="${jmax:-1000}"
    uci set network.awg0.awg_s1="${s1:-88}"
    uci set network.awg0.awg_s2="${s2:-88}"
    uci set network.awg0.awg_h1="${h1:-1}"
    uci set network.awg0.awg_h2="${h2:-2}"
    uci set network.awg0.awg_h3="${h3:-3}"
    uci set network.awg0.awg_h4="${h4:-4}"
    uci set network.awg0.awg_i1="${i1}"
    uci -q get network.awg0_warp >/dev/null || uci set network.awg0_warp=amneziawg_awg0
    uci set network.awg0_warp.public_key="${pub}"
    uci set network.awg0_warp.endpoint_host="$(printf '%s' "${ep}" | cut -d: -f1)"
    uci set network.awg0_warp.endpoint_port="$(printf '%s' "${ep}" | cut -d: -f2)"
    uci -q delete network.awg0_warp.allowed_ips
    uci add_list network.awg0_warp.allowed_ips='0.0.0.0/0'
    [ "${AWG_USE6:-0}" = 1 ] && uci add_list network.awg0_warp.allowed_ips='::/0'
    uci set network.awg0_warp.persistent_keepalive='25'
    uci commit network
    ubus call network reload >/dev/null 2>&1
    ubus call network.interface.awg0 up >/dev/null 2>&1 || ifup awg0 2>/dev/null
    local i=0
    while [ ${i} -lt 20 ]; do
        ip link show dev "${IFACE}" >/dev/null 2>&1 && break
        sleep 1
        i=$((i + 1))
    done
}

awg_down() {
    ubus call network.interface.awg0 down >/dev/null 2>&1
    ifdown awg0 >/dev/null 2>&1
    ip link show dev "${IFACE}" >/dev/null 2>&1 && ip link del "${IFACE}"
    while ip rule del pref "${PREF}" 2>/dev/null; do :; done
    while ip -6 rule del pref "${PREF}" 2>/dev/null; do :; done
    ip route flush table "${TABLE}" 2>/dev/null
    ip -6 route flush table "${TABLE}" 2>/dev/null
}

start_proxy() {
    local srv="$1"
    AWG_PROXY_SID="${srv}" AWG_PROXY_PORT="${PROXY_PORT}" ucode /usr/share/xray/sub/awg_proxy.uc > "${PROXY_CONF}" 2>/tmp/awg_proxy.err
    if [ $? -ne 0 ]; then
        head -c 500 /tmp/awg_proxy.err >&2
        rm -f "${PROXY_CONF}"
        fail "failed to build temporary tunnel config for ${srv}"
    fi
    "$(xray_bin)" run -c "${PROXY_CONF}" >/dev/null 2>&1 &
    PROXY_PID=$!
    sleep 2
    kill -0 "${PROXY_PID}" 2>/dev/null || fail "temporary Xray tunnel (server ${srv}) failed to start"
    log "registration tunneled via server ${srv} (socks 127.0.0.1:${PROXY_PORT})"
}

stop_proxy() {
    [ -n "${PROXY_PID}" ] && kill "${PROXY_PID}" 2>/dev/null
    rm -f "${PROXY_CONF}"
    PROXY_PID=""
}

do_register() {
    local srv="$1"
    command -v awg >/dev/null 2>&1 || fail "awg not found — install AmneziaWG tools (WARP panel Install button)"
    command -v curl >/dev/null 2>&1 || fail "curl not found — install curl"
    [ -z "${srv}" ] || uci -q get "xray_core.${srv}" >/dev/null || fail "unknown server section ${srv}"

    local priv pub body tmp v4 v6 peer_pub ep token tos
    priv=$(awg genkey | tr -d '\n')
    [ -n "${priv}" ] || fail "awg genkey failed"
    pub=$(printf '%s' "${priv}" | awg pubkey | tr -d '\n')
    tos=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
    body=$(printf '{"install_id":"","tos":"%s","key":"%s","fcm_token":"","model":"Linux","serial_number":"%s","locale":"en_US"}' \
        "${tos}" "${pub}" "$(rnd 10000000 99999999)")
    tmp=$(mktemp)

    if [ -n "${srv}" ]; then
        start_proxy "${srv}"
        trap stop_proxy EXIT INT TERM
    fi

    set --
    set -- "$@" -sS --max-time 30 -X POST
    set -- "$@" -H "Content-Type: application/json"
    set -- "$@" -H "Accept: application/json"
    set -- "$@" -H "User-Agent: okhttp/3.12.1"
    [ -n "${srv}" ] && set -- "$@" --socks5-hostname "127.0.0.1:${PROXY_PORT}"
    set -- "$@" --data "${body}" -o "${tmp}" "${API}"
    curl "$@" || { rm -f "${tmp}"; fail "Cloudflare API unreachable (curl exit $?)"; }
    [ -n "${srv}" ] && stop_proxy

    [ -s "${tmp}" ] || { rm -f "${tmp}"; fail "empty response from Cloudflare API"; }
    v4=$(read_field "${tmp}" "config.interface.addresses.v4")
    v6=$(read_field "${tmp}" "config.interface.addresses.v6")
    peer_pub=$(read_field "${tmp}" "config.peers[0].public_key")
    token=$(read_field "${tmp}" "token")
    if [ -z "${v4}" ] || [ -z "${peer_pub}" ]; then
        local excerpt
        excerpt=$(head -c 200 "${tmp}")
        rm -f "${tmp}"
        fail "unexpected API response: ${excerpt}"
    fi
    rm -f "${tmp}"

    store_uci \
        "private_key=${priv}" \
        "address_v4=${v4}" \
        "address_v6=${v6}" \
        "peer_public_key=${peer_pub}" \
        "endpoint=${AWG_ENDPOINT}" \
        "token=${token}" \
        "jc=${AWG_OBF_JC}" \
        "jmin=${AWG_OBF_JMIN}" \
        "jmax=${AWG_OBF_JMAX}" \
        "s1=${AWG_OBF_S1}" \
        "s2=${AWG_OBF_S2}" \
        "h1=${AWG_OBF_H1}" \
        "h2=${AWG_OBF_H2}" \
        "h3=${AWG_OBF_H3}" \
        "h4=${AWG_OBF_H4}" \
        "i1=${AWG_I1}" \
        "mtu=${AWG_MTU}"
    log "registered WARP device ${v4} (endpoint ${AWG_ENDPOINT})"
    awg_up
}

do_import() {
    local text kv tmp
    text=$(cat)
    [ -n "${text}" ] || fail "empty input"

    tmp=$(mktemp)
    case "${text}" in
        '{'*)
            printf '%s' "${text}" | tr -d '\r' > "${tmp}"
            json_kv "${tmp}" | while IFS='=' read -r k v; do
                case "${k}" in
                    private_key|address_v4|address_v6|peer_public_key|endpoint|token|jc|jmin|jmax|s1|s2|h1|h2|h3|h4|i1|mtu)
                        printf '%s=%s\n' "${k}" "${v}" ;;
                esac
            done > "${tmp}.kv"
            ;;
        *)
            printf '%s\n' "${text}" | awk '
                /^\[/ { next }
                {
                    eq = index($0, "=")
                    if (eq == 0) next
                    key = tolower(substr($0, 1, eq - 1))
                    gsub(/[ \t\r\n]/, "", key)
                    val = substr($0, eq + 1)
                    gsub(/^[ \t]+/, "", val)
                    gsub(/[ \t\r\n]+$/, "", val)
                    if (key == "privatekey")   print "private_key=" val
                    if (key == "address") {
                        n = split(val, a, /[ \t]*,[ \t]*/)
                        for (i = 1; i <= n; i++) {
                            if (index(a[i], ":") > 0) print "address_v6=" a[i]
                            else print "address_v4=" a[i]
                        }
                    }
                    if (key == "publickey")    print "peer_public_key=" val
                    if (key == "endpoint")     print "endpoint=" val
                    if (key == "jc")           print "jc=" val
                    if (key == "jmin")         print "jmin=" val
                    if (key == "jmax")         print "jmax=" val
                    if (key == "s1")           print "s1=" val
                    if (key == "s2")           print "s2=" val
                    if (key == "h1")           print "h1=" val
                    if (key == "h2")           print "h2=" val
                    if (key == "h3")           print "h3=" val
                    if (key == "h4")           print "h4=" val
                    if (key == "i1")           print "i1=" val
                    if (key == "mtu")          print "mtu=" val
                }
            ' > "${tmp}.kv"
            ;;
    esac
    [ -s "${tmp}.kv" ] || { rm -f "${tmp}"; fail "could not parse input (expected a .conf file or JSON key export)"; }
    while IFS= read -r kv_line; do
        [ -n "${kv_line}" ] && store_uci "${kv_line}"
    done < "${tmp}.kv"
    rm -f "${tmp}" "${tmp}.kv"
    log "imported AmneziaWG configuration"
    awg_up
}

ensure_proto_loaded() {
    if ! ubus call network get_proto_handlers 2>/dev/null | grep -q 'amneziawg'; then
        echo "restarting network to load the amneziawg proto handler..."
        /etc/init.d/network restart || echo "WARNING: network restart failed — reboot the router to load the proto handler"
    fi
}

do_install() {
    local mgr="" repo board rel ver arch tgt sub ext fallback_ext base
    command -v opkg >/dev/null 2>&1 && mgr=opkg
    command -v apk >/dev/null 2>&1 && mgr=${mgr:-apk}
    [ -n "${mgr}" ] || fail "neither opkg nor apk found"

    # Release (kmod requires the exact OpenWrt version).
    repo=$(uci -q get xray_core.@general[0].awg_pkg_repo)
    [ -n "${repo}" ] || repo="${AWG_PKG_REPO}"
    board=$(ubus call system board) || fail "ubus call system board failed"
    ver=$(printf '%s' "${board}" | jsonfilter -e '@.release.version')
    tgt=$(printf '%s' "${board}" | jsonfilter -e '@.release.target' | cut -d/ -f1)
    sub=$(printf '%s' "${board}" | jsonfilter -e '@.release.target' | cut -d/ -f2)
    arch=$(printf '%s' "${board}" | jsonfilter -e '@.release.arch')
    [ -z "${arch}" ] && arch=$( . /etc/openwrt_release 2>/dev/null; printf '%s' "${DISTRIB_ARCH}" )
    if [ -z "${arch}" ] && command -v opkg >/dev/null 2>&1; then
        arch=$(opkg print-architecture 2>/dev/null | \
            awk '$1 == "arch" && $2 != "noarch" && ($3 + 0) >= (p + 0) { p = $3; n = $2 } END { print n }')
    fi
    [ -z "${arch}" ] && command -v apk >/dev/null 2>&1 && arch=$(apk --print-arch 2>/dev/null)
    [ -z "${arch}" ] && arch=$(uname -m)
    [ -n "${ver}" ] && [ -n "${arch}" ] && [ -n "${tgt}" ] && [ -n "${sub}" ] || \
        fail "could not detect OpenWrt version/arch/target (ver=${ver} arch=${arch} target=${tgt}/${sub})"
    if [ "${mgr}" = opkg ]; then
        ext=ipk; fallback_ext=apk
    else
        ext=apk; fallback_ext=ipk
    fi
    base="${repo}/releases/download/v${ver}"
    echo "downloading from ${base} for OpenWrt ${ver} (${arch}, ${tgt}/${sub})"

    local files=""
    for pkg in kmod-amneziawg amneziawg-tools luci-proto-amneziawg; do
        local name="${pkg}_v${ver}_${arch}_${tgt}_${sub}"
        local got=""
        for e in "${ext}" "${fallback_ext}"; do
            if wget -q -O "/tmp/${name}.${e}" "${base}/${name}.${e}"; then
                got="/tmp/${name}.${e}"
                break
            fi
            rm -f "/tmp/${name}.${e}"
        done
        [ -n "${got}" ] || fail "download failed: ${base}/${name}.${ext} — no prebuilt package for this exact OpenWrt release/target; check the tags at ${repo}/releases and retry"
        ls -lh "${got}"
        files="${files} ${got}"
    done

    if [ "${mgr}" = opkg ]; then
        opkg install kmod-udptunnel4 kmod-udptunnel6 \
            kmod-crypto-lib-chacha20poly1305 kmod-crypto-lib-curve25519 ${files}
    else
        apk add --allow-untrusted kmod-udptunnel4 kmod-udptunnel6 \
            kmod-crypto-lib-chacha20poly1305 kmod-crypto-lib-curve25519 ${files}
    fi
    ensure_proto_loaded
}

do_status() {
    local awg=0 quick=0 curlx=0 reg=0 up=0 enabled ep
    command -v awg >/dev/null 2>&1 && awg=1
    command -v awg-quick >/dev/null 2>&1 && quick=1
    command -v curl >/dev/null 2>&1 && curlx=1
    [ -n "$(uci -q get "xray_core.${IFACE}.private_key")" ] && reg=1
    enabled=$(uci -q get "xray_core.${IFACE}.enabled")
    ip link show dev "${IFACE}" >/dev/null 2>&1 && up=1
    ep=$(uci -q get "xray_core.${IFACE}.endpoint")
    printf '{"awg":%d,"awg_quick":%d,"curl":%d,"registered":%d,"enabled":%s,"up":%d,"iface":"%s","mark":%d,"endpoint":%s}\n' \
        "${awg}" "${quick}" "${curlx}" "${reg}" "${enabled:-0}" "${up}" "${IFACE}" "${MARK}" "$(printf '%s' "${ep}" | jq -Rs .)"
}

case "${1:-}" in
    status)   do_status ;;
    register) shift; do_register "$1" ;;
    import)   do_import ;;
    install)  do_install ;;
    watch)    awg_watch_run ;;
    up)       [ "$(uci -q get "xray_core.${IFACE}.enabled")" = "1" ] || exit 0; awg_up ;;
    down)     awg_watch_stop; awg_down ;;
    *) echo "Usage: $0 status|register [server_sid]|import|install|watch|up|down" >&2; exit 64 ;;
esac
