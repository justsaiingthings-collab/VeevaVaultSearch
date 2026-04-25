/**
 * BACKEND SERVICES LAYER — VeevaVaultSearch
 *
 * Five services that compose the backend:
 *
 *  1. QueryService          — Orchestrates parse → build → execute → aggregate
 *  2. VQLExecutionService   — Executes VQL against Vault REST API
 *  3. MetadataService       — Serves MDL schema and filter definitions
 *  4. ResultAggregationService — Normalizes, groups, and deduplicates results
 *  5. RecommendationService — Wraps the recommendation engine with caching
 *
 * DESIGN:
 *  - All services are stateless (no shared mutable state between requests)
 *  - Vault session token passed on every API call (never stored in service)
 *  - ACL filtering applied in ResultAggregationService BEFORE return
 *  - Latency target: <2000ms end-to-end for typical queries
 */

'use strict';

const { parseQuery }              = require('../query-parser/rule-engine.js');
const { VQLTemplateLibrary }      = require('../vql/query-templates.js');
const { getRecommendations, getStarterRecommendations } = require('../recommendation-engine/recommender.js');
const { PERMISSIONS_MODEL, MDL_FILTER_SCHEMA, DOCUMENT_ENTITY } = require('../mdl/document-schema.mdl.js');

// ─────────────────────────────────────────────────────────────
// SERVICE 1: VQL EXECUTION SERVICE
// Handles all communication with the Vault REST API
// ─────────────────────────────────────────────────────────────

class VQLExecutionService {
  /**
   * @param {string} vaultBaseUrl  - e.g., https://acme.veevavault.com
   */
  constructor(vaultBaseUrl) {
    this.vaultBaseUrl = vaultBaseUrl.replace(/\/$/, '');
    this.vqlEndpoint = `${this.vaultBaseUrl}/api/v24.1/query`;
  }

  /**
   * Execute a VQL query against the Vault API.
   * Vault automatically enforces the user's security profile.
   *
   * @param {string} vql          - VQL query string
   * @param {string} sessionToken - Vault session ID (OAuth token)
   * @param {Object} options      - { pageSize, pageOffset, timeoutMs }
   * @returns {Promise<VaultQueryResponse>}
   */
  async execute(vql, sessionToken, options = {}) {
    const { pageSize = 50, pageOffset = 0, timeoutMs = 8000 } = options;

    if (!sessionToken) {
      throw new VaultAuthError('Session token required for VQL execution');
    }

    const paginatedVQL = this._applyPagination(vql, pageSize, pageOffset);

    const requestBody = {
      q: paginatedVQL,
    };

    const requestConfig = {
      method: 'POST',
      headers: {
        'Authorization': sessionToken,   // Vault enforces security profile via this token
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-VaultAPI-DescribeQuery': 'false',
      },
      body: new URLSearchParams(requestBody).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    };

    const startTime = Date.now();

    try {
      const response = await fetch(this.vqlEndpoint, requestConfig);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new VaultAPIError(`Vault API error: ${response.status}`, {
          status: response.status,
          body: errorBody,
        });
      }

      const data = await response.json();

      if (data.responseStatus !== 'SUCCESS') {
        throw new VaultQueryError('VQL execution failed', {
          errors: data.errors,
          vql: paginatedVQL,
        });
      }

      return {
        records: data.data || [],
        totalCount: data.responseDetails?.total || (data.data || []).length,
        pageSize: data.responseDetails?.pagesize || pageSize,
        nextPage: data.responseDetails?.next_page,
        executionMs: Date.now() - startTime,
        vqlExecuted: paginatedVQL,
      };

    } catch (err) {
      if (err instanceof VaultAuthError || err instanceof VaultAPIError || err instanceof VaultQueryError) {
        throw err;
      }
      throw new VaultNetworkError(`Network error executing VQL: ${err.message}`, { cause: err });
    }
  }

  /**
   * Apply LIMIT/OFFSET pagination to VQL string.
   * Respects existing LIMIT if present; adds if not.
   */
  _applyPagination(vql, pageSize, pageOffset) {
    let paginated = vql;

    if (!paginated.match(/\bLIMIT\b/i)) {
      paginated = `${paginated} LIMIT ${pageSize}`;
    }

    if (pageOffset > 0 && !paginated.match(/\bOFFSET\b/i)) {
      paginated = `${paginated} OFFSET ${pageOffset}`;
    }

    return paginated.replace(/\s+/g, ' ').trim();
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE 2: RESULT AGGREGATION SERVICE
// Normalizes, groups by document, applies ACL, deduplicates
// ─────────────────────────────────────────────────────────────

class ResultAggregationService {
  /**
   * Process raw Vault API records into normalized, grouped results.
   *
   * CRITICAL: ACL filtering is applied here BEFORE results leave this service.
   *
   * @param {Object[]} rawRecords   - Raw Vault API record objects
   * @param {Object}   userContext  - { userRole, productScope, includeVersionHistory }
   * @param {Object}   queryContext - { includeVersionHistory }
   * @returns {AggregatedResult}
   */
  aggregate(rawRecords, userContext = {}, queryContext = {}) {
    // Step 1: Normalize field names
    const normalized = rawRecords.map(r => this._normalizeRecord(r));

    // Step 2: ACL filtering — MUST happen before any data leaves this method
    const filtered = this._applyACL(normalized, userContext, queryContext);

    // Step 3: Group by document (version grouping)
    const grouped = this._groupByDocument(filtered, queryContext);

    // Step 4: Sort within groups
    const sorted = this._sortGroups(grouped);

    return {
      groups: sorted,
      totalDocuments: sorted.length,
      totalVersions: filtered.length,
      filteredCount: rawRecords.length - filtered.length,
      aclApplied: true,
    };
  }

  /**
   * Normalize a raw Vault record into a consistent shape.
   */
  _normalizeRecord(raw) {
    return {
      id:               raw.id,
      versionId:        raw.version_id,
      name:             raw['name__v'] || raw.name__v,
      title:            raw['title__v'] || raw.title__v || null,
      type:             raw['type__v'] || raw.type__v,
      subtype:          raw['subtype__v'] || raw.subtype__v || null,
      lifecycleState:   raw['lifecycle_state__v'] || raw.lifecycle_state__v,
      status:           raw['status__v'] || raw.status__v,
      majorVersion:     parseInt(raw['major_version_number__v'] || raw.major_version_number__v || 0),
      minorVersion:     parseInt(raw['minor_version_number__v'] || raw.minor_version_number__v || 0),
      isLatestVersion:  raw['is_latest_version__v'] === true || raw.is_latest_version__v === 'true',
      owner:            raw['owner__v'] || raw.owner__v || null,
      createdBy:        raw['created_by__v'] || raw.created_by__v || null,
      lastModifiedBy:   raw['last_modified_by__v'] || raw.last_modified_by__v || null,
      lastModifiedDate: raw['last_modified_date__v'] || raw.last_modified_date__v || null,
      createdDate:      raw['created_date__v'] || raw.created_date__v || null,
      approvedDate:     raw['approved_date__v'] || raw.approved_date__v || null,
      expirationDate:   raw['expiration_date__v'] || raw.expiration_date__v || null,
      effectiveDate:    raw['effective_date__v'] || raw.effective_date__v || null,
      product:          raw['product__v'] || raw.product__v || null,
      study:            raw['study__v'] || raw.study__v || null,
      severity:         raw['severity__v'] || raw.severity__v || null,
      priority:         raw['priority__v'] || raw.priority__v || null,
      capaId:           raw['capa_id__c'] || raw.capa_id__c || null,
      gxpRelevant:      raw['gxp_relevant__c'] === true || raw.gxp_relevant__c === 'true',
      eSignature:       raw['electronic_signature__v'] === true,
      _raw: raw,   // Preserve raw for audit
    };
  }

  /**
   * Apply ACL rules.
   * DEFENSIVE: Each rule is evaluated independently; ANY match excludes the record.
   */
  _applyACL(records, userContext, queryContext) {
    const { aclRules } = PERMISSIONS_MODEL;

    return records.filter(doc => {
      for (const rule of aclRules) {
        try {
          if (rule.action === 'EXCLUDE' && rule.condition(doc, userContext.userRole, queryContext, userContext)) {
            return false;  // Exclude this document
          }
        } catch (e) {
          // If ACL rule throws, err on side of exclusion (defense-in-depth)
          return false;
        }
      }
      return true;  // Passes all ACL rules
    });
  }

  /**
   * Group records by their base document ID.
   * Within each group, sort versions newest → oldest.
   * The "primary" record for display is the latest approved version (or latest draft).
   */
  _groupByDocument(records, queryContext) {
    const groups = new Map();

    for (const doc of records) {
      if (!groups.has(doc.id)) {
        groups.set(doc.id, []);
      }
      groups.get(doc.id).push(doc);
    }

    const result = [];

    for (const [docId, versions] of groups) {
      // Sort versions: latest first
      versions.sort((a, b) => {
        if (b.majorVersion !== a.majorVersion) return b.majorVersion - a.majorVersion;
        return b.minorVersion - a.minorVersion;
      });

      // Determine primary version (latest approved, or latest draft)
      const latestApproved = versions.find(v =>
        ['Approved__v', 'Effective__v'].includes(v.lifecycleState)
      );
      const primaryVersion = latestApproved || versions[0];

      result.push({
        documentId: docId,
        primaryVersion,
        versionCount: versions.length,
        versions: queryContext.includeVersionHistory ? versions : [primaryVersion],
        hasMultipleVersions: versions.length > 1,
        latestVersionLabel: `v${primaryVersion.majorVersion}.${primaryVersion.minorVersion}`,
        hasLatestApproved: !!latestApproved,
      });
    }

    return result;
  }

  /**
   * Sort document groups for display.
   * Default: by primary version's last modified date DESC.
   */
  _sortGroups(groups) {
    return groups.sort((a, b) => {
      const dateA = new Date(a.primaryVersion.lastModifiedDate || 0);
      const dateB = new Date(b.primaryVersion.lastModifiedDate || 0);
      return dateB - dateA;
    });
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE 3: METADATA SERVICE
// Serves MDL schema and filter definitions to UI
// ─────────────────────────────────────────────────────────────

class MetadataService {
  /**
   * Get all filter definitions for the UI filter panel.
   * @param {string} userRole - Filter by role visibility
   * @returns {FilterDefinition[]}
   */
  getFilters(userRole) {
    const profile = PERMISSIONS_MODEL.securityProfiles[userRole];

    return MDL_FILTER_SCHEMA.filter(filter => {
      // If user can't view drafts, exclude the Draft lifecycle state option
      if (filter.id === 'filter_lifecycle_state' && profile && !profile.canViewDrafts) {
        filter = {
          ...filter,
          values: filter.values.filter(v =>
            !['Draft__v', 'In Review__v'].includes(v.value)
          ),
        };
      }
      return true;
    }).map(filter => {
      // Return cleaned version (no internal flags)
      const { ...safe } = filter;
      return safe;
    });
  }

  /**
   * Get document type taxonomy for type picker.
   * @returns {Object[]} Array of { label, value, searchCategory }
   */
  getDocumentTypes() {
    const { DOCUMENT_TYPE_TAXONOMY } = require('../mdl/document-schema.mdl.js');
    return Object.entries(DOCUMENT_TYPE_TAXONOMY).map(([key, def]) => ({
      label: key,
      value: def.vaultType,
      searchCategory: def.searchCategory,
      auditRequired: def.auditRequired,
    }));
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE 4: RECOMMENDATION SERVICE
// Wraps recommendation engine; adds simple in-memory cache
// ─────────────────────────────────────────────────────────────

class RecommendationService {
  constructor() {
    // Simple TTL cache keyed by role+keywords hash (no external cache dependency)
    this._cache = new Map();
    this._cacheTTLMs = 60 * 1000;  // 1 minute
  }

  /**
   * Get recommendations with caching.
   * Cache key is role + keywords hash (deterministic).
   */
  getRecommendations(context = {}) {
    const cacheKey = this._cacheKey(context);
    const cached = this._cache.get(cacheKey);

    if (cached && (Date.now() - cached.ts) < this._cacheTTLMs) {
      return { ...cached.data, fromCache: true };
    }

    const recommendations = getRecommendations(context);
    this._cache.set(cacheKey, { data: recommendations, ts: Date.now() });

    return recommendations;
  }

  /**
   * Get role-specific starter recommendations.
   */
  getStarterRecommendations(userRole) {
    return getStarterRecommendations(userRole);
  }

  _cacheKey(context) {
    const { userRole = '', keywords = [], activeDocType = '' } = context;
    const kwHash = keywords.sort().join('|');
    return `${userRole}:${activeDocType}:${kwHash}`;
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE 5: QUERY SERVICE (ORCHESTRATOR)
// Main service called by the Vault SDK UI layer
// ─────────────────────────────────────────────────────────────

class QueryService {
  /**
   * @param {string} vaultBaseUrl    - Vault instance URL
   * @param {Object} serviceOverrides - For testing: inject mock sub-services
   */
  constructor(vaultBaseUrl, serviceOverrides = {}) {
    this.vqlService       = serviceOverrides.vqlService       || new VQLExecutionService(vaultBaseUrl);
    this.aggregator       = serviceOverrides.aggregator       || new ResultAggregationService();
    this.metadataService  = serviceOverrides.metadataService  || new MetadataService();
    this.recommendService = serviceOverrides.recommendService || new RecommendationService();
  }

  /**
   * Execute a search: parse → build VQL → execute → aggregate → return
   *
   * @param {Object} request
   *   @param {string}   request.rawQuery        - User's search string
   *   @param {string}   request.sessionToken    - Vault OAuth session token
   *   @param {string}   request.userRole        - User's Vault role
   *   @param {string}   [request.activeDocType] - Active doc type filter
   *   @param {string}   [request.activeProduct] - Active product filter
   *   @param {Object}   [request.filters]       - Additional MDL filters { field: value }
   *   @param {number}   [request.page]          - Page number (0-indexed)
   *   @param {number}   [request.pageSize]      - Records per page
   *   @param {boolean}  [request.includeVersionHistory] - Show all versions
   *
   * @returns {Promise<SearchResponse>}
   */
  async search(request) {
    const startTime = Date.now();

    const {
      rawQuery,
      sessionToken,
      userRole,
      activeDocType = null,
      activeProduct = null,
      filters = {},
      page = 0,
      pageSize = 25,
      includeVersionHistory = false,
    } = request;

    // --- Step 1: Parse query → intent object ---
    const intentObj = parseQuery(rawQuery, { userRole, activeDocType, activeProduct });

    // --- Step 2: Resolve VQL template ---
    const template = VQLTemplateLibrary.getById(intentObj.intent.templateId);
    if (!template) {
      throw new Error(`Unknown template: ${intentObj.intent.templateId}`);
    }

    // --- Step 3: Build params (merge intent params + explicit filters) ---
    const params = { ...intentObj.params };

    // Apply explicit filter overrides
    if (filters.type)            params.type             = filters.type;
    if (filters.lifecycle_state) params.lifecycle_state  = filters.lifecycle_state;
    if (filters.product_id)      params.product_id       = filters.product_id;
    if (filters.days_back)       params.days_back        = filters.days_back;
    if (activeProduct)           params.product_id       = activeProduct;

    // --- Step 4: Render VQL ---
    const rendered = VQLTemplateLibrary.render(intentObj.intent.templateId, params);
    const vql = this._applyAdditionalFilters(rendered.vql, filters, includeVersionHistory);

    // --- Step 5: Execute VQL against Vault ---
    const vaultResponse = await this.vqlService.execute(
      vql,
      sessionToken,
      { pageSize, pageOffset: page * pageSize }
    );

    // --- Step 6: Aggregate, ACL-filter, group ---
    const userContext = {
      userRole,
      productScope: activeProduct ? [activeProduct] : [],
      includeVersionHistory,
    };
    const queryContext = { includeVersionHistory };

    const aggregated = this.aggregator.aggregate(
      vaultResponse.records,
      userContext,
      queryContext
    );

    // --- Step 7: Get contextual recommendations ---
    const recommendations = this.recommendService.getRecommendations({
      userRole,
      keywords: intentObj.tokens?.words || [],
      activeDocType,
    });

    return {
      // Search metadata
      query: {
        raw: rawQuery,
        templateId: intentObj.intent.templateId,
        templateName: template.name,
        vqlExecuted: vaultResponse.vqlExecuted,
        ruleApplied: intentObj.intent.ruleId,
        parseTimeMs: intentObj.parseTimeMs,
      },

      // Results
      results: aggregated.groups,
      totalDocuments: aggregated.totalDocuments,
      totalVersions: aggregated.totalVersions,
      filteredByACL: aggregated.filteredCount,

      // Pagination
      page,
      pageSize,
      hasNextPage: !!vaultResponse.nextPage,

      // Ambiguity / UX hints
      ambiguity: intentObj.ambiguity,

      // Recommendations to show alongside results
      recommendations: recommendations.slice(0, 5),

      // Performance
      totalTimeMs: Date.now() - startTime,
      vaultExecutionMs: vaultResponse.executionMs,
    };
  }

  /**
   * Execute a query by explicit template ID (skips parser).
   * Used when user clicks a recommended query chip.
   *
   * @param {string} templateId
   * @param {Object} params
   * @param {Object} request - { sessionToken, userRole, page, pageSize }
   * @returns {Promise<SearchResponse>}
   */
  async executeTemplate(templateId, params, request) {
    const rendered = VQLTemplateLibrary.render(templateId, params);

    const vaultResponse = await this.vqlService.execute(
      rendered.vql,
      request.sessionToken,
      { pageSize: request.pageSize || 25, pageOffset: (request.page || 0) * (request.pageSize || 25) }
    );

    const aggregated = this.aggregator.aggregate(
      vaultResponse.records,
      { userRole: request.userRole, productScope: [], includeVersionHistory: false },
      { includeVersionHistory: false }
    );

    return {
      query: {
        templateId,
        vqlExecuted: rendered.vql,
        params,
        executedViaTemplate: true,
      },
      results: aggregated.groups,
      totalDocuments: aggregated.totalDocuments,
      totalVersions: aggregated.totalVersions,
      filteredByACL: aggregated.filteredCount,
      page: request.page || 0,
      pageSize: request.pageSize || 25,
      hasNextPage: !!vaultResponse.nextPage,
      vaultExecutionMs: vaultResponse.executionMs,
    };
  }

  /**
   * Apply additional MDL filter conditions to a VQL string.
   * Injects WHERE clauses for filters not covered by the template.
   */
  _applyAdditionalFilters(vql, filters, includeVersionHistory) {
    const additions = [];

    // Version history: if requested, remove is_latest_version__v restriction
    if (includeVersionHistory) {
      vql = vql.replace(/AND\s+is_latest_version__v\s*=\s*true/gi, '');
    }

    // GxP filter
    if (filters.gxp_only === true) {
      additions.push("gxp_relevant__c = true");
    }

    // Severity filter
    if (filters.severity && !vql.includes('severity__v')) {
      additions.push(`severity__v = '${filters.severity}'`);
    }

    if (additions.length === 0) return vql;

    // Inject additions into existing WHERE clause
    const whereIdx = vql.toUpperCase().indexOf('WHERE');
    if (whereIdx !== -1) {
      const afterWhere = vql.slice(whereIdx + 5);
      return vql.slice(0, whereIdx + 5) + ' ' + additions.join(' AND ') + ' AND ' + afterWhere.trim();
    }

    // No WHERE clause — add one (edge case)
    const orderIdx = vql.toUpperCase().indexOf('ORDER BY');
    if (orderIdx !== -1) {
      return vql.slice(0, orderIdx) + ` WHERE ${additions.join(' AND ')} ` + vql.slice(orderIdx);
    }

    return vql + ` WHERE ${additions.join(' AND ')}`;
  }
}

// ─────────────────────────────────────────────────────────────
// CUSTOM ERROR TYPES
// ─────────────────────────────────────────────────────────────

class VaultAuthError extends Error {
  constructor(message) { super(message); this.name = 'VaultAuthError'; this.httpStatus = 401; }
}
class VaultAPIError extends Error {
  constructor(message, details) { super(message); this.name = 'VaultAPIError'; this.details = details; }
}
class VaultQueryError extends Error {
  constructor(message, details) { super(message); this.name = 'VaultQueryError'; this.details = details; }
}
class VaultNetworkError extends Error {
  constructor(message, details) { super(message); this.name = 'VaultNetworkError'; this.details = details; }
}

// ─────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Create a fully-configured QueryService.
 * @param {string} vaultBaseUrl - Vault instance URL
 * @returns {QueryService}
 */
function createQueryService(vaultBaseUrl) {
  return new QueryService(vaultBaseUrl);
}

module.exports = {
  QueryService,
  VQLExecutionService,
  ResultAggregationService,
  MetadataService,
  RecommendationService,
  createQueryService,
  VaultAuthError,
  VaultAPIError,
  VaultQueryError,
  VaultNetworkError,
};
