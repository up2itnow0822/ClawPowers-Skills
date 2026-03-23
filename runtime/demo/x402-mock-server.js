#!/usr/bin/env node
// runtime/demo/x402-mock-server.js — x402 Mock Merchant Demo Server
//
// Starts a local HTTP server that demonstrates the x402 payment-required flow:
//   1. GET /api/premium-data without payment header → 402 Payment Required
//   2. GET /api/premium-data with 'x-payment: mock-proof' header → 200 OK with data
//
// This server is for DEMO and DEVELOPMENT ONLY — it does not process real payments.
//
// Usage:
//   node runtime/demo/x402-mock-server.js
//   npx clawpowers demo x402
//
// The server picks a random available port and prints instructions on startup.
// Press Ctrl+C to stop.
'use strict';

const http = require('http');
const os = require('os');

// Track requests for demo visibility
let requestCount = 0;

/**
 * Returns an ISO 8601 timestamp without milliseconds.
 *
 * @returns {string} e.g. "2026-03-22T21:42:00Z"
 */
function isoTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Logs a request to stdout with timestamp and key details.
 * Allows the demo runner to see exactly what is happening.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Request URL path
 * @param {number} status - Response HTTP status code
 * @param {string} [note=''] - Optional human-readable note about this request
 */
function logRequest(method, url, status, note = '') {
  const ts = isoTimestamp();
  const noteStr = note ? ` — ${note}` : '';
  console.log(`  [${ts}] ${method} ${url} → ${status}${noteStr}`);
}

/**
 * Builds the x402 Payment Required response body for the mock merchant.
 * This mimics the response a real x402-compliant API would return.
 *
 * @param {number} port - The port this server is running on (embedded in the resource URL).
 * @returns {object} x402 payment requirements object.
 */
function buildPaymentRequired(port) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: '100000',
        resource: `http://localhost:${port}/api/premium-data`,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0xff86829393C6C26A4EC122bE0Cc3E466Ef876AdD',
      },
    ],
    error: 'Payment Required',
  };
}

/**
 * Builds the mock premium data response returned after (simulated) payment.
 *
 * @returns {object} Mock API data payload.
 */
function buildPremiumData() {
  return {
    status: 'ok',
    data: {
      market: 'AGENT/USDC',
      price: '4.20',
      volume_24h: '1234567.89',
      change_24h: '+12.3%',
      source: 'mock-premium-api',
      paid_with: 'x402',
      timestamp: isoTimestamp(),
    },
    message: 'Payment accepted. Here is your premium data.',
  };
}

/**
 * Main HTTP request handler for the mock x402 merchant.
 *
 * Routes:
 *   GET /api/premium-data  — Returns 402 or 200 depending on x-payment header
 *   GET /                  — Returns a simple HTML help page
 *   All others             — Returns 404
 *
 * @param {http.IncomingMessage} req - Incoming HTTP request
 * @param {http.ServerResponse} res - HTTP response object
 */
function handleRequest(req, res) {
  requestCount++;
  const url = req.url || '/';
  const method = req.method || 'GET';

  // CORS headers — allow curl and browser requests during demo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-payment, content-type');

  if (url === '/api/premium-data' && method === 'GET') {
    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
      // No payment header — return 402 Payment Required with x402 spec body
      const body = JSON.stringify(buildPaymentRequired(server.address().port), null, 2);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(402);
      res.end(body);
      logRequest(method, url, 402, 'No x-payment header — returning payment requirements');
    } else {
      // Payment header present — simulate successful payment verification
      const body = JSON.stringify(buildPremiumData(), null, 2);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(body);
      logRequest(method, url, 200, `x-payment: ${paymentHeader} — payment accepted, returning data`);
    }

  } else if (url === '/' && method === 'GET') {
    // Help page — shows curl examples
    const port = server.address().port;
    const body = [
      '<html><body><pre>',
      'x402 Mock Merchant Demo',
      '=======================',
      '',
      'Try these curl commands:',
      '',
      `# Step 1: Request without payment (returns 402)`,
      `curl -i http://localhost:${port}/api/premium-data`,
      '',
      `# Step 2: Request with payment header (returns 200 + data)`,
      `curl -i -H "x-payment: mock-proof" http://localhost:${port}/api/premium-data`,
      '</pre></body></html>',
    ].join('\n');
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(body);
    logRequest(method, url, 200, 'help page');

  } else {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found', path: url }));
    logRequest(method, url, 404);
  }
}

/**
 * Finds a random available port by binding to port 0 and reading what the OS assigned.
 * Returns a Promise that resolves to the chosen port number.
 *
 * @returns {Promise<number>} Available port number.
 */
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const tmp = http.createServer();
    tmp.listen(0, '127.0.0.1', () => {
      const port = tmp.address().port;
      tmp.close(() => resolve(port));
    });
    tmp.on('error', reject);
  });
}

// The server object is referenced inside handleRequest for the port — declare before use
/** @type {http.Server} */
const server = http.createServer(handleRequest);

/**
 * Main entry point: picks a port, starts the server, and prints instructions.
 * Waits for Ctrl+C (SIGINT) or SIGTERM to shut down cleanly.
 */
async function main() {
  let port;
  try {
    port = await getAvailablePort();
  } catch (_) {
    // If dynamic port detection fails, fall back to a fixed high port
    port = 18402;
  }

  server.listen(port, '127.0.0.1', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║             x402 Mock Merchant — Demo Server               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Mock x402 merchant running on http://localhost:${port}`);
    console.log('');
    console.log('  Try:');
    console.log(`    curl http://localhost:${port}/api/premium-data`);
    console.log('');
    console.log('  The server will return 402 (Payment Required) on first request.');
    console.log('');
    console.log(`    curl -H 'x-payment: mock-proof' http://localhost:${port}/api/premium-data`);
    console.log('');
    console.log("  Send with header 'x-payment: mock-proof' to simulate payment.");
    console.log('');
    console.log('  Request log:');
  });

  // Handle Ctrl+C and process termination signals cleanly
  const shutdown = () => {
    console.log('');
    console.log(`  Shutting down after ${requestCount} request(s). Goodbye.`);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`Error starting mock server: ${err.message}\n`);
  process.exit(1);
});
