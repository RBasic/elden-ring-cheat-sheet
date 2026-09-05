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
    var collapsed = new Set(getJSON(COLLAPSE_KEY, []));

    Array.prototype.slice.call(pane.querySelectorAll('h3[id]')).forEach(function (h3) {
        var section = document.createElement('section');
        section.className = 'region';
        section.dataset.region = h3.id;

        var head = document.createElement('div');
        head.className = 'region-head';

        var bodyWrap = document.createElement('div');
        bodyWrap.className = 'region-body';

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
            bodyWrap.appendChild(sib);
        }
        if (collapsed.has(h3.id)) { section.classList.add('is-collapsed'); }
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
    var typeCounts = {};
    var everyItem = Array.prototype.slice.call(pane.querySelectorAll('li[data-id]'));
    everyItem.forEach(function (li) {
        var ty = classify(li.textContent);
        if (ty) { li.dataset.type = ty; }
        typeCounts[ty || ''] = (typeCounts[ty || ''] || 0) + 1;
    });
    // the "All" count must line up with main.js calculateTotals(): the
    // "pick one" label is not a task, and each exclusive choice group
    // counts as a single item however many options it has
    var choiceOpts = Array.prototype.slice.call(pane.querySelectorAll('li.choice[data-choice-group]'));
    var choiceGroupCount = new Set(choiceOpts.map(function (li) { return li.dataset.choiceGroup; })).size;
    typeCounts[''] = everyItem.length
        - pane.querySelectorAll('li.choice-head').length
        - (choiceOpts.length - choiceGroupCount);

    // put the region sections in the same order as the sidebar nav
    // (the source HTML has a few regions out of progression order)
    Array.prototype.forEach.call(sidebar.querySelectorAll('a[href^="#"]'), function (a) {
        var sec = pane.querySelector('.region[data-region="' + esc(a.getAttribute('href').slice(1)) + '"]');
        if (sec) { pane.appendChild(sec); }
    });

    var sections = Array.prototype.slice.call(pane.querySelectorAll('.region'));

    function persistCollapsed() { setJSON(COLLAPSE_KEY, Array.prototype.slice.call(collapsed)); }

    function setCollapsed(section, state) {
        section.classList.toggle('is-collapsed', state);
        var cbtn = section.querySelector('.region-collapse');
        if (cbtn) { cbtn.setAttribute('aria-expanded', state ? 'false' : 'true'); }
        if (state) { collapsed.add(section.dataset.region); }
        else { collapsed.delete(section.dataset.region); }
    }

    pane.addEventListener('click', function (e) {
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
        '<div class="er-row er-chips" role="radiogroup" aria-label="Filter by category">' +
            '<button type="button" class="er-chip is-on" role="radio" aria-checked="true" tabindex="0" data-type="">All</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="boss">Boss</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="dungeon">Dungeons</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="loot">Loot</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="npc">NPCs</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="grace">Graces</button>' +
            '<button type="button" class="er-chip" role="radio" aria-checked="false" tabindex="-1" data-type="shop">Shops</button>' +
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
            location.reload();
        });
    }

    /* ------------------------------------------------------------------ *
     *  4. Filter + hide-completed
     * ------------------------------------------------------------------ */

    var filterInput = document.getElementById('erFilter');
    var hideDoneBtn = document.getElementById('erHideDone');
    var chipRow = toolbar.querySelector('.er-chips');
    var chips = Array.prototype.slice.call(chipRow.querySelectorAll('.er-chip'));
    var typeFilter = '';

    // show how many tasks each category holds
    chips.forEach(function (c) {
        var n = typeCounts[c.dataset.type] || 0;
        if (!n) { return; }
        var b = document.createElement('span');
        b.className = 'er-chip-n';
        b.textContent = n;
        c.appendChild(b);
    });

    function hideDoneOn() { return hideDoneBtn.getAttribute('aria-pressed') === 'true'; }

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

    function applyFilter() {
        var term = filterInput.value.trim().toLowerCase();
        var hideDone = hideDoneOn();
        var anyActive = !!term || hideDone || !!typeFilter;
        // text search or a category chip force-opens the regions
        body.classList.toggle('er-filtering', !!term || !!typeFilter);
        var totalVisible = 0;
        sections.forEach(function (section) {
            var visible = 0;
            itemsOf(section).forEach(function (li) {
                var matchText = !term || li._erText.indexOf(term) !== -1;
                var matchType = !typeFilter || li.dataset.type === typeFilter;
                var done = !!li.querySelector('input[type="checkbox"]:checked');
                var show = matchText && matchType && !(hideDone && done);
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

    function selectChip(chip) {
        typeFilter = chip.dataset.type;
        chips.forEach(function (c) {
            var on = c === chip;
            c.classList.toggle('is-on', on);
            c.setAttribute('aria-checked', on ? 'true' : 'false');
            c.tabIndex = on ? 0 : -1;
        });
        applyFilter();
    }
    chipRow.addEventListener('click', function (e) {
        var chip = e.target.closest('.er-chip');
        if (chip) { selectChip(chip); }
    });
    chipRow.addEventListener('keydown', function (e) {
        var i = chips.indexOf(e.target);
        if (i === -1) { return; }
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { next = chips[(i + 1) % chips.length]; }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { next = chips[(i - 1 + chips.length) % chips.length]; }
        if (next) { e.preventDefault(); selectChip(next); next.focus(); }
    });

    document.addEventListener('change', function (e) {
        if (e.target && e.target.matches && e.target.matches('#tabPlaythrough li[data-id] input[type="checkbox"]')) {
            if (hideDoneOn()) { applyFilter(); }
        }
    });

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

})();
