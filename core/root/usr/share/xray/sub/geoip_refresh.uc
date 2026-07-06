#!/usr/bin/ucode
// Pre-warm the geoip cache once, sequentially, before reload — otherwise the
// parse spike stacks on xray start-up and OOMs small routers.
"use strict";

import * as g from "../feature/geoip.mjs";

const ok = g.refresh_cache();
printf("geoip cache refresh: %s\n", ok ? "ok" : "skipped");
exit(ok ? 0 : 1);
