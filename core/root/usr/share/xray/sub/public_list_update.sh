#!/bin/sh
# Refresh community list caches under /usr/share/xray/public_lists/.
# Usage: [no args] full refresh | <id> single list | --catalog | --bootstrap (init.d).

. /lib/functions.sh

LOG_TAG="xray-public-list"
CACHE_DIR="/usr/share/xray/public_lists"
CATALOG_FILE="${CACHE_DIR}/_catalog.json"
TARGET="$1"

DEFAULT_BASE_URL="https://raw.githubusercontent.com/Fadix47/xray-preset-lists/main"
# raw.githubusercontent.com — no 60req/h API rate limit, CDN-cached.
DEFAULT_CATALOG_URL="https://raw.githubusercontent.com/Fadix47/xray-preset-lists/main/index.json"

log() { logger -t "${LOG_TAG}" -- "$1"; echo "$1"; }

mkdir -p "${CACHE_DIR}"

BASE_URL=$(uci -q get xray_core.@general[0].community_lists_base_url)
[ -z "${BASE_URL}" ] && BASE_URL="${DEFAULT_BASE_URL}"
CATALOG_URL=$(uci -q get xray_core.@general[0].community_catalog_url)
[ -z "${CATALOG_URL}" ] && CATALOG_URL="${DEFAULT_CATALOG_URL}"

NEED_RELOAD=0

# Parse .lst into <id>.{domains,subnets}; emits "<dcount> <scount> <changed>".
parse_one() {
    local raw="$1" base="$2"
    local domains="${base}.domains.new"
    local subnets="${base}.subnets.new"
    : > "${domains}"
    : > "${subnets}"
    local counts
    counts=$(awk -v dom_out="${domains}" -v sub_out="${subnets}" '
        BEGIN { dc = 0; sc = 0 }
        {
            sub(/\r$/, "")
            sub(/#.*$/, "")
            gsub(/^[ \t]+|[ \t]+$/, "")
            if (length($0) == 0) next

            line = $0

            if (sub(/^domain:/,  "", line)) { }
            else if (sub(/^full:/, "", line)) { }
            else if (sub(/^keyword:/, "", line)) { }

            if (line ~ /^(geoip|geosite|ext|regexp):/) next

            if (match(line, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/)) {
                if (line ~ /\//) {
                    p = line; sub(/^[^/]+\//, "", p)
                    if (p + 0 < 0 || p + 0 > 32) next
                }
                print line >> sub_out
                sc++
                next
            }

            if (line ~ /^[A-Za-z0-9._-]+$/ && line ~ /\./) {
                print line >> dom_out
                dc++
                next
            }
        }
        END { printf "%d %d\n", dc, sc }
    ' "${raw}")

    local changed=0
    if [ -f "${base}.domains" ] && cmp -s "${domains}" "${base}.domains"; then
        rm -f "${domains}"
    else
        mv "${domains}" "${base}.domains"
        changed=1
    fi
    if [ -f "${base}.subnets" ] && cmp -s "${subnets}" "${base}.subnets"; then
        rm -f "${subnets}"
    else
        mv "${subnets}" "${base}.subnets"
        changed=1
    fi
    printf '%s %d\n' "${counts}" "${changed}"
}

# Sanitize id to alnum/._- only; empty if unsafe for a URL path.
sanitize_id() {
    local raw="$1"
    case "${raw}" in
        ''|*[!A-Za-z0-9._-]*) printf ''; return ;;
    esac
    case "${raw}" in
        .*|*..*) printf ''; return ;;
    esac
    printf '%s' "${raw}"
}

fetch_one() {
    local id
    id=$(sanitize_id "$1")
    if [ -z "${id}" ]; then
        log "skip: invalid id '$1'"
        return 1
    fi
    # Bootstrap: skip ids that already have a cache (init.d shouldn't re-hammer GitHub).
    if [ "${MODE}" = "bootstrap" ]; then
        if [ -s "${CACHE_DIR}/${id}.domains" ] || [ -s "${CACHE_DIR}/${id}.subnets" ]; then
            log "skip ${id}: cache already present (bootstrap mode)"
            return 0
        fi
    fi
    local url="${BASE_URL}/${id}.lst"
    local tmp
    tmp=$(mktemp 2>/dev/null) || tmp="/tmp/.xray_pl_${id}.$$"
    log "fetch ${id} <- ${url}"
    wget -q --timeout=15 --max-redirect=5 -O "${tmp}" --header="User-Agent: luci-app-xray" "${url}"
    local ec=$?
    if [ ${ec} -ne 0 ] || [ ! -s "${tmp}" ]; then
        log "fetch FAILED for ${id} ec=${ec}"
        rm -f "${tmp}"
        return 1
    fi
    local triplet dcount scount changed
    triplet=$(parse_one "${tmp}" "${CACHE_DIR}/${id}")
    rm -f "${tmp}"
    # shellcheck disable=SC2086
    set -- ${triplet}
    dcount="${1:-0}"
    scount="${2:-0}"
    changed="${3:-0}"
    if [ "${changed}" = "1" ]; then
        NEED_RELOAD=1
        log "parsed ${id}: ${dcount} domains, ${scount} subnets (changed)"
    else
        log "parsed ${id}: ${dcount} domains, ${scount} subnets (unchanged)"
    fi
    return 0
}

# Drop cache files whose ids are no longer in `community_lists`.
prune_orphans() {
    local selected
    selected=" $(uci -q get xray_core.@general[0].community_lists | tr ' \t,;' '    ') "
    for f in "${CACHE_DIR}"/*.domains "${CACHE_DIR}"/*.subnets; do
        [ -e "${f}" ] || continue
        local base="${f##*/}"
        local id="${base%.domains}"
        id="${id%.subnets}"
        case "${selected}" in
            *" ${id} "*) ;;
            *)
                log "prune orphan ${f}"
                rm -f "${f}"
                NEED_RELOAD=1
                ;;
        esac
    done
}

# Refresh _catalog.json; keep previous snapshot on failure.
catalog_refresh() {
    local tmp
    tmp=$(mktemp 2>/dev/null) || tmp="/tmp/.xray_pl_cat.$$"
    log "catalog: GET ${CATALOG_URL}"
    if ! wget -q --timeout=15 --max-redirect=5 -O "${tmp}" \
            --header="User-Agent: luci-app-xray" \
            --header="Accept: application/vnd.github+json" \
            "${CATALOG_URL}"; then
        log "catalog: wget failed (network/rate-limit?), keeping previous snapshot"
        rm -f "${tmp}"
        return 1
    fi
    if [ ! -s "${tmp}" ]; then
        log "catalog: empty body, keeping previous snapshot"
        rm -f "${tmp}"
        return 1
    fi
    # Accepts manifest (array or {lists:[…]}) and GitHub Contents API responses.
    local out
    out=$(jq -c '
        def normalize_arr:
            [ .[]
              | if (.id != null) then
                    { id: .id,
                      name: (.name // .id),
                      description: (.description // ""),
                      size: (.size // 0) }
                elif (.type == "file") and (.name|endswith(".lst")) then
                    { id: (.name|rtrimstr(".lst")),
                      name: (.name|rtrimstr(".lst")),
                      description: "",
                      size: (.size // 0) }
                else
                    empty
                end
            ];
        if type == "array" then
            normalize_arr
        elif type == "object" and (.lists | type == "array") then
            .lists | normalize_arr
        else
            null
        end
    ' "${tmp}" 2>/dev/null)
    rm -f "${tmp}"
    if [ -z "${out}" ] || [ "${out}" = "null" ]; then
        log "catalog: non-array response (rate-limit?), keeping previous snapshot"
        return 1
    fi
    printf '%s\n' "${out}" > "${CATALOG_FILE}"
    local count
    count=$(printf '%s' "${out}" | jq 'length' 2>/dev/null)
    log "catalog refreshed: ${count:-?} list(s)"
    uci -q set "xray_core.@general[0].community_catalog_last_updated=$(date +%s)"
    uci -q commit xray_core
    return 0
}

# Catalog auto-refresh staleness (seconds); manual UI button bypasses this.
CATALOG_TTL=$((24 * 3600))

catalog_age_seconds() {
    [ -f "${CATALOG_FILE}" ] || { echo 999999999; return; }
    local mt now
    mt=$(date -r "${CATALOG_FILE}" +%s 2>/dev/null)
    now=$(date +%s)
    if [ -z "${mt}" ] || [ -z "${now}" ]; then
        echo 999999999
        return
    fi
    echo $((now - mt))
}

# Selected ids space-separated; iterate via `for` (not `while read`) so NEED_RELOAD propagates.
selected_ids() {
    uci -q get xray_core.@general[0].community_lists \
        | tr ',\t;' '   '
}

MODE=full
case "${TARGET}" in
    --catalog)
        catalog_refresh
        exit $?
        ;;
    --bootstrap)
        MODE=bootstrap
        TARGET=
        ;;
esac

if [ -n "${TARGET}" ]; then
    fetch_one "${TARGET}"
else
    # Auto-refresh catalog if missing or stale; bootstrap only fetches when absent.
    if [ ! -f "${CATALOG_FILE}" ]; then
        catalog_refresh
    elif [ "${MODE}" = "full" ] && [ "$(catalog_age_seconds)" -ge "${CATALOG_TTL}" ]; then
        catalog_refresh
    fi
    # shellcheck disable=SC2046,SC2086  # intentional word-splitting
    for id in $(selected_ids); do
        [ -n "${id}" ] || continue
        fetch_one "${id}"
    done
fi

prune_orphans

uci -q set "xray_core.@general[0].community_lists_last_updated=$(date +%s)"
uci -q commit xray_core

if [ "${NEED_RELOAD}" = "1" ]; then
    log "content changed, reloading xray"
    /etc/init.d/xray_core reload >/dev/null 2>&1
fi

exit 0
