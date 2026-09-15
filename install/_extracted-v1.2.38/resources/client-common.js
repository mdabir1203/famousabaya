'use strict';

(function initAbayaClientCommon() {
  function fetchJsonNoStore(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      return r.json();
    });
  }

  function installReconnectNudge(socket) {
    if (!socket) return;
    function nudge() {
      if (!socket.connected) socket.connect();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') nudge();
    });
    window.addEventListener('online', nudge);
  }

  window.AbayaClientCommon = {
    fetchJsonNoStore: fetchJsonNoStore,
    installReconnectNudge: installReconnectNudge,
  };
})();
