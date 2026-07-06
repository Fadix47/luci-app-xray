#!/bin/sh
# ping.sh <sub_id> [method=head|get|tcp] [target_url]
# Wraps ping_batch.sh to ping one server and emit the unwrapped result object.

SID="$1"
METHOD="${2:-head}"
TARGET="${3:-http://www.gstatic.com/generate_204}"

[ -z "${SID}" ] && { printf '{"ok":false,"error":"missing sub_id","method":"%s"}\n' "${METHOD}"; exit 2; }

OUT=$(/usr/share/xray/sub/ping_batch.sh "${METHOD}" "${TARGET}" "${SID}")
# Strip the outer [ ... ] so callers that expect a single object still get one.
printf '%s\n' "${OUT}" | sed -e 's/^\[//' -e 's/\]$//'
exit 0
