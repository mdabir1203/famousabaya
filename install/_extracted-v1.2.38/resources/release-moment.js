/**
 * Outcome-first release banner (factory LAN + CEO if same script is served).
 * Dismiss key: localStorage abaya_release_dismiss_<momentId>
 */
(function () {
  'use strict';

  var NS = 'abaya_release_dismiss_';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function mountBanner(mountEl, data, surface) {
    if (!mountEl || !data || !data.enabled || !data.momentId) return;
    var key = NS + data.momentId;
    try {
      if (window.localStorage && window.localStorage.getItem(key)) return;
    } catch (_) {}

    var card = document.createElement('div');
    card.className = 'abaya-release-moment';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Product update');
    var cta = data.ctaPath || '/dashboard.html';
    var cta2 = data.secondaryCtaPath || '';
    var lab = data.ctaLabel || 'Explore';
    var lab2 = data.secondaryCtaLabel || '';
    var motion = prefersReducedMotion() ? '' : ' abaya-release-moment--motion';

    card.innerHTML =
      '<div class="abaya-release-moment__glow' + motion + '"></div>' +
      '<div class="abaya-release-moment__inner">' +
      '<div class="abaya-release-moment__copy">' +
      '<div class="abaya-release-moment__eyebrow">' +
      esc(data.eyebrow || 'Update') +
      '</div>' +
      '<h2 class="abaya-release-moment__hook">' +
      esc(data.hook || '') +
      '</h2>' +
      '<p class="abaya-release-moment__outcome">' +
      esc(data.outcome || '') +
      '</p>' +
      '</div>' +
      '<div class="abaya-release-moment__actions">' +
      '<a class="abaya-release-moment__btn abaya-release-moment__btn--primary" href="' +
      esc(cta) +
      '">' +
      esc(lab) +
      '</a>' +
      (cta2 && lab2
        ? '<a class="abaya-release-moment__btn abaya-release-moment__btn--ghost" href="' +
          esc(cta2) +
          '">' +
          esc(lab2) +
          '</a>'
        : '') +
      '<button type="button" class="abaya-release-moment__dismiss" aria-label="Dismiss update message">Not now</button>' +
      '</div></div>';

    mountEl.appendChild(card);

    var dismissBtn = card.querySelector('.abaya-release-moment__dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        try {
          window.localStorage.setItem(key, '1');
        } catch (_) {}
        card.remove();
      });
    }
  }

  function init(opts) {
    opts = opts || {};
    var apiPath = opts.apiPath || '/api/release-moment';
    var mount =
      typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount || document.getElementById('releaseMomentMount');
    if (!mount) return;

    fetch(apiPath, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var merged = Object.assign({}, data);
        if (opts.ctaPath) merged.ctaPath = opts.ctaPath;
        if (opts.ctaLabel) merged.ctaLabel = opts.ctaLabel;
        if (opts.secondaryCtaPath !== undefined) merged.secondaryCtaPath = opts.secondaryCtaPath;
        if (opts.secondaryCtaLabel !== undefined) merged.secondaryCtaLabel = opts.secondaryCtaLabel;
        mountBanner(mount, merged, opts.surface || '');
      })
      .catch(function () {});
  }

  window.AbaYaReleaseMoment = { init: init };
})();
