/* Collapsible region sidebar — vanilla, no dependencies.
   Works alongside main.js (jQuery) without touching its state. */
(function () {
    'use strict';

    var STORE_KEY = 'er_toc_open';
    var body = document.body;
    var toggle = document.getElementById('tocToggle');
    var sidebar = document.getElementById('tocSidebar');
    var overlay = document.getElementById('tocOverlay');
    if (!toggle || !sidebar || !overlay) { return; }

    function readStored() {
        try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    }
    function writeStored(val) {
        try { localStorage.setItem(STORE_KEY, val ? '1' : '0'); } catch (e) {}
    }

    function setOpen(open, persist) {
        body.classList.toggle('toc-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        overlay.hidden = !open;
        if (persist !== false) { writeStored(open); }
    }

    // initial state: closed by default; a stored preference re-opens it
    var stored = readStored();
    setOpen(stored === '1', false);

    toggle.addEventListener('click', function () {
        setOpen(!body.classList.contains('toc-open'));
    });
    overlay.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && body.classList.contains('toc-open')) { setOpen(false); }
    });

    // clicking a region link: let the jump happen, then close on narrow screens
    sidebar.addEventListener('click', function (e) {
        var link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (link && window.innerWidth < 1000) { setOpen(false); }
    });

    // hide the whole thing while the Help tab is active
    function syncTab() {
        var help = document.getElementById('tabHelp');
        var onHelp = help && help.classList.contains('active');
        body.classList.toggle('toc-hidden', !!onHelp);
        if (onHelp) { setOpen(false, false); }
    }
    Array.prototype.forEach.call(
        document.querySelectorAll('a[data-toggle="tab"]'),
        function (a) { a.addEventListener('click', function () { setTimeout(syncTab, 0); }); }
    );
    syncTab();

    // scroll-spy: mark the region currently in view
    var headings = Array.prototype.slice.call(
        document.querySelectorAll('#tabPlaythrough h3[id]')
    );
    var navLinks = {};
    headings.forEach(function (h) {
        var a = sidebar.querySelector('a[href="#' + CSS.escape(h.id) + '"]');
        if (a) { navLinks[h.id] = a.parentNode; }
    });

    var ticking = false;
    function updateActive() {
        ticking = false;
        var current = null;
        for (var i = 0; i < headings.length; i++) {
            if (headings[i].getBoundingClientRect().top <= 140) {
                current = headings[i].id;
            } else {
                break;
            }
        }
        for (var id in navLinks) {
            navLinks[id].classList.toggle('toc-current', id === current);
        }
    }
    function onScroll() {
        if (!ticking) { ticking = true; requestAnimationFrame(updateActive); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateActive();
})();
