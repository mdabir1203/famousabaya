#!/usr/bin/env node
'use strict';

/** Quick static-load smoke test: ecosystem + new shared modules. */

const eco = require('../ecosystem.config.cjs');
console.log('ecosystem apps:', eco.apps.map((a) => a.name).join(', '));
if (!Array.isArray(eco.apps) || eco.apps.length === 0) {
  console.error('FAIL: ecosystem.apps is empty');
  process.exit(2);
}

const reconcile = require('../shared/reconcile-cloudflare.cjs');
if (typeof reconcile.startReconcileLoop !== 'function') {
  console.error('FAIL: reconcile.startReconcileLoop missing');
  process.exit(2);
}

const alerts = require('../shared/alerting/resend-alerts.cjs');
if (typeof alerts.AlertManager !== 'function') {
  console.error('FAIL: alerts.AlertManager missing');
  process.exit(2);
}

console.log('all shared modules load OK');
