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

        var cbtn = document.createElement('button');
        cbtn.type = 'button';
        cbtn.className = 'region-collapse';
        cbtn.setAttribute('aria-label', 'Replier ou déplier cette région');
        cbtn.setAttribute('aria-expanded', collapsed.has(h3.id) ? 'false' : 'true');
        head.appendChild(cbtn);
        head.appendChild(h3);

        var wikiSrc = h3.querySelector('a[href]');
        if (wikiSrc && wikiSrc.getAttribute('href')) {
            var wiki = document.createElement('a');
            wiki.className = 'region-wiki';
            wiki.href = wikiSrc.href;
            wiki.target = '_blank';
            wiki.rel = 'noopener';
            wiki.textContent = '↗';
            wiki.setAttribute('aria-label', 'Open wiki page');
            head.appendChild(wiki);
        }

        section.appendChild(head);
        section.appendChild(bodyWrap);

        while (section.nextSibling) {
            var sib = section.nextSibling;
            if (sib.nodeType === 1 && sib.matches('h3[id], section.region')) { break; }
            bodyWrap.appendChild(sib);
        }
        if (collapsed.has(h3.id)) { section.classList.add('is-collapsed'); }
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
        if (e.target.closest('a.region-wiki')) { return; }   // real wiki link works
        if (e.target.closest('a')) { e.preventDefault(); }    // title link toggles instead
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
        '<div class="er-row">' +
            '<span class="er-progress" role="progressbar" aria-label="Progression globale"' +
                ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
                '<span class="er-progress-fill"></span>' +
            '</span>' +
            '<span class="er-progress-pct">0%</span>' +
        '</div>' +
        '<div class="er-row">' +
            '<input id="erFilter" type="search" placeholder="Filtrer les tâches…" autocomplete="off">' +
            '<button type="button" id="erHideDone" aria-pressed="false">Masquer les faits</button>' +
            '<button type="button" id="erCollapseAll">Tout replier</button>' +
        '</div>';
    pane.insertBefore(toolbar, pane.firstChild);

    var noResults = document.createElement('p');
    noResults.className = 'er-no-results';
    noResults.textContent = 'Aucune tâche ne correspond à ce filtre.';
    noResults.hidden = true;
    pane.appendChild(noResults);
    // move the existing sidebar toggle into the toolbar
    toolbar.querySelector('.er-row').insertBefore(toggle, toolbar.querySelector('.er-progress'));

    var progFill = toolbar.querySelector('.er-progress-fill');
    var progPct = toolbar.querySelector('.er-progress-pct');
    var progWrap = toolbar.querySelector('.er-progress');
    var overallSpan = document.getElementById('playthrough_overall_total');

    function syncProgress() {
        var t = (overallSpan.textContent || '').trim();
        var p = t === 'DONE' ? 100 : (parseInt(t, 10) || 0);
        progFill.style.width = p + '%';
        progPct.textContent = p + '%';
        progWrap.setAttribute('aria-valuenow', p);
        progWrap.classList.toggle('is-done', p === 100);
    }
    if (overallSpan) {
        new MutationObserver(syncProgress).observe(overallSpan, {
            childList: true, characterData: true, subtree: true
        });
        syncProgress();
    }

    /* ------------------------------------------------------------------ *
     *  3. Collapse-all / expand-all
     * ------------------------------------------------------------------ */

    var collapseAllBtn = document.getElementById('erCollapseAll');
    function refreshCollapseAllLabel() {
        var anyOpen = sections.some(function (s) { return !s.classList.contains('is-collapsed'); });
        collapseAllBtn.textContent = anyOpen ? 'Tout replier' : 'Tout déplier';
    }
    collapseAllBtn.addEventListener('click', function () {
        var anyOpen = sections.some(function (s) { return !s.classList.contains('is-collapsed'); });
        sections.forEach(function (s) { setCollapsed(s, anyOpen); });
        persistCollapsed();
        refreshCollapseAllLabel();
    });
    refreshCollapseAllLabel();

    /* ------------------------------------------------------------------ *
     *  4. Filter + hide-completed
     * ------------------------------------------------------------------ */

    var filterInput = document.getElementById('erFilter');
    var hideDoneBtn = document.getElementById('erHideDone');

    function hideDoneOn() { return hideDoneBtn.getAttribute('aria-pressed') === 'true'; }

    function topLevelItems(section) {
        return Array.prototype.slice.call(section.querySelectorAll('li[data-id]')).filter(function (li) {
            return !li.parentElement.closest('li[data-id]');
        });
    }

    function applyFilter() {
        var term = filterInput.value.trim().toLowerCase();
        var hideDone = hideDoneOn();
        var anyActive = !!term || hideDone;
        body.classList.toggle('er-filtering', !!term);   // only text search force-opens regions
        var totalVisible = 0;
        sections.forEach(function (section) {
            var visible = 0;
            topLevelItems(section).forEach(function (li) {
                var matchText = !term || li.textContent.toLowerCase().indexOf(term) !== -1;
                var done = !!li.querySelector('input[type="checkbox"]:checked');
                var show = matchText && !(hideDone && done);
                li.hidden = !show;
                if (show) { visible++; }
            });
            section.hidden = anyActive && visible === 0;
            totalVisible += visible;
        });
        noResults.hidden = !(anyActive && totalVisible === 0);
    }
    filterInput.addEventListener('input', applyFilter);
    hideDoneBtn.addEventListener('click', function () {
        hideDoneBtn.setAttribute('aria-pressed', hideDoneOn() ? 'false' : 'true');
        applyFilter();
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

    function setOpen(open, persist) {
        body.classList.toggle('toc-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        overlay.hidden = !open;
        if (persist !== false) {
            try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch (e) {}
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

    sidebar.addEventListener('click', function (e) {
        var link = e.target.closest('a[href^="#"]');
        if (!link) { return; }
        var id = link.getAttribute('href').slice(1);
        var section = pane.querySelector('.region[data-region="' + esc(id) + '"]');
        if (section) { setCollapsed(section, false); persistCollapsed(); refreshCollapseAllLabel(); }
        if (window.innerWidth < 1000) { setOpen(false); }
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

    var ticking = false;
    function updateActive() {
        ticking = false;
        var current = null;
        for (var i = 0; i < headings.length; i++) {
            if (headings[i].getBoundingClientRect().top <= 140) { current = headings[i].id; }
            else { break; }
        }
        for (var id in navItems) {
            navItems[id].classList.toggle('toc-current', id === current);
        }
    }
    function onScroll() {
        if (!ticking) { ticking = true; requestAnimationFrame(updateActive); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateActive();
})();
