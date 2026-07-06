'use strict';
'require form';
'require fs';
'require network';
'require rpc';
'require tools.widgets as widgets';
'require ui';
'require uci';
'require view';
'require view.xray.protocol as protocol';
'require view.xray.shared as shared';
'require view.xray.transport as transport';

const callSubFetch       = rpc.declare({ object: 'xray', method: 'subscription_fetch',     params: ['sub_id'], expect: { '': {} } });
const callSubFetchAll    = rpc.declare({ object: 'xray', method: 'subscription_fetch_all', expect: { '': {} } });
const callSubAdd         = rpc.declare({ object: 'xray', method: 'subscription_add',       params: ['url'], expect: { '': {} } });
const callImportLinks    = rpc.declare({ object: 'xray', method: 'import_links',           params: ['text'], expect: { '': {} } });
const callServiceStart   = rpc.declare({ object: 'xray', method: 'service_start',          expect: { '': {} } });
const callServiceStop    = rpc.declare({ object: 'xray', method: 'service_stop',           expect: { '': {} } });
const callServiceRestart = rpc.declare({ object: 'xray', method: 'service_restart',        expect: { '': {} } });
const callServiceReload  = rpc.declare({ object: 'xray', method: 'service_reload',         expect: { '': {} } });
const callServiceStatus  = rpc.declare({ object: 'xray', method: 'service_status',         expect: { '': {} } });
const callServiceEnable  = rpc.declare({ object: 'xray', method: 'service_enable',         expect: { '': {} } });
const callServiceDisable = rpc.declare({ object: 'xray', method: 'service_disable',        expect: { '': {} } });
const callServiceEnabled = rpc.declare({ object: 'xray', method: 'service_enabled',        expect: { '': {} } });
const callCoreList       = rpc.declare({ object: 'xray', method: 'core_list_releases',    expect: { '': {} } });
const callCoreInstall       = rpc.declare({ object: 'xray', method: 'core_install',          params: ['tag'], expect: { '': {} } });
const callCoreInstallStatus = rpc.declare({ object: 'xray', method: 'core_install_status',   expect: { '': {} } });
const callCoreVersion       = rpc.declare({ object: 'xray', method: 'core_current_version',  expect: { '': {} } });
const callGeoUpdate      = rpc.declare({ object: 'xray', method: 'geo_update_now',         expect: { '': {} } });
const callGeoStatus      = rpc.declare({ object: 'xray', method: 'geo_status',             expect: { '': {} } });
const callPubListUpdate  = rpc.declare({ object: 'xray', method: 'public_list_update_now', params: ['sid'], expect: { '': {} } });
const callPubListStatus  = rpc.declare({ object: 'xray', method: 'public_list_status',     expect: { '': {} } });
const callCatalogList    = rpc.declare({ object: 'xray', method: 'community_catalog_list', expect: { '': {} } });
const callCatalogRefresh = rpc.declare({ object: 'xray', method: 'community_catalog_refresh', expect: { '': {} } });
const callPing           = rpc.declare({ object: 'xray', method: 'ping_server',            params: ['sub_id', 'method', 'target'], expect: { '': {} } });
const callPingAll        = rpc.declare({ object: 'xray', method: 'ping_all',                params: ['method', 'target', 'sids'], expect: { 'results': [] } });

function notify(success, msg) {
    ui.addNotification(null, E('p', {}, msg), success ? 'info' : 'danger');
}

function fmtTimestamp(v) {
    if (!v) return '-';
    const n = parseInt(v, 10);
    if (isNaN(n)) return v;
    return new Date(n * 1000).toLocaleString();
}

function server_alias(v) {
    return v.alias || v.server + ":" + v.server_port;
}

function list_folded_format(config_data, k, noun, max_chars, mapping, empty) {
    return function (s) {
        const null_mapping = v => v;
        const records = (uci.get(config_data, s, k) || []).map(mapping || null_mapping);
        if (records.length == 0) {
            return empty || "-";
        }

        const max_items = function () {
            for (const i in records) {
                const pos = parseInt(i);
                if (records.slice(0, pos + 1).join(", ").length > max_chars) {
                    return pos;
                }
            }
            return records.length;
        }() || 1;

        if (records.length <= max_items) {
            return records.join(", ");
        }
        return E([], [
            records.slice(0, max_items).join(", "),
            ", ... ",
            shared.badge(`+<strong>${records.length - max_items}</strong>`, `${records.length} ${noun}\n${records.join("\n")}`)
        ]);
    };
}

function destination_format(config_data, k, e, max_chars) {
    return function (s) {
        if (e) {
            if (!uci.get(config_data, s, e)) {
                return `<i>${_("use global settings")}</i>`;
            }
        }
        return list_folded_format(config_data, k, "outbounds", max_chars, v => uci.get(config_data, v, "alias"), `<i>${_("direct")}</i>`)(s);
    };
}

function extra_outbound_format(config_data, s, select_item) {
    const inbound_addr = uci.get(config_data, s, "inbound_addr") || "";
    const inbound_port = uci.get(config_data, s, "inbound_port") || "";
    if (inbound_addr == "" && inbound_port == "") {
        return "-";
    }
    const destination = (uci.get(config_data, s, "destination") || []).map(x => server_alias(uci.get(config_data, x)));
    if (select_item) {
        if (destination.length == 0) {
            return `${inbound_addr}:${inbound_port} [direct]`;
        }
        return `${inbound_addr}:${inbound_port} (${destination.join(", ")})`;
    }
    return E([], [
        `${inbound_addr}:${inbound_port} `,
        function () {
            if (destination.length == 0) {
                return shared.badge("<strong>...</strong>", "direct");
            }
            return shared.badge("<strong>...</strong>", `${destination.length} outbounds\n${destination.join("\n")}`);
        }()
    ]);
}

function access_control_format(config_data, s, t) {
    return function (v) {
        switch (uci.get(config_data, v, s)) {
            case "tproxy": {
                return _("Enable tproxy");
            }
            case "bypass": {
                return _("Disable tproxy");
            }
        }
        return extra_outbound_format(config_data, uci.get(config_data, v, t), false);
    };
}

function check_resource_files(load_result) {
    let geoip_existence = false;
    let geoip_size = 0;
    let geosite_existence = false;
    let geosite_size = 0;
    let xray_bin_default = false;
    let xray_running = false;
    for (const f of load_result) {
        if (f.name == "xray") {
            xray_bin_default = true;
        }
        if (f.name == "xray.pid") {
            xray_running = true;
        }
        if (f.name == "geoip.dat") {
            geoip_existence = true;
            geoip_size = '%.2mB'.format(f.size);
        }
        if (f.name == "geosite.dat") {
            geosite_existence = true;
            geosite_size = '%.2mB'.format(f.size);
        }
    }
    return {
        geoip_existence: geoip_existence,
        geoip_size: geoip_size,
        geosite_existence: geosite_existence,
        geosite_size: geosite_size,
        xray_bin_default: xray_bin_default,
        xray_running: xray_running,
    };
}

return view.extend({
    load: function () {
        return Promise.all([
            uci.load(shared.variant),
            fs.list("/usr/share/xray"),
            network.getHostHints(),
            callServiceStatus().catch(() => ({ running: 'unknown' })),
            callServiceEnabled().catch(() => ({ enabled: false })),
            callCoreVersion().catch(() => ({ version: '?', path: '?' })),
            callCoreList().catch(() => ({ tags: [], asset: '', current_arch: '?' })),
            callGeoStatus().catch(() => ({ geoip: {size:0,mtime:0}, geosite: {size:0,mtime:0} })),
            callPubListStatus().catch(() => ({ items: {}, last_updated: 0, catalog_updated: 0 })),
            // Cached snapshot only — no GitHub fetch here, or an unreachable
            // GitHub would block the "Loading view" spinner for 15s+.
            callCatalogList().catch(() => ({ items: [], last_updated: 0 })),
        ]);
    },

    render: function (load_result) {
        const config_data = load_result[0];
        const { geoip_existence, geoip_size, geosite_existence, geosite_size, xray_bin_default, xray_running } = check_resource_files(load_result[1]);
        const status_text = xray_running ? _("[Xray is running]") : _("[Xray is stopped]");
        const hosts = load_result[2].hosts;
        const svcStatus  = load_result[3];
        const svcEnabled = load_result[4];
        const coreVer    = load_result[5];
        const coreList   = load_result[6];
        const geoStat    = load_result[7];
        const pubListStat = load_result[8] || { items: {}, last_updated: 0, catalog_updated: 0 };
        const catalog     = load_result[9] || { items: [], last_updated: 0 };

        let asset_file_status = _('WARNING: at least one of asset files (geoip.dat, geosite.dat) is not found under /usr/share/xray. Xray may not work properly. See <a href="https://github.com/Fadix47/luci-app-xray">here</a> for help.');
        if (geoip_existence) {
            if (geosite_existence) {
                asset_file_status = _('Asset files check: ') + `geoip.dat ${geoip_size}; geosite.dat ${geosite_size}. ` + _('Report issues or request for features <a href="https://github.com/Fadix47/luci-app-xray">here</a>.');
            }
        }
        const firewall_mark = uci.get_first(shared.variant, "general", "mark") || '255';
        const m = new form.Map(shared.variant, _('Xray'), status_text + " " + asset_file_status);

        let s, o, ss;

        // ===== Service Control panel (always at the top) =====
        let sCtl = m.section(form.TypedSection, 'general', _('Service control'));
        sCtl.anonymous = true;
        sCtl.addremove = false;

        let oCtlStatus = sCtl.option(form.DummyValue, '_ctl_status', _('Status'));
        oCtlStatus.cfgvalue = function () {
            const running = svcStatus && svcStatus.running === 'running';
            const label   = running ? _('running') : (svcStatus && svcStatus.running) || _('unknown');
            const color   = running ? '#3c763d' : '#a94442';
            const enabled = svcEnabled && svcEnabled.enabled;
            return E([], [
                E('span', { 'style': 'color:' + color + ';font-weight:bold;' }, '● ' + label),
                ' | ',
                E('span', {}, _('autostart: ') + (enabled ? _('on') : _('off'))),
                ' | ',
                E('span', {}, _('binary: ') + ((coreVer && coreVer.path) || '?')),
                ' ',
                E('span', { 'style': 'color:#777;' }, '(' + (((coreVer && coreVer.version) || '').split('\n')[0] || '?') + ')'),
            ]);
        };

        // Inline buttons in one DummyValue cell — form.Button would stack them.
        let oCtlActions = sCtl.option(form.DummyValue, '_ctl_actions', _('Actions'));
        oCtlActions.cfgvalue = function () {
            // Inject spinner keyframes once. Guard prevents stacking duplicates on re-render.
            if (!document.getElementById('xray-svc-btn-style')) {
                const st = document.createElement('style');
                st.id = 'xray-svc-btn-style';
                st.textContent =
                    '@keyframes xray-svc-spin{to{transform:rotate(360deg)}}' +
                    '.xray-svc-btn-loading{pointer-events:none;opacity:.75;position:relative;padding-left:1.9em!important}' +
                    '.xray-svc-btn-loading::before{' +
                    'content:"";position:absolute;left:.6em;top:50%;width:.9em;height:.9em;' +
                    'margin-top:-.45em;border:2px solid currentColor;border-top-color:transparent;' +
                    'border-radius:50%;animation:xray-svc-spin .7s linear infinite;box-sizing:border-box}' +
                    '.xray-svc-btn-row button[disabled]{cursor:not-allowed;opacity:.55}';
                document.head.appendChild(st);
            }

            function mkBtn(label, fn, style) {
                const btn = E('button', {
                    'class': 'btn cbi-button cbi-button-' + (style || 'apply')
                }, label);
                btn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    if (btn.disabled) return;
                    const siblings = btn.parentElement
                        ? btn.parentElement.querySelectorAll('button') : [btn];
                    siblings.forEach(function (s) { s.disabled = true; });
                    btn.classList.add('xray-svc-btn-loading');
                    return fn().then(function (r) {
                        notify(r && r.code === 0, label + ': ' + (r && r.code === 0 ? _('ok') : _('failed')));
                        return window.location.reload();
                    }, function (e) {
                        notify(false, _('RPC error: ') + e);
                        btn.classList.remove('xray-svc-btn-loading');
                        siblings.forEach(function (s) { s.disabled = false; });
                    });
                });
                return btn;
            }
            return E('span', { 'class': 'xray-svc-btn-row', 'style': 'display:inline-flex;gap:0.4em;flex-wrap:wrap;align-items:center' }, [
                mkBtn(_('Start'),   callServiceStart),
                mkBtn(_('Stop'),    callServiceStop, 'remove'),
                mkBtn(_('Restart'), callServiceRestart),
                mkBtn(_('Reload'),  callServiceReload)
            ]);
        };

        let oCtlBoot = sCtl.option(form.Flag, '_ctl_boot', _('Enable on boot'));
        oCtlBoot.cfgvalue = function () { return (svcEnabled && svcEnabled.enabled) ? '1' : '0'; };
        oCtlBoot.write = function (_section_id, value) {
            // LuCI calls write() on every save regardless of change — bail
            // out if state matches to avoid spurious "Boot toggle" notifications.
            const wanted = value === '1';
            const current = !!(svcEnabled && svcEnabled.enabled);
            if (wanted === current) return Promise.resolve();
            return (wanted ? callServiceEnable() : callServiceDisable())
                .then(function (r) {
                    if (!(r && r.code === 0)) notify(false, _('Boot toggle failed'));
                });
        };

        // ===== Main settings =====
        s = m.section(form.TypedSection, 'general');
        s.addremove = false;
        s.anonymous = true;

        // Tab order is fixed by the order of these s.tab() calls. The taboption()
        // calls scattered through the rest of the file just reference the tab id.
        s.tab('general',                    _('General Settings'));
        s.tab('subscriptions',              _('Subscriptions'));
        s.tab('outbound_routing',           _('Routing'));
        s.tab('geo_files',                  _('Geo Files'));
        s.tab('core_install',               _('Core Version'));
        s.tab('inbounds',                   _('Inbounds'));
        s.tab('lan_hosts_access_control',   _('LAN Control'));
        s.tab('dns',                        _('DNS Servers'));
        s.tab('fake_dns',                   _('FakeDNS'));
        s.tab('extra_options',              _('Extra Options'));

        o = s.taboption('general', form.Flag, 'transparent_proxy_enable', _('Enable Transparent Proxy'), _('Enable integrations with dnsmasq and nftables. To disable luci-app-xray completely, go to <a href="/cgi-bin/luci/admin/system/startup">Startup</a> and disable <code>xray_core</code>.'));

        // Unified picker mirrored into all four TCP/UDP × IPv4/IPv6 UCI keys on save,
        // since the backend still reads them separately.
        let balancer_servers = s.taboption('general', form.MultiValue, 'balancer_servers',
            _('Servers'),
            _('Select one or more outbound servers. Selection applies to TCP and UDP over IPv4 and IPv6. Leave empty to disable outbound.'));
        balancer_servers.datatype = 'uciname';
        balancer_servers.cfgvalue = function (section_id) {
            const merged = {};
            for (const k of ['tcp_balancer_v4', 'udp_balancer_v4', 'tcp_balancer_v6', 'udp_balancer_v6']) {
                const v = uci.get(shared.variant, section_id, k);
                if (Array.isArray(v)) v.forEach(x => { if (x) merged[x] = true; });
                else if (typeof v === 'string' && v) merged[v] = true;
            }
            return Object.keys(merged);
        };
        balancer_servers.write = function (section_id, value) {
            const arr = Array.isArray(value) ? value : (value ? [value] : []);
            for (const k of ['tcp_balancer_v4', 'udp_balancer_v4', 'tcp_balancer_v6', 'udp_balancer_v6']) {
                uci.set(shared.variant, section_id, k, arr);
            }
        };
        balancer_servers.remove = function (section_id) {
            for (const k of ['tcp_balancer_v4', 'udp_balancer_v4', 'tcp_balancer_v6', 'udp_balancer_v6']) {
                uci.unset(shared.variant, section_id, k);
            }
        };

        let general_balancer_strategy = s.taboption('general', form.Value, 'general_balancer_strategy', _('Balancer Strategy'), _('Strategy <code>leastPing</code> requires Observatory (see "Extra Options" tab).'));
        general_balancer_strategy.value("random");
        general_balancer_strategy.value("leastPing");
        general_balancer_strategy.value("roundRobin");
        general_balancer_strategy.default = "random";
        general_balancer_strategy.rmempty = false;

        let oPingAllMethod = s.taboption('general', form.ListValue, 'ping_all_method', _('Ping method'),
            _('Used by both the per-server Ping button and the Ping all button below. HEAD/GET tunnel through a temporary Xray instance to the target URL and measure the real round-trip latency through the outbound.'));
        oPingAllMethod.value('head', _('HTTP HEAD via tunnel (default)'));
        oPingAllMethod.value('get',  _('HTTP GET via tunnel'));
        oPingAllMethod.default = 'head';

        let oPingAllTarget = s.taboption('general', form.Value, 'ping_all_target', _('Ping target URL'),
            _('Default <code>http://www.gstatic.com/generate_204</code> returns HTTP 204 No Content. Override with any URL that responds quickly through the proxy.'));
        oPingAllTarget.placeholder = 'http://www.gstatic.com/generate_204';

        let oPingAllBtn = s.taboption('general', form.Button, '_ping_all_btn', _('Ping all servers'),
            _('Tests every server in the list. Servers are pinged in batches of 5 — results stream into the table below as each batch finishes, so the whole sweep never blocks on a single XHR.'));
        oPingAllBtn.inputtitle = _('Ping all');
        oPingAllBtn.inputstyle = 'apply';
        oPingAllBtn.onclick = function (_ev, section_id) {
            let method = this.section.formvalue(section_id, 'ping_all_method')
                || uci.get(shared.variant, section_id, 'ping_all_method') || 'head';
            if (method === 'tcp') method = 'head';   // TCP ping removed; fall back
            const target = this.section.formvalue(section_id, 'ping_all_target')
                || uci.get(shared.variant, section_id, 'ping_all_target')
                || 'http://www.gstatic.com/generate_204';

            const allSids = uci.sections(shared.variant, 'servers').map(s => s['.name']);
            if (allSids.length === 0) {
                notify(false, _('No servers configured.'));
                return;
            }

            const aliasOf = sid => {
                const sec = uci.get(shared.variant, sid) || {};
                return sec.alias || sec.server || sid;
            };
            const rowFor = r => E('tr', {}, [
                E('td', {}, aliasOf(r.sub_id)),
                E('td', {}, (r.method || method || '').toUpperCase()),
                E('td', { style: 'text-align:right;font-family:monospace' }, r.ok ? (r.latency_ms + ' ms') : '—'),
                E('td', {}, r.ok
                    ? E('span', { style: 'color:#3c763d' }, '✔ ' + (r.note ? r.note : 'ok'))
                    : E('span', { style: 'color:#a94442' }, '✘ ' + (r.error || 'failed')))
            ]);

            const tbody = E('tbody', {});
            const counter = E('strong', {}, '0');
            const total = E('span', {}, String(allSids.length));
            const spinner = E('span', { 'class': 'spinning' }, ' ');
            const cancelBtn = E('button', { 'class': 'btn' }, _('Stop'));
            let cancelled = false;
            cancelBtn.addEventListener('click', function () {
                cancelled = true;
                ui.hideModal();
            });

            ui.showModal(_('Ping results — ') + method.toUpperCase(), [
                E('p', {}, [spinner, ' ', counter, ' / ', total, ' ', _('done')]),
                E('table', { 'class': 'table', style: 'width:100%' }, [
                    E('thead', {}, E('tr', {}, [
                        E('th', {}, _('Server')),
                        E('th', {}, _('Method')),
                        E('th', { style: 'text-align:right' }, _('Latency')),
                        E('th', {}, _('Status'))
                    ])),
                    tbody
                ]),
                E('div', { 'class': 'right' }, cancelBtn)
            ]);

            const BATCH = 5;
            let done = 0;
            const setDone = () => { counter.firstChild.data = String(done); };

            const runBatch = idx => {
                if (cancelled) return;
                if (idx >= allSids.length) {
                    spinner.classList.remove('spinning');
                    spinner.firstChild.data = '✓';
                    cancelBtn.firstChild.data = _('Close');
                    return;
                }
                const slice = allSids.slice(idx, idx + BATCH);
                return callPingAll(method, target, slice).then(function (r) {
                    if (cancelled) return;
                    let rows = [];
                    if (Array.isArray(r)) rows = r;
                    else if (r && Array.isArray(r.results)) rows = r.results;
                    // RPC may return results out of order — resort by input slice.
                    const ix = {};
                    slice.forEach((sid, i) => ix[sid] = i);
                    rows.sort((a, b) => (ix[a.sub_id] ?? 0) - (ix[b.sub_id] ?? 0));
                    const seen = {};
                    for (const row of rows) {
                        tbody.appendChild(rowFor(row));
                        seen[row.sub_id] = true;
                        done++;
                    }
                    // Anything in the slice that didn't come back gets a
                    // placeholder row so the counter never lies.
                    for (const sid of slice) {
                        if (!seen[sid]) {
                            tbody.appendChild(rowFor({ sub_id: sid, ok: false, error: 'no result' }));
                            done++;
                        }
                    }
                    setDone();
                    return runBatch(idx + BATCH);
                }, function (e) {
                    if (cancelled) return;
                    for (const sid of slice) {
                        tbody.appendChild(rowFor({ sub_id: sid, ok: false, error: 'RPC: ' + e }));
                        done++;
                    }
                    setDone();
                    return runBatch(idx + BATCH);
                });
            };

            runBatch(0);
        };

        // Quick-import: paste one or more share links (vless:// or hysteria2://,
        // also vmess/trojan/ss/socks/http) and create standalone manual servers.
        let oImportLinks = s.taboption('general', form.Button, '_import_links',
            _('Add server from link'),
            _('Paste one or more share links (<code>vless://</code>, <code>hysteria2://</code>, …). Each is parsed into a standalone server in the list below.'));
        oImportLinks.inputtitle = _('+ Add from link');
        oImportLinks.inputstyle = 'add';
        oImportLinks.onclick = function () {
            const ta = E('textarea', {
                'style': 'width:100%;min-height:9em;font-family:monospace',
                'placeholder': 'vless://...\nhysteria2://...'
            });
            ui.showModal(_('Add server from link'), [
                E('p', {}, _('Paste one link per line:')),
                ta,
                E('div', { class: 'right' }, [
                    E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
                    ' ',
                    E('button', {
                        class: 'cbi-button cbi-button-action',
                        click: ui.createHandlerFn(this, function () {
                            const text = (ta.value || '').trim();
                            if (!text) {
                                ui.addNotification(null, E('p', _('No links entered.')), 'warning');
                                return;
                            }
                            ui.showModal(_('Importing'), [E('p', { class: 'spinning' }, _('Parsing links and creating servers...'))]);
                            return callImportLinks(text).then(function (r) {
                                ui.hideModal();
                                r = r || {};
                                if (r.code === 0 && r.added > 0) {
                                    ui.addNotification(null, E('p', _('Imported %d server(s). Reloading...').format(r.added)), 'info');
                                    window.setTimeout(function () { location.reload(); }, 900);
                                } else if (r.code === 2) {
                                    ui.addNotification(null, E('p', _('No valid links were parsed. Check the link format.')), 'warning');
                                } else if (r.code === 3) {
                                    ui.addNotification(null, [
                                        E('p', _('Parsed %d link(s) but failed to write servers.').format(r.parsed || 0)),
                                        r.log ? E('pre', { style: 'white-space:pre-wrap;font-size:0.85em' }, r.log) : ''
                                    ], 'error');
                                } else {
                                    ui.addNotification(null, E('p', _('Import failed: ') + ((r && r.error) || _('unknown error'))), 'error');
                                }
                            }).catch(function (e) {
                                ui.hideModal();
                                ui.addNotification(null, E('p', _('Import failed: ') + e.message), 'error');
                            });
                        }),
                    }, _('Add'))
                ])
            ]);
        };

        o = s.taboption('general', form.SectionValue, "xray_servers", form.GridSection, 'servers', _('Xray Servers'), _("Servers are referenced by index (order in the following list). Deleting servers may result in changes of upstream servers actually used by proxy and bridge."));
        ss = o.subsection;
        ss.sortable = false;
        ss.anonymous = true;
        ss.addremove = true;

        ss.tab('general', _('General Settings'));
        ss.nodescriptions = true;

        o = ss.taboption('general', form.Value, "alias", _("Alias (optional)"));
        o.optional = true;

        o = ss.taboption('general', form.Value, 'server', _('Server Hostname'));
        o.datatype = 'host';
        o.rmempty = false;

        o = ss.taboption('general', form.DynamicList, 'server_port', _('Server Port'));
        o.datatype = 'port';
        o.rmempty = false;
        o.modalonly = true;

        o = ss.taboption('general', form.Value, 'username', _('Email / Username'), _('Optional; username for SOCKS / HTTP outbound, email for other outbound.'));
        o.modalonly = true;

        o = ss.taboption('general', form.Value, 'password', _('UserId / Password'), _('Fill user_id for vmess / VLESS, or password for other outbound (also supports <a href="https://github.com/XTLS/Xray-core/issues/158">Xray UUID Mapping</a>)'));
        o.rmempty = false;

        let oPingBtn = ss.option(form.Button, '_ping', _('Ping'));
        oPingBtn.modalonly = false;
        oPingBtn.editable = true;
        oPingBtn.inputtitle = _('Ping');
        oPingBtn.inputstyle = 'apply';
        oPingBtn.onclick = function (_ev, section_id) {
            let method = uci.get(shared.variant, '@general[0]', 'ping_all_method') || 'head';
            if (method === 'tcp') method = 'head';   // TCP ping removed; fall back
            const target = uci.get(shared.variant, '@general[0]', 'ping_all_target')
                || 'http://www.gstatic.com/generate_204';
            ui.showModal(_('Pinging'), [E('p', { 'class': 'spinning' }, _('Testing via ') + method.toUpperCase() + ' → ' + target + '...')]);
            return callPing(section_id, method, target).then(function (r) {
                ui.hideModal();
                r = r || {};
                const meth   = (r.method || method || '').toUpperCase();
                const where  = (r.host && r.port) ? (r.host + ':' + r.port) : '';
                const tgt    = r.target ? (' → ' + r.target) : '';
                const detail = where || tgt ? E('div', {}, where + tgt) : '';
                const note   = r.note ? E('div', { style: 'color:#999;font-size:0.9em;margin-top:0.5em' }, '(' + r.note + ')') : '';
                let body;
                if (r.ok) {
                    body = E('div', {}, [
                        E('div', { style: 'font-size:1.4em' }, [
                            E('strong', { style: 'color:#3c763d' }, '✔ ' + r.latency_ms + ' ms'),
                            ' ',
                            E('span', { style: 'color:#777;' }, _('via ') + meth)
                        ]),
                        detail,
                        note
                    ]);
                } else {
                    body = E('div', {}, [
                        E('div', { style: 'font-size:1.4em' }, [
                            E('strong', { style: 'color:#a94442' }, '✘ ' + (r.error || _('failed'))),
                            ' ',
                            E('span', { style: 'color:#777;' }, _('via ') + meth)
                        ]),
                        detail
                    ]);
                }
                ui.showModal(_('Ping result'), [
                    body,
                    E('div', { class: 'right' }, E('button', { class: 'btn', click: ui.hideModal }, _('Close')))
                ]);
            }, function (e) {
                ui.hideModal();
                notify(false, _('RPC error: ') + e);
            });
        };

        ss.tab('resolving', _("Server Hostname Resolving"));

        o = ss.taboption('resolving', form.ListValue, 'domain_strategy', _('Domain Strategy'), _("Whether to use IPv4 or IPv6 address if Server Hostname is a domain."));
        o.value("UseIP");
        o.value("UseIPv4");
        o.value("UseIPv6");
        o.default = "UseIP";
        o.modalonly = true;

        o = ss.taboption('resolving', form.Value, 'domain_resolve_dns', _('Resolve Domain via DNS'), _("Specify a DNS to resolve server hostname. Be careful of possible recursion."));
        o.datatype = "or(ipaddr, ipaddrport(1))";
        o.modalonly = true;

        o = ss.taboption('resolving', form.ListValue, 'domain_resolve_dns_method', _('Resolve Domain DNS Method'), _("Effective when DNS above is set. Direct methods will bypass Xray completely so it may get blocked."));
        o.value("udp", _("UDP"));
        o.value("tcp", _("TCP"));
        o.value("tcp+local", _("TCP (direct)"));
        o.value("https", _("DNS over HTTPS"));
        o.value("https+local", _("DNS over HTTPS (direct)"));
        o.default = "udp";
        o.modalonly = true;

        o = ss.taboption('resolving', form.DynamicList, 'domain_resolve_expect_ips', _('Expected Server IPs'), _("Filter resolved IPs by GeoIP or CIDR. Resource file <code>geoip.dat</code> is required for GeoIP filtering."));
        o.modalonly = true;

        ss.tab('protocol', _('Protocol Settings'));

        o = ss.taboption('protocol', form.ListValue, "protocol", _("Protocol"));
        protocol.add_client_protocol(o, ss, 'protocol');
        o.rmempty = false;

        ss.tab('transport', _('Transport Settings'));

        o = ss.taboption('transport', form.ListValue, 'transport', _('Transport'));
        transport.init(o, ss, 'transport');
        o.rmempty = false;
        // Hysteria2 rides QUIC/UDP — surface it as "udp" in the servers grid
        // column while keeping the underlying value ("hysteria") unchanged.
        // Transports are shown lowercase (tcp / xhttp / websocket / udp / …).
        o.textvalue = function (section_id) {
            const v = uci.get(config_data, section_id, 'transport') || 'tcp';
            if (v === 'hysteria') return 'udp';
            const i = (this.keylist || []).indexOf(v);
            const label = (i >= 0 && this.vallist) ? this.vallist[i] : v;
            return String(label).toLowerCase();
        };

        let dialer_proxy = ss.taboption('transport', form.ListValue, 'dialer_proxy', _('Dialer Proxy'), _('Similar to <a href="https://xtls.github.io/config/outbound.html#proxysettingsobject">ProxySettings.Tag</a>'));
        dialer_proxy.datatype = "uciname";
        dialer_proxy.value("disabled", _("Disabled"));
        dialer_proxy.modalonly = true;

        ss.tab('custom', _('Custom Options'));

        o = ss.taboption('custom', form.TextValue, 'custom_config', _('Custom Configurations'), _(`Configurations here override settings in the previous tabs with the following rules: <ul><li>Object values will be replaced recursively so settings in previous tabs matter.</li><li>Arrays will be replaced entirely instead of being merged.</li><li>Tag <code>tag</code> and mark <code>streamSettings.sockopt.mark</code> are ignored. </li></ul>Aliases are not handled while merging configurations:<ul><li>Use <code>tcpSettings</code> instead of <code>rawSettings</code>.</li></ul>Some transports like <code>xhttp</code> may use another <code>streamSettings.sockopt</code>: use <code>${firewall_mark}</code> as <code>sockopt.mark</code> to avoid loopback traffic. Override rules here may be changed later. Use this only for experimental or pre-release features.`));
        o.modalonly = true;
        o.monospace = true;
        o.rows = 12;
        o.validate = shared.validate_object;

        o = s.taboption('inbounds', form.Value, 'tproxy_port_tcp_v4', _('Transparent proxy port (TCP4)'));
        o.datatype = 'port';
        o.placeholder = 1082;

        o = s.taboption('inbounds', form.Value, 'tproxy_port_tcp_v6', _('Transparent proxy port (TCP6)'));
        o.datatype = 'port';
        o.placeholder = 1083;

        o = s.taboption('inbounds', form.Value, 'tproxy_port_udp_v4', _('Transparent proxy port (UDP4)'));
        o.datatype = 'port';
        o.placeholder = 1084;

        o = s.taboption('inbounds', form.Value, 'tproxy_port_udp_v6', _('Transparent proxy port (UDP6)'));
        o.datatype = 'port';
        o.placeholder = 1085;

        o = s.taboption('inbounds', form.DynamicList, 'uids_direct', _('Bypass tproxy for uids'), _("Processes started by users with these uids won't be forwarded through Xray."));
        o.datatype = "integer";

        o = s.taboption('inbounds', form.DynamicList, 'gids_direct', _('Bypass tproxy for gids'), _("Processes started by users in groups with these gids won't be forwarded through Xray."));
        o.datatype = "integer";

        let extra_inbounds = s.taboption('inbounds', form.SectionValue, "extra_inbound_section", form.GridSection, 'extra_inbound', _('Extra Inbounds'), _("Add more socks5 / http inbounds and redirect to other outbounds.")).subsection;
        extra_inbounds.sortable = false;
        extra_inbounds.anonymous = true;
        extra_inbounds.addremove = true;
        extra_inbounds.nodescriptions = true;

        let inbound_addr = extra_inbounds.option(form.Value, "inbound_addr", _("Listen Address"));
        inbound_addr.datatype = "ip4addr";

        let inbound_port = extra_inbounds.option(form.Value, "inbound_port", _("Listen Port"));
        inbound_port.datatype = "port";

        let inbound_type = extra_inbounds.option(form.ListValue, "inbound_type", _("Inbound Type"));
        inbound_type.value("socks5", _("Socks5 Proxy"));
        inbound_type.value("http", _("HTTP Proxy"));
        inbound_type.value("tproxy_tcp", _("Transparent Proxy (TCP)"));
        inbound_type.value("tproxy_udp", _("Transparent Proxy (UDP)"));
        inbound_type.rmempty = false;

        let inbound_username = extra_inbounds.option(form.Value, "inbound_username", _("Username (Optional)"));
        inbound_username.depends("inbound_type", "socks5");
        inbound_username.depends("inbound_type", "http");
        inbound_username.modalonly = true;

        let inbound_password = extra_inbounds.option(form.Value, "inbound_password", _("Password (Optional)"));
        inbound_password.depends("inbound_type", "socks5");
        inbound_password.depends("inbound_type", "http");
        inbound_password.modalonly = true;

        let specify_outbound = extra_inbounds.option(form.Flag, 'specify_outbound', _('Specify Outbound'), _('If not selected, this inbound will use global settings (including sniffing settings).'));
        specify_outbound.modalonly = true;

        let destination = extra_inbounds.option(form.MultiValue, 'destination', _('Destination'), _("Select multiple outbounds for load balancing. If none selected, requests will be sent via direct outbound."));
        destination.depends("specify_outbound", "1");
        destination.datatype = "uciname";
        destination.textvalue = destination_format(config_data, "destination", "specify_outbound", 60);

        let balancer_strategy = extra_inbounds.option(form.Value, 'balancer_strategy', _('Balancer Strategy'), _('Strategy <code>leastPing</code> requires Observatory (see "Extra Options" tab).'));
        balancer_strategy.depends("specify_outbound", "1");
        balancer_strategy.value("random");
        balancer_strategy.value("leastPing");
        balancer_strategy.value("roundRobin");
        balancer_strategy.default = "random";
        balancer_strategy.rmempty = false;
        balancer_strategy.modalonly = true;

        let tproxy_ifaces_v4 = s.taboption('lan_hosts_access_control', widgets.DeviceSelect, 'tproxy_ifaces_v4', _("Devices to enable IPv4 tproxy"), _("Enable IPv4 transparent proxy on these interfaces / network devices."));
        tproxy_ifaces_v4.noaliases = true;
        tproxy_ifaces_v4.nocreate = true;
        tproxy_ifaces_v4.multiple = true;

        let tproxy_ifaces_v6 = s.taboption('lan_hosts_access_control', widgets.DeviceSelect, 'tproxy_ifaces_v6', _("Devices to enable IPv6 tproxy"), _("Enable IPv6 transparent proxy on these interfaces / network devices."));
        tproxy_ifaces_v6.noaliases = true;
        tproxy_ifaces_v6.nocreate = true;
        tproxy_ifaces_v6.multiple = true;

        let bypass_ifaces_v4 = s.taboption('lan_hosts_access_control', widgets.DeviceSelect, 'bypass_ifaces_v4', _("Devices to disable IPv4 tproxy"), _("This overrides per-device settings below. FakeDNS and manual transparent proxy won't be affected by this option."));
        bypass_ifaces_v4.noaliases = true;
        bypass_ifaces_v4.nocreate = true;
        bypass_ifaces_v4.multiple = true;

        let bypass_ifaces_v6 = s.taboption('lan_hosts_access_control', widgets.DeviceSelect, 'bypass_ifaces_v6', _("Devices to disable IPv6 tproxy"), _("This overrides per-device settings below. FakeDNS and manual transparent proxy won't be affected by this option."));
        bypass_ifaces_v6.noaliases = true;
        bypass_ifaces_v6.nocreate = true;
        bypass_ifaces_v6.multiple = true;

        let lan_hosts = s.taboption('lan_hosts_access_control', form.SectionValue, "lan_hosts_section", form.GridSection, 'lan_hosts', _('LAN Hosts Access Control'), _("Per-device settings here override per-interface enabling settings above. FakeDNS and manual transparent proxy won't be affected by these options.")).subsection;
        lan_hosts.sortable = false;
        lan_hosts.anonymous = true;
        lan_hosts.addremove = true;

        let title = lan_hosts.option(form.DummyValue, "title", _("Alias / MAC Address"));
        title.modalonly = false;
        title.textvalue = function (s) {
            const item = uci.get(config_data, s);
            if (item.alias) {
                return E([], [item.alias, " ", shared.badge("<strong>...</strong>", item.macaddr)]);
            }
            return item.macaddr;
        };

        let alias = lan_hosts.option(form.Value, "alias", _("Alias (optional)"));
        alias.optional = true;
        alias.modalonly = true;

        let macaddr = lan_hosts.option(form.Value, "macaddr", _("MAC Address"));
        macaddr.datatype = "macaddr";
        macaddr.rmempty = false;
        macaddr.modalonly = true;
        L.sortedKeys(hosts).forEach(function (mac) {
            macaddr.value(mac, E([], [mac, ' (', E('strong', [hosts[mac].name || L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4)[0] || L.toArray(hosts[mac].ip6addrs || hosts[mac].ipv6)[0] || '?']), ')']));
        });

        let access_control_strategy_v4 = lan_hosts.option(form.ListValue, "access_control_strategy_v4", _("Access Control Strategy (IPv4)"));
        access_control_strategy_v4.value("tproxy", _("Enable transparent proxy"));
        access_control_strategy_v4.value("forward", _("Forward via extra inbound"));
        access_control_strategy_v4.value("bypass", _("Disable transparent proxy"));
        access_control_strategy_v4.modalonly = true;
        access_control_strategy_v4.rmempty = false;

        let access_control_forward_tcp_v4 = lan_hosts.option(form.ListValue, "access_control_forward_tcp_v4", _("Extra inbound (TCP4)"));
        access_control_forward_tcp_v4.depends("access_control_strategy_v4", "forward");
        access_control_forward_tcp_v4.textvalue = access_control_format(config_data, "access_control_strategy_v4", "access_control_forward_tcp_v4");

        let access_control_forward_udp_v4 = lan_hosts.option(form.ListValue, "access_control_forward_udp_v4", _("Extra inbound (UDP4)"));
        access_control_forward_udp_v4.depends("access_control_strategy_v4", "forward");
        access_control_forward_udp_v4.textvalue = access_control_format(config_data, "access_control_strategy_v4", "access_control_forward_udp_v4");

        let access_control_strategy_v6 = lan_hosts.option(form.ListValue, "access_control_strategy_v6", _("Access Control Strategy (IPv6)"));
        access_control_strategy_v6.value("tproxy", _("Enable transparent proxy"));
        access_control_strategy_v6.value("forward", _("Forward via extra inbound"));
        access_control_strategy_v6.value("bypass", _("Disable transparent proxy"));
        access_control_strategy_v6.modalonly = true;
        access_control_strategy_v6.rmempty = false;

        let access_control_forward_tcp_v6 = lan_hosts.option(form.ListValue, "access_control_forward_tcp_v6", _("Extra inbound (TCP6)"));
        access_control_forward_tcp_v6.depends("access_control_strategy_v6", "forward");
        access_control_forward_tcp_v6.textvalue = access_control_format(config_data, "access_control_strategy_v6", "access_control_forward_tcp_v6");

        let access_control_forward_udp_v6 = lan_hosts.option(form.ListValue, "access_control_forward_udp_v6", _("Extra inbound (UDP6)"));
        access_control_forward_udp_v6.depends("access_control_strategy_v6", "forward");
        access_control_forward_udp_v6.textvalue = access_control_format(config_data, "access_control_strategy_v6", "access_control_forward_udp_v6");

        for (const v of uci.sections(config_data, "extra_inbound")) {
            switch (v["inbound_type"]) {
                case "tproxy_tcp": {
                    access_control_forward_tcp_v4.value(v[".name"], extra_outbound_format(config_data, v[".name"], true));
                    access_control_forward_tcp_v6.value(v[".name"], extra_outbound_format(config_data, v[".name"], true));
                    break;
                }
                case "tproxy_udp": {
                    access_control_forward_udp_v4.value(v[".name"], extra_outbound_format(config_data, v[".name"], true));
                    access_control_forward_udp_v6.value(v[".name"], extra_outbound_format(config_data, v[".name"], true));
                    break;
                }
            }
        }

        o = s.taboption('dns', form.Value, 'fast_dns', _('Fast DNS'), _("DNS for resolving outbound domains and bypassed domains (Routing tab)."));
        o.datatype = 'or(ip4addr, ip4addrport)';
        o.placeholder = "8.8.8.8:53";

        o = s.taboption('dns', form.ListValue, 'fast_dns_method', _('Fast DNS Protocol'),
            _('Transport protocol for Fast DNS. UDP uses the port from the address (default 53); DoH uses TCP/443 with <code>/dns-query</code>; DoT uses TCP/853.'));
        o.value('udp', _('UDP'));
        o.value('https', _('DNS over HTTPS (DoH)'));
        o.value('tls', _('DNS over TLS (DoT)'));
        o.default = 'udp';

        o = s.taboption('dns', form.Value, 'secure_dns', _('Secure DNS'), _("DNS for resolving polluted/forwarded domains (Routing tab)."));
        o.datatype = 'or(ip4addr, ip4addrport)';
        o.placeholder = "8.8.8.8:53";

        o = s.taboption('dns', form.ListValue, 'secure_dns_method', _('Secure DNS Protocol'),
            _('Transport protocol for Secure DNS. UDP uses the port from the address (default 53); DoH uses TCP/443 with <code>/dns-query</code>; DoT uses TCP/853.'));
        o.value('udp', _('UDP'));
        o.value('https', _('DNS over HTTPS (DoH)'));
        o.value('tls', _('DNS over TLS (DoT)'));
        o.default = 'udp';

        o = s.taboption('dns', form.Value, 'default_dns', _('Default DNS'), _("DNS for resolving other sites (not in domain rules) and DNS records other than A or AAAA (TXT and MX for example)."));
        o.datatype = 'or(ip4addr, ip4addrport)';
        o.placeholder = "1.1.1.1:53";

        o = s.taboption('dns', form.ListValue, 'default_dns_method', _('Default DNS Protocol'),
            _('Transport protocol for Default DNS. UDP uses the port from the address (default 53); DoH uses TCP/443 with <code>/dns-query</code>; DoT uses TCP/853.'));
        o.value('udp', _('UDP'));
        o.value('https', _('DNS over HTTPS (DoH)'));
        o.value('tls', _('DNS over TLS (DoT)'));
        o.default = 'udp';

        o = s.taboption('dns', form.Value, 'dns_port', _('Xray DNS Server Port'), _("Do not use port 53 (dnsmasq), port 5353 (mDNS) or other common ports"));
        o.datatype = 'port';
        o.placeholder = 5300;

        o = s.taboption('dns', form.Value, 'dns_count', _('Extra DNS Server Ports'), _('Listen for DNS Requests on multiple ports (all of which serves as dnsmasq upstream servers).<br/>For example if Xray DNS Server Port is 5300 and use 3 extra ports, 5300 - 5303 will be used for DNS requests.<br/>Increasing this value may help reduce the possibility of temporary DNS lookup failures.'));
        o.datatype = 'range(0, 50)';
        o.placeholder = 3;

        let tproxy_port_tcp_f4 = s.taboption('fake_dns', form.Value, 'tproxy_port_tcp_f4', _('Transparent proxy port (TCP4)'));
        tproxy_port_tcp_f4.datatype = 'port';
        tproxy_port_tcp_f4.placeholder = 1086;

        let tproxy_port_tcp_f6 = s.taboption('fake_dns', form.Value, 'tproxy_port_tcp_f6', _('Transparent proxy port (TCP6)'));
        tproxy_port_tcp_f6.datatype = 'port';
        tproxy_port_tcp_f6.placeholder = 1087;

        let tproxy_port_udp_f4 = s.taboption('fake_dns', form.Value, 'tproxy_port_udp_f4', _('Transparent proxy port (UDP4)'));
        tproxy_port_udp_f4.datatype = 'port';
        tproxy_port_udp_f4.placeholder = 1088;

        let tproxy_port_udp_f6 = s.taboption('fake_dns', form.Value, 'tproxy_port_udp_f6', _('Transparent proxy port (UDP6)'));
        tproxy_port_udp_f6.datatype = 'port';
        tproxy_port_udp_f6.placeholder = 1089;

        let pool_v4 = s.taboption('fake_dns', form.Value, 'pool_v4', _('Address Pool (IPv4)'));
        pool_v4.datatype = 'ip4addr';
        pool_v4.placeholder = "198.18.0.0/15";

        let pool_v4_size = s.taboption('fake_dns', form.Value, 'pool_v4_size', _('Address Pool Size (IPv4)'));
        pool_v4_size.datatype = 'integer';
        pool_v4_size.placeholder = 65535;

        let pool_v6 = s.taboption('fake_dns', form.Value, 'pool_v6', _('Address Pool (IPv6)'));
        pool_v6.datatype = 'ip6addr';
        pool_v6.placeholder = "2001:2::/48";

        let pool_v6_size = s.taboption('fake_dns', form.Value, 'pool_v6_size', _('Address Pool Size (IPv6)'));
        pool_v6_size.datatype = 'integer';
        pool_v6_size.placeholder = 65535;

        let fs = s.taboption('fake_dns', form.SectionValue, "fake_dns_section", form.GridSection, 'fakedns', _('FakeDNS Routing'), _('See <a href="https://github.com/v2ray/v2ray-core/issues/2233">FakeDNS</a> for details.')).subsection;
        fs.sortable = false;
        fs.anonymous = true;
        fs.addremove = true;

        let fake_dns_domain_names = fs.option(form.DynamicList, "fake_dns_domain_names", _("Domain names"));
        fake_dns_domain_names.rmempty = false;
        fake_dns_domain_names.textvalue = list_folded_format(config_data, "fake_dns_domain_names", "domains", 20);

        let fake_dns_forward_server_tcp = fs.option(form.MultiValue, 'fake_dns_forward_server_tcp', _('Force Forward server (TCP)'));
        fake_dns_forward_server_tcp.datatype = "uciname";
        fake_dns_forward_server_tcp.textvalue = destination_format(config_data, "fake_dns_forward_server_tcp", null, 40);

        let fake_dns_forward_server_udp = fs.option(form.MultiValue, 'fake_dns_forward_server_udp', _('Force Forward server (UDP)'));
        fake_dns_forward_server_udp.datatype = "uciname";
        fake_dns_forward_server_udp.textvalue = destination_format(config_data, "fake_dns_forward_server_udp", null, 40);

        let fake_dns_balancer_strategy = fs.option(form.Value, 'fake_dns_balancer_strategy', _('Balancer Strategy'), _('Strategy <code>leastPing</code> requires Observatory (see "Extra Options" tab).'));
        fake_dns_balancer_strategy.value("random");
        fake_dns_balancer_strategy.value("leastPing");
        fake_dns_balancer_strategy.value("roundRobin");
        fake_dns_balancer_strategy.default = "random";
        fake_dns_balancer_strategy.rmempty = false;
        fake_dns_balancer_strategy.modalonly = true;

        // Shared textarea widget for the 4 forward/bypass × domain/ip lists.
        // UCI stores the parsed list; sibling `<name>_text` preserves user formatting.
        const DOMAIN_HINT = _('Enter domain names separated by commas, spaces, or newlines. You can add comments using <code>//</code>. Supported prefixes: <code>domain:</code>, <code>full:</code>, <code>keyword:</code>, <code>regexp:</code>, <code>geosite:</code>, <code>ext:</code>.');
        const IP_HINT = _('Enter IP addresses (IPv4/IPv6 single addresses or CIDR), or <code>geoip:CODE</code> separated by commas, spaces, or newlines. You can add comments using <code>//</code>. Geo codes are expanded from <code>/usr/share/xray/geoip.dat</code> at firewall-config time.');

        const listToText = function (sid, optname) {
            const v = uci.get(shared.variant, sid, optname);
            if (Array.isArray(v)) return v.join('\n');
            if (typeof v === 'string') return v;
            return '';
        };
        // `//` is a comment only at line start or after whitespace (keeps `regexp:abc//def`).
        const textToList = function (text) {
            if (!text) return [];
            const out = [];
            for (const raw_line of String(text).split('\n')) {
                const stripped = raw_line.replace(/(^|\s)\/\/.*/, '$1').trim();
                for (const item of stripped.split(/[\s,]+/)) {
                    const t = item.trim();
                    if (t) out.push(t);
                }
            }
            return out;
        };

        const geoip_or_ipaddr = function (_sid, value) {
            if (!value) return true;
            if (/^geoip:[A-Za-z0-9_!\-]+$/.test(value)) return true;
            if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:\/\d{1,2})?$/.test(value)) return true;
            if (/^[0-9a-fA-F:]+(?:\/\d{1,3})?$/.test(value) && value.includes(':')) return true;
            return _('Invalid entry "%s" — expected IPv4/IPv6 address, CIDR, or geoip:CODE.').format(value);
        };

        const mkListTextarea = function (optname, title, descr, itemValidator) {
            const opt = s.taboption('outbound_routing', form.TextValue, optname, title, descr);
            opt.rows = 8;
            opt.monospace = true;
            opt.optional = true;
            opt.cfgvalue = function (sid) {
                const raw = uci.get(shared.variant, sid, optname + '_text');
                if (typeof raw === 'string' && raw.length > 0) return raw;
                return listToText(sid, optname);
            };
            opt.write = function (sid, value) {
                const items = textToList(value);
                if (typeof value === 'string' && value.replace(/\s+/g, '').length > 0) {
                    uci.set(shared.variant, sid, optname + '_text', value);
                } else {
                    uci.unset(shared.variant, sid, optname + '_text');
                }
                if (items.length === 0) {
                    uci.unset(shared.variant, sid, optname);
                } else {
                    uci.set(shared.variant, sid, optname, items);
                }
            };
            opt.remove = function (sid) {
                uci.unset(shared.variant, sid, optname);
                uci.unset(shared.variant, sid, optname + '_text');
            };
            if (itemValidator) {
                opt.validate = function (sid, value) {
                    if (!value) return true;
                    for (const item of textToList(value)) {
                        const r = itemValidator(sid, item);
                        if (r !== true) return r;
                    }
                    return true;
                };
            }
            return opt;
        };

        // ===== Public lists (Routing tab) =====
        // Multi-select over the GitHub catalog; fetcher caches selected ids and prunes orphans.
        const catalogItems = Array.isArray(catalog.items) ? catalog.items : [];
        const statusItems  = (pubListStat && pubListStat.items) || {};

        let oCommunityLists = s.taboption('outbound_routing', form.MultiValue, 'community_lists',
            _('Public lists'),
            _('Pick one or more curated rule lists from the catalog. Selected lists auto-refresh every 6 hours.'));
        oCommunityLists.rmempty = true;
        oCommunityLists.placeholder = _('-- nothing selected --');

        // Register catalog ids AND already-selected UCI ids — MultiValue drops unknown options on save.
        const optionMap = {};
        for (const it of catalogItems) {
            const id = String(it && it.id || '');
            if (!id) continue;
            const name = String(it.name || id);
            const desc = it.description ? (' · ' + it.description) : '';
            optionMap[id] = name + desc;
        }
        const alreadySelected = uci.get(shared.variant, '@general[0]', 'community_lists') || [];
        for (const id of (Array.isArray(alreadySelected) ? alreadySelected : [alreadySelected])) {
            if (id && !optionMap[id]) optionMap[id] = id + '  ·  ' + _('(not in catalog)');
        }
        const sortedIds = Object.keys(optionMap).sort((a, b) => a.localeCompare(b));
        for (const id of sortedIds) oCommunityLists.value(id, optionMap[id]);
        if (sortedIds.length === 0) {
            // First-run / catalog never fetched. A stub keeps the widget
            // visible while telling the user the next move.
            oCommunityLists.value('', _('(catalog empty — click "Refresh catalog" below)'));
        }

        // Status line: when was the catalog / selected lists last refreshed.
        let oPubListInfo = s.taboption('outbound_routing', form.DummyValue, '_public_list_info', _('Last refresh'));
        oPubListInfo.rawhtml = true;
        oPubListInfo.cfgvalue = function () {
            const lu = pubListStat && pubListStat.last_updated;
            const cu = pubListStat && pubListStat.catalog_updated;
            const luText = lu ? fmtTimestamp(lu) : _('never');
            const cuText = cu ? fmtTimestamp(cu) : _('never');
            const total = (catalog && catalog.items) ? catalog.items.length : 0;
            return E('div', { style: 'font-size:0.95em;color:#555' }, [
                E('div', {}, [E('strong', {}, _('Lists fetched: ')),   luText]),
                E('div', {}, [E('strong', {}, _('Catalog fetched: ')), cuText, ' (', total, ' ', _('available'), ')']),
            ]);
        };

        // Rendered as a single DummyValue cell so buttons sit on one row
        // (form.Button always opens a new label/widget row).
        let oPubListBtns = s.taboption('outbound_routing', form.DummyValue, '_public_list_btns', _('Actions'));
        oPubListBtns.cfgvalue = function () {
            function mkBtn(label, fn, style) {
                const btn = E('button', { class: 'btn cbi-button cbi-button-' + (style || 'apply') }, label);
                btn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    if (btn.disabled) return;
                    btn.disabled = true;
                    ui.showModal(label, [E('p', { 'class': 'spinning' }, _('Working...'))]);
                    return fn().then(function (r) {
                        ui.hideModal();
                        notify(r && r.code === 0, label + ': ' + (r && r.code === 0 ? _('ok') : _('failed')) + ' ' + ((r && r.log) || ''));
                        return window.location.reload();
                    }, function (e) {
                        ui.hideModal();
                        notify(false, _('RPC error: ') + e);
                        btn.disabled = false;
                    });
                });
                return btn;
            }
            return E('span', { style: 'display:inline-flex;gap:0.4em;flex-wrap:wrap;align-items:center' }, [
                mkBtn(_('Refresh catalog'), () => callCatalogRefresh()),
                mkBtn(_('Update lists now'), () => callPubListUpdate('')),
            ]);
        };

        mkListTextarea('forwarded_domain_rules', _('Forwarded domains (via proxy)'), DOMAIN_HINT);
        mkListTextarea('bypassed_domain_rules',  _('Bypassed domains (direct)'),     DOMAIN_HINT);
        mkListTextarea('wan_fw_ips',             _('Forwarded IPs / CIDRs (via proxy)'), IP_HINT, geoip_or_ipaddr);
        mkListTextarea('wan_bp_ips',             _('Bypassed IPs / CIDRs (direct)'),     IP_HINT, geoip_or_ipaddr);

        o = s.taboption('outbound_routing', form.DynamicList, "wan_fw_tcp_ports", _("Forwarded TCP Ports"), _("Requests to these TCP Ports will be forwarded through Xray."));
        o.datatype = "portrange";

        o = s.taboption('outbound_routing', form.DynamicList, "wan_fw_udp_ports", _("Forwarded UDP Ports"), _("Requests to these UDP Ports will be forwarded through Xray."));
        o.datatype = "portrange";

        o = s.taboption('outbound_routing', form.SectionValue, "access_control_manual_tproxy", form.GridSection, 'manual_tproxy', _('Manual Transparent Proxy'), _('Compared to iptables REDIRECT, Xray could do NAT46 / NAT64 (for example accessing IPv6 only sites). See <a href="https://github.com/v2ray/v2ray-core/issues/2233">FakeDNS</a> for details.'));

        ss = o.subsection;
        ss.sortable = false;
        ss.anonymous = true;
        ss.addremove = true;
        ss.nodescriptions = true;

        o = ss.option(form.Value, "source_addr", _("Source Address"), _("Fill an IP address or a rule like <code>geoip:cn</code> or <code>ext:/geoip/cloudflare.dat:cloudflare</code>."));
        o.validate = shared.validate_ip_or_geoip;
        o.rmempty = false;

        o = ss.option(form.Value, "source_port", _("Source Port"), _("Leave empty to forward all ports."));
        o.textvalue = s => uci.get(config_data, s)?.source_port || _("<i>any</i>");
        o.validate = shared.validate_port_expression;

        o = ss.option(form.Value, "dest_addr", _("Destination Address"), _("Leave empty to keep original address unchanged."));
        o.textvalue = s => uci.get(config_data, s)?.dest_addr || _("<i>original</i>");
        o.datatype = "host";

        o = ss.option(form.Value, "dest_port", _("Destination Port"), _("Fill <code>0</code> to keep original port unchanged."));
        o.datatype = "port";
        o.rmempty = false;

        o = ss.option(form.DynamicList, "domain_names", _("Domain names to associate"), _("Resolve these domains to Source Address above. Only possible when an IP address is used."));
        o.textvalue = list_folded_format(config_data, "domain_names", "domains", 20);

        o = ss.option(form.Flag, 'rebind_domain_ok', _('Exempt rebind protection'), _('Avoid dnsmasq filtering RFC1918 IP addresses (and some TESTNET addresses as well) from result.<br/>Must be enabled for TESTNET addresses (<code>192.0.2.0/24</code>, <code>198.51.100.0/24</code>, <code>203.0.113.0/24</code>). Addresses like <a href="https://www.as112.net/">AS112 Project</a> (<code>192.31.196.0/24</code>, <code>192.175.48.0/24</code>) or <a href="https://www.nyiix.net/technical/rtbh/">NYIIX RTBH</a> (<code>198.32.160.7</code>) can avoid that.'));
        o.modalonly = true;

        o = ss.option(form.Flag, 'force_forward_tcp', _('Force Forward (TCP)'), _('This destination must be forwarded through an outbound server.'));
        o.modalonly = true;

        let force_forward_server_tcp = ss.option(form.ListValue, 'force_forward_server_tcp', _('Force Forward server (TCP)'));
        force_forward_server_tcp.depends("force_forward_tcp", "1");
        force_forward_server_tcp.datatype = "uciname";
        force_forward_server_tcp.modalonly = true;

        o = ss.option(form.Flag, 'force_forward_udp', _('Force Forward (UDP)'), _('This destination must be forwarded through an outbound server.'));
        o.modalonly = true;

        let force_forward_server_udp = ss.option(form.ListValue, 'force_forward_server_udp', _('Force Forward server (UDP)'));
        force_forward_server_udp.depends("force_forward_udp", "1");
        force_forward_server_udp.datatype = "uciname";
        force_forward_server_udp.modalonly = true;

        o = s.taboption('extra_options', form.Value, 'xray_bin', _('Xray Executable Path'));
        o.rmempty = false;
        if (xray_bin_default) {
            o.value("/usr/bin/xray", _("/usr/bin/xray (default, exist)"));
        }

        o = s.taboption('extra_options', form.ListValue, 'loglevel', _('Log Level'), _('Read Xray log in "System Log" or use <code>logread</code> command.'));
        o.value("debug");
        o.value("info");
        o.value("warning");
        o.value("error");
        o.value("none");
        o.default = "warning";

        o = s.taboption('extra_options', form.Flag, 'access_log', _('Enable Access Log'), _('Access log will also be written to System Log.'));

        o = s.taboption('extra_options', form.Flag, 'dns_log', _('Enable DNS Log'), _('DNS log will also be written to System Log.'));

        o = s.taboption('extra_options', form.Flag, 'xray_api', _('Enable Xray API Service'), _('Xray API Service uses port 8080 and GRPC protocol. Also callable via <code>xray api</code> or <code>ubus call xray</code>. See <a href="https://xtls.github.io/document/command.html#xray-api">here</a> for help.'));

        o = s.taboption('extra_options', form.Flag, 'stats', _('Enable Statistics'), _('Enable statistics of inbounds / outbounds data. Use Xray API to query values.'));

        o = s.taboption('extra_options', form.Flag, 'observatory', _('Enable Observatory'), _('Enable latency measurement for TCP and UDP outbounds. Required for <code>leastPing</code> balancer strategy — enable manually if you use it.'));

        o = s.taboption('extra_options', form.Flag, 'fw4_counter', _('Enable Firewall Counters'), _('Add <a href="/cgi-bin/luci/admin/status/nftables">counters to firewall4</a> for transparent proxy rules. (Not supported in all OpenWrt versions. )'));

        o = s.taboption('extra_options', form.Flag, 'metrics_server_enable', _('Enable Xray Metrics Server'), _("Enable built-in metrics server for pprof and expvar. See <a href='https://github.com/XTLS/Xray-core/pull/1000'>here</a> for details."));

        o = s.taboption('extra_options', form.Value, 'metrics_server_port', _('Xray Metrics Server Port'), _("Metrics may be sensitive so think twice before setting it as Default Fallback HTTP Server."));
        o.depends("metrics_server_enable", "1");
        o.datatype = 'port';
        o.placeholder = '18888';

        o = s.taboption('extra_options', form.Value, 'handshake', _('Handshake Timeout'), _('Policy: Handshake timeout when connecting to upstream. See <a href="https://xtls.github.io/config/policy.html#levelpolicyobject">here</a> for help.'));
        o.datatype = 'uinteger';
        o.placeholder = 4;

        o = s.taboption('extra_options', form.Value, 'conn_idle', _('Connection Idle Timeout'), _('Policy: Close connection if no data is transferred within given timeout. See <a href="https://xtls.github.io/config/policy.html#levelpolicyobject">here</a> for help.'));
        o.datatype = 'uinteger';
        o.placeholder = 300;

        o = s.taboption('extra_options', form.Value, 'uplink_only', _('Uplink Only Timeout'), _('Policy: How long to wait before closing connection after server closed connection. See <a href="https://xtls.github.io/config/policy.html#levelpolicyobject">here</a> for help.'));
        o.datatype = 'uinteger';
        o.placeholder = 2;

        o = s.taboption('extra_options', form.Value, 'downlink_only', _('Downlink Only Timeout'), _('Policy: How long to wait before closing connection after client closed connection. See <a href="https://xtls.github.io/config/policy.html#levelpolicyobject">here</a> for help.'));
        o.datatype = 'uinteger';
        o.placeholder = 5;

        o = s.taboption('extra_options', form.Value, 'buffer_size', _('Buffer Size'), _('Policy: Internal cache size per connection. See <a href="https://xtls.github.io/config/policy.html#levelpolicyobject">here</a> for help.'));
        o.datatype = 'uinteger';
        o.placeholder = 512;

        // The "Preview or Deprecated" toggle was removed together with the Preview page.

        o = s.taboption('extra_options', form.SectionValue, "xray_bridge", form.TableSection, 'bridge', _('Bridge'), _('Reverse proxy tool. Currently only client role (bridge) is supported. See <a href="https://xtls.github.io/config/reverse.html#bridgeobject">here</a> for help.'));

        ss = o.subsection;
        ss.sortable = false;
        ss.anonymous = true;
        ss.addremove = true;

        let bridge_upstream = ss.option(form.ListValue, "upstream", _("Upstream"));
        bridge_upstream.datatype = "uciname";

        o = ss.option(form.Value, "domain", _("Domain"));
        o.rmempty = false;

        o = ss.option(form.Value, "redirect", _("Redirect address"));
        o.datatype = "hostport";
        o.rmempty = false;
        
        let oReinaPromo = s.taboption('subscriptions', form.DummyValue, '_reina_promo', ' ');
        oReinaPromo.rawhtml = true;
        oReinaPromo.cfgvalue = function () {
            return E('div', {
                'style': 'padding:0.7em 1em;margin:0.3em 0 0.6em;border-left:4px solid #2980b9;border-radius:3px;font-size:1.02em;'
            }, [
                E('strong', {}, 'Reina VPN'),
                ' - ',
                'Подписку можете приобрести на сайте: ',
                E('a', {
                    'href': 'https://wxpn.reina.guru',
                    'target': '_blank',
                    'rel': 'noopener noreferrer',
                    'style': 'font-weight:bold;'
                }, 'wxpn.reina.guru'),
            ]);
        };

        let oActive = s.taboption('subscriptions', form.ListValue, '_active_sub_server',
            _('Active subscription server'),
            _('Picks ONE imported server and writes it into balancer. Choose "-- none --" to leave the existing balancer config untouched.'));
        oActive.cfgvalue = function (section_id) {
            const v = uci.get(shared.variant, section_id, 'tcp_balancer_v4');
            if (Array.isArray(v)) return v[0] || '';
            return v || '';
        };
        oActive.write = function (section_id, value) {
            const arr = value ? [value] : [];
            uci.set(shared.variant, section_id, 'tcp_balancer_v4', arr);
            uci.set(shared.variant, section_id, 'udp_balancer_v4', arr);
            uci.set(shared.variant, section_id, 'tcp_balancer_v6', arr);
            uci.set(shared.variant, section_id, 'udp_balancer_v6', arr);
        };
        oActive.value('', _('-- none --'));
        for (let srv of uci.sections(shared.variant, 'servers')) {
            if (srv.subscription_id) {
                const subName = uci.get(shared.variant, srv.subscription_id, 'name') || srv.subscription_id;
                const label = (srv.alias || srv.server || srv['.name'])
                    + ' [' + (srv.protocol || '?') + '/' + (srv.transport || 'tcp') + '] ('
                    + subName + ')';
                oActive.value(srv['.name'], label);
            }
        }

        let oQuickAdd = s.taboption('subscriptions', form.Button, '_sub_quick_add',
            _('Add subscription'),
            _('Paste a subscription URL — the system will fetch it, parse the server list and apply automatically.'));
        oQuickAdd.inputtitle = _('+ Add subscription');
        oQuickAdd.inputstyle = 'add';
        oQuickAdd.onclick = function () {
            const urlInput = E('input', {
                type: 'text', class: 'cbi-input-text',
                style: 'width:100%;margin:0.5em 0;',
                placeholder: 'https://example.com/sub?token=...'
            });
            ui.showModal(_('Add subscription'), [
                E('p', {}, _('Paste subscription URL:')),
                urlInput,
                E('div', { class: 'right' }, [
                    E('button', {
                        class: 'btn',
                        click: ui.hideModal
                    }, _('Cancel')),
                    ' ',
                    E('button', {
                        class: 'cbi-button cbi-button-action',
                        click: ui.createHandlerFn(this, function () {
                            const url = (urlInput.value || '').trim();
                            if (!url) { notify(false, _('URL is empty')); return; }
                            if (!/^https?:\/\//i.test(url)) {
                                notify(false, _('Must start with http:// or https://'));
                                return;
                            }
                            ui.hideModal();
                            ui.showModal(_('Adding'), [E('p', { class: 'spinning' }, _('Creating subscription and fetching servers...'))]);
                            return callSubAdd(url).then(function (r) {
                                ui.hideModal();
                                notify(r && r.code === 0,
                                    r && r.code === 0
                                        ? _('Subscription added: ') + ((r && r.log) || '')
                                        : _('Added but fetch failed — see System Log: ') + ((r && r.log) || ''));
                                return window.location.reload();
                            }, function (e) {
                                ui.hideModal();
                                notify(false, _('Error: ') + e);
                            });
                        })
                    }, _('Add'))
                ])
            ]);
        };

        let oUpdAll = s.taboption('subscriptions', form.Button, '_sub_update_all',
            _('Update all enabled subscriptions'));
        oUpdAll.inputtitle = _('Update all now');
        oUpdAll.inputstyle = 'apply';
        oUpdAll.onclick = function () {
            ui.showModal(_('Updating'), [E('p', { 'class': 'spinning' }, _('Running...'))]);
            return callSubFetchAll().then(function (r) {
                ui.hideModal();
                notify(r && r.code === 0, _('Done. ') + ((r && r.log) || ''));
                return window.location.reload();
            }, function (e) { ui.hideModal(); notify(false, _('RPC error: ') + e); });
        };

        let subs = s.taboption('subscriptions', form.SectionValue, '_sub_table',
            form.TableSection, 'subscription', _('Configured subscriptions'));
        let subSect = subs.subsection;
        subSect.anonymous = true;
        subSect.addremove = true;
        subSect.addbtntitle = _('+ Add (URL only)');
        subSect.sortable = false;
        subSect.nodescriptions = true;

        // Cascade-delete: when a subscription is removed, also drop every server
        // it imported and clean up balancer references that pointed at them.
        subSect.handleRemove = function (section_id, ev) {
            const self = this;
            const cfg = this.uciconfig || this.map.config;
            const depServers = uci.sections(cfg, 'servers')
                .filter(srv => srv.subscription_id === section_id)
                .map(srv => srv['.name']);
            const subName = uci.get(cfg, section_id, 'profile_title')
                || uci.get(cfg, section_id, 'name')
                || section_id;
            const subUrl = uci.get(cfg, section_id, 'url') || '';

            return new Promise(function (resolve) {
                ui.showModal(_('Delete subscription'), [
                    E('p', {}, _('Delete subscription "%s"?').format(subName)),
                    subUrl ? E('p', { style: 'color:#777;font-size:0.9em;word-break:break-all' }, subUrl) : '',
                    depServers.length > 0
                        ? E('p', {}, _('This will also remove %d imported server(s) and clean up balancer references.').format(depServers.length))
                        : E('p', { style: 'color:#777' }, _('No imported servers to clean up.')),
                    E('div', { class: 'right' }, [
                        E('button', { class: 'btn', click: function () { ui.hideModal(); resolve(false); } }, _('Cancel')),
                        ' ',
                        E('button', {
                            class: 'btn cbi-button cbi-button-negative',
                            click: function () { ui.hideModal(); resolve(true); }
                        }, _('Delete'))
                    ])
                ]);
            }).then(function (ok) {
                if (!ok) return;
                const BALS = ['tcp_balancer_v4', 'udp_balancer_v4', 'tcp_balancer_v6', 'udp_balancer_v6'];
                const doomed = {};
                for (const n of depServers) doomed[n] = true;
                for (const g of uci.sections(cfg, 'general')) {
                    for (const bf of BALS) {
                        const cur = g[bf];
                        if (cur == null) continue;
                        const arr = Array.isArray(cur) ? cur : [cur];
                        const kept = arr.filter(x => !doomed[x]);
                        if (kept.length !== arr.length) {
                            uci.set(cfg, g['.name'], bf, kept);
                        }
                    }
                }
                for (const name of depServers) uci.remove(cfg, name);
                uci.remove(cfg, section_id);
                return self.map.save(null, true).then(function () {
                    notify(true, depServers.length > 0
                        ? _('Subscription deleted (%d server(s) removed).').format(depServers.length)
                        : _('Subscription deleted.'));
                    return window.location.reload();
                });
            });
        };

        let oSubTitle = subSect.option(form.DummyValue, '_sub_title', _('Name'));
        oSubTitle.cfgvalue = function (sid) {
            return uci.get(shared.variant, sid, 'profile_title')
                || uci.get(shared.variant, sid, 'name')
                || _('(awaiting first fetch)');
        };

        let oSubUrl = subSect.option(form.Value, 'url', _('URL'));
        oSubUrl.rmempty = false;
        oSubUrl.validate = function (_sid, value) {
            if (!value) return true;
            return /^https?:\/\//i.test(value) ? true : _('Must start with http:// or https://');
        };

        let oSubEnabled = subSect.option(form.Flag, 'enabled', _('On'));
        oSubEnabled.default = '1';
        oSubEnabled.rmempty = false;

        let oSubIv = subSect.option(form.DummyValue, '_sub_iv', _('Update every'));
        oSubIv.cfgvalue = function (sid) {
            const v = uci.get(shared.variant, sid, 'update_interval_hours');
            return v ? (v + ' h') : _('-');
        };

        let oSubLast = subSect.option(form.DummyValue, '_sub_last', _('Last Update'));
        oSubLast.cfgvalue = function (sid) { return fmtTimestamp(uci.get(shared.variant, sid, 'last_updated')); };

        let oSubBtn = subSect.option(form.Button, '_sub_update', _('Update'));
        oSubBtn.inputtitle = _('Fetch');
        oSubBtn.inputstyle = 'apply';
        oSubBtn.onclick = function (_ev, sid) {
            ui.showModal(_('Updating subscription'), [E('p', { 'class': 'spinning' }, _('Fetching and applying...'))]);
            return callSubFetch(sid).then(function (r) {
                ui.hideModal();
                notify(r && r.code === 0, r && r.code === 0
                    ? _('Subscription updated. ') + ((r && r.log) || '')
                    : _('Update failed — see System Log. ') + ((r && r.log) || ''));
                return window.location.reload();
            }, function (e) { ui.hideModal(); notify(false, _('RPC error: ') + e); });
        };

        // ===== Core Version tab =====
        let oCurVer = s.taboption('core_install', form.DummyValue, '_core_cur', _('Current binary'));
        oCurVer.cfgvalue = function () {
            return (((coreVer && coreVer.version) || '?').split('\n')[0])
                + '  @  ' + ((coreVer && coreVer.path) || '?');
        };

        let oCoreArch = s.taboption('core_install', form.DummyValue, '_core_arch', _('Detected arch / asset'));
        oCoreArch.cfgvalue = function () {
            return ((coreList && coreList.current_arch) || '?')
                + '  →  '
                + ((coreList && coreList.asset) || _('(no asset map — only manual / latest install possible)'));
        };

        let oCoreTag = s.taboption('core_install', form.ListValue, '_core_tag', _('Release tag'),
            _('Tags fetched from api.github.com/repos/XTLS/Xray-core/releases.'));
        oCoreTag.value('', _('-- choose --'));
        const _tags = (coreList && Array.isArray(coreList.tags)) ? coreList.tags : [];
        for (let t of _tags) oCoreTag.value(t, t);

        let oCoreInst = s.taboption('core_install', form.Button, '_core_install', _('Install selected'));
        oCoreInst.inputtitle = _('Install');
        oCoreInst.inputstyle = 'apply';
        oCoreInst.onclick = function (_ev, section_id) {
            const tag = this.section.formvalue(section_id, '_core_tag');
            if (!tag) { notify(false, _('Choose a release tag first.')); return; }
            // Install runs in background; poll status so XHR doesn't time out on slow links.
            // Mutate <pre> in place — re-rendering the modal would flicker and reset scroll.
            const logPre = E('pre', {
                'class': 'xray-install-log',
                'style':
                    'max-height:240px;overflow:auto;font-size:0.85em;padding:0.5em;margin-top:0.8em;' +
                    // Semi-transparent + inherited color: readable in both light and dark LuCI themes.
                    'background:rgba(127,127,127,0.12);color:inherit;' +
                    'border:1px solid rgba(127,127,127,0.25);border-radius:3px;' +
                    'white-space:pre-wrap;word-break:break-word;'
            }, '');
            ui.showModal(_('Installing'), [
                E('p', { 'class': 'spinning' }, _('Downloading and installing ') + tag + '...'),
                logPre
            ]);

            const updateLog = function (txt) {
                const next = txt || '';
                if (logPre.textContent === next) return;
                const atBottom = (logPre.scrollTop + logPre.clientHeight) >= (logPre.scrollHeight - 4);
                logPre.textContent = next;
                if (atBottom) logPre.scrollTop = logPre.scrollHeight;
            };

            const POLL_MS = 1000;
            const pollStatus = function () {
                return callCoreInstallStatus().then(function (st) {
                    if (!st || st.state === 'idle') {
                        // Status file vanished — treat as unknown failure.
                        ui.hideModal();
                        notify(false, _('Install status unavailable.'));
                        return;
                    }
                    if (st.state === 'running') {
                        updateLog(st.log);
                        return new Promise(function (res) { setTimeout(res, POLL_MS); }).then(pollStatus);
                    }
                    ui.hideModal();
                    if (st.state === 'done' && st.exit === 0) {
                        notify(true, _('Installed: ') + (st.log || ''));
                        return window.location.reload();
                    }
                    const reason = st.state === 'dead'
                        ? _('Install process died unexpectedly.')
                        : _('Install failed (exit ') + st.exit + '): ';
                    notify(false, reason + (st.log || ''));
                }, function (_e) {
                    // Transient status XHR error — keep polling, the install
                    // is still running in the background.
                    return new Promise(function (res) { setTimeout(res, POLL_MS); }).then(pollStatus);
                });
            };
            return callCoreInstall(tag).then(function (r) {
                if (!r || r.code !== 0) {
                    ui.hideModal();
                    notify(false, _('Could not start install: ') + ((r && r.error) || _('unknown error')));
                    return;
                }
                return pollStatus();
            }, function (e) { ui.hideModal(); notify(false, _('RPC error: ') + e); });
        };

        // ===== Geo files (geoip.dat / geosite.dat auto-update) =====
        let oGeoStatus = s.taboption('geo_files', form.DummyValue, '_geo_status', _('On-disk status'));
        oGeoStatus.cfgvalue = function () {
            const fmtKB = b => b ? Math.round(b / 1024) + ' KB' : _('missing');
            const ipS = geoStat && geoStat.geoip ? fmtKB(geoStat.geoip.size) : _('missing');
            const stS = geoStat && geoStat.geosite ? fmtKB(geoStat.geosite.size) : _('missing');
            const ipT = (geoStat && geoStat.geoip && geoStat.geoip.mtime) ? fmtTimestamp(geoStat.geoip.mtime) : '-';
            const stT = (geoStat && geoStat.geosite && geoStat.geosite.mtime) ? fmtTimestamp(geoStat.geosite.mtime) : '-';
            return E('div', {}, [
                E('div', {}, [E('strong', {}, 'geoip.dat: '),   ipS, ' (' + ipT + ')']),
                E('div', {}, [E('strong', {}, 'geosite.dat: '), stS, ' (' + stT + ')']),
            ]);
        };

        let oGeoDisabled = s.taboption('geo_files', form.Flag, 'geo_disabled',
            _('Disable geo files'),
            _('Stop using <code>geoip.dat</code> / <code>geosite.dat</code> entirely. On the next service reload the data files are removed, the cron auto-update is dropped, and any <code>geosite:</code> / <code>geoip:</code> entries in your Routing lists are silently ignored — useful when you do not want to depend on a centrally-curated geo dataset.'));
        oGeoDisabled.default = '0';
        oGeoDisabled.rmempty = false;

        let oGeoIp = s.taboption('geo_files', form.Value, 'geo_geoip_url',
            _('geoip.dat URL'),
            _('Direct URL to download geoip.dat. Popular sources: <code>https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat</code>, <code>https://github.com/v2fly/geoip/releases/latest/download/geoip.dat</code>.'));
        oGeoIp.depends('geo_disabled', '0');
        oGeoIp.validate = function (_sid, v) {
            if (!v) return true;
            return /^https?:\/\//i.test(v) ? true : _('Must start with http:// or https://');
        };

        let oGeoSite = s.taboption('geo_files', form.Value, 'geo_geosite_url',
            _('geosite.dat URL'),
            _('Direct URL to download geosite.dat. Popular sources: <code>https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat</code>, <code>https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat</code>.'));
        oGeoSite.depends('geo_disabled', '0');
        oGeoSite.validate = function (_sid, v) {
            if (!v) return true;
            return /^https?:\/\//i.test(v) ? true : _('Must start with http:// or https://');
        };

        let oGeoIv = s.taboption('geo_files', form.Value, 'geo_update_interval_hours',
            _('Update every (hours)'),
            _('Auto-update interval. Cron-based; takes effect after Save & Apply. Set 24 for daily, 168 for weekly. Leave empty to disable auto-update (manual updates still work).'));
        oGeoIv.depends('geo_disabled', '0');
        oGeoIv.datatype = 'uinteger';
        oGeoIv.placeholder = '168';

        let oGeoBtn = s.taboption('geo_files', form.Button, '_geo_update_now', _('Update now'));
        oGeoBtn.depends('geo_disabled', '0');
        oGeoBtn.inputtitle = _('Update geo files now');
        oGeoBtn.inputstyle = 'apply';
        oGeoBtn.onclick = function () {
            ui.showModal(_('Updating'), [E('p', { 'class': 'spinning' }, _('Downloading geo files...'))]);
            return callGeoUpdate().then(function (r) {
                ui.hideModal();
                notify(r && r.code === 0,
                    (r && r.code === 0 ? _('Geo update OK: ') : _('Geo update failed: ')) + ((r && r.log) || ''));
                return window.location.reload();
            }, function (e) { ui.hideModal(); notify(false, _('RPC error: ') + e); });
        };

        const servers = uci.sections(config_data, "servers");
        for (let selection of [destination, fake_dns_forward_server_tcp, fake_dns_forward_server_udp, balancer_servers, bridge_upstream, force_forward_server_tcp, force_forward_server_udp, dialer_proxy]) {
            if (servers.length == 0) {
                selection.value("direct", _("No server configured"));
                selection.readonly = true;
                continue;
            }
            for (const v of servers) {
                selection.value(v[".name"], server_alias(v));
            }
        }
        return m.render();
    }
});
