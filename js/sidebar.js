/* Vanilla UX enhancements — runs alongside main.js (jQuery) without
   touching its checklist state. Loaded at end of <body>. */
(function () {
    'use strict';

    var body = document.body;
    var pane = document.getElementById('tabPlaythrough');
    var toggle = document.getElementById('tocToggle');
    var sidebar = document.getElementById('tocSidebar');
    var overlay = document.getElementById('tocOverlay');
    if (!pane || !toggle || !sidebar || !overlay) { return; }

    function getJSON(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) { return fallback; }
    }
    function setJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function esc(s) {
        return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
    }

    // --- progress backup (download / restore a save file) --------------
    var STORAGE = 'jStorage';
    function readProgress() {
        try { return localStorage.getItem(STORAGE) || ''; } catch (e) { return ''; }
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    // returns true if a download was started, false if there was nothing to save
    function downloadProgress() {
        var data = readProgress();
        if (!data) { return false; }
        var d = new Date();
        var name = 'elden-ring-save-' +
            pad2(d.getFullYear() % 100) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
            '-' + pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds()) + '.txt';
        var url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return true;
    }
    // validate a save string and apply it (then reload). msg(text) reports status.
    function restoreProgress(raw, msg) {
        raw = (raw || '').trim();
        if (!raw) { msg('Empty file.'); return; }
        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) { msg('Unreadable file (invalid JSON).'); return; }
        if (!parsed || typeof parsed !== 'object' || !parsed.elden_ring_profiles) {
            msg("This file isn't a valid save."); return;
        }
        try { localStorage.setItem(STORAGE, raw); }
        catch (e) { msg("Couldn't write (storage full or blocked)."); return; }
        msg('✓ Restored — reloading…');
        setTimeout(function () { location.reload(); }, 700);
    }
    function readFile(file, msg, onText) {
        if (file.text) {
            file.text().then(onText, function () { msg("Couldn't read the file."); });
        } else {
            var fr = new FileReader();
            fr.onload = function () { onText(String(fr.result)); };
            fr.onerror = function () { msg("Couldn't read the file."); };
            fr.readAsText(file);
        }
    }

    /* ------------------------------------------------------------------ *
     *  1. Wrap each region so it can collapse
     * ------------------------------------------------------------------ */

    var COLLAPSE_KEY = 'er_collapsed';
    function allRegionIds() {
        return Array.prototype.map.call(
            pane.querySelectorAll('h3[id]'), function (h) { return h.id; }
        );
    }
    var storedCollapsed = getJSON(COLLAPSE_KEY, null);
    var collapsed = new Set(storedCollapsed || []);
    if (storedCollapsed === null) {          // first visit: start fully folded
        allRegionIds().forEach(function (id) { collapsed.add(id); });
        persistCollapsed();
    }

    Array.prototype.slice.call(pane.querySelectorAll('h3[id]')).forEach(function (h3) {
        var section = document.createElement('section');
        section.className = 'region';
        section.dataset.region = h3.id;

        var head = document.createElement('div');
        head.className = 'region-head';

        var bodyWrap = document.createElement('div');
        bodyWrap.className = 'region-body';
        var bodyInner = document.createElement('div');
        bodyInner.className = 'region-inner';
        bodyWrap.appendChild(bodyInner);

        h3.parentNode.insertBefore(section, h3);
        h3.tabIndex = -1;   // focusable via nav clicks, not in the tab order

        var navA = sidebar.querySelector('a[href="#' + esc(h3.id) + '"]');
        var regionName = (navA ? navA.textContent : h3.textContent).replace(/\s+/g, ' ').trim();

        var cbtn = document.createElement('button');
        cbtn.type = 'button';
        cbtn.className = 'region-collapse';
        cbtn.setAttribute('aria-label', 'Collapse or expand ' + regionName);
        cbtn.setAttribute('aria-expanded', collapsed.has(h3.id) ? 'false' : 'true');
        head.appendChild(cbtn);
        head.appendChild(h3);

        section.appendChild(head);
        section.appendChild(bodyWrap);

        while (section.nextSibling) {
            var sib = section.nextSibling;
            if (sib.nodeType === 1 && sib.matches('h3[id], section.region')) { break; }
            bodyInner.appendChild(sib);
        }
        if (collapsed.has(h3.id)) {
            section.classList.add('is-collapsed');
            if ('inert' in HTMLElement.prototype) { bodyInner.inert = true; }
        }
    });

    /* tag each task with a rough category for the filter chips */
    function classify(text) {
        var t = text.trim().toLowerCase();
        if (/^(defeat|kill)\b/.test(t)) { return 'boss'; }
        if (/^buy\b/.test(t)) { return 'shop'; }
        if (/^rest at\b/.test(t) || (/^activate\b/.test(t) && /\bgrace\b/.test(t))) { return 'grace'; }
        if (/^complete\b/.test(t)) { return 'dungeon'; }
        if (/^(talk to|speak|meet|give|report back|agree to serve|listen for)\b/.test(t)) { return 'npc'; }
        if (/^(loot|obtain|grab|pick up|collect|get)\b/.test(t)) { return 'loot'; }
        if (/^find\b/.test(t)) {
            return /(talisman|ashes|\bset\b|cookbook|scroll|\bseed\b|stonesword key|\btear\b|painting|whetstone|medallion|bell bearing|prayerbook|scarab|glovewort|smithing stone|great rune|remembrance|larval|map fragment)/.test(t)
                ? 'loot' : 'npc';
        }
        return null;
    }
    /* side-quest registry: data-quest="ranni blaidd" on a <li> -> pills + filter */
    var ER_QUESTS = {
        ranni: 'Ranni', varre: 'Varré', roderika: 'Roderika', d: 'D & Twin',
        hyetta: 'Hyetta', irina: 'Irina & Edgar', boc: 'Boc', gurranq: 'Gurranq',
        thops: 'Thops', kenneth: 'Kenneth', alexander: 'Alexander', jarbairn: 'Jar Bairn',
        blaidd: 'Blaidd', fia: 'Fia', sellen: 'Sellen', gowry: 'Gowry', corhyn: 'Corhyn',
        gostoc: 'Gostoc', nepheli: 'Nepheli', seluvis: 'Seluvis', yura: 'Yura',
        bernahl: 'Bernahl', patches: 'Patches', rya: 'Rya', dungeater: 'Dung Eater',
        millicent: 'Millicent', boggart: 'Boggart', latenna: 'Latenna', ensha: 'Ensha',
        rogier: 'Rogier', diallos: 'Diallos', tanith: 'Tanith', gideon: 'Gideon'
    };
    function questPills(li) {
        var qv = li.getAttribute('data-quest');
        if (!qv) { return ''; }
        return qv.trim().split(/\s+/).map(function (s) {
            var label = ER_QUESTS[s] || s;
            return '<button type="button" class="er-quest-badge" data-q="' + s + '" ' +
                   'title="Filter to the ' + label + ' quest">' + label + '</button>';
        }).join(' ') + ' ';
    }

    var typeCounts = {};
    var everyItem = Array.prototype.slice.call(pane.querySelectorAll('li[data-id]'));
    var optionalCount = 0;
    var QUALIFIER_RE = /^(\s*)\(\s*(optional|hard)[^)]*\)\s*/i;
    everyItem.forEach(function (li) {
        // leading "(Optional …)" / "(hard …)" text -> small badge(s)
        var raw = li.textContent;
        var qm = raw.match(QUALIFIER_RE);
        var forClassify = qm ? raw.replace(QUALIFIER_RE, '') : raw;
        if (qm) {
            var isOpt = /\boptional\b/i.test(qm[0]);
            var isHard = /\bhard\b/i.test(qm[0]);
            var badges = '';
            if (isOpt)  { badges += '<span class="er-opt-badge">Optional</span> '; }
            if (isHard) { badges += '<span class="er-hard-badge">Hard</span> '; }
            li.innerHTML = li.innerHTML.replace(QUALIFIER_RE, '$1' + badges);
            if (isOpt) { li.dataset.optional = ''; optionalCount++; }
        }
        // side-quest pills, after any Optional/Hard badge
        var qp = questPills(li);
        if (qp) {
            var m = li.innerHTML.match(/^\s*(?:<span class="er-(?:opt|hard)-badge">.*?<\/span>\s*)*/);
            var pre = m ? m[0] : '';
            li.innerHTML = pre + qp + li.innerHTML.slice(pre.length);
        }
        var ty = classify(forClassify);
        if (ty) { li.dataset.type = ty; }
        typeCounts[ty || ''] = (typeCounts[ty || ''] || 0) + 1;
    });
    // the "All" count must line up with main.js calculateTotals(): the
    // "pick one" label and "note" annotation lines are not tasks, and
    // each exclusive choice group counts as one item whatever its options
    var choiceOpts = Array.prototype.slice.call(pane.querySelectorAll('li.choice[data-choice-group]'));
    var choiceGroupCount = new Set(choiceOpts.map(function (li) { return li.dataset.choiceGroup; })).size;
    typeCounts[''] = everyItem.length
        - pane.querySelectorAll('li.choice-head, li.note').length
        - (choiceOpts.length - choiceGroupCount);

    /* drop the achievement it unlocks under a checklist row.
       Runs before main.js wraps the <li>, so append on its own line —
       addCheckbox only rewraps line 0. */
    (function () {
        var list = window.ER_ACHIEVEMENTS;
        if (!list || !list.length) { return; }
        function esch(s) {
            return String(s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        }
        list.forEach(function (a) {
            if (!a.task) { return; }
            var li = pane.querySelector('li[data-id="' + esc(a.task) + '"]');
            if (!li || li.querySelector('.er-ach')) { return; }
            li.setAttribute('data-ach', '');   // a task line is achievement-relevant by definition
            li.innerHTML += '\n<div class="er-ach" title="' + esch(a.name + ' — ' + a.description) + '">' +
                '<img class="er-ach-icon" src="' + esch(a.image) + '" alt="" width="34" height="34" loading="lazy">' +
                '<span class="er-ach-txt">' +
                    '<span class="er-ach-name">' + esch(a.name) + '</span>' +
                    '<span class="er-ach-desc">' + esch(a.description) + '</span>' +
                '</span></div>';
        });
    })();

    // put the region sections in the same order as the sidebar nav
    // (the source HTML has a few regions out of progression order)
    Array.prototype.forEach.call(sidebar.querySelectorAll('a[href^="#"]'), function (a) {
        var sec = pane.querySelector('.region[data-region="' + esc(a.getAttribute('href').slice(1)) + '"]');
        if (sec) { pane.appendChild(sec); }
    });

    var sections = Array.prototype.slice.call(pane.querySelectorAll('.region'));

    // NB: Array.prototype.slice.call(aSet) is [] — a Set isn't array-like
    function persistCollapsed() { setJSON(COLLAPSE_KEY, Array.from(collapsed)); }

    function setCollapsed(section, state) {
        section.classList.toggle('is-collapsed', state);
        var cbtn = section.querySelector('.region-collapse');
        if (cbtn) { cbtn.setAttribute('aria-expanded', state ? 'false' : 'true'); }
        var inner = section.querySelector('.region-inner');
        if (inner && 'inert' in HTMLElement.prototype && !body.classList.contains('er-filtering')) {
            inner.inert = state;
        }
        if (state) { collapsed.add(section.dataset.region); }
        else { collapsed.delete(section.dataset.region); }
    }

    pane.addEventListener('click', function (e) {
        if (e.target.closest('.region-actions')) { return; }   // its own buttons
        var head = e.target.closest('.region-head');
        if (!head) { return; }
        var section = head.closest('.region');
        setCollapsed(section, !section.classList.contains('is-collapsed'));
        persistCollapsed();
    });

    /* ------------------------------------------------------------------ *
     *  2. Sticky toolbar (holds the sidebar toggle, progress bar, filters)
     * ------------------------------------------------------------------ */

    var toolbar = document.createElement('div');
    toolbar.id = 'erToolbar';
    toolbar.innerHTML =
        '<div class="er-row er-row-top">' +
            '<span class="er-progress" role="progressbar" aria-label="Overall progress"' +
                ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
                '<span class="er-progress-fill"></span>' +
            '</span>' +
            '<span class="er-progress-pct">0%</span>' +
            '<input id="erFilter" type="search" placeholder="Filter tasks…  ( / )" ' +
                'aria-label="Filter tasks" title="Keyboard shortcut: /" autocomplete="off">' +
        '</div>' +
        '<div class="er-row er-actions">' +
            '<button type="button" id="erHideDone" aria-pressed="false">Hide done</button>' +
            '<button type="button" id="erCollapseAll">Collapse all</button>' +
            '<button type="button" id="erBackup" ' +
                'title="Download a save file of my progress">Save</button>' +
            '<label class="er-filebtn" ' +
                'title="Restore progress from a save file">Restore' +
                '<input type="file" id="erImportFile" ' +
                'accept=".txt,.json,application/json,text/plain"></label>' +
            '<span id="erBackupMsg" role="status"></span>' +
        '</div>' +
        '<div class="er-row er-chips">' +
            '<span class="er-chip-types" role="group" aria-label="Filter by category (combine freely)">' +
                '<button type="button" class="er-chip is-on" aria-pressed="true" data-type="">All</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="boss">Boss</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="dungeon">Dungeons</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="loot">Loot</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="npc">NPCs</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="grace">Graces</button>' +
                '<button type="button" class="er-chip" aria-pressed="false" data-type="shop">Shops</button>' +
            '</span>' +
            '<button type="button" class="er-chip er-chip-opt" id="erOptional" aria-pressed="false" ' +
                'title="Hide the (Optional) steps and drop them from the totals">Optional</button>' +
            '<button type="button" class="er-chip er-chip-ach" id="erAchOnly" aria-pressed="false" ' +
                'title="Show only the steps needed for achievements">Ach. only</button>' +
        '</div>' +
        '<div class="er-row er-quests">' +
            '<div class="er-quest-tray" role="group" aria-label="Filter by side quest (combine freely)"></div>' +
            '<button type="button" class="er-quest-clear" hidden>Clear</button>' +
        '</div>';
    var sentinel = document.createElement('div');
    sentinel.className = 'er-toolbar-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    pane.insertBefore(toolbar, pane.firstChild);
    pane.insertBefore(sentinel, toolbar);

    var noResults = document.createElement('p');
    noResults.className = 'er-no-results';
    noResults.setAttribute('role', 'status');
    noResults.textContent = 'No task matches this filter.';
    noResults.hidden = true;
    pane.appendChild(noResults);
    // move the existing sidebar toggle into the toolbar
    toolbar.querySelector('.er-row').insertBefore(toggle, toolbar.querySelector('.er-progress'));

    // shadow under the toolbar once it is pinned to the top
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            toolbar.classList.toggle('is-stuck', !entries[0].isIntersecting);
        }).observe(sentinel);
    }

    // keep anchor jumps clear of the sticky toolbar, whatever its height
    function syncToolbarHeight() {
        body.style.setProperty('--toolbar-h', toolbar.offsetHeight + 'px');
    }
    syncToolbarHeight();
    window.addEventListener('resize', syncToolbarHeight);

    var progFill = toolbar.querySelector('.er-progress-fill');
    var progPct = toolbar.querySelector('.er-progress-pct');
    var progWrap = toolbar.querySelector('.er-progress');
    var overallSpan = document.getElementById('playthrough_overall_total');

    function syncProgress() {
        var t = (overallSpan.textContent || '').trim();
        var p = t === 'DONE' ? 100 : (parseInt(t, 10) || 0);
        var done = overallSpan.getAttribute('data-checked');
        var total = overallSpan.getAttribute('data-count');
        progFill.style.width = p + '%';
        progPct.innerHTML = (done && total && total !== '0')
            ? '<span class="er-pct-num">' + done + ' / ' + total + ' · </span>' + p + '%'
            : p + '%';
        progWrap.setAttribute('aria-valuenow', p);
        progWrap.classList.toggle('is-done', p === 100);
        refreshChoices();
        if (typeof syncAllBadge === 'function') { syncAllBadge(); }
    }
    if (overallSpan) {
        new MutationObserver(syncProgress).observe(overallSpan, {
            childList: true, characterData: true, subtree: true
        });
        syncProgress();
    }

    /* mutually-exclusive "pick one" choice groups
       (li.choice-head label + li.choice[data-choice-group] options) */
    function refreshChoices() {
        var groups = {};
        Array.prototype.forEach.call(pane.querySelectorAll('li.choice[data-choice-group]'), function (li) {
            (groups[li.dataset.choiceGroup] = groups[li.dataset.choiceGroup] || []).push(li);
        });
        Object.keys(groups).forEach(function (g) {
            var members = groups[g];
            var picked = members.filter(function (li) {
                var cb = li.querySelector('input[type="checkbox"]');
                return cb && cb.checked;
            });
            members.forEach(function (li) {
                li.classList.toggle('is-notpicked', picked.length > 0 && picked.indexOf(li) === -1);
            });
        });
    }
    pane.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb || cb.type !== 'checkbox') { return; }
        var li = cb.closest && cb.closest('li.choice[data-choice-group]');
        if (li && cb.checked) {
            var sel = 'li.choice[data-choice-group="' + esc(li.dataset.choiceGroup) +
                '"] input[type="checkbox"]';
            Array.prototype.forEach.call(pane.querySelectorAll(sel), function (other) {
                if (other !== cb && other.checked) { other.click(); }   // toggle the other one off
            });
        }
        refreshChoices();
    });

    /* ------------------------------------------------------------------ *
     *  3. Collapse-all / expand-all
     * ------------------------------------------------------------------ */

    var collapseAllBtn = document.getElementById('erCollapseAll');
    function refreshCollapseAllLabel() {
        var anyOpen = sections.some(function (s) { return !s.classList.contains('is-collapsed'); });
        collapseAllBtn.textContent = anyOpen ? 'Collapse all' : 'Expand all';
    }
    collapseAllBtn.addEventListener('click', function () {
        var anyOpen = sections.some(function (s) { return !s.classList.contains('is-collapsed'); });
        sections.forEach(function (s) { setCollapsed(s, anyOpen); });
        persistCollapsed();
        refreshCollapseAllLabel();
    });
    refreshCollapseAllLabel();

    // save / restore progress as a file, always reachable in the toolbar
    var backupMsg = document.getElementById('erBackupMsg');
    var backupMsgTimer;
    function setBackupMsg(text, sticky) {
        backupMsg.textContent = text;
        clearTimeout(backupMsgTimer);
        if (!sticky) { backupMsgTimer = setTimeout(function () { backupMsg.textContent = ''; }, 4000); }
    }
    document.getElementById('erBackup').addEventListener('click', function () {
        setBackupMsg(downloadProgress() ? '✓ File downloaded' : 'Nothing to save yet');
    });
    var importFile = document.getElementById('erImportFile');
    importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        importFile.value = '';
        if (!file) { return; }
        readFile(file, setBackupMsg, function (text) {
            restoreProgress(text, function (m) { setBackupMsg(m, true); });
        });
    });

    // "Reset" — clear every check in the current profile only
    var resetBtn = document.getElementById('profileReset');
    var profileSelect = document.getElementById('profiles');
    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            var name = (profileSelect && profileSelect.value) || 'this profile';
            if (!window.confirm(
                '⚠ Reset progress\n\n' +
                'Every checkbox in the "' + name + '" profile will be unchecked. ' +
                'This cannot be undone (use Save first if you want a backup).\n\n' +
                'Other profiles are not affected.'
            )) { return; }
            try {
                var js = JSON.parse(localStorage.getItem(STORAGE) || 'null');
                var p = js && js.elden_ring_profiles;
                var map = p && p.elden_ring_profiles;
                if (map && map[p.current]) {
                    map[p.current].checklistData = {};
                    localStorage.setItem(STORAGE, JSON.stringify(js));
                }
            } catch (e) {}
            // also start fresh: every region folded, back to the top
            try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(allRegionIds())); } catch (e) {}
            try { localStorage.removeItem(SCROLL_KEY); } catch (e) {}
            location.reload();
        });
    }

    /* ------------------------------------------------------------------ *
     *  4. Filter + hide-completed
     * ------------------------------------------------------------------ */

    var filterInput = document.getElementById('erFilter');
    var hideDoneBtn = document.getElementById('erHideDone');
    var chipRow = toolbar.querySelector('.er-chips');
    var chips = Array.prototype.slice.call(chipRow.querySelectorAll('.er-chip[data-type]'));
    var allChip = chips.filter(function (c) { return c.dataset.type === ''; })[0];
    var optionalBtn = document.getElementById('erOptional');
    var typeFilters = new Set(getJSON('er_types', []) || []);
    var questFilters = new Set(getJSON('er_quests', []) || []);

    // show how many tasks each category holds
    var allChipN = null;
    chips.forEach(function (c) {
        var n = typeCounts[c.dataset.type] || 0;
        if (!n) { return; }
        var b = document.createElement('span');
        b.className = 'er-chip-n';
        b.textContent = n;
        c.appendChild(b);
        if (c.dataset.type === '') { allChipN = b; }
    });
    if (optionalCount) {
        var ob = document.createElement('span');
        ob.className = 'er-chip-n';
        ob.textContent = optionalCount;
        optionalBtn.appendChild(ob);
    }

    var achOnlyBtn = document.getElementById('erAchOnly');
    var overallSpanEl = document.getElementById('playthrough_overall_total');
    var achCount = pane.querySelectorAll('li[data-id][data-ach]').length;
    var achChipN = document.createElement('span');
    achChipN.className = 'er-chip-n';
    achChipN.textContent = achCount;
    achOnlyBtn.appendChild(achChipN);

    function hideDoneOn() { return hideDoneBtn.getAttribute('aria-pressed') === 'true'; }
    function optionalHidden() { return optionalBtn.getAttribute('aria-pressed') === 'true'; }
    function achOnly() { return achOnlyBtn.getAttribute('aria-pressed') === 'true'; }

    // "All" volume badge: mirror the live progress count while a
    // count-changing filter is on, else the plain base total
    function syncAllBadge() {
        if (!allChipN) { return; }
        allChipN.textContent = (achOnly() || optionalHidden())
            ? (overallSpanEl.getAttribute('data-count') || String(typeCounts['']))
            : String(typeCounts['']);
    }

    var OPT_KEY = 'er_hide_optional';
    function setOptionalHidden(state) {
        optionalBtn.setAttribute('aria-pressed', state ? 'true' : 'false');
        body.classList.toggle('hide-optional', state);
        try { localStorage.setItem(OPT_KEY, state ? '1' : '0'); } catch (e) {}
    }

    var ACH_KEY = 'er_ach_only';
    function setAchOnly(state) {
        achOnlyBtn.setAttribute('aria-pressed', state ? 'true' : 'false');
        achOnlyBtn.classList.toggle('is-on', state);
        body.classList.toggle('ach-only', state);
        try { localStorage.setItem(ACH_KEY, state ? '1' : '0'); } catch (e) {}
    }

    // restore persisted state before the first paint / first count
    (function () {
        var o, a;
        try { o = localStorage.getItem(OPT_KEY); a = localStorage.getItem(ACH_KEY); } catch (e) {}
        if (o === '1') { setOptionalHidden(true); }
        if (a === '1') { setAchOnly(true); }
    })();

    optionalBtn.addEventListener('click', function () {
        setOptionalHidden(!optionalHidden());
        applyFilter();
        if (window.erRecalcTotals) { window.erRecalcTotals(); }
        syncAllBadge();
    });
    achOnlyBtn.addEventListener('click', function () {
        setAchOnly(!achOnly());
        applyFilter();
        if (window.erRecalcTotals) { window.erRecalcTotals(); }
        syncAllBadge();
    });

    // cache each region's task list + a lowercased copy of each task's text
    // (main.js has wrapped the <li> contents by the time this runs)
    sections.forEach(function (section) {
        section._erItems = Array.prototype.slice
            .call(section.querySelectorAll('li[data-id]'))
            .filter(function (li) { return !li.parentElement.closest('li[data-id]'); });
        section._erItems.forEach(function (li) { li._erText = li.textContent.toLowerCase(); });
    });
    function itemsOf(section) { return section._erItems; }

    var HL_SUPPORTED = ('highlights' in CSS) && typeof window.Highlight === 'function';
    function highlight(term) {
        if (!HL_SUPPORTED) { return; }
        CSS.highlights.delete('er-match');
        if (term.length < 2) { return; }
        var ranges = [];
        for (var s = 0; s < sections.length && ranges.length < 3000; s++) {
            if (sections[s].hidden) { continue; }
            var items = itemsOf(sections[s]);
            for (var i = 0; i < items.length; i++) {
                if (items[i].hidden) { continue; }
                var walker = document.createTreeWalker(items[i], NodeFilter.SHOW_TEXT);
                var node;
                while ((node = walker.nextNode())) {
                    var hay = node.nodeValue.toLowerCase();
                    var at = hay.indexOf(term);
                    while (at !== -1) {
                        var r = document.createRange();
                        r.setStart(node, at);
                        r.setEnd(node, at + term.length);
                        ranges.push(r);
                        at = hay.indexOf(term, at + term.length);
                    }
                }
            }
        }
        CSS.highlights.set('er-match', new window.Highlight(...ranges));
    }

    function liMatchesQuest(li) {
        var arr = (li.getAttribute('data-quest') || '').split(/\s+/);
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && questFilters.has(arr[i])) { return true; }
        }
        return false;
    }

    function applyFilter() {
        var term = filterInput.value.trim().toLowerCase();
        var hideDone = hideDoneOn();
        var hideOpt = optionalHidden();
        var achMode = achOnly();
        var typeOn = typeFilters.size;
        var questOn = questFilters.size;
        var anyActive = !!term || hideDone || !!typeOn || hideOpt || achMode || !!questOn;
        // text search, a category chip or a side-quest pick force-opens the regions
        var forceOpen = !!term || !!typeOn || !!questOn;
        body.classList.toggle('er-filtering', forceOpen);
        // while a region is force-opened its content must stay reachable
        if ('inert' in HTMLElement.prototype) {
            sections.forEach(function (s) {
                var inner = s.querySelector('.region-inner');
                if (inner) {
                    inner.inert = !forceOpen && s.classList.contains('is-collapsed');
                }
            });
        }
        var totalVisible = 0;
        sections.forEach(function (section) {
            var visible = 0;
            itemsOf(section).forEach(function (li) {
                var matchText = !term || li._erText.indexOf(term) !== -1;
                var matchType = !typeOn || typeFilters.has(li.dataset.type);
                var done = !!li.querySelector('input[type="checkbox"]:checked');
                var optOut = hideOpt && li.hasAttribute('data-optional');
                var achOut = achMode && !li.hasAttribute('data-ach') &&
                    !li.classList.contains('note') && !li.classList.contains('choice-head') &&
                    !li.classList.contains('choice');
                var matchQuest = !questOn || liMatchesQuest(li);
                var show = matchText && matchType && matchQuest && !(hideDone && done) && !optOut && !achOut;
                li.hidden = !show;
                if (show) { visible++; }
            });
            section.hidden = anyActive && visible === 0;
            totalVisible += visible;
        });
        noResults.hidden = !(anyActive && totalVisible === 0);
        highlight(term);
    }

    var filterTimer;
    filterInput.addEventListener('input', function () {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(applyFilter, 120);
    });
    filterInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && filterInput.value) {
            e.stopPropagation();            // don't also close the drawer
            filterInput.value = '';
            clearTimeout(filterTimer);
            applyFilter();
        }
    });
    // press "/" anywhere to jump to the filter
    document.addEventListener('keydown', function (e) {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) { return; }
        var el = document.activeElement;
        var tag = el && el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) { return; }
        e.preventDefault();
        filterInput.focus();
        filterInput.select();
    });
    hideDoneBtn.addEventListener('click', function () {
        hideDoneBtn.setAttribute('aria-pressed', hideDoneOn() ? 'false' : 'true');
        applyFilter();
    });

    // category chips are independent toggles now — check Boss + Loot together,
    // etc. "All" is the clear-all shortcut and lights up when nothing is picked.
    function syncTypeUI() {
        chips.forEach(function (c) {
            var on = c === allChip ? typeFilters.size === 0 : typeFilters.has(c.dataset.type);
            c.classList.toggle('is-on', on);
            c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    function toggleType(chip) {
        if (chip === allChip) { typeFilters.clear(); }
        else if (typeFilters.has(chip.dataset.type)) { typeFilters.delete(chip.dataset.type); }
        else { typeFilters.add(chip.dataset.type); }
        setJSON('er_types', Array.from(typeFilters));
        syncTypeUI();
        applyFilter();
    }
    chipRow.addEventListener('click', function (e) {
        var chip = e.target.closest('.er-chip[data-type]');
        if (chip) { toggleType(chip); }
    });

    document.addEventListener('change', function (e) {
        if (e.target && e.target.matches && e.target.matches('#tabPlaythrough li[data-id] input[type="checkbox"]')) {
            if (hideDoneOn()) { applyFilter(); }
        }
    });

    /* side-quest filter: a row of NPC pills always in the toolbar, plus the
       matching inline badges on the rows — multi-select, combinable with
       the category chips. Click a pill (either place) to add its quest,
       click an active (filled) one to drop it. */
    var questTray = toolbar.querySelector('.er-quest-tray');
    var questClearBtn = toolbar.querySelector('.er-quest-clear');

    var questPresent = {};
    pane.querySelectorAll('li[data-quest]').forEach(function (li) {
        (li.getAttribute('data-quest') || '').trim().split(/\s+/).forEach(function (s) {
            if (s) { questPresent[s] = true; }
        });
    });
    Object.keys(ER_QUESTS)
        .filter(function (s) { return questPresent[s]; })
        .sort(function (a, b) { return ER_QUESTS[a].localeCompare(ER_QUESTS[b]); })
        .forEach(function (s) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'er-quest-badge er-quest-tray-pill';
            b.dataset.q = s;
            b.textContent = ER_QUESTS[s];
            questTray.appendChild(b);
        });
    // forget any persisted slug that is no longer in the DOM
    Array.from(questFilters).forEach(function (s) {
        if (!questPresent[s]) { questFilters.delete(s); }
    });

    function syncQuestUI() {
        // the toolbar tray lives inside `pane`, so this covers both it and
        // the inline row badges in one pass
        pane.querySelectorAll('.er-quest-badge').forEach(function (b) {
            b.classList.toggle('is-active', questFilters.has(b.dataset.q));
        });
        questClearBtn.hidden = questFilters.size === 0;
    }
    function toggleQuest(slug) {
        if (!slug) { return; }
        if (questFilters.has(slug)) { questFilters.delete(slug); }
        else { questFilters.add(slug); }
        setJSON('er_quests', Array.from(questFilters));
        syncQuestUI();
        applyFilter();
    }
    pane.addEventListener('click', function (e) {
        var b = e.target.closest('.er-quest-badge');
        if (!b) { return; }
        e.preventDefault();
        toggleQuest(b.dataset.q);
    });
    questClearBtn.addEventListener('click', function () {
        questFilters.clear();
        setJSON('er_quests', []);
        syncQuestUI();
        applyFilter();
    });

    // reflect persisted category / quest picks before the first filter pass
    syncTypeUI();
    syncQuestUI();
    syncToolbarHeight();   // the pill row changes the sticky-toolbar height
    if (typeFilters.size || questFilters.size) { applyFilter(); }

    /* ------------------------------------------------------------------ *
     *  5. Collapsible region sidebar
     * ------------------------------------------------------------------ */

    var STORE_KEY = 'er_toc_open';

    function drawerFocusables() {
        return Array.prototype.slice
            .call(sidebar.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])'))
            .filter(function (el) { return el.offsetParent !== null; });
    }

    function setOpen(open, userAction) {
        body.classList.toggle('toc-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
        if ('inert' in HTMLElement.prototype) { sidebar.inert = !open; }
        if (userAction !== false) {
            try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch (e) {}
            if (open) {
                var f = drawerFocusables();
                if (f.length) { f[0].focus(); }
            } else if (sidebar.contains(document.activeElement)) {
                toggle.focus();
            }
        }
    }

    var storedOpen = null;
    try { storedOpen = localStorage.getItem(STORE_KEY); } catch (e) {}
    setOpen(storedOpen === '1', false);

    toggle.addEventListener('click', function () {
        setOpen(!body.classList.contains('toc-open'));
    });
    overlay.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && body.classList.contains('toc-open')) { setOpen(false); }
    });

    // trap Tab focus inside the drawer while it is open
    sidebar.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') { return; }
        var f = drawerFocusables();
        if (!f.length) { return; }
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    sidebar.addEventListener('click', function (e) {
        var link = e.target.closest('a[href^="#"]');
        if (!link) { return; }
        var id = link.getAttribute('href').slice(1);
        var section = pane.querySelector('.region[data-region="' + esc(id) + '"]');
        if (section) { setCollapsed(section, false); persistCollapsed(); refreshCollapseAllLabel(); }
        if (window.innerWidth < 1000) { setOpen(false); }
        // land keyboard focus on the region heading, not back on the toggle
        var h = document.getElementById(id);
        if (h) { h.focus({ preventScroll: true }); }
        // let the browser make the jump, then drop the #hash so it can't
        // override the saved reading position on the next reload
        setTimeout(function () {
            if (location.hash === '#' + id) {
                history.replaceState(null, '', location.pathname + location.search);
            }
        }, 0);
    });

    /* ------------------------------------------------------------------ *
     *  6. Scroll-spy — highlight the region currently in view
     * ------------------------------------------------------------------ */

    var headings = Array.prototype.slice.call(pane.querySelectorAll('h3[id]'));
    var navItems = {};
    headings.forEach(function (h) {
        var a = sidebar.querySelector('a[href="#' + esc(h.id) + '"]');
        if (a) { navItems[h.id] = a.parentNode; }
    });

    function setCurrent(id) {
        for (var key in navItems) {
            navItems[key].classList.toggle('toc-current', key === id);
        }
    }
    function visibleHeadings() {
        return headings.filter(function (h) { return h.getClientRects().length > 0; });
    }

    if ('IntersectionObserver' in window) {
        // a region is "current" while its heading sits in a band just under the toolbar
        var inBand = new Set();
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { inBand.add(e.target); } else { inBand.delete(e.target); }
            });
            var vis = visibleHeadings();
            var cur = null;
            for (var i = 0; i < vis.length; i++) {
                if (inBand.has(vis[i])) { cur = vis[i]; break; }   // topmost heading in the band
            }
            if (!cur) {                                             // none in band: last one above it
                for (var j = 0; j < vis.length; j++) {
                    if (vis[j].getBoundingClientRect().top < 150) { cur = vis[j]; } else { break; }
                }
            }
            setCurrent(cur ? cur.id : null);
        }, { rootMargin: '-140px 0px -70% 0px' });
        headings.forEach(function (h) { spy.observe(h); });
    } else {
        var ticking = false;
        function onScroll() {
            if (ticking) { return; }
            ticking = true;
            requestAnimationFrame(function () {
                ticking = false;
                var vis = visibleHeadings();
                var cur = null;
                for (var i = 0; i < vis.length; i++) {
                    if (vis[i].getBoundingClientRect().top <= 140) { cur = vis[i]; } else { break; }
                }
                setCurrent(cur ? cur.id : null);
            });
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        onScroll();
    }

    /* ------------------------------------------------------------------ *
     *  7. Remember the reading position across reloads
     *  (collapsed regions are already persisted under 'er_collapsed')
     * ------------------------------------------------------------------ */

    var SCROLL_KEY = 'er_scroll';
    if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; }

    var anchorables = Array.prototype.slice.call(
        pane.querySelectorAll('h3[id], li[data-id]')
    );
    function readingLine() { return (toolbar.offsetHeight || 0) + 8; }

    // the heading / row sitting closest to just under the sticky toolbar
    function topAnchor() {
        var line = readingLine();
        var best = null, bestTop = -Infinity;
        for (var k = 0; k < anchorables.length; k++) {
            var el = anchorables[k];
            if (el.hidden) { continue; }
            var rects = el.getClientRects();
            if (!rects.length) { continue; }
            var t = rects[0].top;
            if (t <= line + 1 && t > bestTop) { best = el; bestTop = t; }
        }
        if (!best) { return null; }
        return { id: best.id || best.getAttribute('data-id'),
                 delta: Math.round(line - bestTop) };
    }

    var saveScrollTimer;
    function saveScroll() {
        if (body.classList.contains('er-filtering')) { return; }
        var a = topAnchor();
        if (a && a.id) { setJSON(SCROLL_KEY, a); }
    }
    window.addEventListener('scroll', function () {
        clearTimeout(saveScrollTimer);
        saveScrollTimer = setTimeout(saveScroll, 300);
    }, { passive: true });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { saveScroll(); }
    });
    window.addEventListener('pagehide', saveScroll);

    var scrollRestored = false;
    function restoreScroll() {
        if (scrollRestored) { return; }
        scrollRestored = true;
        if (location.hash || window.pageYOffset > 4) { return; }  // deep link / already moving
        var a = getJSON(SCROLL_KEY, null);
        if (!a || !a.id) { return; }
        var el = pane.querySelector('[data-id="' + esc(a.id) + '"]') ||
                 document.getElementById(a.id);
        if (!el) { return; }
        var sec = el.closest && el.closest('.region');
        if (sec && sec.classList.contains('is-collapsed')) {
            el = sec.querySelector('h3[id]') || el;   // row is folded away: aim at its heading
        }
        var y = el.getBoundingClientRect().top + window.pageYOffset
              - readingLine() + (a.delta || 0);
        window.scrollTo(0, Math.max(0, y));
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { requestAnimationFrame(restoreScroll); });
    }
    setTimeout(restoreScroll, 500);   // fallback if web fonts are slow or absent

    /* ------------------------------------------------------------------ *
     *  8. Per-region Toggle / Clear (staggered) + back-to-top button
     * ------------------------------------------------------------------ */

    var prefersReducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // walk a list of checkboxes, clicking the ones not already at `target`
    // one every `delay` ms so the check marks cascade
    function bulkSet(inputs, target) {
        var delay = prefersReducedMotion ? 0 : 12;
        if (!delay) {
            inputs.forEach(function (cb) { if (cb.checked !== target) { cb.click(); } });
            return;
        }
        var i = 0;
        (function step() {
            while (i < inputs.length && inputs[i].checked === target) { i++; }
            if (i >= inputs.length) { return; }
            inputs[i++].click();
            setTimeout(step, delay);
        })();
    }

    sections.forEach(function (section) {
        var head = section.querySelector('.region-head');
        if (!head) { return; }

        var actions = document.createElement('div');
        actions.className = 'region-actions';
        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = 'Toggle';
        toggleBtn.title = 'Check all / uncheck all in this region';
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.title = 'Uncheck everything in this region';
        actions.appendChild(toggleBtn);
        actions.appendChild(clearBtn);
        head.appendChild(actions);

        function taskInputs() {
            return Array.prototype.slice.call(section.querySelectorAll(
                'li[data-id]:not(.note):not(.choice-head):not(.choice) > label > input[type="checkbox"]'
            ));
        }
        function run(target) {
            if (section.classList.contains('is-collapsed')) {   // reveal the cascade
                setCollapsed(section, false);
                persistCollapsed();
                refreshCollapseAllLabel();
            }
            bulkSet(taskInputs(), target);
        }
        toggleBtn.addEventListener('click', function () {
            var inputs = taskInputs();
            var allChecked = inputs.length > 0 &&
                inputs.every(function (c) { return c.checked; });
            run(!allChecked);
        });
        clearBtn.addEventListener('click', function () { run(false); });
    });

    // back-to-top: fades in past a scroll threshold
    var toTop = document.createElement('button');
    toTop.id = 'erToTop';
    toTop.type = 'button';
    toTop.setAttribute('aria-label', 'Back to top');
    toTop.textContent = '↑';
    body.appendChild(toTop);
    window.addEventListener('scroll', function () {
        toTop.classList.toggle('is-visible', window.pageYOffset > 400);
    }, { passive: true });
    toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });

})();
