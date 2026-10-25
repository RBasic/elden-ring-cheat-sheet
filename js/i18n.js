/* FR / EN switch. Loaded at the end of <body>, right before sidebar.js, so
   the checklist text is swapped before sidebar.js and main.js decorate it.
   The dictionary lives in js/i18n-fr.js (window.ER_FR). Switching language
   reloads the page: every generated piece of UI is rebuilt in the new one. */
(function () {
    'use strict';

    var KEY = 'er_lang';
    var lang = 'en';
    try { if (localStorage.getItem(KEY) === 'fr') { lang = 'fr'; } } catch (e) {}

    var FR = window.ER_FR || {};
    var ui = (lang === 'fr' && FR.ui) || {};
    window.ER_LANG = lang;
    // UI string lookup: English text in, translated text out (or unchanged)
    window.erT = function (s) {
        return Object.prototype.hasOwnProperty.call(ui, s) ? ui[s] : s;
    };

    var langBtn = document.getElementById('langToggle');
    if (langBtn) {
        // both flags are in the button; the current language's one is lit
        langBtn.setAttribute('data-current', lang);
        langBtn.title = lang === 'fr' ? 'Switch to English' : 'Passer en français';
        langBtn.setAttribute('aria-label', langBtn.title);
        langBtn.addEventListener('click', function () {
            try { localStorage.setItem(KEY, lang === 'fr' ? 'en' : 'fr'); } catch (e) {}
            location.reload();
        });
    }

    if (lang !== 'fr') { return; }

    document.documentElement.lang = 'fr';
    if (FR.title) { document.title = FR.title; }

    /* Checklist rows. A template is the row's text with each link written
       as {link text}; links are filled in order, keeping their href. */
    var items = FR.items || {};
    Array.prototype.forEach.call(document.querySelectorAll('li[data-id]'), function (li) {
        var tpl = items[li.getAttribute('data-id')];
        if (tpl === undefined) { return; }
        li._erEn = li.textContent;   // sidebar.js still classifies rows on the English text
        var links = li.querySelectorAll('a');
        var frag = document.createDocumentFragment();
        var n = 0;
        tpl.split(/(\{[^}]*\})/).forEach(function (part) {
            if (!part) { return; }
            if (part.charAt(0) === '{' && part.charAt(part.length - 1) === '}' && links[n]) {
                var a = links[n++].cloneNode(false);
                a.textContent = part.slice(1, -1);
                frag.appendChild(a);
            } else {
                frag.appendChild(document.createTextNode(part));
            }
        });
        li.textContent = '';
        li.appendChild(frag);
    });

    /* Region titles: the <h3> and its sidebar link share one name. */
    var regions = FR.regions || {};
    Object.keys(regions).forEach(function (id) {
        var h3 = document.getElementById(id);
        if (h3 && h3.firstChild && h3.firstChild.nodeType === 3) {
            h3.firstChild.nodeValue = regions[id] + ' ';
        }
        var a = document.querySelector('#tocSidebar a[href="#' + id + '"]');
        if (a) { a.textContent = regions[id]; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.region-meta b, .region-meta-sub'), function (el) {
        el.textContent = window.erT(el.textContent);
    });

    /* Static page chrome: [selector, property, text] */
    (FR.chrome || []).forEach(function (c) {
        Array.prototype.forEach.call(document.querySelectorAll(c[0]), function (el) {
            if (c[1] === 'text') { el.textContent = c[2]; }
            else { el.setAttribute(c[1], c[2]); }
        });
    });

    /* Achievement names shown under the rows (sidebar.js renders them). */
    var ach = FR.achievements || {};
    (window.ER_ACHIEVEMENTS || []).forEach(function (a) {
        var t = ach[a.n];
        if (t) { a.name = t[0]; a.description = t[1]; }
    });
})();
