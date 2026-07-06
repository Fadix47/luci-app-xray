#!/bin/sh
# ping_batch.sh <method=head|get> <target_url> [sid ...] — pings given sids
# (or all servers) and prints a JSON array. HEAD/GET tunnel via Xray, batched.

. /lib/functions.sh

METHOD="${1:-head}"
# TCP handshake pinging was removed (unreliable for UDP/QUIC outbounds and
# noisy from shell). Map any stale "tcp" selection to HEAD.
[ "${METHOD}" = "tcp" ] && METHOD=head
TARGET="${2:-http://www.gstatic.com/generate_204}"
shift 2 2>/dev/null

SIDS="$*"
if [ -z "${SIDS}" ]; then
    SIDS=""
    collect() { SIDS="${SIDS} $1"; }
    config_load xray_core
    config_foreach collect servers
fi

BATCH_SIZE=5
BASE_PORT=42000
TMPDIR=$(mktemp -d)
XRAY_BIN=$(uci -q get xray_core.@general[0].xray_bin)
[ -z "${XRAY_BIN}" ] && XRAY_BIN=/usr/bin/xray
RUNNING_XRAY_PID=""

cleanup() {
    [ -n "${RUNNING_XRAY_PID}" ] && kill "${RUNNING_XRAY_PID}" 2>/dev/null
    rm -rf "${TMPDIR}" 2>/dev/null
}
trap cleanup EXIT INT TERM

# /proc/uptime only carries 10ms (centisecond) resolution. Prefer a real
# nanosecond clock via `date +%s%N` when the platform's date supports %N
# (GNU date / BusyBox built with FEATURE_DATE_NANO); otherwise degrade to the
# centisecond clock so arithmetic still works, just coarser.
_hr_probe=$(date +%N 2>/dev/null)
case "${_hr_probe}" in
    ''|*[!0-9]*) HR_NANO=0 ;;
    *)           HR_NANO=1 ;;
esac
hr_ns() {
    if [ "${HR_NANO}" = "1" ]; then
        date +%s%N
    else
        awk '{printf "%.0f", $1*1000000000; exit}' /proc/uptime
    fi
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

write_result() {
    # write_result <sid> <json_body>
    printf '%s\n' "$2" > "${TMPDIR}/$1.json"
}

ping_via_proxy() {
    # ping_via_proxy <sid> <local_port>
    local sid="$1" port="$2"
    local host port_raw srv_port start end ms ec extra=""
    host=$(uci -q get "xray_core.${sid}.server")
    port_raw=$(uci -q get "xray_core.${sid}.server_port")
    srv_port=$(printf '%s' "${port_raw}" | awk '{print $1}')
    [ -z "${srv_port}" ] && srv_port=443
    [ -z "${host}" ] && host="?"
    [ "${METHOD}" = "head" ] && extra="--spider"
    start=$(hr_ns)
    http_proxy="http://127.0.0.1:${port}" https_proxy="http://127.0.0.1:${port}" \
        wget ${extra} --timeout=8 --tries=1 -q -O /dev/null "${TARGET}" 2>/dev/null
    ec=$?
    end=$(hr_ns); ms=$(( (end - start) / 1000000 ))
    if [ ${ec} -eq 0 ]; then
        write_result "${sid}" "{\"sub_id\":\"${sid}\",\"ok\":true,\"method\":\"${METHOD}\",\"latency_ms\":${ms},\"host\":\"${host}\",\"port\":${srv_port},\"target\":\"$(json_escape "${TARGET}")\"}"
    else
        # Only wget ec=0 counts as reachable; 4xx/5xx are broken outbounds
        # (e.g. placeholder servers returning 502) — not real successes.
        write_result "${sid}" "{\"sub_id\":\"${sid}\",\"ok\":false,\"method\":\"${METHOD}\",\"host\":\"${host}\",\"port\":${srv_port},\"target\":\"$(json_escape "${TARGET}")\",\"error\":\"request failed (wget ec=${ec})\",\"latency_ms\":${ms}}"
    fi
}

batch_tunnel() {
    # batch_tunnel <sid1> [sid2 ... up to BATCH_SIZE]
    local sids="$*"
    local cfg="${TMPDIR}/cfg-$$-$RANDOM.json"
    ucode /usr/share/xray/sub/ping_config.uc "${BASE_PORT}" ${sids} > "${cfg}" 2>"${TMPDIR}/cfg.err"
    if [ ! -s "${cfg}" ]; then
        for sid in ${sids}; do
            write_result "${sid}" "{\"sub_id\":\"${sid}\",\"ok\":false,\"method\":\"${METHOD}\",\"error\":\"ping_config.uc failed\"}"
        done
        return 1
    fi
    if ! "${XRAY_BIN}" run -test -c "${cfg}" >"${TMPDIR}/test.log" 2>&1; then
        for sid in ${sids}; do
            write_result "${sid}" "{\"sub_id\":\"${sid}\",\"ok\":false,\"method\":\"${METHOD}\",\"error\":\"xray config rejected\"}"
        done
        return 2
    fi

    "${XRAY_BIN}" run -c "${cfg}" >/dev/null 2>"${TMPDIR}/xray.log" &
    RUNNING_XRAY_PID=$!
    sleep 1

    local i=0 pids=""
    for sid in ${sids}; do
        local p=$((BASE_PORT + i))
        ping_via_proxy "${sid}" "${p}" &
        pids="${pids} $!"
        i=$((i + 1))
    done
    for pid in ${pids}; do wait "${pid}" 2>/dev/null; done

    kill "${RUNNING_XRAY_PID}" 2>/dev/null
    wait "${RUNNING_XRAY_PID}" 2>/dev/null
    RUNNING_XRAY_PID=""
}

# === main ===

# HEAD/GET only: tunnel each batch of servers through a temporary Xray instance.
batch=""
count=0
for sid in ${SIDS}; do
    batch="${batch} ${sid}"
    count=$((count + 1))
    if [ ${count} -ge ${BATCH_SIZE} ]; then
        batch_tunnel ${batch}
        batch=""; count=0
    fi
done
[ -n "${batch}" ] && batch_tunnel ${batch}

# Assemble JSON array in original order
first=1
printf '['
for sid in ${SIDS}; do
    if [ -f "${TMPDIR}/${sid}.json" ]; then
        if [ ${first} -eq 1 ]; then first=0; else printf ','; fi
        cat "${TMPDIR}/${sid}.json"
    fi
done
printf ']\n'
