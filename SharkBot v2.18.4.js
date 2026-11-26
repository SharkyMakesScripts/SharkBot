// ==UserScript==
// @name         SharkBot
// @namespace    https://spacealpha.net/
// @version      2.18.4
// @description  SharkBot for Space Alpha: saves your planets' units, facilities, inventory, research, bank and market prices, and calculates credit generation and Tick Generator upgrade costs.
// @author       SharkBot
// @match        https://spacealpha.net/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'sa-helper-panel';
    const SLOT_IDS = 'ABCDEFGHIJ'.split('');   // up to 10 planets
    // Version comes from the @version header so it's never out of sync
    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.18.4';
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
            // Your own bank and the Central bank are two tabs on /bank: only read the one that's open
            const view = bankView();
            let bal = null, fee = null, cb = null, pb = null, traps = null;
            if (view === 'traps') {
                traps = readTraps();
                if (traps.items.length) storeTraps(traps);
                bal = readBankBalance();   // the balance panel beside the list
                if (bal && bal.value != null) storeBank(bal);
            } else if (view === 'central') {
                fee = readGalaxyFee();
                if (fee && fee.value != null) storeGalaxyFee(fee);
                cb = readCentralBank();
                if (cb && cb.fields.length) storeCentralBank(cb);
            } else {
                bal = readBankBalance();
                if (bal && bal.value != null) storeBank(bal);
                pb = readCentralBank();   // same "label: value" reader, for your own bank's lines
                if (pb && pb.fields.length) GM_setValue('sa-player-bank', { savedAt: new Date().toISOString(), fields: pb.fields });
            }
            return Object.assign(scanGeneric(), { bankView: view, bank: bal, playerBank: pb, galaxyFee: fee, centralBank: cb, traps });
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
        #${PANEL_ID} .sa-tab-label.sa-tier { font-size: 11px; font-family: Georgia, serif; letter-spacing: 1px; color: var(--accent); }
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
        #${PANEL_ID} table.sa-stmt td { padding: 3px 6px; }
        #${PANEL_ID} table.sa-bs tr.sa-bs-dbl td.sa-num { border-bottom: 3px double var(--text); }
        #${PANEL_ID} table.sa-bs td.sa-num, #${PANEL_ID} table.sa-bs th { white-space: nowrap; }
        #${PANEL_ID} table.sa-stmt tr.sa-stmt-head td { color: var(--accent); font-weight: 600; padding-top: 8px; }
        #${PANEL_ID} table.sa-stmt tr.sa-stmt-sub td { border-top: 1px solid var(--line); color: var(--muted); }
        #${PANEL_ID} table.sa-stmt tr.sa-stmt-total td { font-weight: 700; border-top: 1px solid var(--border); }
        #${PANEL_ID} table.sa-traps-table { font-size: 10px; width: max-content; min-width: 100%; table-layout: auto; }
        #${PANEL_ID} table.sa-traps-table th { text-align: right; }
        #${PANEL_ID} table.sa-traps-table th:nth-child(2) { text-align: left; }
        #${PANEL_ID} table.sa-traps-table th:first-child { text-align: left; }
        #${PANEL_ID} table.sa-traps-table th, #${PANEL_ID} table.sa-traps-table td { padding: 3px 4px; white-space: nowrap; }
        #${PANEL_ID} table.sa-traps-table td.sa-trap-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
        #${PANEL_ID} .sa-form {
            display: grid; grid-template-columns: 1fr 130px 14px; gap: 4px 6px;
            align-items: center; font-size: 11px;
        }
        #${PANEL_ID} .sa-form label { color: var(--soft); }
        #${PANEL_ID} .sa-form input, #${PANEL_ID} input.sa-amt, #${PANEL_ID} input#sa-invest-tpd, #${PANEL_ID} input.sa-inv-amt, #${PANEL_ID} #sa-admin-view input, #${PANEL_ID} .sa-form select, #${PANEL_ID} select.sa-select {
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
            <div class="sa-mtab" data-group="statements">Statements</div>
            <div class="sa-mtab" data-group="admin">Admin</div>
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
            <div class="sa-tab-label sa-tier" data-group="calculators" title="Tier I: one formula">I</div>
            <div class="sa-tab" data-tab="storage">Turn Storage</div>
            <div class="sa-tab" data-tab="area">Area Size</div>
            <div class="sa-tab" data-tab="turns">Turn Gen</div>
            <div class="sa-tab-break" data-group="calculators"></div>
            <div class="sa-tab-label sa-tier" data-group="calculators" title="Tier I: one formula">I</div>
            <div class="sa-tab" data-tab="training">Training</div>
            <div class="sa-tab" data-tab="rescalc">Research</div>
            <div class="sa-tab" data-tab="energy">Energy</div>
            <div class="sa-tab" data-tab="productivity">Productivity</div>
            <div class="sa-tab-break" data-group="calculators"></div>
            <div class="sa-tab-label sa-tier" data-group="calculators" title="Tier II: income models built from many saved values">II</div>
            <div class="sa-tab" data-tab="creditgen">Credit Gen</div>
            <div class="sa-tab" data-tab="resgen">Resource Gen</div>
            <div class="sa-tab" data-tab="unitvalue" title="Untrained &amp; Professors">Unit Value</div>
            <div class="sa-tab-break" data-group="calculators"></div>
            <div class="sa-tab-label sa-tier" data-group="calculators" title="Tier III: optimizers that combine the other calculators">III</div>
            <div class="sa-tab" data-tab="optimizer">Best Spend</div>
            <div class="sa-tab" data-tab="valueopt">Value Optimizer</div>
            <div class="sa-tab" data-tab="stbalance">Balance</div>
            <div class="sa-tab" data-tab="stincome">Income</div>
            <div class="sa-tab" data-tab="stcash">Cash Flow</div>
            <div class="sa-tab" data-tab="stholder">Stockholder</div>
            <div class="sa-tab" data-tab="admin">Shared data</div>
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
                        On the Research page, hit Scan then Save. Each scan adds or updates the research it sees and keeps the rest, so scan every group of research once.
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
                    <div id="sa-cg-pcbox" style="margin-bottom:6px"></div>
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
            <div class="sa-pane" data-pane="rescalc">
                <div class="sa-section">
                    <div class="sa-label">Research: next level</div>
                    <div style="font-size:10px; color:var(--muted)">What the next level of every research costs (credits, iron, gold, tritium, energy)
                        and how many turns it takes, from your scientists, Computer Technology, brain boost (read from the Research page) and best cards.</div>
                </div>
                <div class="sa-section"><div class="sa-label">Planet (scientists)</div><select class="sa-select" id="sa-rc-slot"></select>
                    <div id="sa-rc-toggles" style="display:flex; flex-direction:column; gap:4px; margin-top:8px"></div></div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-rc-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="unitvalue">
                <div class="sa-section">
                    <div class="sa-label">Untrained &amp; professors</div>
                    <div style="font-size:10px; color:var(--muted)">What your untrained growth is worth at market price, and the value of one turn
                        spent training professors and selling them, compared with your Value Optimizer turn.</div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Planet</div><select class="sa-select" id="sa-uv-slot"></select>
                    <div class="sa-form" style="margin-top:6px">
                        <label>Your slave price (optional)</label><input id="sa-uv-price" placeholder="blank = market only" /><span></span>
                        <label>Your professor price (optional)</label><input id="sa-uv-pprice" placeholder="blank = market only" /><span></span>
                        <label>Slave split: % of profit you keep</label><input id="sa-uv-split" placeholder="80 (20% Gastro tax)" /><span></span>
                        <label>Slaves sold per day max</label><input id="sa-uv-limS" placeholder="blank = no limit" /><span></span>
                        <label>Professors sold per day max</label><input id="sa-uv-limP" placeholder="blank = no limit" /><span></span>
                    </div>
                </div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-uv-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="productivity">
                <div class="sa-section">
                    <div class="sa-label">Productivity: sickness per tick</div>
                    <div style="font-size:10px; color:var(--muted)">Sickness healed and added each tick, where it's heading over a day, and the level it settles at.
                        ● filled from saved data (Units, Medicine research, Nation, colony status, cards), ○ typed.</div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Planet</div><select class="sa-select" id="sa-pr-slot"></select>
                    <div class="sa-form" id="sa-pr-form" style="margin-top:6px"></div>
                </div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-pr-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="energy">
                <div class="sa-section">
                    <div class="sa-label">Energy storage</div>
                    <div style="font-size:10px; color:var(--muted)">Most energy a planet can store, from its power facilities, SSB, Solar power and
                        Energy Technology research, and your best energy card. ● filled from saved data, ○ typed (clear a box to go back).</div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Planet</div><select class="sa-select" id="sa-en-slot"></select>
                    <div class="sa-form" id="sa-en-form" style="margin-top:6px"></div>
                </div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-en-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="storage">
                <div class="sa-section">
                    <div class="sa-label">Turn storage</div>
                    <div style="font-size:10px; color:var(--muted)">Most turns you can hold = Turn Storage level × 10 + Brains × 100 + 200.
                        ● filled from saved data, ○ typed (clear a box to go back).</div>
                </div>
                <div class="sa-section">
                    <select class="sa-select" id="sa-ts-slot" style="display:none"></select>
                    <div style="font-size:10px; color:var(--muted)">Turns and Turn Storage are shared by all planets (read from whichever planet has the facility).</div>
                    <div class="sa-form" id="sa-ts-form" style="margin-top:6px"></div>
                </div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-ts-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="training">
                <div class="sa-section">
                    <div class="sa-label">Training</div>
                    <div style="font-size:10px; color:var(--muted)">Units trained per turn by type, and the cost of upgrading Barracks.
                        ● filled from saved data, ○ typed (clear a box to go back to saved data).</div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Planet</div><select class="sa-select" id="sa-tr-slot"></select>
                    <div class="sa-form" id="sa-tr-form" style="margin-top:6px"></div>
                </div>
                <div class="sa-section"><div class="sa-label">Result</div><div class="sa-recommend" id="sa-tr-result">—</div></div>
            </div>
            <div class="sa-pane" data-pane="valueopt">
                <div class="sa-section">
                    <div class="sa-label">Value optimizer: print credits or make resources?</div>
                    <div style="font-size:10px; color:var(--muted)">
                        Checks every planet for every method (printing credits, making resources at market value, training and selling slaves or professors) and splits your turns between them for the most credits. Turns spent on one planet can be followed by another, e.g. printing on B and resources on A.
                    </div>
                </div>
                <div class="sa-section">
                    <div class="sa-form"><label>Turns to spend per day</label>
                        <input id="sa-vo-turns" placeholder="blank = Tick Generator turns/day" /></div>
                </div>
                <div class="sa-section">
                    <div class="sa-label">Result</div>
                    <div class="sa-recommend" id="sa-vo-result">—</div>
                </div>
            </div>
            <div class="sa-pane" data-pane="optimizer">
                <div class="sa-section">
                    <div class="sa-label">Best spend (all planets)</div>
                    <div style="font-size:10px; color:var(--muted)">
                        Splits all your capital (credits, bank, sellable resources) between Area upgrades and
                        the Tick Generator (on whichever planet has one), putting each slice where it adds the most credits per day.
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
            <div class="sa-pane" data-pane="admin">
                <div class="sa-section">
                    <div class="sa-label">Admin: shared player data</div>
                    <div style="font-size:10px; color:var(--muted); margin-bottom:6px">Data from players who ticked "Share data to Sharky". Log in with the admin user and password set in the Apps Script.</div>
                </div>
                <div id="sa-admin-view"></div>
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
                    <div class="sa-label">Share data to Sharky</div>
                    <div id="sa-share-box"></div>
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
            <div class="sa-pane" data-pane="stbalance">
                <div class="sa-section">
                    <div class="sa-label">Balance sheet</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">What your empire holds right now: credits, bank, resources at market price, TRAPs and other currencies.</div>
                </div>
                <div id="sa-stbalance-view"></div>
            </div>
            <div class="sa-pane" data-pane="stincome">
                <div class="sa-section">
                    <div class="sa-label">Income statement</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">Estimated income per day and week from Credit Gen, Resource Gen and your TRAPs' interest.</div>
                </div>
                <div id="sa-stincome-view"></div>
            </div>
            <div class="sa-pane" data-pane="stcash">
                <div class="sa-section">
                    <div class="sa-label">Cash flow statement</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">Expected cash coming in, versus what actually changed between snapshots.</div>
                </div>
                <div id="sa-stcash-view"></div>
            </div>
            <div class="sa-pane" data-pane="stholder">
                <div class="sa-section">
                    <div class="sa-label">Statement of stockholders' equity</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">How your total equity has changed over time. A snapshot is taken at most once an hour as you play.</div>
                </div>
                <div id="sa-stholder-view"></div>
            </div>
            <div class="sa-pane" data-pane="bank">
                <div class="sa-section">
                    <div class="sa-label">Bank (all planets)</div>
                    <div style="font-size: 10px; color: var(--muted); margin-bottom: 6px;">
                        Go to /bank and Scan your own bank tab (your balance), the TRAPs tab (your investments) and the Central bank tab (galaxy fee). Each tab is saved separately.
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
    // Main tabs; every subtab belongs to one of them
    const TAB_GROUPS = {
        general:     ['debug', 'settings'],
        data:        ['research', 'market', 'bank', 'cards', 'units', 'facilities', 'inventory', 'nation'],
        calculators: ['storage', 'area', 'turns', 'training', 'rescalc', 'energy', 'productivity', 'creditgen', 'resgen', 'unitvalue', 'optimizer', 'valueopt'],
        statements:  ['stbalance', 'stincome', 'stcash', 'stholder'],
        admin:       ['admin'],
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
        if (name === "valueopt" && typeof sbReady !== "undefined" && sbReady) { try { renderValueOpt(); } catch (e) {} }
        if (group === 'statements' && typeof STMT_TABS !== 'undefined' && STMT_TABS) { try { renderStatements(); } catch (e) {} }
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
    // "level 150  BARRACKS  upgrade" box on the Train Units page
    function readBarracksLevel() {
        const t = pageText();
        const m = t.match(/level\s*([\d,]+)\s*barracks/i) || t.match(/barracks[^\d]{0,30}?level\s*([\d,]+)/i);
        return m ? parseNumber(m[1]) : null;
    }
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
            barracks: readBarracksLevel(),
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
        // The page has several groups (Civilian technology, Military, …), each its own
        // block, and they can share an id, so read the tables in every one of them.
        const groups = Array.from(document.querySelectorAll('research, [id="workers_div"], #research_div, #research, #tech_div, #techs_div'))
            .filter(el => !el.closest('#' + PANEL_ID));
        if (!groups.length) groups.push(document.querySelector('main') || document.body);
        const tables = [];
        groups.forEach(g => g.querySelectorAll('table').forEach(t => {
            if (!tables.includes(t) && !t.closest('#' + PANEL_ID)) tables.push(t);
        }));
        const container = groups[0];
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
        base.brainBoost = readBrainBoost();
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
        qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27,   // short forms ("3.67 Sx")
    };
    function parseNumber(s) {
        if (s == null) return null;
        let str = String(s).replace(/[,$€£%]/g, '').replace(/\s+/g, ' ').trim();
        if (!str) return null;
        if (/^\?+$/.test(str)) return null; // "???" means unknown
        // Word suffix: "22 Quintillion", "1 Octillion"
        const wm = str.match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z]{2,})$/);
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
                const tr = lastScan.traps;
                rec.textContent = lastScan.bankView === 'traps' ? [
                    'TRAPs tab',
                    tr && tr.items.length ? `Saved ${tr.items.length} TRAPs, ${tr.items.filter(t => t.invested > 0).length} you're invested in (total ${fmt(trapsTotal(tr.items))}).`
                        : (tr && tr.error) || 'No TRAPs read.',
                    ...trapsSorted(tr ? tr.items : []).filter(t => t.invested > 0).slice(0, 8).map(t => `  • ${t.name}: ${fmt(t.invested)}`),
                    'Full list: Data → Bank.',
                ].join('\n') : lastScan.bankView === 'central' ? [
                    'Central bank tab',
                    `Galaxy fee (spend turns): ${g && g.value != null ? g.display : 'not found'}`,
                    ...(g && g.value != null ? ['Saved: Credit Gen "Fill from saved" will use it.'] : []),
                    'Your own bank balance is read from the other Bank tab.',
                ].join('\n') : [
                    'Your bank',
                    `Bank balance: ${b && b.value != null ? fmt(b.value) : 'not found'}`,
                    'Open the Central bank tab for the galaxy fee.',
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
        renderBank(); renderTraps();
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
            shareNow(false);   // opt-in sharing, throttled
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
        if (sc.brainBoost) GM_setValue('sa-brain-boost', sc.brainBoost);
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
        renderInventory(); renderBank(); renderTraps(); renderStatements(); renderTurnGen(); updateTurns(); renderNation(); renderCards(); renderPlanetList(); renderResGen(); renderArea(); renderBdBars(); renderOptimizer(); renderValueOpt(); renderTraining(); renderTurnStorage(); renderResearchCalc(); renderEnergy(); renderProductivity(); renderUnitValue();
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
            barracks: lastScan.trainUnits.barracks ?? existing?.barracks ?? null,
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
                            ? ` · pop ${fmt(slot.totalPopulation)}` : ''}${slot.barracks != null ? ` · Barracks lvl ${slot.barracks}` : ''}
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
        // Merge with what's saved: the Research page shows research in groups, so each scan
        // adds or updates the ones it sees and keeps the rest
        const fresh = lastScan.research.items.filter(i => !isUnitRow(i.name));
        const key = (n) => cleanName(n).toLowerCase();
        const seen = new Set(fresh.map(i => key(i.name)));
        const kept = (existing?.items || []).filter(i => !isUnitRow(i.name) && !seen.has(key(i.name)));
        const items = [...fresh, ...kept];
        setRSlot(id, {
            planetName,
            savedAt: new Date().toISOString(),
            items,
            itemCount: items.length,
        });
        renderResearchSlots();
        renderTurnGen();
        status.textContent = `Saved ${fresh.length} research items (${items.length} in total)`;
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
                        ${(() => { const have = new Set(slot.items.map(x => cleanName(x.name).toLowerCase()));
                            const miss = ['Education', 'Tactics'].filter(n => !have.has(n.toLowerCase()));
                            return miss.length ? `<br><span style="color:var(--warn, #e0b050)">Not seen yet: ${miss.join(', ')}. Open the part of the Research page that lists ${miss.length > 1 ? 'them' : 'it'} and Scan; saved research is kept, not replaced.</span>` : ''; })()}
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
        { match: /^education$/i,     per: 5, what: 'training speed (all units)' },
        { match: /^tactics$/i,       per: 5, what: 'training speed of Majors & Champions' },
        { match: /^automation$/i,    per: 2, what: 'factory production power (all colonies); ships in reward chests' },
        { match: /^supervision$/i,   render: (l) => `${2 + Math.floor(l / 2)} fleet movements per planet (2 + level/2)` },
        { match: /^astronomy$/i,     per: 5, what: 'max view distance' },
        { match: /^assassin technology$/i, per: 0.5, what: 'assassin strength' },
        { match: /^espionage technology$/i, per: 0.5, what: 'spy & defensive spy strength' },
        { match: /^defen[cs]e technology$/i, per: 0.5, what: 'defense strength' },
        { match: /^weapon technology$/i, per: 0.5, what: 'attack strength' },
        { match: /^carrier optimization$/i, per: 5, sign: '−', what: "steel for 'Carrier' blueprints (factory cost per unit)" },
        { match: /^space fighter optimization$/i, per: 5, sign: '−', what: "steel for 'Space Fighter' blueprints (factory cost per unit)" },
        { match: /^invader optimization$/i, per: 5, sign: '−', what: "steel for 'Invader' blueprints (factory cost per unit)" },
    ];
    function researchEffect(name, level) {
        const e = RESEARCH_EFFECTS.find(x => x.match.test(cleanName(name)) || x.match.test(String(name).trim()));
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

    // Best Hero card that raises productivity (only one card can be active); on unless unticked
    function prodCard() {
        if (!GM_getValue('sa-cg-prodcard', true)) return null;
        return bestCardPct(st => /productiv/.test(st) && !/cost/.test(st));
    }
    function calcTurnGen(v) {
        const need = ['industrial', 'commercial', 'mineSlaves', 'incomeFac',
                      'economy', 'productivity', 'galaxyFee'];
        if (need.some(k => v[k] == null) || !v.workMode) return null;

        const mode = WORK_MODES.find(m => m[0] === v.workMode);
        const work = mode ? mode[1] : 1;
        const fac = 0.4 * Math.pow(v.incomeFac, 1.17) / 100;
        const econ = 1 + 0.02 * v.economy;
        const pc = prodCard();
        const prod = v.productivity / 100 * (1 + (pc ? pc.value / 100 : 0));
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
                ...(pc ? [`Productivity ${v.productivity}% × card +${pc.value}% = ${(prod * 100).toFixed(2)}%  (${pc.stat})`, ''] : []),
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

    // Bare name for matching: drops hotkey prefixes "(E)", levels "LVL: 19" / "(19)" / "Level 19",
    // icons and extra spaces, so "(E) Economy LVL: 19" matches /^economy$/
    function cleanName(n) {
        return String(n || '').replace(/^\s*\([A-Za-z0-9]{1,2}\)\s*/, '').replace(/\s*(LVL|level)\s*:?\s*[\d,.]+.*$/i, '')
            .replace(/\s*\([\d,.]+\)\s*$/, '').replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // A research level by name pattern (shared by every calculator)
    function researchLevel(re) {
        const r = (getRSlot('A')?.items || []).find(i => re.test(cleanName(i.name)) || re.test(String(i.name).trim()));
        if (!r) return null;
        const lv = levelFrom(r);
        return lv.value != null ? lv.value : null;
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
            const hit = src[f.from.kind].find(x => f.from.match.test(cleanName(x.name)) || f.from.match.test(x.name));
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

    function renderProdCardBox() {
        const el = document.getElementById('sa-cg-pcbox');
        if (!el) return;
        const best = bestCardPct(st => /productiv/.test(st) && !/cost/.test(st)), on = GM_getValue('sa-cg-prodcard', true);
        el.innerHTML = `<label class="sa-check"><input type="checkbox" id="sa-cg-pc" ${on && best ? 'checked' : ''} ${best ? '' : 'disabled'} />
            <span>Productivity card <span style="color:var(--muted)">${best ? `+${best.value}% · ${escapeHtml(best.stat)} (untick if the game's productivity already includes it)` : '(none saved)'}</span></span></label>`;
        el.querySelector('#sa-cg-pc').addEventListener('change', (e) => { GM_setValue('sa-cg-prodcard', e.target.checked); refreshCalcs(); renderStatements(); });
    }
    function updateTurnGenResult() {
        renderProdCardBox();
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
            : f.from === 'research' ? (getRSlot('A')?.items || []).map(i => { const lv = levelFrom(i); return { name: i.name, v: lv.value != null ? lv.value : (i.valueDisplay || i.value) }; }) : [];
        const hit = list.find(i => f.match.test(cleanName(i.name)) || f.match.test(String(i.name).trim()));
        return hit && hit.v != null ? String(hit.v) : null;
    }
    // Turns per day from this planet's Tick Generator (TPM × 1,440)
    // Turns are one empire-wide pool, made by the Tick Generator (only one planet has one).
    // A planet without its own Tick Generator uses the empire's.
    function ownTpd(slot) {
        const tg = (getFSlot(slot)?.items || []).find(i => /tick\s*generator/i.test(i.name) && i.value != null);
        return tg ? Math.round(tpm(tg.value) * 1440) : null;
    }
    function empireTpd() {
        let t = 0;
        planetIds().forEach(id => { t += ownTpd(id) || 0; });
        return t || null;
    }
    function rgAutoTpd(slot) { return empireTpd() ?? ownTpd(slot); }

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
        const capital = credits + sellValue + bd.value, st = bdSettings(), pct = st.pct;
        const amt = String(st.amount || '').trim() ? parseAmount(st.amount) : null;
        const available = amt && amt.value != null ? amt.value : capital * pct / 100;
        return { credits, bankValue: bank ? bank.value : 0, sellValue, buyCost, capital, pct, amt, available, bd, sold, unpriced, market };
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
        const m = AREA_TECH.find(([a]) => a.test(cleanName(areaName)) || a.test(String(areaName).trim()));
        if (!m) return null;
        return { name: m[2], level: researchLevel(m[1]) };
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
        const s = Object.assign({ brains: '', diamonds: '', ssb: '', pct: 100, amount: '' }, GM_getValue('sa-bd', {}) || {});
        if (!s.useKinds) s.useKinds = { brains: !!s.use, diamonds: !!s.use, ssb: false };   // from v2.4.0's single toggle
        s.pct = Math.min(100, Math.max(0, Math.round((parseNumber(s.pct) ?? 100) / 5) * 5));
        return s;
    }
    function bdSave(s) { delete s.use; GM_setValue('sa-bd', s); }

    // "15 Sx", "5b gold", "2 T iron + 15 Sx" → credits. Resources at market sell price;
    // brains / diamonds / SSB at their Best Spend value. No name = credits.
    function parseAmount(str) {
        const terms = String(str || '').split(/\s*(?:\+|,|&|\band\b)\s*/i).filter(t => t.trim());
        if (!terms.length) return null;
        const market = getMarket();
        let total = 0;
        const parts = [];
        for (const term of terms) {
            const m = term.trim().match(/^(-?[\d.,]+)\s*(.*)$/);
            if (!m) return { error: `can't read "${term.trim()}"` };
            const words = m[2].trim() ? m[2].trim().split(/\s+/) : [];
            // The longest leading run of words that still parses as a number is the suffix
            let n = null, used = 0;
            for (let k = Math.min(words.length, 2); k >= 0; k--) {
                const tryNum = parseNumber(m[1] + (k ? ' ' + words.slice(0, k).join(' ') : ''));
                if (tryNum != null && (k === 0 || /^[a-z]+$/i.test(words.slice(0, k).join('')))) {
                    if (k > 0 && parseNumber(m[1]) === tryNum) continue;   // word wasn't a suffix
                    n = tryNum; used = k; break;
                }
            }
            // "5b" or "15sx" with the suffix stuck to the number
            if (n == null) n = parseNumber(m[1]);
            if (n == null) return { error: `can't read "${term.trim()}"` };
            const name = words.slice(used).join(' ').trim();
            if (!name || /^(credits?|cr|cash|money)$/i.test(name)) { total += n; parts.push(fmt(n)); continue; }
            const bk = bdKinds().find(([, , re]) => re.test(name));
            let price = null;
            if (bk) { const u = bdUnitValue(bk[0]); price = u ? u.value : null; }
            else {
                const r = (market?.resources || []).find(x => x.name.toLowerCase().startsWith(name.toLowerCase()) ||
                    name.toLowerCase().startsWith(x.name.toLowerCase()));
                price = r ? r.sellPrice : null;
                if (!r) return { error: `no market price for "${name}" (scan /market)` };
            }
            if (price == null) return { error: `no value for "${name}"` };
            total += n * price;
            parts.push(`${fmt(n)} ${name}`);
        }
        return { value: total, text: parts.join(' + ') };
    }

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
                    ${[25, 50, 75, 100].map(p => `<button class="sa-btn ${s.pct === p && !String(s.amount).trim() ? 'active' : ''}" data-pct="${p}" style="flex:1; margin:0">${p}%</button>`).join('')}
                </div>
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; font-size:11px">
                    <input class="sa-amt" value="${escapeHtml(s.amount)}" placeholder="or a set amount: 15 Sx, 5b gold" style="flex:1" />
                    <span class="sa-amt-out" style="color:var(--muted); white-space:nowrap"></span>
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap">
                    ${bdKinds().map(([k, l]) => `<label class="sa-check"><input type="checkbox" data-use="${k}" ${s.useKinds[k] ? 'checked' : ''} />
                        <span>${l} <span style="color:var(--muted)">${c0 && c0[k] ? fmt(c0[k].value) : '?'}</span></span></label>`).join('')}
                </div>`;
            const amtIn = el.querySelector('.sa-amt'), amtOut = el.querySelector('.sa-amt-out');
            const showAmt = () => {
                const a = amtIn.value.trim() ? parseAmount(amtIn.value) : null;
                amtOut.textContent = !a ? '' : a.error ? '⚠ ' + a.error : '= ' + fmt(a.value);
                amtOut.style.color = a && a.error ? 'var(--neg, #e66)' : 'var(--muted)';
                el.querySelector('.sa-pct').parentElement.style.opacity = a && a.value != null ? '0.4' : '';   // amount overrides %
            };
            showAmt();
            amtIn.addEventListener('input', () => {
                const cur = bdSettings(); cur.amount = amtIn.value; bdSave(cur);
                showAmt(); refreshCalcs(true);
            });
            amtIn.addEventListener('change', () => refreshCalcs());
            const setPct = (p, full) => {
                const cur = bdSettings(); cur.pct = p; cur.amount = ''; bdSave(cur);
                amtIn.value = ''; showAmt();
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
        updateTurnGenResult(); updateTurns(); updateResGen(); updateArea(); renderOptimizer(); renderValueOpt(); renderTraining(); renderTurnStorage(); renderResearchCalc(); renderEnergy(); renderProductivity(); renderUnitValue();
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
        const pcm = prodCard();
        const base = (1 + 0.4 * Math.pow(v.incomeFac, 1.17) / 100) * v.productivity / 100 * (1 + (pcm ? pcm.value / 100 : 0));
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
                 gainWorkers: (dw) => val(Object.assign({}, x, { mineWorkers: x.mineWorkers + dw })) - perDay,
                 valWith: (o) => val(Object.assign({}, x, o)) };
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
        // Training the new workers costs turns: workers per turn from the Training formula
        // (Soldiers & workers row, best card), each turn valued at the Value Optimizer average
        const wpt = workersPerTurn(slot);
        let tv = null;
        try { const vp = voPlan(); if (vp && !vp.error && vp.turns > 0) tv = vp.week / 7 / vp.turns; } catch (e) {}
        if (use.area && !wpt) notes.push(`${pn}: Barracks level not saved, so training turns aren't counted`);
        if (use.area && wpt && tv == null) notes.push('Value Optimizer has no plan, so training turns are counted but not priced');
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
                // turns to train the extra workers, and what those turns are worth
                trainTurns: kind && wpt ? (E) => (size(E) - size(L0)) / wpt : () => 0,
                trainCost: kind && wpt && tv != null ? (E) => (size(E) - size(L0)) / wpt * tv : () => 0,
            });
        });
        if (use.tick) {
            const tg = (getFSlot(slot)?.items || []).find(i => /tick\s*generator/i.test(i.name) && i.value != null);
            if (!tg) { if (!empireTpd()) notes.push(`${pn}: scan Facilities for the Tick Generator level`); }
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
                const tc = s.o.trainCost ? s.o.trainCost(lo) - s.o.trainCost(s.E) : 0;   // training turns, in credits
                if (g > 0 && c > 0 && (!best || g / (c + tc) > best.r)) best = { s, E: lo, c, r: g / (c + tc) };
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
            tTurns: s.o.trainTurns ? s.o.trainTurns(s.E) : 0, tCost: s.o.trainCost ? s.o.trainCost(s.E) : 0,
        }));
        return { rows, spent, left: capital - spent, gain: rows.reduce((t, r) => t + r.gain, 0), used,
                 tTurns: rows.reduce((t, r) => t + r.tTurns, 0), tCost: rows.reduce((t, r) => t + r.tCost, 0) };
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
            ...(cap.amt && cap.amt.value != null
                ? [L('Set amount', fmt(cap.available) + (cap.amt.text !== fmt(cap.available) ? `  (${cap.amt.text})` : '')),
                   ...(cap.available > cap.capital ? ['  More than your capital: this is a what-if plan.'] : [])]
                : cap.amt && cap.amt.error ? [`  Set amount ignored: ${cap.amt.error}`, ...(cap.pct < 100 ? [L(`× ${cap.pct}% to spend`, fmt(cap.available))] : [])]
                : cap.pct < 100 ? [L(`× ${cap.pct}% to spend`, fmt(cap.available))] : []),
        ];
    }

    function planLines(plan, title) {
        const days = (r) => r.gain > 0 ? (r.spent + (r.tCost || 0)) / r.gain : Infinity;
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
            if (r.tTurns > 0) out.push(`  Training: ${fmt(r.tTurns)} turns${r.tCost > 0 ? ` (worth ${fmt(r.tCost)})` : ''}`);
            if (r.o.hasGain) out.push(`  +${fmt(r.gain)} credits/day · pays back ${dd(days(r))}`);
        });
        if (plan.rows.length > 1) out.push(`Total: spend ${fmt(plan.spent)}` + (plan.tTurns > 0 ? ` + ${fmt(plan.tTurns)} training turns${plan.tCost > 0 ? ` (worth ${fmt(plan.tCost)})` : ''}` : ''),
            `  +${fmt(plan.gain)} credits/day` + (plan.gain > 0 ? ` · pays back ${dd((plan.spent + plan.tCost) / plan.gain)}` : ''));
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

    // ---------- Value Optimizer: print credits or make resources with your turns? ----------
    // Each turn spent printing gives Credit Gen's credits per turn (after galaxy fee); each turn
    // spent mining gives Resource Gen's output, worth its market price. Printing is capped
    // (Credit Gen's turns per print day, on print days only); turns left over go to resources.
    // ---------- Training calculator (units trained per turn, barracks upgrade cost) ----------
    var TR_FIELDS = [
        ['barracks', 'Barracks level'], ['education', 'Education research'],
        ['tactics', 'Tactics research'], ['professors', 'Professors'],
        ['tacticians', 'Tacticians'], ['teachers', 'Teachers'],
        ['start', 'Starting barracks'], ['end', 'Ending barracks'],
    ];
    function trSaved(slot) {
        const fac = (getFSlot(slot)?.items || []).find(i => /barracks/i.test(i.name) && i.value != null);
        const bl = getSlot(slot)?.barracks ?? (fac ? fac.value : null);
        const res = (n) => researchLevel(new RegExp(n, 'i'));
        // Best Hero cards: training bonus (+%) and barracks cost reduction (−%)
        const cards = GM_getValue('sa-cards', null)?.cards || [];
        const bestEff = (test) => { let b = null; cards.forEach(c => (c.effects || []).forEach(e => {
            if (e.unit === '%' && test(e.stat.toLowerCase(), e.value) && (!b || Math.abs(e.value) > Math.abs(b))) b = e.value; })); return b; };

        const costCard = bestEff((st, v) => v < 0 && /cost/.test(st) && /barrack/.test(st));
        const unit = (re) => (getSlot(slot)?.units || []).filter(u => re.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
        const has = (re) => (getSlot(slot)?.units || []).some(u => re.test(u.name));
        return {
            barracks: bl, start: bl, end: bl != null ? bl + 1 : null,
            education: researchLevel(/^education$/i) ?? res('educat'), tactics: researchLevel(/^tactics$/i) ?? res('tactic'),
            card: null, costCard: null,
            professors: has(/professor/i) ? unit(/professor/i) : 0,
            tacticians: has(/tactician/i) ? unit(/tactician/i) : 0,
            teachers: has(/teacher/i) ? unit(/teacher/i) : null,
        };
    }
    // Hero cards boost training for specific units ("+23% Farmers trained") or all units
    // ("+10% unit training"). Only one card is active, so each unit uses its best one.
    var TR_UNIT_RE = {
        farmers: /farmer/, workers: /soldier|worker|industrial|commercial|factory/, slaves: /slave|forester/,
        spies: /assassin|spy|spies|security/, profs: /professor|tactician/, docs: /doctor|scientist|engineer/,
        corporals: /corporal/, majors: /major/, champions: /champion/, teachers: /teacher/,
    };
    // What one card does for each unit group: { key: % } (a unit-specific effect beats a general one)
    function trCardEffects(c) {
        const anyUnit = new RegExp(Object.values(TR_UNIT_RE).map(r => r.source).join('|'));
        const out = {}, stats = {};
        (c.effects || []).forEach(e => {
            const st = String(e.stat).toLowerCase();
            // Only training-speed effects ("Farmers Training speed"); not "Untrained units per tick"
            // or production effects
            if (e.unit !== '%' || !(e.value > 0) || /cost|untrained|production/.test(st) || !/\btrain(ing|ed)?\b/.test(st)) return;
            const general = !anyUnit.test(st);
            Object.keys(TR_UNIT_RE).forEach(k => {
                if (!(TR_UNIT_RE[k].test(st) || general)) return;
                if (out[k] == null || e.value > out[k]) { out[k] = e.value; stats[k] = e.stat; }
            });
        });
        return { effects: out, stats };
    }
    // Hero cards that boost training, best first (only one card can be active at a time).
    // "Best" = biggest total boost across the unit groups.
    function trCards() {
        // Group identical effects: one row per effect, with the days of one card and the
        // total days of every card you hold with that effect
        const groups = {};
        (GM_getValue('sa-cards', null)?.cards || []).forEach(c => {
            const { effects, stats } = trCardEffects(c);
            const score = Object.values(effects).reduce((s, v) => s + v, 0);
            if (!(score > 0)) return;
            const label = [...new Set(Object.values(stats))].map(st =>
                `+${+effects[Object.keys(stats).find(k => stats[k] === st)].toFixed(2)}% ${st}`).join(', ') + ' per day';
            const g = groups[label] = groups[label] || { key: label, label, name: c.name, effects, stats, score, days: c.days, count: 0, totalDays: 0 };
            g.count++; g.totalDays += c.days || 0;
            if ((c.days || 0) > (g.days || 0)) { g.days = c.days; g.name = c.name; }
        });
        // Keep only the best effect for each unit (ties → longer lasting): one row per unit type
        const all = Object.values(groups);
        const keep = new Set();
        Object.keys(TR_UNIT_RE).forEach(k => {
            let best = null;
            all.forEach(g => { if (g.effects[k] == null) return;
                if (!best || g.effects[k] > best.effects[k] || (g.effects[k] === best.effects[k] && (g.days || 0) > (best.days || 0))) best = g; });
            if (best) keep.add(best);
        });
        return [...keep].sort((a, b) => b.score - a.score || (b.days || 0) - (a.days || 0));
    }
    // Cards that cut Barracks upgrade cost (most negative first)
    function trCostCards() {
        const groups = {};
        (GM_getValue('sa-cards', null)?.cards || []).forEach(c => (c.effects || []).forEach(e => {
            const st = String(e.stat).toLowerCase();
            if (e.unit !== '%' || !(e.value < 0) || !/cost/.test(st) || !/barrack/.test(st)) return;
            const label = `−${Math.abs(e.value)}% ${e.stat} per use`;
            const g = groups[label] = groups[label] || { key: label, label, name: c.name, value: Math.abs(e.value), stat: e.stat, days: c.days, count: 0, totalDays: 0 };
            g.count++; g.totalDays += c.days || 0;
            if ((c.days || 0) > (g.days || 0)) { g.days = c.days; g.name = c.name; }
        }));
        return Object.values(groups).sort((a, b) => b.value - a.value || (b.days || 0) - (a.days || 0));
    }
    function trChosenCostCard() {
        const cards = trCostCards(), pick = GM_getValue('sa-train-costcard', 'auto');
        if (pick === 'none') return null;
        return cards.find(c => c.key === pick) || cards[0] || null;
    }
    // Dropdown row for the form: which card to use (training boost or barracks cost)
    function trCardSelect(kind) {
        const train = kind === 'train';
        const cards = train ? trCards() : trCostCards();
        const pick = GM_getValue(train ? 'sa-train-card' : 'sa-train-costcard', 'auto');
        // Effect is per day of use; days = how many days/uses one card gives
        const w = train ? 'day' : 'use', pl = (n) => `${n ?? '?'} ${w}${n === 1 ? '' : 's'}`;
        const days = (c) => `${pl(c.days)}${c.count > 1 ? ` (${c.count} cards: ${pl(c.totalDays)} total)` : ''}`;
        return `<label>${train ? 'Hero card' : 'Cost card'}</label>
            <select class="sa-select" data-trcard="${kind}" style="width:100%; min-width:0">
                <option value="auto" ${pick === 'auto' ? 'selected' : ''}>Best (auto)${cards[0] ? ': ' + escapeHtml(cards[0].label) + ' – ' + days(cards[0]) : ': none saved'}</option>
                ${cards.map((c, i) => `<option value="${escapeHtml(c.key)}" ${pick === c.key ? 'selected' : ''}>${i + 1}. ${escapeHtml(c.label)} – ${days(c)}</option>`).join('')}
                <option value="none" ${pick === 'none' ? 'selected' : ''}>No card</option>
            </select><span class="sa-src">${cards.length ? '●' : '○'}</span>`;
    }
    function trChosenCard() {
        const cards = trCards(), pick = GM_getValue('sa-train-card', 'auto');
        if (pick === 'none') return null;
        return cards.find(c => c.key === pick) || cards[0] || null;
    }
    function trSlot() { const ids = planetIds(); const s = GM_getValue('sa-train-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    function renderTraining() {
        const form = document.getElementById('sa-tr-form'), sel = document.getElementById('sa-tr-slot');
        if (!form) return;
        const slot = trSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        if (form.contains(document.activeElement)) { updateTraining(); return; }
        const saved = GM_getValue('sa-train-' + slot, {}) || {}, auto = trSaved(slot);
        form.innerHTML = TR_FIELDS.map(([k, l]) => {
            const typed = saved[k] != null && String(saved[k]).trim() !== '';
            const v = typed ? saved[k] : (auto[k] != null ? fmtPlain(auto[k]) : (k === 'turns' ? '600000' : ''));
            const pick = '';
            return `${k === 'start' ? '<div style="grid-column:1/-1" class="sa-label">Barracks upgrade cost</div>' : ''}${pick}
                <label>${l}</label><input data-tr="${k}" value="${escapeHtml(String(v))}" />
                <span class="sa-src ${typed || auto[k] == null ? 'manual' : ''}">${typed || auto[k] == null ? '○' : '●'}</span>`;
        }).join('');
        form.querySelectorAll('input[data-tr]').forEach(inp => inp.addEventListener('input', () => {
            const cur = GM_getValue('sa-train-' + slot, {}) || {}; cur[inp.dataset.tr] = inp.value;
            GM_setValue('sa-train-' + slot, cur); updateTraining();
        }));
        updateTraining();
    }
    function fmtPlain(v) { return Number.isInteger(v) ? v.toLocaleString() : String(+v.toFixed(4)); }
    function updateTraining() {
        const out = document.getElementById('sa-tr-result');
        if (!out) return;
        const v = {};
        document.querySelectorAll('#sa-tr-form input[data-tr]').forEach(i => v[i.dataset.tr] = parseNumber(i.value));
        const L = v.barracks, edu = (v.education || 0) * 0.05, tac = (v.tactics || 0) * 0.05;
        // Each unit row uses the best saved Hero card for it
        const tcards = trCards();
        const cardOf = (key) => {
            let b = null;
            tcards.forEach(g => { if (g.effects[key] != null && (!b || g.effects[key] > b.value)) b = { value: g.effects[key], label: g.label, days: g.days }; });
            return b;
        };
        const lines = [];
        if (L == null) lines.push('Enter the Barracks level (open Train Units to save it).');
        else {
            const P = (b, e) => Math.pow(b, e);
            const rows = [];
            // [name, base, extra before education (prof/tact/teacher/tactics)]
            // Per turn: base (Barracks + professors/tacticians/teachers), + research (Tactics, then
            // Education on top), + card, = total
            const unit = (name, key, base, staff = 0, tacOn = false) => {
                const cd = cardOf(key), card = cd ? cd.value / 100 : 0;
                const b = base + staff, tAdd = tacOn ? base * tac : 0;
                const eAdd = (b + tAdd) * edu, sub = b + tAdd + eAdd, cAdd = sub * card;
                rows.push({ name, b, research: tAdd + eAdd, cAdd, cd, total: sub + cAdd, staff });
            };
            const sp = Math.sqrt(v.professors || 0), st = Math.sqrt(v.tacticians || 0);
            unit('Farmers', 'farmers', 100 + 20 * P(L, 3));
            unit('Soldiers & workers*', 'workers', 50 + 10 * P(L, 3));
            unit('Slaves, Foresters', 'slaves', 40 + 10 * P(L, 2.65));
            unit('Assassins, Spies, Security', 'spies', 10 + 10 * P(L, 2.2));
            unit('Professors / Tacticians', 'profs', 10 + 5 * P(L, 2.2));
            unit('Doctors, Scientists, Engineers', 'docs', 10 + 10 * P(L, 2.3), sp * 9);
            unit('Corporals (Att/Def)', 'corporals', 0.4 + 0.4 * P(L, 3), st * 9);
            unit('Majors (Att/Def)', 'majors', 0.006 + 0.006 * P(L, 3), st, true);
            unit('Champions (Att/Def)', 'champions', 0.0004 + 0.0004 * P(L, 2.8), 0, true);
            unit('Teachers', 'teachers', 0.02 + 0.01 * P(L, 3), Math.sqrt(v.teachers || 0) * 3);
            lines.push('UNITS TRAINED PER TURN', '');
            rows.forEach(r => {
                lines.push(r.name);
                lines.push(`  Base ${fmt(r.b)}${r.staff ? ` (incl. +${fmt(r.staff)} staff)` : ''}`);
                lines.push(`  + Research ${fmt(r.research)} · + Card ${r.cd ? fmt(r.cAdd) + ` (+${+r.cd.value.toFixed(1)}%)` : '—'}`);
                lines.push(`  = ${fmt(r.total)}`);
            });
            lines.push('', 'Research = Education' + ' (+' + (edu * 100).toFixed(0) + '%, all units) and Tactics (+' + (tac * 100).toFixed(0) + '%, Majors & Champions).');
            lines.push('Card = best saved Hero card for that unit' + (tcards.length ? ' (only one can be active at a time).' : ': none saved, scan your Hero cards.'));
            lines.push('Staff = professors (Doctors…), tacticians (Corporals, Majors), teachers (Teachers).');
            lines.push('* Att/Def soldiers, Ind/Com/Mine/Factory workers');
        }
        // Barracks upgrade cost
        const ccPick = trCostCards()[0] || null;   // best barracks cost card
        const S = v.start, E = v.end, cr = (ccPick ? ccPick.value : 0) / 100;
        lines.push('', 'BARRACKS UPGRADE');
        if (S == null || E == null || E <= S) lines.push('Enter a starting and a higher ending level.');
        else {
            const credits = Math.round(Math.pow(1.269, S) * (Math.pow(1.269, E - S) - 1) / 0.269) * 1e7 * (1 - cr);
            let iron = 0, gold = 0;
            for (let k = S; k <= E - 1; k++) { const p = Math.pow(k, 1.5); iron += 10 + 10 * p; gold += 1 + p; }
            iron = Math.round(iron); gold = Math.round(gold);
            const m = getMarket(), price = (n) => (m?.resources || []).find(r => r.name.toLowerCase() === n)?.buyPrice;
            lines.push(`Level ${S} → ${E} (+${E - S})`,
                `Credits   ${fmt(credits)}${cr ? `  (after −${+(cr * 100).toFixed(2)}%${ccPick ? ` card, ${ccPick.days ?? '?'} use${ccPick.days === 1 ? '' : 's'}${ccPick.count > 1 ? ` · ${ccPick.count} cards: ${ccPick.totalDays} total` : ''}` : ' typed'})` : ''}`,
                `Iron      ${fmt(iron)}${price('iron') ? `  ≈ ${fmt(iron * price('iron'))} credits` : ''}`,
                `Gold      ${fmt(gold)}${price('gold') ? `  ≈ ${fmt(gold * price('gold'))} credits` : ''}`);
            if (price('iron') && price('gold')) lines.push(`Total     ≈ ${fmt(credits + iron * price('iron') + gold * price('gold'))} credits (resources at buy price)`);
        }
        out.textContent = lines.join('\n');
    }
    // The Value Optimizer plan, shared with the Income statement
    function voPlan() {
        const A = cgAssumptions();
        const typed = parseNumber(GM_getValue('sa-vo-turns', ''));
        const n0 = (v) => Math.round(v).toLocaleString();
        // Every planet × every method, valued per turn
        const methods = [], notes = [];
        let poolTpd = 0;
        planetIds().forEach(id => {
            const pn = shortName(id);
            let cg = null, rg = null;
            try { cg = cgModel(id); } catch (e) {}
            try { rg = rgModel(id); } catch (e) {}
            if (cg && cg.perTurn > 0) methods.push({ planet: pn, kind: 'print', label: `Print credits on ${pn}`, perTurn: cg.perTurn });
            else notes.push(`${pn}: no Credit Gen data (printing not compared)`);
            if (rg && rg.perTurn > 0) { methods.push({ planet: pn, kind: 'res', label: `Resources on ${pn}`, perTurn: rg.perTurn }); poolTpd = Math.max(poolTpd, rg.tpd || 0); }
            else notes.push(`${pn}: no Resource Gen data (resources not compared)`);
        });
        // Training and selling units (Unit Value): slaves at your kept share, professors net of the
        // untrained used. Daily sell limits cap them; passive training (1 turn/tick) fills the limit first.
        const unitCap = {}, unitInfo = {};
        (() => {
            const sell = (re, key) => { const t = parseNumber(GM_getValue(key, '')); if (t != null) return t; const m = marketRes(re); return m ? (m.sellPrice ?? m.buyPrice ?? null) : null; };
            const pS = sell(/slave|untrained/i, 'sa-uv-price'), pP = sell(/professor/i, 'sa-uv-pprice');
            const keepS = (parseNumber(GM_getValue('sa-uv-split', '')) ?? 80) / 100;
            const uSell = (marketRes(/untrained/i) || {}).sellPrice ?? 0;
            const limS = parseNumber(GM_getValue('sa-uv-limS', '')), limP = parseNumber(GM_getValue('sa-uv-limP', ''));
            let passS = 0, passP = 0;
            planetIds().forEach(id => {
                const pn = shortName(id), sp = slavesPerTurn(id), pp = profsPerTurn(id);
                if (sp) passS += sp.n * A.ticksPerDay;
                if (pp) passP += pp.n * A.ticksPerDay;
                if (sp && pS != null && sp.n * pS * keepS > 0)
                    methods.push({ planet: pn, kind: 'units', group: 'slaves', units: sp.n, label: `Sell slaves from ${pn}`, perTurn: sp.n * pS * keepS });
                if (pp && pP != null && pp.n * (pP - uSell) > 0)
                    methods.push({ planet: pn, kind: 'units', group: 'profs', units: pp.n, label: `Sell professors from ${pn}`, perTurn: pp.n * (pP - uSell) });
            });
            unitCap.slaves = limS == null ? Infinity : Math.max(0, limS - passS);
            unitCap.profs = limP == null ? Infinity : Math.max(0, limP - passP);
            unitInfo.slaves = { label: 'Slaves', limit: limS, passive: passS, cap: unitCap.slaves, priced: pS != null };
            unitInfo.profs = { label: 'Professors', limit: limP, passive: passP, cap: unitCap.profs, priced: pP != null };
            if (limS != null && unitCap.slaves === 0) notes.push('Slave sales: the daily limit is already filled by passive training.');
            if (limP != null && unitCap.profs === 0) notes.push('Professor sales: the daily limit is already filled by passive training.');
        })();
        if (!planetIds().length) return { error: 'Save a planet first.' };
        if (!methods.length) return { error: ['Fill Credit Gen and Resource Gen for at least one planet.', ...notes].join('\n') };
        const turns = typed ?? (empireTpd() || poolTpd);
        if (!turns) return { error: 'Turns per day unknown: type them above, or scan each planet\'s Tick Generator.' };
        const ranked = methods.slice().sort((a, b) => b.perTurn - a.perTurn);
        // Hand turns to the best method first; printing shares one daily cap
        const plan = (printAllowed) => {
            let left = turns, capLeft = printAllowed ? A.turnsPerDay : 0, total = 0;
            const ucap = Object.assign({}, unitCap);
            const steps = [];
            ranked.forEach(m => {
                if (left <= 0) return;
                const n = m.kind === 'print' ? Math.min(left, capLeft)
                    : m.kind === 'units' ? Math.min(left, ucap[m.group] / m.units) : left;
                if (!(n > 0)) return;
                if (m.kind === 'print') capLeft -= n;
                if (m.kind === 'units') ucap[m.group] -= n * m.units;
                left -= n; total += n * m.perTurn;
                steps.push({ m, n, value: n * m.perTurn });
            });
            return { steps, total };
        };
        const pd = plan(true), rd = plan(false);
        const week = pd.total * A.printDays + rd.total * (7 - A.printDays);
        // Average credits per day by planet and method (print days and non-print days blended)
        const byMethod = {};
        [[pd, A.printDays], [rd, 7 - A.printDays]].forEach(([p, days]) => p.steps.forEach(st => {
            const k = st.m.label; byMethod[k] = byMethod[k] || { m: st.m, perDay: 0, turns: 0 };
            byMethod[k].perDay += st.value * days / 7; byMethod[k].turns += st.n * days / 7;
        }));
        return { A, typed, turns, ranked, pd, rd, week, notes, unitInfo, byMethod: Object.values(byMethod) };
    }
    // ---------- Share data to Sharky (opt-in) & Admin view ----------
    // Shared data goes to Sharky's Google Apps Script (see SharkBot-share.gs). The admin
    // login is checked by that script on Google's side; no password is stored here.
    var SHARE_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbxlna9i8_ChZr7ddAxWCiC5088v8_63qIxixu9W3N8DESKCfK57u40aqwUKKC_p3QiW/exec';   // Sharky: paste your Apps Script web-app URL here before publishing
    function shareUrl() { return (GM_getValue('sa-share-url', '') || SHARE_URL_DEFAULT || '').trim(); }
    function gmPost(url, body) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('GM_xmlhttpRequest not available')); return; }
            GM_xmlhttpRequest({ method: 'POST', url, data: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                timeout: 30000,
                onload: (r) => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(new Error('Bad reply (' + r.status + ')')); } },
                onerror: () => reject(new Error('Network error')), ontimeout: () => reject(new Error('Timed out')) });
        });
    }
    // Everything SharkBot has saved, per planet and empire-wide (no settings, no theme)
    function shareSnapshot() {
        const planets = planetIds().map(id => ({
            slot: id, name: shortName(id),
            units: (getSlot(id)?.units || []).map(u => [u.name, u.count]), barracks: getSlot(id)?.barracks ?? null,
            facilities: (getFSlot(id)?.items || []).map(i => [i.name, i.value, i.kind || '']),
            inventory: (invLoad(id)?.items || []).map(i => [i.name, i.value]),
            nation: (GM_getValue('sa-nation-' + id, null)?.fields || []).map(f => [f.key, f.value]),
            colony: GM_getValue('sa-colony-' + id, null),
        }));
        const bd = bdCounts();
        const assassins = planetIds().reduce((t, id) => t + (getSlot(id)?.units || []).filter(u => /assassin/i.test(u.name)).reduce((s, u) => s + (u.count || 0), 0), 0);
        let turnValue = null;
        try { const vp = voPlan(); if (vp && !vp.error && vp.turns > 0) turnValue = vp.week / 7 / vp.turns; } catch (e) {}
        const tpdE = empireTpd();
        return {
            assassins, turnValue, tpm: tpdE ? tpdE / 1440 : null,
            player: (GM_getValue('sa-profile-name', '') || '').trim() || 'unknown', version: VERSION, sentAt: new Date().toISOString(),
            planets,
            research: (getRSlot('A')?.items || []).map(i => [cleanName(i.name), levelFrom(i).value]),
            bank: bankLoad()?.value ?? null, galaxyFee: galaxyFeeLoad()?.value ?? null,
            brains: bd?.brains?.value ?? null, diamonds: bd?.diamonds?.value ?? null, ssb: bd?.ssb?.value ?? null,
            traps: (trapsLoad()?.items || []).filter(t => t.invested > 0).map(t => [t.name, t.invested]),
            cards: (GM_getValue('sa-cards', null)?.cards || []).map(c => [c.name, c.days, (c.effects || []).map(e => [e.stat, e.value, e.unit])]),
        };
    }
    async function shareNow(force) {
        const url = shareUrl(), st = document.getElementById('sa-share-status');
        if (!GM_getValue('sa-share-on', false) || !url) return;
        const last = GM_getValue('sa-share-last', null);
        if (!force && last && Date.now() - new Date(last) < 15 * 60e3) return;   // at most every 15 minutes
        try { profileName(); } catch (e) {}
        try {
            const r = await gmPost(url, { action: 'share', data: shareSnapshot() });
            if (!r || !r.ok) throw new Error((r && r.error) || 'refused');
            GM_setValue('sa-share-last', new Date().toISOString());
            if (st) st.textContent = 'Last shared ' + new Date().toLocaleString();
        } catch (e) { if (st) st.textContent = 'Sharing failed: ' + e.message; }
    }
    function renderShareSettings() {
        const box = document.getElementById('sa-share-box');
        if (!box) return;
        const on = GM_getValue('sa-share-on', false), url = shareUrl(), last = GM_getValue('sa-share-last', null);
        box.innerHTML = `
            <label class="sa-check"><input type="checkbox" id="sa-share-on" ${on ? 'checked' : ''} ${url ? '' : 'disabled'} />
                <span>Share data to Sharky</span></label>
            <div style="font-size:10px; color:var(--muted); margin:4px 0 6px">
                Off unless you tick it. When on, SharkBot sends your player name, turn value, turns per minute and the data it has saved (units, facilities, inventory,
                nation, colony, research, bank, brains/diamonds/SSB, your TRAPs and Hero cards) to Sharky's Google Sheet, at most every
                15 minutes after a scan. Untick to stop; nothing is sent while it's off.${url ? '' : '<br><b>Sharing isn\'t set up in this copy of SharkBot yet.</b>'}</div>
            <button class="sa-btn" id="sa-share-send" style="margin:0" ${on && url ? '' : 'disabled'}>Send now</button>
            <span id="sa-share-status" class="sa-slot-meta" style="margin-left:6px">${last ? 'Last shared ' + new Date(last).toLocaleString() : ''}</span>`;
        box.querySelector('#sa-share-on').addEventListener('change', (e) => { GM_setValue('sa-share-on', e.target.checked); renderShareSettings(); if (e.target.checked) shareNow(true); });
        box.querySelector('#sa-share-send').addEventListener('click', () => shareNow(true));
    }

    // Admin: log in (checked by the Apps Script) and browse everyone's shared data
    let adminCreds = null, adminData = null;
    function renderAdmin() {
        const view = document.getElementById('sa-admin-view');
        if (!view) return;
        const url = shareUrl();
        if (!adminData) {
            view.innerHTML = `
                <div class="sa-form">
                    <label>Web-app URL</label><input id="sa-adm-url" value="${escapeHtml(url)}" placeholder="https://script.google.com/macros/s/…/exec" /><span></span>
                    <label>User</label><input id="sa-adm-user" autocomplete="username" /><span></span>
                    <label>Password</label><input id="sa-adm-pass" type="password" autocomplete="current-password" /><span></span>
                </div>
                <button class="sa-btn" id="sa-adm-login" style="margin:6px 0 0; width:100%">Log in</button>
                <div class="sa-slot-meta" id="sa-adm-msg" style="margin-top:6px">The login is checked by your Apps Script; it isn't stored in SharkBot.</div>`;
            const go = async () => {
                const u = view.querySelector('#sa-adm-url').value.trim(), msg = view.querySelector('#sa-adm-msg');
                if (u !== url) GM_setValue('sa-share-url', u);
                adminCreds = { user: view.querySelector('#sa-adm-user').value, pass: view.querySelector('#sa-adm-pass').value };
                msg.textContent = 'Logging in…';
                try {
                    const r = await gmPost(u, { action: 'admin', user: adminCreds.user, pass: adminCreds.pass });
                    if (!r || !r.ok) throw new Error((r && r.error) || 'refused');
                    adminData = r.players || []; renderAdmin(); renderShareSettings();
                } catch (e) { adminCreds = null; msg.textContent = 'Login failed: ' + e.message; }
            };
            view.querySelector('#sa-adm-login').addEventListener('click', go);
            view.querySelector('#sa-adm-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
            return;
        }
        const f = (v) => v == null ? '—' : escapeHtml(fmt(v));
        const credits = (d) => (d.planets || []).reduce((t, p) => t + (p.inventory || []).filter(i => /credit|income/i.test(i[0])).reduce((s, i) => s + (i[1] || 0), 0), 0);
        const pick = GM_getValue('sa-admin-pick', null);
        const sel = adminData.find(p => p.player === pick);
        view.innerHTML = `
            <div style="display:flex; gap:6px; margin-bottom:6px">
                <button class="sa-btn" id="sa-adm-refresh" style="margin:0; flex:1">↻ Refresh</button>
                <button class="sa-btn" id="sa-adm-logout" style="margin:0; flex:1">Log out</button></div>
            <div style="overflow-x:auto"><table class="sa-unit-table sa-traps-table">
                <thead><tr><th>Player</th><th>Updated</th><th>Version</th><th>Planets</th><th>Assassins</th><th>Turn value</th><th>Turns/min</th><th>Credits</th><th>Bank</th><th>TRAPs</th></tr></thead>
                <tbody>${adminData.map(p => { const d = p.data || {}; return `<tr data-player="${escapeHtml(p.player)}" style="cursor:pointer${p.player === pick ? '; background:var(--hover)' : ''}">
                    <td class="sa-trap-name">${escapeHtml(p.player)}</td><td class="sa-num">${escapeHtml(new Date(p.updated).toLocaleString())}</td>
                    <td class="sa-num">${escapeHtml(p.version || '')}</td><td class="sa-num">${(d.planets || []).length}</td>
                    <td class="sa-num">${f(d.assassins)}</td><td class="sa-num">${f(d.turnValue)}</td>
                    <td class="sa-num">${d.tpm != null ? escapeHtml(d.tpm.toFixed(2)) : '—'}</td>
                    <td class="sa-num">${f(credits(d))}</td><td class="sa-num">${f(d.bank)}</td>
                    <td class="sa-num">${f((d.traps || []).reduce((t, x) => t + (x[1] || 0), 0))}</td></tr>`; }).join('')}</tbody></table></div>
            <div class="sa-slot-meta" style="margin-top:4px">${adminData.length} players · click a row for details</div>
            ${sel ? adminDetail(sel) : ''}`;
        view.querySelector('#sa-adm-refresh').addEventListener('click', async () => {
            try { const r = await gmPost(shareUrl(), { action: 'admin', user: adminCreds.user, pass: adminCreds.pass }); if (r && r.ok) { adminData = r.players || []; renderAdmin(); } } catch (e) {}
        });
        view.querySelector('#sa-adm-logout').addEventListener('click', () => { adminCreds = null; adminData = null; renderAdmin(); });
        view.querySelectorAll('tr[data-player]').forEach(tr => tr.addEventListener('click', () => { GM_setValue('sa-admin-pick', tr.dataset.player); renderAdmin(); }));
        view.querySelector('#sa-adm-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(sel.data, null, 2)));
    }
    function adminDetail(p) {
        const d = p.data || {}, f = (v) => v == null ? '—' : escapeHtml(fmt(v));
        const t = (title, rows) => rows.length ? `<div class="sa-label" style="margin:8px 0 3px">${title}</div><table class="sa-unit-table sa-stmt"><tbody>${
            rows.map(r => `<tr><td>${escapeHtml(String(r[0]))}</td><td class="sa-num">${typeof r[1] === 'number' ? f(r[1]) : escapeHtml(String(r[1] ?? '—'))}</td></tr>`).join('')}</tbody></table>` : '';
        return `<div class="sa-label" style="margin:12px 0 4px; font-size:12px">${escapeHtml(p.player)}</div>
            ${t('Empire', [['Assassins (all planets)', d.assassins], ['Turn value (Value Optimizer)', d.turnValue],
                ['Turns per minute', d.tpm != null ? d.tpm.toFixed(2) : null], ['Bank', d.bank], ['Galaxy fee %', d.galaxyFee], ['Brains', d.brains], ['Diamonds', d.diamonds], ['SSB', d.ssb]])}
            ${t('Research', d.research || [])}
            ${(d.planets || []).map(pl => `<details style="margin-top:6px"><summary><b>${escapeHtml(pl.name)}</b></summary>
                ${t('Units', pl.units || [])}${t('Facilities', (pl.facilities || []).map(x => [x[0], x[1]]))}
                ${t('Inventory', pl.inventory || [])}${t('Nation', pl.nation || [])}
                ${pl.colony ? t('Colony', Object.entries(pl.colony).filter(([k]) => k !== 'savedAt')) : ''}</details>`).join('')}
            ${t('TRAPs held', d.traps || [])}
            <button class="sa-btn" id="sa-adm-copy" style="margin:8px 0 0; width:100%">⧉ Copy raw data</button>`;
    }
    // ---------- Untrained & Professor value ----------
    function marketRes(re) { return (getMarket()?.resources || []).find(r => re.test(r.name)) || null; }
    function uvSlot() { const ids = planetIds(); const s = GM_getValue('sa-uv-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    // Professors trained in one turn (Training formula, best professor card)
    // Workers (Soldiers & workers row) trained per turn: (50 + 10·L³) × (1 + Education) × (1 + best card)
    function workersPerTurn(slot) {
        const auto = trSaved(slot), saved = GM_getValue('sa-train-' + slot, {}) || {};
        const val = (k) => { const t = saved[k] != null && String(saved[k]).trim() !== ''; return t ? parseNumber(saved[k]) : auto[k]; };
        const L = val('barracks'); if (L == null) return null;
        const edu = (val('education') || 0) * 0.05;
        let card = 0; trCards().forEach(g => { if (g.effects.workers != null && g.effects.workers > card) card = g.effects.workers; });
        return (50 + 10 * Math.pow(L, 3)) * (1 + edu) * (1 + card / 100);
    }
    // Slaves per turn = 50% of the planet's untrained per tick (all bonuses)
    function slavesPerTurn(slot) {
        const um = untrainedModel(slot);
        if (!(um.perTick > 0) || !um.farmers) return null;
        return { n: um.perTick * 0.5, untrained: um.perTick };
    }
    function profsPerTurn(slot) {
        const auto = trSaved(slot), saved = GM_getValue('sa-train-' + slot, {}) || {};
        const val = (k) => { const t = saved[k] != null && String(saved[k]).trim() !== ''; return t ? parseNumber(saved[k]) : auto[k]; };
        const L = val('barracks'); if (L == null) return null;
        const edu = (val('education') || 0) * 0.05;
        let card = 0; trCards().forEach(g => { if (g.effects.profs != null && g.effects.profs > card) card = g.effects.profs; });
        const base = 10 + 5 * Math.pow(L, 2.2);
        return { n: base * (1 + edu) * (1 + card / 100), card, L, edu };
    }
    // Untrained per tick (user's sheet): (√(farmers/3) + 10) × (0.3 × FoodFactories^1.18 + 100)/100 × (1 + card) × productivity
    function untrainedModel(slot) {
        const farmers = (getSlot(slot)?.units || []).filter(u => /farmer/i.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
        const ff = (getFSlot(slot)?.items || []).find(i => /food\s*factor/i.test(cleanName(i.name)));
        const food = ff ? levelFrom(ff).value || 0 : 0;
        const card = bestCardPct(st => /untrained/.test(st));
        const prod = (GM_getValue('sa-colony-' + slot, null) || {}).productivity;
        const base = Math.sqrt(farmers / 3) + 10;
        const perTick = base * (0.3 * Math.pow(food, 1.18) + 100) / 100 * (1 + (card ? card.value / 100 : 0)) * ((prod ?? 100) / 100);
        return { farmers, food, card, prod, base, perTick };
    }
    function renderUnitValue() {
        const out = document.getElementById('sa-uv-result'), sel = document.getElementById('sa-uv-slot');
        if (!out) return;
        const slot = uvSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        const ticks = cgAssumptions().ticksPerDay;
        const f = (v) => v == null ? '—' : escapeHtml(fmt(v));
        const H = [];   // html blocks
        const head = (t) => H.push(`<div class="sa-label" style="margin:10px 0 4px">${t}</div>`);
        const note = (t) => H.push(`<div class="sa-slot-meta" style="margin:3px 0">${t}</div>`);
        const kv = (rows) => H.push(`<table class="sa-unit-table sa-stmt"><tbody>${rows.map(([k, v]) =>
            `<tr><td>${k}</td><td class="sa-num">${v}</td></tr>`).join('')}</tbody></table>`);
        const grid = (cols, rows, total) => H.push(`<div style="overflow-x:auto"><table class="sa-unit-table sa-traps-table">
            <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'sa-num' : ''}">${c}</td>`).join('')}</tr>`).join('')}
            ${total ? `<tr class="sa-stmt-total">${total.map((c, i) => `<td class="${i ? 'sa-num' : ''}">${c}</td>`).join('')}</tr>` : ''}</tbody></table></div>`);
        const priceRows = (re, key) => {
            const m = marketRes(re), rows = [];
            if (m && m.sellPrice != null) rows.push(['Sell', m.sellPrice]);
            if (m && m.buyPrice != null) rows.push(['Buy', m.buyPrice]);
            const t = parseNumber(GM_getValue(key, ''));
            if (t != null) rows.push(['Typed', t]);
            return rows;
        };
        let tpd = null;
        try { tpd = rgModel(slot)?.tpd ?? rgAutoTpd(slot); } catch (e) { tpd = rgAutoTpd(slot); }
        const limS = parseNumber(GM_getValue('sa-uv-limS', '')), limP = parseNumber(GM_getValue('sa-uv-limP', ''));
        const keepS = (parseNumber(GM_getValue('sa-uv-split', '')) ?? 80) / 100;
        const lim = (x) => x == null ? '∞' : f(x);
        const split = (passive, perTurn, limit) => {
            const turnUnits = perTurn * (tpd || 0);
            const pSold = limit == null ? passive : Math.min(passive, limit);
            const tSold = limit == null ? turnUnits : Math.max(0, Math.min(turnUnits, limit - pSold));
            const turnsToLimit = limit != null && perTurn > 0 ? Math.max(0, (limit - pSold) / perTurn) : null;
            return { turnUnits, pSold, tSold, turnsToLimit };
        };
        const valueGrid = (rows, pSold, tSold, perTurn, extra, capped, keep = 1) => grid(
            ['Price', 'Per unit', 'Passive /day', 'Turns /day', 'Per turn', 'Total /day'],
            rows.map(([lab, p]) => {
                const pv = pSold * p * keep - (extra ? extra(pSold) : 0), tv = tSold * p * keep - (extra ? extra(tSold) : 0);
                const pt = capped ? 0 : perTurn * p * keep - (extra ? extra(perTurn) : 0);
                return [lab, f(p), f(pv), f(tv), f(pt), `<b>${f(pv + tv)}</b>`];
            }));

        // Untrained
        const um = untrainedModel(slot);
        const seen = (GM_getValue('sa-nation-' + slot, null)?.fields || []).find(x => x.key === 'growth')?.value ?? null;
        head('Untrained units');
        kv([['Farmers', f(um.farmers)], ['Food Factories', um.food.toLocaleString()],
            ['Card', um.card ? `+${um.card.value}% <span style="color:var(--muted)">${escapeHtml(um.card.stat)}</span>` : '—'],
            ['Productivity', um.prod != null ? um.prod + '%' : '100% (not saved)'], ['Base untrained', f(um.base)],
            ['<b>Per tick, all bonuses</b>', `<b>${f(um.perTick)}</b>`], [`Per day (${ticks.toLocaleString()} ticks)`, f(um.perTick * ticks)],
            ...(seen != null ? [['Nation page growth', f(seen) + ' / tick']] : [])]);
        note(`Turns per day: ${tpd ? Math.round(tpd).toLocaleString() + ' (Tick Generator, shared by all planets)' : 'unknown (scan Facilities)'}`);

        // Slaves
        const sRows = priceRows(/slave|untrained/i, 'sa-uv-price');
        const sp = slavesPerTurn(slot);
        const sPassive = sp ? sp.n * ticks : 0, ss = split(sPassive, sp ? sp.n : 0, limS);
        head('Slaves');
        kv([['Passive (1 turn / tick)', `${f(sPassive)} /day → sold ${f(ss.pSold)}`],
            ['Trained per turn', sp ? f(sp.n) + ' <span style="color:var(--muted)">(50% of untrained per tick)</span>' : 'Farmers not saved (scan Train Units)'],
            ['From turns', `${f(ss.turnUnits)} /day → sold ${f(ss.tSold)}`],
            ['Daily sell limit', lim(limS) + (ss.turnsToLimit != null ? ` · reached after ${f(ss.turnsToLimit)} turns` : '')],
            ['Split (you keep)', `${Math.round(keepS * 1000) / 10}%`]]);
        if (!sRows.length) note('No market price saved for slaves: open the Market page, or type a price.');
        else { valueGrid(sRows, ss.pSold, ss.tSold, sp ? sp.n : 0, null, ss.turnsToLimit === 0, keepS); note('Slave values are what you keep after the split.'); }

        // Professors
        const pp = profsPerTurn(slot);
        const uSell = (marketRes(/untrained/i) || {}).sellPrice ?? null;
        const pPassive = pp ? pp.n * ticks : 0, ps = split(pPassive, pp ? pp.n : 0, limP);
        head('Professors');
        kv([['Passive (1 turn / tick)', `${f(pPassive)} /day → sold ${f(ps.pSold)}`],
            ['Trained per turn', pp ? `${f(pp.n)} <span style="color:var(--muted)">(Barracks ${pp.L}, Education +${(pp.edu * 100).toFixed(0)}%${pp.card ? `, card +${pp.card}%` : ''})</span>` : 'Barracks level not saved'],
            ['From turns', `${f(ps.turnUnits)} /day → sold ${f(ps.tSold)}`],
            ['Daily sell limit', lim(limP) + (ps.turnsToLimit != null ? ` · reached after ${f(ps.turnsToLimit)} turns` : '')]]);
        const pRows = priceRows(/professor/i, 'sa-uv-pprice');
        if (!pRows.length) note('No market price saved for professors: open the Market page, or type a price.');
        else if (pp) {
            valueGrid(pRows, ps.pSold, ps.tSold, pp.n, uSell != null ? (n) => n * uSell : null, ps.turnsToLimit === 0);
            if (ps.turnsToLimit === 0) note('Passive training already reaches the daily limit: extra turns add nothing.');
            if (uSell != null) note('Professor values are net of the untrained used (at sell price).');
            let tv = null;
            try { const vp = voPlan(); if (vp && !vp.error && vp.turns > 0) tv = vp.week / 7 / vp.turns; } catch (e) {}
            if (tv != null && ps.turnsToLimit !== 0) {
                const best = Math.max(...pRows.map(([, p]) => pp.n * p - (uSell != null ? pp.n * uSell : 0)));
                note(`Value Optimizer turn: ${f(tv)} → ` + (best > tv
                    ? `selling professors pays up to ×${(best / tv).toFixed(2)} more per turn${limP != null ? ` (until the limit, ${f(ps.turnsToLimit)} turns)` : ''}.`
                    : `your Value Optimizer plan pays ×${(tv / Math.max(best, 1e-9)).toFixed(2)} more per turn.`));
            }
        }

        // All planets
        if (planetIds().length > 1) {
            head('All planets · passive training per day');
            const sP = sRows[0], pP = pRows[0];
            let tS = 0, tP = 0;
            const rows = planetIds().map(id => {
                const a = slavesPerTurn(id), b = profsPerTurn(id);
                const sd = a ? a.n * ticks : 0, pd = b ? b.n * ticks : 0; tS += sd; tP += pd;
                return [escapeHtml(shortName(id)) + (a && b ? '' : ' <span style="color:var(--dim)">(' + (!a ? 'no farmers' : 'no Barracks') + ')</span>'), f(sd), f(pd),
                    sP ? f(sd * sP[1] * keepS) : '—', pP ? f(pd * pP[1]) : '—'];
            });
            grid(['Planet', 'Slaves', 'Professors', `Slaves ${sP ? sP[0].toLowerCase() : ''} (kept)`, `Professors ${pP ? pP[0].toLowerCase() : ''}`], rows,
                ['<b>Total</b>', f(tS), f(tP), sP ? `<b>${f(Math.min(tS, limS ?? Infinity) * sP[1] * keepS)}</b>` : '—', pP ? `<b>${f(Math.min(tP, limP ?? Infinity) * pP[1])}</b>` : '—']);
            if (limS != null || limP != null) note('Totals are capped at the daily sell limits.');
        }
        note('Passive /day and Turns /day are what you can sell per day within the limit. Each professor trained uses one untrained unit (assumed).');
        out.style.whiteSpace = 'normal';
        out.innerHTML = H.join('');
    }
    // ---------- Productivity: sickness healed vs added per tick (user's formulas) ----------
    //   healed = doctors·(1 + Medicine/2)·(sick/total) + √happiness/100·workerRatio·sick + workModeHappiness/10·workerRatio·sick
    //   added  = pollution^1.2/happiness²·(1 − sick/total) + 500·sick/happiness²·(1 − (sick/total)^0.35)·(1 − card)
    var PR_FIELDS = [
        ['doctors', 'Doctors'], ['medicine', 'Medicine research'], ['sickness', 'Sick units'],
        ['total', 'Total units (population)'], ['happiness', 'Happiness %'], ['workerRatio', 'Worker ratio'],
        ['wmHappy', 'Work mode happiness'], ['pollution', 'Pollution'], ['card', 'Reduce-sickness card %'],
    ];
    function prSlot() { const ids = planetIds(); const s = GM_getValue('sa-pr-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    function prAuto(slot) {
        const units = getSlot(slot)?.units || [];
        const sum = (re) => units.filter(u => re.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
        const nf = (k) => (GM_getValue('sa-nation-' + slot, null)?.fields || []).find(f => f.key === k);
        const col = GM_getValue('sa-colony-' + slot, null) || {};
        const pop = nf('population')?.value ?? (getSlot(slot)?.totalPopulation ?? null);
        const workers = sum(/worker/i);
        const card = bestCardPct(st => /sick/.test(st));
        return {
            doctors: units.some(u => /doctor/i.test(u.name)) ? sum(/doctor/i) : null,
            medicine: researchLevel(/^medicine$/i), sickness: nf('sickness')?.value ?? null, total: pop,
            happiness: col.happiness ?? null, workerRatio: pop && workers ? +(workers / pop).toFixed(4) : null,
            wmHappy: null, pollution: nf('pollution')?.value ?? null, card: card ? card.value : null,
        };
    }
    function prRates(v, sick) {
        const T = v.total || 0, H = v.happiness || 0, r = v.workerRatio || 0;
        if (!(T > 0) || !(H > 0)) return null;
        const f = sick / T;
        const healed = (v.doctors || 0) * (1 + (v.medicine || 0) / 2) * f + Math.sqrt(H) / 100 * r * sick + (v.wmHappy || 0) / 10 * r * sick;
        const added = Math.pow(v.pollution || 0, 1.2) / (H * H) * (1 - f)
            + 500 * sick / (H * H) * (1 - Math.pow(f, 0.35)) * (1 - (v.card || 0) / 100);
        return { healed, added, net: added - healed };
    }
    function renderProductivity() {
        const form = document.getElementById('sa-pr-form'), sel = document.getElementById('sa-pr-slot');
        if (!form) return;
        const slot = prSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        if (!form.contains(document.activeElement)) {
            const saved = GM_getValue('sa-pr-' + slot, {}) || {}, auto = prAuto(slot);
            form.innerHTML = PR_FIELDS.map(([k, l]) => {
                const typed = saved[k] != null && String(saved[k]).trim() !== '';
                const v = typed ? saved[k] : auto[k] != null ? auto[k].toLocaleString(undefined, { maximumFractionDigits: 4 }) : (k === 'wmHappy' ? '0' : '');
                return `<label>${l}</label><input data-pr="${k}" value="${escapeHtml(String(v))}" />
                    <span class="sa-src ${typed || auto[k] == null ? 'manual' : ''}">${typed || auto[k] == null ? '○' : '●'}</span>`;
            }).join('');
            form.querySelectorAll('input[data-pr]').forEach(inp => inp.addEventListener('input', () => {
                const cur = GM_getValue('sa-pr-' + slot, {}) || {}; cur[inp.dataset.pr] = inp.value;
                GM_setValue('sa-pr-' + slot, cur); updateProductivity();
            }));
        }
        updateProductivity();
    }
    function updateProductivity() {
        const out = document.getElementById('sa-pr-result');
        if (!out) return;
        const v = {};
        document.querySelectorAll('#sa-pr-form input[data-pr]').forEach(i => v[i.dataset.pr] = parseNumber(i.value));
        const now = prRates(v, v.sickness || 0);
        if (!now) { out.textContent = 'Enter total units and happiness (open the Nation page and hover the colony face).'; return; }
        const T = v.total, ticks = cgAssumptions().ticksPerDay;
        // Where sickness settles: the level where added = healed (bisection on 0..T)
        let lo = 0, hi = T;
        const netAt = (s) => prRates(v, s).net;
        let eq = null;
        if (netAt(lo) <= 0) eq = 0; else if (netAt(hi) >= 0) eq = T;
        else { for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (netAt(m) > 0) lo = m; else hi = m; } eq = (lo + hi) / 2; }
        // One day ahead, tick by tick
        let s = v.sickness || 0;
        for (let i = 0; i < ticks; i++) s = Math.min(T, Math.max(0, s + netAt(s)));
        const pct = (x) => (x / T * 100).toFixed(3) + '%';
        const L = (l, x) => l.padEnd(27) + x;
        out.textContent = [
            'PER TICK (now)',
            L('Sickness healed', fmt(now.healed)),
            L('Sickness added', fmt(now.added)),
            L('= Net change', (now.net >= 0 ? '+' : '−') + fmt(Math.abs(now.net)) + (now.net > 0 ? '  (getting sicker)' : now.net < 0 ? '  (recovering)' : '')),
            '',
            L('Sick now', `${fmt(v.sickness || 0)} (${pct(v.sickness || 0)})`),
            L(`After a day (${ticks.toLocaleString()} ticks)`, `${fmt(s)} (${pct(s)})`),
            L('Settles at', `${fmt(eq)} (${pct(eq)})`),
            '',
            'Worker ratio defaults to all workers ÷ population; work mode happiness is',
            'typed (the game value for your work mode). Productivity itself needs its',
            'formula: send it and it will be shown here.',
        ].join('\n');
    }
    // ---------- Energy storage (user's sheet) ----------
    // Storage = (Solar 3000×lvl×(1+5%×Solar research) + Coal 3000×lvl + Wind 5000×lvl
    //   + Tritium Power 100000×lvl + Tritium Accumulator 10000×lvl + SSB×100)
    //   × Energy Core (1 + round(lvl^1.2/5, 10)/100) × (1 + 1%×Energy Technology) × (1 + card)
    var EN_FIELDS = [
        ['solar', 'Solar Power level', /^solar\s*power/i, 'fac'],
        ['coal', 'Coal Power level', /^coal\s*power/i, 'fac'],
        ['wind', 'Wind Power level', /^wind\s*power/i, 'fac'],
        ['tritp', 'Tritium Power level', /^tritium\s*power/i, 'fac'],
        ['tacc', 'Tritium Accumulator level', /^tritium\s*accumulator|^tritium\s*acumulator/i, 'fac'],
        ['core', 'Energy Core level', /^energy\s*core/i, 'fac'],
        ['ssb', 'SSB', null, 'ssb'],
        ['solarRes', 'Solar power research', /^solar\s*power$/i, 'res'],
        ['etech', 'Energy Technology research', /^energy\s*technology$/i, 'res'],
    ];
    function enSlot() { const ids = planetIds(); const s = GM_getValue('sa-en-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    function enAuto(slot) {
        const out = {};
        const facs = (getFSlot(slot)?.items || []).filter(i => i.kind !== 'area');
        EN_FIELDS.forEach(([k, , re, src]) => {
            if (src === 'fac') { const f = facs.find(i => re.test(cleanName(i.name)) || re.test(String(i.name).trim())); out[k] = f ? levelFrom(f).value : null; }
            else if (src === 'res') out[k] = researchLevel(re);
            else { const c = bdCounts(); out[k] = c && c.ssb ? c.ssb.value : null; }
        });
        return out;
    }
    function enCard() { return bestCardPct(st => /energy/.test(st) && /stor|capacity|max/.test(st)) || bestCardPct(st => /energy/.test(st) && !/cost/.test(st)); }
    function energyStorage(v, cardPct) {
        const n = (x) => x || 0;
        const solar = 3000 * n(v.solar) * (1 + 0.05 * n(v.solarRes));
        const parts = { 'Solar Power': solar, 'Coal Power': 3000 * n(v.coal), 'Wind Power': 5000 * n(v.wind),
            'Tritium Power': 100000 * n(v.tritp), 'Tritium Accumulator': 10000 * n(v.tacc), 'SSB': 100 * n(v.ssb) };
        const core = 1 + Math.round(Math.pow(n(v.core), 1.2) / 5 * 1e10) / 1e10 / 100;
        const et = 1 + 0.01 * n(v.etech), card = 1 + (cardPct || 0) / 100;
        const base = Object.values(parts).reduce((s, x) => s + x, 0);
        return { parts, base, core, et, card, total: base * core * et * card };
    }
    function enStorageFor(slot) {
        const saved = GM_getValue('sa-en-' + slot, {}) || {}, auto = enAuto(slot), v = {};
        EN_FIELDS.forEach(([k]) => { const t = saved[k] != null && String(saved[k]).trim() !== ''; v[k] = t ? parseNumber(saved[k]) : auto[k]; });
        const c = enCard();
        return energyStorage(v, c ? c.value : 0);
    }
    function renderEnergy() {
        const form = document.getElementById('sa-en-form'), sel = document.getElementById('sa-en-slot');
        if (!form) return;
        const slot = enSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        if (!form.contains(document.activeElement)) {
            const saved = GM_getValue('sa-en-' + slot, {}) || {}, auto = enAuto(slot);
            form.innerHTML = EN_FIELDS.map(([k, l]) => {
                const typed = saved[k] != null && String(saved[k]).trim() !== '';
                const v = typed ? saved[k] : auto[k] != null ? auto[k].toLocaleString() : '';
                return `<label>${l}</label><input data-en="${k}" value="${escapeHtml(String(v))}" />
                    <span class="sa-src ${typed || auto[k] == null ? 'manual' : ''}">${typed || auto[k] == null ? '○' : '●'}</span>`;
            }).join('');
            form.querySelectorAll('input[data-en]').forEach(inp => inp.addEventListener('input', () => {
                const cur = GM_getValue('sa-en-' + slot, {}) || {}; cur[inp.dataset.en] = inp.value;
                GM_setValue('sa-en-' + slot, cur); updateEnergy();
            }));
        }
        updateEnergy();
    }
    function updateEnergy() {
        const out = document.getElementById('sa-en-result');
        if (!out) return;
        const v = {};
        document.querySelectorAll('#sa-en-form input[data-en]').forEach(i => v[i.dataset.en] = parseNumber(i.value));
        const c = enCard(), r = energyStorage(v, c ? c.value : 0);
        const L = (l, x) => l.padEnd(21) + x;
        out.textContent = [
            'STORAGE',
            ...Object.entries(r.parts).map(([k, x]) => L(k, fmt(x))),
            L('= Base', fmt(r.base)), '',
            'MULTIPLIERS',
            L('Energy Core', '×' + r.core.toFixed(4)),
            L('Energy Technology', '×' + r.et.toFixed(2)),
            L('Card', c ? `×${r.card.toFixed(2)}  (+${c.value}% ${c.stat})` : '×1  (no energy card saved)'), '',
            L('= Total energy', fmt(r.total) + `  (${Math.round(r.total).toLocaleString()})`),
            '', 'Solar Power storage includes +5% per Solar power research level.',
        ].join('\n');
    }
    // ---------- Turn storage: Turn Storage level × 10 + Brains × 100 + 200 ----------
    function tsSlot() { const ids = planetIds(); const s = GM_getValue('sa-ts-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    // Turn Storage is one empire-wide store (only one planet has the facility)
    function tsAuto(slot) {
        const find = (id) => (getFSlot(id)?.items || []).find(i => /turn\s*storage/i.test(cleanName(i.name)) && levelFrom(i).value != null);
        let fac = find(slot);
        if (!fac) planetIds().some(id => (fac = find(id)));
        if (fac) fac = { value: levelFrom(fac).value };
        const c = bdCounts();
        return { level: fac ? fac.value : null, brains: c && c.brains ? c.brains.value : null };
    }
    function tsCapacity(level, brains) { return (level || 0) * 10 + (brains || 0) * 100 + 200; }
    function renderTurnStorage() {
        const form = document.getElementById('sa-ts-form'), sel = document.getElementById('sa-ts-slot');
        if (!form) return;
        const slot = tsSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        if (!form.contains(document.activeElement)) {
            const saved = GM_getValue('sa-ts-' + slot, {}) || {}, auto = tsAuto(slot);
            form.innerHTML = [['level', 'Turn Storage level'], ['brains', 'Brains (empire-wide)']].map(([k, l]) => {
                const typed = saved[k] != null && String(saved[k]).trim() !== '';
                const v = typed ? saved[k] : auto[k] != null ? auto[k].toLocaleString() : '';
                return `<label>${l}</label><input data-ts="${k}" value="${escapeHtml(String(v))}" />
                    <span class="sa-src ${typed || auto[k] == null ? 'manual' : ''}">${typed || auto[k] == null ? '○' : '●'}</span>`;
            }).join('');
            form.querySelectorAll('input[data-ts]').forEach(inp => inp.addEventListener('input', () => {
                const cur = GM_getValue('sa-ts-' + slot, {}) || {}; cur[inp.dataset.ts] = inp.value;
                GM_setValue('sa-ts-' + slot, cur); updateTurnStorage();
            }));
        }
        updateTurnStorage();
    }
    function updateTurnStorage() {
        const out = document.getElementById('sa-ts-result');
        if (!out) return;
        const v = {};
        document.querySelectorAll('#sa-ts-form input[data-ts]').forEach(i => v[i.dataset.ts] = parseNumber(i.value));
        const cap = tsCapacity(v.level, v.brains);
        const lines = [
            `Turn Storage   ${(v.level || 0).toLocaleString()} × 10  = ${((v.level || 0) * 10).toLocaleString()}`,
            `Brains         ${(v.brains || 0).toLocaleString()} × 100 = ${((v.brains || 0) * 100).toLocaleString()}`,
            `Base                         200`,
            `= Max turns stored  ${Math.round(cap).toLocaleString()}  (${fmt(cap)})`,
        ];
        let tpd = null;
        tpd = empireTpd();
        if (tpd) lines.push('', `Fills in ${(cap / tpd * 24).toFixed(1)} hours at ${Math.round(tpd).toLocaleString()} turns/day (Tick Generator).`,
            'Spend turns before then or new ones are wasted.');
        if (v.level == null) lines.push('', 'Turn Storage level not saved: scan Facilities, or type it.');
        if (v.brains == null) lines.push('Brains not saved: open the Research page, or type them.');
        out.textContent = lines.join('\n');
    }
    // ---------- Research calculator: cost of the next level of every research ----------
    // Formulas from the user's sheet. L = the level being bought (current + 1).
    // Brain boost: costs × 0.75 and research points × 2. Cards: research requirement −%,
    // research speed +%.
    var RC_STD_RES = (L) => 1e6 + Math.round(1e6 * Math.pow(2, L));
    var RC_STD_EN = (L) => 1000 + Math.round(1000 * Math.pow(2, L));
    var RC_CR34 = (L) => 1e11 + Math.round(1.5e12 * Math.pow(L, 3.4));
    var RC_CR5 = (L) => 1e9 + Math.round(5e12 * Math.pow(L, 5));
    var RC_GROUPS = [
        { names: ['Farmialism', 'Economy', 'Medicine', 'Botany'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 512 + Math.round(512 * L ** 2), Gold: 128 + Math.round(128 * L ** 2), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Weapon Technology', 'Defense Technology'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 128 + Math.round(128 * L ** 2.2), Gold: 64 + Math.round(64 * L ** 2.2), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Industrialism'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 256 + Math.round(256 * L ** 2), Gold: 64 + Math.round(64 * L ** 2), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Espionage Technology', 'Assassin Technology', 'Tactics'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 1280 + Math.round(1280 * L ** 2), Gold: 1280 + Math.round(1280 * L ** 2), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Commercialism', 'Digging', 'Gold mining'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 512 + Math.round(512 * L ** 2.3), Gold: 128 + Math.round(128 * L ** 2.2), Tritium: 1024 + Math.round(1024 * L ** 3), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Astronomy', 'Education'], f: (L) => ({ Credits: 1e9 + Math.round(1e12 * L ** 5),
            Iron: 64 + Math.round(1024 * L ** 2), Gold: 64 + Math.round(256 * L ** 3), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Supervision'], f: (L) => ({ Credits: RC_CR5(L),
            Iron: 5120 + Math.round(5120 * L ** 2), Gold: 5120 + Math.round(1280 * L ** 2), Energy: 1000 + Math.round(500 * 2 ** L), rp: RC_STD_RES(L) }) },
        { names: ['Iron mining', 'Metallurgy'], f: (L) => ({ Credits: RC_CR5(L),
            Iron: 2048 + Math.round(1024 * L ** 2.3), Gold: 128 + Math.round(128 * L ** 2.2), Tritium: 1024 + Math.round(1024 * L ** 3), Energy: 1200 + Math.round(120 * 2 ** L), rp: RC_STD_RES(L) }) },
        { names: ['Automation'], f: (L) => ({ Credits: RC_CR5(L),
            Iron: 16384 + Math.round(16384 * L ** 2), Gold: 8192 + Math.round(8192 * L ** 2), Tritium: 1024 + Math.round(1024 * L ** 3), Energy: 100000 + Math.round(5000 * 2 ** L), rp: 5e7 + Math.round(1e7 * 2 ** L) }) },
        { names: ['Tritium mining', 'Cold Tritium', 'Ironized Gold'], f: (L) => ({ Credits: 1e10 + Math.round(5e12 * L ** 5),
            Iron: 1024 + Math.round(2048 * L ** 2.5), Gold: 5024 + Math.round(1024 * L ** 2.5), Tritium: 5024 + Math.round(2048 * L ** 3), Energy: 100000 + Math.round(4000 * 3 ** L), rp: 5e7 + Math.round(1e7 * 6 ** L) }) },
        { names: ['Work Practices'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 512 + Math.round(512 * L ** 2), Gold: 128 + Math.round(128 * L ** 2), Tritium: 512 + Math.round(512 * L ** 2), Energy: RC_STD_EN(L) * 0.8, rp: RC_STD_RES(L) }) },
        { names: ['Energy Technology', 'Solar power'], f: (L) => ({ Credits: RC_CR5(L),
            Iron: 512 + Math.round(256 * L ** 2), Gold: 512 + Math.round(512 * L ** 2), Tritium: 1024 + Math.round(1024 * L ** 3), Energy: 600 + Math.round(180 * 2 ** L), rp: 2e5 + Math.round(2e5 * 2 ** L) }) },
        { names: ['Forestry'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 16 + Math.round(16 * L ** 2), Gold: 32 + Math.round(32 * L ** 2), Energy: RC_STD_EN(L), rp: RC_STD_RES(L) }) },
        { names: ['Computer Technology'], f: (L) => ({ Credits: RC_CR34(L),
            Iron: 64 + Math.round(64 * L ** 2), Gold: 256 + Math.round(256 * L ** 2), Tritium: 1024 + Math.round(1024 * L ** 3), Energy: 2000 + Math.round(2000 * 2 ** L), rp: RC_STD_RES(L) }) },
        { names: ['Colonization'], f: (L) => ({ Credits: 1e12 + Math.round(1e12 * L ** 4),
            Iron: 1280 + Math.round(5120 * L ** 3), Gold: 5120 + Math.round(1280 * L ** 3), Energy: 50000 + Math.round(50000 * 3 ** L), rp: 5e7 + Math.round(1e7 * 6 ** L) }) },
        { names: ['Entertainment'], f: (L) => ({ Credits: RC_CR5(L),
            Iron: 1280 + Math.round(5120 * L ** 2), Gold: 10512 + Math.round(10512 * L ** 2), Energy: 1e6 + Math.round(5000 * 2 ** L), rp: 5e7 + Math.round(1e7 * 2 ** L) }) },
    ];
    function brainBoostActive() {
        const b = GM_getValue('sa-brain-boost', null);
        return !!(b && b.until && new Date(b.until) > new Date());
    }
    // "Brain boost active. Time left: 4 days, 14 hours, 55 minutes, and 26 seconds"
    function readBrainBoost() {
        const t = pageText();
        if (!/brain\s*boost\s*active/i.test(t)) return { active: false };
        const part = (u) => { const m = t.match(new RegExp('(\\d+)\\s*' + u)); return m ? +m[1] : 0; };
        const ms = ((part('day') * 24 + part('hour')) * 60 + part('minute')) * 60e3 + part('second') * 1e3;
        return { active: true, until: new Date(Date.now() + ms).toISOString() };
    }
    function bestCardPct(test) {
        let b = null;
        (GM_getValue('sa-cards', null)?.cards || []).forEach(c => (c.effects || []).forEach(e => {
            const st = String(e.stat).toLowerCase();
            if (e.unit === '%' && test(st) && (!b || Math.abs(e.value) > Math.abs(b.value))) b = { value: Math.abs(e.value), card: c.name, days: c.days, stat: e.stat };
        }));
        return b;
    }
    function rcSlot() { const ids = planetIds(); const s = GM_getValue('sa-rc-slot', null); return ids.includes(s) ? s : ids[0] || 'A'; }
    // Shared research settings (same as the Research calculator: its planet, toggles and cards)
    function rcContext() {
        const slot = rcSlot();
        const sci = (getSlot(slot)?.units || []).filter(u => /scientist/i.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
        const comTech = researchLevel(/^computer\s*technology$/i) || 0;
        const use = Object.assign({ brain: null, speed: true, req: true }, GM_getValue('sa-rc-use', {}) || {});
        const brain = use.brain == null ? brainBoostActive() : !!use.brain;
        const reqCard = use.req ? bestCardPct(st => /research/.test(st) && /require|skill|cost/.test(st)) : null;
        const spdCard = use.speed ? bestCardPct(st => /research/.test(st) && /speed|point/.test(st)) : null;
        const rppt = Math.sqrt(sci) * (1 + comTech * 0.05) * (1 + (spdCard ? spdCard.value / 100 : 0)) * (brain ? 2 : 1);
        const mult = (brain ? 0.75 : 1) * (1 - (reqCard ? reqCard.value / 100 : 0));
        // Energy: storage of that planet; extra storage is bought as SSB (100 storage each, × multipliers)
        let en = null; try { en = enStorageFor(slot); } catch (e) {}
        const enCap = en ? en.total : 0;
        const perSSB = en ? 100 * en.core * en.et * en.card : 100;
        const ssb = marketRes(/\bssb\b|super\s*science/i);
        const ssbPrice = ssb ? (ssb.buyPrice ?? ssb.sellPrice ?? null) : null;
        const energyCost = (need) => {
            if (!(need > enCap)) return { ssb: 0, credits: 0 };
            const n = Math.ceil((need - enCap) / perSSB);
            return { ssb: n, credits: ssbPrice != null ? n * ssbPrice : null };
        };
        return { slot, sci, comTech, brain, reqCard, spdCard, rppt, mult, enCap, perSSB, ssbPrice, energyCost };
    }
    // Costs of buying research level L (after brain boost and requirement card)
    function rcLevelCost(name, L, ctx) {
        const g = RC_GROUPS.find(x => x.names.some(n => n.toLowerCase() === name.toLowerCase()));
        if (!g) return null;
        const c = g.f(L), m = ctx.mult;
        return { Credits: c.Credits * m, Iron: (c.Iron || 0) * m, Gold: (c.Gold || 0) * m, Tritium: (c.Tritium || 0) * m,
                 Energy: (c.Energy || 0) * m, turns: ctx.rppt > 0 ? c.rp * m / ctx.rppt : Infinity };
    }

    // Research that raises income, as Best Spend options (research is empire-wide: gains add up over planets)
    function researchOptions(notes, use) {
        const opts = [], ctx = rcContext();
        let tv = null;
        try { const vp = voPlan(); if (vp && !vp.error && vp.turns > 0) tv = vp.week / 7 / vp.turns; } catch (e) {}
        if (!(ctx.rppt > 0)) { notes.push('Research: no scientists saved on the Research calculator\'s planet, so research isn\'t compared'); return opts; }
        const ids = planetIds();
        const models = ids.map(id => { let cg = null, rg = null; try { cg = cgModel(id); } catch (e) {} try { rg = rgModel(id); } catch (e) {}
            const units = getSlot(id)?.units || []; const cnt = (re) => units.filter(u => re.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
            return { id, cg, rg, wpt: workersPerTurn(id), ind: cnt(/industrial/i), com: cnt(/commercial/i) }; });
        // gain(level) → credits/day vs now; extra workers(level) → training turns
        const defs = [
            { name: 'Economy', use: 'cg', gain: (L0, E) => models.reduce((t, m) => t + (m.cg ? m.com * m.cg.perWorkerDay.commercial * ((1 + 0.02 * E) / (1 + 0.02 * L0) - 1) : 0), 0) },
            ...[['Industrialism', 'industrial', /industrial\s*area/i], ['Commercialism', 'commercial', /commercial\s*area/i]].map(([n, k, re]) => ({ name: n, use: 'cg',
                workers: (L0, E) => models.reduce((t, m) => { const a = areasOf(m.id).find(x => re.test(cleanName(x.name)));
                    return t + (a ? 2000 * Math.pow(Math.round(a.value) + 1, 1.5) * 0.02 * (E - L0) : 0); }, 0),
                gain(L0, E) { return models.reduce((t, m) => { const a = areasOf(m.id).find(x => re.test(cleanName(x.name)));
                    return t + (a && m.cg ? 2000 * Math.pow(Math.round(a.value) + 1, 1.5) * 0.02 * (E - L0) * m.cg.perWorkerDay[k] : 0); }, 0); } })),
            ...[['Digging', 'digging'], ['Iron mining', 'ironMining'], ['Gold mining', 'goldMining']].map(([n, k]) => ({ name: n, use: 'rg',
                gain: (L0, E) => models.reduce((t, m) => t + (m.rg && m.rg.valWith ? m.rg.valWith({ [k]: E }) - m.rg.perDay : 0), 0) })),
        ];
        const m = getMarket();
        defs.forEach(d => {
            if (!use[d.use]) return;
            const L0 = researchLevel(new RegExp('^' + d.name.replace(/\s+/g, '\\s*') + '$', 'i'));
            if (L0 == null) return;
            const sum = (E, f) => { let t = 0; for (let L = L0 + 1; L <= E; L++) t += f(rcLevelCost(d.name, L, ctx)); return t; };
            opts.push({
                slot: null, label: `Research · ${d.name}`, short: d.name, L0, what: 'research', research: true,
                cum: (E) => {
                    if (E <= L0) return { credits: 0, mats: {} };
                    if (E > L0 + 40) return { credits: Infinity, mats: {} };   // keep the search short
                    let maxE = 0; for (let L = L0 + 1; L <= E; L++) maxE = Math.max(maxE, rcLevelCost(d.name, L, ctx).Energy);
                    const ec = ctx.energyCost(maxE);
                    return { credits: sum(E, c => c.Credits) + (ec.credits || 0), energySSB: ec.ssb,
                             mats: { Iron: sum(E, c => c.Iron), Gold: sum(E, c => c.Gold), Tritium: sum(E, c => c.Tritium) } };
                },
                gain: (E) => d.gain(L0, E),
                hasGain: true,
                rTurns: (E) => sum(E, c => c.turns),
                trainTurns: (E) => sum(E, c => c.turns) + (d.workers ? d.workers(L0, E) / Math.max(1, models.find(x => x.wpt)?.wpt || Infinity) : 0),
                trainCost: tv != null ? (E) => (sum(E, c => c.turns) + (d.workers ? d.workers(L0, E) / Math.max(1, models.find(x => x.wpt)?.wpt || Infinity) : 0)) * tv : () => 0,
            });
        });
        if (ctx.ssbPrice == null) notes.push('Research: no SSB market price, so extra energy storage isn\'t priced');
        return opts;
    }
    function renderResearchCalc() {
        const out = document.getElementById('sa-rc-result'), sel = document.getElementById('sa-rc-slot');
        if (!out) return;
        const slot = rcSlot();
        sel.innerHTML = planetIds().map(id => `<option value="${id}" ${id === slot ? 'selected' : ''}>${escapeHtml(shortName(id))}</option>`).join('');
        const sci = (getSlot(slot)?.units || []).filter(u => /scientist/i.test(u.name)).reduce((s, u) => s + (u.count || 0), 0);
        const comTech = researchLevel(/^computer\s*technology$/i) || 0;
        const use = Object.assign({ brain: null, speed: true, req: true }, GM_getValue('sa-rc-use', {}) || {});
        const brainSeen = brainBoostActive();
        const brain = use.brain == null ? brainSeen : !!use.brain;
        const reqBest = bestCardPct(st => /research/.test(st) && /require|skill|cost/.test(st));
        const spdBest = bestCardPct(st => /research/.test(st) && /speed|point/.test(st));
        const reqCard = use.req ? reqBest : null, spdCard = use.speed ? spdBest : null;
        const tg = document.getElementById('sa-rc-toggles');
        if (tg) {
            const box = (k, on, label, dis) => `<label class="sa-check"><input type="checkbox" data-rc="${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}/><span>${label}</span></label>`;
            tg.innerHTML = box('brain', brain, `Brain boost <span style="color:var(--muted)">(costs ×0.75, research ×2${use.brain == null ? ` · ${brainSeen ? 'active on the Research page' : 'not active'}` : ' · set by you'})</span>`) +
                box('speed', !!spdCard, `Research speed card <span style="color:var(--muted)">${spdBest ? `+${spdBest.value}% · ${escapeHtml(spdBest.stat)}` : '(none saved)'}</span>`, !spdBest) +
                box('req', !!reqCard, `Requirement card <span style="color:var(--muted)">${reqBest ? `−${reqBest.value}% · ${escapeHtml(reqBest.stat)}` : '(none saved)'}</span>`, !reqBest);
            tg.querySelectorAll('input[data-rc]').forEach(cb => cb.addEventListener('change', () => {
                const cur = Object.assign({ brain: null, speed: true, req: true }, GM_getValue('sa-rc-use', {}) || {});
                cur[cb.dataset.rc] = cb.checked; GM_setValue('sa-rc-use', cur); renderResearchCalc();
            }));
        }
        const rppt = Math.sqrt(sci) * (1 + comTech * 0.05) * (1 + (spdCard ? spdCard.value / 100 : 0)) * (brain ? 2 : 1);
        const mult = (brain ? 0.75 : 1) * (1 - (reqCard ? reqCard.value / 100 : 0));
        const market = getMarket();
        const buy = (n) => {   // buy price, else sell price; name may carry extra words ("Iron ore")
            const r = (market?.resources || []).find(x => x.name.toLowerCase() === n.toLowerCase())
                || (market?.resources || []).find(x => new RegExp('\\b' + n + '\\b', 'i').test(x.name));
            return r ? (r.buyPrice ?? r.sellPrice ?? null) : null;
        };
        // Average credits one turn makes, from the Value Optimizer plan (whole week)
        const rcx = rcContext();
        const enCap = rcx.enCap;
        let turnValue = null;
        try { const vp = voPlan(); if (vp && !vp.error && vp.turns > 0) turnValue = vp.week / 7 / vp.turns; } catch (e) {}
        const rows = [], unknown = [];
        RC_GROUPS.forEach(g => g.names.forEach(n => {
            const cur = researchLevel(new RegExp('^' + n.replace(/\s+/g, '\\s*') + '$', 'i'));
            if (cur == null) { unknown.push(n); return; }
            const L = (cur ?? 0) + 1;
            const c = g.f(L), cost = {};
            ['Credits', 'Iron', 'Gold', 'Tritium', 'Energy'].forEach(k => { if (c[k] != null) cost[k] = c[k] * mult; });
            const turns = rppt > 0 ? c.rp * mult / rppt : null;
            // Everything in credits: resources at buy price, turns at the average Value Optimizer
            // turn value, energy at 0 until there's an energy calculator
            const ec = cost.Energy != null ? rcx.energyCost(cost.Energy) : { ssb: 0, credits: 0 };
            const cv = { Credits: cost.Credits, Energy: cost.Energy != null ? ec.credits : null };
            let priced = true;
            ['Iron', 'Gold', 'Tritium'].forEach(k => { if (cost[k] != null) { const p = buy(k); if (p != null) cv[k] = cost[k] * p; else { cv[k] = null; priced = false; } } });
            cv.Turns = turns != null && turnValue != null ? turns * turnValue : null;
            const value = ['Credits', 'Iron', 'Gold', 'Tritium', 'Energy', 'Turns'].reduce((t, k) => t + (cv[k] || 0), 0);
            rows.push({ n, cur, L, cost, turns, cv, value, ssb: ec.ssb, priced: priced && (turns == null || turnValue != null) && cv.Energy !== null });
        }));
        rows.sort((a, b) => a.value - b.value);
        // Saved research with no formula in the sheet (e.g. the Optimization research)
        const known = new Set(RC_GROUPS.flatMap(g => g.names).map(n => n.toLowerCase()));
        const noFormula = (getRSlot('A')?.items || []).filter(i => !isUnitRow(i.name))
            .map(i => { const c = levelFrom(i).value; return { n: cleanName(i.name), cur: c, L: c != null ? c + 1 : null }; }).filter(x => x.n && !known.has(x.n.toLowerCase()));
        const f = (v) => v == null ? '<span style="color:var(--dim)">—</span>' : escapeHtml(fmt(v));
        const q = '<span style="color:var(--dim)">???</span>';
        const head = `<pre style="margin:0 0 8px; white-space:pre-wrap; font:inherit">${escapeHtml([
            `Scientists       ${sci ? fmt(sci) : '0 (scan Train Units)'}`,
            `Computer Tech    ${comTech}`,
            `Brain boost      ${brain ? 'on (costs ×0.75, research ×2)' : 'off'}`,
            `Speed card       ${spdCard ? '+' + spdCard.value + '%' : '—'}`,
            `Requirement card ${reqCard ? '−' + reqCard.value + '%' : '—'}`,
            `= ${fmt(rppt)} research points per turn`,
            `Energy storage   ${enCap > 0 ? fmt(enCap) + ' (Energy calculator)' : 'unknown'}`,
            `Turn value       ${turnValue != null ? fmt(turnValue) + ' credits (Value Optimizer average)' : 'unknown: fill Value Optimizer'}`].join('\n'))}</pre>`;
        const tr = (r) => `<tr><td class="sa-trap-name" title="${escapeHtml(r.n)}">${escapeHtml(r.n)}</td>
            <td class="sa-num">${r.cur ?? '?'}→${r.cur != null ? r.L : '?'}</td>` + (r.cost
            ? ['Credits', 'Iron', 'Gold', 'Tritium', 'Energy', 'Turns'].map(k => {
                const amt = k === 'Turns' ? r.turns : r.cost[k], v = r.cv[k];
                if (amt == null) return `<td class="sa-num">${f(null)}</td>`;
                if (k === 'Energy') {
                    const over = enCap > 0 && amt > enCap;
                    return `<td class="sa-num" title="${escapeHtml(fmt(amt) + ' energy · storage ' + fmt(enCap) + (r.ssb ? ` · needs ${fmt(r.ssb)} more SSB` : ''))}">${v == null ? '<span style="color:var(--dim)">?</span>' : f(v)}${over ? ' <span style="color:var(--neg)">⚡</span>' : ''}</td>`;
                }
                return `<td class="sa-num" title="${escapeHtml(fmt(amt) + ' ' + k.toLowerCase())}">${v != null ? f(v) : '<span style="color:var(--dim)">?</span>'}</td>`;
              }).join('') + `<td class="sa-num" title="${r.priced ? '' : 'some parts have no price'}"><b>${f(r.value)}</b>${r.priced ? '' : '*'}</td>`
            : `<td class="sa-num">${q}</td>`.repeat(7)) + '</tr>';
        const all = [...rows, ...unknown.map(n => ({ n, cur: null })), ...noFormula];
        const overN = rows.filter(r => r.cost.Energy != null && enCap > 0 && r.cost.Energy > enCap).length;
        out.style.whiteSpace = 'normal';
        out.innerHTML = head + `<div class="sa-label">Next level (cheapest first)</div>
            <div style="overflow-x:auto"><table class="sa-unit-table sa-traps-table">
            <thead><tr><th>Research</th><th>Level</th><th>Credits</th><th>Iron</th><th>Gold</th><th>Tritium</th><th>Energy</th><th>Turns</th><th>Total</th></tr></thead>
            <tbody>${all.map(tr).join('')}</tbody></table></div>
            <div class="sa-slot-meta" style="margin-top:4px">Every column is in credits (hover a cell for the amount): iron, gold and tritium at market buy price,
            turns × average turn value from Value Optimizer, energy = cost of the extra SSB storage needed when a level needs more energy than the planet stores (⚡; SSB at market buy price, 100 storage each × your multipliers${overN ? `; ${overN} research need it` : ''}). Total = all of them${rows.some(r => !r.priced) ? '; * = some parts have no price' : ''}.
            ??? = no formula yet${unknown.length ? ', or level not saved (scan the Research page)' : ''}.</div>`;
    }
    function renderValueOpt() {
        const out = document.getElementById('sa-vo-result');
        if (!out || !sbReady) return;
        const vp = voPlan();
        if (vp.error) { out.textContent = vp.error; return; }
        const { A, typed, turns, ranked, pd, rd, week, notes, unitInfo } = vp;
        const n0 = (v) => Math.round(v).toLocaleString();
        const L = (l, v) => l.padEnd(30) + v;
        const bestPrint = ranked.find(m => m.kind === 'print'), bestRes = ranked.find(m => m.kind === 'res');
        const lines = [
            L('Turns to spend per day', n0(turns) + (typed != null ? ' (typed)' : ' (Tick Generator, shared by all planets)')),
            '',
            'VALUE PER TURN (best first)',
            ...ranked.map((m, i) => `${i === 0 ? '★' : ' '} ${m.label.padEnd(34)}${fmt(m.perTurn)}`),
            '',
            'BEST PLAN · print day',
            ...pd.steps.map((st, i) => `${i + 1}. ${st.m.label}: ${n0(st.n)} turns → ${fmt(st.value)}`),
            L('= Credits per print day', fmt(pd.total)),
            '',
            ...(A.printDays < 7 ? ['BEST PLAN · non-print day',
                ...rd.steps.map((st, i) => `${i + 1}. ${st.m.label}: ${n0(st.n)} turns → ${fmt(st.value)}`),
                L('= Credits per day', fmt(rd.total)), ''] : []),
            L('PER WEEK (best plan)', fmt(week)),
            '',
            ...(() => {   // daily sell limits → most turns worth spending on selling each unit
                const out = [];
                Object.entries(unitInfo || {}).forEach(([g, u]) => {
                    if (!u.priced) return;
                    const ms = ranked.filter(m => m.kind === 'units' && m.group === g);
                    if (!ms.length) return;
                    const best = ms[0], maxT = u.limit == null ? null : u.cap / best.units;
                    const used = pd.steps.filter(st => st.m.group === g).reduce((t, st) => t + st.n, 0);
                    out.push(`${u.label}: limit ${u.limit == null ? '∞' : fmt(u.limit) + '/day'} · passive ${fmt(u.passive)}/day` +
                        (u.limit == null ? '' : ` → ${fmt(u.cap)} left = max ${n0(maxT)} turns (${best.planet})`) +
                        ` · plan uses ${n0(used)} turns`);
                });
                return out.length ? ['SELL LIMITS (Unit Value)', ...out, ''] : [];
            })(),
            'COMPARED WITH',
            ...(bestPrint ? [L('  Only printing (best planet)', fmt(Math.min(turns, A.turnsPerDay) * bestPrint.perTurn * A.printDays) + ' /week')] : []),
            ...(bestRes ? [L('  Only resources (best planet)', fmt(turns * bestRes.perTurn * 7) + ' /week')] : []),
            '',
            `Turns are pooled: spend them wherever they earn most. Printing is capped at ${A.turnsPerDay.toLocaleString()} turns per print day in total, ${A.printDays} days a week (Credit Gen assumptions); turns past the cap go to the best resource planet.`,
            ...(notes.length ? ['', ...notes] : []),
        ];
        out.textContent = lines.join('\n');
    }
    function renderOptimizer() {
        const out = document.getElementById('sa-opt-result');
        if (!out || !sbReady) return;
        const ids = planetIds();
        if (!ids.length) { out.textContent = 'Save at least one planet first (Facilities, Units, Inventory).'; out.classList.add('sa-warn'); return; }
        out.classList.remove('sa-warn');
        const notes = [];
        const opts = [...ids.flatMap(id => spendOptions(id, { cg: true, rg: true, tick: true, area: true }, notes)),
                      ...researchOptions(notes, { cg: true, rg: true })];
        const cap = capitalFor({});
        const plan = planSpend(opts, cap.available);
        const mats = Object.keys(plan.used).filter(n => plan.used[n] > 0);
        const f = (v) => v == null ? '—' : escapeHtml(fmt(v));
        const dd = (x) => Number.isFinite(x) && x > 0 ? (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString()) + ' d' : '—';
        const H = [];
        // Capital
        H.push(`<div class="sa-label" style="margin:0 0 4px">Capital</div><table class="sa-unit-table sa-stmt"><tbody>
            <tr><td>Credits on hand</td><td class="sa-num">${f(cap.credits)}</td></tr>
            <tr><td>+ resources sold${cap.sold.length ? ` <span style="color:var(--muted)">(${escapeHtml(cap.sold.join(', '))})</span>` : ''}</td><td class="sa-num">${f(cap.sellValue)}</td></tr>
            ${cap.bd.on ? `<tr><td>+ brains / diamonds / SSB</td><td class="sa-num">${cap.bd.missing ? 'not scanned' : f(cap.bd.value)}</td></tr>` : ''}
            <tr class="sa-stmt-total"><td>= Capital</td><td class="sa-num">${f(cap.capital)}</td></tr>
            ${cap.amt && cap.amt.value != null ? `<tr><td>Set amount${cap.available > cap.capital ? ' (what-if)' : ''}</td><td class="sa-num">${f(cap.available)}</td></tr>`
              : cap.pct < 100 ? `<tr><td>× ${cap.pct}% to spend</td><td class="sa-num">${f(cap.available)}</td></tr>` : ''}
            </tbody></table>${cap.unpriced.length ? `<div class="sa-slot-meta">No market price for: ${escapeHtml(cap.unpriced.join(', '))}</div>` : ''}`);
        // Plan
        H.push(`<div class="sa-label" style="margin:10px 0 4px">Best split (most credits per day)</div>`);
        if (!plan.rows.length) H.push('<div class="sa-empty">Nothing affordable that adds income.</div>');
        else {
            const gainOf = (r) => r.o.what === 'turns' ? `+${f(r.o.turnsGain(r.E))} turns/day`
                : r.o.research ? `Lv ${r.o.L0} → ${r.E}${r.o.cum(r.E).energySSB ? ` · +${f(r.o.cum(r.E).energySSB)} SSB` : ''}`
                : `+${f(r.o.sizeGain(r.E))} ${escapeHtml(r.o.what || 'size')}`;
            H.push(`<div style="overflow-x:auto"><table class="sa-unit-table sa-traps-table">
                <thead><tr><th>Upgrade</th><th>Levels</th><th>Spend</th><th>Adds</th><th title="Training turns for new workers, plus research turns">Turns</th><th>Credits/day</th><th>Payback</th></tr></thead>
                <tbody>${plan.rows.map(r => `<tr>
                    <td class="sa-trap-name" title="${escapeHtml(r.o.label)}">${escapeHtml(r.o.label)}</td>
                    <td class="sa-num" title="${r.o.L0.toLocaleString()} → ${r.E.toLocaleString()}">+${r.levels.toLocaleString()}</td>
                    <td class="sa-num">${f(r.spent)}</td>
                    <td class="sa-num">${gainOf(r)}</td>
                    <td class="sa-num" title="${r.tCost > 0 ? 'worth ' + escapeHtml(fmt(r.tCost)) : ''}">${r.tTurns > 0 ? f(r.tTurns) : '—'}</td>
                    <td class="sa-num sa-diff-pos">${r.o.hasGain ? '+' + f(r.gain) : '—'}</td>
                    <td class="sa-num">${r.o.hasGain ? dd((r.spent + (r.tCost || 0)) / r.gain) : '—'}</td></tr>`).join('')}
                <tr class="sa-stmt-total"><td>Total</td><td></td><td class="sa-num">${f(plan.spent)}</td><td></td>
                    <td class="sa-num" title="${plan.tCost > 0 ? 'worth ' + escapeHtml(fmt(plan.tCost)) : ''}">${plan.tTurns > 0 ? f(plan.tTurns) : '—'}</td>
                    <td class="sa-num sa-diff-pos">+${f(plan.gain)}</td><td class="sa-num">${plan.gain > 0 ? dd((plan.spent + plan.tCost) / plan.gain) : '—'}</td></tr>
                </tbody></table></div>`);
            const meta = [];
            if (plan.left > 0) meta.push(`Left over: ${f(plan.left)}`);
            if (plan.tCost > 0) meta.push(`Training turns are worth ${f(plan.tCost)} at the Value Optimizer average turn (hover for each)`);
            if (mats.length) meta.push('Materials used: ' + mats.map(n => `${escapeHtml(n)} ${f(plan.used[n])}`).join(', '));
            meta.forEach(m => H.push(`<div class="sa-slot-meta" style="margin-top:3px">${m}</div>`));
        }
        // Options and notes
        H.push(`<div class="sa-label" style="margin:10px 0 4px">Options looked at</div><div class="sa-slot-meta">${
            opts.map(o => escapeHtml(o.label) + (o.hasGain ? '' : ' <span style="color:var(--dim)">(no gain model)</span>')).join(' · ') || 'none'}</div>`);
        if (notes.length) H.push(`<div class="sa-slot-meta" style="margin-top:6px; color:var(--warn, #e0b050)">${notes.map(escapeHtml).join('<br>')}</div>`);
        H.push(`<div class="sa-slot-meta" style="margin-top:6px">Research options (Economy, Industrialism, Commercialism, Digging, Iron and Gold mining) cost credits, resources,
            research turns and any extra energy storage (SSB), like the Research calculator; their gain adds up over all planets.<br>
            Assumes area size = worker room, filled with newly trained workers. Training costs turns
            (Training: Soldiers &amp; workers per turn), valued at the Value Optimizer average turn; slices are ranked by credits/day per
            (credits + training turn value), and payback includes it.</div>`);
        out.style.whiteSpace = 'normal';
        out.innerHTML = H.join('');
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
    // Which /bank tab is open? The Central bank tab shows galaxy-wide stats.
    function bankView() {
        if (pageKey !== 'bank') return null;
        const root = document.querySelector('main') || document.body;
        const t = (root.innerText || root.textContent || '');
        if (findTrapsTable()) return 'traps';
        return /galaxy\s*fee|volatility|income\s*ratio|player\s*investments/i.test(t) ? 'central' : 'player';
    }
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
        const sx = view.querySelector('.sa-traps-table')?.parentElement?.scrollLeft || 0;
        view.innerHTML = `<button class="sa-btn sa-popout-btn" style="width:100%; margin:0 0 8px">⧉ Open everything in a new window</button>` + bankHtml(false);
        const tw = view.querySelector('.sa-traps-table')?.parentElement; if (tw) tw.scrollLeft = sx;
        bindInvest(view);
        fetchInvestments(false);   // refreshes in the background when older than 10 minutes
    }
    function bankHtml(popout) {
        const cb = centralBankLoad(), pb = GM_getValue('sa-player-bank', null);
        const bal = bankLoad(), gf = galaxyFeeLoad();
        const table = (title, fields) => `<table class="sa-unit-table">
            <thead><tr><th>${title}</th><th style="text-align:right">Value</th></tr></thead>
            <tbody>${fields.map(f => `<tr>
                <td>${escapeHtml(f.label)}</td>
                <td class="sa-num" title="${escapeHtml(f.value != null && !f.isPct ? f.value.toLocaleString() : '')}">${
                    escapeHtml(f.isPct || f.value == null ? f.display : fmt(f.value))}</td></tr>`).join('')}</tbody></table>`;
        const meta = (d) => d ? `<div class="sa-slot-meta" style="margin:4px 0 12px">Read ${new Date(d.savedAt).toLocaleString()}</div>` : '';
        return `
            <div class="sa-label">Your bank</div>
            <div class="sa-recommend" style="margin-bottom:6px">${bal ? `Balance: ${escapeHtml(fmt(bal.value))}`
                : bankStale() ? 'Balance: please re-scan your own bank tab (the old reading may have come from the Central bank)'
                : 'Balance: not read yet. Open /bank (your bank tab) and Scan.'}</div>
            ${pb && pb.fields.length ? table('Your bank', pb.fields) : ''}
            ${meta(bal || pb)}
            <div class="sa-label">Central bank</div>
            <div class="sa-recommend" style="margin-bottom:6px">${gf ? `Galaxy fee (spend turns): ${escapeHtml(gf.display)}`
                : 'Galaxy fee: not read yet. Open /bank → Central bank and Scan.'}</div>
            ${cb && cb.fields.length ? table('Central bank', cb.fields) : '<div class="sa-empty">No Central bank fields read yet.</div>'}
            ${meta(cb)}
            ${investSection(popout)}
            <div class="sa-slot-meta">Only your bank's balance counts toward your capital.</div>`;
    }

    // ---------- Investments API (/openapi/investments, same site, no sign-in) ----------
    // Each investment: name, total_money (all equity), turn_interest (share added per turn).
    let investFetching = false, investTried = 0;
    function investApiLoad() { return GM_getValue('sa-invest-api', null); }
    async function fetchInvestments(force) {
        const cur = investApiLoad();
        if (investFetching || (!force && cur && Date.now() - new Date(cur.savedAt) < 10 * 60e3)) return cur;
        if (!force && Date.now() - investTried < 60e3) return cur;   // don't hammer a failing API
        investFetching = true; investTried = Date.now();
        try {
            const r = await fetch('/openapi/investments', { credentials: 'same-origin' });
            const j = await r.json();
            const list = Array.isArray(j) ? j : (j.investments || j.data || []);
            const items = list.map(x => ({ id: x._id, name: String(x.name || '').trim(),
                total: Number(x.total_money) || 0, turnInterest: Number(x.turn_interest) || 0,
                points: Number(x.total_points) || 0, limitHold: x.limit_hold ?? null, desc: x.description || '',
                price: x.last_values && x.last_values.interval_1 != null ? Number(x.last_values.interval_1) : null,
                price8: x.last_values && x.last_values.interval_8 != null ? Number(x.last_values.interval_8) : null,
                unpaidTax: Number(x.unpaid_tax) || 0 }));
            GM_setValue('sa-invest-api', { savedAt: new Date().toISOString(), items });
        } catch (e) {
            console.warn('[SharkBot] investments API failed', e);
        } finally { investFetching = false; }
        renderBank();
        return investApiLoad();
    }
    function investTurnsPerDay() { return parseNumber(GM_getValue('sa-invest-tpd', '1440')) || 1440; }
    // API joined with your TRAPs scan. Several TRAPs share a name start ("serenity managed …"),
    // so: exact name first; a cut-off name ("…") matches by prefix, and the one whose price is
    // closest to the TRAPs price wins.
    function investRows() {
        const api = investApiLoad(), traps = trapsLoad();
        const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
        const stem = (s) => norm(s).replace(/(…|\.\.\.)$/, '').trim();
        const tpd = investTurnsPerDay();
        const left = (api ? api.items : []).slice();
        const take = (t) => {
            let c = left.filter(a => norm(a.name) === norm(t.name));
            if (!c.length) c = left.filter(a => norm(a.name).startsWith(stem(t.name)));
            if (c.length > 1 && t.price != null)
                c.sort((a, b) => Math.abs(Math.log((a.price || 1) / t.price)) - Math.abs(Math.log((b.price || 1) / t.price)));
            const a = c[0];
            if (a) left.splice(left.indexOf(a), 1);
            return a;
        };
        // Managed investments: your amount is what you typed in (what you put in); unmanaged:
        // the value of your shares from the TRAPs page. Default = managed if its name or
        // description says "managed".
        const mset = GM_getValue('sa-invest-managed', {}) || {};
        const row = (t, a) => {
            const nm = a ? a.name : t.name, ms = mset[nm] || {};
            const managed = ms.managed != null ? !!ms.managed : /managed/i.test(nm + ' ' + (a ? a.desc : ''));
            const shareVal = t ? t.invested || 0 : 0, typedAmt = parseNumber(ms.amount);
            const mine = managed ? (typedAmt ?? shareVal) : shareVal;
            const total = a ? a.total : null, rate = a ? a.turnInterest : null;
            const daily = a ? total * rate * tpd : null;
            const share = a && total > 0 ? mine / total : null;
            // Unmanaged: what you earn is the share price moving (volatility × equity change), so use
            // the price change over a day: the TRAPs 24h %, else the API's price now vs ~a day ago
            const d24 = t && t.d24 != null ? t.d24 / 100 : (a && a.price && a.price8 ? a.price / a.price8 - 1 : null);
            const myDaily = managed ? (daily != null && share != null ? daily * share : null) : (d24 != null ? shareVal * d24 : null);
            return { name: nm, managed, typedAmt, shareVal, mine, share, total, rate, daily, myDaily, dayChange: d24,
                     d24: t ? t.d24 : null, d7: t ? t.d7 : null, d30: t ? t.d30 : null,
                     price: t && t.price != null ? t.price : a ? a.price : null, desc: a ? a.desc : '', matched: !!(t && a) };
        };
        // Biggest holdings claim their match first
        const rows = trapsSorted(traps?.items || []).map(t => row(t, take(t)));
        left.forEach(a => rows.push(row(null, a)));
        return rows.sort((a, b) => b.mine - a.mine || (b.daily ?? -1) - (a.daily ?? -1));
    }
    function investSection(popout) {
        const api = investApiLoad(), rows = investRows(), tpd = investTurnsPerDay(), td = trapsLoad();
        const mineOnly = !popout && GM_getValue('sa-traps-mine', false);
        const mine = rows.filter(r => r.mine > 0), shown = mineOnly ? mine : rows;
        const myDaily = mine.reduce((s, r) => s + (r.myDaily || 0), 0), myTotal = mine.reduce((s, r) => s + r.mine, 0);
        const f = (v) => v == null ? '—' : escapeHtml(fmt(v));
        const pc = (v, d = 2) => v == null ? '—' : (v * 100).toFixed(d) + '%';
        const chg = (v) => v == null ? '<td class="sa-num">—</td>'
            : `<td class="sa-num ${v > 0 ? 'sa-diff-pos' : v < 0 ? 'sa-diff-neg' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
        return `
            <div class="sa-label">Investments (TRAPs)</div>
            <div class="sa-recommend" style="margin-bottom:6px">Yours: ${mine.length} of ${rows.length} · ${f(myTotal)} invested<br>Earning: <b>${myDaily < 0 ? '−' + f(-myDaily) : '+' + f(myDaily)}/day</b>${myTotal ? ` (${pc(myDaily / myTotal)} a day)` : ''} · interest on managed, price change on unmanaged</div>
            ${popout ? '' : `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:11px; margin-bottom:6px">
                <span>Turns/day</span><input id="sa-invest-tpd" value="${escapeHtml(String(GM_getValue('sa-invest-tpd', '1440')))}" style="width:60px" />
                <button class="sa-btn" id="sa-invest-refresh" style="margin:0">${investFetching ? 'Loading…' : '↻ API'}</button>
                <label class="sa-check" style="margin:0"><input type="checkbox" id="sa-traps-mine" ${mineOnly ? 'checked' : ''} /><span>Only mine</span></label>
            </div>`}
            ${shown.length ? `<div style="overflow-x:auto"><table class="sa-unit-table sa-traps-table">
                <thead><tr><th>#</th><th>Name</th><th title="Managed: uses the amount you type in. Unmanaged: uses your share value from the TRAPs page.">Managed</th><th>You</th><th>Your %</th><th>Total</th>
                    <th>24h</th><th>7d</th><th>30d</th><th>Price</th><th>/turn</th><th>Daily (all)</th><th>Daily (you)</th></tr></thead>
                <tbody>${shown.map((r, i) => `<tr>
                    <td style="color:var(--muted)">${i + 1}</td>
                    <td class="sa-trap-name" title="${escapeHtml(r.name + (r.desc ? '\n' + r.desc : ''))}">${escapeHtml(r.name)}</td>
                    <td style="text-align:center">${popout ? (r.managed ? '✓' : '') : `<input type="checkbox" class="sa-inv-managed" data-name="${escapeHtml(r.name)}" ${r.managed ? 'checked' : ''} />`}</td>
                    <td class="sa-num">${r.managed && !popout
                        ? `<input class="sa-inv-amt" data-name="${escapeHtml(r.name)}" value="${r.typedAmt != null ? escapeHtml(fmt(r.typedAmt)) : ''}" placeholder="${r.shareVal ? escapeHtml(fmt(r.shareVal)) : 'amount'}" title="Amount you invested (managed)" style="width:80px; text-align:right" />`
                        : r.mine ? f(r.mine) + (r.managed && r.typedAmt == null ? '*' : '') : '<span style="color:var(--dim)">0</span>'}</td>
                    <td class="sa-num">${r.mine && r.share != null ? pc(r.share, 2) : ''}</td>
                    <td class="sa-num">${f(r.total)}</td>
                    ${chg(r.d24)}${chg(r.d7)}${chg(r.d30)}
                    <td class="sa-num">${f(r.price)}</td>
                    <td class="sa-num">${r.rate == null ? '—' : pc(r.rate, 4)}</td>
                    <td class="sa-num">${f(r.daily)}</td>
                    <td class="sa-num ${r.myDaily > 0 ? 'sa-diff-pos' : r.myDaily < 0 ? 'sa-diff-neg' : ''}" title="${r.managed ? 'managed: interest × your share' : 'unmanaged: your share value × 24h price change'}">${r.mine ? (r.myDaily < 0 ? '−' + f(-r.myDaily) : f(r.myDaily)) : ''}</td></tr>`).join('')}</tbody></table></div>`
                : '<div class="sa-empty">No investment data yet. Scan /bank → TRAPs, and the API list loads by itself.</div>'}
            <div class="sa-slot-meta" style="margin:4px 0 12px">
                API ${api ? new Date(api.savedAt).toLocaleString() : 'not read yet'} · TRAPs scan ${td ? new Date(td.savedAt).toLocaleString() : 'none yet (open /bank → TRAPs, Scan)'}<br>
                Daily = total × interest per turn × ${tpd.toLocaleString()} turns. Yours = that × your share.<br>
                Managed ✓: "You" is the amount you type in (* = not typed yet, share value used); you earn interest × your share.
                Unmanaged: "You" is your share value from the TRAPs page; you earn the share price change (volatility × equity change), taken as your value × the 24h change.
            </div>`;
    }
    function bindInvest(view) {
        view.querySelector('#sa-invest-refresh')?.addEventListener('click', () => fetchInvestments(true));
        const inp = view.querySelector('#sa-invest-tpd');
        inp?.addEventListener('change', () => { GM_setValue('sa-invest-tpd', inp.value); renderBank(); renderStatements(); });
        view.querySelector('#sa-traps-mine')?.addEventListener('change', (e) => { GM_setValue('sa-traps-mine', e.target.checked); renderBank(); });
        view.querySelector('.sa-popout-btn')?.addEventListener('click', () => popOut('SharkBot · Bank', bankHtml(true)));
        const setM = (name, patch) => { const m = GM_getValue('sa-invest-managed', {}) || {}; m[name] = Object.assign({}, m[name], patch); GM_setValue('sa-invest-managed', m); };
        view.querySelectorAll('.sa-inv-managed').forEach(cb => cb.addEventListener('change', () => { setM(cb.dataset.name, { managed: cb.checked }); renderBank(); renderStatements(); }));
        view.querySelectorAll('.sa-inv-amt').forEach(inp => inp.addEventListener('change', () => { setM(inp.dataset.name, { amount: inp.value }); renderBank(); renderStatements(); }));
    }

    // Open a separate window with the same look as the panel
    function popOut(title, html) {
        const w = window.open('', 'sharkbot-' + title.replace(/\W+/g, '-'), 'width=1100,height=850');
        if (!w) { setStatus('Pop-out blocked: allow pop-ups for spacealpha.net'); return; }
        const bg = getComputedStyle(panel).backgroundColor;
        w.document.open();
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
            <style>${style.textContent}</style>
            <style>
                html, body { margin: 0; min-height: 100%; background: ${bg}; }
                #${PANEL_ID}.sa-popout { position: static !important; width: auto !important; max-width: none !important;
                    height: auto !important; max-height: none !important; resize: none !important; border: none !important;
                    box-shadow: none !important; border-radius: 0 !important; padding: 16px 20px; }
                #${PANEL_ID}.sa-popout table.sa-traps-table { font-size: 12px; }
                #${PANEL_ID}.sa-popout td.sa-trap-name { max-width: 340px !important; }
                #${PANEL_ID}.sa-popout .sa-popout-btn { display: none; }
            </style></head><body>
            <div id="${PANEL_ID}" class="sa-popout" style="${escapeHtml(panel.getAttribute('style') || '')}">
                <h2 style="margin:0 0 4px">${escapeHtml(title)}</h2>
                <div class="sa-slot-meta" style="margin-bottom:12px">Snapshot ${new Date().toLocaleString()} · SharkBot v${VERSION}</div>
                ${html}
            </div></body></html>`);
        w.document.close();
    }


    function storeGalaxyFee(fee) {
        GM_setValue('sa-galaxy-fee', { value: fee.value, display: fee.display, savedAt: new Date().toISOString() });
    }
    function galaxyFeeLoad() { return GM_getValue('sa-galaxy-fee', null); }

    function readBankBalance() {
        if (pageKey !== 'bank' || bankView() === 'central') return null;
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
        GM_setValue('sa-bank', { value: bal.value, display: bal.display, label: bal.label, view: 'player', savedAt: new Date().toISOString() });
    }
    // Before v2.4.2 the balance could be read off the Central bank tab by mistake, so an
    // old reading (no view mark) isn't trusted: visit your bank tab once to refresh it.
    function bankLoad() { const b = GM_getValue('sa-bank', null); return b && b.view === 'player' ? b : null; }
    function bankStale() { const b = GM_getValue('sa-bank', null); return !!(b && b.view !== 'player'); }

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
            view.innerHTML = (b0 ? `<div class="sa-recommend" style="margin-bottom:8px">Your bank balance: ${
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
            ? `<div class="sa-recommend" style="margin-bottom:8px">Your bank balance: ${
                escapeHtml(fmt(bank.value))}  <span style="color:var(--muted); font-size:10px">read ${
                escapeHtml(new Date(bank.savedAt).toLocaleString())}</span></div>`
            : `<div class="sa-slot-meta" style="margin-bottom:8px">Bank balance: ${bankStale()
                ? 're-scan your own bank tab on /bank (the old reading may have come from the Central bank).'
                : 'visit /bank (your bank tab) and Scan once.'}</div>`;
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

    // ---------- TRAPs (/bank → TRAPs tab) ----------
    // The game's investment list: Name | Invested | 24h | 7d | 30d | Price. The tab doesn't
    // change the page address, so open it and click Scan.
    function findTrapsTable() {
        const isHead = (cells) => {
            const t = cells.map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
            return t.includes('name') && t.includes('invested') && t.some(x => x.startsWith('price'));
        };
        for (const t of document.querySelectorAll('table')) {
            if (t.closest('#' + PANEL_ID)) continue;
            const rows = Array.from(t.querySelectorAll('tr'));
            const hi = rows.findIndex(r => isHead(Array.from(r.children)));
            if (hi >= 0) return { rows, hi };
        }
        // Not a <table>: find the "Invested" header and walk up to its row
        const leaf = Array.from(document.querySelectorAll('body *')).find(el =>
            !el.closest('#' + PANEL_ID) && !el.children.length && /^invested$/i.test((el.textContent || '').trim()));
        let row = leaf;
        while (row && !(row.children.length >= 4 && isHead(Array.from(row.children)))) row = row.parentElement;
        if (row && row.parentElement) {
            const rows = Array.from(row.parentElement.children);
            return { rows, hi: rows.indexOf(row) };
        }
        return null;
    }
    function readTraps() {
        const f = findTrapsTable();
        if (!f) return { items: [], error: 'TRAPs table not found: open the TRAPs tab on /bank, then Scan' };
        const head = Array.from(f.rows[f.hi].children).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
        const col = (re) => head.findIndex(h => re.test(h));
        const ci = { name: col(/^name/), inv: col(/^invested/), d24: col(/^24\s*h/), d7: col(/^7\s*d/), d30: col(/^30\s*d/), price: col(/^price/) };
        const pct = (cell) => {
            const m = cell && (cell.textContent || '').replace(/\s+/g, '').replace(/−/g, '-').match(/([+\-]?[\d.,]+)%/);
            return m ? parseFloat(m[1].replace(/,/g, '')) : null;
        };
        const items = [];
        f.rows.slice(f.hi + 1).forEach(r => {
            const c = Array.from(r.children);
            if (c.length < 3 || ci.name < 0 || !c[ci.name]) return;
            const nc = c[ci.name];
            const name = ((nc.getAttribute('title') || '').trim() || (nc.textContent || '')).replace(/\s+/g, ' ').trim();
            if (!name) return;
            const inv = ci.inv >= 0 && c[ci.inv] ? readAmountCell(c[ci.inv]) : { value: null, display: '' };
            const pr = ci.price >= 0 && c[ci.price] ? readAmountCell(c[ci.price]) : { value: null, display: '' };
            items.push({ name, invested: inv.value ?? 0, investedDisplay: inv.display,
                d24: pct(c[ci.d24]), d7: pct(c[ci.d7]), d30: pct(c[ci.d30]),
                price: pr.value, priceDisplay: pr.display });
        });
        const hideCb = Array.from(document.querySelectorAll('input[type=checkbox]')).find(cb =>
            !cb.closest('#' + PANEL_ID) && /abandoned/i.test(cb.parentElement?.textContent || ''));
        return { items, hideAbandoned: hideCb ? hideCb.checked : null };
    }
    function storeTraps(t) {
        GM_setValue('sa-traps', { savedAt: new Date().toISOString(), hideAbandoned: t.hideAbandoned, items: t.items });
    }
    function trapsLoad() { return GM_getValue('sa-traps', null); }
    // Biggest investment first; ties (usually 0) by best 24h change
    function trapsSorted(items) {
        return items.slice().sort((a, b) => (b.invested || 0) - (a.invested || 0) || (b.d24 ?? -1e9) - (a.d24 ?? -1e9));
    }
    function trapsTable(items, opts) {
        const pc = (v) => v == null ? '<td class="sa-num">—</td>'
            : `<td class="sa-num ${v > 0 ? 'sa-diff-pos' : v < 0 ? 'sa-diff-neg' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
        return `<table class="sa-unit-table sa-traps-table">
            <thead><tr><th>#</th><th>Name</th><th style="text-align:right">Invested</th>
                ${opts.short ? '' : '<th style="text-align:right">24h</th><th style="text-align:right">7d</th>'}
                <th style="text-align:right">30d</th>${opts.short ? '' : '<th style="text-align:right">Price</th>'}</tr></thead>
            <tbody>${items.map((t, i) => `<tr>
                <td style="color:var(--muted)">${i + 1}</td>
                <td class="sa-trap-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</td>
                <td class="sa-num" title="${t.invested ? t.invested.toLocaleString() : ''}">${t.invested ? escapeHtml(fmt(t.invested)) : '<span style="color:var(--dim)">0</span>'}</td>
                ${opts.short ? '' : pc(t.d24) + pc(t.d7)}${pc(t.d30)}
                ${opts.short ? '' : `<td class="sa-num" title="${t.price != null ? t.price.toLocaleString() : ''}">${t.price != null ? escapeHtml(fmt(t.price)) : '—'}</td>`}
            </tr>`).join('')}</tbody></table>`;
    }
    function trapsTotal(items) { return items.reduce((s, t) => s + (t.invested || 0), 0); }

    function renderTraps() {
        const view = document.getElementById('sa-traps-view');
        if (!view) return;
        const d = trapsLoad();
        if (!d || !d.items.length) {
            view.innerHTML = `<div class="sa-empty">Nothing saved yet. Open /bank → <b>TRAPs</b> and click <b>Scan</b>.</div>`;
            return;
        }
        const mineOnly = GM_getValue('sa-traps-mine', false);
        const all = trapsSorted(d.items), mine = all.filter(t => t.invested > 0);
        const shown = mineOnly ? mine : all;
        view.innerHTML = `
            <div class="sa-recommend" style="margin-bottom:6px">Invested in ${mine.length} of ${all.length} TRAPs · total ${escapeHtml(fmt(trapsTotal(all)))}</div>
            <label class="sa-check" style="margin-bottom:6px"><input type="checkbox" id="sa-traps-mine" ${mineOnly ? 'checked' : ''} />
                <span>Only TRAPs I'm invested in</span></label>
            <div style="overflow-x:auto">${shown.length ? trapsTable(shown, {}) : '<div class="sa-empty">You have nothing invested.</div>'}</div>
            <div class="sa-slot-meta" style="margin-top:4px">Read ${new Date(d.savedAt).toLocaleString()}${
                d.hideAbandoned ? ' · abandoned TRAPs were hidden in the game' : ''}</div>`;
        view.querySelector('#sa-traps-mine').addEventListener('change', (e) => {
            GM_setValue('sa-traps-mine', e.target.checked); renderTraps();
        });
    }
    renderTraps();

    // ---------- Statements (empire finances, built from saved data) ----------
    function stmtData() {
        const cap = capitalFor({});
        const assets = { cash: [], inventory: [], investments: [], other: [] };
        planetIds().forEach(id => {
            const c = (invLoad(id)?.items || []).filter(i => /credit|money|cash/i.test(i.name) && i.value != null)
                .reduce((s, i) => s + i.value, 0);
            assets.cash.push([`Credits · ${shortName(id)}`, c]);
        });
        const bank = bankLoad();
        assets.cash.push(['Bank balance', bank ? bank.value : 0]);
        const market = cap.market;
        const stock = {};
        planetIds().forEach(id => (invLoad(id)?.items || []).forEach(i => {
            if (i.value == null || /credit|money|cash/i.test(i.name)) return;
            const n = i.name.replace(/ #\d+$/, ''); stock[n] = (stock[n] || 0) + i.value;
        }));
        Object.keys(stock).forEach(n => {
            const m = (market?.resources || []).find(r => r.name.toLowerCase() === n.toLowerCase());
            assets.inventory.push([`${n} (${fmt(stock[n])})`, m && m.sellPrice != null ? stock[n] * m.sellPrice : null]);
        });
        const inv = investRows().filter(r => r.mine > 0);
        inv.forEach(r => assets.investments.push([r.name, r.mine]));
        const c = bdCounts();
        bdKinds().forEach(([k, l]) => {
            const n = c && c[k] ? c[k].value : 0, u = bdUnitValue(k);
            if (n > 0) assets.other.push([`${l} (${fmt(n)})`, u ? n * u.value : null]);
        });
        const sum = (a) => a.reduce((s, x) => s + (x[1] || 0), 0);
        const totals = { cash: sum(assets.cash), inventory: sum(assets.inventory), investments: sum(assets.investments), other: sum(assets.other) };
        totals.assets = totals.cash + totals.inventory + totals.investments + totals.other;

        // Daily flows per planet
        const fee = (galaxyFeeLoad()?.value || 0) / 100;
        const income = { passive: [], print: [], feeCost: [], resources: [], units: [], interest: [] };
        planetIds().forEach(id => {
            const pn = shortName(id);
            let cg = null, rg = null;
            try {
                const data = tgLoad(id); tgApplySaved(id, data, false);
                const v = {}; TG_FIELDS.forEach(f => v[f.key] = f.type === 'select' ? (data.values[f.key] || '').trim() : parseNumber(data.values[f.key]));
                cg = calcTurnGen(v);
            } catch (e) {}
            try { rg = rgModel(id); } catch (e) {}
            if (cg) income.passive.push([pn, cg.passiveDay]);
        });
        // Turn spending follows the Value Optimizer plan (averaged over the week)
        let vp = null;
        try { vp = voPlan(); } catch (e) { vp = null; }
        if (vp && !vp.error) vp.byMethod.forEach(b => {
            if (b.m.kind === 'print') {
                const gross = fee < 1 ? b.perDay / (1 - fee) : b.perDay;
                income.print.push([`${b.m.planet} (${Math.round(b.turns).toLocaleString()} turns/day)`, gross]);
                income.feeCost.push([b.m.planet, gross - b.perDay]);
            } else if (b.m.kind === 'units') income.units.push([`${b.m.label.replace(/^Sell /, '')} (${Math.round(b.turns).toLocaleString()} turns/day)`, b.perDay]);
            else income.resources.push([`${b.m.planet} (${Math.round(b.turns).toLocaleString()} turns/day)`, b.perDay]);
        });
        inv.forEach(r => { if (r.myDaily != null) income.interest.push([r.name, r.myDaily]); });
        const it = {}; Object.keys(income).forEach(k => it[k] = sum(income[k]));
        it.revenue = it.passive + it.print + it.resources + it.units + it.interest;
        it.net = it.revenue - it.feeCost;
        return { assets, totals, income, it, vp, missingCg: planetIds().length - income.passive.length };
    }

    // Keep a snapshot of the balance sheet at most once an hour (last 200)
    function stmtRecord(d) {
        const h = GM_getValue('sa-stmt-history', []) || [];
        const last = h[h.length - 1];
        const bankV = (d.assets.cash.find(x => x[0] === 'Bank balance') || [0, 0])[1];
        const snap = { t: new Date().toISOString(), cash: d.totals.cash, credits: d.totals.cash - bankV, bank: bankV, inventory: d.totals.inventory,
                       investments: d.totals.investments, other: d.totals.other, total: d.totals.assets, net: d.it.net };
        if (!(d.totals.assets > 0)) return h;
        if (last && Date.now() - new Date(last.t) < 3600e3) h[h.length - 1] = Object.assign(snap, { t: last.t, updated: snap.t });
        else h.push(snap);
        while (h.length > 200) h.shift();
        GM_setValue('sa-stmt-history', h);
        return h;
    }

    function stmtTable(sections, opts = {}) {
        const f = (v) => v == null ? '<span style="color:var(--dim)">no price</span>' : escapeHtml(fmt(v));
        return `<table class="sa-unit-table sa-stmt">${sections.map(sec => {
            if (sec.total) return `<tr class="sa-stmt-total"><td>${escapeHtml(sec.label)}</td><td class="sa-num">${
                sec.sign && sec.value > 0 ? '+' : ''}${f(sec.value)}</td></tr>`;
            if (sec.note) return `<tr><td colspan="2" style="color:var(--muted); font-size:10px">${escapeHtml(sec.note)}</td></tr>`;
            return `<tr class="sa-stmt-head"><td colspan="2">${escapeHtml(sec.label)}</td></tr>` +
                (sec.rows.length ? sec.rows.map(r => `<tr><td style="padding-left:14px">${escapeHtml(r[0])}</td><td class="sa-num">${
                    sec.neg && r[1] ? '−' : ''}${f(r[1])}</td></tr>`).join('') : `<tr><td colspan="2" style="padding-left:14px; color:var(--dim)">none saved</td></tr>`) +
                `<tr class="sa-stmt-sub"><td style="padding-left:14px">Total</td><td class="sa-num">${
                    sec.neg && sec.sum ? '−' : ''}${f(sec.sum)}</td></tr>`;
        }).join('')}</table>`;
    }
    // Player name from the top bar's "Profile" box (saved for the pop-out)
    function profileName() {
        try {
            const lab = Array.from(document.querySelectorAll('body *')).find(el => !el.closest('#' + PANEL_ID) &&
                !el.children.length && (el.textContent || '').trim() === 'Profile');
            let box = lab && lab.parentElement;
            for (let i = 0; box && i < 3; i++, box = box.parentElement) {
                const t = (box.innerText || '').split('\n').map(x => x.trim()).filter(x => x && x !== 'Profile' && !/^\d/.test(x));
                if (t.length) { GM_setValue('sa-profile-name', t[0]); break; }
            }
        } catch (e) {}
        const n = GM_getValue('sa-profile-name', '');
        return n ? `${n}'s Empire` : 'Empire';
    }
    // Classic balance sheet: everything summed across planets, this snapshot next to an earlier one
    function balanceSheetHtml(d, h) {
        const bank = (d.assets.cash.find(x => x[0] === 'Bank balance') || [0, 0])[1];
        const now = { credits: d.totals.cash - bank, bank, inventory: d.totals.inventory, investments: d.totals.investments, other: d.totals.other };
        const older = h.filter(x => Date.now() - new Date(x.updated || x.t) > 20 * 3600e3);
        const p0 = older.length ? older[older.length - 1] : (h.length > 1 ? h[0] : null);
        const prev = p0 ? { credits: p0.credits ?? p0.cash, bank: p0.bank ?? 0, inventory: p0.inventory, investments: p0.investments, other: p0.other || 0 } : null;
        const calc = (x) => {
            const cur = x.credits + x.bank + x.inventory, nonCur = x.investments + x.other, assets = cur + nonCur;
            return Object.assign({ cur, nonCur, assets }, x);
        };
        const A = calc(now), B = prev ? calc(prev) : null;
        const opening = h.length ? h[0].total : A.assets;
        const eq = (x) => ({ contributed: opening, retained: x.assets - opening });
        const EA = eq(A), EB = B ? eq(B) : null;
        const n = (v) => v == null ? '' : v < 0 ? `(${escapeHtml(fmt(-v))})` : escapeHtml(fmt(v));
        const line = (label, a, b, cls = '', indent = 1) => `<tr class="${cls}"><td style="padding-left:${6 + indent * 12}px">${label}</td>
            <td class="sa-num">${n(a)}</td>${B ? `<td class="sa-num" style="color:var(--muted)">${n(b)}</td>` : ''}</tr>`;
        const head = (label) => `<tr class="sa-stmt-head"><td colspan="${B ? 3 : 2}">${label}</td></tr>`;
        const sub = (label) => `<tr><td colspan="${B ? 3 : 2}" style="padding-left:12px; font-style:italic; color:var(--muted)">${label}</td></tr>`;
        const dt = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        return `<div style="text-align:center; margin:4px 0 8px">
                <div style="font-weight:700">${escapeHtml(profileName())}</div>
                <div>Balance Sheet</div>
                <div style="color:var(--muted); font-size:10px">As of ${dt(Date.now())} · all planets combined · in credits</div></div>
            <table class="sa-unit-table sa-stmt sa-bs">
            <thead><tr><th></th><th style="text-align:right">${dt(Date.now())}</th>${B ? `<th style="text-align:right">${dt(p0.updated || p0.t)}</th>` : ''}</tr></thead>
            <tbody>
            ${head('ASSETS')}
            ${sub('Current assets')}
            ${line('Cash on planets', A.credits, B && B.credits, '', 2)}
            ${line('Bank deposits', A.bank, B && B.bank, '', 2)}
            ${line('Inventory (resources, at market)', A.inventory, B && B.inventory, '', 2)}
            ${line('Total current assets', A.cur, B && B.cur, 'sa-stmt-sub')}
            ${sub('Non-current assets')}
            ${line('Long-term investments (TRAPs)', A.investments, B && B.investments, '', 2)}
            ${line('Other assets (brains, diamonds, SSB)', A.other, B && B.other, '', 2)}
            ${line('Total non-current assets', A.nonCur, B && B.nonCur, 'sa-stmt-sub')}
            ${line('<b>TOTAL ASSETS</b>', A.assets, B && B.assets, 'sa-stmt-total sa-bs-dbl', 0)}
            ${head("LIABILITIES AND STOCKHOLDERS' EQUITY")}
            ${sub('Liabilities')}
            ${line('Current liabilities', 0, B && 0, '', 2)}
            ${line('Long-term liabilities', 0, B && 0, '', 2)}
            ${line('Total liabilities', 0, B && 0, 'sa-stmt-sub')}
            ${sub("Stockholders' equity")}
            ${line('Opening capital (first snapshot)', EA.contributed, EB && EB.contributed, '', 2)}
            ${line('Retained earnings', EA.retained, EB && EB.retained, '', 2)}
            ${line("Total stockholders' equity", A.assets, B && B.assets, 'sa-stmt-sub')}
            ${line("<b>TOTAL LIABILITIES AND EQUITY</b>", A.assets, B && B.assets, 'sa-stmt-total sa-bs-dbl', 0)}
            </tbody></table>
            <div class="sa-slot-meta" style="margin-top:6px">${B ? 'Right column: the latest snapshot at least a day old. ' : 'A comparison column appears once there is an earlier snapshot. '}
                Negative numbers in (brackets). No debts are tracked. Inventory and other assets at market sell price / Best Spend value${
                d.assets.inventory.some(x => x[1] == null) ? '; some resources have no market price' : ''}.</div>`;
    }
    var STMT_TABS = { stbalance: 'Balance Sheet', stincome: 'Income Statement', stcash: 'Cash Flow Statement', stholder: "Stockholders' Equity" };
    function stmtHtml(which, d, h) {
        const sum = (a) => a.reduce((s, x) => s + (x[1] || 0), 0);
        const days = (a, b) => (new Date(b.t) - new Date(a.t)) / 864e5;
        if (which === 'stbalance') return balanceSheetHtml(d, h);
        if (which === 'stincome') return stmtTable([
            { label: 'Revenue', rows: [
                ['Passive credits', d.it.passive], ['Printing credits (before fee)', d.it.print],
                ['Resource production (at market)', d.it.resources], ['Unit sales (slaves, professors)', d.it.units], ['Investment interest', d.it.interest]], sum: d.it.revenue },
            { label: 'Expenses', neg: true, rows: [['Galaxy fee on printing', d.it.feeCost]], sum: d.it.feeCost },
            { total: true, sign: true, label: 'Net income per day', value: d.it.net },
            { total: true, sign: true, label: 'Net income per week', value: d.it.net * 7 },
            { label: 'Revenue by planet / investment', rows: [
                ...d.income.passive.map(([p, v]) => [`Passive · ${p}`, v]),
                ...d.income.print.map(([p, v]) => [`Printing · ${p}`, v]),
                ...d.income.resources.map(([p, v]) => [`Resources · ${p}`, v]),
                ...d.income.units.map(([p, v]) => [`Sales · ${p}`, v]),
                ...d.income.interest.map(([n, v]) => [`Interest · ${n}`, v])], sum: d.it.revenue },
            { note: `Turns are spent as Value Optimizer plans (${d.vp && !d.vp.error ? Math.round(d.vp.turns).toLocaleString() + ' turns/day, print days and non-print days averaged' : 'no plan yet: ' + (d.vp?.error || 'fill Credit Gen and Resource Gen')}). Passive income uses Credit Gen.${
                d.missingCg ? ` ${d.missingCg} planet(s) lack Credit Gen data.` : ''} Upgrade spending isn't tracked.` },
        ]);
        if (which === 'stcash') {
            const out = [
                { label: 'Operating (credits in hand)', rows: [['Passive credits', d.it.passive], ['Printing after fee', d.it.print - d.it.feeCost], ['Unit sales', d.it.units]],
                  sum: d.it.passive + d.it.print - d.it.feeCost + d.it.units },
                { label: 'Non-cash (become cash when sold / withdrawn)', rows: [['Resources produced', d.it.resources], ['Interest added to TRAPs', d.it.interest]],
                  sum: d.it.resources + d.it.interest },
                { total: true, sign: true, label: 'Expected change in cash per day', value: d.it.passive + d.it.print - d.it.feeCost + d.it.units },
            ];
            const pts = h.filter(x => x.cash != null);
            if (pts.length >= 2) {
                const a = pts[pts.length - 2], b = pts[pts.length - 1], dd = days(a, b);
                out.push({ label: `Actual: last two snapshots (${dd.toFixed(1)} days apart)`, rows: [
                    ['Cash', b.cash - a.cash], ['Inventory', b.inventory - a.inventory], ['Investments', b.investments - a.investments]],
                    sum: (b.cash - a.cash) + (b.inventory - a.inventory) + (b.investments - a.investments) });
                if (dd > 0) out.push({ total: true, sign: true, label: 'Actual change in cash per day', value: (b.cash - a.cash) / dd });
                out.push({ note: 'A gap between expected and actual is money spent (upgrades, units, purchases) or moved.' });
            } else out.push({ note: 'Actual cash flow appears once there are two snapshots (taken at most hourly as you play).' });
            return stmtTable(out);
        }
        // Stockholders' equity
        if (!h.length) return '<div class="sa-empty">No snapshots yet.</div>';
        const first = h[0], last = h[h.length - 1], span = days(first, last);
        const expected = first.total + (span > 0 ? d.it.net * span : 0);
        const rows = h.slice(-30).reverse().map((x, i, arr) => {
            const prev = arr[i + 1];
            return `<tr><td>${new Date(x.updated || x.t).toLocaleString()}</td><td class="sa-num">${escapeHtml(fmt(x.total))}</td>
                <td class="sa-num ${prev ? (x.total >= prev.total ? 'sa-diff-pos' : 'sa-diff-neg') : ''}">${prev ? (x.total >= prev.total ? '+' : '−') + escapeHtml(fmt(Math.abs(x.total - prev.total))) : ''}</td></tr>`;
        }).join('');
        return stmtTable([
            { total: true, label: `Opening equity (${new Date(first.t).toLocaleDateString()})`, value: first.total },
            { total: true, sign: true, label: `+ Estimated net income (${span.toFixed(1)} days)`, value: span > 0 ? d.it.net * span : 0 },
            { total: true, label: '= Expected equity', value: expected },
            { total: true, label: 'Actual equity now', value: last.total },
            { total: true, sign: true, label: 'Difference (spent / unexplained)', value: last.total - expected },
        ]) + `<div class="sa-label" style="margin-top:10px">Equity history</div>
            <table class="sa-unit-table"><thead><tr><th>Snapshot</th><th style="text-align:right">Equity</th><th style="text-align:right">Change</th></tr></thead>
            <tbody>${rows}</tbody></table>`;
    }
    function renderStatements() {
        if (!document.getElementById('sa-stbalance-view')) return;
        let d, h;
        try { d = stmtData(); h = stmtRecord(d); } catch (e) { console.warn('[SharkBot] statements', e); return; }
        Object.keys(STMT_TABS).forEach(k => {
            const v = document.getElementById(`sa-${k}-view`);
            if (!v) return;
            v.innerHTML = `<button class="sa-btn sa-popout-btn" style="width:100%; margin:0 0 8px">⧉ Open all statements in a new window</button>` + stmtHtml(k, d, h);
            v.querySelector('.sa-popout-btn').addEventListener('click', () => popOut('SharkBot · Statements',
                Object.keys(STMT_TABS).map(x => `<div class="sa-label" style="font-size:13px; margin:14px 0 6px">${STMT_TABS[x]}</div>` + stmtHtml(x, d, h)).join('')));
        });
    }
    renderStatements();

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
                       'sa-autoscan', 'sa-theme-custom', 'sa-cg-assume', 'sa-bd', 'sa-share-on', 'sa-share-url'];
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
            keys.push('sa-market-latest', 'sa-bank', 'sa-player-bank', 'sa-traps', 'sa-invest-api', 'sa-stmt-history', 'sa-galaxy-fee', 'sa-central-bank',
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
        renderInventory(); renderBank(); renderTraps(); renderTurnGen(); renderTurns(); renderNation(); renderCards(); renderPlanetList(); showDetected();
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
            ['Bank (your bank tab)', bankLoad()],
            ['Bank (Central bank tab)', galaxyFeeLoad()],
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
        { target: '.sa-maintabs', title: 'Four main tabs',
          text: `<b>General</b>: status and settings.<br><b>Data</b>: everything SharkBot has saved.<br><b>Calculators</b>: tools that use that data.<br><b>Statements</b>: balance sheet, income, cash flow and equity for your whole empire.<br><br>
                 Each one remembers the subtab you last opened.` },
        { tab: 'units', target: '.sa-tabs', title: 'Data',
          text: `Top row, <b>Empire</b>: Research, Market, Bank and Cards are shared by all your planets.<br>
                 Bottom row, <b>Planet</b>: Units, Facilities, Inventory and Nation are saved for each planet. Units and Facilities can <b>compare</b> two planets.<br><br>
                 Each fills in on its own when you visit that game page. Three need a little help, shown next.` },
        { tab: 'facilities', title: 'Facilities: use the old view',
          text: `On the Facilities page pick <b>Resources</b>, <b>Military</b> or <b>Areas</b>, not <b>New view</b>.<br><br>
                 Switching views may not count as a new page, so click <b>Scan</b> after each switch. Saving one view keeps the others.` },
        { tab: 'bank', title: 'Bank: both tabs',
          text: `On the Bank page, your own bank tab saves your <b>bank balance</b>. Then open the <b>Central bank</b> tab: that saves the <b>galaxy fee</b> Credit Gen needs. The two are kept separate.` },
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
          text: `Splits <b>all your capital</b> (credits, bank and resources you could sell) between Area upgrades on every planet and your Tick Generator, wherever it adds the most <b>credits per day</b>.<br><br>
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
    document.getElementById('sa-tr-slot')?.addEventListener('change', (e) => { GM_setValue('sa-train-slot', e.target.value); renderTraining(); });
    renderTraining();
    document.getElementById('sa-ts-slot')?.addEventListener('change', (e) => { GM_setValue('sa-ts-slot', e.target.value); renderTurnStorage(); });
    renderTurnStorage();
    document.getElementById('sa-rc-slot')?.addEventListener('change', (e) => { GM_setValue('sa-rc-slot', e.target.value); renderResearchCalc(); });
    renderResearchCalc();
    document.getElementById('sa-en-slot')?.addEventListener('change', (e) => { GM_setValue('sa-en-slot', e.target.value); renderEnergy(); renderResearchCalc(); });
    renderEnergy();
    document.getElementById('sa-pr-slot')?.addEventListener('change', (e) => { GM_setValue('sa-pr-slot', e.target.value); renderProductivity(); });
    renderProductivity();
    document.getElementById('sa-uv-slot')?.addEventListener('change', (e) => { GM_setValue('sa-uv-slot', e.target.value); renderUnitValue(); });
    ['sa-uv-price', 'sa-uv-pprice', 'sa-uv-split', 'sa-uv-limS', 'sa-uv-limP'].forEach(id => { const i = document.getElementById(id); if (i) { i.value = GM_getValue(id, '');
        i.addEventListener('input', () => { GM_setValue(id, i.value); renderUnitValue(); }); } });
    renderUnitValue();
    renderShareSettings();
    renderAdmin();
    (() => {
        const vi = document.getElementById('sa-vo-turns');
        if (vi) { vi.value = GM_getValue('sa-vo-turns', ''); vi.addEventListener('input', () => { GM_setValue('sa-vo-turns', vi.value); renderValueOpt(); }); }
    })();
    refreshCalcs();
    autoScan();   // and once when the game first loads
    startColonyWatch();

    console.log(`[SharkBot] v${VERSION} loaded on page: ${pageKey || '(unknown)'}`);
})();
