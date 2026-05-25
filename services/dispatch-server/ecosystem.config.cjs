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
      node_args: '--max-old-space-size=256',  // cap heap; triggers OOM exit so PM2 restarts cleanly
      cwd: __dirname,
      instances: 1,       // single instance — SSE broadcast requires shared _clients Set
      exec_mode: 'fork',

      // ── Auto-restart policy ────────────────────────────────────────────────
      autorestart: true,
      watch: false,        // do NOT watch files; file changes on a live factory machine are noise
      max_memory_restart: '300M',  // safety net above node_args cap
      restart_delay: 1500,         // wait 1.5 s before restarting (avoids EADDRINUSE spin)
      exp_backoff_restart_delay: 100,
      max_restarts: 999,   // effectively unlimited — always keep the server alive
      min_uptime: '3s',    // if it dies in < 3 s, that counts as a crash restart

      // ── Environment ────────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        DISPATCH_PORT: '3111',
      },
      env_development: {
        NODE_ENV: 'development',
        DISPATCH_PORT: '3111',
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
