/**
 * AbaYa Track Dispatch Server — SkyWalking APM bootstrap
 *
 * Loaded BEFORE server.js via:   node --import ./sw-instrument.mjs server.js
 * (PM2 does this automatically — see node_args in ecosystem.config.cjs.)
 *
 * WHY a separate file (and not just code at the top of server.js)?
 *   ES-module `import` statements are hoisted and run before any other code.
 *   The SkyWalking agent must patch Node's `http` module BEFORE server.js does
 *   `import { createServer } from 'node:http'`. Using --import guarantees this
 *   file fully finishes (including the await below) before server.js loads.
 *
 * SAFE BY DESIGN — the server ALWAYS boots, even if:
 *   • the skywalking-backend-js package isn't installed  → caught, warns, continues
 *   • SW_AGENT_COLLECTOR_BACKEND_SERVICES is not set      → skips silently
 *   • the SkyWalking OAP collector is down                → agent buffers/drops,
 *                                                            never blocks requests
 *
 * To DISABLE instrumentation: leave SW_AGENT_COLLECTOR_BACKEND_SERVICES empty.
 * To ENABLE: set it to the OAP gRPC address, e.g. localhost:11800
 */

const collector = (process.env.SW_AGENT_COLLECTOR_BACKEND_SERVICES || '').trim();

if (!collector) {
  // No collector configured — run the server with zero APM overhead.
  // (No log line here to keep normal startup output clean.)
} else {
  try {
    const { default: agent } = await import('skywalking-backend-js');
    agent.start({
      serviceName:      process.env.SW_AGENT_NAME          || 'abaya-dispatch',
      serviceInstance:  process.env.SW_AGENT_INSTANCE_NAME || 'factory-laptop',
      collectorAddress: collector,
      // Keep agent logs quiet in production; flip to 'debug' when diagnosing.
      maxBufferSize:    1000,   // spans buffered if collector is briefly unreachable
    });
    console.log(
      `[skywalking] APM agent started → ${collector} ` +
      `(service: ${process.env.SW_AGENT_NAME || 'abaya-dispatch'})`
    );
  } catch (err) {
    // Most common cause: package not installed yet.
    console.warn('[skywalking] APM agent NOT started:', err?.message || err);
    console.warn('[skywalking] To enable tracing, run inside services/dispatch-server:');
    console.warn('[skywalking]   npm install skywalking-backend-js');
  }
}
