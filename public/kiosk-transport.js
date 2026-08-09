'use strict';

/**
 * Floor kiosk transport — HTTP only (request/response + polling).
 * Dashboard uses Socket.IO; kiosk never loads socket.io.js.
 */
(function (global) {
  var POLL_STATE_MS = /Android/i.test(navigator.userAgent || '') ? 5000 : 3000;
  var POLL_CONFIG_MS = 30000;
  var HEALTH_RETRY_MS = 8000;
  var WATCHDOG_MS = 45000;
  var FETCH_TIMEOUT_MS = 12000;
  var MAX_POLL_FAILURES = 3;
  var KIOSK_STATE_URL = '/api/kiosk/state';

  var stateTimer = null;
  var configTimer = null;
  var healthTimer = null;
  var watchdogTimer = null;
  var hooks = null;
  var serverReachable = false;
  var queue = [];
  var queueBusy = false;
  var pollFailures = 0;

  var RPC_PATHS = {
    req_lookup: '/api/kiosk/lookup',
    req_startWork: '/api/kiosk/start-work',
    req_finishWork: '/api/kiosk/finish-work',
  };

  function hostLabel() {
    try {
      return window.location.host || 'server';
    } catch (_) {
      return 'server';
    }
  }

  function notifyConnection(online, label) {
    if (hooks && typeof hooks.onConnectionChange === 'function') {
      hooks.onConnectionChange(online, label);
    }
  }

  function reportProbe(outcome, detail) {
    try {
      fetch('/api/debug-kiosk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'transport probe',
          data: Object.assign({ outcome: outcome, host: hostLabel() }, detail || {}),
          hypothesisId: 'H10',
          pageUrl: String(window.location.href || ''),
        }),
        cache: 'no-store',
        credentials: 'same-origin',
      }).catch(function () {});
    } catch (_) {}
  }

  function fetchTimed(url, options) {
    if (global.AbayaClientCommon && typeof global.AbayaClientCommon.fetchWithTimeout === 'function') {
      return global.AbayaClientCommon.fetchWithTimeout(url, options, FETCH_TIMEOUT_MS);
    }
    var opts = options || {};
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (_) {}
    }, FETCH_TIMEOUT_MS);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () {
      clearTimeout(timer);
    });
  }

  function enqueue(fn) {
    queue.push(fn);
    if (!queueBusy) drainQueue();
  }

  function drainQueue() {
    if (!queue.length) {
      queueBusy = false;
      return;
    }
    queueBusy = true;
    var next = queue.shift();
    var released = false;
    function done() {
      if (released) return;
      released = true;
      drainQueue();
    }
    var guard = setTimeout(function () {
      done();
    }, FETCH_TIMEOUT_MS + 2000);
    try {
      next(function () {
        clearTimeout(guard);
        done();
      });
    } catch (_) {
      clearTimeout(guard);
      done();
    }
  }

  function fetchQueued(url, options, cb) {
    enqueue(function (done) {
      fetchTimed(url, options)
        .then(function (r) {
          cb(null, r);
          done();
        })
        .catch(function (e) {
          cb(e, null);
          done();
        });
    });
  }

  function isNetworkAbort(err) {
    var m = err && err.message ? String(err.message) : String(err || '');
    var n = err && err.name ? String(err.name) : '';
    return n === 'AbortError' || /abort/i.test(m) || /failed to fetch/i.test(m);
  }

  /** One short request — avoids doubling Android Chrome connection slots (ping + health). */
  function probeHealth(cb) {
    fetchQueued('/api/health', { cache: 'no-store', credentials: 'same-origin', method: 'GET' }, function (err, r) {
      if (err) {
        reportProbe('fail', {
          err: err.message || String(err),
          aborted: isNetworkAbort(err),
        });
        cb(err, false);
        return;
      }
      r.json()
        .then(function (j) {
          var ok = !!(r.ok && j && j.ok);
          reportProbe(ok ? 'health-ok' : 'health-bad', { status: r.status, transport: j && j.floorKioskTransport });
          cb(null, ok);
        })
        .catch(function (e) {
          reportProbe('fail', { parseErr: e.message || String(e) });
          cb(e, false);
        });
    });
  }

  function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      navigator.wakeLock
        .request('screen')
        .then(function (lock) {
          if (lock && typeof lock.addEventListener === 'function') {
            lock.addEventListener('release', function () {
              if (document.visibilityState === 'visible' && serverReachable) {
                requestWakeLock();
              }
            });
          }
        })
        .catch(function () {});
    } catch (_) {}
  }

  function stopTimers() {
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
    if (configTimer) {
      clearInterval(configTimer);
      configTimer = null;
    }
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function pollIntervalMs() {
    return document.hidden ? 10000 : POLL_STATE_MS;
  }

  function restartStateTimer() {
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
    if (!serverReachable) return;
    stateTimer = setInterval(refreshState, pollIntervalMs());
  }

  function refreshState() {
    if (!serverReachable || !hooks || typeof hooks.onRefreshState !== 'function') return;
    fetchQueued(KIOSK_STATE_URL, { cache: 'no-store', credentials: 'same-origin', method: 'GET' }, function (err, r) {
      if (err || !r || !r.ok) {
        pollFailures += 1;
        if (pollFailures >= MAX_POLL_FAILURES) {
          pollFailures = 0;
          onHealthResult(false);
        }
        return;
      }
      r.json()
        .then(function (j) {
          if (j && j.ok && j.state) {
            pollFailures = 0;
            hooks.onRefreshState(j.state);
            return;
          }
          pollFailures += 1;
          if (pollFailures >= MAX_POLL_FAILURES) {
            pollFailures = 0;
            onHealthResult(false);
          }
        })
        .catch(function () {
          pollFailures += 1;
          if (pollFailures >= MAX_POLL_FAILURES) {
            pollFailures = 0;
            onHealthResult(false);
          }
        });
    });
  }

  function startTimers() {
    stopTimers();
    pollFailures = 0;
    refreshState();
    restartStateTimer();
    if (hooks && typeof hooks.onPollConfig === 'function') {
      setTimeout(function () {
        enqueue(function (done) {
          hooks.onPollConfig();
          done();
        });
      }, 4000);
      configTimer = setInterval(function () {
        enqueue(function (done) {
          hooks.onPollConfig();
          done();
        });
      }, POLL_CONFIG_MS);
    }
    watchdogTimer = setInterval(function () {
      if (!serverReachable) return;
      probeHealth(function (_e, ok) {
        if (!ok) {
          pollFailures += 1;
          if (pollFailures >= 2) onHealthResult(false);
        } else {
          pollFailures = 0;
        }
      });
    }, WATCHDOG_MS);
  }

  function onHealthResult(ok) {
    var wasReachable = serverReachable;
    serverReachable = ok;
    if (ok) {
      pollFailures = 0;
      notifyConnection(true, 'LAN · ' + hostLabel());
      startTimers();
      requestWakeLock();
      if (!wasReachable && hooks && typeof hooks.onServerOnline === 'function') {
        hooks.onServerOnline();
      }
      return;
    }
    notifyConnection(false, 'No server @ ' + hostLabel() + ' — open lan-check.html or fix IP/firewall');
    stopTimers();
    scheduleHealthRecheck();
  }

  function scheduleHealthRecheck() {
    if (healthTimer) return;
    healthTimer = setInterval(function () {
      if (serverReachable) {
        clearInterval(healthTimer);
        healthTimer = null;
        return;
      }
      probeHealth(function (_e, ok) {
        if (ok) onHealthResult(true);
      });
    }, HEALTH_RETRY_MS);
  }

  function rpc(event, payload, cb) {
    var path = RPC_PATHS[event];
    if (!path) {
      cb({ ok: false, error: 'Unknown kiosk action' });
      return;
    }
    var body =
      event === 'req_lookup' ? { ac_no: payload } : payload && typeof payload === 'object' ? payload : {};
    fetchQueued(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
      },
      function (err, r) {
        if (err || !r) {
          cb({ ok: false, error: (err && err.message) || 'Network error' });
          return;
        }
        r.json()
          .then(function (j) {
            var out = j && typeof j === 'object' ? j : { ok: false, error: 'Invalid server response' };
            cb(out);
            if (out.ok) refreshState();
          })
          .catch(function () {
            cb({ ok: false, error: 'Invalid server response' });
          });
      }
    );
  }

  function installLifecycle() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') {
        if (stateTimer) {
          clearInterval(stateTimer);
          stateTimer = null;
        }
        return;
      }
      probeHealth(function (_e, ok) {
        if (!ok) {
          onHealthResult(false);
          return;
        }
        if (!serverReachable) onHealthResult(true);
        else {
          refreshState();
          restartStateTimer();
          requestWakeLock();
        }
      });
    });
    window.addEventListener('online', function () {
      probeHealth(function (_e, ok) {
        onHealthResult(ok);
      });
    });
  }

  function start(options) {
    hooks = options || {};
    notifyConnection(false, 'LAN · connecting');
    installLifecycle();
    probeHealth(function (_e, ok) {
      onHealthResult(ok);
    });
  }

  global.AbaYaKioskTransport = {
    start: start,
    rpc: rpc,
    mode: 'http',
    isReachable: function () {
      return serverReachable;
    },
    stop: function () {
      stopTimers();
      serverReachable = false;
      pollFailures = 0;
      queue = [];
      queueBusy = false;
    },
  };
})(window);
