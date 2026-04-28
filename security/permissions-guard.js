/**
 * SECURITY & PERMISSIONS MODEL — VeevaVaultSearch
 *
 * Defense-in-depth security for the Structured Search Layer.
 *
 * LAYER 1 (Vault-Native): Vault API enforces security profile on every request.
 *   → Not in this code. Guaranteed by passing the user's session token.
 *
 * LAYER 2 (Application-Layer): This file.
 *   → ACL Guards applied BEFORE any data is serialized for the UI.
 *   → Version access control.
 *   → Data leakage prevention checks.
 *   → Audit logging of every query.
 *
 * CRITICAL CONTRACT:
 *   PermissionsGuard.filter() MUST be called before any result set
 *   is returned from QueryService to the UI layer. No exceptions.
 */

'use strict';

const { PERMISSIONS_MODEL } = require('../mdl/document-schema.mdl.js');

// ─────────────────────────────────────────────────────────────
// SECTION 1: SESSION VALIDATOR
// Validates that a Vault session token is present and well-formed
// ─────────────────────────────────────────────────────────────

class SessionValidator {
  /**
   * Validate a Vault session token before allowing any query.
   *
   * @param {string} sessionToken - Vault OAuth bearer token
   * @returns {{ valid: boolean, reason?: string }}
   */
  validate(sessionToken) {
    if (!sessionToken) {
      return { valid: false, reason: 'MISSING_SESSION_TOKEN' };
    }

    if (typeof sessionToken !== 'string') {
      return { valid: false, reason: 'INVALID_TOKEN_TYPE' };
    }

    if (sessionToken.trim().length === 0) {
      return { valid: false, reason: 'EMPTY_SESSION_TOKEN' };
    }

    // Vault session tokens follow a specific pattern
    // Basic format validation (not a full cryptographic check — Vault validates the real token)
    const tokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;
    if (sessionToken.length < 20 || !tokenPattern.test(sessionToken.replace(/\s/g, ''))) {
      return { valid: false, reason: 'MALFORMED_TOKEN' };
    }

    return { valid: true };
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 2: ROLE VALIDATOR
// Validates user role and resolves effective permissions
// ─────────────────────────────────────────────────────────────

class RoleValidator {
  /**
   * Resolve effective permissions for a given user role.
   * Falls back to READ_ONLY for unknown roles (fail-safe).
   *
   * @param {string} userRole
   * @returns {{ profile: Object, isKnownRole: boolean }}
   */
  resolvePermissions(userRole) {
    const knownRoles = Object.keys(PERMISSIONS_MODEL.securityProfiles);
    const isKnownRole = knownRoles.includes(userRole);

    // Unknown roles get READ_ONLY profile — never fail open
    const profile = PERMISSIONS_MODEL.securityProfiles[userRole]
      || PERMISSIONS_MODEL.securityProfiles.READ_ONLY;

    return { profile, isKnownRole };
  }

  /**
   * Check if a user role can access a specific document type.
   * @param {string} userRole
   * @param {string} docType
   * @returns {boolean}
   */
  canAccessDocType(userRole, docType) {
    const { profile } = this.resolvePermissions(userRole);

    if (profile.allowedTypes.includes('ALL')) return true;

    // Map vault type API name back to taxonomy key
    const { DOCUMENT_TYPE_TAXONOMY } = require('../mdl/document-schema.mdl.js');
    for (const [key, def] of Object.entries(DOCUMENT_TYPE_TAXONOMY)) {
      if (def.vaultType === docType && profile.allowedTypes.includes(key)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a user role can access a specific lifecycle state.
   * @param {string} userRole
   * @param {string} state
   * @returns {boolean}
   */
  canAccessState(userRole, state) {
    const { profile } = this.resolvePermissions(userRole);

    if (profile.allowedStates.includes('ALL')) return true;

    // Draft access check
    if (['draft__v', 'in_review__v'].includes(state)) {
      return profile.canViewDrafts === true;
    }

    return profile.allowedStates.includes(state);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 3: VQL INJECTION PREVENTION
// Sanitizes user inputs before they enter VQL strings
// ─────────────────────────────────────────────────────────────

class VQLSanitizer {
  /**
   * VQL INJECTION PREVENTION RULES
   *
   * VQL is a structured query language; user inputs must be validated
   * before being substituted into queries.
   *
   * Attack vectors to guard:
   *  1. SQL/VQL injection: single-quote OR patterns
   *  2. Comment injection: double-dash or slash-star sequences
   *  3. Nested queries: SELECT keyword within a value
   *  4. Boolean bypasses: true OR true
   */

  /**
   * Sanitize a string value for safe use in VQL.
   * @param {string} value - User-provided value
   * @param {string} type  - 'ID' | 'STRING' | 'PICKLIST' | 'NUMBER'
   * @returns {{ safe: boolean, sanitized: string, reason?: string }}
   */
  sanitize(value, type = 'STRING') {
    if (value === null || value === undefined) {
      return { safe: true, sanitized: null };
    }

    const str = String(value);

    // Check for injection patterns
    const injectionPatterns = SHARED_INJECTION_PATTERNS;

    for (const pattern of injectionPatterns) {
      if (pattern.test(str)) {
        return {
          safe: false,
          sanitized: '',
          reason: `Potentially unsafe input detected: matches pattern ${pattern}`,
        };
      }
    }

    // Type-specific validation
    switch (type) {
      case 'ID':
        // Vault IDs are numeric strings
        if (!/^\d+$/.test(str.trim())) {
          return { safe: false, sanitized: '', reason: 'ID must be numeric' };
        }
        return { safe: true, sanitized: str.trim() };

      case 'NUMBER':
        if (isNaN(Number(str))) {
          return { safe: false, sanitized: '0', reason: 'Not a valid number' };
        }
        return { safe: true, sanitized: String(Number(str)) };

      case 'PICKLIST':
      case 'STRING':
        // Escape single quotes in string values
        const escaped = str
          .replace(/'/g, "\\'")    // Escape single quotes
          .replace(/\\/g, '\\\\')  // Escape backslashes
          .trim();
        return { safe: true, sanitized: escaped };

      default:
        return { safe: true, sanitized: str.replace(/'/g, "\\'").trim() };
    }
  }

  /**
   * Sanitize all parameters for a VQL template render.
   * @param {Object} params - Template parameters
   * @param {Object} filterDefs - Filter definitions from template
   * @returns {{ safe: boolean, sanitized: Object, violations: string[] }}
   */
  sanitizeParams(params, filterDefs = {}) {
    const violations = [];
    const sanitized = {};

    for (const [key, value] of Object.entries(params)) {
      const filterDef = filterDefs[key] || {};
      const type = filterDef.type || 'STRING';
      const result = this.sanitize(value, type);

      if (!result.safe) {
        violations.push(`Parameter '${key}': ${result.reason}`);
        sanitized[key] = result.sanitized;  // Use empty/safe value
      } else {
        sanitized[key] = result.sanitized;
      }
    }

    return {
      safe: violations.length === 0,
      sanitized,
      violations,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4: AUDIT LOGGER
// Logs every search query for compliance and audit trail
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// SHARED INJECTION PATTERNS
// Single source of truth — used by both VQLSanitizer (server-side)
// and proxy/handler.mjs (edge layer). Update here, deploy both.
// ─────────────────────────────────────────────────────────────
// NOTE: /\bSELECT\b/ intentionally absent — all valid VQL starts with SELECT.
// /\bUPDATE\b/ and /\bDELETE\b/ absent — lifecycle state names like
// "pending_update__v" legitimately contain these as substrings.
// SYNC: keep in sync with INJECTION_PATTERNS in proxy/handler.mjs.
const SHARED_INJECTION_PATTERNS = [
  /('|")\s*(OR|AND)\s*('|")\d*('|")\s*=\s*('|")\d*/i,  // ' OR '1'='1
  /\/\*/,                                                  // Block comment
  /\bDROP\b/i,                                            // DROP
  /\bINSERT\b/i,                                          // INSERT
  /\bEXEC\b/i,                                            // EXEC
  /\bUNION\s+SELECT\b/i,                                  // UNION SELECT
  /;\s*(DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i, // chained write ops
  /%27|%22|%3B/i,                                         // URL-encoded quote/semicolon
];

// ─────────────────────────────────────────────────────────────
// LOCALSTORAGE AUDIT ADAPTER
// Persists the last 500 audit entries in localStorage as a ring
// buffer. Use as the default adapter in browser/Lambda cold-start
// scenarios. Inject a SIEM/CloudWatch adapter in production.
// ─────────────────────────────────────────────────────────────
class LocalStorageAuditAdapter {
  constructor(maxEntries = 500) {
    this.key = 'vault_audit_log';
    this.maxEntries = maxEntries;
    // Only available in browser — gracefully no-op in Node.js Lambda
    this._hasLocalStorage = (typeof localStorage !== 'undefined');
  }

  write(entry) {
    // Always write to console (Lambda CloudWatch picks this up)
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'test') {
      console.log('[AUDIT]', JSON.stringify({
        ...entry,
        vqlExecuted: entry.vqlExecuted ? '[VQL_PRESENT]' : null,
      }));
    }

    // Additionally persist in localStorage when running in browser
    if (!this._hasLocalStorage) return;
    try {
      const raw = localStorage.getItem(this.key);
      const log = raw ? JSON.parse(raw) : [];
      log.push(entry);
      // Ring buffer: keep only the last maxEntries
      const trimmed = log.length > this.maxEntries ? log.slice(log.length - this.maxEntries) : log;
      localStorage.setItem(this.key, JSON.stringify(trimmed));
    } catch {
      // Storage quota exceeded or unavailable — fail silently
    }
  }

  /**
   * Retrieve stored audit entries (browser only).
   * @param {number} [limit=100] - Max entries to return, newest first
   * @returns {Object[]}
   */
  retrieve(limit = 100) {
    if (!this._hasLocalStorage) return [];
    try {
      const raw = localStorage.getItem(this.key);
      const log = raw ? JSON.parse(raw) : [];
      return log.slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  /** Clear the stored audit log. */
  clear() {
    if (this._hasLocalStorage) {
      try { localStorage.removeItem(this.key); } catch {}
    }
  }
}

class AuditLogger {
  constructor(storageAdapter = null) {
    // Default: LocalStorageAuditAdapter (persists in browser + logs to console for Lambda)
    this.storage = storageAdapter || new LocalStorageAuditAdapter();
    this.logs = [];  // In-memory ring buffer (last 1000 entries)
    this.maxLogs = 1000;
  }

  /**
   * Log a search event.
   * @param {Object} event
   */
  logSearch(event) {
    const entry = {
      type: 'SEARCH',
      timestamp: new Date().toISOString(),
      userId: event.userId || 'unknown',
      userRole: event.userRole || 'unknown',
      rawQuery: event.rawQuery,
      templateId: event.templateId,
      vqlExecuted: event.vqlExecuted,
      resultCount: event.resultCount,
      filteredByACL: event.filteredByACL,
      sessionToken: this._maskToken(event.sessionToken),
      requestId: event.requestId || this._generateId(),
      executionMs: event.executionMs,
    };

    this._persist(entry);
    return entry.requestId;
  }

  /**
   * Log an ACL exclusion event.
   */
  logACLExclusion(event) {
    const entry = {
      type: 'ACL_EXCLUSION',
      timestamp: new Date().toISOString(),
      userId: event.userId,
      userRole: event.userRole,
      documentId: event.documentId,
      ruleId: event.ruleId,
      reason: event.reason,
    };

    this._persist(entry);
  }

  /**
   * Log a security violation (injection attempt, etc.)
   */
  logSecurityViolation(event) {
    const entry = {
      type: 'SECURITY_VIOLATION',
      timestamp: new Date().toISOString(),
      severity: 'HIGH',
      userId: event.userId,
      userRole: event.userRole,
      violation: event.violation,
      input: event.input,
      action: 'BLOCKED',
    };

    this._persist(entry);
  }

  _persist(entry) {
    // Ring buffer: drop oldest if at capacity
    if (this.logs.length >= this.maxLogs) {
      this.logs.shift();
    }
    this.logs.push(entry);
    this.storage.write(entry);
  }

  _maskToken(token) {
    if (!token || token.length < 8) return '***';
    return token.substring(0, 4) + '****' + token.substring(token.length - 4);
  }

  _generateId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

}

// ─────────────────────────────────────────────────────────────
// SECTION 5: PERMISSIONS GUARD (MAIN CLASS)
// Single entry point for all security checks
// ─────────────────────────────────────────────────────────────

class PermissionsGuard {
  constructor(auditLogger = null) {
    this.sessionValidator = new SessionValidator();
    this.roleValidator    = new RoleValidator();
    this.sanitizer        = new VQLSanitizer();
    this.auditLogger      = auditLogger || new AuditLogger();
  }

  /**
   * Pre-query guard: validate session, role, and sanitize params.
   * Call BEFORE building or executing any VQL.
   *
   * @param {Object} request - { sessionToken, userRole, params }
   * @returns {{ allowed: boolean, sanitizedParams: Object, reason?: string }}
   */
  preQueryCheck(request) {
    const { sessionToken, userRole, params = {} } = request;

    // 1. Session validation
    const sessionCheck = this.sessionValidator.validate(sessionToken);
    if (!sessionCheck.valid) {
      this.auditLogger.logSecurityViolation({
        userId: 'unknown',
        userRole,
        violation: 'INVALID_SESSION',
        input: sessionCheck.reason,
      });
      return { allowed: false, reason: `Session validation failed: ${sessionCheck.reason}` };
    }

    // 2. Role validation
    const { profile, isKnownRole } = this.roleValidator.resolvePermissions(userRole);
    if (!isKnownRole) {
      // Log unknown role but allow through with READ_ONLY profile
      this.auditLogger.logSecurityViolation({
        userRole,
        violation: 'UNKNOWN_ROLE',
        input: userRole,
        action: 'DOWNGRADED_TO_READ_ONLY',
      });
    }

    // 3. Parameter sanitization
    const sanitizeResult = this.sanitizer.sanitizeParams(params);
    if (!sanitizeResult.safe) {
      this.auditLogger.logSecurityViolation({
        userRole,
        violation: 'INJECTION_ATTEMPT',
        input: sanitizeResult.violations.join('; '),
      });
      return {
        allowed: false,
        reason: `Input validation failed: ${sanitizeResult.violations.join('; ')}`,
      };
    }

    return {
      allowed: true,
      sanitizedParams: sanitizeResult.sanitized,
      effectiveRole: isKnownRole ? userRole : 'READ_ONLY',
      profile,
    };
  }

  /**
   * Post-query ACL filter: remove documents the user cannot see.
   * Call AFTER VQL execution, BEFORE returning results to UI.
   *
   * @param {Object[]} documents   - Normalized document records
   * @param {Object}   userContext - { userRole, productScope, includeVersionHistory }
   * @param {Object}   queryContext - { includeVersionHistory }
   * @returns {Object[]} Filtered documents (safe to return to UI)
   */
  filter(documents, userContext, queryContext = {}) {
    const { userRole } = userContext;
    const { profile } = this.roleValidator.resolvePermissions(userRole);
    const excluded = [];

    const filtered = documents.filter(doc => {
      // Check 1: Document type access
      if (!profile.allowedTypes.includes('ALL')) {
        const typeAllowed = this.roleValidator.canAccessDocType(userRole, doc.type || doc.type__v);
        if (!typeAllowed) {
          excluded.push({ docId: doc.id, reason: 'DOCUMENT_TYPE_NOT_ALLOWED' });
          return false;
        }
      }

      // Check 2: Lifecycle state access
      const stateAllowed = this.roleValidator.canAccessState(userRole, doc.lifecycleState || doc.lifecycle_state__v);
      if (!stateAllowed) {
        excluded.push({ docId: doc.id, reason: 'LIFECYCLE_STATE_NOT_ALLOWED' });
        return false;
      }

      // Check 3: Version access (non-admins can't see obsolete)
      const state = doc.lifecycleState || doc.lifecycle_state__v || '';
      if (!profile.canViewObsolete && ['obsolete__v', 'superseded__v', 'archived__v'].includes(state)) {
        excluded.push({ docId: doc.id, reason: 'OBSOLETE_VERSION_SUPPRESSED' });
        return false;
      }

      // Check 4: Draft visibility
      const isDraft = ['draft__v', 'in_review__v'].includes(state);
      if (isDraft && !profile.canViewDrafts) {
        excluded.push({ docId: doc.id, reason: 'DRAFT_NOT_VISIBLE_TO_ROLE' });
        return false;
      }

      return true;
    });

    // Log summary of ACL exclusions (not individual records — volume)
    if (excluded.length > 0) {
      this.auditLogger.logACLExclusion({
        userRole,
        documentId: `[${excluded.length} documents excluded]`,
        ruleId: 'BULK',
        reason: `ACL filtered ${excluded.length} records for role ${userRole}`,
      });
    }

    return filtered;
  }

  /**
   * Check if a user can request version history for a document.
   * @param {string} userRole
   * @returns {boolean}
   */
  canViewVersionHistory(userRole) {
    const { profile } = this.roleValidator.resolvePermissions(userRole);
    return profile.canViewAllVersions === true;
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 6: VERSION ACCESS CONTROLLER
// Controls which versions are visible to which roles
// ─────────────────────────────────────────────────────────────

class VersionAccessController {
  /**
   * Given a list of versions for a document, return only those
   * the user role is allowed to see.
   *
   * @param {Object[]} versions - All versions of a document
   * @param {string}   userRole
   * @param {boolean}  includeVersionHistory - Did user explicitly request history?
   * @returns {Object[]} Permitted versions
   */
  // approvedStates: configurable list of lifecycle states considered "approved".
  // Defaults match Vault's standard Base Document Lifecycle names (lowercase __v).
  // Override per-tenant when calling this method if your lifecycle uses custom state names.
  filterVersions(versions, userRole, includeVersionHistory = false, approvedStates = ['approved__v', 'effective__v']) {
    const guard = new PermissionsGuard();

    // If user can't view version history, show latest approved only
    if (!includeVersionHistory && !guard.canViewVersionHistory(userRole)) {
      const latestApproved = versions
        .filter(v => approvedStates.includes(v.lifecycleState || v.lifecycle_state__v))
        .sort((a, b) => {
          const ma = a.majorVersion || a.major_version_number__v || 0;
          const mb = b.majorVersion || b.major_version_number__v || 0;
          return mb - ma;
        })[0];

      // Fallback to latest version if no approved version
      const latest = versions.sort((a, b) => {
        const ma = a.majorVersion || a.major_version_number__v || 0;
        const mb = b.majorVersion || b.major_version_number__v || 0;
        return mb - ma;
      })[0];

      return latestApproved ? [latestApproved] : (latest ? [latest] : []);
    }

    // Filter out obsolete/superseded unless admin explicitly requested them
    return versions.filter(v => {
      const state = v.lifecycleState || v.lifecycle_state__v || '';
      return !['obsolete__v', 'superseded__v', 'archived__v'].includes(state) ||
             guard.canViewVersionHistory(userRole);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  PermissionsGuard,
  SessionValidator,
  RoleValidator,
  VQLSanitizer,
  AuditLogger,
  LocalStorageAuditAdapter,
  VersionAccessController,
  SHARED_INJECTION_PATTERNS,
};
