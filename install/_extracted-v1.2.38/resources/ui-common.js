(function () {
  function fmtHMS(sec) {
    var n = Math.floor(Number(sec) || 0);
    if (n < 1) return '0s';
    var h = Math.floor(n / 3600);
    var m = Math.floor((n % 3600) / 60);
    var s = n % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function showToast(msg, type) {
    var t = document.getElementById('toast');
    if (!t) return;
    var kind = type || 'info';
    t.className = 'toast ' + kind + ' show';
    t.textContent = msg;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove('show');
    }, 3500);
  }

  window.AbayaUiCommon = {
    fmtHMS: fmtHMS,
    showToast: showToast,
  };
})();
