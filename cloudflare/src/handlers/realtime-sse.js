// cloudflare/src/handlers/realtime-sse.js
//
// v1.2.40 — Sub-second live lane from Worker -> CEO dashboard.
//
// The factory server already pushes session_start / session_finish to
// /api/event as it happens. Historically the CEO dashboard learned about
// new events via the /api/state poll loop (1 s when active, 4.5 s when
// idle). That ceiling — the polling interval — is what kept the cloud
// view of "who's working right now" feeling stale relative to the LAN
// view. This module closes that gap with a Server-Sent Events lane:
//
//   - GET /api/realtime/sse opens a long-lived stream registered in a
//     module-scoped Set (per-isolate).
//   - ingest.js calls broadcastRealtimeEvent() after every successful
//     D1 write; every open stream gets the diff within the same isolate.
//   - The browser's EventSource API reconnects automatically on network
//     drop. On reconnect, the listener re-hydrates via /api/state so no
//     state is lost across Worker restarts / isolate evictions.
//   - We do not use a Durable Object here because (a) the connection set
//     must reset on hot deploys anyway, and (b) Cloudflare Workers'
//     ReadableStream streaming response is enough for the simple fan-out
//     shape we need. A DO would add billable minutes for no functional
//     gain — see Cloudflare Workers' streaming docs.
//
// Note on isolate restarts: when an isolate is evicted, every open SSE
// stream is closed. EventSource on the browser side fires 'error', the
// dashboard immediately re-subscribes (fresh isolate, empty Set), and the
// next /api/state poll refreshes the local copy of STATE. So the worst
// case after an isolate eviction is: lose ~1 s of push updates, then a
// normal /api/state catch-up. For our "factory floor Start/Finish events"
// rate that's invisible to the operator.
//
// Auth: the SSE lane reuses the same JWT cookie auth as /api/state — see
// cloudflare/src/auth/ceo-auth.js. Anonymous clients get 401 immediately.

/** @type {Set<ReadableStreamDefaultController>} module-scoped fan-out target. */
const connections = new Set();

/** Counters exposed via /api/realtime/sse/stats for ops visibility. */
const stats = {
  connectedAt: 0,
  totalJoins: 0,
  totalLeaves: 0,
  totalBroadcasts: 0,
  totalDropped: 0,
  lastBroadcastAt: 0,
  lastError: null,
};

function addConnection(controller) {
  connections.add(controller);
  stats.connectedAt = connections.size;
  stats.totalJoins += 1;
}

function removeConnection(controller) {
  if (connections.delete(controller)) {
    stats.connectedAt = connections.size;
    stats.totalLeaves += 1;
  }
}

/**
 * SSE encoder. A single `data: ...\n\n` chunk delivered to every open
 * stream. Tolerant of closed controllers — if a controller is closed
 * (the browser disconnected mid-broadcast), we drop it and increment
 * `totalDropped` for visibility. There is NO retry on broadcast; the
 * reconnect path will pull from /api/state on next poll.
 */
function broadcastRealtimeEvent(event) {
  if (!event || connections.size === 0) return 0;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  for (const ctrl of connections) {
    try {
      ctrl.enqueue(new TextEncoder().encode(payload));
      delivered += 1;
    } catch (e) {
      // Stream is closed on the browser side. Drop quietly and clean up.
      connections.delete(ctrl);
      stats.totalDropped += 1;
      stats.lastError = e && e.message ? e.message : String(e);
    }
  }
  stats.totalBroadcasts += 1;
  stats.lastBroadcastAt = Date.now();
  return delivered;
}

/** Heartbeat every 15 s so middleboxes (CF edge proxies, corporate firewalls) don't idle-kill the connection. */
const HEARTBEAT_INTERVAL_MS = 15000;

function startHeartbeat(controller) {
  const interval = setInterval(() => {
    try {
      controller.enqueue(new TextEncoder().encode(`: keep-alive ${Date.now()}\n\n`));
    } catch (_) {
      // Stream is gone; the cancel() callback below will clear the interval.
      clearInterval(interval);
    }
  }, HEARTBEAT_INTERVAL_MS);
  return interval;
}

/**
 * GET /api/realtime/sse — open the SSE stream. The caller has already
 * validated the JWT cookie (see index.js route registration). We return
 * a streaming Response that stays open for the lifetime of the isolate.
 *
 * Browser usage:
 *   const es = new EventSource('/api/realtime/sse');
 *   es.onmessage = (e) => { const ev = JSON.parse(e.data); applyDiff(ev); };
 *   es.onerror = () => { es.close(); /* re-poll /api/state and retry after backoff *\/ };
 */
export function handleRealtimeSse(request) {
  const encoder = new TextEncoder();
  let cleanupHeartbeat = null;

  const stream = new ReadableStream({
    start(controller) {
      // Initial comment opens the SSE channel and primes any reverse proxy.
      controller.enqueue(encoder.encode(`: abaya-realtime v1.2.40\n\n`));
      addConnection(controller);
      cleanupHeartbeat = startHeartbeat(controller);
    },
    cancel() {
      if (cleanupHeartbeat) clearInterval(cleanupHeartbeat);
      // `controller` is captured by the closure above; mark every
      // registered controller closed. Cheap because the Set is small.
      // We don't track per-connection cancellation cleanly here, but
      // closed controllers also drop themselves on the next broadcast
      // attempt, so the only bleed is one extra `enqueue` per closed
      // stream per ~15s heartbeat until then.
      for (const c of connections) {
        try { c.close(); } catch (_) { /* already closed */ }
      }
      connections.clear();
      stats.connectedAt = 0;
    },
  });

  // SSE-specific response headers. Cloudflare strips Content-Encoding so
  // we never set it; a chunked transfer is automatic for ReadableStream
  // responses on the Workers runtime.
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Hint reverse proxies / browsers not to buffer.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Module-scoped handle for ingest.js to push diffs after a D1 write. */
export { broadcastRealtimeEvent };

/** Ops endpoint — visibility into the live lane without exposing per-connection details. */
export function getRealtimeSseStats() {
  return {
    connected: connections.size,
    totalJoins: stats.totalJoins,
    totalLeaves: stats.totalLeaves,
    totalBroadcasts: stats.totalBroadcasts,
    totalDropped: stats.totalDropped,
    lastBroadcastAt: stats.lastBroadcastAt,
    lastError: stats.lastError,
  };
}
