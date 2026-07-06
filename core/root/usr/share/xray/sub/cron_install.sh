#!/bin/sh
# Regenerate the cron block for subscription auto-update.
# Drops the existing "# xray_subscription_update" block and rewrites it from UCI.

. /lib/functions.sh

CRONTAB=/etc/crontabs/root
MARKER="# xray_subscription_update"
TMP=$(mktemp)

mkdir -p "$(dirname "${CRONTAB}")"
[ -f "${CRONTAB}" ] || touch "${CRONTAB}"

# Drop the existing managed block (everything between START / END markers, plus orphan single lines).
awk -v marker="${MARKER}" '
    BEGIN { in_block = 0 }
    $0 == marker " START" { in_block = 1; next }
    $0 == marker " END"   { in_block = 0; next }
    in_block { next }
    $0 ~ marker { next }   # legacy single-line marker
    { print }
' "${CRONTAB}" > "${TMP}"

emit() {
    local sub_id="$1"
    local enabled iv
    config_get enabled "${sub_id}" enabled "1"
    config_get iv      "${sub_id}" update_interval_hours
    [ "${enabled}" = "0" ] && return
    [ -z "${iv}" ] && return
    case "${iv}" in
        ''|*[!0-9]*) return ;;
    esac
    [ "${iv}" -lt 1 ] && return
    if [ "${iv}" -ge 24 ]; then
        printf '30 3 * * * /usr/share/xray/sub/update.sh %s\n' "${sub_id}"
    else
        printf '0 */%d * * * /usr/share/xray/sub/update.sh %s\n' "${iv}" "${sub_id}"
    fi
}

BLOCK_TMP=$(mktemp)
config_load xray_core
config_foreach emit subscription > "${BLOCK_TMP}" 2>/dev/null

# Emit geo-update cron only if geo is enabled, URLs and interval are set.
GEO_DISABLED=$(uci -q get xray_core.@general[0].geo_disabled)
GEO_IV=$(uci -q get xray_core.@general[0].geo_update_interval_hours)
GEO_IP_URL=$(uci -q get xray_core.@general[0].geo_geoip_url)
GEO_SITE_URL=$(uci -q get xray_core.@general[0].geo_geosite_url)
if [ "${GEO_DISABLED}" != "1" ] \
    && { [ -n "${GEO_IP_URL}" ] || [ -n "${GEO_SITE_URL}" ]; } \
    && [ -n "${GEO_IV}" ] \
    && expr "${GEO_IV}" : '^[0-9]\+$' >/dev/null \
    && [ "${GEO_IV}" -ge 1 ]; then
    if [ "${GEO_IV}" -ge 24 ]; then
        days=$(( GEO_IV / 24 ))
        printf '15 4 */%d * * /usr/share/xray/sub/geo_update.sh\n' "${days}" >> "${BLOCK_TMP}"
    else
        printf '15 */%d * * * /usr/share/xray/sub/geo_update.sh\n' "${GEO_IV}" >> "${BLOCK_TMP}"
    fi
fi

# Append public-list cron line if the user has picked at least one entry
# from the community catalog. Interval is fixed at 6h per spec (no UI knob).
COMMUNITY_LIST_PICKED=$(uci -q get xray_core.@general[0].community_lists)
if [ -n "${COMMUNITY_LIST_PICKED}" ]; then
    printf '15 */6 * * * /usr/share/xray/sub/public_list_update.sh\n' >> "${BLOCK_TMP}"
fi

if [ -s "${BLOCK_TMP}" ]; then
    {
        printf '%s START\n' "${MARKER}"
        cat "${BLOCK_TMP}"
        printf '%s END\n' "${MARKER}"
    } >> "${TMP}"
fi
rm -f "${BLOCK_TMP}"

mv "${TMP}" "${CRONTAB}"
/etc/init.d/cron reload >/dev/null 2>&1 || /etc/init.d/cron restart >/dev/null 2>&1
exit 0
