/**
 * Local dev server — wraps the Lambda handler in a plain Node HTTP server.
 * No AWS credentials needed. Use this to test the proxy locally before deploying.
 *
 * Usage:
 *   node proxy/start-local.mjs
 *   node proxy/start-local.mjs --port 3001 --origin http://localhost:5500
 *
 * Then set "Proxy URL" in connect.html to: http://localhost:3001
 */

import http    from 'node:http';
import { URL } from 'node:url';
import { handler } from './handler.mjs';

// ── Args ──────────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const port   = parseInt(args[args.indexOf('--port') + 1]  || '3001', 10);
const origin = args[args.indexOf('--origin') + 1] || '*';

// Override env vars so the Lambda handler picks them up
process.env.ALLOWED_ORIGIN = origin;
process.env.ALLOW_ANY_HOST = '1'; // allow non-veevavault.com URLs in local dev

// ── Adapt Node request → Lambda HTTP API v2 event ────────────────────────────
function toEvent(req, body) {
  const url     = new URL(req.url, `http://localhost:${port}`);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = v;

  return {
    rawPath: url.pathname,
    requestContext: { http: { method: req.method } },
    headers,
    body:    body || null,
    isBase64Encoded: false,
    queryStringParameters: Object.fromEntries(url.searchParams),
  };
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;

  const event    = toEvent(req, body || null);
  const response = await handler(event);

  res.writeHead(response.statusCode, response.headers || {});
  res.end(response.body || '');
});

server.listen(port, () => {
  console.log(`\nVaultSearch proxy running locally`);
  console.log(`  URL    : http://localhost:${port}`);
  console.log(`  CORS   : ${origin}`);
  console.log(`  Routes : POST /auth  POST /query  POST /oauth/session  GET /health`);
  console.log(`\nSet "Proxy URL" in connect.html to: http://localhost:${port}\n`);
});
