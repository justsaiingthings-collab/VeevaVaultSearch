/**
 * VAULT CONFIGURATION — VeevaVaultSearch
 *
 * Environment configuration for Vault API connection.
 * Replace values with your Vault tenant details before deployment.
 *
 * SECURITY: Never commit vault credentials here.
 * Use environment variables or Vault SDK credential injection.
 *
 * CONNECTION SETUP:
 * For browser-based setup, open vault-sdk-ui/connect.html.
 * Connections are stored in localStorage (browser) or can be
 * managed here via VAULT_CONNECTIONS for server-side use.
 */

'use strict';

const VAULT_CONFIG = {
  // ── VAULT INSTANCE ──────────────────────────────────────────
  // Set via connect.html UI or environment variables.
  baseUrl:    process.env.VAULT_BASE_URL    || 'https://your-tenant.veevavault.com',
  apiVersion: process.env.VAULT_API_VERSION || 'v24.1',

  // ── AUTH ─────────────────────────────────────────────────────
  // Supported: 'password' | 'oauth'
  // password: Session token obtained via POST /api/{version}/auth
  // oauth:    Bearer token obtained via OAuth 2.0 Discovery flow
  //           Discovery endpoint: GET /auth/discovery?username=&client_id=
  auth: {
    method:         process.env.VAULT_AUTH_METHOD    || 'password',
    // OAuth fields (only needed when method = 'oauth')
    clientId:       process.env.VAULT_OAUTH_CLIENT_ID  || '',
    asClientId:     process.env.VAULT_OAUTH_AS_CLIENT_ID || '',
    oauthProfile:   process.env.VAULT_OAUTH_PROFILE   || '',
    discoveryBase:  'https://login.veevavault.com/auth/discovery',
    sessionEndpoint: '/auth/oauth/session', // appended to vaultUrl
  },

  // ── ENDPOINTS ────────────────────────────────────────────────
  endpoints: {
    query:         '/api/v24.1/query',
    auth:          '/api/v24.1/auth',
    discovery:     '/auth/discovery',
    objects:       '/api/v24.1/objects',
    documents:     '/api/v24.1/documents',
    auditTrail:    '/api/v24.1/audittrail',
  },

  // ── QUERY SETTINGS ───────────────────────────────────────────
  query: {
    defaultPageSize:    25,
    maxPageSize:        200,
    defaultTimeoutMs:   8000,
    retryAttempts:      2,
    retryDelayMs:       500,
  },

  // ── RECOMMENDATION CACHE ─────────────────────────────────────
  cache: {
    recommendationTTLMs:  60 * 1000,    // 1 minute
    metadataTTLMs:        5 * 60 * 1000, // 5 minutes
  },

  // ── SECURITY ─────────────────────────────────────────────────
  security: {
    // Minimum session token length for validation
    minSessionTokenLength: 20,

    // Audit log destination
    // Options: 'console' | 'vault' | 'splunk' | 'file'
    auditLogDestination: process.env.AUDIT_LOG_DESTINATION || 'console',

    // Max in-memory audit log entries
    auditLogMaxEntries: 1000,

    // Whether to block queries on injection detection
    blockInjectionAttempts: true,
  },

  // ── VAULT SDK APP REGISTRATION ────────────────────────────────
  sdkApp: {
    // Register this application in Vault under Admin > Vault SDK
    appName:    'VeevaVaultSearch',
    appVersion: '1.0.0',
    displayName: 'SmartSearch',
    // Tab location: Documents tab
    tabLocation: 'documents',
  },

  // ── KNOWN VAULT LIFECYCLE NAMES ───────────────────────────────
  // Customize these to match your Vault tenant's lifecycle names
  lifecycleNames: {
    qualityDocs:  'QualityDocs Lifecycle',
    submission:   'Submission Lifecycle',
    qualityEvent: 'Quality Event Lifecycle',
  },

  // ── FEATURE FLAGS ─────────────────────────────────────────────
  features: {
    vqlPreviewPanel:    true,   // Show VQL preview in UI
    versionGrouping:    true,   // Group results by document version
    recommendedChips:   true,   // Show recommended query chips
    auditLogging:       true,   // Log all queries
    injectionGuard:     true,   // Block injection patterns
  },
};

module.exports = VAULT_CONFIG;
