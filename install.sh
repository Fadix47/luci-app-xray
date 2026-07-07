#!/bin/sh
# shellcheck shell=dash

REPO="https://api.github.com/repos/Fadix47/luci-app-xray/releases/latest"
DOWNLOAD_DIR="/tmp/luci-app-xray"
COUNT=3

# Packages to install
PACKAGES="luci-app-xray"

# Cached flag to switch between ipk or apk package managers
PKG_IS_APK=0
command -v apk >/dev/null 2>&1 && PKG_IS_APK=1

rm -rf "$DOWNLOAD_DIR"
mkdir -p "$DOWNLOAD_DIR"

msg() {
    printf "\033[1;38;2;252;0;70m%s\033[0m\n" "$1"
}

pkg_list_update() {
    if [ "$PKG_IS_APK" -eq 1 ]; then
        apk update
    else
        opkg update
    fi
}

pkg_install() {
    local pkg_file="$1"

    if [ "$PKG_IS_APK" -eq 1 ]; then
        apk add --allow-untrusted "$pkg_file"
    else
        opkg install "$pkg_file"
    fi
}

main() {
    check_system

    /usr/sbin/ntpd -q -p 194.190.168.1 -p 216.239.35.0 -p 216.239.35.4 -p 162.159.200.1 -p 162.159.200.123

    pkg_list_update || { echo "Packages list update failed"; exit 1; }

    # Remember whether this is an upgrade so we can restart the service afterwards.
    # On a fresh install postinst starts xray itself (via core_install.sh); on an
    # upgrade that step is skipped, so the running process keeps the old code.
    IS_UPGRADE=0
    if [ -f "/etc/init.d/xray_core" ]; then
        IS_UPGRADE=1
        msg "luci-app-xray is already installed. Upgrading..."
    else
        msg "Installing luci-app-xray..."
    fi

    if command -v curl >/dev/null 2>&1; then
        check_response=$(curl -s "$REPO")

        if echo "$check_response" | grep -q 'API rate limit '; then
            msg "You've reached the GitHub rate limit. Repeat in five minutes."
            exit 1
        fi
    fi

    local grep_url_pattern
    if [ "$PKG_IS_APK" -eq 1 ]; then
        grep_url_pattern='https://[^"[:space:]]*\.apk'
    else
        grep_url_pattern='https://[^"[:space:]]*\.ipk'
    fi

    wget -qO- "$REPO" | grep -o "$grep_url_pattern" | while read -r url; do
        filename=$(basename "$url")
        filepath="$DOWNLOAD_DIR/$filename"

        attempt=0
        while [ $attempt -lt $COUNT ]; do
            msg "Download $filename (count $((attempt+1)))..."
            if wget -q -O "$filepath" "$url"; then
                if [ -s "$filepath" ]; then
                    msg "$filename successfully downloaded"
                    break
                fi
            fi
            msg "Download error for $filename. Retrying..."
            rm -f "$filepath"
            attempt=$((attempt+1))
        done

        if [ $attempt -eq $COUNT ]; then
            msg "Failed to download $filename after $COUNT attempts"
        fi
    done

    # Check if any files were downloaded
    if ! ls "$DOWNLOAD_DIR"/luci-app-xray* >/dev/null 2>&1; then
        msg "No packages were downloaded successfully"
        exit 1
    fi

    for pkg in $PACKAGES; do
        file=""
        for f in "$DOWNLOAD_DIR"/"$pkg"_*; do
            if [ -f "$f" ]; then
                file=$(basename "$f")
                break
            fi
        done
        if [ -n "$file" ]; then
            msg "Installing $file..."
            pkg_install "$DOWNLOAD_DIR/$file"
            sleep 3
        fi
    done

    find "$DOWNLOAD_DIR" -type f -name 'luci-app-xray*' -exec rm {} \;

    # postinst does not restart xray on upgrade, so activate the new code now.
    if [ "$IS_UPGRADE" -eq 1 ] && [ -x /etc/init.d/xray_core ]; then
        msg "Restarting xray_core to apply the update..."
        /etc/init.d/xray_core restart >/dev/null 2>&1
    fi

    msg "Done. Open LuCI → Services → Xray to configure."
}

check_system() {
    # Get router model
    MODEL=$(cat /tmp/sysinfo/model)
    msg "Router model: $MODEL"

    # Check OpenWrt version. Supported: 23.05 and newer.
    openwrt_version=$(cat /etc/openwrt_release | grep DISTRIB_RELEASE | cut -d"'" -f2 | cut -d'.' -f1)
    if [ -n "$openwrt_version" ] && [ "$openwrt_version" -lt 23 ] 2>/dev/null; then
        msg "OpenWrt $openwrt_version не поддерживается. Требуется OpenWrt 23.05 или новее."
        msg "OpenWrt $openwrt_version is not supported. OpenWrt 23.05 or newer is required."
        exit 1
    fi

    # Check available space on flash. postinst pulls the Xray core binary
    # (~40MB) into /usr/local/bin and the geoip/geosite data (~12MB) into /usr/share/xray
    AVAILABLE_SPACE=$(df /overlay | awk 'NR==2 {print $4}')
    REQUIRED_SPACE=49152 # 48MB in KB

    if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
        msg "Error: Insufficient space in flash"
        msg "Available: $((AVAILABLE_SPACE/1024))MB"
        msg "Required: $((REQUIRED_SPACE/1024))MB"
        exit 1
    fi

    if ! nslookup google.com >/dev/null 2>&1; then
        msg "DNS is not working."
        exit 1
    fi
}

main
