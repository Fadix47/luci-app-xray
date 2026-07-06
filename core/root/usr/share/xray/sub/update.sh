#!/bin/sh
# update.sh [sub_id] — with no arg processes every enabled subscription.
# Orchestrates fetch → parse → apply → reload.

. /lib/functions.sh

LOG_TAG="xray-sub"

log() { logger -t "${LOG_TAG}" -- "$1"; echo "$1"; }

process_subscription() {
    local sub_id="$1"
    local url ua hwid enabled
    config_get url "${sub_id}" url
    config_get ua "${sub_id}" user_agent
    config_get hwid "${sub_id}" hwid
    config_get enabled "${sub_id}" enabled "1"

    log "=== ${sub_id}: enabled=${enabled} url=${url:-<none>} ==="

    [ "${enabled}" = "0" ] && { log "skip ${sub_id} (disabled)"; return 0; }
    if [ -z "${url}" ]; then
        log "skip ${sub_id} (no url) — does the section actually exist? uci show xray_core.${sub_id}"
        return 1
    fi

    local bodytmp hdrtmp decoded parsedtmp
    bodytmp=$(mktemp); hdrtmp=$(mktemp)
    decoded=$(mktemp); parsedtmp=$(mktemp)

    /usr/share/xray/sub/fetch.sh "${url}" "${ua}" "${hwid}" "${bodytmp}" "${hdrtmp}"
    local ec=$?
    if [ ${ec} -ne 0 ]; then
        log "fetch failed (${ec}) for ${sub_id}; first 400 bytes of headers:"
        head -c 400 "${hdrtmp}" 2>/dev/null | logger -t "${LOG_TAG}" -- 2>/dev/null
        rm -f "${bodytmp}" "${hdrtmp}" "${decoded}" "${parsedtmp}"
        return ${ec}
    fi

    local pt pi
    pt=$(awk 'BEGIN{IGNORECASE=1} /^[[:space:]]*profile-title:/ {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "${hdrtmp}")
    pi=$(awk 'BEGIN{IGNORECASE=1} /^[[:space:]]*profile-update-interval:/ {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "${hdrtmp}")
    case "${pt}" in
        base64:*)
            pt=$(printf '%s' "${pt#base64:}" | base64 -d 2>/dev/null)
            ;;
    esac
    [ -n "${pt}" ] && log "profile-title: ${pt}"
    [ -n "${pi}" ] && log "profile-update-interval: ${pi} h"

    if base64 -d <"${bodytmp}" 2>/dev/null | grep -q '://'; then
        log "body looks base64-encoded, decoding"
        base64 -d <"${bodytmp}" >"${decoded}" 2>/dev/null
    else
        cp "${bodytmp}" "${decoded}"
    fi

    local dec_bytes
    dec_bytes=$(wc -c <"${decoded}" 2>/dev/null)
    log "decoded body: ${dec_bytes} bytes"

    ucode /usr/share/xray/sub/parse.uc <"${decoded}" >"${parsedtmp}" 2>/tmp/xray_parse.err
    if [ ! -s "${parsedtmp}" ]; then
        log "parse failed for ${sub_id}: $(head -c 200 /tmp/xray_parse.err 2>/dev/null)"
        rm -f "${bodytmp}" "${hdrtmp}" "${decoded}" "${parsedtmp}"
        return 5
    fi

    local n_servers
    n_servers=$(jsonfilter -i "${parsedtmp}" -e '@[*].protocol' 2>/dev/null | wc -l)
    log "parsed ${n_servers} server(s) from subscription"

    local apply_err
    apply_err=$(mktemp)
    ucode /usr/share/xray/sub/apply.uc "${sub_id}" "${pt}" "${pi}" <"${parsedtmp}" 2>"${apply_err}"
    local apply_ec=$?
    if [ -s "${apply_err}" ]; then
        log "apply stderr:"
        head -c 1500 "${apply_err}" 2>/dev/null | logger -t "${LOG_TAG}" -- 2>/dev/null
    fi
    rm -f "${apply_err}"

    uci -q set "xray_core.${sub_id}.last_updated=$(date +%s)"

    # Auto-derive a human name on first successful fetch.
    local cur_name
    cur_name=$(uci -q get "xray_core.${sub_id}.name")
    if [ -z "${cur_name}" ]; then
        if [ -n "${pt}" ]; then
            uci -q set "xray_core.${sub_id}.name=${pt}"
        else
            # fall back to URL host
            local host
            host=$(echo "${url}" | sed -n 's@^https\?://\([^/?#]*\).*@\1@p')
            [ -n "${host}" ] && uci -q set "xray_core.${sub_id}.name=${host}"
        fi
    fi

    uci -q commit xray_core

    case ${apply_ec} in
        10)
            log "${sub_id}: changed -> reloading xray"
            /etc/init.d/xray_core reload >/dev/null 2>&1
            /usr/share/xray/sub/cron_install.sh >/dev/null 2>&1
            apply_ec=0
            ;;
        0)
            log "${sub_id}: unchanged (no reload)"
            ;;
        *)
            log "${sub_id}: apply failed (ec=${apply_ec})"
            ;;
    esac

    rm -f "${bodytmp}" "${hdrtmp}" "${decoded}" "${parsedtmp}"
    return ${apply_ec}
}

# Delete orphaned server sections; probe each sub directly to avoid dropping
# balancer selections for live subs.
clean_orphan_servers() {
    local orphans='' removed_count=0
    local checked_subs='' valid_subs=''

    local section sub_id sub_type
    for section in $(uci -q show xray_core 2>/dev/null \
            | sed -n "s/^xray_core\.\([^.]*\)=servers$/\1/p"); do
        sub_id=$(uci -q get "xray_core.${section}.subscription_id")
        [ -z "${sub_id}" ] && continue

        # Memoise: one uci get per distinct sub_id, even with many servers.
        case " ${checked_subs} " in
            *" ${sub_id} "*) : ;;
            *)
                sub_type=$(uci -q get "xray_core.${sub_id}" 2>/dev/null)
                checked_subs="${checked_subs} ${sub_id}"
                [ "${sub_type}" = "subscription" ] && valid_subs="${valid_subs} ${sub_id}"
                ;;
        esac

        case " ${valid_subs} " in
            *" ${sub_id} "*) : ;;
            *)
                orphans="${orphans} ${section}"
                removed_count=$((removed_count + 1))
                ;;
        esac
    done

    [ -z "${orphans}" ] && return 0

    log "orphan cleanup: removing ${removed_count} server section(s) tied to deleted subscriptions:${orphans}"

    # Scrub the doomed sections out of every balancer list.
    local g bf cur new_list item kept_any changed
    for g in $(uci -q show xray_core 2>/dev/null \
            | sed -n "s/^xray_core\.\([^.]*\)=general$/\1/p"); do
        for bf in tcp_balancer_v4 udp_balancer_v4 tcp_balancer_v6 udp_balancer_v6; do
            cur=$(uci -q get "xray_core.${g}.${bf}" 2>/dev/null)
            [ -z "${cur}" ] && continue
            new_list=''
            changed=0
            for item in ${cur}; do
                kept_any=1
                for o in ${orphans}; do
                    if [ "${item}" = "${o}" ]; then kept_any=0; break; fi
                done
                if [ "${kept_any}" = "1" ]; then
                    new_list="${new_list} ${item}"
                else
                    changed=1
                fi
            done
            if [ "${changed}" = "1" ]; then
                uci -q delete "xray_core.${g}.${bf}"
                for item in ${new_list}; do
                    uci -q add_list "xray_core.${g}.${bf}=${item}"
                done
            fi
        done
    done

    for section in ${orphans}; do
        uci -q delete "xray_core.${section}"
    done
    uci -q commit xray_core
    /etc/init.d/xray_core reload >/dev/null 2>&1 || true
}

config_load xray_core

clean_orphan_servers

if [ -z "$1" ]; then
    log "updating ALL enabled subscriptions"
    config_foreach process_subscription subscription
else
    process_subscription "$1"
fi
