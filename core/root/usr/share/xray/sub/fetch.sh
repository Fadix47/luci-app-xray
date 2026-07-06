#!/bin/sh
# Usage: fetch.sh <url> <user_agent> <hwid> <body_path> <headers_path>
# Writes response body/headers to the given paths. Exits 0 on success.

URL="$1"
UA="$2"
HWID="$3"
BODY="$4"
HEADERS="$5"

LOG_TAG="xray-sub"
log() { logger -t "${LOG_TAG}" -- "fetch: $1"; echo "fetch: $1" >&2; }

[ -z "${URL}" ] && { log "empty URL"; exit 2; }
[ -z "${BODY}" ] && { log "missing body path"; exit 2; }
[ -z "${HEADERS}" ] && { log "missing headers path"; exit 2; }

WGET=$(command -v wget)
[ -z "${WGET}" ] && { log "wget not found"; exit 3; }

# Build a default UA "OpenWRT/<model>/<release>", using "unknown" for missing parts.
build_default_ua() {
    local model='' release=''
    if [ -r /tmp/sysinfo/model ]; then
        model=$(head -n1 /tmp/sysinfo/model 2>/dev/null)
    fi
    if [ -z "${model}" ] && [ -r /tmp/sysinfo/board_name ]; then
        model=$(head -n1 /tmp/sysinfo/board_name 2>/dev/null)
    fi
    if [ -r /etc/openwrt_release ]; then
        release=$( . /etc/openwrt_release 2>/dev/null; printf '%s' "${DISTRIB_RELEASE}" )
    fi
    # HTTP header sanitisation: drop everything that isn't [A-Za-z0-9._-],
    # collapse runs of '-' and trim leading/trailing dashes.
    model=$(printf '%s' "${model}"   | sed -e 's/[^A-Za-z0-9._-]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//')
    release=$(printf '%s' "${release}" | sed -e 's/[^A-Za-z0-9._-]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//')
    [ -z "${model}" ]   && model='unknown'
    [ -z "${release}" ] && release='unknown'
    printf 'OpenWRT/%s/%s' "${model}" "${release}"
}

[ -z "${UA}" ] && UA=$(build_default_ua)

# Stable 32-char HWID from MAC + board + release (reproducible across reboots).
compute_hwid() {
    local mac='' iface board release seed
    for iface in br-lan eth0 lan0 eth1 wan; do
        if [ -r "/sys/class/net/${iface}/address" ]; then
            mac=$(cat "/sys/class/net/${iface}/address" 2>/dev/null)
            [ -n "${mac}" ] && [ "${mac}" != "00:00:00:00:00:00" ] && break
            mac=
        fi
    done
    if [ -r /tmp/sysinfo/board_name ]; then
        board=$(head -n1 /tmp/sysinfo/board_name 2>/dev/null)
    fi
    if [ -r /etc/openwrt_release ]; then
        release=$( . /etc/openwrt_release 2>/dev/null; printf '%s' "${DISTRIB_RELEASE}" )
    fi
    seed="${mac}|${board}|${release}"
    # Fallback: cache a random seed in /etc if no stable identifier is available.
    if [ "${seed}" = "||" ]; then
        local cache=/etc/xray_hwid_seed
        if [ ! -s "${cache}" ]; then
            head -c 16 /dev/urandom 2>/dev/null | sha256sum | head -c 32 > "${cache}"
        fi
        cat "${cache}" 2>/dev/null
        return
    fi
    printf '%s' "${seed}" | sha256sum | head -c 32
}

# UCI sentinel values to suppress the X-Hwid header entirely.
case "${HWID}" in
    none|disabled|-) HWID='' ;;
    '')              HWID=$(compute_hwid) ;;
esac

set --
set -- "$@" "--header=User-Agent: ${UA}"
[ -n "${HWID}" ] && set -- "$@" "--header=X-Hwid: ${HWID}"

log "GET ${URL} (UA=${UA}$([ -n "${HWID}" ] && echo " X-Hwid=${HWID}"))"

# -S forces server-response headers onto stderr; we DON'T pass -q so transport
# errors show up there too. stderr is captured into ${HEADERS}.
"${WGET}" -S --max-redirect=5 -O "${BODY}" "$@" "${URL}" 2>"${HEADERS}"
ec=$?

if [ ${ec} -ne 0 ]; then
    log "wget exited ${ec}; headers/body excerpt below"
    head -c 2000 "${HEADERS}" 2>/dev/null | logger -t "${LOG_TAG}" -- 2>/dev/null
    exit ${ec}
fi

if [ ! -s "${BODY}" ]; then
    log "empty body returned by server"
    head -c 1000 "${HEADERS}" 2>/dev/null | logger -t "${LOG_TAG}" -- 2>/dev/null
    exit 4
fi

bytes=$(wc -c <"${BODY}" 2>/dev/null)
log "got ${bytes} bytes"
exit 0
