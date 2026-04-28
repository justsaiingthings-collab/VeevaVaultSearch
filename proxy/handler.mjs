/**
 * VeevaVaultSearch — Lambda Proxy Handler
 *
 * Routes:
 *   POST /query   — forward VQL to any customer Vault tenant
 *   POST /auth    — forward credential auth to Vault (returns session token)
 *   GET  /health  — health check
 *
 * Design principles:
 *   - Zero npm dependencies (Node 20 native fetch)
 *   - No Vault credentials stored server-side; token passed per-request
 *   - Works with ANY *.veevavault.com tenant — URL supplied by browser
 *   - Audit log via CloudWatch (structured JSON)
 *   - Injection guard before forwarding
 *
 * Environment variables:
 *   ALLOWED_ORIGIN     CORS allowed origin, e.g. https://yourapp.com (default: *)
 *   ALLOW_ANY_HOST     Set to "1" to allow non-veevavault.com URLs (on-prem support)
 *   REQUEST_TIMEOUT_MS Upstream timeout in ms (default: 10000)
 */

'use strict';

const ALLOWED_ORIGIN      = process.env.ALLOWED_ORIGIN      || '*';
const ALLOW_ANY_HOST      = process.env.ALLOW_ANY_HOST      === '1';
const REQUEST_TIMEOUT_MS  = parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10);

// ── Injection guard ───────────────────────────────────────────────────────────
// VQL is read-only by design, but we block any attempt to chain write operations.
// SYNC NOTE: Keep this list in sync with SHARED_INJECTION_PATTERNS in
// security/permissions-guard.js — the proxy is ESM with no bundler so we
// duplicate rather than import, but both must match.
// NOTE: /\bSELECT\b/ intentionally removed — all valid VQL starts with SELECT.
// VQL has no subquery support so a nested SELECT is not a meaningful vector.
// /\bUPDATE\b/ and /\bDELETE\b/ removed — lifecycle state names like
// "pending_update__v" legitimately contain these as substrings.
// /--/ removed — VQL ORDER BY / field name chains use double-underscore (__v)
// which would not match, but VQL comments are not valid syntax anyway.
const INJECTION_PATTERNS = [
  /('|")\s*(OR|AND)\s*('|")\d*('|")\s*=\s*('|")\d*/i,  // ' OR '1'='1 classic
  /\/\*/,                                                  // Block comment start
  /\bDROP\b/i,                                            // DROP statement
  /\bINSERT\b/i,                                          // INSERT statement
  /\bEXEC\b/i,                                            // EXEC / stored proc
  /\bUNION\s+SELECT\b/i,                                  // UNION SELECT
  /;\s*(DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i,
  /%27|%22|%3B/i,      // URL-encoded quote/semicolon
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type,X-Vault-URL,X-Vault-Token,X-Vault-API-Version',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Max-Age':       '300',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function validateVaultUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return { ok: false, reason: 'Vault URL must use HTTPS' };
    if (!ALLOW_ANY_HOST && !u.hostname.endsWith('.veevavault.com')) {
      return { ok: false, reason: 'Vault URL must be a *.veevavault.com domain' };
    }
    // Prevent SSRF: no path traversal, no internal IPs
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(u.hostname)) {
      return { ok: false, reason: 'Private IP ranges are not allowed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Malformed Vault URL' };
  }
}

function detectInjection(vql) {
  return INJECTION_PATTERNS.some(p => p.test(vql));
}

function maskEmail(email) {
  // "john.doe@company.com" → "jo***@company.com"
  return String(email).replace(/^(.{2})([^@]*)(@.*)$/, '$1***$3');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ac    = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(event) {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleQuery(event) {
  const body       = parseBody(event);
  const headers    = event.headers || {};
  const vql        = body.vql;
  const apiVersion = body.apiVersion || headers['x-vault-api-version'] || 'v26.1';
  const vaultUrl   = headers['x-vault-url'];
  const token      = headers['x-vault-token'];

  // ── Input validation
  if (!vql)      return respond(400, { error: 'Missing required field: vql' });
  if (!vaultUrl) return respond(400, { error: 'Missing required header: X-Vault-URL' });
  if (!token)    return respond(400, { error: 'Missing required header: X-Vault-Token' });
  if (token.length < 20) return respond(400, { error: 'X-Vault-Token appears invalid (too short)' });

  const urlCheck = validateVaultUrl(vaultUrl);
  if (!urlCheck.ok) return respond(400, { error: urlCheck.reason });

  if (detectInjection(vql)) {
    console.warn(JSON.stringify({ event: 'injection_attempt', vaultHost: new URL(vaultUrl).hostname }));
    return respond(400, { error: 'Injection pattern detected in VQL' });
  }

  // ── Forward to Vault
  const endpoint = `${vaultUrl.replace(/\/$/, '')}/api/${apiVersion}/query`;
  const start    = Date.now();

  try {
    const upstream = await fetchWithTimeout(
      endpoint,
      {
        method:  'POST',
        headers: {
          'Authorization': token,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body: `q=${encodeURIComponent(vql)}`,
      },
      REQUEST_TIMEOUT_MS,
    );

    const data       = await upstream.json();
    const latencyMs  = Date.now() - start;
    const resultCount = Array.isArray(data?.data) ? data.data.length : 0;

    // Structured audit log → CloudWatch
    console.log(JSON.stringify({
      event:          'vault_query',
      vaultHost:      new URL(vaultUrl).hostname,
      apiVersion,
      latencyMs,
      vqlLength:      vql.length,
      responseStatus: upstream.status,
      resultCount,
      responseStatus_vault: data?.responseStatus,
    }));

    return respond(upstream.status, data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return respond(504, { error: 'Vault API timed out', timeoutMs: REQUEST_TIMEOUT_MS });
    }
    console.error(JSON.stringify({ event: 'vault_query_error', error: err.message }));
    return respond(502, { error: 'Vault API unreachable', detail: err.message });
  }
}

async function handleAuth(event) {
  const body       = parseBody(event);
  const headers    = event.headers || {};
  const { username, password, apiVersion = 'v26.1' } = body;
  const vaultUrl   = headers['x-vault-url'];

  // ── Input validation
  if (!username || !password) return respond(400, { error: 'Missing username or password' });
  if (!vaultUrl)              return respond(400, { error: 'Missing required header: X-Vault-URL' });

  const urlCheck = validateVaultUrl(vaultUrl);
  if (!urlCheck.ok) return respond(400, { error: urlCheck.reason });

  // ── Forward to Vault auth endpoint
  const endpoint = `${vaultUrl.replace(/\/$/, '')}/api/${apiVersion}/auth`;

  try {
    const upstream = await fetchWithTimeout(
      endpoint,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ username, password }).toString(),
      },
      REQUEST_TIMEOUT_MS,
    );

    const data = await upstream.json();

    // Audit log — never log credentials
    console.log(JSON.stringify({
      event:          'vault_auth',
      vaultHost:      new URL(vaultUrl).hostname,
      username:       maskEmail(username),
      responseStatus: upstream.status,
      success:        data?.responseStatus === 'SUCCESS',
    }));

    return respond(upstream.status, data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return respond(504, { error: 'Vault auth timed out' });
    }
    console.error(JSON.stringify({ event: 'vault_auth_error', error: err.message }));
    return respond(502, { error: 'Vault auth unreachable', detail: err.message });
  }
}

// ── Metadata proxy ───────────────────────────────────────────────────────────
// Routes browser schema-discovery requests through Lambda so Vault's CORS
// policy never blocks them. The browser cannot call Vault metadata endpoints
// directly — Vault only allows cross-origin requests from its own UI origin.
//
// Request  POST /meta
// Headers  X-Vault-URL, X-Vault-Token, X-Vault-API-Version (optional)
// Body     JSON { path, method?, postBody?, extraHeaders? }
//
// path must match one of ALLOWED_META_PATHS (prevents SSRF abuse).

const ALLOWED_META_PATHS = [
  '/metadata/objects/documents/types',
  '/metadata/objects/documents/properties',
  '/metadata/vobjects',
  '/query',   // used by the facet probe for lifecycle states
];

async function handleMeta(event) {
  const body       = parseBody(event);
  const hdrs       = event.headers || {};
  const metaPath   = body.path;
  const apiVersion = body.apiVersion || hdrs['x-vault-api-version'] || 'v26.1';
  const vaultUrl   = hdrs['x-vault-url'];
  const token      = hdrs['x-vault-token'];

  if (!metaPath)  return respond(400, { error: 'Missing required field: path' });
  if (!vaultUrl)  return respond(400, { error: 'Missing required header: X-Vault-URL' });
  if (!token)     return respond(400, { error: 'Missing required header: X-Vault-Token' });
  if (token.length < 20) return respond(400, { error: 'X-Vault-Token appears invalid' });

  // Security: only allow whitelisted metadata paths
  const allowed = ALLOWED_META_PATHS.some(p => metaPath.startsWith(p));
  if (!allowed) {
    return respond(403, { error: `Metadata path not in allowlist: ${metaPath}` });
  }

  const urlCheck = validateVaultUrl(vaultUrl);
  if (!urlCheck.ok) return respond(400, { error: urlCheck.reason });

  const isPost   = (body.method || 'GET').toUpperCase() === 'POST';
  const endpoint = `${vaultUrl.replace(/\/$/, '')}/api/${apiVersion}${metaPath}`;

  const upstreamHeaders = {
    'Authorization': token,
    'Accept':        'application/json',
    ...(body.extraHeaders || {}),
  };
  if (isPost) upstreamHeaders['Content-Type'] = 'application/x-www-form-urlencoded';

  try {
    const upstream = await fetchWithTimeout(
      endpoint,
      {
        method:  isPost ? 'POST' : 'GET',
        headers: upstreamHeaders,
        body:    isPost ? (body.postBody || '') : undefined,
      },
      REQUEST_TIMEOUT_MS,
    );

    const data = await upstream.json();

    console.log(JSON.stringify({
      event:          'vault_meta',
      vaultHost:      new URL(vaultUrl).hostname,
      metaPath,
      apiVersion,
      responseStatus: upstream.status,
    }));

    return respond(upstream.status, data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return respond(504, { error: 'Vault metadata request timed out', timeoutMs: REQUEST_TIMEOUT_MS });
    }
    console.error(JSON.stringify({ event: 'vault_meta_error', metaPath, error: err.message }));
    return respond(502, { error: 'Vault metadata unreachable', detail: err.message });
  }
}

// ── OAuth session exchange ────────────────────────────────────────────────────
// Exchanges an IdP id_token / access_token for a Vault session token.
//
// Browser flow:
//   1. User authenticates with IdP (Okta / ADFS / PingFederate) via PKCE
//   2. oauth-callback.html exchanges the authorization code for an id_token
//      directly at the IdP's token_endpoint (browser → IdP, no proxy needed)
//   3. oauth-callback.html calls POST /oauth/session here with the id_token
//   4. This route forwards to Vault's POST /auth/oauth/session/{profile}
//   5. Vault validates the token and returns a sessionId
//   6. The sessionId is stored in sessionStorage and used for all VQL calls
//
// Request body (JSON):
//   vaultSessionUrl  — full Vault OAuth session URL, e.g.
//                      https://acme.veevavault.com/auth/oauth/session/Okta_SSO
//   idpToken         — id_token or access_token from the IdP
//   clientId         — optional, the OAuth application client ID

async function handleOAuthSession(event) {
  const body    = parseBody(event);
  const { vaultSessionUrl, idpToken, clientId } = body;

  if (!vaultSessionUrl) return respond(400, { error: 'Missing required field: vaultSessionUrl' });
  if (!idpToken)        return respond(400, { error: 'Missing required field: idpToken' });
  if (idpToken.length < 20) return respond(400, { error: 'idpToken appears invalid (too short)' });

  const urlCheck = validateVaultUrl(vaultSessionUrl);
  if (!urlCheck.ok) return respond(400, { error: urlCheck.reason });

  const formBody = clientId
    ? `client_id=${encodeURIComponent(clientId)}`
    : '';

  try {
    const upstream = await fetchWithTimeout(
      vaultSessionUrl,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${idpToken}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body: formBody,
      },
      REQUEST_TIMEOUT_MS,
    );

    const data = await upstream.json();

    console.log(JSON.stringify({
      event:          'vault_oauth_session',
      vaultHost:      new URL(vaultSessionUrl).hostname,
      responseStatus: upstream.status,
      success:        data?.responseStatus === 'SUCCESS',
    }));

    return respond(upstream.status, data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return respond(504, { error: 'Vault OAuth session exchange timed out' });
    }
    console.error(JSON.stringify({ event: 'vault_oauth_session_error', error: err.message }));
    return respond(502, { error: 'Vault OAuth session exchange failed', detail: err.message });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const handler = async (event) => {
  // HTTP API Gateway v2 payload
  const method = event.requestContext?.http?.method
               || event.httpMethod
               || 'GET';
  const path   = event.rawPath || event.path || '/';

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (path === '/health'        && method === 'GET')  return respond(200, { status: 'ok', version: '1.0.0', ts: new Date().toISOString() });
  if (path === '/query'         && method === 'POST') return handleQuery(event);
  if (path === '/auth'          && method === 'POST') return handleAuth(event);
  if (path === '/oauth/session' && method === 'POST') return handleOAuthSession(event);
  if (path === '/meta'          && method === 'POST') return handleMeta(event);

  return respond(404, { error: `Route not found: ${method} ${path}` });
};
