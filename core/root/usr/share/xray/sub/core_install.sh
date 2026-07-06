#!/bin/sh
# core_install.sh list                — print {"current_arch":..,"asset":..,"tags":[..]} JSON
# core_install.sh install <tag>       — download asset, unpack, switch xray_bin to /usr/local/bin/xray

CACHE=/tmp/xray_releases.json
CACHE_TTL=300
DEST=/usr/local/bin/xray
GH_API="https://api.github.com/repos/XTLS/Xray-core/releases?per_page=30"

current_arch() {
    local a
    a=$(opkg print-architecture 2>/dev/null | awk '/^arch/ {print $2}' | grep -v -E '^(all|noarch)$' | tail -n1)
    [ -z "${a}" ] && a=$(uname -m)
    echo "${a}"
}

resolve_asset() {
    local arch="$1"
    case "${arch}" in
        x86_64)                       echo "Xray-linux-64.zip" ;;
        i386_pentium*|i486|i586|i686|x86) echo "Xray-linux-32.zip" ;;
        aarch64*)                     echo "Xray-linux-arm64-v8a.zip" ;;
        arm_cortex-a15*|arm_cortex-a9*|arm_cortex-a8*|arm_cortex-a7*|arm_cortex-a5*|armv7*) echo "Xray-linux-arm32-v7a.zip" ;;
        arm_arm1176*|arm_arm11*|armv6*) echo "Xray-linux-arm32-v6.zip" ;;
        arm_arm926*|armv5*)           echo "Xray-linux-arm32-v5.zip" ;;
        mipsel_*|mipsel)              echo "Xray-linux-mips32le.zip" ;;
        mips_24kc*|mips)              echo "Xray-linux-mips32.zip" ;;
        mips64el_*|mips64el)          echo "Xray-linux-mips64le.zip" ;;
        mips64_*|mips64)              echo "Xray-linux-mips64.zip" ;;
        loongarch64*)                 echo "Xray-linux-loong64.zip" ;;
        riscv64*)                     echo "Xray-linux-riscv64.zip" ;;
        *)                            echo "" ;;
    esac
}

list_releases() {
    local now mtime arch asset tags stale
    now=$(date +%s)
    stale=0
    if [ -s "${CACHE}" ]; then
        mtime=$(date -r "${CACHE}" +%s 2>/dev/null || echo 0)
        [ $((now - mtime)) -ge ${CACHE_TTL} ] && stale=1
    fi
    if [ ! -s "${CACHE}" ]; then
        # First-ever open — must fetch; bounded to 15s/one try so an unreachable
        # GitHub doesn't hang the LuCI "Loading view" spinner.
        wget -q --timeout=15 --tries=1 -O "${CACHE}" --header="User-Agent: luci-app-xray" "${GH_API}" || {
            rm -f "${CACHE}"
            echo '{"error":"github fetch failed","tags":[]}'; return 1;
        }
    elif [ "${stale}" = 1 ]; then
        # Stale cache — serve it now, refresh in background via atomic tmp+mv.
        ( wget -q --timeout=15 --tries=1 -O "${CACHE}.tmp" --header="User-Agent: luci-app-xray" "${GH_API}" \
            && mv "${CACHE}.tmp" "${CACHE}" || rm -f "${CACHE}.tmp" ) >/dev/null 2>&1 &
    fi
    arch=$(current_arch)
    asset=$(resolve_asset "${arch}")
    if command -v jq >/dev/null 2>&1; then
        tags=$(jq -c '[.[].tag_name]' "${CACHE}" 2>/dev/null)
    fi
    if [ -z "${tags}" ]; then
        tags=$(jsonfilter -i "${CACHE}" -e '@[*].tag_name' 2>/dev/null \
            | sed 's/.*/"&"/' | paste -sd, -)
        tags="[${tags}]"
    fi
    printf '{"current_arch":"%s","asset":"%s","tags":%s}\n' "${arch}" "${asset}" "${tags}"
}

resolve_latest_prerelease() {
    # Always refetch — postinst wants the freshest list, not a stale cache.
    rm -f "${CACHE}"
    wget -q --timeout=15 --tries=1 -O "${CACHE}" --header="User-Agent: luci-app-xray" "${GH_API}" || return 1
    jq -r 'map(select(.prerelease == true))[0].tag_name // empty' "${CACHE}" 2>/dev/null
}

install_release() {
    local tag="$1"
    [ -z "${tag}" ] && { echo "missing tag" >&2; return 2; }
    local arch asset url tmpdir
    arch=$(current_arch)
    asset=$(resolve_asset "${arch}")
    [ -z "${asset}" ] && { echo "unknown arch '${arch}', cannot map to XTLS asset" >&2; return 3; }
    if [ "${tag}" = "latest" ]; then
        url="https://github.com/XTLS/Xray-core/releases/latest/download/${asset}"
    elif [ "${tag}" = "latest-prerelease" ]; then
        tag=$(resolve_latest_prerelease)
        [ -z "${tag}" ] && { echo "no pre-release found on XTLS/Xray-core releases page" >&2; return 8; }
        echo "resolved latest-prerelease -> ${tag}"
        url="https://github.com/XTLS/Xray-core/releases/download/${tag}/${asset}"
    else
        url="https://github.com/XTLS/Xray-core/releases/download/${tag}/${asset}"
    fi
    tmpdir=$(mktemp -d)
    # Staged progress lines + wget dots (no -q) so UI polling sees steady movement.
    echo "[$(date +%T)] downloading ${url}"
    wget -O "${tmpdir}/xray.zip" --max-redirect=5 --header="User-Agent: luci-app-xray" "${url}" 2>&1 \
        || { echo "[$(date +%T)] download failed" >&2; rm -rf "${tmpdir}"; return 4; }
    [ -s "${tmpdir}/xray.zip" ] || { echo "[$(date +%T)] downloaded file is empty" >&2; rm -rf "${tmpdir}"; return 4; }
    zsize=$(wc -c <"${tmpdir}/xray.zip" 2>/dev/null)
    echo "[$(date +%T)] downloaded ${zsize} bytes, extracting xray only..."
    # Stream just the xray binary out of the zip; skip geoip.dat/geosite.dat
    # because extracting them into tmpfs OOM-kills unzip on low-RAM devices
    mkdir -p "$(dirname "${DEST}")"
    unzip -p "${tmpdir}/xray.zip" xray > "${DEST}.new" 2>/dev/null
    rm -rf "${tmpdir}"
    [ -s "${DEST}.new" ] || { echo "[$(date +%T)] unzip failed or archive has no xray binary" >&2; rm -f "${DEST}.new"; return 5; }
    chmod +x "${DEST}.new"
    mv "${DEST}.new" "${DEST}" \
        || { echo "[$(date +%T)] install failed (mv)" >&2; rm -f "${DEST}.new"; return 7; }
    uci -q set "xray_core.@general[0].xray_bin=${DEST}"
    uci -q commit xray_core
    echo "[$(date +%T)] restarting xray_core..."
    /etc/init.d/xray_core restart >/dev/null 2>&1
    echo "[$(date +%T)] installed ${tag} as ${DEST}"
    return 0
}

case "$1" in
    list)    list_releases ;;
    install) shift; install_release "$1" ;;
    *)       echo "usage: $0 list|install <tag>" >&2; exit 2 ;;
esac
