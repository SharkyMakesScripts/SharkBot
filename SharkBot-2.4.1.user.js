// ==UserScript==
// @name         SharkBot
// @namespace    https://spacealpha.net/
// @version      2.4.1
// @description  SharkBot for Space Alpha: saves your planets' units, facilities, inventory, research, bank and market prices, and calculates credit generation and Tick Generator upgrade costs.
// @author       SharkBot
// @match        https://spacealpha.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'sa-helper-panel';
    const SLOT_IDS = 'ABCDEFGHIJ'.split('');   // up to 10 planets
    // Version comes from the @version header so it's never out of sync
    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.4.1';
    // Another copy of SharkBot already put its panel on the page: warn and stop,
    // so two installed copies are obvious instead of silently showing the old one.
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
        const other = ((existing.querySelector('.sa-ver') || {}).textContent || '').trim() || 'another version';
        console.warn(`[SharkBot] v${VERSION} found SharkBot ${other} already running; two copies are installed.`);
        if (!existing.querySelector('.sa-dup-warn')) {
            const w = document.createElement('div');
            w.className = 'sa-dup-warn';
            w.style.cssText = 'background:#7a1f1f;color:#fff;font-size:11px;padding:6px 10px;line-height:1.4';
            w.textContent = `Two copies of SharkBot are installed: ${other} (showing) and v${VERSION}. ` +
                'In the Tampermonkey dashboard, delete or disable the one you don\'t want, then reload.';
            const header = existing.querySelector('.sa-header');
            if (header) header.insertAdjacentElement('afterend', w); else existing.prepend(w);
        }
        return;
    }

    // ---------- page registry ----------
    const PAGES = {
        'nation':         { label: 'Nation',        scan: () => Object.assign(scanGeneric(), { nation: readNation() }) },
        'train-units':    { label: 'Train Units',   scan: scanTrainUnits },
        'facilities':     { label: 'Facilities',    scan: scanFacilities },
        'factory':        { label: 'Factory',       scan: scanGeneric },
        'research':       { label: 'Research',      scan: scanResearch },
        'galaxy':         { label: 'Galaxy',        scan: scanGeneric },
        'reports':        { label: 'Reports',       scan: scanGeneric },
        'alliance-page':  { label: 'Alliance',      scan: scanGeneric },
        'bank':           { label: 'Bank',          scan: () => {
            const bal = readBankBalance();
            if (bal && bal.value != null) storeBank(bal);
            const fee = readGalaxyFee();
            if (fee && fee.value != null) storeGalaxyFee(fee);
            const cb = readCentralBank();
            if (cb && cb.fields.length) storeCentralBank(cb);
            return Object.assign(scanGeneric(), { bank: bal, galaxyFee: fee, centralBank: cb });
        } },
        'market':         { label: 'Market',        scan: scanMarket },
        'highscore':      { label: 'Highscore',     scan: scanGeneric },
        'my-collection':  { label: 'Collection',    scan: () => Object.assign(scanGeneric(), { cards: readCards() }) },
        'empire':         { label: 'Empire',        scan: scanGeneric },
        'news':           { label: 'News',          scan: scanGeneric },
    };

    function currentPageKey() {
        const seg = location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
        return PAGES[seg] ? seg : null;
    }

    // ---------- styles ----------
    const style = document.createElement('style');
    style.textContent = `
        #${PANEL_ID} {
            position: fixed; top: 80px; right: 20px; width: 360px;
            background: var(--bg); color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 12px; border: 1px solid var(--border); border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 999999; user-select: none;
        }
        #${PANEL_ID} .sa-header {
            padding: 8px 12px;
            background: linear-gradient(90deg, var(--head1), var(--head2));
            border-bottom: 1px solid var(--border); border-radius: 8px 8px 0 0;
            cursor: move; display: flex; justify-content: space-between; align-items: center;
        }
        #${PANEL_ID} .sa-title { font-weight: 600; letter-spacing: 0.5px; }
        #${PANEL_ID} .sa-ver { font-size: 10px; color: var(--accent); margin-left: 4px; font-family: "SF Mono", Menlo, monospace; }
        #${PANEL_ID} .sa-page {
            font-size: 10px; color: var(--muted); margin-left: 6px;
            padding: 1px 6px; background: var(--surface2); border-radius: 3px;
        }
        #${PANEL_ID} .sa-btn {
            background: var(--btn); color: var(--text); border: 1px solid var(--border);
            border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px;
            margin-left: 4px;
        }
        #${PANEL_ID} .sa-btn:hover { background: var(--border); }
        #${PANEL_ID} .sa-btn.active { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
        #${PANEL_ID} .sa-toggle { display: flex; margin-bottom: 8px; }
        #${PANEL_ID} .sa-toggle .sa-btn { flex: 1; margin: 0; border-radius: 0; }
        #${PANEL_ID} .sa-toggle .sa-btn:first-child { border-radius: 4px 0 0 4px; }
        #${PANEL_ID} .sa-toggle .sa-btn:last-child { border-radius: 0 4px 4px 0; border-left: none; }
        #${PANEL_ID} .sa-btn.sa-btn-danger { border-color: var(--danger); }
        #${PANEL_ID} .sa-btn.sa-btn-danger:hover { background: var(--danger); }
        #${PANEL_ID} .sa-tabs {
            display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--border); background: var(--surface);
        }
        #${PANEL_ID} .sa-tab {
            flex: 1 1 auto; padding: 6px 6px; cursor: pointer; text-align: center;
            color: var(--muted); font-size: 10px; border-right: 1px solid var(--line);
            text-transform: uppercase; letter-spacing: 0.5px;
        }
        #${PANEL_ID} .sa-tab:last-child { border-right: none; }
        #${PANEL_ID} .sa-tab:hover { background: var(--hover); color: var(--text); }
        #${PANEL_ID} .sa-tab.active { background: var(--hover); color: var(--accent); border-bottom: 2px solid var(--accent); }
        #${PANEL_ID} .sa-maintabs { display: flex; background: var(--surface2); border-bottom: 1px solid var(--border); }
        #${PANEL_ID} .sa-mtab {
            flex: 1; padding: 7px 6px; cursor: pointer; text-align: center; font-size: 11px;
            font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted);
            border-right: 1px solid var(--line); border-bottom: 2px solid transparent;
        }
        #${PANEL_ID} .sa-mtab:last-child { border-right: none; }
        #${PANEL_ID} .sa-mtab:hover { background: var(--hover); color: var(--text); }
        #${PANEL_ID} .sa-mtab.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--hover); }
        #${PANEL_ID} .sa-tab.sa-hidden, #${PANEL_ID} .sa-tab-label.sa-hidden,
        #${PANEL_ID} .sa-tab-break.sa-hidden { display: none; }
        #${PANEL_ID} .sa-tab-break { flex-basis: 100%; height: 0; border-top: 1px solid var(--line); }
        #${PANEL_ID} .sa-tab-label {
            flex: 0 0 52px; display: flex; align-items: center; justify-content: center;
            font-size: 8px; letter-spacing: 0.8px; text-transform: uppercase; color: var(--dim);
            background: var(--inset); border-right: 1px solid var(--line); cursor: default;
        }
        #${PANEL_ID} .sa-body { padding: 10px 12px; max-height: 65vh; overflow-y: auto; }
        #${PANEL_ID} .sa-pane { display: none; }
        #${PANEL_ID} .sa-pane.active { display: block; }
        #${PANEL_ID} .sa-section { margin-bottom: 10px; }
        #${PANEL_ID} .sa-label {
            color: var(--muted); text-transform: uppercase; font-size: 10px;
            letter-spacing: 0.5px; margin-bottom: 2px;
        }
        #${PANEL_ID} .sa-value {
            font-family: "SF Mono", Menlo, monospace; color: var(--accent);
            white-space: pre-wrap; word-break: break-word;
        }
        #${PANEL_ID} .sa-recommend {
            background: var(--surface2); border-left: 3px solid var(--accent);
            padding: 6px 8px; border-radius: 2px; margin-top: 4px; color: var(--text);
            white-space: pre-wrap; font-family: "SF Mono", Menlo, monospace; font-size: 11px;
        }
        #${PANEL_ID} .sa-warn { border-left-color: var(--warn); }
        #${PANEL_ID}.collapsed .sa-body, #${PANEL_ID}.collapsed .sa-tabs,
        #${PANEL_ID}.collapsed .sa-maintabs { display: none; }
        #${PANEL_ID} pre.sa-dump {
            background: var(--inset); border: 1px solid var(--line); border-radius: 4px;
            padding: 6px; font-size: 10px; color: var(--soft); max-height: 200px;
            overflow: auto; margin: 4px 0 0 0;
        }
        /* Units tab */
        #${PANEL_ID} .sa-slot {
            background: var(--surface); border: 1px solid var(--line); border-radius: 4px;
            padding: 8px; margin-bottom: 10px;
        }
        #${PANEL_ID} .sa-slot-head {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 6px;
        }
        #${PANEL_ID} .sa-slot-name {
            background: var(--inset); border: 1px solid var(--border); color: var(--text);
            border-radius: 3px; padding: 2px 6px; font-size: 11px; width: 140px;
            font-family: inherit;
        }
        #${PANEL_ID} .sa-slot-meta {
            font-size: 10px; color: var(--muted); margin-bottom: 4px;
        }
        #${PANEL_ID} table.sa-unit-table {
            width: 100%; border-collapse: collapse; font-size: 11px;
            font-family: "SF Mono", Menlo, monospace;
        }
        #${PANEL_ID} table.sa-unit-table th {
            text-align: left; color: var(--muted); font-weight: normal;
            border-bottom: 1px solid var(--line); padding: 3px 4px; font-size: 10px;
            text-transform: uppercase;
        }
        #${PANEL_ID} table.sa-unit-table td {
            padding: 2px 4px; color: var(--text);
            border-bottom: 1px solid var(--row);
        }
        #${PANEL_ID} table.sa-unit-table td.sa-num {
            text-align: right; color: var(--num);
        }
        #${PANEL_ID} table.sa-unit-table td.sa-diff-pos { color: var(--pos); }
        #${PANEL_ID} table.sa-unit-table td.sa-diff-neg { color: var(--neg); }
        #${PANEL_ID} .sa-form {
            display: grid; grid-template-columns: 1fr 130px 14px; gap: 4px 6px;
            align-items: center; font-size: 11px;
        }
        #${PANEL_ID} .sa-form label { color: var(--soft); }
        #${PANEL_ID} .sa-form input, #${PANEL_ID} .sa-form select, #${PANEL_ID} select.sa-select {
            background: var(--inset); border: 1px solid var(--border); color: var(--text);
            border-radius: 3px; padding: 2px 6px; font-size: 11px; width: 100%;
            box-sizing: border-box; font-family: "SF Mono", Menlo, monospace;
            user-select: text;
        }
        #${PANEL_ID} .sa-src { font-size: 9px; color: var(--accent); text-align: center; }
        #${PANEL_ID} .sa-src.manual { color: var(--dim); }
        #${PANEL_ID} .sa-tut-hl {
            outline: 2px solid var(--accent) !important; outline-offset: 1px;
            box-shadow: 0 0 0 5px rgba(0,0,0,0.35), 0 0 12px var(--accent); border-radius: 3px;
        }
        #${PANEL_ID} .sa-tut {
            position: fixed; width: 290px; z-index: 1000001; background: var(--surface);
            color: var(--text); border: 1px solid var(--accent); border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6); font-size: 12px; user-select: text;
        }
        #${PANEL_ID} .sa-tut-head {
            display: flex; justify-content: space-between; align-items: center; padding: 8px 12px;
            background: linear-gradient(90deg, var(--head1), var(--head2)); border-radius: 8px 8px 0 0;
            border-bottom: 1px solid var(--border); font-weight: 600;
        }
        #${PANEL_ID} .sa-tut-step { font-size: 10px; color: var(--muted); font-weight: normal; }
        #${PANEL_ID} .sa-tut-body { padding: 10px 12px; line-height: 1.5; }
        #${PANEL_ID} .sa-tut-body b { color: var(--accent); }
        #${PANEL_ID} .sa-tut-try { margin-top: 6px; font-size: 11px; color: var(--warn); }
        #${PANEL_ID} .sa-tut-foot { display: flex; gap: 4px; padding: 0 12px 10px; align-items: center; }
        #${PANEL_ID} .sa-tut-foot .sa-btn { margin: 0; }
        #${PANEL_ID} .sa-tut-bar { height: 3px; background: var(--line); }
        #${PANEL_ID} .sa-tut-bar > div { height: 100%; background: var(--accent); }
        #${PANEL_ID} label.sa-check {
            display: flex !important; flex-direction: row !important; justify-content: flex-start !important;
            align-items: center; gap: 8px; font-size: 11px; color: var(--soft); text-align: left !important;
            width: auto !important; margin: 0; cursor: pointer;
        }
        #${PANEL_ID} label.sa-check input {
            width: auto !important; height: auto; margin: 0 !important; flex: none !important; float: none !important;
        }
        #${PANEL_ID} label.sa-check span { flex: 1; }
        #${PANEL_ID} .sa-colors { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; font-size: 11px; }
        #${PANEL_ID} .sa-colors input[type=color] {
            width: 44px !important; height: 20px; padding: 0; border: 1px solid var(--border);
            border-radius: 3px; background: transparent; cursor: pointer;
        }
        #${PANEL_ID} .sa-form3 {
            display: grid; grid-template-columns: 1fr 74px 74px 12px; gap: 3px 6px; align-items: center; font-size: 11px;
        }
        #${PANEL_ID} .sa-form3 input {
            background: var(--inset); border: 1px solid var(--border); color: var(--text); border-radius: 3px;
            padding: 2px 5px; font-size: 11px; width: 100% !important; box-sizing: border-box; margin: 0 !important;
            font-family: "SF Mono", Menlo, monospace; user-select: text;
        }
        #${PANEL_ID} .sa-form3 .sa-h { font-size: 9px; color: var(--muted); text-transform: uppercase; text-align: center; }
        #${PANEL_ID} .sa-form3 .sa-sub { grid-column: 1 / -1; font-size: 9px; color: var(--muted);
            text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; border-bottom: 1px solid var(--line); }
        #${PANEL_ID} details.sa-dd { border-bottom: 1px solid var(--row); }
        #${PANEL_ID} details.sa-dd > summary {
            list-style: none; cursor: pointer; display: flex; gap: 6px; align-items: baseline;
            padding: 3px 2px; font-size: 11px;
        }
        #${PANEL_ID} details.sa-dd > summary::-webkit-details-marker { display: none; }
        #${PANEL_ID} details.sa-dd > summary::before {
            content: '▸'; color: var(--muted); font-size: 9px; width: 8px; flex: none;
        }
        #${PANEL_ID} details.sa-dd[open] > summary::before { content: '▾'; }
        #${PANEL_ID} details.sa-dd > summary:hover { background: var(--hover); }
        #${PANEL_ID} .sa-dd-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #${PANEL_ID} .sa-dd-val { color: var(--num); font-family: "SF Mono", Menlo, monospace; white-space: nowrap; }
        #${PANEL_ID} .sa-dd-days { width: 34px; text-align: right; font-family: "SF Mono", Menlo, monospace;
            color: var(--muted); white-space: nowrap; flex: none; }
        #${PANEL_ID} .sa-dd-body { padding: 0 0 4px 14px; font-size: 10px; }
        #${PANEL_ID} .sa-dd-row { display: flex; gap: 6px; padding: 1px 0; color: var(--soft); }
        #${PANEL_ID} .sa-dd-row .sa-dd-name { white-space: normal; }
        #${PANEL_ID} .sa-dd-head { display: flex; gap: 6px; padding: 2px 2px 2px 16px; font-size: 9px;
            color: var(--muted); text-transform: uppercase; border-bottom: 1px solid var(--line); }
        #${PANEL_ID} .sa-scroll { overflow-x: auto; }
        #${PANEL_ID} .sa-scroll table.sa-unit-table th:first-child,
        #${PANEL_ID} .sa-scroll table.sa-unit-table td:first-child {
            position: sticky; left: 0; background: var(--surface); z-index: 1; min-width: 90px;
        }
        #${PANEL_ID} .sa-scroll table.sa-unit-table td.sa-num,
        #${PANEL_ID} .sa-scroll table.sa-unit-table th { white-space: nowrap; }
        #${PANEL_ID} .sa-popup {
            position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000000;
            display: flex; align-items: center; justify-content: center;
        }
        #${PANEL_ID} .sa-popup-box {
            width: 320px; background: var(--surface); color: var(--text);
            border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6); user-select: text;
        }
        #${PANEL_ID} .sa-popup-head {
            padding: 8px 12px; font-weight: 600;
            background: linear-gradient(90deg, var(--head1), var(--head2));
            border-bottom: 1px solid var(--border);
        }
        #${PANEL_ID} .sa-popup-body { padding: 12px; font-size: 12px; line-height: 1.5; }
        #${PANEL_ID} .sa-popup-body b { color: var(--accent); }
        #${PANEL_ID} .sa-popup-foot { padding: 0 12px 12px; text-align: right; }
        #${PANEL_ID} .sa-empty {
            color: var(--dim); font-style: italic; padding: 8px; text-align: center;
            font-size: 11px;
        }
        #${PANEL_ID} .sa-slot-actions { display: flex; gap: 2px; align-items: center; }
        #${PANEL_ID} .sa-chevron {
            background: transparent; border: none; color: var(--muted);
            cursor: pointer; font-size: 14px; padding: 0 4px; line-height: 1;
            transition: transform 0.15s;
        }
        #${PANEL_ID} .sa-chevron:hover { color: var(--text); }
        #${PANEL_ID} .sa-slot.collapsed .sa-slot-body { display: none; }
        #${PANEL_ID} .sa-slot.collapsed .sa-chevron { transform: rotate(-90deg); }
    `;
    document.head.appendChild(style);

    // ---------- panel ----------
    // The game is a single-page app: moving between pages changes the URL
    // without reloading, so the current page is re-checked before every scan.
    let pageKey = currentPageKey();
    const pageLabel = pageKey ? PAGES[pageKey].label : 'Unknown';
    function refreshPage() {
        pageKey = currentPageKey();
        const badge = document.getElementById('sa-page-badge');
        if (badge) badge.textContent = pageKey ? PAGES[pageKey].label : 'Unknown';
        return pageKey;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
        <div class="sa-header">
            <span>
                <span class="sa-title">🦈 SHARKBOT</span>
                <span class="sa-ver">v${VERSION}</span>
                <span class="sa-page" id="sa-page-badge">${pageLabel}</span>
            </span>
            <div>
                <button class="sa-btn" id="sa-scan">Scan</button>
                <button class="sa-btn" id="sa-toggle">−</button>
            </div>
        </div>
        <div class="sa-maintabs">
            <div class="sa-mtab" data-group="general">General</div>
            <div class="sa-mtab" data-group="data">Data</div>
            <div class="sa-mtab" data-group="calculators">Calculators</div>
        </div>
        <div class="sa-tabs">
            <div class="sa-tab active" data-tab="debug">Debug</div>
            <div class="sa-tab" data-tab="settings">⚙ Settings</div>
            <div class="sa-tab-label" data-group="data" title="Shared by all your planets">Empire</div>
            <div class="sa-tab" data-tab="research">Research</div>
            <div class="sa-tab" data-tab="market">Market</div>
            <div class="sa-tab" data-tab="bank">Bank</div>
            <div class="sa-tab" data-tab="cards">Cards</div>
            <div class="sa-tab-break" data-group="data"></div>
            <div class="sa-tab-label" data-group="data" title="Saved separately for each planet">Planet</div>
            <div class="sa-tab" data-tab="units">Units</div>
            <div class="sa-tab" data-tab="facilities">Facilities</div>
            <div class="sa-tab" data-tab="inventory">Inventory</div>
            <div class="sa-tab" data-tab="nation">Nation</div>
            <div class="sa-tab" data-tab="creditgen">Credit Gen</div>
            <div class="sa-tab" data-tab="turns">Turn Gen</div>
            <div class="sa-tab" data-tab="resgen">Resource Gen</div>
            <div class="sa-tab" data-tab="area">Area Size</div>
            <div class="sa-tab" data-tab="optimizer">Best Spend</div>
        </div>
        <div class="sa-body">
            <div class="sa-pane active" data-pane="debug">
                <div class="sa-section">
                    <div class="sa-label">Status</div>
                    <div class="sa-value" id="sa-status">idle · v${VERSION}</div>
                    <div class="sa-value" id="sa-planet" style="color:var(--muted); font-size:10px"></div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Recommendation</div>
                    <div class="sa-recommend" id="sa-recommend">—</div>
                </div>
                <div class="sa-section">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="sa-label">Scan Output</div>
                        <button class="sa-btn" id="sa-copy"
                                title="Copy last scan to clipboard">⧉ Copy</button>
                    </div>
                    <pre class="sa-dump" id="sa-dump">(click Scan)</pre>
                </div>
            </div>
            <div class="sa-pane" data-pane="units">
                <div class="sa-section">
                    <div class="sa-label">Saved Planets</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 8px;">
                        Save scans the current page and stores everything for that planet
                        (inventory always; units/facilities when you're on those pages).
                    </div>
                </div>
                <div id="sa-units-compare"></div>
                <div id="sa-slots"></div>
            </div>
            <div class="sa-pane" data-pane="research">
                <div class="sa-section">
                    <div class="sa-label">Saved Research (galaxy-wide)</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 8px;">
                        Research applies to every planet, so there's one shared slot.
                        On the Research page, hit Scan then Save. Saving again overwrites it.
                        Scientist counts are per planet and live in the Units tab.
                    </div>
                </div>
                <div class="sa-section" id="sa-bd-view"></div>
                <div id="sa-rslot-A"></div>
            </div>
            <div class="sa-pane" data-pane="facilities">
                <div class="sa-section">
                    <div class="sa-label">Saved Facilities</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 8px;">
                        On the Facilities page, hit Scan then Save to a slot.
                        Saving again overwrites that slot.
                    </div>
                </div>
                <div id="sa-fac-compare"></div>
                <div id="sa-fslots"></div>
            </div>
            <div class="sa-pane" data-pane="market">
                <div class="sa-section">
                    <div class="sa-label">Market Prices</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 8px;">
                        On the Market page, hit Scan to refresh the price list.
                        Prices are live — not saved across slots.
                    </div>
                </div>
                <div id="sa-market-view"></div>
            </div>
            <div class="sa-pane" data-pane="creditgen">
                <div class="sa-section sa-bd-bar"></div>
                <div class="sa-section" style="display:flex; gap:6px; align-items:center;">
                    <div class="sa-label" style="margin:0">Planet</div>
                    <select class="sa-select" id="sa-tg-slot" style="width:auto"></select>
                    <button class="sa-btn" id="sa-tg-fill"
                            title="Fill from this planet's saved Units / Research / Facilities slots">Fill from saved</button>
                </div>
                <div class="sa-section">
                    <div class="sa-form" id="sa-tg-form"></div>
                    <div style="font-size:10px; color:var(--muted); margin-top:4px">
                        Accepts game notation (33 T, 1.5 Quintillion). ● = filled from saved data.
                    </div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Daily assumptions</div>
                    <div class="sa-form" id="sa-cg-assume">
                        <label for="sa-cg-ticks">Ticks per day (passive)</label>
                        <input id="sa-cg-ticks" data-k="ticksPerDay" /><span></span>
                        <label for="sa-cg-turns">Turns printed per print day</label>
                        <input id="sa-cg-turns" data-k="turnsPerDay" /><span></span>
                        <label for="sa-cg-days">Print days per week</label>
                        <input id="sa-cg-days" data-k="printDays" /><span></span>
                    </div>
                    <div style="font-size:10px; color:var(--muted); margin-top:4px">
                        Defaults: one tick per minute (1,440/day); 2 prints a day, 100,000 turns in total; printing on 5 of 7 days.
                    </div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Credit Generation</div>
                    <div class="sa-recommend" id="sa-tg-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="area">
                <div class="sa-section sa-bd-bar"></div>
                <div class="sa-section" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
                    <div class="sa-label" style="margin:0">Planet</div>
                    <select class="sa-select" id="sa-ar-slot" style="width:auto"></select>
                    <select class="sa-select" id="sa-ar-area" style="width:auto"></select>
                </div>
                <div class="sa-section">
                    <div class="sa-form" id="sa-ar-form"></div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Area upgrade</div>
                    <div class="sa-recommend" id="sa-ar-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="resgen">
                <div class="sa-section sa-bd-bar"></div>
                <div class="sa-section" style="display:flex; gap:6px; align-items:center;">
                    <div class="sa-label" style="margin:0">Planet</div>
                    <select class="sa-select" id="sa-rg-slot" style="width:auto"></select>
                    <button class="sa-btn" id="sa-rg-fill" title="Refill every input from saved data">Fill from saved</button>
                </div>
                <div class="sa-section">
                    <div class="sa-form3" id="sa-rg-form"></div>
                    <div style="font-size:10px; color:var(--muted); margin-top:4px">
                        Leave a Compare box empty to use the Now value. ● = filled from saved data.
                    </div>
                </div>
                <div class="sa-section">
                    <div class="sa-form" id="sa-rg-shared"></div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Resource generation</div>
                    <div class="sa-recommend" id="sa-rg-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="turns">
                <div class="sa-section sa-bd-bar"></div>
                <div class="sa-section" style="display:flex; gap:6px; align-items:center;">
                    <div class="sa-label" style="margin:0">Planet</div>
                    <select class="sa-select" id="sa-tn-slot" style="width:auto"></select>
                    <button class="sa-btn" id="sa-tn-fill"
                            title="Use this planet's saved Tick Generator level as the starting level">Use saved level</button>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Tick Generator upgrade</div>
                    <div class="sa-form" id="sa-tn-form"></div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Upgrade cost &amp; TPM</div>
                    <div class="sa-recommend" id="sa-tn-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="optimizer">
                <div class="sa-section">
                    <div class="sa-label">Best spend (all planets)</div>
                    <div style="font-size:10px; color:var(--muted)">
                        Splits all your capital (credits, bank, sellable resources) between Area upgrades and
                        Tick Generators on every saved planet, putting each slice where it adds the most credits per day.
                    </div>
                </div>
                <div class="sa-section sa-bd-bar"></div>
                <div class="sa-section">
                    <div class="sa-label">Credit value of brains, diamonds &amp; SSB</div>
                    <div class="sa-form" id="sa-bd-form"></div>
                    <div style="font-size:10px; color:var(--muted); margin-top:4px">
                        Used only when its tick box is on. Empty = market sell price, if the market lists them.
                    </div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Plan</div>
                    <div class="sa-recommend" id="sa-opt-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="cards">
                <div class="sa-section">
                    <div class="sa-label">Hero cards (account-wide)</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">
                        Open Cards → All Hero cards (My collection) and click Scan.
                    </div>
                </div>
                <div id="sa-cards-view"></div>
            </div>
            <div class="sa-pane" data-pane="nation">
                <div class="sa-section">
                    <div class="sa-label">Nation (per planet)</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">
                        Open the Nation page and click Scan for each planet.
                    </div>
                </div>
                <div id="sa-nation-view"></div>
            </div>
            <div class="sa-pane" data-pane="settings">
                <div class="sa-section">
                    <div class="sa-label">Planets</div>
                    <div style="font-size:10px; color:var(--muted); margin-bottom:6px">
                        Up to 10 planets. New planets are added when you Scan them. Rename a planet to
                        match its in-game name exactly; Remove deletes that planet's saved data.
                    </div>
                    <div id="sa-planet-list"></div>
                </div>
                <div class="sa-section" style="margin-top:14px">
                    <div class="sa-label">Color scheme</div>
                    <div id="sa-theme-list" style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:4px"></div>
                    <details class="sa-dd" id="sa-custom-dd" style="margin-top:8px; border:1px solid var(--line); border-radius:4px; padding:2px 6px">
                        <summary><span class="sa-dd-name">Customize colors</span></summary>
                        <div id="sa-custom-colors" style="padding:6px 0 4px"></div>
                    </details>
                </div>
                <div class="sa-section" style="margin-top:14px">
                    <div class="sa-label">Scanning</div>
                    <label class="sa-check">
                        <input type="checkbox" id="sa-autoscan" />
                        <span>Scan automatically whenever the game page changes</span>
                    </label>
                </div>
                <div class="sa-section" style="margin-top:14px">
                    <div class="sa-label">Tutorial</div>
                    <button class="sa-btn" id="sa-tut-restart" style="margin:0; width:100%">Restart tutorial</button>
                </div>
                <div class="sa-section" style="margin-top:14px">
                    <div class="sa-label">Saved data</div>
                    <div style="font-size:10px; color:var(--muted); margin-bottom:6px">
                        Erases every planet slot, research, market prices, bank data and calculator
                        inputs. Your color scheme and panel layout are kept.
                    </div>
                    <button class="sa-btn sa-btn-danger" id="sa-reset-all" style="margin:0; width:100%">
                        Reset all saved data</button>
                    <div class="sa-value" id="sa-reset-msg" style="font-size:10px; margin-top:4px"></div>
                </div>
            </div>
            <div class="sa-pane" data-pane="bank">
                <div class="sa-section">
                    <div class="sa-label">Central Bank (all planets)</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">
                        Go to /bank, open the Central bank tab, then click Scan.
                    </div>
                </div>
                <div id="sa-bank-view"></div>
            </div>
            <div class="sa-pane" data-pane="inventory">
                <div class="sa-section">
                    <div class="sa-label">Stored Resources</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">
                        Reads the resource bar at the top of the page. Works on any page.
                        Switch to a planet in-game, then save it to its slot.
                    </div>
                    <div style="display:flex; gap:4px; flex-wrap:wrap" id="sa-inv-actions"></div>
                </div>
                <div id="sa-inv-view"></div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // ---------- Themes ----------
    const THEMES = {
        navy: { label: 'Navy (default)', vars: {
            bg: 'rgba(15, 20, 35, 0.95)', head1: '#1e2a44', head2: '#2a3a5c', hover: '#1e2a44',
            surface: '#141a2d', surface2: '#1a2238', inset: '#0d1324', btn: '#2a3a5c',
            border: '#3a4a6b', line: '#2a3a5c', row: 'rgba(58, 74, 107, 0.3)',
            text: '#e8ecf5', soft: '#a8b8d8', muted: '#8a9bbd', dim: '#6a7a9b',
            accent: '#7fd4a8', 'accent-bg': '#1e3a34', num: '#7fd4a8',
            pos: '#7fd4a8', neg: '#e87f7f', warn: '#e8b75f', danger: '#8b3a3a' } },
        crimson: { label: 'Crimson', vars: {
            bg: 'rgba(22, 12, 16, 0.96)', head1: '#3d1620', head2: '#1f0f14', hover: '#2c161c',
            surface: '#1b0f14', surface2: '#241419', inset: '#110a0d', btn: '#34191f',
            border: '#4f2a33', line: '#33191f', row: 'rgba(79, 42, 51, 0.35)',
            text: '#f6e9ec', soft: '#dcc3c9', muted: '#c98e9b', dim: '#7d5d65',
            accent: '#ff6b81', 'accent-bg': '#3a1720', num: '#ffa3b1',
            pos: '#7fd6a0', neg: '#ff5c6c', warn: '#f5c26b', danger: '#a8323f' } },
        ember: { label: 'Ember', vars: {
            bg: 'rgba(23, 17, 13, 0.96)', head1: '#4a2a14', head2: '#1f1712', hover: '#2c2018',
            surface: '#1c1511', surface2: '#261c16', inset: '#120d0a', btn: '#352519',
            border: '#523a29', line: '#32241a', row: 'rgba(82, 58, 41, 0.35)',
            text: '#fbf0e6', soft: '#e2cdb8', muted: '#d39462', dim: '#85705f',
            accent: '#ff8a3d', 'accent-bg': '#3d2414', num: '#ffb27a',
            pos: '#9ad67e', neg: '#ff6a55', warn: '#ffd27a', danger: '#b0441c' } },
        amber: { label: 'Amber', vars: {
            bg: 'rgba(21, 19, 12, 0.96)', head1: '#46391a', head2: '#1d1a10', hover: '#2a2516',
            surface: '#1a170f', surface2: '#242014', inset: '#100e09', btn: '#332c1a',
            border: '#51462a', line: '#2f2a19', row: 'rgba(81, 70, 42, 0.35)',
            text: '#fbf6e6', soft: '#e4d9b8', muted: '#cdb06a', dim: '#8a7f60',
            accent: '#f5b83d', 'accent-bg': '#3b2f12', num: '#ffd27a',
            pos: '#a8d67a', neg: '#ff7a5c', warn: '#ffe08a', danger: '#a8641c' } },
        sunset: { label: 'Sunset', vars: {
            bg: 'rgba(23, 16, 32, 0.96)', head1: '#4a2048', head2: '#22152c', hover: '#2d1d38',
            surface: '#1c1326', surface2: '#261a33', inset: '#110b18', btn: '#36223f',
            border: '#553760', line: '#33203d', row: 'rgba(85, 55, 96, 0.35)',
            text: '#f8eef6', soft: '#e0cbe0', muted: '#d29ac0', dim: '#86708a',
            accent: '#ff8f6b', 'accent-bg': '#3d1f30', num: '#ffb38f',
            pos: '#8fd6b0', neg: '#ff6b8a', warn: '#ffcc70', danger: '#b0304a' } },
        tangerine: { label: 'Tangerine', vars: {
            bg: 'rgba(18, 20, 24, 0.96)', head1: '#33261c', head2: '#191c21', hover: '#23272e',
            surface: '#16191e', surface2: '#1e2228', inset: '#0e1013', btn: '#2a2e35',
            border: '#3c424c', line: '#262a31', row: 'rgba(60, 66, 76, 0.35)',
            text: '#f1f2f4', soft: '#c9ced6', muted: '#e0975a', dim: '#6d747e',
            accent: '#ff7a1a', 'accent-bg': '#3a2414', num: '#ffa45c',
            pos: '#7fd48f', neg: '#ff5d5d', warn: '#ffc35a', danger: '#a8401c' } },
        emerald: { label: 'Emerald', vars: {
            bg: 'rgba(12, 21, 18, 0.96)', head1: '#164032', head2: '#0f1d18', hover: '#172a22',
            surface: '#101b17', surface2: '#16241f', inset: '#09110e', btn: '#1d3129',
            border: '#2f4a3f', line: '#1c2e27', row: 'rgba(47, 74, 63, 0.35)',
            text: '#e9f6f0', soft: '#bfdccf', muted: '#7fbfa2', dim: '#5c7a6d',
            accent: '#4fd69c', 'accent-bg': '#133528', num: '#8be3bb',
            pos: '#a0e57a', neg: '#ff7a6b', warn: '#e8d25f', danger: '#8b3a3a' } },
        mono: { label: 'Graphite', vars: {
            bg: 'rgba(18, 19, 20, 0.96)', head1: '#2c2e32', head2: '#18191b', hover: '#232528',
            surface: '#17181a', surface2: '#1f2023', inset: '#0e0f10', btn: '#2a2c30',
            border: '#3d4045', line: '#26282b', row: 'rgba(61, 64, 69, 0.35)',
            text: '#f0f1f2', soft: '#c8cacd', muted: '#9a9ea4', dim: '#6a6e74',
            accent: '#e6e8eb', 'accent-bg': '#33363b', num: '#d0d4da',
            pos: '#8fd49c', neg: '#ef8a8a', warn: '#e8c46a', danger: '#7a3a3a' } },
    };
    // Custom theme = a preset as the base, plus the colors the user picked
    const CUSTOM_KEYS = [
        ['bg', 'Background'], ['head1', 'Header (left)'], ['head2', 'Header (right)'],
        ['surface', 'Panels'], ['surface2', 'Boxes'], ['btn', 'Buttons'], ['border', 'Borders'],
        ['text', 'Text'], ['muted', 'Labels'], ['accent', 'Highlight'], ['num', 'Numbers'],
        ['pos', 'Positive'], ['neg', 'Negative'], ['warn', 'Warning'],
    ];
    function toHex(c) {
        if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
        const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        return m ? '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('') : '#000000';
    }
    const rgba = (hex, a) => {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
    };
    function customTheme() {
        const c = GM_getValue('sa-theme-custom', null) || { base: 'navy', colors: {} };
        const base = THEMES[c.base] || THEMES.navy;
        const v = Object.assign({}, base.vars);
        const col = c.colors || {};
        Object.entries(col).forEach(([k, hex]) => { v[k] = hex; });
        // Derived colors follow the picks so everything stays consistent
        if (col.bg) v.bg = rgba(col.bg, 0.96);
        if (col.border) v.row = rgba(col.border, 0.25);
        if (col.accent) v['accent-bg'] = rgba(col.accent, 0.18);
        if (col.head2) v.hover = col.head2;
        if (col.surface && !col.inset) v.inset = col.surface;
        return { label: 'Custom', vars: v, base: c.base, colors: col };
    }
    function themeVars(key) { return key === 'custom' ? customTheme().vars : (THEMES[key] || THEMES.navy).vars; }
    function applyTheme(key) {
        Object.entries(themeVars(key)).forEach(([k, v]) => panel.style.setProperty('--' + k, v));
    }
    applyTheme(GM_getValue('sa-theme', 'navy'));

    // ---------- drag ----------
    const header = panel.querySelector('.sa-header');
    let dragging = false, offX = 0, offY = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        offX = e.clientX - panel.offsetLeft;
        offY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = (e.clientX - offX) + 'px';
        panel.style.top = (e.clientY - offY) + 'px';
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    // ---------- collapse (persisted) ----------
    const collapsed = GM_getValue('sa-collapsed', false);
    if (collapsed) {
        panel.classList.add('collapsed');
        document.getElementById('sa-toggle').textContent = '+';
    }
    document.getElementById('sa-toggle').addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        const isCol = panel.classList.contains('collapsed');
        document.getElementById('sa-toggle').textContent = isCol ? '+' : '−';
        GM_setValue('sa-collapsed', isCol);
    });

    // ---------- tabs ----------
    let activeTab = GM_getValue('sa-active-tab', 'debug');
    // Migrate legacy value
    if (activeTab === 'main') activeTab = 'debug';
    if (activeTab === 'turngen') activeTab = 'creditgen'; // renamed in v0.18
    // Three main tabs; every subtab belongs to one of them
    const TAB_GROUPS = {
        general:     ['debug', 'settings'],
        data:        ['research', 'market', 'bank', 'cards', 'units', 'facilities', 'inventory', 'nation'],
        calculators: ['creditgen', 'turns', 'resgen', 'area', 'optimizer'],
    };
    const groupOf = (tab) => Object.keys(TAB_GROUPS).find(g => TAB_GROUPS[g].includes(tab)) || 'general';
    if (!Object.values(TAB_GROUPS).flat().includes(activeTab)) activeTab = 'debug';
    switchTab(activeTab);
    panel.querySelectorAll('.sa-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    panel.querySelectorAll('.sa-mtab').forEach(m => {
        m.addEventListener('click', () => {
            const g = m.dataset.group;
            const last = GM_getValue('sa-last-sub-' + g, TAB_GROUPS[g][0]);
            switchTab(TAB_GROUPS[g].includes(last) ? last : TAB_GROUPS[g][0]);
        });
    });
    function switchTab(name) {
        const group = groupOf(name);
        panel.querySelectorAll('.sa-mtab').forEach(m =>
            m.classList.toggle('active', m.dataset.group === group));
        panel.querySelectorAll('.sa-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === name);
            t.classList.toggle('sa-hidden', !TAB_GROUPS[group].includes(t.dataset.tab));
        });
        panel.querySelectorAll('.sa-tab-label, .sa-tab-break').forEach(el =>
            el.classList.toggle('sa-hidden', el.dataset.group !== group));
        panel.querySelectorAll('.sa-pane').forEach(p =>
            p.classList.toggle('active', p.dataset.pane === name));
        GM_setValue('sa-active-tab', name);
        GM_setValue('sa-last-sub-' + group, name);
    }

    // ---------- generic scanner ----------
    function scanGeneric() {
        let inventory = null, colony = null;
        try { inventory = readInventory(); } catch (e) { inventory = { error: e.message }; }
        try { colony = readColony(); } catch (e) { colony = { error: e.message }; }
        return {
            version: VERSION,
            colony,
            inventory,
            page: pageKey || '(unknown)',
            url: location.pathname,
            mainTags: ['main', '#app', '#root', '.content', '.container']
                .map(sel => ({ sel, found: !!document.querySelector(sel) })),
            resourceCandidates: findResourceCandidates(),
            tables: document.querySelectorAll('table').length,
            actionButtons: Array.from(document.querySelectorAll('button, a.btn, input[type=submit]'))
                .slice(0, 15)
                .map(b => (b.textContent || b.value || '').trim().slice(0, 40))
                .filter(Boolean),
            globals: ['game', 'state', 'app', 'player', 'nation', 'store', 'Vue', 'React']
                .filter(k => typeof window[k] !== 'undefined'),
        };
    }

    function findResourceCandidates() {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        const re = /^[\s$€£]*[\d][\d,.\s]*[kKmMbBtTqQ]?[\s%]*$/;
        let n, count = 0;
        while ((n = walker.nextNode()) && count < 20) {
            const t = n.textContent.trim();
            if (t.length > 0 && t.length < 15 && re.test(t)) {
                const parent = n.parentElement;
                if (!parent || parent.closest(`#${PANEL_ID}`)) continue;
                const label = (parent.getAttribute('aria-label')
                    || parent.getAttribute('title')
                    || parent.previousElementSibling?.textContent
                    || parent.parentElement?.firstElementChild?.textContent
                    || '').trim().slice(0, 30);
                out.push({ label, value: t });
                count++;
            }
        }
        return out;
    }

    // ---------- train-units scanner ----------
    function scanTrainUnits() {
        const base = scanGeneric();
        const container = document.querySelector('#workers_div');
        if (!container) {
            base.trainUnits = { error: '#workers_div not found on this page' };
            return base;
        }

        const tables = container.querySelectorAll('table');
        const parsed = [];

        tables.forEach((table, tIdx) => {
            const rows = Array.from(table.querySelectorAll('tr'));
            const cellsPerRow = rows.map(r => r.querySelectorAll('td').length);
            const mostlySingleCell = cellsPerRow.filter(n => n === 1).length > rows.length / 2;
            const units = [];

            if (mostlySingleCell) {
                for (let i = 0; i < rows.length; i += 2) {
                    const nameCell = rows[i]?.querySelector('td');
                    const countCell = rows[i + 1]?.querySelector('td');
                    if (!nameCell) continue;
                    const name = (nameCell.textContent || '').trim();
                    if (!name) continue;
                    const read = readCount(countCell);
                    units.push({
                        name,
                        count: read.count,
                        countRaw: read.raw,
                        source: read.source, // 'amount-span' | 'td-text'
                    });
                }
            } else {
                rows.forEach(r => {
                    const tds = Array.from(r.querySelectorAll('td'));
                    if (tds.length < 2) return;
                    const name = (tds[0].textContent || '').trim();
                    if (!name) return;
                    const extras = tds.slice(1).map(td => (td.textContent || '').trim());
                    units.push({
                        name, count: parseNumber(extras[0]), countRaw: extras[0],
                        other: extras.slice(1),
                    });
                });
            }
            parsed.push({ tableIndex: tIdx, rowCount: rows.length,
                layout: mostlySingleCell ? 'alternating' : 'multi-column', units });
        });

        const allUnits = parsed.flatMap(t => t.units);
        // Tally which DOM source each count came from, so we can
        // spot the planet-B pattern (amount/span) vs planet-A (td-direct)
        const sourceTally = {};
        allUnits.forEach(u => {
            const s = u.source || 'unknown';
            sourceTally[s] = (sourceTally[s] || 0) + 1;
        });
        const dominantSource = Object.entries(sourceTally)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

        base.trainUnits = {
            unitCount: allUnits.length,
            units: allUnits.map(u => ({
                name: u.name, count: u.count, countDisplay: u.countRaw,
                source: u.source,
            })),
            totalPopulation: allUnits.reduce((s, u) => s + (u.count || 0), 0),
            dominantSource,
            sourceTally,
            _debug: { tableCount: tables.length, tables: parsed },
        };
        return base;
    }

    // ---------- research scanner ----------
    // Grabs every table on the research page and keeps ones that look like
    // a "name + number(s)" list.
    function scanResearch() {
        const base = scanGeneric();

        // Candidate containers to try first
        // On the real page the research levels live in #workers_div (like units)
        const candidates = ['#workers_div', '#research_div', '#research', '#tech_div', '#techs_div', 'main'];
        let container = null;
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) { container = el; break; }
        }
        if (!container) container = document.body;

        const tables = Array.from(container.querySelectorAll('table'));
        const items = [];
        const perTable = [];

        tables.forEach((table, tIdx) => {
            const rows = Array.from(table.querySelectorAll('tr'));
            const tableItems = [];

            // Pattern A: alternating single-cell rows (name, level/value, ...)
            const cellCounts = rows.map(r => r.querySelectorAll('td').length);
            const mostlySingle = cellCounts.filter(n => n === 1).length > rows.length / 2;

            if (mostlySingle && rows.length >= 2) {
                for (let i = 0; i < rows.length; i += 2) {
                    const n = rows[i]?.querySelector('td');
                    const v = rows[i + 1]?.querySelector('td');
                    if (!n) continue;
                    const name = (n.textContent || '').trim();
                    const valRaw = (v?.textContent || '').trim();
                    if (!name) continue;
                    tableItems.push({ name, value: parseNumber(valRaw), valueRaw: valRaw });
                }
            } else {
                // Pattern B: multi-column rows (name, level, cost, ...)
                rows.forEach(r => {
                    const tds = Array.from(r.querySelectorAll('td'));
                    if (tds.length < 2) return;
                    const name = (tds[0].textContent || '').trim();
                    if (!name) return;
                    const extras = tds.slice(1).map(td => (td.textContent || '').trim());
                    tableItems.push({
                        name, value: parseNumber(extras[0]), valueRaw: extras[0],
                        other: extras.slice(1),
                    });
                });
            }

            // Only keep tables that produced plausible research rows
            // (at least one entry with a numeric value)
            const hasNumeric = tableItems.some(i => i.value != null);
            if (hasNumeric && tableItems.length > 0) {
                perTable.push({ tableIndex: tIdx, rowCount: rows.length,
                    layout: mostlySingle ? 'alternating' : 'multi-column',
                    items: tableItems });
                items.push(...tableItems);
            }
        });

        // Deduplicate by name, keeping the first occurrence
        const seen = new Set();
        const unique = [];
        for (const it of items) {
            if (seen.has(it.name)) continue;
            seen.add(it.name);
            unique.push(it);
        }

        base.research = {
            containerTried: container === document.body ? '(fallback: body)'
                : container.id ? '#' + container.id : container.tagName.toLowerCase(),
            itemCount: unique.length,
            items: unique.map(i => ({
                name: i.name, value: i.value, valueDisplay: i.valueRaw,
                other: i.other || [],
            })),
            _debug: { tableCount: tables.length, matched: perTable.length, perTable },
        };
        base.researchCurrency = readResearchCurrency(unique);
        return base;
    }

    // ---------- market scanner ----------
    // Each resource is a card:
    //   <div class="clean_table">
    //     <h4> Coal</h4> <img alt="coal">
    //     <div> <table><tr>
    //       <td><amount><span class="shiney2" title="72,898,021,550.361">72.898 B</span></amount></td>  <- BUY
    //       <td><amount><span title="...">70.039 B</span></amount></td>                                <- SELL
    //     </tr><tr> [BUY] [SELL] </tr></table> </div>
    //   </div>
    // The game briefly renders "???" while refreshing values, so we sample
    // the cards several times over ~2.5s and keep any real value we see.
    const MARKET_SAMPLES = 6;
    const MARKET_INTERVAL_MS = 400;

    function readAmountCell(td) {
        if (!td) return { value: null, display: '???', exact: null };
        // Prefer the span carrying the full-precision title
        const titled = td.querySelector('amount span[title], span[title]');
        if (titled) {
            const exact = parseNumber(titled.getAttribute('title'));
            const display = (titled.textContent || '').trim();
            if (exact != null) return { value: exact, display: display || fmt(exact), exact };
        }
        // Fall back to visible text
        const txt = (td.textContent || '').replace(/\s+/g, ' ').trim();
        return { value: parseNumber(txt), display: txt || '???', exact: null };
    }

    function readMarketCardsOnce() {
        const cards = Array.from(document.querySelectorAll('div.clean_table'))
            .filter(c => c.querySelector('h4') && c.querySelector('amount'));
        return cards.map(card => {
            const name = (card.querySelector('h4').textContent || '').trim();
            const img = card.querySelector('img');
            const firstRow = card.querySelector('table tr');
            const tds = firstRow ? Array.from(firstRow.querySelectorAll(':scope > td')) : [];
            const buy = readAmountCell(tds[0]);
            const sell = readAmountCell(tds[1]);
            return {
                name,
                key: (img && img.getAttribute('alt')) || name.toLowerCase(),
                buyPrice: buy.value, buyPriceDisplay: buy.display,
                sellPrice: sell.value, sellPriceDisplay: sell.display,
            };
        });
    }

    async function scanMarket() {
        const base = scanGeneric();
        const merged = new Map(); // name -> resource, keeping best values seen
        let samples = 0;

        for (let i = 0; i < MARKET_SAMPLES; i++) {
            const snap = readMarketCardsOnce();
            samples++;
            snap.forEach(r => {
                const prev = merged.get(r.name);
                if (!prev) { merged.set(r.name, { ...r }); return; }
                if (prev.buyPrice == null && r.buyPrice != null) {
                    prev.buyPrice = r.buyPrice; prev.buyPriceDisplay = r.buyPriceDisplay;
                }
                if (prev.sellPrice == null && r.sellPrice != null) {
                    prev.sellPrice = r.sellPrice; prev.sellPriceDisplay = r.sellPriceDisplay;
                }
            });
            const unresolved = [...merged.values()]
                .filter(r => r.buyPrice == null || r.sellPrice == null).length;
            // Stop early once everything has resolved (some may stay ??? for real)
            if (merged.size > 0 && unresolved === 0) break;
            const status = document.getElementById('sa-status');
            if (status) status.textContent = `scanning market… sample ${i + 1}/${MARKET_SAMPLES}`;
            await new Promise(res => setTimeout(res, MARKET_INTERVAL_MS));
        }

        const resources = [...merged.values()];
        base.market = {
            resourceCount: resources.length,
            samples,
            stillUnknown: resources
                .filter(r => r.buyPrice == null || r.sellPrice == null)
                .map(r => r.name),
            resources,
        };
        return base;
    }

    function summarizeMarket(info) {
        const m = info.market;
        if (!m || !m.resources || m.resources.length === 0) return 'No market data.';
        const spread = m.resources
            .filter(r => r.buyPrice != null && r.sellPrice != null)
            .map(r => ({ name: r.name,
                spread: (r.buyPrice - r.sellPrice) / r.buyPrice,
                buy: r.buyPriceDisplay, sell: r.sellPriceDisplay }))
            .sort((a, b) => b.spread - a.spread).slice(0, 5);
        return [
            `${m.resourceCount} resources · ${m.cardsFound} cards`,
            'Widest BUY–SELL spreads:',
            ...spread.map(s => `  • ${s.name}: ${s.buy} / ${s.sell} (${(s.spread * 100).toFixed(1)}%)`),
        ].join('\n');
    }

    // ---------- facilities scanner ----------
    // The Facilities page has sub-views (New view / Resources / Military / Areas).
    // Two card kinds:
    //   facility: title "Income Facility (2501)"  + output line + maintenance
    //   area:     title "Industrial Area LVL: 5,333,360" + "97% Full"
    // We read whatever is visible on screen; Save merges by kind.
    const FAC_TITLE_RE = /^([A-Za-z][A-Za-z .'+&-]*?)\s*\(([\d,]+)\)$/;
    const AREA_TITLE_RE = /^([A-Za-z][A-Za-z .'+&-]*?)\s*LVL:\s*([\d,.]+)$/i;
    const FAC_BLOCKLIST = /^(reports|rank)$/i;

    function normText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { return !!(el.offsetParent || el.getClientRects().length); }
    function cardLines(el) {
        return (el.innerText || el.textContent || '').split('\n')
            .map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }

    function findTitleElements(re) {
        const root = document.querySelector('main') || document.body;
        const out = [];
        root.querySelectorAll('*').forEach(el => {
            if (el.closest(`#${PANEL_ID}`) || el.closest('a, nav, button')) return;
            if (['SCRIPT', 'STYLE', 'IMG'].includes(el.tagName)) return;
            const t = normText(el);
            if (t.length > 60 || !re.test(t)) return;
            // keep the deepest element whose full text matches
            const childMatches = Array.from(el.children).some(c => re.test(normText(c)));
            if (childMatches || !isVisible(el)) return;
            out.push(el);
        });
        return out;
    }

    function cardFor(titleEl, marker) {
        let el = titleEl.parentElement;
        for (let i = 0; el && i < 7; i++, el = el.parentElement) {
            if (marker.test(el.textContent || '')) return el;
        }
        return titleEl.parentElement;
    }

    function sectionFor(card, titleEls) {
        let el = card.parentElement;
        for (let i = 0; el && i < 6; i++, el = el.parentElement) {
            const inside = titleEls.filter(t => el.contains(t)).length;
            if (inside > 1) {
                const first = cardLines(el)[0] || '';
                if (first.length < 40 && !FAC_TITLE_RE.test(first) && !AREA_TITLE_RE.test(first)) return first;
                return '';
            }
        }
        return '';
    }

    function scanFacilities() {
        const base = scanGeneric();
        const items = [];

        // Facility cards
        const facTitles = findTitleElements(FAC_TITLE_RE);
        facTitles.forEach(t => {
            const m = normText(t).match(FAC_TITLE_RE);
            const name = m[1].trim();
            if (FAC_BLOCKLIST.test(name)) return;
            const card = cardFor(t, /maintenance per tick/i);
            const lines = cardLines(card);
            const output = lines.find(l => /tick|capacity|storage|production/i.test(l)
                && !/maintenance/i.test(l) && !FAC_TITLE_RE.test(l)) || '';
            const mi = lines.findIndex(l => /maintenance per tick/i.test(l));
            const maintenance = mi >= 0 ? lines.slice(mi + 1).join(' · ') : '';
            items.push({
                kind: 'facility', name, section: sectionFor(card, facTitles),
                value: parseNumber(m[2]), valueDisplay: m[2],
                output, maintenance,
            });
        });

        // Area cards
        const areaTitles = findTitleElements(AREA_TITLE_RE);
        areaTitles.forEach(t => {
            const m = normText(t).match(AREA_TITLE_RE);
            const card = cardFor(t, /%\s*Full/i);
            const full = ((card.textContent || '').match(/(\d+(?:\.\d+)?)\s*%\s*Full/i) || [])[1];
            items.push({
                kind: 'area', name: m[1].trim(), section: 'Areas',
                value: parseNumber(m[2]), valueDisplay: m[2],
                fullPct: full != null ? parseFloat(full) : null,
                output: full != null ? `${full}% Full` : '',
            });
        });

        // Dedupe by kind+name
        const seen = new Set();
        const unique = items.filter(i => {
            const k = i.kind + '|' + i.name;
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });

        base.facilities = {
            itemCount: unique.length,
            facilityCount: unique.filter(i => i.kind === 'facility').length,
            areaCount: unique.filter(i => i.kind === 'area').length,
            kinds: [...new Set(unique.map(i => i.kind))],
            items: unique,
        };
        return base;
    }

    function summarizeFacilities(info) {
        const f = info.facilities;
        if (!f || !f.items || f.items.length === 0)
            return 'No facilities found. Switch to the old view (Resources, Military or Areas, not New view) and Scan again.';
        const lines = [`${f.facilityCount} facilities · ${f.areaCount} areas`];
        const inc = f.items.find(i => /income/i.test(i.name));
        if (inc) lines.push(`Income Facility: LVL ${inc.valueDisplay}`);
        f.items.slice(0, 6).forEach(i =>
            lines.push(`  • ${i.name}: ${i.valueDisplay}${i.output ? ' · ' + i.output : ''}`));
        if (f.items.length > 6) lines.push(`  … +${f.items.length - 6} more`);
        return lines.join('\n');
    }

    function summarizeResearch(info) {
        const r = info.research;
        if (!r || !r.items || r.items.length === 0)
            return 'No research found on this page. Copy the Scan Output below and send it so the scanner can be fixed.';
        const top = [...r.items].filter(i => i.value != null)
            .sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5);
        return [
            `${r.itemCount} research items · container: ${r.containerTried}`,
            'Top 5 by value:',
            ...top.map(i => `  • ${i.name}: ${i.valueDisplay}`),
            '',
            'Brains: ' + (info.researchCurrency?.brains ? info.researchCurrency.brains.display : 'not found') +
            ' · Diamonds: ' + (info.researchCurrency?.diamonds ? info.researchCurrency.diamonds.display : 'not found') +
            ' · SSB: ' + (info.researchCurrency?.ssb ? info.researchCurrency.ssb.display : 'not found'),
        ].join('\n');
    }

    // Read a unit count from a <td>, preferring an inner <amount><span>
    // when present (that's the "second planet" view structure).
    function readCount(td) {
        if (!td) return { count: null, raw: '', source: null };
        // Prefer amount > span, then amount, then span, then the td itself
        const inner = td.querySelector('amount span')
                   || td.querySelector('amount')
                   || td.querySelector('span');
        if (inner) {
            const raw = (inner.textContent || '').trim();
            const n = parseNumber(raw);
            if (n != null) {
                return {
                    count: n, raw,
                    source: inner.tagName.toLowerCase() === 'amount'
                        ? 'amount' : (td.querySelector('amount span') ? 'amount-span' : 'span'),
                };
            }
        }
        // Fallback: strip any child element content from the td's own text
        // so we don't concatenate "33 T 50 T" when both exist.
        const clone = td.cloneNode(true);
        clone.querySelectorAll('*').forEach(el => el.remove());
        const direct = (clone.textContent || '').trim();
        const full = (td.textContent || '').trim();
        const raw = direct || full;
        return { count: parseNumber(raw), raw, source: direct ? 'td-direct' : 'td-text' };
    }

    function summarizeTrainUnits(info) {
        const tu = info.trainUnits;
        if (!tu || !tu.units) return 'No unit data.';
        const top = [...tu.units].filter(u => u.count > 0)
            .sort((a, b) => b.count - a.count).slice(0, 5);
        const lines = [
            `${tu.unitCount} unit types · total pop ${fmt(tu.totalPopulation)}`,
            `DOM source: ${tu.dominantSource} (${JSON.stringify(tu.sourceTally)})`,
            'Top 5 by count:',
            ...top.map(u => `  • ${u.name}: ${u.countDisplay} (${fmt(u.count)})`),
        ];
        return lines.join('\n');
    }

    // ---------- helpers ----------
    const SUFFIX = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9,
                     t: 1e12, T: 1e12, q: 1e15, Q: 1e15 };
    const WORD_SUFFIX = {
        thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
        quadrillion: 1e15, quintillion: 1e18, sextillion: 1e21,
        septillion: 1e24, octillion: 1e27, nonillion: 1e30, decillion: 1e33,
    };
    function parseNumber(s) {
        if (s == null) return null;
        let str = String(s).replace(/[,$€£%]/g, '').replace(/\s+/g, ' ').trim();
        if (!str) return null;
        if (/^\?+$/.test(str)) return null; // "???" means unknown
        // Word suffix: "22 Quintillion", "1 Octillion"
        const wm = str.match(/^(-?\d+(?:\.\d+)?)\s+([A-Za-z]+)$/);
        if (wm && WORD_SUFFIX[wm[2].toLowerCase()] != null) {
            return parseFloat(wm[1]) * WORD_SUFFIX[wm[2].toLowerCase()];
        }
        // Single-letter suffix: "33 T"
        const m = str.match(/^(-?\d+(?:\.\d+)?)\s*([kKmMbBtTqQ])?$/);
        if (!m) {
            const n = parseFloat(str);
            return Number.isFinite(n) ? n : null;
        }
        const n = parseFloat(m[1]);
        const mult = m[2] ? SUFFIX[m[2]] : 1;
        return n * mult;
    }

    function fmt(n) {
        if (n == null || !Number.isFinite(n)) return '—';
        if (Math.abs(n) >= 1e27) return (n / 1e27).toFixed(2) + ' Oc';
        if (Math.abs(n) >= 1e24) return (n / 1e24).toFixed(2) + ' Sp';
        if (Math.abs(n) >= 1e21) return (n / 1e21).toFixed(2) + ' Sx';
        if (Math.abs(n) >= 1e18) return (n / 1e18).toFixed(2) + ' Qi';
        if (Math.abs(n) >= 1e15) return (n / 1e15).toFixed(2) + ' Qa';
        if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + ' T';
        if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(2)  + ' B';
        if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(2)  + ' M';
        if (Math.abs(n) >= 1e3)  return (n / 1e3).toFixed(2)  + ' K';
        return String(Math.round(n * 1000) / 1000);
    }

    // ---------- scan dispatch ----------
    let lastScan = null;

    async function runScan() {
        refreshPage();
        const status = document.getElementById('sa-status');
        const dump = document.getElementById('sa-dump');
        const rec = document.getElementById('sa-recommend');

        status.textContent = 'scanning...';

        if (!pageKey) {
            lastScan = { error: 'unknown page', url: location.pathname,
                timestamp: new Date().toISOString() };
            dump.textContent = JSON.stringify(lastScan, null, 2);
            rec.textContent = 'Navigate to one of the game pages (nation, factory, research, etc.)';
            rec.classList.add('sa-warn');
            status.textContent = 'idle · unknown page';
            return;
        }

        try {
            const info = await PAGES[pageKey].scan();
            lastScan = { page: pageKey, url: location.href,
                timestamp: new Date().toISOString(), ...info };
            dump.textContent = JSON.stringify(lastScan, null, 2);
            if (pageKey === 'train-units') {
                rec.textContent = summarizeTrainUnits(lastScan);
            } else if (pageKey === 'research') {
                rec.textContent = summarizeResearch(lastScan);
            } else if (pageKey === 'facilities') {
                rec.textContent = summarizeFacilities(lastScan);
            } else if (pageKey === 'market') {
                rec.textContent = summarizeMarket(lastScan);
                saveMarket(lastScan.market);
            } else if (pageKey === 'bank') {
                const b = lastScan.bank, g = lastScan.galaxyFee;
                rec.textContent = [
                    `Bank balance: ${b && b.value != null ? fmt(b.value) : 'not found'}`,
                    `Galaxy fee (spend turns): ${g && g.value != null ? g.display
                        : 'not found. Open the Central bank tab, then Scan'}`,
                    ...(g && g.value != null ? ['Saved: Credit Gen "Fill from saved" will use it.'] : []),
                ].join('\n');
            } else {
                rec.textContent = 'No calculator for this page yet. Inventory and shared data are still saved.';
            }
            console.log(`[SharkBot] ${pageKey} scan:`, lastScan);
        } catch (e) {
            lastScan = { error: e.message, page: pageKey, timestamp: new Date().toISOString() };
            dump.textContent = 'Error: ' + e.message;
            console.error('[SharkBot] scan error', e);
        }

        status.textContent = 'scan complete · ' + new Date().toLocaleTimeString();

        // Refresh dependent tabs
        renderSlots();
        renderResearchSlots();
        renderFacilitiesSlots();
        renderMarket();
        renderInventory();
        updateTurns();
        renderBank();
        renderTurnGen();
    }

    async function copyScan() {
        const status = document.getElementById('sa-status');
        if (!lastScan) { status.textContent = 'nothing to copy — click Scan first'; return; }
        const json = JSON.stringify(lastScan, null, 2);
        try {
            await navigator.clipboard.writeText(json);
            status.textContent = 'copied ' + json.length + ' chars to clipboard';
        } catch (e) {
            const dump = document.getElementById('sa-dump');
            const range = document.createRange();
            range.selectNodeContents(dump);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(range);
            status.textContent = 'clipboard blocked — text selected, press Ctrl+C';
        }
    }

    // ---------- Planet list (up to 10, slots A–J) ----------
    function planetNameOf(id) {
        const n = (getSlot(id)?.planetName || getFSlot(id)?.planetName || '').trim();
        return /^Planet [A-J]$/i.test(n) ? '' : n;
    }
    function slotHasData(id) {
        return !!((getSlot(id)?.units || []).length || (getFSlot(id)?.items || []).length ||
            GM_getValue('sa-inv-' + id, null) || GM_getValue('sa-nation-' + id, null));
    }
    function planetIds() { return SLOT_IDS.filter(id => planetNameOf(id) || slotHasData(id)); }
    function shortName(id) { return planetNameOf(id) || `Planet ${id}`; }
    function compareId(selfId) {
        const c = GM_getValue('sa-compare', '');
        return c && c !== selfId && planetIds().includes(c) ? c : null;
    }
    function removePlanet(id) {
        ['sa-unit-slot-', 'sa-facilities-slot-', 'sa-inv-', 'sa-nation-', 'sa-colony-', 'sa-rg-', 'sa-area-', 'sa-turngen-', 'sa-turns-',
         'sa-slot-collapsed-', 'sa-fslot-collapsed-'].forEach(k => {
            if (typeof GM_deleteValue === 'function') GM_deleteValue(k + id); else GM_setValue(k + id, null);
        });
        if (typeof GM_listValues === 'function') GM_listValues()
            .filter(k => k.startsWith('sa-area-' + id + '|'))
            .forEach(k => { if (typeof GM_deleteValue === 'function') GM_deleteValue(k); else GM_setValue(k, null); });
        if (GM_getValue('sa-compare', '') === id) GM_setValue('sa-compare', '');
    }
    function renderCompareSelect(elId) {
        const el = document.getElementById(elId);
        if (!el) return;
        const ids = planetIds();
        if (ids.length < 2) { el.innerHTML = ''; return; }
        const cur = GM_getValue('sa-compare', '');
        el.innerHTML = `<div style="display:flex; gap:6px; align-items:center; margin-bottom:8px; font-size:11px">
            <span class="sa-label" style="margin:0">Compare with</span>
            <select class="sa-select" style="width:auto">
                <option value="">none</option>
                ${ids.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('')}
            </select></div>`;
        el.querySelector('select').addEventListener('change', (e) => {
            GM_setValue('sa-compare', e.target.value);
            renderSlots(); renderFacilitiesSlots();
        });
    }
    // Options for "pick a planet" dropdowns (calculators)
    function planetOptions(selected) {
        const ids = planetIds().length ? planetIds() : ['A'];
        return ids.map(id => `<option value="${id}" ${id === selected ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
    }

    // ---------- Which planet is open? ----------
    // Matches the planet name shown in the game's top bar (outside <main>)
    // against the slot names. Returns a slot id (A–J) or null if unsure.
    function slotNames() {
        return SLOT_IDS.map(id => ({ id, name: planetNameOf(id) })).filter(x => x.name);
    }
    function detectSlot() {
        const names = slotNames();
        if (!names.length) return null;
        const main = document.querySelector('main');
        const hits = new Set();
        document.querySelectorAll('body *').forEach(el => {
            if (el.closest(`#${PANEL_ID}`) || (main && main.contains(el))) return;
            if (['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) return;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!t || t.length > 40) return;
            names.forEach(n => { if (t === n.name.toLowerCase() && isVisible(el)) hits.add(n.id); });
        });
        return hits.size === 1 ? [...hits][0] : null;
    }

    // Read the open planet's name from the game: the box beside "Planet Inventory".
    function readPlanetName() {
        // Nation page header: "Planet: Shark Sea Temperature: 25℃ Address: #(104-53)"
        const head = pageText().match(/Planet:\s*(.+?)\s+Temperature:/);
        if (head) return head[1].trim();
        const box = findInventoryBox();
        if (!box) return null;
        let el = box;
        for (let i = 0; el && i < 5; i++, el = el.parentElement) {
            for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
                if (sib.closest(`#${PANEL_ID}`) || ['SCRIPT', 'STYLE'].includes(sib.tagName)) continue;
                const line = cardLines(sib).find(l => l.length >= 2 && l.length <= 40 &&
                    /[A-Za-z]/.test(l) && parseNumber(l) == null && !/planet inventory/i.test(l) &&
                    !/^(colony|energy|missions|next tick|profile|happiness|sickness|productivity)\b/i.test(l));
                if (line) return line.replace(/[▾▼⌄]+$/, '').trim();
            }
        }
        return null;
    }

    // Which slot is the open planet? Can name an empty slot after it.
    // Returns { slot, name, assign, full }.
    function detectPlanet() {
        const names = slotNames();
        const byText = detectSlot();
        const read = readPlanetName();
        if (byText) return { slot: byText, name: read || names.find(n => n.id === byText).name };
        if (read) {
            const hit = names.find(n => n.name.toLowerCase() === read.toLowerCase());
            if (hit) return { slot: hit.id, name: read };
            const free = SLOT_IDS.find(id => !planetNameOf(id) && !slotHasData(id));
            if (free) return { slot: free, name: read, assign: true };
            return { slot: null, name: read, full: true };
        }
        return { slot: null, name: null };
    }

    function nameSlot(id, name) {
        const u = getSlot(id) || { savedAt: null, units: [] };
        u.planetName = name; setSlot(id, u);
        const f = getFSlot(id) || { savedAt: null, items: [] };
        f.planetName = name; setFSlot(id, f);
    }

    function showDetected() {
        const el = document.getElementById('sa-planet');
        if (!el) return;
        const d = detectPlanet();
        el.textContent = d.slot && !d.assign ? `Open planet: ${slotLabel(d.slot)}`
            : d.assign ? `Open planet: ${d.name} (will be saved to empty slot ${d.slot})`
            : d.full ? `Open planet: ${d.name}: all ${SLOT_IDS.length} planet slots are used`
            : 'Open planet: could not read the planet name';
    }

    // ---------- Save everything ----------
    // Every Save button: scan the current page, then store all data it holds.
    // slot = 'A' | 'B' for planet data; null = shared data only (research/bank/market).
    async function saveAll(slot, auto, quiet) {
        try {
            const r = await saveAllInner(slot, auto);
            if (quiet) {
                const st = document.getElementById('sa-status');
                st.textContent = 'Auto-scan · ' + st.textContent;
            }
            return r;
        } catch (e) {
            const status = document.getElementById('sa-status');
            status.textContent = `Save failed on ${pageKey || location.pathname}: ${e.message}`;
            const dump = document.getElementById('sa-dump');
            if (dump) dump.textContent = `Error: ${e.message}\n\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`;
            if (!quiet) switchTab('debug');
            console.error('[SharkBot] save error', e);
            return [];
        }
    }

    async function saveAllInner(slot, auto) {
        refreshPage();
        const status = document.getElementById('sa-status');
        const det = detectPlanet();
        const detected = det.assign ? null : det.slot;
        if (slot && detected && detected !== slot) {
            status.textContent = `Not saved: ${slotLabel(detected)} is open in-game, not ${slotLabel(slot)}.`;
            switchTab('debug');
            return [];
        }
        if (auto) {
            slot = det.slot;
            if (det.assign) nameSlot(det.slot, det.name);   // first scan of this planet
        } else if (slot && det.name && det.assign && det.slot === slot) {
            nameSlot(slot, det.name);
        }
        await runScan();
        const saved = [];
        const sc = lastScan || {};
        if (slot) {
            const inv = readInventory();
            if (inv.items.length) {
                GM_setValue('sa-inv-' + slot, { savedAt: new Date().toISOString(), items: inv.items });
                saved.push('inventory');
            }
            if (sc.trainUnits && sc.trainUnits.units && sc.trainUnits.units.length) {
                saveToSlot(slot); saved.push('units');
            }
            if (sc.facilities && sc.facilities.items && sc.facilities.items.length) {
                saveToFSlot(slot); saved.push('facilities');
            }
            const col = readColony();
            if (col.productivity != null || col.happiness != null || col.workMode) {
                const prev = GM_getValue('sa-colony-' + slot, {}) || {};
                const merged = { savedAt: new Date().toISOString() };
                ['productivity', 'happiness', 'sickness', 'wealth', 'maxHappiness', 'workMode'].forEach(k =>
                    merged[k] = col[k] != null ? col[k] : (prev[k] ?? null));
                GM_setValue('sa-colony-' + slot, merged);
                saved.push(col.workMode ? 'colony + work mode' : 'colony');
            }
            if (sc.nation && sc.nation.fields && sc.nation.fields.length) {
                GM_setValue('sa-nation-' + slot, Object.assign({ savedAt: new Date().toISOString() }, sc.nation));
                saved.push('nation');
            }
        }
        if (sc.cards && sc.cards.cards && sc.cards.cards.length) {
            GM_setValue('sa-cards', Object.assign({ savedAt: new Date().toISOString() }, sc.cards));
            saved.push(`${sc.cards.cards.length} cards`);
        }
        if (sc.research && sc.research.items && sc.research.items.length) {
            saveToRSlot('A'); saved.push('research');
        }
        const rc = sc.researchCurrency;
        if (rc && (rc.brains || rc.diamonds || rc.ssb)) {
            const prev = bdCounts() || {};
            GM_setValue('sa-bd-counts', { savedAt: new Date().toISOString(),
                brains: rc.brains || prev.brains || null, diamonds: rc.diamonds || prev.diamonds || null,
                ssb: rc.ssb || prev.ssb || null });
            saved.push('brains/diamonds/SSB');
        }
        // Bank, Central bank, galaxy fee and market are stored by the scan itself
        if (sc.bank && sc.bank.value != null) saved.push('bank');
        if (sc.galaxyFee && sc.galaxyFee.value != null) saved.push('galaxy fee');
        if (sc.market && sc.market.resources && sc.market.resources.length) saved.push('market');

        renderSlots(); renderResearchSlots(); renderFacilitiesSlots(); renderMarket();
        renderInventory(); renderBank(); renderTurnGen(); updateTurns(); renderNation(); renderCards(); renderPlanetList(); renderResGen(); renderArea(); renderBdBars(); renderOptimizer();
        const where = slot ? ` to ${slotLabel(slot)}` : '';
        const note = auto && !slot
            ? (det.full
                ? `\n(${det.name} isn't saved: all ${SLOT_IDS.length} planet slots are used. Remove one in Settings → Planets.)`
                : '\n(Couldn\'t read the planet name. Use a Save button in the Units or Inventory tab.)')
            : '';
        showDetected();
        status.textContent = (saved.length
            ? `Saved${where}: ${saved.join(', ')}`
            : 'Nothing to save on this page') + note;
        return saved;
    }

    document.getElementById('sa-scan').addEventListener('click', async () => {
        await saveAll(null, true);
        if (typeof tutorialOnScan === 'function') tutorialOnScan(false);
    });
    document.getElementById('sa-scan').title = 'Scan this page and save everything to the open planet\'s slot';
    document.getElementById('sa-copy').addEventListener('click', copyScan);

    // ---------- Units tab: slot storage ----------
    // Each slot: { planetName, savedAt, units: [{name, count, countDisplay}] }
    function getSlot(id) { return GM_getValue('sa-unit-slot-' + id, null); }
    function setSlot(id, data) { GM_setValue('sa-unit-slot-' + id, data); }
    function clearSlot(id) {   // keeps the planet name so Scan still recognises it
        const name = getSlot(id)?.planetName;
        GM_setValue('sa-unit-slot-' + id, name ? { planetName: name, savedAt: null, units: [] } : null);
    }

    function saveToSlot(id) {
        const status = document.getElementById('sa-status');
        if (!lastScan || !lastScan.trainUnits || !lastScan.trainUnits.units) {
            status.textContent = 'Save: need a Train Units scan first';
            switchTab('main');
            return;
        }
        const existing = getSlot(id);
        const planetName = existing?.planetName || `Planet ${id}`;
        setSlot(id, {
            planetName,
            savedAt: new Date().toISOString(),
            units: lastScan.trainUnits.units,
            totalPopulation: lastScan.trainUnits.totalPopulation,
        });
        renderSlots();
        status.textContent = `Saved scan to Slot ${id}`;
    }

    function renameSlot(id, name) {
        const slot = getSlot(id);
        if (!slot) {
            setSlot(id, { planetName: name, savedAt: null, units: [] });
        } else {
            slot.planetName = name;
            setSlot(id, slot);
        }
    }

    function renderSlot(id) {
        const el = document.getElementById('sa-slot-' + id);
        if (!el) return;
        const slot = getSlot(id) || { planetName: shortName(id), savedAt: null, units: [] };
        const canSave = !!(lastScan && lastScan.trainUnits && lastScan.trainUnits.units);
        const other = compareId(id);
        const otherSlot = other ? getSlot(other) : null;
        const hasData = slot.units && slot.units.length > 0;
        const collapsed = GM_getValue('sa-slot-collapsed-' + id, false) && hasData;

        const diffMap = {};
        if (otherSlot && otherSlot.units) {
            const bByName = Object.fromEntries(otherSlot.units.map(u => [u.name, u.count || 0]));
            slot.units.forEach(u => {
                const diff = (u.count || 0) - (bByName[u.name] || 0);
                if (diff !== 0) diffMap[u.name] = diff;
            });
        }

        const savedStr = slot.savedAt ? new Date(slot.savedAt).toLocaleString() : 'empty';

        el.innerHTML = `
            <div class="sa-slot ${collapsed ? 'collapsed' : ''}">
                <div class="sa-slot-head">
                    <input class="sa-slot-name" value="${escapeHtml(slot.planetName)}"
                           data-slot="${id}" placeholder="Planet name" />
                    <div class="sa-slot-actions">
                        <button class="sa-btn" data-action="save" data-slot="${id}"
                                title="Scan this page and save everything for this planet">Save</button>
                        <button class="sa-btn sa-btn-danger" data-action="clear" data-slot="${id}"
                                ${slot.savedAt ? '' : 'disabled'}>Clear</button>
                        <button class="sa-chevron" data-action="toggle" data-slot="${id}"
                                title="Hide/show details" ${hasData ? '' : 'disabled style="visibility:hidden"'}>▼</button>
                    </div>
                </div>
                <div class="sa-slot-body">
                    <div class="sa-slot-meta">
                        Slot ${id} · saved: ${savedStr}
                        ${slot.totalPopulation != null
                            ? ` · pop ${fmt(slot.totalPopulation)}` : ''}
                    </div>
                    ${hasData ? renderUnitTable(slot.units, diffMap, other ? shortName(other) : '') :
                        `<div class="sa-empty">No data. Scan Train Units then click Save.</div>`}
                </div>
            </div>
        `;

        el.querySelector('.sa-slot-name').addEventListener('change', (e) => {
            nameSlot(id, e.target.value.trim() || `Planet ${id}`);
            refreshPlanetLists();
        });
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const sid = btn.dataset.slot;
                if (action === 'save') saveAll(sid);
                else if (action === 'clear') {
                    if (confirm(`Clear Slot ${sid}?`)) { clearSlot(sid); renderSlots(); }
                }
                else if (action === 'toggle') {
                    const cur = GM_getValue('sa-slot-collapsed-' + sid, false);
                    GM_setValue('sa-slot-collapsed-' + sid, !cur);
                    renderSlot(sid);
                }
            });
        });
    }

    function renderUnitTable(units, diffMap, otherId) {
        const sorted = [...units].sort((a, b) => (b.count || 0) - (a.count || 0));
        const showDiff = Object.keys(diffMap).length > 0;
        const rows = sorted.map(u => {
            const d = diffMap[u.name];
            let diffCell = '';
            if (showDiff) {
                if (d == null) diffCell = '<td class="sa-num" style="color:var(--dim)">—</td>';
                else if (d > 0) diffCell = `<td class="sa-num sa-diff-pos">+${fmt(d)}</td>`;
                else            diffCell = `<td class="sa-num sa-diff-neg">${fmt(d)}</td>`;
            }
            return `<tr>
                <td>${escapeHtml(u.name)}</td>
                <td class="sa-num">${escapeHtml(u.countDisplay || '')}</td>
                ${diffCell}
            </tr>`;
        }).join('');
        return `
            <table class="sa-unit-table">
                <thead><tr>
                    <th>Unit</th><th style="text-align:right">Count</th>
                    ${showDiff ? `<th style="text-align:right">vs ${otherId}</th>` : ''}
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function renderSlots() {
        const wrap = document.getElementById('sa-slots');
        if (!wrap) return;
        renderCompareSelect('sa-units-compare');
        const ids = planetIds();
        if (!ids.length) {
            wrap.innerHTML = `<div class="sa-empty">No planets yet. Click Scan on any game page.</div>`;
            return;
        }
        wrap.innerHTML = ids.map(id => `<div id="sa-slot-${id}"></div>`).join('');
        ids.forEach(renderSlot);
    }
    renderSlots();

    // ---------- Research tab: slot storage ----------
    function getRSlot(id) { return GM_getValue('sa-research-slot-' + id, null); }
    function setRSlot(id, data) { GM_setValue('sa-research-slot-' + id, data); }
    function clearRSlot(id) { GM_setValue('sa-research-slot-' + id, null); }

    function saveToRSlot(id) {
        const status = document.getElementById('sa-status');
        if (!lastScan || !lastScan.research || !lastScan.research.items) {
            status.textContent = 'Save: need a Research scan first';
            switchTab('debug');
            return;
        }
        const existing = getRSlot(id);
        const planetName = existing?.planetName || `Planet ${id}`;
        const items = lastScan.research.items.filter(i => !isUnitRow(i.name));
        setRSlot(id, {
            planetName,
            savedAt: new Date().toISOString(),
            items,
            itemCount: items.length,
        });
        renderResearchSlots();
        renderTurnGen();
        status.textContent = `Saved ${items.length} research items`;
    }

    function renameRSlot(id, name) {
        const slot = getRSlot(id);
        if (!slot) {
            setRSlot(id, { planetName: name, savedAt: null, items: [] });
        } else {
            slot.planetName = name;
            setRSlot(id, slot);
        }
    }

    // Unit counts that appear on the research page (per planet, not research)
    function isUnitRow(name) { return /^\s*(\([A-Z]\))?\s*scientists\s*$/i.test(String(name)) || isBdRow(name); }

    function renderResearchSlot(id) {
        const el = document.getElementById('sa-rslot-' + id);
        if (!el) return;
        const stored = getRSlot(id) || { planetName: 'Research', savedAt: null, items: [] };
        // hide rows saved by older versions that were unit counts
        const slot = Object.assign({}, stored, { items: (stored.items || []).filter(i => !isUnitRow(i.name)) });
        slot.itemCount = slot.items.length;
        const canSave = !!(lastScan && lastScan.research && lastScan.research.items);
        const other = null;          // single galaxy-wide slot: no A/B diff
        const otherSlot = null;
        const hasData = slot.items && slot.items.length > 0;
        const collapsed = GM_getValue('sa-rslot-collapsed-' + id, false) && hasData;

        const diffMap = {};
        if (otherSlot && otherSlot.items) {
            const bByName = Object.fromEntries(otherSlot.items.map(i => [i.name, i.value || 0]));
            slot.items.forEach(i => {
                const diff = (i.value || 0) - (bByName[i.name] || 0);
                if (diff !== 0) diffMap[i.name] = diff;
            });
        }

        const savedStr = slot.savedAt ? new Date(slot.savedAt).toLocaleString() : 'empty';

        el.innerHTML = `
            <div class="sa-slot ${collapsed ? 'collapsed' : ''}">
                <div class="sa-slot-head">
                    <span class="sa-title" style="font-size:11px">Galaxy-wide research</span>
                    <div class="sa-slot-actions">
                        <button class="sa-btn" data-action="rsave" data-slot="${id}"
                                title="Scan this page and save shared data (research, bank, market)">Save</button>
                        <button class="sa-btn sa-btn-danger" data-action="rclear" data-slot="${id}"
                                ${slot.savedAt ? '' : 'disabled'}>Clear</button>
                        <button class="sa-chevron" data-action="rtoggle" data-slot="${id}"
                                title="Hide/show details" ${hasData ? '' : 'disabled style="visibility:hidden"'}>▼</button>
                    </div>
                </div>
                <div class="sa-slot-body">
                    <div class="sa-slot-meta">
                        saved: ${savedStr}
                        ${slot.itemCount != null ? ` · ${slot.itemCount} items` : ''}
                    </div>
                    ${hasData
                        ? renderResearchTable(slot.items, diffMap, other)
                        : `<div class="sa-empty">No data. Scan Research then click Save.</div>`}
                </div>
            </div>
        `;

        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const sid = btn.dataset.slot;
                if (action === 'rsave') saveAll(null);
                else if (action === 'rclear') {
                    if (confirm(`Clear Research Slot ${sid}?`)) { clearRSlot(sid); renderResearchSlots(); }
                }
                else if (action === 'rtoggle') {
                    const cur = GM_getValue('sa-rslot-collapsed-' + sid, false);
                    GM_setValue('sa-rslot-collapsed-' + sid, !cur);
                    renderResearchSlot(sid);
                }
            });
        });
    }

    // Known research effects (per level). Add more as they're confirmed.
    const RESEARCH_EFFECTS = [
        { match: /^farmialism$/i,    per: 2, what: 'Farmer cap' },
        { match: /^industrialism$/i, per: 2, what: 'Industrial worker cap' },
        { match: /^commercialism$/i, per: 2, what: 'Commercial worker cap' },
        { match: /^economy$/i,       per: 2, what: 'Commercial income' },   // from Credit Gen sheet
        { match: /^digging$/i,       per: 5, what: 'Mine worker efficiency' },
        { match: /^iron mining$/i,   per: 5, what: 'Iron Mine efficiency' },
        { match: /^gold mining$/i,   per: 5, what: 'Gold Mine efficiency' },
        { match: /^tritium mining$/i, per: 5, sign: '−', compound: true, what: 'diminishing returns (gas giant tritium fleets)' },
        { match: /^work practices$/i, per: 2, sign: '−', what: 'pollution from Industrial & Factory workers' },
        { match: /^energy technology$/i, per: 1, what: 'energy storage' },
        { match: /^solar power$/i,   per: 5, what: 'Solar Power storage & production' },
        { match: /^cold tritium$/i,  per: 5, sign: '−', compound: true, what: 'energy cost (Tritium Accumulator & Energy Core)' },
        { match: /^medicine$/i,      render: () => 'Doctor healing ↑ (exact effect unknown)' },
        { match: /^forestry$/i,      per: 5, what: 'pollution cleansing (all planets)' },
        { match: /^botany$/i,        per: 1, what: 'forest growth (all planets)' },
        { match: /^computer technology$/i, per: 5, what: 'scientist productivity (all planets)' },
        { match: /^colonization$/i,  render: (l) => `+${l} colon${l === 1 ? 'y' : 'ies'} allowed` },
        { match: /^entertainment$/i, per: 0.5, what: 'max happiness (all planets)' },
        { match: /^ironized gold$/i, per: 5, sign: '−', what: 'energy for SSB factory construction' },
        // multiplicative: each level keeps 95% of the remaining diminishing returns
        { match: /^metallurgy$/i,    per: 5, sign: '−', compound: true, what: 'diminishing returns (lava planet iron fleets)' },
    ];
    function researchEffect(name, level) {
        const e = RESEARCH_EFFECTS.find(x => x.match.test(String(name).trim()));
        if (!e || level == null) return null;
        if (e.render) return e.render(level);
        const pct = e.compound ? (1 - Math.pow(1 - e.per / 100, level)) * 100 : e.per * level;
        return `${e.sign || '+'}${+pct.toFixed(2)}% ${e.what}`;
    }

    function renderResearchTable(items) {
        const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0));
        const rows = sorted.map(i => {
            const eff = researchEffect(i.name, i.value);
            return `<tr>
                <td>${escapeHtml(i.name)}</td>
                <td class="sa-num">${escapeHtml(i.valueDisplay || '')}</td>
                <td style="color:${eff ? 'var(--soft)' : 'var(--dim)'}; font-size:10px; text-align:right">${
                    escapeHtml(eff || '—')}</td>
            </tr>`;
        }).join('');
        return `
            <table class="sa-unit-table">
                <thead><tr>
                    <th>Research</th><th style="text-align:right">Value</th>
                    <th style="text-align:right">Effect</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="font-size:10px; color:var(--muted); margin-top:4px">
                — = effect not known yet.
            </div>
        `;
    }

    function renderResearchSlots() {
        renderResearchSlot('A');   // one shared slot (stored under A)
    }
    renderResearchSlots();

    // ---------- Facilities tab: slot storage ----------
    function getFSlot(id) { return GM_getValue('sa-facilities-slot-' + id, null); }
    function setFSlot(id, data) { GM_setValue('sa-facilities-slot-' + id, data); }
    function clearFSlot(id) {
        const name = getFSlot(id)?.planetName;
        GM_setValue('sa-facilities-slot-' + id, name ? { planetName: name, savedAt: null, items: [] } : null);
    }

    function saveToFSlot(id) {
        const status = document.getElementById('sa-status');
        if (!lastScan || !lastScan.facilities || !lastScan.facilities.items) {
            status.textContent = 'Save: need a Facilities scan first';
            switchTab('debug');
            return;
        }
        const existing = getFSlot(id);
        const planetName = existing?.planetName || `Planet ${id}`;
        const scanned = lastScan.facilities.items;
        const kinds = new Set(scanned.map(i => i.kind));
        // Keep items of kinds this scan didn't cover (e.g. keep Areas when
        // saving a Resources scan). Old-format items (no kind) are dropped.
        const kept = (existing?.items || []).filter(i => i.kind && !kinds.has(i.kind));
        const items = [...kept, ...scanned];
        setFSlot(id, {
            planetName,
            savedAt: new Date().toISOString(),
            items,
            itemCount: items.length,
        });
        renderFacilitiesSlots();
        status.textContent = `Saved ${scanned.length} ${[...kinds].join(' + ')} item(s) to Slot ${id}`;
    }

    function renameFSlot(id, name) {
        const slot = getFSlot(id);
        if (!slot) setFSlot(id, { planetName: name, savedAt: null, items: [] });
        else { slot.planetName = name; setFSlot(id, slot); }
    }

    function renderFacilitiesSlot(id) {
        const el = document.getElementById('sa-fslot-' + id);
        if (!el) return;
        const slot = getFSlot(id) || { planetName: shortName(id), savedAt: null, items: [] };
        const canSave = !!(lastScan && lastScan.facilities && lastScan.facilities.items);
        const other = compareId(id);
        const otherSlot = other ? getFSlot(other) : null;
        const hasData = slot.items && slot.items.length > 0;
        const collapsed = GM_getValue('sa-fslot-collapsed-' + id, false) && hasData;

        const diffMap = {};
        if (otherSlot && otherSlot.items) {
            const bByName = Object.fromEntries(otherSlot.items.map(i => [i.name, i.value || 0]));
            slot.items.forEach(i => {
                const diff = (i.value || 0) - (bByName[i.name] || 0);
                if (diff !== 0) diffMap[i.name] = diff;
            });
        }

        const savedStr = slot.savedAt ? new Date(slot.savedAt).toLocaleString() : 'empty';

        el.innerHTML = `
            <div class="sa-slot ${collapsed ? 'collapsed' : ''}">
                <div class="sa-slot-head">
                    <input class="sa-slot-name" value="${escapeHtml(slot.planetName)}"
                           data-slot="${id}" placeholder="Planet name" />
                    <div class="sa-slot-actions">
                        <button class="sa-btn" data-action="fsave" data-slot="${id}"
                                title="Scan this page and save everything for this planet">Save</button>
                        <button class="sa-btn sa-btn-danger" data-action="fclear" data-slot="${id}"
                                ${slot.savedAt ? '' : 'disabled'}>Clear</button>
                        <button class="sa-chevron" data-action="ftoggle" data-slot="${id}"
                                title="Hide/show details" ${hasData ? '' : 'disabled style="visibility:hidden"'}>▼</button>
                    </div>
                </div>
                <div class="sa-slot-body">
                    <div class="sa-slot-meta">
                        Slot ${id} · saved: ${savedStr}
                        ${slot.itemCount != null ? ` · ${slot.itemCount} items` : ''}
                    </div>
                    ${hasData
                        ? renderFacilityTable(slot.items, diffMap, other ? shortName(other) : '')
                        : `<div class="sa-empty">No data. Scan Facilities then click Save.</div>`}
                </div>
            </div>
        `;

        el.querySelector('.sa-slot-name').addEventListener('change', (e) => {
            nameSlot(id, e.target.value.trim() || `Planet ${id}`);
            refreshPlanetLists();
        });
        el.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const sid = btn.dataset.slot;
                if (action === 'fsave') saveAll(sid);
                else if (action === 'fclear') {
                    if (confirm(`Clear Facilities Slot ${sid}?`)) { clearFSlot(sid); renderFacilitiesSlots(); }
                }
                else if (action === 'ftoggle') {
                    const cur = GM_getValue('sa-fslot-collapsed-' + sid, false);
                    GM_setValue('sa-fslot-collapsed-' + sid, !cur);
                    renderFacilitiesSlot(sid);
                }
            });
        });
    }

    function renderFacilityTable(items, diffMap, otherId) {
        const showDiff = Object.keys(diffMap).length > 0;
        const cols = showDiff ? 4 : 3;
        // Group by section, preserving page order
        const groups = [];
        items.forEach(i => {
            const sec = i.section || (i.kind === 'area' ? 'Areas' : 'Other');
            let g = groups.find(x => x.sec === sec);
            if (!g) { g = { sec, items: [] }; groups.push(g); }
            g.items.push(i);
        });
        const body = groups.map(g => `
            <tr><td colspan="${cols}" style="color:var(--muted); font-size:10px; text-transform:uppercase;
                padding-top:6px">${escapeHtml(g.sec)}</td></tr>
            ${g.items.map(i => {
                const d = diffMap[i.name];
                let diffCell = '';
                if (showDiff) {
                    if (d == null) diffCell = '<td class="sa-num" style="color:var(--dim)">—</td>';
                    else if (d > 0) diffCell = `<td class="sa-num sa-diff-pos">+${fmt(d)}</td>`;
                    else            diffCell = `<td class="sa-num sa-diff-neg">${fmt(d)}</td>`;
                }
                return `<tr title="${escapeHtml(i.maintenance ? 'Maintenance: ' + i.maintenance : '')}">
                    <td>${escapeHtml(i.name)}</td>
                    <td class="sa-num">${escapeHtml(i.valueDisplay || '')}</td>
                    <td class="sa-num" style="color:var(--soft); font-size:10px">${escapeHtml(i.output || '')}</td>
                    ${diffCell}
                </tr>`;
            }).join('')}`).join('');
        return `
            <table class="sa-unit-table">
                <thead><tr>
                    <th>Facility</th><th style="text-align:right">Level</th>
                    <th style="text-align:right">Output</th>
                    ${showDiff ? `<th style="text-align:right">vs ${otherId}</th>` : ''}
                </tr></thead>
                <tbody>${body}</tbody>
            </table>
        `;
    }

    function renderFacilitiesSlots() {
        const wrap = document.getElementById('sa-fslots');
        if (!wrap) return;
        renderCompareSelect('sa-fac-compare');
        const ids = planetIds();
        if (!ids.length) {
            wrap.innerHTML = `<div class="sa-empty">No planets yet. Click Scan on any game page.</div>`;
            return;
        }
        wrap.innerHTML = ids.map(id => `<div id="sa-fslot-${id}"></div>`).join('');
        ids.forEach(renderFacilitiesSlot);
    }
    renderFacilitiesSlots();

    // ---------- Market tab (live, not slot-based) ----------
    function saveMarket(market) {
        if (!market || !market.resources) return;
        GM_setValue('sa-market-latest', {
            savedAt: new Date().toISOString(),
            resources: market.resources.map(r => ({
                name: r.name,
                buyPrice: r.buyPrice,
                sellPrice: r.sellPrice,
                buyPriceDisplay: r.buyPriceDisplay,
                sellPriceDisplay: r.sellPriceDisplay,
            })),
            resourceCount: market.resourceCount,
        });
    }
    function getMarket() { return GM_getValue('sa-market-latest', null); }

    function renderMarket() {
        const el = document.getElementById('sa-market-view');
        if (!el) return;
        const data = getMarket();
        if (!data || !data.resources || data.resources.length === 0) {
            el.innerHTML = `<div class="sa-empty">No market data yet. Visit /market and click Scan.</div>`;
            return;
        }

        // Sort by buy price (highest first), unknowns at the bottom
        const sorted = [...data.resources].sort((a, b) => {
            const av = a.buyPrice ?? -Infinity;
            const bv = b.buyPrice ?? -Infinity;
            return bv - av;
        });

        const rows = sorted.map(r => {
            // Spread = (buy - sell) / buy, i.e. the market-maker margin
            let spreadCell = '<td class="sa-num" style="color:var(--dim)">—</td>';
            if (r.buyPrice != null && r.sellPrice != null && r.buyPrice > 0) {
                const pct = (r.buyPrice - r.sellPrice) / r.buyPrice * 100;
                const cls = pct >= 0 ? 'sa-diff-pos' : 'sa-diff-neg';
                spreadCell = `<td class="sa-num ${cls}">${pct.toFixed(1)}%</td>`;
            }
            return `<tr>
                <td>${escapeHtml(r.name)}</td>
                <td class="sa-num">${escapeHtml(r.buyPriceDisplay || '—')}</td>
                <td class="sa-num">${escapeHtml(r.sellPriceDisplay || '—')}</td>
                ${spreadCell}
            </tr>`;
        }).join('');

        el.innerHTML = `
            <div class="sa-slot-meta" style="margin-bottom:6px">
                ${data.resourceCount} resources · last scan ${new Date(data.savedAt).toLocaleString()}
            </div>
            <table class="sa-unit-table">
                <thead><tr>
                    <th>Resource</th>
                    <th style="text-align:right">Buy</th>
                    <th style="text-align:right">Sell</th>
                    <th style="text-align:right">Spread</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="font-size:10px; color:var(--muted); margin-top:6px">
                Spread = (buy − sell) / buy. Game's trading margin.
            </div>
        `;
    }
    renderMarket();

    // ---------- Credit Gen calculator ----------
    // (Was labelled "Turn Gen" before v0.18; storage keys kept as sa-turngen-*.)
    // Inputs are stored per planet slot (A/B). Each value can be typed by
    // hand or filled from that planet's saved Units / Research / Facilities.
    const TG_FIELDS = [
        { key: 'industrial',  label: 'Industrial Workers',  type: 'num',
          from: { kind: 'units', match: /industrial\s*workers/i } },
        { key: 'commercial',  label: 'Commercial Workers',  type: 'num',
          from: { kind: 'units', match: /commercial\s*workers/i } },
        { key: 'mineSlaves',  label: 'Mine Slaves',         type: 'num',
          from: { kind: 'units', match: /mine\s*slaves/i } },
        { key: 'workMode',    label: 'Work Mode',           type: 'select' },
        { key: 'incomeFac',   label: 'Income Facility Lvl', type: 'num',
          from: { kind: 'facilities', match: /income/i } },
        { key: 'economy',     label: 'Economy Research',    type: 'num',
          from: { kind: 'research', match: /econom/i } },
        { key: 'productivity',label: 'Productivity %',      type: 'num' },
        { key: 'galaxyFee',   label: 'Galaxy Fee %',        type: 'num' },
    ];

    // Work Mode multipliers (from the user's sheet)
    const WORK_MODES = [
        ['Rest', 0.2], ['Chilling', 0.5], ['Holiday', 0.8], ['Normal', 1],
        ['Normal+', 1.05], ['Hard work', 1.1], ['NON-STOP', 1.25],
    ];

    // Formula (from the user's spreadsheet):
    //   base:  Industrial×8, Commercial×30, Mine Slaves×35
    //   each:  base × WorkMode × (1 + IncomeFac) × Productivity
    //          Commercial additionally × Economy
    //   IncomeFac = 0.4 × level^1.17 / 100
    //   Economy   = 1 + 0.02 × level
    //   Turn Spending = total × (1 − GalaxyFee)
    // Productivity and Galaxy Fee are entered as percents (97 = 97%).
    const CG_DEFAULTS = { ticksPerDay: 1440, turnsPerDay: 100000, printDays: 5 };
    function cgAssumptions() {
        const a = Object.assign({}, CG_DEFAULTS, GM_getValue('sa-cg-assume', {}) || {});
        Object.keys(CG_DEFAULTS).forEach(k => { const n = parseNumber(a[k]); a[k] = n != null && n >= 0 ? n : CG_DEFAULTS[k]; });
        a.printDays = Math.min(7, a.printDays);
        return a;
    }

    function calcTurnGen(v) {
        const need = ['industrial', 'commercial', 'mineSlaves', 'incomeFac',
                      'economy', 'productivity', 'galaxyFee'];
        if (need.some(k => v[k] == null) || !v.workMode) return null;

        const mode = WORK_MODES.find(m => m[0] === v.workMode);
        const work = mode ? mode[1] : 1;
        const fac = 0.4 * Math.pow(v.incomeFac, 1.17) / 100;
        const econ = 1 + 0.02 * v.economy;
        const prod = v.productivity / 100;
        const fee = v.galaxyFee / 100;
        // Work mode only affects passive (per-tick) generation, not spending turns
        const base = (1 + fac) * prod;

        const rows = [
            { name: 'Industrial',  raw: v.industrial * 8 },
            { name: 'Commercial',  raw: v.commercial * 30, econ: true },
            { name: 'Mine Slaves', raw: v.mineSlaves * 35 },
        ];
        rows.forEach(r => {
            r.core = r.raw * base * (r.econ ? econ : 1);   // before work mode
            r.passive = r.core * work;
            r.turn = r.core * (1 - fee);
        });
        const core = rows.reduce((s, r) => s + r.core, 0);
        const passive = core * work;
        const perTurn = core * (1 - fee);

        const A = cgAssumptions();
        const passiveDay = passive * A.ticksPerDay;
        const printDay = perTurn * A.turnsPerDay;            // on a day you print
        const printAvg = printDay * A.printDays / 7;         // averaged over the week
        const line = (label, val, note) => label.padEnd(19) + fmt(val).padStart(10) + (note ? '  ' + note : '');
        return {
            value: passive,
            passive, perTurn, passiveDay, printDay, printAvg,
            breakdown: [
                'PASSIVE',
                line('Per tick', passive, `work mode ×${work}`),
                line('Per day', passiveDay, `× ${A.ticksPerDay.toLocaleString()} ticks`),
                '',
                'PRINTING (spending turns)',
                line('Per turn', perTurn, `after fee ×${(1 - fee).toFixed(3)}`),
                line('Per print day', printDay, `× ${A.turnsPerDay.toLocaleString()} turns`),
                line('Per day (average)', printAvg, `${A.printDays} of 7 days`),
                line('Per week', printDay * A.printDays),
                '',
                'TOTAL',
                line('Per day (average)', passiveDay + printAvg),
                line('Per week', passiveDay * 7 + printDay * A.printDays),
                '',
                'Worker'.padEnd(11) + 'Passive'.padStart(10) + 'Per turn'.padStart(10) + 'Share'.padStart(7),
                ...rows.map(r => r.name.padEnd(11) + fmt(r.passive).padStart(10) + fmt(r.turn).padStart(10) +
                    `${core ? (r.core / core * 100).toFixed(1) : '0.0'}%`.padStart(7)),
                '',
                `Work ${v.workMode} ×${work} (passive only) · Facility +${(fac * 100).toFixed(1)}% · Econ ×${econ.toFixed(2)} · Prod ${(prod * 100).toFixed(1)}%`,
            ],
        };
    }

    function tgKey(slot) { return 'sa-turngen-' + slot; }
    function tgLoad(slot) { return GM_getValue(tgKey(slot), { values: {}, sources: {} }); }
    function tgSave(slot, data) { GM_setValue(tgKey(slot), data); }

    function slotLabel(id) {
        const u = getSlot(id), f = getFSlot(id);
        const name = u?.planetName || f?.planetName || `Planet ${id}`;
        return `${id} · ${name}`;
    }

    // Prefer a level embedded in the name ("Economy LVL: 19", "Economy (19)")
    function levelFrom(x) {
        const m = String(x.name).match(/LVL:?\s*([\d,.]+)|\(([\d,]+)\)\s*$/i);
        if (m) return { value: parseNumber(m[1] || m[2]), display: (m[1] || m[2]).trim() };
        return { value: x.value, display: x.display || String(x.value) };
    }

    // Fill every field that comes from saved data, unless the user typed it.
    // Returns { filled, missing } labels.
    function tgApplySaved(slot, data, force) {
        const src = {
            units: (getSlot(slot)?.units || []).map(u => ({ name: u.name, value: u.count, display: u.countDisplay })),
            research: (getRSlot('A')?.items || []).map(i => ({ name: i.name, value: i.value, display: i.valueDisplay })),
            facilities: (getFSlot(slot)?.items || []).map(i => ({ name: i.name, value: i.value, display: i.valueDisplay })),
        };
        const filled = [], missing = [];
        const canSet = (key) => force || data.sources[key] !== 'manual' || !data.values[key];
        TG_FIELDS.forEach(f => {
            if (!f.from) return;
            const hit = src[f.from.kind].find(x => f.from.match.test(x.name));
            const lv = hit ? (f.from.kind === 'units' ? { value: hit.value, display: hit.display } : levelFrom(hit)) : null;
            if (lv && lv.value != null) {
                if (canSet(f.key)) {
                    data.values[f.key] = lv.display || String(lv.value);
                    data.sources[f.key] = 'saved';
                }
                filled.push(f.label);
            } else {
                missing.push(f.label);
            }
        });
        const col = GM_getValue('sa-colony-' + slot, null);
        if (col && col.productivity != null) {
            if (canSet('productivity')) {
                data.values.productivity = String(col.productivity);
                data.sources.productivity = 'saved';
            }
            filled.push(`Productivity (${col.productivity}%)`);
        } else {
            missing.push('Productivity (saved by any scan of this planet)');
        }
        if (col && col.workMode) {
            if (canSet('workMode')) {
                data.values.workMode = col.workMode;
                data.sources.workMode = 'saved';
            }
            filled.push(`Work Mode (${col.workMode})`);
        }
        const gf = galaxyFeeLoad();
        if (gf && gf.value != null) {
            if (canSet('galaxyFee')) {
                data.values.galaxyFee = String(gf.value);
                data.sources.galaxyFee = 'saved';
            }
            filled.push(`Galaxy Fee (${gf.display})`);
        } else {
            missing.push('Galaxy Fee (open /bank → Central bank, then Scan)');
        }
        return { filled, missing };
    }

    function tgFillFromSaved(slot) {
        const data = tgLoad(slot);
        const { filled, missing } = tgApplySaved(slot, data, true);
        tgSave(slot, data);
        renderTurnGen();
        document.getElementById('sa-tg-result').textContent =
            `Filled: ${filled.join(', ') || 'none'}` +
            (missing.length ? `\nNot found in saved data: ${missing.join(', ')}` : '');
    }

    function renderTurnGen() {
        const sel = document.getElementById('sa-tg-slot');
        const form = document.getElementById('sa-tg-form');
        if (!sel || !form) return;
        const slot = GM_getValue('sa-turngen-active', 'A');
        sel.innerHTML = planetOptions(slot);

        const data = tgLoad(slot);
        const beforeJson = JSON.stringify(data);
        tgApplySaved(slot, data, false);
        if (JSON.stringify(data) !== beforeJson) tgSave(slot, data);   // only write real changes
        form.innerHTML = TG_FIELDS.map(f => {
            const val = data.values[f.key] ?? '';
            const fromSaved = data.sources[f.key] === 'saved';
            const control = f.type === 'select'
                ? `<select id="sa-tg-${f.key}" data-key="${f.key}">
                       <option value="">— pick —</option>
                       ${WORK_MODES.map(([n, m]) =>
                           `<option value="${n}" ${val === n ? 'selected' : ''}>${n} (×${m})</option>`).join('')}
                   </select>`
                : `<input id="sa-tg-${f.key}" data-key="${f.key}" value="${escapeHtml(val)}" placeholder="0" />`;
            return `
                <label for="sa-tg-${f.key}">${escapeHtml(f.label)}</label>
                ${control}
                <span class="sa-src ${fromSaved ? '' : 'manual'}"
                      title="${fromSaved ? 'Filled from saved data' : 'Manual entry'}">${fromSaved ? '●' : '○'}</span>`;
        }).join('');

        form.querySelectorAll('input, select').forEach(inp => {
            inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
                const d = tgLoad(slot);
                d.values[inp.dataset.key] = inp.value;
                d.sources[inp.dataset.key] = 'manual';
                tgSave(slot, d);
                inp.nextElementSibling.classList.add('manual');
                inp.nextElementSibling.textContent = '○';
                updateTurnGenResult();
            });
        });
        updateTurnGenResult();
    }

    function updateTurnGenResult() {
        const slot = GM_getValue('sa-turngen-active', 'A');
        const data = tgLoad(slot);
        const v = {};
        TG_FIELDS.forEach(f => {
            const raw = data.values[f.key];
            v[f.key] = f.type === 'select' ? (raw || '').trim() : parseNumber(raw);
        });
        const out = document.getElementById('sa-tg-result');
        const missing = TG_FIELDS.filter(f =>
            f.type === 'select' ? !v[f.key] : v[f.key] == null).map(f => f.label);
        const res = calcTurnGen(v);
        if (!res) {
            out.textContent = `Fill in: ${missing.join(', ')}`;
            out.classList.add('sa-warn');
            return;
        }
        out.classList.remove('sa-warn');
        out.textContent = [...(res.breakdown || []),
            ...calcPlanBlock(slot, { cg: true, area: true }, 'BEST AREAS FOR CREDITS (Area Size → more workers)',
                'No Industrial or Commercial Area saved for this planet: scan Facilities → Areas.')].join('\n');
    }

    document.getElementById('sa-tg-slot').addEventListener('change', (e) => {
        GM_setValue('sa-turngen-active', e.target.value);
        renderTurnGen();
    });
    document.getElementById('sa-tg-fill').addEventListener('click', () =>
        tgFillFromSaved(GM_getValue('sa-turngen-active', 'A')));
    renderTurnGen();

    (function wireAssumptions() {
        const box = document.getElementById('sa-cg-assume');
        if (!box) return;
        const saved = GM_getValue('sa-cg-assume', {}) || {};
        box.querySelectorAll('input[data-k]').forEach(inp => {
            const k = inp.dataset.k;
            inp.value = saved[k] != null ? saved[k] : CG_DEFAULTS[k].toLocaleString();
            inp.addEventListener('input', () => {
                const cur = GM_getValue('sa-cg-assume', {}) || {};
                cur[k] = inp.value;
                GM_setValue('sa-cg-assume', cur);
                updateTurnGenResult();
            });
        });
    })();

    // ---------- Turn Gen (Tick Generator upgrade) calculator ----------
    // From the user's sheet. Upgrading from level S to E (n = E − S) costs,
    // summing k over S, S+1, …, E−1:
    //   Credits = 8e8·n + 1.2e9·Σ k^2.5
    //   Gold    = 1·n   + 8·Σ k^1.3
    //   Iron    = 3·n   + 10·Σ k^1.5
    //   Trit    = 1·n   + 10·Σ k^1.3
    // TPM(L) = 0.38·L^1.2 / 100 · 0.2 + 0.2
    const TN_MAX_STEPS = 5e6;

    function tpm(level) { return 0.38 * Math.pow(level, 1.2) / 100 * 0.2 + 0.2; }
    // Inverse: smallest whole level whose TPM reaches the target
    function levelForTpm(target) {
        if (!(target > 0.2)) return null;
        // Tolerance so a round target (e.g. 50) accepts 49.99999 at level 10320
        const goal = target - 0.0005;
        let L = Math.ceil(Math.pow((goal - 0.2) * 500 / 0.38, 1 / 1.2));
        while (L > 1 && tpm(L - 1) >= goal) L--;
        while (tpm(L) < goal) L++;
        return L;
    }

    function calcTickUpgrade(start, end) {
        const n = end - start;
        if (!(n > 0)) return { n: Math.max(n, 0), credits: 0, gold: 0, iron: 0, trit: 0 };
        if (n > TN_MAX_STEPS) return { n, tooBig: true };
        let s25 = 0, s13 = 0, s15 = 0;
        for (let k = start; k < end; k++) {
            s25 += Math.pow(k, 2.5);
            s13 += Math.pow(k, 1.3);
            s15 += Math.pow(k, 1.5);
        }
        return {
            n,
            credits: 8e8 * n + 1.2e9 * s25,
            gold: n + 8 * s13,
            iron: 3 * n + 10 * s15,
            trit: n + 10 * s13,
        };
    }

    function tnLoad(slot) {
        return Object.assign({ start: '', startTpm: '', end: '', target: '', startSource: '', mode: 'level' },
            GM_getValue('sa-turns-' + slot, {}));
    }
    function tnSave(slot, d) { GM_setValue('sa-turns-' + slot, d); }

    function renderTurns() {
        const sel = document.getElementById('sa-tn-slot');
        const form = document.getElementById('sa-tn-form');
        if (!sel || !form) return;
        const slot = GM_getValue('sa-turns-active', 'A');
        sel.innerHTML = planetOptions(slot);
        const d = tnLoad(slot);
        const saved = d.startSource === 'saved';
        const byTpm = d.mode === 'tpm';
        form.innerHTML = `
            <div class="sa-toggle" style="grid-column: 1 / -1">
                <button class="sa-btn ${byTpm ? '' : 'active'}" data-mode="level">By facility level</button>
                <button class="sa-btn ${byTpm ? 'active' : ''}" data-mode="tpm">By turn output (TPM)</button>
            </div>
            <label for="sa-tn-start">${byTpm ? 'Starting TPM' : 'Starting Level'}</label>
            <input id="sa-tn-start" data-key="${byTpm ? 'startTpm' : 'start'}"
                   value="${escapeHtml(byTpm ? d.startTpm : d.start)}" placeholder="${byTpm ? '44' : '9273'}" />
            <span class="sa-src ${saved ? '' : 'manual'}" title="${saved ? 'From saved Tick Generator' : 'Manual entry'}">${saved ? '●' : '○'}</span>
            ${byTpm ? `
            <label for="sa-tn-target">Target TPM</label>
            <input id="sa-tn-target" data-key="target" value="${escapeHtml(d.target)}" placeholder="50" />
            <span class="sa-src manual">○</span>` : `
            <label for="sa-tn-end">Ending Level</label>
            <input id="sa-tn-end" data-key="end" value="${escapeHtml(d.end)}" placeholder="10320" />
            <span class="sa-src manual">○</span>`}`;
        form.querySelectorAll('[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                const cur = tnLoad(slot);
                const next = btn.dataset.mode;
                if (cur.mode === next) return;
                // Convert the typed goal into the other format so it means the same thing
                const toTpm = (lvl) => {
                    const n = parseNumber(lvl);
                    return n != null && n > 0 ? String(+tpm(Math.round(n)).toFixed(3)) : null;
                };
                const toLevel = (t) => {
                    const n = parseNumber(t);
                    const L = n != null ? levelForTpm(n) : null;
                    return L != null ? String(L) : null;
                };
                if (next === 'tpm') {
                    cur.startTpm = toTpm(cur.start) ?? cur.startTpm;
                    cur.target = toTpm(cur.end) ?? cur.target;
                } else {
                    cur.start = toLevel(cur.startTpm) ?? cur.start;
                    cur.end = toLevel(cur.target) ?? cur.end;
                }
                cur.mode = next;
                tnSave(slot, cur);
                renderTurns();
            });
        });
        form.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                const cur = tnLoad(slot);
                cur[inp.dataset.key] = inp.value;
                if (inp.dataset.key === 'start' || inp.dataset.key === 'startTpm') cur.startSource = 'manual';
                tnSave(slot, cur);
                updateTurns();
            });
        });
        updateTurns();
    }

    function updateTurns() {
        const slot = GM_getValue('sa-turns-active', 'A');
        const d = tnLoad(slot);
        const out = document.getElementById('sa-tn-result');
        const byTpm = d.mode === 'tpm';
        const startTpmVal = byTpm ? parseNumber(d.startTpm) : null;
        const start = byTpm ? (startTpmVal != null ? levelForTpm(startTpmVal) : null)
                            : parseNumber(d.start);
        let end = parseNumber(d.end);
        const target = byTpm ? parseNumber(d.target) : null;
        if (start == null || (byTpm ? target == null : end == null)) {
            out.textContent = byTpm ? 'Enter a starting TPM and a target TPM.'
                                    : 'Enter a starting and ending level.';
            out.classList.add('sa-warn');
            out.textContent += '\n' + calcPlanBlock(slot, { tick: true, cg: true, rg: true }, 'MOST TICK GENERATOR LEVELS YOU CAN BUY').join('\n');
            return;
        }
        if (byTpm) {
            if (target <= tpm(Math.round(start))) {
                out.textContent = `Level ${Math.round(start).toLocaleString()} already gives ` +
                    `${tpm(Math.round(start)).toFixed(3)} TPM: target must be higher.`;
                out.classList.add('sa-warn');
                return;
            }
            end = levelForTpm(target);
        }
        const S = Math.round(start), E = Math.round(end);
        const c = calcTickUpgrade(S, E);
        if (c.tooBig) {
            out.textContent = `That's ${c.n.toLocaleString()} upgrades. Too many to sum here (max ${TN_MAX_STEPS.toLocaleString()}).`;
            out.classList.add('sa-warn');
            out.textContent += '\n' + calcPlanBlock(slot, { tick: true, cg: true, rg: true }, 'MOST TICK GENERATOR LEVELS YOU CAN BUY').join('\n');
            return;
        }
        if (c.n <= 0) {
            out.textContent = 'Ending level must be higher than starting level.';
            out.classList.add('sa-warn');
            out.textContent += '\n' + calcPlanBlock(slot, { tick: true, cg: true, rg: true }, 'MOST TICK GENERATOR LEVELS YOU CAN BUY').join('\n');
            return;
        }
        out.classList.remove('sa-warn');
        const before = tpm(S), after = tpm(E);
        // What this planet already has (its own Inventory). For credits, Have =
        // planet credits + bank balance (two separate pools, summed for cost).
        // Have = sum across ALL saved planets' inventories (A + B)
        const invs = planetIds().map(id => ({ id, d: invLoad(id) })).filter(x => x.d && x.d.items);
        const inv = invs.length ? invs : null;
        const bank = bankLoad();
        const haveIn = (d, re) => {
            const it = d.items.find(i => re.test(i.name) && i.value != null);
            return it ? it.value : null;
        };
        const have = (re) => {
            let sum = 0, found = false;
            invs.forEach(x => { const v = haveIn(x.d, re); if (v != null) { sum += v; found = true; } });
            return found ? sum : null;
        };
        const costRows = [
            { label: 'Credits', cost: c.credits, planet: have(/credit|money|cash/i),
              bank: bank ? bank.value : null },
            { label: 'Gold',    cost: c.gold,    have: have(/gold/i) },
            { label: 'Iron',    cost: c.iron,    have: have(/iron/i) },
            { label: 'Trit',    cost: c.trit,    have: have(/trit/i) },
        ];
        {
            const r = costRows[0];
            r.have = (r.planet == null && r.bank == null) ? null : (r.planet ?? 0) + (r.bank ?? 0);
        }
        const col = (t, w) => String(t).padStart(w);
        const lines = costRows.map(r => {
            const h = r.have ?? 0;
            const known = r.have != null;
            const need = Math.max(0, r.cost - h);
            return r.label.padEnd(8) + col(fmt(r.cost), 10) + col(known ? fmt(h) : '—', 10) +
                col(known ? (need === 0 ? '✓ 0' : fmt(need)) : fmt(r.cost), 10);
        });
        const affordable = costRows.every(r => r.cost <= (r.have ?? 0));

        // Credit value of each row at market BUY price (per unit). Credits = 1.
        const market = getMarket();
        const priceRe = { Gold: /^gold/i, Iron: /^iron/i, Trit: /^trit/i };
        const priceOf = (label) => {
            if (label === 'Credits') return 1;
            const m = (market?.resources || []).find(r => priceRe[label].test(r.name));
            return m && m.buyPrice != null ? m.buyPrice : null;
        };
        let totCost = 0, totNeed = 0;
        const missingPrice = [];
        const valueLines = costRows.map(r => {
            const p = priceOf(r.label);
            const need = Math.max(0, r.cost - (r.have ?? 0));
            if (p == null) { missingPrice.push(r.label); return r.label.padEnd(8) + col('no price', 20); }
            totCost += r.cost * p; totNeed += need * p;
            return r.label.padEnd(8) + col(fmt(r.cost * p), 11) + col(need === 0 ? '✓ 0' : fmt(need * p), 11);
        });
        const valueBlock = [
            '',
            'In credits (market buy price)',
            ''.padEnd(8) + col('Cost', 11) + col('Need', 11),
            ...valueLines,
            'TOTAL'.padEnd(8) + col(fmt(totCost), 11) + col(totNeed === 0 ? '✓ 0' : fmt(totNeed), 11),
            market ? `Prices from market scan ${new Date(market.savedAt).toLocaleString()}`
                   : 'No market data: Scan /market for prices.',
            ...(missingPrice.length && market ? [`Not in totals (no price): ${missingPrice.join(', ')}`] : []),
            '',
            ...(() => {
                // Gold/iron/tritium you hold cover the upgrade first; the rest can be sold
                const cap = capitalFor({ Gold: c.gold, Iron: c.iron, Tritium: c.trit });
                const needed = c.credits + cap.buyCost;
                const L = (l, v) => l.padEnd(20) + v;
                return [
                    'CAPITAL (selling spare resources)',
                    L('Credits on hand', fmt(cap.credits)),
                    L('+ spare sold', fmt(cap.sellValue) + (cap.sold.length ? `  (${cap.sold.join(', ')})` : '')),
                    ...(cap.bd.on ? [capitalLines(cap)[2]] : []),
                    L('= Capital', fmt(cap.capital)),
                    L('Needed', fmt(needed) + (cap.buyCost ? `  (credits + ${fmt(cap.buyCost)} to buy materials)` : '')),
                    cap.capital >= needed ? `✓ Affordable, ${fmt(cap.capital - needed)} left over`
                                          : `Short by ${fmt(needed - cap.capital)}`,
                    ...(cap.unpriced.length ? [`No market price for: ${cap.unpriced.join(', ')}`] : []),
                ];
            })(),
        ];
        const invNote = inv
            ? 'Have = ' + invs.map(x => `${slotLabel(x.id)} (saved ${new Date(x.d.savedAt).toLocaleString()})`).join(' + ')
            : 'No inventory saved yet: Need = full cost.';

        out.textContent = [
            ...(byTpm ? [`Levels: ${S.toLocaleString()} → ${E.toLocaleString()}  (${startTpmVal} → ${target} TPM)`] : []),
            `Times upgraded: ${c.n.toLocaleString()}`,
            '',
            'Resource'.padEnd(8) + col('Cost', 10) + col('Have', 10) + col('Need', 10),
            ...lines,
            inv ? (affordable ? 'You can afford this now.' : '') : '',
            'Credits have = ' + [
                ...invs.map(x => `${fmt(haveIn(x.d, /credit|money|cash/i) ?? 0)} ${shortName(x.id)}`),
                bank ? `${fmt(bank.value)} bank` : '0 bank (scan /bank)',
            ].join(' + '),
            invNote,
            ...valueBlock,
            '',
            `TPM before  ${before.toFixed(3)}`,
            `TPM after   ${after.toFixed(3)}`,
            `Increase    +${(after - before).toFixed(3)}  (+${((after / before - 1) * 100).toFixed(2)}%)`,
            ...calcPlanBlock(slot, { tick: true, cg: true, rg: true }, 'MOST TICK GENERATOR LEVELS YOU CAN BUY'),
        ].join('\n');
    }

    function tnFillFromSaved(slot) {
        const items = getFSlot(slot)?.items || [];
        const hit = items.find(i => /tick\s*generator/i.test(i.name) && i.value != null);
        const out = document.getElementById('sa-tn-result');
        if (!hit) {
            out.textContent = `No Tick Generator saved for ${slotLabel(slot)}. Scan Facilities → Resources and Save first.`;
            out.classList.add('sa-warn');
            return;
        }
        const d = tnLoad(slot);
        d.start = String(hit.value);
        d.startTpm = String(+tpm(Math.round(hit.value)).toFixed(3));
        d.startSource = 'saved';
        tnSave(slot, d);
        renderTurns();
    }

    document.getElementById('sa-tn-slot').addEventListener('change', (e) => {
        GM_setValue('sa-turns-active', e.target.value);
        renderTurns();
    });
    document.getElementById('sa-tn-fill').addEventListener('click', () =>
        tnFillFromSaved(GM_getValue('sa-turns-active', 'A')));
    renderTurns();

    // ---------- Resource Gen calculator (from the user's sheet) ----------
    // Per turn, with P = productivity, W = mine workers + mine slaves:
    //   Coal = 0.01·W^0.42 · (1+0.05·Digging) · P · (1+CoalWorkersCard)
    //   Iron = 0.01·W^0.4 · (1+0.05·Digging) · P · (1+IronWorkersCard)
    //        + 0.3·(2·IronMines^1.2) · (1+0.05·IronMining) · (1+IronMinesCard) + IronPT
    //   Gold = 0.01·W^0.32 · (1+0.05·Digging) · (1+GoldMinesCard) · (1+GoldWorkersCard) · P
    //        + 0.3·GoldMines^1.2 · (1+0.05·GoldMining) + GoldPT
    // Per day = per turn × turns per day; credits = amount × market price.
    const RG_FIELDS = [
        { sub: 'Planet' },
        { key: 'productivity', label: 'Productivity %', from: 'colony' },
        { key: 'mineWorkers',  label: 'Mine Workers',  from: 'units', match: /mine\s*workers/i },
        { key: 'mineSlaves',   label: 'Mine Slaves',   from: 'units', match: /mine\s*slaves/i },
        { key: 'ironMines',    label: 'Iron Mines lvl', from: 'facilities', match: /^iron\s*mines?$/i },
        { key: 'goldMines',    label: 'Gold Mines lvl', from: 'facilities', match: /^gold\s*mines?$/i },
        { sub: 'Research' },
        { key: 'digging',      label: 'Digging',       from: 'research', match: /^digging$/i },
        { key: 'ironMining',   label: 'Iron mining',   from: 'research', match: /^iron\s*mining$/i },
        { key: 'goldMining',   label: 'Gold mining',   from: 'research', match: /^gold\s*mining$/i },
        { sub: 'Card bonuses & extras' },
        { key: 'cCoalW', label: 'Coal Workers %', def: '0' },
        { key: 'cIronM', label: 'Iron Mines %',   def: '0' },
        { key: 'cIronW', label: 'Iron Workers %', def: '0' },
        { key: 'cGoldM', label: 'Gold Mines %',   def: '0' },
        { key: 'cGoldW', label: 'Gold Workers %', def: '0' },
        { key: 'ironPT', label: 'Iron per turn (flat)', def: '0' },
        { key: 'goldPT', label: 'Gold per turn (flat)', def: '0' },
    ];

    function rgProduction(x) {
        const P = x.productivity / 100, W = x.mineWorkers + x.mineSlaves, dig = 1 + 0.05 * x.digging;
        const pc = (k) => 1 + (x[k] || 0) / 100;
        const coal = 0.01 * Math.pow(W, 0.42) * dig * P * pc('cCoalW');
        const iron = 0.01 * Math.pow(W, 0.4) * dig * P * pc('cIronW')
                   + 0.3 * (2 * Math.pow(x.ironMines, 1.2)) * (1 + 0.05 * x.ironMining) * pc('cIronM') + (x.ironPT || 0);
        const gold = 0.01 * Math.pow(W, 0.32) * dig * pc('cGoldM') * pc('cGoldW') * P
                   + 0.3 * Math.pow(x.goldMines, 1.2) * (1 + 0.05 * x.goldMining) + (x.goldPT || 0);
        return { Coal: coal, Iron: iron, Gold: gold };
    }

    function rgLoad(slot) {
        return Object.assign({ now: {}, cmp: {}, sources: {} }, GM_getValue('sa-rg-' + slot, {}) || {});
    }
    function rgShared() {
        return Object.assign({ tpd: '', tpdSource: 'auto', basis: 'sell' }, GM_getValue('sa-rg-shared', {}) || {});
    }

    // Saved value for a field on this planet (null if unknown)
    function rgSaved(slot, f) {
        if (f.from === 'colony') { const c = GM_getValue('sa-colony-' + slot, null); return c && c.productivity != null ? String(c.productivity) : null; }
        const list = f.from === 'units' ? (getSlot(slot)?.units || []).map(u => ({ name: u.name, v: u.countDisplay || u.count }))
            : f.from === 'facilities' ? (getFSlot(slot)?.items || []).filter(i => i.kind !== 'area').map(i => ({ name: i.name, v: i.valueDisplay || i.value }))
            : f.from === 'research' ? (getRSlot('A')?.items || []).map(i => ({ name: i.name, v: i.valueDisplay || i.value })) : [];
        const hit = list.find(i => f.match.test(String(i.name).trim()));
        return hit && hit.v != null ? String(hit.v) : null;
    }
    // Turns per day from this planet's Tick Generator (TPM × 1,440)
    function rgAutoTpd(slot) {
        const tg = (getFSlot(slot)?.items || []).find(i => /tick\s*generator/i.test(i.name) && i.value != null);
        return tg ? Math.round(tpm(tg.value) * 1440) : null;
    }

    // Card effects → the sheet's card inputs. Only one card can be active.
    const RG_CARD_KEYS = ['cCoalW', 'cIronM', 'cIronW', 'cGoldM', 'cGoldW', 'ironPT', 'goldPT'];
    function rgCardBonus(card) {
        const b = {};
        (card.effects || []).forEach(e => {
            const st = e.stat.toLowerCase();
            if (/cost|price|defen|attack|spy|assassin/.test(st)) return;
            const flat = e.unit !== '%';
            const res = /coal/.test(st) ? 'coal' : /iron/.test(st) ? 'iron' : /gold/.test(st) ? 'gold' : null;
            if (!res) return;
            let key = null;
            if (flat && /turn|tick/.test(st)) key = res === 'iron' ? 'ironPT' : res === 'gold' ? 'goldPT' : null;
            else if (!flat && /mine/.test(st) && !/mining|miner|worker/.test(st)) key = res === 'iron' ? 'cIronM' : res === 'gold' ? 'cGoldM' : null;
            else if (!flat) key = res === 'coal' ? 'cCoalW' : res === 'iron' ? 'cIronW' : 'cGoldW';
            if (key) b[key] = (b[key] || 0) + e.value;
        });
        return b;
    }
    // Credits/day (or raw amount/day without prices) for a set of numeric inputs
    function rgValue(x, tpd, price) {
        const p = rgProduction(x);
        return ['Coal', 'Iron', 'Gold'].reduce((t, n) => t + p[n] * tpd * (price(n) ?? 1), 0);
    }
    function rgBestCard(base, tpd, price) {
        const data = GM_getValue('sa-cards', null);
        if (!data || !data.cards) return null;
        const none = Object.assign({}, base); RG_CARD_KEYS.forEach(k => none[k] = 0);
        const baseVal = rgValue(none, tpd, price);
        let best = null;
        data.cards.forEach(c => {
            const b = rgCardBonus(c);
            if (!Object.keys(b).length) return;
            const x = Object.assign({}, none, b);
            const gain = rgValue(x, tpd, price) - baseVal;
            if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && c.days > best.card.days)))
                best = { card: c, bonus: b, gain };
        });
        return best;
    }
    function rgPrice(sh) {
        const market = getMarket();
        return (name) => {
            const m = (market?.resources || []).find(r => r.name.toLowerCase() === name.toLowerCase());
            return m ? (sh.basis === 'buy' ? m.buyPrice : m.sellPrice) : null;
        };
    }

    function rgApplySaved(slot, d, force) {
        RG_FIELDS.forEach(f => {
            if (!f.key || RG_CARD_KEYS.includes(f.key)) return;   // card inputs are filled by the card logic
            const manual = d.sources[f.key] === 'manual' && d.now[f.key] !== '' && d.now[f.key] != null;
            if (f.from) {
                const v = rgSaved(slot, f);
                if (v != null && (force || !manual)) { d.now[f.key] = v; d.sources[f.key] = 'saved'; }
            } else if (d.now[f.key] == null || d.now[f.key] === '') d.now[f.key] = f.def;
        });
    }

    function renderResGen(force) {
        const sel = document.getElementById('sa-rg-slot'), form = document.getElementById('sa-rg-form');
        if (!sel || !form) return;
        const slot = GM_getValue('sa-rg-active', planetIds()[0] || 'A');
        sel.innerHTML = planetOptions(slot);
        const d = rgLoad(slot);
        const before = JSON.stringify(d);
        rgApplySaved(slot, d, force);
        {
            const nums = {};
            RG_FIELDS.forEach(f => { if (f.key) nums[f.key] = parseNumber(d.now[f.key]) ?? 0; });
            const sh0 = rgShared(), auto0 = rgAutoTpd(slot);
            const tpd0 = (sh0.tpdSource === 'manual' && sh0.tpd !== '' ? parseNumber(sh0.tpd) : auto0) || 1;
            const best = rgBestCard(nums, tpd0, rgPrice(sh0));
            // Typing any card value means "this is my card": the rest of the card inputs go to 0,
            // so two cards are never counted at once.
            const anyManual = !force && RG_CARD_KEYS.some(k => d.sources[k] === 'manual' && String(d.now[k] ?? '').trim() !== '');
            RG_CARD_KEYS.forEach(k => {
                if (anyManual) {
                    if (d.sources[k] !== 'manual') { d.now[k] = '0'; d.sources[k] = ''; }
                    return;
                }
                d.now[k] = String(best && best.bonus[k] != null ? best.bonus[k] : 0);
                d.sources[k] = best ? 'saved' : '';
            });
        }
        if (JSON.stringify(d) !== before) GM_setValue('sa-rg-' + slot, d);

        form.innerHTML = `<span></span><span class="sa-h">Now</span><span class="sa-h">Compare</span><span></span>` +
            RG_FIELDS.map(f => f.sub ? `<div class="sa-sub">${f.sub}</div>` : `
                <label>${escapeHtml(f.label)}</label>
                <input data-k="${f.key}" data-col="now" value="${escapeHtml(d.now[f.key] ?? '')}" />
                <input data-k="${f.key}" data-col="cmp" value="${escapeHtml(d.cmp[f.key] ?? '')}" placeholder="same" />
                <span class="sa-src ${d.sources[f.key] === 'saved' ? '' : 'manual'}">${d.sources[f.key] === 'saved' ? '●' : '○'}</span>`).join('');
        form.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
            const cur = rgLoad(slot);
            cur[inp.dataset.col][inp.dataset.k] = inp.value;
            if (inp.dataset.col === 'now') { cur.sources[inp.dataset.k] = inp.value.trim() ? 'manual' : ''; const dot = inp.parentElement && inp.nextElementSibling && inp.nextElementSibling.nextElementSibling; if (dot) { dot.textContent = '○'; dot.classList.add('manual'); } }
            GM_setValue('sa-rg-' + slot, cur);
            if (RG_CARD_KEYS.includes(inp.dataset.k) && inp.dataset.col === 'now') {
                const pos = inp.selectionStart; renderResGen();
                const again = document.querySelector(`#sa-rg-form input[data-k="${inp.dataset.k}"][data-col="now"]`);
                if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
            } else updateResGen();
        }));

        const sh = rgShared(), auto = rgAutoTpd(slot);
        const tpdVal = sh.tpdSource === 'manual' && sh.tpd !== '' ? sh.tpd : (auto != null ? auto.toLocaleString() : sh.tpd);
        document.getElementById('sa-rg-shared').innerHTML = `
            <label for="sa-rg-tpd">Turns per day</label>
            <input id="sa-rg-tpd" value="${escapeHtml(String(tpdVal ?? ''))}" placeholder="111,240" />
            <span class="sa-src ${sh.tpdSource === 'manual' || auto == null ? 'manual' : ''}"
                  title="${auto != null ? 'From Tick Generator: ' + tpm((getFSlot(slot)?.items || []).find(i => /tick\s*generator/i.test(i.name)).value).toFixed(2) + ' TPM × 1,440' : 'Scan Facilities to fill this'}">${sh.tpdSource === 'manual' || auto == null ? '○' : '●'}</span>
            <label for="sa-rg-basis">Value resources at</label>
            <select id="sa-rg-basis"><option value="sell" ${sh.basis === 'sell' ? 'selected' : ''}>Sell price</option>
                <option value="buy" ${sh.basis === 'buy' ? 'selected' : ''}>Buy price</option></select><span></span>`;
        document.getElementById('sa-rg-tpd').addEventListener('input', (e) => {
            const cur = rgShared(); cur.tpd = e.target.value; cur.tpdSource = e.target.value.trim() ? 'manual' : 'auto';
            GM_setValue('sa-rg-shared', cur); updateResGen();
        });
        document.getElementById('sa-rg-basis').addEventListener('change', (e) => {
            const cur = rgShared(); cur.basis = e.target.value; GM_setValue('sa-rg-shared', cur); updateResGen();
        });
        updateResGen();
    }

    function updateResGen() {
        const out = document.getElementById('sa-rg-result');
        if (!out) return;
        const slot = GM_getValue('sa-rg-active', planetIds()[0] || 'A');
        const d = rgLoad(slot), sh = rgShared();
        const num = (v) => parseNumber(v);
        const now = {}, cmp = {};
        const missing = [];
        RG_FIELDS.forEach(f => {
            if (!f.key) return;
            now[f.key] = num(d.now[f.key]);
            if (now[f.key] == null) missing.push(f.label);
            const c = d.cmp[f.key];
            cmp[f.key] = c != null && String(c).trim() !== '' ? num(c) : now[f.key];
        });
        const auto = rgAutoTpd(slot);
        const tpd = sh.tpdSource === 'manual' && sh.tpd !== '' ? num(sh.tpd) : (auto ?? num(sh.tpd));
        if (missing.length || tpd == null) {
            out.classList.add('sa-warn');
            out.textContent = 'Fill in: ' + [...missing, ...(tpd == null ? ['Turns per day'] : [])].join(', ');
            return;
        }
        out.classList.remove('sa-warn');
        const market = getMarket();
        const price = (name) => {
            const m = (market?.resources || []).find(r => r.name.toLowerCase() === name.toLowerCase());
            return m ? (sh.basis === 'buy' ? m.buyPrice : m.sellPrice) : null;
        };
        const a = rgProduction(now), b = rgProduction(cmp);
        const names = ['Coal', 'Iron', 'Gold'];
        const fmtN = (n) => Math.abs(n) < 1e3 ? (Math.round(n * 10) / 10).toLocaleString() : fmt(n);
        const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtN(Math.abs(n));
        let cpt = 0, cpd = 0, dCpd = 0;
        const rowsNow = names.map(n => {
            const p = price(n), perDay = a[n] * tpd;
            if (p != null) { cpt += a[n] * p; cpd += perDay * p; }
            return n.padEnd(6) + fmtN(a[n]).padStart(9) + fmtN(perDay).padStart(10) + (p != null ? fmt(perDay * p) : 'no price').padStart(13);
        });
        const changed = RG_FIELDS.some(f => f.key && cmp[f.key] !== now[f.key]);
        const rowsCmp = names.map(n => {
            const p = price(n), dt = b[n] - a[n];
            if (p != null) dCpd += dt * tpd * p;
            return n.padEnd(6) + sign(dt).padStart(9) + sign(dt * tpd).padStart(10) + (p != null ? sign(dt * tpd * p) : '—').padStart(13);
        });
        out.textContent = [
            `${tpd.toLocaleString()} turns/day · ${sh.basis} prices` + (market ? ` (market ${new Date(market.savedAt).toLocaleDateString()})` : ' · scan Market for prices'),
            '',
            'NOW'.padEnd(6) + 'Per turn'.padStart(9) + 'Per day'.padStart(10) + 'Credits/day'.padStart(13),
            ...rowsNow,
            `Credits per turn ${fmt(cpt)} · per day ${fmt(cpd)}`,
            (() => {
                const manual = RG_CARD_KEYS.some(k => d.sources[k] === 'manual');
                const best = rgBestCard(now, tpd, price);
                if (manual) return `Card: values typed by you` + (best ? ` (best saved: ${best.card.type})` : '');
                if (!best) return 'Card: no saved card boosts coal, iron or gold';
                return `Card: ${best.card.type}${best.card.level != null ? ' Lv ' + best.card.level : ''} ` +
                    `+${fmt(best.gain)}/day · lasts ${best.card.days} day${best.card.days === 1 ? '' : 's'}`;
            })(),
            ...(changed ? ['', 'COMPARE (change)', ...rowsCmp,
                `Credits per day ${sign(dCpd)} (${cpd ? (dCpd / cpd * 100 >= 0 ? '+' : '') + (dCpd / cpd * 100).toFixed(2) + '%' : '—'})`]
                : ['', 'Fill the Compare column to see what a change would add.']),
            ...calcPlanBlock(slot, { rg: true, area: true }, 'BEST AREAS FOR RESOURCES (Area Size → more mine workers)',
                'No saved area holds mine workers (looked for an area named like "Mines" or "Mining Area").'),
        ].join('\n');
    }

    document.getElementById('sa-rg-slot').addEventListener('change', (e) => {
        GM_setValue('sa-rg-active', e.target.value); renderResGen();
    });
    document.getElementById('sa-rg-fill').addEventListener('click', () => renderResGen(true));
    renderResGen();

    // ---------- Capital: credits + resources you could sell ----------
    // needs: amounts an upgrade consumes, e.g. { Gold: 1.2e9, Iron: 1e10, Tritium: 1.6e9 }.
    // Resources first cover what the upgrade needs; the rest is sellable at market SELL
    // price. Anything missing must be bought at market BUY price.
    function capitalFor(needs) {
        needs = needs || {};
        const market = getMarket();
        const priceOf = (name, kind) => {
            const m = (market?.resources || []).find(r => r.name.toLowerCase() === name.toLowerCase());
            return m ? (kind === 'buy' ? m.buyPrice : m.sellPrice) : null;
        };
        const bank = bankLoad();
        let credits = bank ? bank.value : 0;
        const stock = {};
        planetIds().forEach(id => (invLoad(id)?.items || []).forEach(i => {
            if (i.value == null) return;
            if (/credit|money|cash/i.test(i.name)) { credits += i.value; return; }
            const n = i.name.replace(/ #\d+$/, '');
            stock[n] = (stock[n] || 0) + i.value;
        }));
        let sellValue = 0, buyCost = 0;
        const unpriced = [], sold = [];
        new Set([...Object.keys(stock), ...Object.keys(needs)]).forEach(n => {
            const have = stock[n] || 0, need = needs[n] || 0;
            const spare = Math.max(0, have - need), short = Math.max(0, need - have);
            if (spare > 0) {
                const p = priceOf(n, 'sell');
                if (p == null) unpriced.push(n); else { sellValue += spare * p; sold.push(n); }
            }
            if (short > 0) {
                const p = priceOf(n, 'buy');
                if (p == null) unpriced.push(n); else buyCost += short * p;
            }
        });
        const bd = bdCapital();
        const capital = credits + sellValue + bd.value, pct = bdSettings().pct;
        return { credits, bankValue: bank ? bank.value : 0, sellValue, buyCost, capital, pct, available: capital * pct / 100, bd, sold, unpriced, market };
    }

    // ---------- Area Size calculator (from the user's sheet) ----------
    //   Credit cost  = ROUND(40000 · Σ k^1.7 for k = start … end, both included) · (1 − card%)
    //   Area size(L) = 2000 · (L+1)^1.5 · (1 + 0.02 · Tech)
    // Tech is the area's research (+2% per level). Only Industrial Area, Commercial Area
    // and Farms have one (Industrialism, Commercialism, Farmialism); other areas use Tech = 0.
    const AREA_TECH = [
        [/^industrial\s*area$/i, /^industrialism$/i, 'Industrialism'],
        [/^commercial\s*area$/i, /^commercialism$/i, 'Commercialism'],
        [/^farms?$/i,            /^farmialism$/i,    'Farmialism'],
    ];
    // Σ k^p for k = a..b inclusive. Exact loop for small ranges; for big ones the
    // Euler–Maclaurin sum, accurate to far better than display precision at these levels.
    function sumPow(a, b, p) {
        if (b < a) return 0;
        if (b - a <= 2e6) { let t = 0; for (let k = a; k <= b; k++) t += Math.pow(k, p); return t; }
        const F = (x) => Math.pow(x, p + 1) / (p + 1);
        return F(b) - F(a) + (Math.pow(a, p) + Math.pow(b, p)) / 2 + p / 12 * (Math.pow(b, p - 1) - Math.pow(a, p - 1));
    }
    const areaSize = (L, tech) => 2000 * Math.pow(L + 1, 1.5) * (1 + 0.02 * tech);
    // Smallest level whose size reaches the target
    function levelForSize(target, tech) {
        const m = 2000 * (1 + 0.02 * tech);
        if (!(target > 0)) return null;
        let L = Math.max(0, Math.ceil(Math.pow(target / m, 2 / 3) - 1));
        while (L > 0 && areaSize(L - 1, tech) >= target) L--;
        while (areaSize(L, tech) < target) L++;
        return L;
    }

    // Per planet: which area is selected and the card %; per area: everything else
    const arKey = (slot, area) => 'sa-area-' + slot + '|' + area;
    function arLoad(slot) {
        const top = GM_getValue('sa-area-' + slot, {}) || {};
        const area = top.area || '';
        const per = area ? (GM_getValue(arKey(slot, area), {}) || {}) : {};
        return Object.assign({ mode: 'level', start: '', end: '', target: '', tech: '', startSource: '', techSource: '' },
            per, { area, card: top.card != null ? top.card : '', cardSource: top.cardSource || '' });
    }
    function arSave(slot, d) {
        GM_setValue('sa-area-' + slot, { area: d.area, card: d.card, cardSource: d.cardSource });
        if (d.area) {
            const { area, card, cardSource, ...per } = d;
            GM_setValue(arKey(slot, d.area), per);
        }
    }
    function areasOf(slot) { return (getFSlot(slot)?.items || []).filter(i => i.kind === 'area' && i.value != null); }
    function techFor(areaName) {
        const m = AREA_TECH.find(([a]) => a.test(String(areaName).trim()));
        if (!m) return null;
        const r = (getRSlot('A')?.items || []).find(i => m[1].test(String(i.name).trim()));
        return { name: m[2], level: r ? r.value : null };
    }

    // Best saved Hero card that cuts area upgrade cost (most negative %), tie → longer lasting
    function bestAreaCard(areaName) {
        const data = GM_getValue('sa-cards', null);
        if (!data || !data.cards) return null;
        const word = String(areaName || '').toLowerCase().replace(/\s*area$/, '').replace(/s$/, '');
        let best = null;
        data.cards.forEach(c => (c.effects || []).forEach(e => {
            const st = e.stat.toLowerCase();
            if (!(e.value < 0) || e.unit !== '%' || !/cost/.test(st)) return;
            if (!/area/.test(st) && !(word && st.includes(word))) return;
            if (!best || e.value < best.value || (e.value === best.value && c.days > best.card.days))
                best = { value: e.value, stat: e.stat, card: c };
        }));
        return best;
    }

    function renderArea() {
        const sel = document.getElementById('sa-ar-slot'), areaSel = document.getElementById('sa-ar-area');
        const form = document.getElementById('sa-ar-form');
        if (!sel || !form) return;
        const slot = GM_getValue('sa-area-active', planetIds()[0] || 'A');
        sel.innerHTML = planetOptions(slot);
        const d = arLoad(slot);
        const areas = areasOf(slot);
        if (!d.area && areas.length) d.area = areas[0].name;
        areaSel.innerHTML = areas.length
            ? areas.map(a => `<option ${a.name === d.area ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')
            : `<option>${escapeHtml(d.area || 'No areas saved')}</option>`;
        // Fill from saved unless typed by hand
        const before = JSON.stringify(d);
        const cur = areas.find(a => a.name === d.area);
        if (cur && d.startSource !== 'manual') { d.start = cur.valueDisplay || String(cur.value); d.startSource = 'saved'; }
        const t = techFor(d.area);
        if (t && t.level != null && d.techSource !== 'manual') { d.tech = String(t.level); d.techSource = 'saved'; }
        const bc = bestAreaCard(d.area);
        if (d.cardSource !== 'manual') { d.card = bc ? String(Math.abs(bc.value)) : '0'; d.cardSource = bc ? 'saved' : ''; }
        if (JSON.stringify(d) !== before) arSave(slot, d);

        const byLevel = d.mode !== 'size';
        const dot = (src) => `<span class="sa-src ${src === 'saved' ? '' : 'manual'}">${src === 'saved' ? '●' : '○'}</span>`;
        form.innerHTML = `
            <div class="sa-toggle" style="grid-column: 1 / -1">
                <button class="sa-btn ${byLevel ? 'active' : ''}" data-mode="level">By level</button>
                <button class="sa-btn ${byLevel ? '' : 'active'}" data-mode="size">By area size</button>
            </div>
            <label>Starting level</label><input data-k="start" value="${escapeHtml(d.start)}" placeholder="15,289,140" />${dot(d.startSource)}
            ${byLevel
                ? `<label>Ending level</label><input data-k="end" value="${escapeHtml(d.end)}" placeholder="15,300,000" />${dot()}`
                : `<label>Target area size</label><input data-k="target" value="${escapeHtml(d.target)}" placeholder="2 Sx" />${dot()}`}
            ${t ? `<label>Tech level (${t.name})</label><input data-k="tech" value="${escapeHtml(d.tech)}" placeholder="18" />${dot(d.techSource)}` : ''}
            <label title="${bc ? escapeHtml(`${bc.card.type}${bc.card.level != null ? ' Lv ' + bc.card.level : ''}: ${bc.value}% ${bc.stat}`) : 'No saved card lowers area upgrade cost'}">Card cost reduction %</label>
            <input data-k="card" value="${escapeHtml(d.card)}" placeholder="0" />${dot(d.cardSource)}`;
        form.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
            const c = arLoad(slot);
            c[inp.dataset.k] = inp.value;
            if (inp.dataset.k === 'start') c.startSource = 'manual';
            if (inp.dataset.k === 'tech') c.techSource = 'manual';
            if (inp.dataset.k === 'card') c.cardSource = inp.value.trim() ? 'manual' : '';
            arSave(slot, c);
            updateArea();
        }));
        form.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
            const c = arLoad(slot);
            if (c.mode === b.dataset.mode) return;
            const tech = techFor(c.area) ? (parseNumber(c.tech) || 0) : 0;
            // Keep the goal meaning the same when switching
            if (b.dataset.mode === 'size') { const e = parseNumber(c.end); if (e != null) c.target = Math.floor(areaSize(Math.round(e), tech)).toLocaleString(); }
            else { const tg = parseNumber(c.target); const L = tg != null ? levelForSize(tg, tech) : null; if (L != null) c.end = L.toLocaleString(); }
            c.mode = b.dataset.mode;
            arSave(slot, c);
            renderArea();
        }));
        updateArea();
    }

    function updateArea() {
        const out = document.getElementById('sa-ar-result');
        if (!out) return;
        const slot = GM_getValue('sa-area-active', planetIds()[0] || 'A');
        const d = arLoad(slot);
        const hasTech = !!techFor(d.area);
        const S = parseNumber(d.start), tech = hasTech ? parseNumber(d.tech) : 0, card = parseNumber(d.card) || 0;
        let E = d.mode === 'size' ? null : parseNumber(d.end);
        const target = d.mode === 'size' ? parseNumber(d.target) : null;
        if (S == null || tech == null || (d.mode === 'size' ? target == null : E == null)) {
            out.classList.add('sa-warn');
            out.textContent = 'Fill in: ' + [S == null && 'Starting level', tech == null && 'Tech level',
                d.mode === 'size' ? target == null && 'Target area size' : E == null && 'Ending level'].filter(Boolean).join(', ');
            out.textContent += '\n' + calcPlanBlock(slot, { cg: true, rg: true, area: d.area }, `MOST ${String(d.area || 'AREA').toUpperCase()} LEVELS YOU CAN BUY`).join('\n');
            return;
        }
        const s0 = Math.round(S);
        if (d.mode === 'size') E = levelForSize(target, tech);
        E = Math.round(E);
        const startSize = areaSize(s0, tech), endSize = areaSize(E, tech);
        if (E <= s0) {
            out.classList.add('sa-warn');
            out.textContent = d.mode === 'size'
                ? `Level ${s0.toLocaleString()} is already ${fmt(startSize)}: pick a bigger target.`
                : 'Ending level must be higher than starting level.';
            out.textContent += '\n' + calcPlanBlock(slot, { cg: true, rg: true, area: d.area }, `MOST ${String(d.area || 'AREA').toUpperCase()} LEVELS YOU CAN BUY`).join('\n');
            return;
        }
        out.classList.remove('sa-warn');
        const raw = Math.round(40000 * sumPow(s0, E, 1.7));
        const cost = raw * (1 - card / 100);
        // Capital: credits (planets + bank) + all stored resources sold at market sell price
        const cap = capitalFor({});
        const line = (l, v) => l.padEnd(20) + v;
        out.textContent = [
            `${d.area || 'Area'}${d.mode === 'size' ? ` · level needed ${E.toLocaleString()}` : ''}`,
            line('Times upgraded', (E - s0).toLocaleString()),
            '',
            line('Credit cost', fmt(cost) + (card ? `  (−${card}% card)` : '')),
            (() => {
                const bc = bestAreaCard(d.area);
                if (d.cardSource === 'manual') return line('Card', `${card}% typed by you` + (bc ? ` (best saved: ${Math.abs(bc.value)}%)` : ''));
                return bc ? line('Card', `${bc.card.type}${bc.card.level != null ? ' Lv ' + bc.card.level : ''} · lasts ${bc.card.days} day${bc.card.days === 1 ? '' : 's'}`)
                          : line('Card', 'none saved that lowers area cost');
            })(),
            ...(card ? [line('Without card', fmt(raw))] : []),
            line('Per level (avg)', fmt(cost / (E - s0))),
            '',
            ...capitalLines(cap).slice(0, -1),
            line('= Capital', fmt(cap.capital) + (cap.capital >= cost ? '  ✓ affordable' : `  short ${fmt(cost - cap.capital)}`)),
            ...(cap.capital >= cost && cap.credits < cost ? [`  (needs selling ${fmt(cost - cap.credits)} of resources)`] : []),
            ...(cap.unpriced.length ? [`  No market price for: ${cap.unpriced.join(', ')}`] : []),
            '',
            line('Starting size', fmt(startSize)),
            line('Ending size', fmt(endSize)),
            line('Size gain', `+${fmt(endSize - startSize)} (+${((endSize / startSize - 1) * 100).toFixed(3)}%)`),
            '',
            hasTech ? `${techFor(d.area).name} ${tech} → ×${(1 + 0.02 * tech).toFixed(2)} size` : 'No research affects this area\'s size',
            ...calcPlanBlock(slot, { cg: true, rg: true, area: d.area }, `MOST ${String(d.area || 'AREA').toUpperCase()} LEVELS YOU CAN BUY`),
        ].join('\n');
    }

    document.getElementById('sa-ar-slot').addEventListener('change', (e) => { GM_setValue('sa-area-active', e.target.value); renderArea(); });
    document.getElementById('sa-ar-area').addEventListener('change', (e) => {
        const slot = GM_getValue('sa-area-active', planetIds()[0] || 'A');
        const top = GM_getValue('sa-area-' + slot, {}) || {};
        GM_setValue('sa-area-' + slot, Object.assign(top, { area: e.target.value }));
        renderArea();
    });
    renderArea();

    // ---------- Brains & diamonds (read on /research) ----------
    // Counts are empire-wide. With the toggle on, their credit value joins your capital:
    // a value you type, else the market sell price if the market lists them.
    var sbReady = false;   // true once every calculator is set up (var: readable before this line)
    // [key, label, icon/name test, word for text search, xpath on /research]
    function bdKinds() { return [
        ['brains', 'Brains', /brain/i, 'Brains?', '//*[@id="content-wrap"]/research/div/div/div/div/span/div[3]/span/div'],
        ['diamonds', 'Diamonds', /diamond/i, 'Diamonds?', null],
        ['ssb', 'SSB', /\bssb\b|super\s*science/i, 'SSBs?', '//*[@id="content-wrap"]/research/div/div/div/div/span/div[3]/span[2]/div'],
    ]; }
    function isBdRow(name) { return /^\s*(brains?|diamonds?|ssbs?)\s*:?\s*$/i.test(String(name)); }
    function bdCounts() { return GM_getValue('sa-bd-counts', null); }
    // use: which of brains / diamonds / SSB count as capital; pct: share of capital to plan with
    function bdSettings() {
        const s = Object.assign({ brains: '', diamonds: '', ssb: '', pct: 100 }, GM_getValue('sa-bd', {}) || {});
        if (!s.useKinds) s.useKinds = { brains: !!s.use, diamonds: !!s.use, ssb: false };   // from v2.4.0's single toggle
        s.pct = Math.min(100, Math.max(0, Math.round((parseNumber(s.pct) ?? 100) / 5) * 5));
        return s;
    }
    function bdSave(s) { delete s.use; GM_setValue('sa-bd', s); }

    function readResearchCurrency(items) {
        const out = {};
        const put = (k, value, display, source) => {
            if (out[k] == null && value != null && Number.isFinite(value)) out[k] = { value, display: display || fmt(value), source };
        };
        // 0) the exact spots on the Research page
        bdKinds().forEach(([k, , , , xp]) => {
            if (!xp) return;
            let el = null;
            try { el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) {}
            if (!el) return;
            const r = readAmountCell(el);
            if (r.value != null) { put(k, r.value, r.display, 'page'); return; }
            const m = (el.textContent || '').replace(/\s+/g, ' ').match(new RegExp(NUM));
            if (m) put(k, parseNumber(m[0]), m[0].trim(), 'page');
        });
        // 1) rows the research table scanner picked up ("Brains" / "1.2 T")
        (items || []).forEach(i => bdKinds().forEach(([k, , re]) => {
            if (re.test(i.name) && String(i.name).length < 30) put(k, i.value, i.valueRaw ?? i.valueDisplay, 'table');
        }));
        // 2) an icon (brain.png / diamond.png) with an amount beside it
        document.querySelectorAll('img').forEach(img => {
            if (img.closest('#' + PANEL_ID)) return;
            const key = `${img.getAttribute('src') || ''} ${img.alt || ''} ${img.title || ''}`;
            bdKinds().forEach(([k, , re]) => {
                if (out[k] != null || !re.test(key)) return;
                let el = img.parentElement;
                for (let i = 0; el && i < 3; i++, el = el.parentElement) {
                    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (txt.length > 60) break;
                    const r = readAmountCell(el);
                    if (r.value != null) { put(k, r.value, r.display, 'icon'); break; }
                }
            });
        });
        // 3) plain text: "Brains: 1.2 T" or "1.2 T Brains"
        const text = pageText();
        bdKinds().forEach(([k, , , w]) => {
            if (out[k] != null) return;
            let m = text.match(new RegExp(`\\b${w}\\b\\s*:?\\s*(${NUM})`, 'i'));
            if (!m) m = text.match(new RegExp(`(${NUM})\\s*${w}\\b`, 'i'));
            if (m) put(k, parseNumber(m[1]), m[1].trim(), 'text');
        });
        return out;
    }

    // Credit value of one brain / diamond (null = unknown)
    function bdUnitValue(kind) {
        const typed = parseNumber(bdSettings()[kind]);
        if (typed != null) return { value: typed, source: 'typed' };
        const re = bdKinds().find(k => k[0] === kind)[2];
        const m = (getMarket()?.resources || []).find(r => re.test(r.name));
        if (m && m.sellPrice != null) return { value: m.sellPrice, source: 'market' };
        return null;
    }
    function bdCapital() {
        const s = bdSettings(), c = bdCounts();
        const on = bdKinds().some(([k]) => s.useKinds[k]);
        const res = { on, value: 0, parts: [], unpriced: [], missing: !c };
        if (!on || !c) return res;
        bdKinds().forEach(([k, label]) => {
            if (!s.useKinds[k]) return;
            const n = c[k] && c[k].value;
            if (!(n > 0)) return;
            const u = bdUnitValue(k);
            if (!u) { res.unpriced.push(label); return; }
            res.value += n * u.value;
            res.parts.push(label);
        });
        return res;
    }
    function bdCountText() {
        const c = bdCounts();
        if (!c) return 'not scanned yet: open /research';
        return bdKinds().map(([k, l]) => `${l} ${c[k] ? fmt(c[k].value) : '?'}`).join(' · ');
    }

    // The shared toggle, shown at the top of every calculator
    function renderBdBars() {
        const s = bdSettings();
        const c0 = bdCounts();
        document.querySelectorAll(`#${PANEL_ID} .sa-bd-bar`).forEach(el => {
            el.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px">
                    <span class="sa-label" style="margin:0">Capital to use</span>
                    <input type="range" class="sa-pct" min="0" max="100" step="5" value="${s.pct}" style="flex:1; min-width:90px" />
                    <b class="sa-pct-val" style="width:34px; text-align:right">${s.pct}%</b>
                </div>
                <div style="display:flex; gap:4px; margin:4px 0 6px">
                    ${[25, 50, 75, 100].map(p => `<button class="sa-btn ${s.pct === p ? 'active' : ''}" data-pct="${p}" style="flex:1; margin:0">${p}%</button>`).join('')}
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap">
                    ${bdKinds().map(([k, l]) => `<label class="sa-check"><input type="checkbox" data-use="${k}" ${s.useKinds[k] ? 'checked' : ''} />
                        <span>${l} <span style="color:var(--muted)">${c0 && c0[k] ? fmt(c0[k].value) : '?'}</span></span></label>`).join('')}
                </div>`;
            const setPct = (p, full) => {
                const cur = bdSettings(); cur.pct = p; bdSave(cur);
                el.querySelector('.sa-pct-val').textContent = p + '%';
                full ? refreshCalcs() : refreshCalcs(true);
            };
            el.querySelector('.sa-pct').addEventListener('input', (e) => setPct(+e.target.value, false));
            el.querySelector('.sa-pct').addEventListener('change', (e) => setPct(+e.target.value, true));
            el.querySelectorAll('[data-pct]').forEach(b => b.addEventListener('click', () => setPct(+b.dataset.pct, true)));
            el.querySelectorAll('input[data-use]').forEach(cb => cb.addEventListener('change', () => {
                const cur = bdSettings(); cur.useKinds[cb.dataset.use] = cb.checked; bdSave(cur);
                refreshCalcs();
            }));
        });
        const form = document.getElementById('sa-bd-form');
        if (form && !form.contains(document.activeElement)) {
            form.innerHTML = bdKinds().map(([k, l]) => {
                const u = bdUnitValue(k), c = bdCounts();
                return `<label>${l} (have ${c && c[k] ? fmt(c[k].value) : '?'})</label>
                    <input data-bd="${k}" value="${escapeHtml(s[k])}" placeholder="${u && u.source === 'market' ? fmt(u.value) + ' (market)' : 'credits each'}" />
                    <span class="sa-src ${u && u.source === 'market' ? '' : 'manual'}">${u && u.source === 'market' ? '●' : '○'}</span>`;
            }).join('');
            form.querySelectorAll('input[data-bd]').forEach(inp => inp.addEventListener('input', () => {
                const cur = bdSettings(); cur[inp.dataset.bd] = inp.value; bdSave(cur);
                refreshCalcs(true);
            }));
        }
        const view = document.getElementById('sa-bd-view');
        if (view) {
            const c = bdCounts();
            view.innerHTML = `<div class="sa-label">Brains, diamonds &amp; SSB</div>
                <div class="sa-value">${escapeHtml(bdCountText())}</div>
                <div style="font-size:10px; color:var(--muted)">${c ? 'Saved ' + new Date(c.savedAt).toLocaleString() +
                    ' · read from the ' + Object.values(c).filter(x => x && x.source).map(x => x.source).filter((v, i, a) => a.indexOf(v) === i).join('/') : 'Scan the Research page to save them.'}</div>`;
        }
    }
    function refreshCalcs(keepForm) {
        if (!sbReady) return;
        if (!keepForm) renderBdBars();
        updateTurnGenResult(); updateTurns(); updateResGen(); updateArea(); renderOptimizer();
    }

    // ---------- Best spend: what all your capital could buy ----------
    // Σ k^p, a..b inclusive; closed form for big spans or high levels (same method for a
    // given a, so differences between two calls are smooth)
    function sumPowFast(a, b, p) {
        if (b < a) return 0;
        if (a < 50 && b - a <= 2e6) { let t = 0; for (let k = a; k <= b; k++) t += Math.pow(k, p); return t; }
        const F = (x) => Math.pow(x, p + 1) / (p + 1);
        return F(b) - F(a) + (Math.pow(a, p) + Math.pow(b, p)) / 2 + p / 12 * (Math.pow(b, p - 1) - Math.pow(a, p - 1));
    }

    // Credit Gen model for a planet: daily credits per extra worker of each kind
    function cgModel(slot) {
        const data = tgLoad(slot);
        tgApplySaved(slot, data, false);
        const v = {};
        TG_FIELDS.forEach(f => v[f.key] = f.type === 'select' ? (data.values[f.key] || '').trim() : parseNumber(data.values[f.key]));
        const res = calcTurnGen(v);
        if (!res) return null;
        const mode = WORK_MODES.find(m => m[0] === v.workMode), work = mode ? mode[1] : 1;
        const base = (1 + 0.4 * Math.pow(v.incomeFac, 1.17) / 100) * v.productivity / 100;
        const econ = 1 + 0.02 * v.economy, fee = v.galaxyFee / 100, A = cgAssumptions();
        const dayMult = work * A.ticksPerDay + (1 - fee) * A.turnsPerDay * A.printDays / 7;
        return { perWorkerDay: { industrial: 8 * base * dayMult, commercial: 30 * base * econ * dayMult },
                 perTurn: res.perTurn, perDay: res.passiveDay + res.printAvg };
    }

    // Resource Gen model for a planet (inputs as Resource Gen would fill them)
    function rgModel(slot) {
        const d = rgLoad(slot), sh = rgShared();
        rgApplySaved(slot, d, false);
        const x = {};
        let ok = true;
        RG_FIELDS.forEach(f => {
            if (!f.key) return;
            const n = parseNumber(d.now[f.key]);
            if (n == null) { if (RG_CARD_KEYS.includes(f.key) || f.def != null) x[f.key] = 0; else ok = false; }
            else x[f.key] = n;
        });
        if (!ok) return null;
        const auto = rgAutoTpd(slot);
        const tpd = sh.tpdSource === 'manual' && sh.tpd !== '' ? parseNumber(sh.tpd) : (auto ?? parseNumber(sh.tpd));
        if (!tpd) return null;
        const price = rgPrice(sh);
        const manualCard = RG_CARD_KEYS.some(k => d.sources[k] === 'manual' && String(d.now[k] ?? '').trim() !== '');
        if (!manualCard) {
            RG_CARD_KEYS.forEach(k => x[k] = 0);
            const best = rgBestCard(x, tpd, price);
            if (best) Object.assign(x, best.bonus);
        }
        const val = (y) => { const p = rgProduction(y); return ['Coal', 'Iron', 'Gold'].reduce((t, n) => t + p[n] * tpd * (price(n) ?? 0), 0); };
        const perDay = val(x);
        return { tpd, perDay, perTurn: perDay / tpd,
                 gainWorkers: (dw) => val(Object.assign({}, x, { mineWorkers: x.mineWorkers + dw })) - perDay };
    }

    // Which workers an area holds (its size = how many fit)
    function areaWorkerKind(name) {
        const n = String(name).trim();
        return /industrial/i.test(n) ? 'industrial' : /commercial/i.test(n) ? 'commercial' : /min(e|ing)/i.test(n) ? 'mine' : null;
    }
    function areaCardPct(slot, name) {
        const top = GM_getValue('sa-area-' + slot, {}) || {};
        if (top.area === name && top.cardSource === 'manual') return parseNumber(top.card) || 0;
        const bc = bestAreaCard(name);
        return bc ? Math.abs(bc.value) : 0;
    }

    // Spending options on one planet. use: { cg, rg, tick, area: name | true }
    // Each option: { label, L0, cum(E) → { credits, mats }, gain(E) → credits/day vs L0 }
    function spendOptions(slot, use, notes) {
        const opts = [];
        let cg = null, rg = null;
        try { cg = cgModel(slot); } catch (e) { cg = null; }
        try { rg = rgModel(slot); } catch (e) { rg = null; }
        const pn = shortName(slot);
        areasOf(slot).forEach(a => {
            const name = a.name.trim();
            if (typeof use.area === 'string' ? use.area !== name : !use.area) return;
            const kind = areaWorkerKind(name);
            const t = techFor(name);
            const tech = t && t.level != null ? t.level : 0;
            const mult = 2000 * (1 + 0.02 * tech);
            const card = areaCardPct(slot, name);
            const L0 = Math.round(a.value);
            let gain = null, what = '';
            if ((kind === 'industrial' || kind === 'commercial') && use.cg) {
                if (cg) { gain = (ds) => ds * cg.perWorkerDay[kind]; what = `${kind} workers`; }
                else notes.push(`${pn}: fill Credit Gen to value ${name}`);
            } else if (kind === 'mine' && use.rg) {
                if (rg) { gain = (ds) => rg.gainWorkers(ds); what = 'mine workers'; }
                else notes.push(`${pn}: fill Resource Gen to value ${name}`);
            }
            if (!gain && typeof use.area !== 'string') return;
            const size = (L) => mult * Math.pow(L + 1, 1.5);
            opts.push({
                slot, label: `${pn} · ${name}`, short: name, L0, what, card,
                size, sizeGain: (E) => size(E) - size(L0),
                cum: (E) => ({ credits: E <= L0 ? 0 : 40000 * sumPowFast(L0, E, 1.7) * (1 - card / 100), mats: {} }),
                gain: gain ? (E) => gain(size(E) - size(L0)) : () => 0,
                hasGain: !!gain,
            });
        });
        if (use.tick) {
            const tg = (getFSlot(slot)?.items || []).find(i => /tick\s*generator/i.test(i.name) && i.value != null);
            if (!tg) notes.push(`${pn}: scan Facilities for the Tick Generator level`);
            else {
                const perTurn = (use.cg && cg ? cg.perTurn : 0) + (use.rg && rg ? rg.perTurn : 0);
                if (!perTurn) notes.push(`${pn}: fill Credit Gen or Resource Gen to value extra turns`);
                const L0 = Math.round(tg.value);
                opts.push({
                    slot, label: `${pn} · Tick Generator`, short: 'Tick Generator', L0, what: 'turns', perTurn,
                    cum: (E) => {
                        if (E <= L0) return { credits: 0, mats: {} };
                        const n = E - L0, s25 = sumPowFast(L0, E - 1, 2.5), s13 = sumPowFast(L0, E - 1, 1.3), s15 = sumPowFast(L0, E - 1, 1.5);
                        return { credits: 8e8 * n + 1.2e9 * s25, mats: { Gold: n + 8 * s13, Iron: 3 * n + 10 * s15, Tritium: n + 10 * s13 } };
                    },
                    turnsGain: (E) => (tpm(E) - tpm(L0)) * 1440,
                    gain: (E) => (tpm(E) - tpm(L0)) * 1440 * perTurn,
                    hasGain: perTurn > 0,
                });
            }
        }
        return opts;
    }

    // Split the capital between options, a slice at a time, always buying where the next
    // slice earns the most credits per day per credit. Materials you own are valued at
    // their sell price (you give up selling them); materials you lack at the buy price.
    function planSpend(opts, capital, force) {
        const market = getMarket();
        const price = (n, kind) => {
            const m = (market?.resources || []).find(r => r.name.toLowerCase() === n.toLowerCase());
            return m ? (kind === 'buy' ? m.buyPrice : m.sellPrice) : null;
        };
        const stock = {};
        planetIds().forEach(id => (invLoad(id)?.items || []).forEach(i => {
            if (i.value == null || /credit|money|cash/i.test(i.name)) return;
            const n = i.name.replace(/ #\d+$/, '');
            stock[n] = (stock[n] || 0) + i.value;
        }));
        const used = {};
        const matCost = (u) => Object.keys(u).reduce((t, n) => {
            const have = stock[n] || 0, q = u[n] || 0;
            const own = Math.min(q, have), buy = Math.max(0, q - have);
            return t + own * (price(n, 'sell') ?? 0) + (buy > 0 ? buy * (price(n, 'buy') ?? Infinity) : 0);
        }, 0);
        const st = opts.map(o => ({ o, E: o.L0, spent: 0, mats: {} }));
        const costTo = (s, E2) => {
            const a = s.o.cum(s.E), b = s.o.cum(E2);
            let dm = 0;
            if (Object.keys(b.mats).length) {
                const after = Object.assign({}, used);
                Object.keys(b.mats).forEach(n => after[n] = (after[n] || 0) - (a.mats[n] || 0) + b.mats[n]);
                dm = matCost(after) - matCost(used);
            }
            return b.credits - a.credits + dm;
        };
        const N = 120;
        let pool = 0, spent = 0;
        const step = (budget) => {
            let best = null;
            st.forEach(s => {
                if (!s.o.hasGain && !force) return;
                if (!(costTo(s, s.E + 1) <= budget)) return;
                let lo = s.E + 1, d = 2;
                while (d < 1e13 && costTo(s, s.E + d) <= budget) { lo = s.E + d; d *= 2; }
                let hi = Math.min(s.E + d, s.E + 1e13);
                while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (costTo(s, mid) <= budget) lo = mid; else hi = mid; }
                const c = costTo(s, lo), g = s.o.hasGain ? s.o.gain(lo) - s.o.gain(s.E) : lo - s.E;
                if (g > 0 && c > 0 && (!best || g / c > best.r)) best = { s, E: lo, c, r: g / c };
            });
            if (!best) return 0;
            const s = best.s, a = s.o.cum(s.E), b = s.o.cum(best.E);
            Object.keys(b.mats).forEach(n => used[n] = (used[n] || 0) - (a.mats[n] || 0) + b.mats[n]);
            s.E = best.E; s.spent += best.c;
            return best.c;
        };
        for (let i = 0; i < N && capital > 0; i++) {
            pool += capital / N;
            const c = step(pool); pool -= c; spent += c;
        }
        for (let i = 0; i < 40; i++) { const c = step(pool); if (!c) break; pool -= c; spent += c; }
        const rows = st.filter(s => s.E > s.o.L0).map(s => ({
            o: s.o, E: s.E, levels: s.E - s.o.L0, spent: s.spent, gain: s.o.gain(s.E),
            mats: s.o.cum(s.E).mats,
        }));
        return { rows, spent, left: capital - spent, gain: rows.reduce((t, r) => t + r.gain, 0), used };
    }

    function capitalLines(cap) {
        const L = (l, v) => l.padEnd(20) + v;
        return [
            L('Credits on hand', fmt(cap.credits)),
            L('+ resources sold', fmt(cap.sellValue) + (cap.sold.length ? `  (${cap.sold.join(', ')})` : '')),
            ...(cap.bd.on ? [L('+ brains/dia/SSB', cap.bd.missing ? 'not scanned (open /research)'
                : fmt(cap.bd.value) + (cap.bd.parts.length ? `  (${cap.bd.parts.join(', ')})` : '')
                + (cap.bd.unpriced.length ? `  no value for ${cap.bd.unpriced.join(', ')}: set it in Best Spend` : ''))] : []),
            L('= Capital', fmt(cap.capital)),
            ...(cap.pct < 100 ? [L(`× ${cap.pct}% to spend`, fmt(cap.available))] : []),
        ];
    }

    function planLines(plan, title) {
        const days = (r) => r.gain > 0 ? r.spent / r.gain : Infinity;
        const dd = (x) => Number.isFinite(x) ? (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString()) + ' d' : '—';
        const out = [title];
        if (!plan.rows.length) { out.push('Nothing affordable that adds income.'); return out; }
        plan.rows.forEach(r => {
            out.push(`${r.o.label}`);
            out.push(`  Lv ${r.o.L0.toLocaleString()} → ${r.E.toLocaleString()} (+${r.levels.toLocaleString()})`);
            const extra = r.o.what === 'turns'
                ? `+${fmt(r.o.turnsGain(r.E))} turns/day`
                : `+${fmt(r.o.sizeGain(r.E))} ${r.o.what || 'size'}`;
            out.push(`  Spend ${fmt(r.spent)} · ${extra}`);
            if (r.o.hasGain) out.push(`  +${fmt(r.gain)} credits/day · pays back ${dd(days(r))}`);
        });
        if (plan.rows.length > 1) out.push(`Total: spend ${fmt(plan.spent)}`, `  +${fmt(plan.gain)} credits/day` +
            (plan.gain > 0 ? ` · pays back ${dd(plan.spent / plan.gain)}` : ''));
        if (plan.left > 0) out.push(`Left over: ${fmt(plan.left)}`);
        return out;
    }

    // Lines a calculator appends: what all capital could do there
    function calcPlanBlock(slot, use, title, emptyMsg) {
        if (!sbReady) return [];
        const notes = [];
        const opts = spendOptions(slot, use, notes);
        const cap = capitalFor({});
        const out = ['', '━━ ALL CAPITAL HERE ━━', ...capitalLines(cap), ''];
        if (!opts.length) return [...out, title, ...(notes.length ? notes : [emptyMsg || 'No saved data to plan with yet.'])];
        // One option (Turn Gen, Area): buy as many levels as the capital allows
        const plan = planSpend(opts, cap.available, opts.length === 1);
        return [...out, ...planLines(plan, title), ...(notes.length ? ['', ...notes] : []),
            '', 'Each calculator assumes all capital goes here. Best Spend splits it.'];
    }

    function renderOptimizer() {
        const out = document.getElementById('sa-opt-result');
        if (!out || !sbReady) return;
        const ids = planetIds();
        if (!ids.length) { out.textContent = 'Save at least one planet first (Facilities, Units, Inventory).'; out.classList.add('sa-warn'); return; }
        out.classList.remove('sa-warn');
        const notes = [];
        const opts = ids.flatMap(id => spendOptions(id, { cg: true, rg: true, tick: true, area: true }, notes));
        const cap = capitalFor({});
        const plan = planSpend(opts, cap.available);
        const mats = Object.keys(plan.used).filter(n => plan.used[n] > 0);
        out.textContent = [
            ...capitalLines(cap),
            ...(cap.unpriced.length ? [`  No market price for: ${cap.unpriced.join(', ')}`] : []),
            '',
            ...planLines(plan, 'BEST SPLIT (most credits/day)'),
            ...(mats.length ? ['Materials used: ' + mats.map(n => `${n} ${fmt(plan.used[n])}`).join(', ')] : []),
            '',
            'Options looked at:',
            ...opts.map(o => `  ${o.label}${o.hasGain ? '' : ' (no gain model)'}`),
            ...(notes.length ? ['', ...notes] : []),
            '',
            'Assumes: area size = worker room, and new room is filled with workers',
            '(training cost not counted). Extra turns are worth Credit Gen per-turn',
            'credits + Resource Gen per-turn credits.',
        ].join('\n');
    }

    // ---------- Inventory (stored resources from the top resource bar) ----------
    // The resource bar sits outside <main> on every page. Each value is an
    // <amount> (often a span with the exact number in its title). We label each
    // value from the nearest icon (img alt/title) or text label beside it.
    // Resource icons → names. The game uses image files like
    // .../pic/resources/coal.png; inventory icons may have no alt text.
    // A function (hoisted) so it's usable from code that runs before this point
    function iconNames() {
        return { income: 'Credits', money: 'Credits', cash: 'Credits', credit: 'Credits',
                 credits: 'Credits', trit: 'Tritium', tritium: 'Tritium' };
    }
    // Normalize names in already-saved inventory too (e.g. "Income" → "Credits")
    function resName(n) {
        const m = String(n).match(/^(.*?)( #\d+)?$/);
        const mapped = iconNames()[m[1].trim().toLowerCase()];
        return mapped ? mapped + (m[2] || '') : n;
    }
    function nameFromImg(img) {
        const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
        let base = alt;
        if (!base) {
            const src = img.getAttribute('src') || '';
            base = (src.split('/').pop() || '').split('?')[0].replace(/\.[a-z0-9]+$/i, '');
        }
        base = base.replace(/[_-]+/g, ' ').trim();
        if (!base) return null;
        const key = base.toLowerCase();
        return iconNames()[key] || base.charAt(0).toUpperCase() + base.slice(1);
    }

    // The cell around one amount: climb while the ancestor still holds only
    // this one <amount>, then look for an icon inside it.
    function labelForAmount(am) {
        let cell = am;
        while (cell.parentElement && cell.parentElement.querySelectorAll('amount').length === 1) {
            cell = cell.parentElement;
        }
        const img = cell.querySelector('img');
        if (img) { const n = nameFromImg(img); if (n) return n; }
        const t = (cell.getAttribute && cell.getAttribute('title') || '').trim();
        if (t && parseNumber(t) == null) return t;
        return null;
    }

    function findInventoryBox() {
        // Deepest element whose text is the "Planet Inventory" header
        const headers = Array.from(document.querySelectorAll('body *')).filter(el => {
            if (el.closest(`#${PANEL_ID}`)) return false;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return /^planet inventory\s*\+?$/i.test(t) &&
                !Array.from(el.children).some(c => /planet inventory/i.test(c.textContent || ''));
        });
        for (const h of headers) {
            let el = h.parentElement;
            for (let i = 0; el && i < 6; i++, el = el.parentElement) {
                if (el.querySelector('amount')) return el;
            }
        }
        return null;
    }

    function readInventory() {
        const box = findInventoryBox();
        let amounts;
        if (box) {
            amounts = Array.from(box.querySelectorAll('amount'));
        } else {
            const main = document.querySelector('main');
            amounts = Array.from(document.querySelectorAll('amount')).filter(am =>
                !am.closest(`#${PANEL_ID}`) && !(main && main.contains(am)));
        }
        const items = [];
        const used = {};
        amounts.forEach((am, idx) => {
            const titled = am.querySelector('span[title]') || (am.matches('[title]') ? am : null);
            const exact = titled ? parseNumber(titled.getAttribute('title')) : null;
            const display = (am.textContent || '').replace(/\s+/g, ' ').trim();
            const value = exact != null ? exact : parseNumber(display.replace(/\(.*\)/, '').trim());
            if (value == null && !display) return;
            let name = labelForAmount(am) || `Resource ${idx + 1}`;
            used[name] = (used[name] || 0) + 1;
            if (used[name] > 1) name += ` #${used[name]}`;
            items.push({ name, value, display });
        });
        return {
            source: box ? 'planet-inventory-box' : 'fallback-outside-main',
            items,
            unlabeled: items.filter(i => /^Resource \d+$/.test(i.name)).length,
        };
    }

    // Bank balance: only readable on /bank. Find a short element mentioning
    // "balance" and take the nearest <amount> or number beside it.
    // "Galaxy fee (spend turns)  x%" on /bank's Central bank tab. The game
    // only renders a tab's contents while it's open, so open it before scanning.
    function readGalaxyFee() {
        if (pageKey !== 'bank') return null;
        const RE = /galaxy\s*fee\s*(?:\([^)]*\))?\s*:?\s*(-?\d+(?:[.,]\d+)?)\s*%/i;
        const root = document.querySelector('main') || document.body;
        const labels = Array.from(root.querySelectorAll('*')).filter(el => {
            if (el.closest(`#${PANEL_ID}`)) return false;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return t.length < 80 && /galaxy\s*fee/i.test(t) &&
                !Array.from(el.children).some(c => /galaxy\s*fee/i.test(c.textContent || ''));
        });
        for (const lab of labels) {
            let el = lab;
            for (let i = 0; el && i < 4; i++, el = el.parentElement) {
                const m = (el.textContent || '').replace(/\s+/g, ' ').match(RE);
                if (m) {
                    const value = parseFloat(m[1].replace(',', '.'));
                    return { value, display: `${m[1]}%`, label: (lab.textContent || '').trim().slice(0, 60) };
                }
            }
        }
        return { value: null, error: 'galaxy fee not found: open the Central bank tab, then Scan' };
    }
    function readCentralBank() {
        if (pageKey !== 'bank') return null;
        const root = document.querySelector('main') || document.body;
        const raw = (root.innerText || '').split('\n');
        const fields = [];
        const seen = new Set();
        const LINE = /^\s*([A-Za-z][^:\t]{1,50}?)\s*(?::|\t)\s*(-?[\d][\d.,]*\s*(?:%|[A-Za-z]+)?|\?\?\?)\s*$/;
        raw.forEach(line => {
            const m = line.match(LINE);
            if (!m) return;
            const label = m[1].replace(/\s+/g, ' ').trim();
            const display = m[2].replace(/\s+/g, ' ').trim();
            if (seen.has(label.toLowerCase())) return;
            seen.add(label.toLowerCase());
            const isPct = /%$/.test(display);
            const value = isPct ? parseFloat(display) : parseNumber(display);
            fields.push({ label, display, value, isPct });
        });
        return { fields };
    }
    function storeCentralBank(cb) {
        GM_setValue('sa-central-bank', { savedAt: new Date().toISOString(), fields: cb.fields });
    }
    function centralBankLoad() { return GM_getValue('sa-central-bank', null); }

    function renderBank() {
        const view = document.getElementById('sa-bank-view');
        if (!view) return;
        const cb = centralBankLoad();
        const bal = bankLoad(), gf = galaxyFeeLoad();
        if (!cb && !bal && !gf) {
            view.innerHTML = `<div class="sa-empty">Nothing saved yet. Open /bank → Central bank and Scan.</div>`;
            return;
        }
        const top = [
            bal ? `Balance: ${fmt(bal.value)}` : 'Balance: not read',
            gf ? `Galaxy fee (spend turns): ${gf.display}` : 'Galaxy fee: not read',
        ].join('\n');
        const rows = (cb?.fields || []).map(f => `<tr>
            <td>${escapeHtml(f.label)}</td>
            <td class="sa-num" title="${escapeHtml(f.value != null && !f.isPct ? f.value.toLocaleString() : '')}">${
                escapeHtml(f.isPct || f.value == null ? f.display : fmt(f.value))}</td></tr>`).join('');
        view.innerHTML = `
            <div class="sa-recommend" style="margin-bottom:8px">${escapeHtml(top)}</div>
            ${rows ? `<table class="sa-unit-table">
                <thead><tr><th>Central bank</th><th style="text-align:right">Value</th></tr></thead>
                <tbody>${rows}</tbody></table>` :
                `<div class="sa-empty">No Central bank fields read yet.</div>`}
            <div class="sa-slot-meta" style="margin-top:6px">${
                cb ? `Read ${new Date(cb.savedAt).toLocaleString()}` : ''}</div>`;
    }

    function storeGalaxyFee(fee) {
        GM_setValue('sa-galaxy-fee', { value: fee.value, display: fee.display, savedAt: new Date().toISOString() });
    }
    function galaxyFeeLoad() { return GM_getValue('sa-galaxy-fee', null); }

    function readBankBalance() {
        if (pageKey !== 'bank') return null;
        const root = document.querySelector('main') || document.body;
        const labels = Array.from(root.querySelectorAll('*')).filter(el => {
            if (el.closest(`#${PANEL_ID}`)) return false;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return t.length < 60 && /balance/i.test(t) &&
                !Array.from(el.children).some(c => /balance/i.test(c.textContent || ''));
        });
        for (const lab of labels) {
            let el = lab;
            for (let i = 0; el && i < 4; i++, el = el.parentElement) {
                const am = el.querySelector('amount');
                if (am) {
                    const titled = am.querySelector('span[title]');
                    const exact = titled ? parseNumber(titled.getAttribute('title')) : null;
                    const display = (am.textContent || '').replace(/\s+/g, ' ').trim();
                    const value = exact ?? parseNumber(display);
                    if (value != null) return { value, display, label: lab.textContent.trim().slice(0, 40) };
                }
                // number in the label's own text, e.g. "Balance: 1.2 T"
                const m = (el.textContent || '').replace(/\s+/g, ' ')
                    .match(/balance[^\d\-]*(-?[\d.,]+\s*(?:[A-Za-z]+)?)/i);
                if (m) {
                    const value = parseNumber(m[1].trim());
                    if (value != null) return { value, display: m[1].trim(), label: lab.textContent.trim().slice(0, 40) };
                }
            }
        }
        return { value: null, error: 'balance not found' };
    }

    function invLoad(slot) {
        const d = GM_getValue('sa-inv-' + slot, null);
        if (d && d.items) d.items = d.items.map(i => Object.assign({}, i, { name: resName(i.name) }));
        return d;
    }
    // The bank balance is the same on every planet (empire-wide), so it's
    // stored once rather than per slot.
    function storeBank(bal) {
        GM_setValue('sa-bank', { value: bal.value, display: bal.display, savedAt: new Date().toISOString() });
    }
    function bankLoad() { return GM_getValue('sa-bank', null); }

    function saveInventory(slot) {
        const status = document.getElementById('sa-status');
        const inv = readInventory();
        if (inv.items.length === 0) {
            document.getElementById('sa-inv-view').innerHTML =
                `<div class="sa-empty">Couldn't find the Planet Inventory box on this page.</div>`;
            return;
        }
        const bal = readBankBalance();
        if (bal && bal.value != null) storeBank(bal);
        GM_setValue('sa-inv-' + slot, { savedAt: new Date().toISOString(), items: inv.items });
        if (status) status.textContent = `Saved ${inv.items.length} resources to Slot ${slot}` +
            (bal && bal.value != null ? ' + bank balance' :
             pageKey === 'bank' ? ' (bank balance not found on page)' : '');
        renderInventory();
        updateTurns();
    }

    function renderInventory() {
        const actions = document.getElementById('sa-inv-actions');
        const view = document.getElementById('sa-inv-view');
        if (!actions || !view) return;
        actions.innerHTML =
            `<button class="sa-btn" data-inv-save="1" style="margin:0" title="Scan and save the planet open in-game">Save open planet</button>` +
            `<button class="sa-btn sa-btn-danger" data-inv-clear="1" title="Clear saved inventory for every planet">Clear all</button>`;
        actions.querySelector('[data-inv-save]').addEventListener('click', () => saveAll(null, true));
        actions.querySelector('[data-inv-clear]').addEventListener('click', () => {
            if (confirm('Clear saved inventory for every planet?')) {
                SLOT_IDS.forEach(id => GM_setValue('sa-inv-' + id, null)); renderInventory(); updateTurns();
            }
        });

        const slots = planetIds().map(id => ({ id, data: invLoad(id) })).filter(x => x.data && x.data.items);
        if (slots.length === 0) {
            const b0 = bankLoad();
            view.innerHTML = (b0 ? `<div class="sa-recommend" style="margin-bottom:8px">Bank balance (all planets): ${
                escapeHtml(fmt(b0.value))}</div>` : '') +
                `<div class="sa-empty">No inventory saved yet. Click Save for the planet you're on.</div>`;
            return;
        }
        // Union of resource names, in first-seen order
        const names = [];
        slots.forEach(x => x.data.items.forEach(i => { if (!names.includes(i.name)) names.push(i.name); }));
        const showTotal = slots.length > 1;
        const rows = names.map(n => {
            let total = 0, anyVal = false;
            const cells = slots.map(x => {
                const it = x.data.items.find(i => i.name === n);
                if (it && it.value != null) { total += it.value; anyVal = true; }
                return `<td class="sa-num" title="${escapeHtml(it?.value != null ? it.value.toLocaleString() : '')}">${
                    it ? escapeHtml(it.value != null ? fmt(it.value) : it.display) : '—'}</td>`;
            }).join('');
            return `<tr><td>${escapeHtml(n)}</td>${cells}${
                showTotal ? `<td class="sa-num" style="color:var(--text)">${anyVal ? fmt(total) : '—'}</td>` : ''}</tr>`;
        }).join('');
        const unlabeled = names.filter(n => /^Resource \d+$/.test(n)).length;
        const bank = bankLoad();
        const bankLine = bank
            ? `<div class="sa-recommend" style="margin-bottom:8px">Bank balance (all planets): ${
                escapeHtml(fmt(bank.value))}  <span style="color:var(--muted); font-size:10px">read ${
                escapeHtml(new Date(bank.savedAt).toLocaleString())}</span></div>`
            : `<div class="sa-slot-meta" style="margin-bottom:8px">Bank balance: visit /bank and Scan or Save once.</div>`;
        view.innerHTML = `${bankLine}
            <div class="sa-scroll"><table class="sa-unit-table">
                <thead><tr><th>Resource</th>${slots.map(x =>
                    `<th style="text-align:right">${escapeHtml(shortName(x.id))}</th>`).join('')}
                    ${showTotal ? '<th style="text-align:right">Total</th>' : ''}</tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <div class="sa-slot-meta" style="margin-top:6px">
                ${slots.map(x => `${escapeHtml(slotLabel(x.id))}: saved ${new Date(x.data.savedAt).toLocaleString()}`).join('<br>')}
            </div>
            ${unlabeled ? `<div style="font-size:10px; color:var(--warn); margin-top:4px">
                ${unlabeled} value(s) had no recognisable icon and are shown as "Resource N".</div>` : ''}`;
    }
    renderInventory();
    renderBank();

    // ---------- Nation page ----------
    // Text of the game's page, without this panel
    function pageText() {
        return Array.from(document.body.children)
            .filter(el => el !== panel && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE')
            .map(el => el.innerText || '').join('\n').replace(/[ \t]+/g, ' ');
    }
    const NUM = '-?\\d[\\d.,]*(?:\\s*(?:Thousand|Million|Billion|Trillion|Quadrillion|Quintillion|Sextillion|Septillion|Octillion|[kKmMbBtTqQ])\\b)?';
    const NATION_FIELDS = [
        { key: 'population',  label: 'Population',        re: `Population:\\s*(${NUM})\\s*Units` },
        { key: 'growth',      label: 'Growth (untrained/tick)', re: `Growth:\\s*(${NUM})\\s*Untrained` },
        { key: 'army',        label: 'Army size',         re: `Army size:\\s*(${NUM})\\s*Units\\s*\\(([\\d.]+)%\\)` },
        { key: 'sickness',    label: 'Sickness',          re: `Sickness:\\s*(${NUM})\\s*Units\\s*\\(([\\d.]+)%\\)` },
        { key: 'pollution',   label: 'Pollution',         re: `Pollution:\\s*(${NUM})` },
        { key: 'temperature', label: 'Temperature (°C)',  re: `Temperature:\\s*(-?[\\d.]+)` },
        { key: 'trees',       label: 'Forest size (trees)', re: `Size:\\s*(${NUM})\\s*Trees` },
        { key: 'coverage',    label: 'Forest coverage %', re: `coverage:\\s*([\\d.,]+)\\s*%` },
        { key: 'treeGrowth',  label: 'Tree growth/tick',  re: `Growth speed[^:]*:\\s*(${NUM})\\s*Trees` },
        { key: 'chest',       label: 'Reward chest %',    re: `Reward Chest\\s*([\\d.]+)\\s*%` },
    ];

    function readNation() {
        if (pageKey !== 'nation') return null;
        const text = pageText();
        const fields = [];
        NATION_FIELDS.forEach(f => {
            const m = text.match(new RegExp(f.re, 'i'));
            if (!m) return;
            const display = m[1].trim();
            fields.push({ key: f.key, label: f.label, display,
                value: parseNumber(display), pct: m[2] != null ? parseFloat(m[2]) : null });
        });
        const addr = text.match(/Address:\s*#?\(?([\d-]+)\)?/);
        const chestTime = text.match(/Unlocked in ([^\n]+?)(?:\n|$)/i);
        // Planet Defense table: rows "VS <type> | units | defensive strength"
        const defense = [];
        document.querySelectorAll('main tr, body > * tr').forEach(tr => {
            if (tr.closest(`#${PANEL_ID}`)) return;
            const cells = Array.from(tr.children).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
            if (cells.length >= 3 && /^VS\s+/i.test(cells[0]) && parseNumber(cells[1]) != null &&
                !defense.some(d => d.type === cells[0])) {
                defense.push({ type: cells[0].replace(/\s*\?$/, '').trim(),
                    units: parseNumber(cells[1]), unitsDisplay: cells[1],
                    strength: parseNumber(cells[2].replace(/[^\d.,A-Za-z ]/g, '').trim()),
                    strengthDisplay: cells[2].replace(/[^\d.,A-Za-z ]/g, '').trim() });
            }
        });
        return {
            planet: readPlanetName(),
            address: addr ? addr[1] : null,
            chestUnlock: chestTime ? chestTime[1].trim() : null,
            fields, defense,
        };
    }

    // ---------- Colony status (every page) ----------
    // The top bar's Colony status box holds Happiness, Sickness and Productivity.
    // It can be a hover tooltip, so read textContent (includes hidden text).
    function gameTextAll() {
        // Page text including hidden boxes, but never script/style code or this panel
        const parts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                const p = n.parentElement;
                if (!p || p.closest('script, style, noscript, template') || panel.contains(p)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        let n;
        while ((n = walker.nextNode())) parts.push(n.data);
        return parts.join(' ').replace(/\s+/g, ' ');
    }
    // Colony Status window (<colony-status-popup>): a table whose first row names
    // the columns (Productivity · Sickness · Wealth) and whose later row holds the
    // percentages, e.g. xpath …/colony-status-popup/…/table/tr[3]/td.
    function readColonyPopup() {
        const popup = document.querySelector('colony-status-popup');
        if (!popup) return null;
        const out = {};
        const rows = Array.from(popup.querySelectorAll('tr'));
        const cellText = (td) => (td.textContent || '').replace(/\s+/g, ' ').trim();
        const headIdx = rows.findIndex(r => /productivity/i.test(r.textContent || ''));
        if (headIdx >= 0) {
            const names = Array.from(rows[headIdx].children).map(cellText);
            const valueRow = rows.slice(headIdx + 1).find(r =>
                Array.from(r.children).some(td => /^-?\d+(?:\.\d+)?\s*%/.test(cellText(td))));
            if (valueRow) {
                Array.from(valueRow.children).forEach((td, i) => {
                    const m = cellText(td).match(/^(-?\d+(?:\.\d+)?)\s*%/);
                    const name = (names[i] || '').toLowerCase();
                    if (!m) return;
                    if (name.includes('productivity')) out.productivity = parseFloat(m[1]);
                    else if (name.includes('sickness')) out.sickness = parseFloat(m[1]);
                    else if (name.includes('wealth')) out.wealth = parseFloat(m[1]);
                });
            }
        }
        const t = (popup.textContent || '').replace(/\s+/g, ' ');
        const h = t.match(/Happiness\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
        if (h) out.happiness = parseFloat(h[1]);
        const mh = t.match(/Maximum happiness\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
        if (mh) out.maxHappiness = parseFloat(mh[1]);
        out.workModeText = (t.match(/Work mode\s*:\s*(.{1,20})/i) || [])[1] || null;
        return out;
    }

    function readColony() {
        const t = gameTextAll();
        const pct = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
        // Hover box ("Productivity: 91.86%") as the fallback
        const out = {
            productivity: pct(/Productivity\s*:\s*(\d+(?:\.\d+)?)\s*%/i),
            happiness:    pct(/Happiness\s*:?\s*(\d+(?:\.\d+)?)\s*%/i),
            sickness:     pct(/Sickness\s*:\s*(\d+(?:\.\d+)?)\s*%/i),
            wealth: null, maxHappiness: null, workMode: null,
        };
        // The Colony Status window, when open, wins
        const pop = readColonyPopup();
        if (pop) ['productivity', 'happiness', 'sickness', 'wealth', 'maxHappiness'].forEach(k => {
            if (pop[k] != null) out[k] = pop[k];
        });
        const wm = pop && pop.workModeText ? [null, pop.workModeText] : t.match(/Work mode\s*:\s*(.{1,20})/i);
        if (wm) {
            const after = wm[1].toLowerCase();
            const hit = WORK_MODES.map(m => m[0]).sort((a, b) => b.length - a.length)
                .find(n => after.startsWith(n.toLowerCase()));
            if (hit) out.workMode = hit;
        }
        return out;
    }

    // The game only creates the Colony status box while you hover it (and the
    // Colony Status window while it's open), so watch the page and save the
    // values the moment they appear, without waiting for a scan.
    let colonyLastKey = '', colonyTimer = null;
    function captureColony() {
        const col = readColony();
        if (col.productivity == null && !col.workMode) return;
        const key = [col.productivity, col.happiness, col.sickness, col.wealth, col.workMode].join('|');
        if (key === colonyLastKey) return;            // nothing new since last time
        const d = detectPlanet();
        if (!d.slot) return;
        if (d.assign) nameSlot(d.slot, d.name);       // first time seeing this planet
        colonyLastKey = key;
        const prev = GM_getValue('sa-colony-' + d.slot, {}) || {};
        const merged = { savedAt: new Date().toISOString() };
        ['productivity', 'happiness', 'sickness', 'wealth', 'maxHappiness', 'workMode'].forEach(k =>
            merged[k] = col[k] != null ? col[k] : (prev[k] ?? null));
        GM_setValue('sa-colony-' + d.slot, merged);
        const st = document.getElementById('sa-status');
        if (st) st.textContent = `Saved colony status for ${slotLabel(d.slot)}: productivity ${merged.productivity ?? '?'}%` +
            (merged.workMode ? `, work mode ${merged.workMode}` : '');
        renderNation(); renderTurnGen(); renderPlanetList();
    }
    function startColonyWatch() {
        new MutationObserver(muts => {
            if (muts.every(m => panel.contains(m.target))) return;
            clearTimeout(colonyTimer);
            colonyTimer = setTimeout(captureColony, 250);
        }).observe(document.body, { childList: true, subtree: true });
        captureColony();
    }

    function renderNation() {
        const view = document.getElementById('sa-nation-view');
        if (!view) return;
        const slots = planetIds().map(id => ({ id, d: GM_getValue('sa-nation-' + id, null) || { fields: [] },
                c: GM_getValue('sa-colony-' + id, null) }))
            .filter(x => x.d.fields.length || x.c);
        if (!slots.length) {
            view.innerHTML = `<div class="sa-empty">No nation data yet. Open the Nation page and click Scan.</div>`;
            return;
        }
        const head = `<tr><th></th>${slots.map(x =>
            `<th style="text-align:right">${escapeHtml(shortName(x.id))}</th>`).join('')}</tr>`;
        const cell = (txt, title) => `<td class="sa-num" title="${escapeHtml(title || '')}">${escapeHtml(txt)}</td>`;
        const colonyRows = [
            ['Productivity %', 'productivity'], ['Happiness %', 'happiness'], ['Max happiness %', 'maxHappiness'],
            ['Sickness %', 'sickness'], ['Wealth %', 'wealth'], ['Work mode', 'workMode'],
        ].map(([label, k]) => {
            if (slots.every(x => !x.c || x.c[k] == null)) return '';
            return `<tr><td>${label}</td>${slots.map(x =>
                cell(x.c && x.c[k] != null ? String(x.c[k]) : '—')).join('')}</tr>`;
        }).join('');
        const rows = colonyRows + NATION_FIELDS.map(f => {
            const vals = slots.map(x => x.d.fields.find(v => v.key === f.key));
            if (vals.every(v => !v)) return '';
            return `<tr><td>${escapeHtml(f.label)}</td>${vals.map(v => !v ? cell('—') :
                cell(/%|°C/.test(f.label) ? v.display : (v.value != null ? fmt(v.value) : v.display) +
                    (v.pct != null ? ` (${v.pct}%)` : ''),
                    v.value != null ? v.value.toLocaleString() : '')).join('')}</tr>`;
        }).join('');
        const extra = [
            ['Address', x => x.d.address ? `#(${x.d.address})` : '—'],
            ['Chest unlocks in', x => x.d.chestUnlock || '—'],
        ].map(([label, get]) => `<tr><td>${label}</td>${slots.map(x =>
            `<td style="text-align:right; font-size:10px">${escapeHtml(get(x))}</td>`).join('')}</tr>`).join('');
        const types = [];
        slots.forEach(x => (x.d.defense || []).forEach(d => { if (!types.includes(d.type)) types.push(d.type); }));
        const defRows = types.map(t => `<tr><td>${escapeHtml(t)}</td>${slots.map(x => {
            const d = (x.d.defense || []).find(v => v.type === t);
            return d ? `<td class="sa-num" style="font-size:10px">${escapeHtml(d.unitsDisplay)} units<br>${
                escapeHtml(d.strengthDisplay)} str</td>` : cell('—');
        }).join('')}</tr>`).join('');
        view.innerHTML = `
            <div class="sa-scroll"><table class="sa-unit-table"><thead>${head}</thead><tbody>${rows}${extra}</tbody></table></div>
            ${defRows ? `<div class="sa-label" style="margin-top:10px">Planet defense</div>
                <div class="sa-scroll"><table class="sa-unit-table"><thead>${head}</thead><tbody>${defRows}</tbody></table></div>` : ''}
            <div class="sa-slot-meta" style="margin-top:6px">${slots.map(x =>
                `${escapeHtml(slotLabel(x.id))}: ${x.d.savedAt ? 'Nation page saved ' + new Date(x.d.savedAt).toLocaleString()
                    : 'Nation page not saved yet'}${x.c ? ' · colony ' + new Date(x.c.savedAt).toLocaleString() : ''}`).join('<br>')}</div>`;
    }
    renderNation();

    // ---------- Hero cards (My collection) ----------
    // Each card: type name, optional level badge, effect lines like
    // "+17% Outgoing assassin strength", and a "9 Days" badge. Cards are found
    // from their Days badge, climbing to the largest box holding only that badge.
    const DAYS_RE = /^(\d+)\s*Days?$/i;
    const EFFECT_RE = /([+\-−])\s*(\d+(?:\.\d+)?)\s*(%?)\s*([^+\-−]+)/g;

    function readCards() {
        if (pageKey !== 'my-collection') return null;
        const root = document.querySelector('main') || document.body;
        const badges = Array.from(root.querySelectorAll('*')).filter(el => {
            if (el.closest(`#${PANEL_ID}`)) return false;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return DAYS_RE.test(t) && !Array.from(el.children).some(c => DAYS_RE.test((c.textContent || '').replace(/\s+/g, ' ').trim()));
        });
        const countIn = (el) => badges.filter(b => el.contains(b)).length;
        const cards = [];
        badges.forEach(badge => {
            let card = badge;
            while (card.parentElement && card.parentElement !== root && countIn(card.parentElement) === 1) card = card.parentElement;
            const days = parseInt((badge.textContent.match(/\d+/) || [])[0], 10);
            const lines = cardLines(card).filter(l => !DAYS_RE.test(l));
            const typeLine = lines.find(l => /[A-Za-z]/.test(l) && !/^[+\-−]\s*\d/.test(l)) || '?';
            const levelLine = lines.find(l => /^\d+$/.test(l));
            // The level badge can share the name's line: "Astronomer 2"
            const tm = typeLine.match(/^(.*?[A-Za-z].*?)\s*(\d+)$/);
            const type = tm ? tm[1].trim() : typeLine;
            const level = tm ? parseInt(tm[2], 10) : (levelLine ? parseInt(levelLine, 10) : null);
            const rest = lines.filter(l => l !== typeLine && l !== levelLine).join(' ');
            const effects = [];
            let m;
            EFFECT_RE.lastIndex = 0;
            while ((m = EFFECT_RE.exec(rest)) !== null) {
                const sign = m[1] === '+' ? 1 : -1;
                const stat = m[4].replace(/\s+/g, ' ').trim();
                if (!stat) continue;
                effects.push({ value: sign * parseFloat(m[2]), unit: m[3] || '', stat,
                    raw: `${m[1]}${m[2]}${m[3]} ${stat}` });
            }
            cards.push({ type, level, days, effects });
        });
        return { cards, types: [...new Set(cards.map(c => c.type))].length };
    }

    function renderCards() {
        const view = document.getElementById('sa-cards-view');
        if (!view) return;
        const data = GM_getValue('sa-cards', null);
        if (!data || !data.cards || !data.cards.length) {
            view.innerHTML = `<div class="sa-empty">No cards saved yet. Open your Hero card collection and click Scan.</div>`;
            return;
        }
        // Only one card can be active, so each effect shows its strongest card.
        // Negative effects (e.g. cost reductions) are best when most negative.
        const isBetter = (a, b) => a.value < 0 ? a.value < b.value : a.value > b.value;
        const byEffect = {};
        data.cards.forEach(c => c.effects.forEach(e => {
            const k = e.stat.toLowerCase() + '|' + e.unit;
            (byEffect[k] = byEffect[k] || { stat: e.stat, unit: e.unit, list: [] }).list.push({ e, c });
        }));
        const signed = (v, u) => `${v > 0 ? '+' : ''}${v}${u}`;
        const dayStyle = () => '';   // days = how long a card lasts once used, not a countdown
        const daysTip = (d) => `Lasts ${d} day${d === 1 ? '' : 's'} once used`;
        const cardTag = (c) => `${c.type}${c.level != null ? ' Lv ' + c.level : ''}`;
        Object.values(byEffect).forEach(g => g.list.sort((x, y) =>
            isBetter(x.e, y.e) ? -1 : isBetter(y.e, x.e) ? 1 : y.c.days - x.c.days));
        const effectHtml = Object.values(byEffect)
            .sort((a, b) => b.list.length - a.list.length || a.stat.localeCompare(b.stat))
            .map(g => {
                const top = g.list[0];
                const total = g.list.reduce((n, x) => n + (x.c.days || 0), 0);
                return `<details class="sa-dd"><summary title="${escapeHtml(g.stat)}: ${g.list.length} cards, ${total} days in total">
                    <span class="sa-dd-name">${escapeHtml(g.stat)} <span style="color:var(--dim)">(${g.list.length} · ${total}d)</span></span>
                    <span class="sa-dd-val">${signed(top.e.value, g.unit)}</span>
                    <span class="sa-dd-days" title="${daysTip(top.c.days)}">${top.c.days}d</span></summary>
                    <div class="sa-dd-body">${g.list.map(({ e, c }) => `<div class="sa-dd-row">
                        <span class="sa-dd-name">${escapeHtml(cardTag(c))}</span>
                        <span class="sa-dd-val">${signed(e.value, e.unit)}</span>
                        <span class="sa-dd-days" title="${daysTip(c.days)}">${c.days}d</span></div>`).join('')}</div>
                </details>`;
            }).join('');

        const groups = {};
        data.cards.forEach(c => (groups[c.type] = groups[c.type] || []).push(c));
        const typeHtml = Object.entries(groups).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .map(([type, list]) => {
                const sorted = list.slice().sort((a, b) => b.days - a.days);
                const total = list.reduce((n, c) => n + (c.days || 0), 0);
                return `<details class="sa-dd"><summary>
                    <span class="sa-dd-name">${escapeHtml(type)} <span style="color:var(--dim)">×${list.length}</span></span>
                    <span class="sa-dd-days" title="All ${list.length} cards together last ${total} days">${total}d</span></summary>
                    <div class="sa-dd-body">${sorted.map(c => `<div class="sa-dd-row">
                        <span class="sa-dd-name">${c.level != null ? `<span style="color:var(--muted)">Lv ${c.level} · </span>` : ''}${
                            c.effects.map(e => escapeHtml(e.raw)).join(' · ') || '<span style="color:var(--dim)">no effects read</span>'}</span>
                        <span class="sa-dd-days" title="${daysTip(c.days)}">${c.days}d</span></div>`).join('')}</div>
                </details>`;
            }).join('');

        view.innerHTML = `
            <div class="sa-slot-meta" style="margin-bottom:6px">${data.cards.length} cards · ${Object.keys(groups).length} types ·
                saved ${new Date(data.savedAt).toLocaleString()}<br>
                Only one card can be active. Days = how long a card lasts once used.</div>
            <div class="sa-label">Best card by effect</div>
            <div class="sa-dd-head"><span style="flex:1">Effect (cards · total days)</span><span>Best</span><span style="width:34px; text-align:right">Days</span></div>
            ${effectHtml}
            <div class="sa-label" style="margin-top:10px">Cards by type</div>
            <div class="sa-dd-head"><span style="flex:1">Type (count)</span><span style="width:40px; text-align:right">Total</span></div>
            ${typeHtml}`;
    }
    renderCards();

    // ---------- Settings: theme picker ----------
    function renderSettings() {
        const list = document.getElementById('sa-theme-list');
        if (!list) return;
        const cur = GM_getValue('sa-theme', 'navy');
        const all = Object.entries(THEMES).concat([['custom', customTheme()]]);
        list.innerHTML = all.map(([key, t]) => {
            const v = t.vars;
            const dots = [v.head1, v.accent, v.num, v.muted].map(c =>
                `<span style="display:inline-block; width:10px; height:10px; border-radius:50%;
                    background:${c}; border:1px solid ${v.border}; margin-right:2px"></span>`).join('');
            return `<button class="sa-btn ${key === cur ? 'active' : ''}" data-theme="${key}"
                        style="margin:0; text-align:left; padding:6px 8px; background:${v.surface2};
                               color:${v.text}; border-color:${key === cur ? v.accent : v.border}">
                        <div style="margin-bottom:4px">${escapeHtml(t.label)}</div>${dots}</button>`;
        }).join('');
        list.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
            GM_setValue('sa-theme', b.dataset.theme);
            applyTheme(b.dataset.theme);
            renderSettings();
        }));
        renderCustomColors();
    }

    function renderCustomColors() {
        const box = document.getElementById('sa-custom-colors');
        if (!box) return;
        const ct = customTheme();
        box.innerHTML = `
            <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; font-size:11px">
                <span style="color:var(--muted)">Start from</span>
                <select class="sa-select" id="sa-custom-base" style="width:auto">${Object.entries(THEMES).map(([k, t]) =>
                    `<option value="${k}" ${k === ct.base ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}</select>
                <button class="sa-btn" id="sa-custom-reset" style="margin:0 0 0 auto">Reset</button>
            </div>
            <div class="sa-colors">${CUSTOM_KEYS.map(([k, label]) => `
                <span>${label}${ct.colors[k] ? '' : ' <span style="color:var(--dim)">(preset)</span>'}</span>
                <input type="color" data-color="${k}" value="${toHex(ct.vars[k])}" />`).join('')}</div>
            <div style="font-size:10px; color:var(--muted); margin-top:6px">Changing any color switches to the Custom scheme.</div>`;
        const save = (fn) => {
            const c = GM_getValue('sa-theme-custom', null) || { base: 'navy', colors: {} };
            fn(c);
            GM_setValue('sa-theme-custom', c);
            GM_setValue('sa-theme', 'custom');
            applyTheme('custom');
        };
        box.querySelectorAll('[data-color]').forEach(inp => {
            inp.addEventListener('input', () => save(c => { c.colors = c.colors || {}; c.colors[inp.dataset.color] = inp.value; }));
            inp.addEventListener('change', () => renderSettings());   // refresh tiles once picking is done
        });
        box.querySelector('#sa-custom-base').addEventListener('change', (e) => {
            save(c => { c.base = e.target.value; });
            renderSettings();
        });
        box.querySelector('#sa-custom-reset').addEventListener('click', () => {
            save(c => { c.colors = {}; });
            renderSettings();
        });
    }
    renderSettings();

    // ---------- Settings: planets ----------
    function renderPlanetList() {
        const el = document.getElementById('sa-planet-list');
        if (!el) return;
        const ids = planetIds();
        if (!ids.length) {
            el.innerHTML = `<div class="sa-empty">No planets yet. Click Scan on any game page.</div>`;
            return;
        }
        el.innerHTML = ids.map(id => `
            <div style="display:flex; gap:4px; align-items:center; margin-bottom:4px">
                <span style="color:var(--dim); font-size:10px; width:12px">${id}</span>
                <input class="sa-slot-name" data-planet="${id}" value="${escapeHtml(shortName(id))}" style="flex:1" />
                <button class="sa-btn sa-btn-danger" data-remove="${id}" style="margin:0">Remove</button>
            </div>`).join('') +
            `<div class="sa-slot-meta">${ids.length} of ${SLOT_IDS.length} planet slots used</div>`;
        el.querySelectorAll('[data-planet]').forEach(inp => inp.addEventListener('change', () => {
            nameSlot(inp.dataset.planet, inp.value.trim() || `Planet ${inp.dataset.planet}`);
            refreshPlanetLists();
        }));
        el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
            const id = b.dataset.remove;
            if (!confirm(`Remove ${shortName(id)} and all of its saved data?`)) return;
            removePlanet(id);
            refreshPlanetLists();
        }));
    }
    // Re-draw everything that lists planets
    function refreshPlanetLists() {
        renderSlots(); renderFacilitiesSlots(); renderInventory(); renderNation();
        renderTurnGen(); renderTurns(); renderPlanetList(); renderResGen(); renderArea(); showDetected();
    }
    renderPlanetList();

    // ---------- Settings: reset all saved data ----------
    // Keeps preferences (theme, collapsed state, open tab).
    const KEEP_KEYS = ['sa-theme', 'sa-collapsed', 'sa-active-tab', 'sa-tip-facilities-oldview',
                       'sa-last-sub-general', 'sa-last-sub-data', 'sa-last-sub-calculators', 'sa-tutorial-done', 'sa-tutorial-v2-done',
                       'sa-autoscan', 'sa-theme-custom', 'sa-cg-assume', 'sa-bd'];
    function resetAllData() {
        let keys = [];
        if (typeof GM_listValues === 'function') {
            keys = GM_listValues();
        } else {
            // Fallback: every key this script writes
            SLOT_IDS.forEach(id => keys.push(
                'sa-unit-slot-' + id, 'sa-research-slot-' + id, 'sa-facilities-slot-' + id,
                'sa-inv-' + id, 'sa-turngen-' + id, 'sa-turns-' + id,
                'sa-slot-collapsed-' + id, 'sa-rslot-collapsed-' + id, 'sa-fslot-collapsed-' + id,
                'sa-nation-' + id, 'sa-colony-' + id));
            keys.push('sa-market-latest', 'sa-bank', 'sa-galaxy-fee', 'sa-central-bank',
                      'sa-turngen-active', 'sa-turns-active', 'sa-cards');
        }
        const toDelete = keys.filter(k => k.startsWith('sa-') && !KEEP_KEYS.includes(k));
        toDelete.forEach(k => {
            if (typeof GM_deleteValue === 'function') GM_deleteValue(k);
            else GM_setValue(k, null);
        });
        lastScan = null;
        return toDelete.length;
    }
    document.getElementById('sa-reset-all').addEventListener('click', () => {
        if (!confirm('Erase ALL saved SharkBot data?\n\nPlanets, research, market, bank and calculator inputs will be deleted. This cannot be undone.')) return;
        const n = resetAllData();
        document.getElementById('sa-dump').textContent = '(click Scan)';
        document.getElementById('sa-recommend').textContent = '—';
        renderSlots(); renderResearchSlots(); renderFacilitiesSlots(); renderMarket();
        renderInventory(); renderBank(); renderTurnGen(); renderTurns(); renderNation(); renderCards(); renderPlanetList(); showDetected();
        document.getElementById('sa-reset-msg').textContent = `Done: ${n} saved item(s) erased.`;
        document.getElementById('sa-status').textContent = 'All saved data reset';
    });

    // Show which planet/slot is detected
    showDetected();

    // ---------- One-time tips ----------
    function showPopup(title, html, onClose) {
        const wrap = document.createElement('div');
        wrap.className = 'sa-popup';
        wrap.innerHTML = `<div class="sa-popup-box" role="dialog" aria-label="${escapeHtml(title)}">
            <div class="sa-popup-head">🦈 ${escapeHtml(title)}</div>
            <div class="sa-popup-body">${html}</div>
            <div class="sa-popup-foot"><button class="sa-btn active">Got it</button></div></div>`;
        const close = () => { wrap.remove(); if (onClose) onClose(); };
        wrap.querySelector('button').addEventListener('click', close);
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        panel.appendChild(wrap);
    }
    function maybeShowTips() {
        if (tutorialActive()) return;
        if (pageKey === 'facilities' && !GM_getValue('sa-tip-facilities-oldview', false)) {
            GM_setValue('sa-tip-facilities-oldview', true);   // only ever shown once
            showPopup('Facilities: use the old view',
                `The helper reads the <b>old view</b> of the Facilities page.<br><br>
                 At the top of the page, pick <b>Resources</b>, <b>Military</b> or <b>Areas</b>
                 (not <b>New view</b>), then click <b>Scan</b>.<br><br>
                 Scan each view you want saved. Saving one view keeps the others.`);
        }
    }
    // ---------- Interactive tutorial ----------
    // tab: subtab to open; target: element to highlight; tryIt: clicking the
    // target also moves on to the next step.
    // Live checklist of what's been saved for the open planet (and shared data)
    function tutChecklist() {
        const d = detectPlanet();
        const id = d.slot && !d.assign ? d.slot : null;
        const items = [
            ['Nation',      id && GM_getValue('sa-nation-' + id, null)],
            ['Train Units', id && (getSlot(id)?.units || []).length],
            ['Facilities',  id && (getFSlot(id)?.items || []).length],
            ['Research',    (getRSlot('A')?.items || []).length],
            ['Bank (Central bank tab)', bankLoad()],
            ['Market',      getMarket()],
            ['Cards (Hero card collection)', GM_getValue('sa-cards', null)],
        ];
        const done = items.filter(x => x[1]).length;
        return `<div style="margin:6px 0 2px">${items.map(([n, ok]) =>
            `<div>${ok ? '<span style="color:var(--pos)">✓</span>' : '<span style="color:var(--dim)">○</span>'} ${n}</div>`).join('')}</div>
            <div style="color:var(--muted); font-size:11px">${done} of ${items.length} saved${
                id ? ` for <b>${escapeHtml(shortName(id))}</b>` : ''}. This list updates as you browse.</div>`;
    }

    // Steps. tab: subtab to open; target: element to highlight (default: the subtab);
    // tryIt: clicking the target moves on; waitScan: an auto-scan moves on;
    // live: re-drawn after every scan. text can be a function for live content.
    const TUTORIAL = [
        { target: '.sa-header', title: 'Welcome to SharkBot',
          text: `SharkBot saves your planets' data while you play and does the math for you.<br><br>
                 This short tour shows how it works. Use <b>Next</b> and <b>Back</b>, or skip anytime.` },
        { tab: 'debug', target: '#sa-status', title: "It's already working", live: true,
          text: () => `SharkBot <b>scans automatically</b>: every time a game page opens, it reads the page and saves what's on it for the planet you're on.<br><br>
                 Right now:<br><span style="font-family:monospace; font-size:11px">${
                    escapeHtml(document.getElementById('sa-status').textContent)}<br>${
                    escapeHtml(document.getElementById('sa-planet').textContent)}</span>` },
        { tab: 'debug', target: '#sa-status', title: 'Try it', waitScan: true, live: true,
          text: () => `Click any link in the game's menu, for example <b>Nation</b>.<br><br>
                 This step moves on by itself once SharkBot has saved the new page.<br><br>
                 <span style="font-family:monospace; font-size:11px">${escapeHtml(document.getElementById('sa-status').textContent)}</span>`,
          tip: 'Waiting for you to open a game page…' },
        { target: '#sa-scan', title: 'Scan by hand', tryIt: true,
          text: `<b>Scan</b> rereads the current page. You only need it when something changes without the page itself changing,
                 like switching <b>Facilities</b> views or opening the <b>Central bank</b> tab.`,
          tip: 'Try it: click Scan.' },
        { target: '#sa-toggle', title: 'Move and collapse',
          text: `Drag the panel by its header to move it. <b>−</b> folds it down to this bar; <b>+</b> opens it again.` },
        { target: '.sa-maintabs', title: 'Three main tabs',
          text: `<b>General</b>: status and settings.<br><b>Data</b>: everything SharkBot has saved.<br><b>Calculators</b>: tools that use that data.<br><br>
                 Each one remembers the subtab you last opened.` },
        { tab: 'units', target: '.sa-tabs', title: 'Data',
          text: `Top row, <b>Empire</b>: Research, Market, Bank and Cards are shared by all your planets.<br>
                 Bottom row, <b>Planet</b>: Units, Facilities, Inventory and Nation are saved for each planet. Units and Facilities can <b>compare</b> two planets.<br><br>
                 Each fills in on its own when you visit that game page. Three need a little help, shown next.` },
        { tab: 'facilities', title: 'Facilities: use the old view',
          text: `On the Facilities page pick <b>Resources</b>, <b>Military</b> or <b>Areas</b>, not <b>New view</b>.<br><br>
                 Switching views may not count as a new page, so click <b>Scan</b> after each switch. Saving one view keeps the others.` },
        { tab: 'bank', title: 'Bank: open Central bank',
          text: `On the Bank page, open the <b>Central bank</b> tab, then click <b>Scan</b>. That saves your bank balance and the <b>galaxy fee</b> that Credit Gen needs.` },
        { tab: 'cards', title: 'Cards: your collection',
          text: `Open <b>Cards → All Hero cards</b>. SharkBot lists the best card for each effect and every card by type; open a row for details.<br><br>
                 Only one card can be active at a time, and a card's days are how long it lasts once used.` },
        { tab: 'creditgen', title: 'Calculators → Credit Gen',
          text: `Your <b>passive</b> credits per tick and what you earn by <b>spending a turn</b>, from your workers, Income Facility, Economy research, productivity and galaxy fee. Work mode only affects passive income.<br><br>
                 Inputs fill in from saved data. Anything you type yourself stays (marked ○).` },
        { tab: 'turns', title: 'Calculators → Turn Gen',
          text: `What a <b>Tick Generator</b> upgrade costs, by target level or target turns per minute, compared with what your planets and bank hold and converted to credits at market prices.` },
        { tab: 'area', title: 'Calculators → Area Size',
          text: `What it costs to grow an <b>Area</b> (Industrial, Commercial, Farms…), by target level or target area size, and how much bigger it gets.
                 Starting level and the matching research fill in from your Facilities → Areas scan.` },
        { tab: 'resgen', title: 'Calculators → Resource Gen',
          text: `Coal, iron and gold made per turn and per day, and what they're worth in credits at market prices.<br><br>
                 Fill the <b>Compare</b> column to see what an upgrade (research, productivity, mines, a card) would change.` },
        { tab: 'optimizer', title: 'Calculators → Best Spend',
          text: `Splits <b>all your capital</b> (credits, bank and resources you could sell) between Area upgrades and Tick Generators on every planet, wherever it adds the most <b>credits per day</b>.<br><br>
                 Every calculator also ends with what all your capital could buy there. The bar at the top of each calculator sets how much of your capital to use (slider in 5% steps, or 25/50/75/100%) and whether <b>Brains</b>, <b>Diamonds</b> and <b>SSB</b> count.` },
        { tab: 'settings', title: 'General → Settings',
          text: `Rename or remove <b>planets</b>, turn <b>auto-scan</b> off, pick a <b>color scheme</b>, replay this tour, or <b>reset all saved data</b>.` },
        { tab: 'debug', target: '.sa-header', title: 'Your checklist', live: true,
          text: () => `Visit these pages on each planet and SharkBot does the rest:${tutChecklist()}` },
    ];
    let tutStep = -1, tutEl = null, tutHl = null, tutTimer = null, tutConfirm = false;

    function tutorialActive() { return tutStep >= 0; }

    function tutTarget(step) {
        if (step.target) return panel.querySelector(step.target);
        return panel.querySelector(`.sa-tab[data-tab="${step.tab}"]`);
    }

    function placeTutorial() {
        if (!tutEl) return;
        const pr = panel.getBoundingClientRect();
        const t = tutHl ? tutHl.getBoundingClientRect() : pr;
        const w = 290, gap = 12;
        let left = pr.left - w - gap;
        if (left < 8) left = Math.min(pr.right + gap, window.innerWidth - w - 8);
        const h = tutEl.offsetHeight;
        const top = Math.max(8, Math.min(t.top - 10, window.innerHeight - h - 8));
        tutEl.style.left = left + 'px';
        tutEl.style.top = top + 'px';
    }

    function renderTutorial() {
        const step = TUTORIAL[tutStep];
        if (tutHl) tutHl.classList.remove('sa-tut-hl');
        if (step.tab) switchTab(step.tab);
        tutHl = tutTarget(step);
        if (tutHl) tutHl.classList.add('sa-tut-hl');
        const last = tutStep === TUTORIAL.length - 1;
        const pct = Math.round((tutStep + 1) / TUTORIAL.length * 100);
        tutEl.innerHTML = `
            <div class="sa-tut-head"><span>${step.title}</span>
                <span class="sa-tut-step">${tutStep + 1} / ${TUTORIAL.length}</span></div>
            <div class="sa-tut-bar"><div style="width:${pct}%"></div></div>
            ${tutConfirm ? `
            <div class="sa-tut-body">Skip the tutorial?<br><br>
                You can restart it anytime from <b>General → Settings</b>.</div>
            <div class="sa-tut-foot"><span style="flex:1"></span>
                <button class="sa-btn" data-t="keep">Keep going</button>
                <button class="sa-btn sa-btn-danger" data-t="skip-yes">Skip</button></div>` : `
            <div class="sa-tut-body">${typeof step.text === 'function' ? step.text() : step.text}${
                step.tip ? `<div class="sa-tut-try">${step.tip}</div>` : ''}</div>
            <div class="sa-tut-foot">
                ${last ? '' : '<button class="sa-btn" data-t="skip" style="background:transparent; border-color:transparent; color:var(--muted)">Skip tutorial</button>'}
                <span style="flex:1"></span>
                ${tutStep > 0 ? '<button class="sa-btn" data-t="back">Back</button>' : ''}
                <button class="sa-btn active" data-t="next">${last ? 'Finish' : 'Next'}</button></div>`}`;
        tutEl.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = b.dataset.t;
            if (a === 'next') { if (last) endTutorial(); else { tutStep++; renderTutorial(); } }
            else if (a === 'back') { tutStep--; renderTutorial(); }
            else if (a === 'skip') { tutConfirm = true; renderTutorial(); }
            else if (a === 'keep') { tutConfirm = false; renderTutorial(); }
            else if (a === 'skip-yes') endTutorial();
        }));
        placeTutorial();
    }

    function startTutorial() {
        endTutorial(true);
        if (panel.classList.contains('collapsed')) document.getElementById('sa-toggle').click();
        tutStep = 0; tutConfirm = false;
        tutEl = document.createElement('div');
        tutEl.className = 'sa-tut';
        tutEl.setAttribute('role', 'dialog');
        panel.appendChild(tutEl);
        renderTutorial();
        tutTimer = setInterval(placeTutorial, 300);   // follow the panel if it's dragged
        window.addEventListener('resize', placeTutorial);
    }

    function endTutorial(silent) {
        if (tutHl) tutHl.classList.remove('sa-tut-hl');
        if (tutEl) tutEl.remove();
        if (tutTimer) clearInterval(tutTimer);
        window.removeEventListener('resize', placeTutorial);
        tutEl = tutHl = tutTimer = null;
        const wasActive = tutStep >= 0;
        tutStep = -1; tutConfirm = false;
        if (!silent && wasActive) {
            GM_setValue('sa-tutorial-v2-done', true);
            switchTab('debug');
            maybeShowTips();
        }
    }

    // Scans move "waitScan" steps on and refresh "live" steps
    function tutorialOnScan(wasAuto) {
        if (!tutorialActive() || tutConfirm) return;
        const step = TUTORIAL[tutStep];
        if (step.waitScan && wasAuto) { tutStep++; renderTutorial(); }
        else if (step.live) renderTutorial();
    }

    // "Try it" steps: clicking the highlighted control moves the tour on
    panel.addEventListener('click', (e) => {
        if (!tutorialActive() || tutConfirm) return;
        const step = TUTORIAL[tutStep];
        if (step.tryIt && tutHl && tutHl.contains(e.target)) {
            setTimeout(() => { if (tutorialActive()) { tutStep++; renderTutorial(); } }, 400);
        }
    });

    document.getElementById('sa-tut-restart').addEventListener('click', () => startTutorial());
    if (!GM_getValue('sa-tutorial-v2-done', false)) startTutorial();

    maybeShowTips();

    // ---------- Auto-scan ----------
    // Wait until the game has finished drawing the new page: no elements added
    // or removed for a moment (text-only updates like the tick timer are ignored).
    function waitForQuiet(quietMs = 700, maxMs = 4000) {
        return new Promise(resolve => {
            let t = null;
            const done = () => { obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); };
            const obs = new MutationObserver(muts => {
                if (muts.every(m => panel.contains(m.target))) return;
                clearTimeout(t); t = setTimeout(done, quietMs);
            });
            obs.observe(document.body, { childList: true, subtree: true });
            t = setTimeout(done, quietMs);
            const cap = setTimeout(done, maxMs);
        });
    }
    let autoBusy = false, autoAgain = false;
    async function autoScan() {
        if (!GM_getValue('sa-autoscan', true)) return;
        if (autoBusy) { autoAgain = true; return; }
        autoBusy = true;
        try {
            await waitForQuiet();
            refreshPage();
            await saveAll(null, true, true);
            tutorialOnScan(true);
        } finally {
            autoBusy = false;
            if (autoAgain) { autoAgain = false; autoScan(); }
        }
    }
    const autoBox = document.getElementById('sa-autoscan');
    autoBox.checked = GM_getValue('sa-autoscan', true);
    autoBox.addEventListener('change', () => GM_setValue('sa-autoscan', autoBox.checked));

    // Follow in-game navigation (no page reload): update the header and auto-scan.
    // The query string counts too (e.g. my-collection?tab=Collection).
    const navKey = () => location.pathname + location.search;
    let lastNav = navKey();
    setInterval(() => {
        if (navKey() === lastNav) return;
        lastNav = navKey();
        refreshPage();
        showDetected();
        maybeShowTips();
        autoScan();
    }, 500);
    // Every calculator is set up: turn on the capital plans
    sbReady = true;
    refreshCalcs();
    autoScan();   // and once when the game first loads
    startColonyWatch();

    console.log(`[SharkBot] v${VERSION} loaded on page: ${pageKey || '(unknown)'}`);
})();