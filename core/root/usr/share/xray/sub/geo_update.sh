#!/bin/sh
# Download geoip.dat / geosite.dat from user-configured URLs into /usr/share/xray.
# Reloads xray only if the on-disk file actually changed.

. /lib/functions.sh

LOG_TAG="xray-geo"
DEST_DIR="/usr/share/xray"

log() { logger -t "${LOG_TAG}" -- "$1"; echo "$1"; }

update_one() {
    local url="$1" dest="$2"
    [ -z "${url}" ] && { log "no URL for ${dest##*/}, skipping"; return 0; }
    local tmp
    tmp=$(mktemp)
    log "fetching ${url} -> ${dest}"
    wget -q --max-redirect=5 -O "${tmp}" --header="User-Agent: luci-app-xray" "${url}"
    local ec=$?
    if [ ${ec} -ne 0 ]; then
        log "wget failed (${ec}) for ${url}"
        rm -f "${tmp}"; return ${ec}
    fi
    if [ ! -s "${tmp}" ]; then
        log "empty body for ${url}"
        rm -f "${tmp}"; return 4
    fi
    local bytes
    bytes=$(wc -c <"${tmp}")
    if [ -f "${dest}" ] && cmp -s "${tmp}" "${dest}"; then
        log "${dest##*/} unchanged (${bytes} bytes)"
        rm -f "${tmp}"; return 0
    fi
    mkdir -p "${DEST_DIR}"
    mv "${tmp}" "${dest}"
    chmod 0644 "${dest}"
    log "${dest##*/} updated (${bytes} bytes)"
    NEED_RELOAD=1
    return 0
}

config_load xray_core

# If geo is disabled, wipe on-disk data + parser cache and exit (handles stray
# cron firings during disable->enable flips).
GEO_DISABLED=$(uci -q get xray_core.@general[0].geo_disabled)
if [ "${GEO_DISABLED}" = "1" ]; then
    log "geo files disabled — removing data and skipping update"
    rm -f "${DEST_DIR}/geoip.dat" "${DEST_DIR}/geosite.dat" /tmp/xray_geoip_cache.json
    exit 0
fi

GEOIP_URL=$(uci -q get xray_core.@general[0].geo_geoip_url)
GEOSITE_URL=$(uci -q get xray_core.@general[0].geo_geosite_url)

NEED_RELOAD=0
update_one "${GEOIP_URL}"   "${DEST_DIR}/geoip.dat"
update_one "${GEOSITE_URL}" "${DEST_DIR}/geosite.dat"

uci -q set "xray_core.@general[0].geo_last_updated=$(date +%s)"
uci -q commit xray_core

if [ "${NEED_RELOAD}" = "1" ]; then
    # Pre-warm geoip cache before xray reload — avoids stacking the 30-50 MB
    # parse spike on top of xray start-up RSS.
    log "refreshing geoip code cache"
    /usr/bin/ucode /usr/share/xray/sub/geoip_refresh.uc 2>&1 | logger -t xray-geo

    log "reloading xray to pick up new geo files"
    /etc/init.d/xray_core reload >/dev/null 2>&1
fi

exit 0
