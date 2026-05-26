/**
 * AbaYa Track — Dispatch Server PM2 configuration
 *
 * Start:   pm2 start ecosystem.config.cjs
 * Stop:    pm2 stop abaya-dispatch
 * Logs:    pm2 logs abaya-dispatch
 * Status:  pm2 status
 *
 * To survive Windows reboots (run once as Administrator):
 *   pm2 startup
 *   pm2 save
 */

'use strict';

module.exports = {
  apps: [
    {
      name: 'abaya-dispatch',
      script: './server.js',

      // ── Runtime ────────────────────────────────────────────────────────────
      interpreter: 'node',
      // --import ./sw-instrument.mjs  → starts the SkyWalking APM agent BEFORE
      //   server.js loads. It is a no-op unless SW_AGENT_COLLECTOR_BACKEND_SERVICES
      //   is set (see env below), so leaving it here never breaks a plain run.
      // --max-old-space-size=320      → heap cap (was 256; +64 MB headroom for the
      //   agent's span buffer). Triggers OOM exit so PM2 restarts cleanly.
      node_args: '--import ./sw-instrument.mjs --max-old-space-size=320',
      cwd: __dirname,
      instances: 1,       // single instance — SSE broadcast requires shared _clients Set
      exec_mode: 'fork',

      // ── Auto-restart policy ────────────────────────────────────────────────
      autorestart: true,
      watch: false,        // do NOT watch files; file changes on a live factory machine are noise
      max_memory_restart: '400M',  // safety net above node_args cap (raised for APM agent)
      restart_delay: 1500,         // wait 1.5 s before restarting (avoids EADDRINUSE spin)
      exp_backoff_restart_delay: 100,
      max_restarts: 999,   // effectively unlimited — always keep the server alive
      min_uptime: '3s',    // if it dies in < 3 s, that counts as a crash restart

      // ── Environment ────────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        DISPATCH_PORT: '3111',
        // ── Read access token ───────────────────────────────────────────────
        // REQUIRED when PUBLIC_URL is set, or the cloudflared tunnel leaks all
        // invoice data. Tablets open: https://<tunnel>/leaderboard?token=<value>
        // Empty default keeps LAN-only setups working. See .env.example.
        DISPATCH_VIEW_TOKEN: '',
        // ── SkyWalking APM ──────────────────────────────────────────────────
        // Set the collector address to ENABLE tracing. Leave empty to DISABLE.
        // OAP gRPC listens on localhost:11800 (see observability/docker-compose.yml).
        SW_AGENT_COLLECTOR_BACKEND_SERVICES: 'localhost:11800',
        SW_AGENT_NAME: 'abaya-dispatch',
        SW_AGENT_INSTANCE_NAME: 'factory-laptop',
      },
      env_development: {
        NODE_ENV: 'development',
        DISPATCH_PORT: '3111',
        DISPATCH_VIEW_TOKEN: '',  // dev is LAN-only — no token needed
        // Disabled by default in dev — set to localhost:11800 to trace locally.
        SW_AGENT_COLLECTOR_BACKEND_SERVICES: '',
        SW_AGENT_NAME: 'abaya-dispatch-dev',
        SW_AGENT_INSTANCE_NAME: 'dev-laptop',
      },

      // ── Logs ───────────────────────────────────────────────────────────────
      // Written to data/ which is gitignored — safe to accumulate locally.
      error_file: './data/pm2-dispatch-error.log',
      out_file:   './data/pm2-dispatch-out.log',
      time: true,        // prefix every log line with a timestamp
      merge_logs: false,

      // ── Graceful shutdown ──────────────────────────────────────────────────
      kill_timeout: 8000,    // give server.js 8 s to finish in-flight requests
      shutdown_with_message: false,

      // ── Source maps (helpful for stack traces in production) ───────────────
      source_map_support: false,
    },
  ],
};
