# luci-app-xray

This is a fork of https://github.com/yichya/luci-app-xray with subscription module, customizable X-ray core, geofiles and some other useful features

## Fast installation / update
```
sh <(wget -O - https://raw.githubusercontent.com/Fadix47/luci-app-xray/refs/heads/master/install.sh)
```

## Warnings

* For security concerns, global SOCKS / HTTP inbound (listen on 0.0.0.0, port 1080 / 1081 by default) is deprecated.
    * Use Extra Inbound to manually add ports (avoid using common ports like 1080, also set listen addresses carefully) and adjust related workloads to use that.
* This project **DOES NOT SUPPORT** the following versions of OpenWrt because of the requirements of firewall4 and cilent-side rendering LuCI:
    * LEDE / OpenWrt prior to 22.03
    * [Lean's OpenWrt Source](https://github.com/coolsnowwolf/lede) (which uses a variant of LuCI shipped with OpenWrt 18.06)
    If this is your case, use Passwall or similar projects instead (you could find links in [XTLS/Xray-core](https://github.com/XTLS/Xray-core/)).
* About experimental REALITY support
    * it may change quite frequently (before the release of official documents about the protocol). Keep in mind for (maybe) breaking changes.
* This project may change its code structure, configuration files format, user interface or dependencies quite frequently since it is still in its very early stage.
