/**
 * QUERY PARSER — RULE-BASED INTENT ENGINE
 * VeevaVaultSearch
 *
 * Deterministic, rule-based parser that transforms raw user query strings
 * into structured intent objects for VQL query generation.
 *
 * DESIGN PRINCIPLES:
 *  - Zero ML / Zero AI / Zero probabilistic scoring
 *  - All rules are explicit, enumerable, and auditable
 *  - Output is 100% deterministic for the same input
 *  - Ambiguity resolved via priority ordering, never inference
 *
 * PIPELINE:
 *  raw string
 *    → normalize()
 *    → tokenize()
 *    → extractKeywords()
 *    → detectIntent()
 *    → resolveFilters()
 *    → resolveAmbiguity()
 *    → buildIntentObject()
 */

'use strict';

const { DOCUMENT_TYPE_TAXONOMY, LIFECYCLE_STATES } = require('../mdl/document-schema.mdl.js');

// ─────────────────────────────────────────────────────────────
// SECTION 1: KEYWORD DICTIONARIES
// Maps user-facing words/phrases to structured intent signals
// ─────────────────────────────────────────────────────────────

const KEYWORD_DICTIONARIES = {

  // --- Document Type Keywords ---
  documentType: {
    'sop':                          { type: 'Standard Operating Procedure__c', weight: 10 },
    'sops':                         { type: 'Standard Operating Procedure__c', weight: 10 },
    'standard operating procedure': { type: 'Standard Operating Procedure__c', weight: 10 },
    'procedures':                   { type: 'Standard Operating Procedure__c', weight: 7  },
    'procedure':                    { type: 'Standard Operating Procedure__c', weight: 7  },
    'work instruction':             { type: 'Standard Operating Procedure__c', weight: 7  },
    'deviation':                    { type: 'Deviation__c',                    weight: 10 },
    'deviations':                   { type: 'Deviation__c',                    weight: 10 },
    'incident':                     { type: 'Deviation__c',                    weight: 6  },
    'out of spec':                  { type: 'Deviation__c',                    weight: 8  },
    'oos':                          { type: 'Deviation__c',                    weight: 8  },
    'capa':                         { type: 'CAPA__c',                         weight: 10 },
    'capas':                        { type: 'CAPA__c',                         weight: 10 },
    'corrective action':            { type: 'CAPA__c',                         weight: 10 },
    'preventive action':            { type: 'CAPA__c',                         weight: 10 },
    'corrective':                   { type: 'CAPA__c',                         weight: 6  },
    'preventive':                   { type: 'CAPA__c',                         weight: 6  },
    'protocol':                     { type: 'Protocol__c',                     weight: 10 },
    'study protocol':               { type: 'Protocol__c',                     weight: 10 },
    'validation protocol':          { type: 'Protocol__c',                     weight: 10 },
    'report':                       { type: 'Report__c',                       weight: 8  },
    'audit report':                 { type: 'Report__c',                       weight: 10 },
    'inspection report':            { type: 'Report__c',                       weight: 10 },
    'policy':                       { type: 'Policy__c',                       weight: 10 },
    'policies':                     { type: 'Policy__c',                       weight: 10 },
  },

  // --- Lifecycle State Keywords ---
  lifecycleState: {
    'approved':       { state: 'approved__v',    weight: 10 },
    'effective':      { state: 'effective__v',   weight: 10 },
    'current':        { state: 'effective__v',   weight: 8  },
    'active':         { state: 'effective__v',   weight: 7  },
    'draft':          { state: 'draft__v',        weight: 10 },
    'in review':      { state: 'in_review__v',   weight: 10 },
    'under review':   { state: 'in_review__v',   weight: 10 },
    'pending':        { state: 'in_review__v',   weight: 7  },
    'open':           { state: 'open__v',         weight: 10 },
    'closed':         { state: 'closed__v',       weight: 10 },
    'obsolete':       { state: 'obsolete__v',     weight: 10 },
    'superseded':     { state: 'superseded__v',   weight: 10 },
    'old':            { state: 'superseded__v',   weight: 5  },
    'in progress':    { state: 'in_progress__v',  weight: 10 },
    'ongoing':        { state: 'in_progress__v',  weight: 6  },
  },

  // --- Temporal Keywords ---
  temporal: {
    'recent':        { modifier: 'recent',   days: 30  },
    'recently':      { modifier: 'recent',   days: 30  },
    'new':           { modifier: 'recent',   days: 30  },
    'latest':        { modifier: 'latest',   days: null },
    'last week':     { modifier: 'range',    days: 7   },
    'last month':    { modifier: 'range',    days: 30  },
    'last 30 days':  { modifier: 'range',    days: 30  },
    'last 90 days':  { modifier: 'range',    days: 90  },
    'last year':     { modifier: 'range',    days: 365 },
    'this year':     { modifier: 'range',    days: 365 },
    'today':         { modifier: 'range',    days: 1   },
    'expir':         { modifier: 'expiring', days: 90  },  // prefix match: "expiring", "expiration"
    'due soon':      { modifier: 'expiring', days: 90  },
    'overdue':       { modifier: 'overdue',  days: null },
    'past due':      { modifier: 'overdue',  days: null },
  },

  // --- Severity Keywords ---
  severity: {
    'critical':  { severity: 'critical__v', weight: 10 },
    'major':     { severity: 'major__v',    weight: 10 },
    'minor':     { severity: 'minor__v',    weight: 10 },
    'high':      { severity: 'critical__v', weight: 8  },
    'severe':    { severity: 'critical__v', weight: 8  },
    'serious':   { severity: 'major__v',    weight: 7  },
    'low':       { severity: 'minor__v',    weight: 8  },
  },

  // --- Audit / Compliance Keywords ---
  audit: {
    'audit':         { category: 'audit', subtype: 'general'    },
    'inspection':    { category: 'audit', subtype: 'inspection' },
    'fda':           { category: 'audit', subtype: 'regulatory' },
    'ema':           { category: 'audit', subtype: 'regulatory' },
    'gmp':           { category: 'audit', subtype: 'gmp'        },
    'gdp':           { category: 'audit', subtype: 'gdp'        },
    'gxp':           { category: 'audit', subtype: 'gxp'        },
    'compliance':    { category: 'audit', subtype: 'general'    },
    'ready':         { category: 'audit', subtype: 'readiness'  },
    'readiness':     { category: 'audit', subtype: 'readiness'  },
  },

  // --- Version Keywords ---
  version: {
    'version':        { modifier: 'version_info'   },
    'history':        { modifier: 'version_history'},
    'all versions':   { modifier: 'version_history'},
    'previous':       { modifier: 'version_history'},
    'old version':    { modifier: 'version_history'},
    'latest version': { modifier: 'latest'         },
    'current version':{ modifier: 'latest'         },
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 2: INTENT MAPPING RULES
// Maps keyword combinations to specific VQL templates
// Priority: higher number = checked first
// ─────────────────────────────────────────────────────────────

const INTENT_MAPPING_RULES = [
  // --- High specificity rules (Priority 100) ---
  {
    id: 'RULE-001',
    priority: 100,
    name: 'Audit Inspection Package',
    condition: (signals) =>
      signals.audit && (signals.audit.subtype === 'inspection' || signals.audit.subtype === 'readiness'),
    mapTo: { templateId: 'audit_inspection_package', category: 'audit' },
  },
  {
    id: 'RULE-002',
    priority: 100,
    name: 'High Severity Deviation',
    condition: (signals) =>
      signals.docType === 'Deviation__c' && signals.severity &&
      ['critical__v', 'major__v'].includes(signals.severity),
    mapTo: { templateId: 'deviation_high_severity', category: 'deviation' },
  },
  {
    id: 'RULE-003',
    priority: 100,
    name: 'Deviation with CAPA link',
    condition: (signals) =>
      signals.docType === 'Deviation__c' && signals.docType2 === 'CAPA__c',
    mapTo: { templateId: 'deviation_linked_capa', category: 'deviation' },
  },
  {
    id: 'RULE-004',
    priority: 100,
    name: 'Overdue CAPAs',
    condition: (signals) =>
      signals.docType === 'CAPA__c' && signals.temporal &&
      signals.temporal.modifier === 'overdue',
    mapTo: { templateId: 'capa_overdue', category: 'capa' },
  },
  {
    id: 'RULE-005',
    priority: 100,
    name: 'Expiring SOPs',
    condition: (signals) =>
      signals.docType === 'Standard Operating Procedure__c' &&
      signals.temporal && signals.temporal.modifier === 'expiring',
    mapTo: { templateId: 'sop_expiring_soon', category: 'sop' },
  },
  {
    id: 'RULE-005B',
    priority: 100,
    name: 'Expiring SOPs (keyword order variant)',
    condition: (signals) =>
      // Catches "expiring SOPs" even when temporal is detected before docType
      signals.temporal && signals.temporal.modifier === 'expiring' &&
      signals.docType === 'Standard Operating Procedure__c',
    mapTo: { templateId: 'sop_expiring_soon', category: 'sop' },
  },
  {
    id: 'RULE-006',
    priority: 100,
    name: 'Expiring Any Documents',
    condition: (signals) =>
      signals.temporal && signals.temporal.modifier === 'expiring' && !signals.docType,
    mapTo: { templateId: 'time_expiring_documents', category: 'time' },
  },
  {
    id: 'RULE-007',
    priority: 100,
    name: 'Version History Request',
    condition: (signals) =>
      signals.version && signals.version.modifier === 'version_history',
    mapTo: { templateId: 'time_version_history', category: 'time', requiresDocId: true },
  },

  // --- Medium specificity rules (Priority 70) ---
  {
    id: 'RULE-010',
    priority: 70,
    name: 'Approved SOPs',
    condition: (signals) =>
      signals.docType === 'Standard Operating Procedure__c' &&
      signals.state && ['approved__v', 'effective__v'].includes(signals.state),
    mapTo: { templateId: 'sop_approved', category: 'sop' },
  },
  {
    id: 'RULE-011',
    priority: 70,
    name: 'SOPs for Product',
    condition: (signals) =>
      signals.docType === 'Standard Operating Procedure__c' && signals.product,
    mapTo: { templateId: 'sop_by_product', category: 'sop' },
  },
  {
    id: 'RULE-012',
    priority: 70,
    name: 'Open Deviations',
    condition: (signals) =>
      signals.docType === 'Deviation__c' &&
      (!signals.state || signals.state === 'open__v' || signals.state === 'in_progress__v'),
    mapTo: { templateId: 'deviation_all_open', category: 'deviation' },
  },
  {
    id: 'RULE-013',
    priority: 70,
    name: 'Open CAPAs',
    condition: (signals) =>
      signals.docType === 'CAPA__c' &&
      (!signals.state || signals.state === 'open__v' || signals.state === 'in_progress__v'),
    mapTo: { templateId: 'capa_open', category: 'capa' },
  },
  {
    id: 'RULE-014',
    priority: 70,
    name: 'Closed CAPAs',
    condition: (signals) =>
      signals.docType === 'CAPA__c' && signals.state === 'closed__v',
    mapTo: { templateId: 'capa_closed', category: 'capa' },
  },
  {
    id: 'RULE-015',
    priority: 80,   // Higher than RULE-013 (70) so it fires first when severity is present
    name: 'High Severity CAPAs',
    condition: (signals) =>
      signals.docType === 'CAPA__c' && signals.severity &&
      ['critical__v', 'major__v'].includes(signals.severity),
    mapTo: { templateId: 'capa_high_severity', category: 'capa' },
  },
  {
    id: 'RULE-016',
    priority: 70,
    name: 'Audit Ready Documents',
    condition: (signals) =>
      signals.audit && !signals.docType,
    mapTo: { templateId: 'audit_ready_docs', category: 'audit' },
  },

  // --- Low specificity / fallback rules (Priority 30) ---
  {
    id: 'RULE-020',
    priority: 30,
    name: 'SOP Fallback',
    condition: (signals) => signals.docType === 'Standard Operating Procedure__c',
    mapTo: { templateId: 'sop_approved', category: 'sop' },
  },
  {
    id: 'RULE-021',
    priority: 30,
    name: 'Deviation Fallback',
    condition: (signals) => signals.docType === 'Deviation__c',
    mapTo: { templateId: 'deviation_all_open', category: 'deviation' },
  },
  {
    id: 'RULE-022',
    priority: 30,
    name: 'CAPA Fallback',
    condition: (signals) => signals.docType === 'CAPA__c',
    mapTo: { templateId: 'capa_open', category: 'capa' },
  },
  {
    id: 'RULE-023',
    priority: 30,
    name: 'Recent Changes Fallback',
    condition: (signals) => signals.temporal && signals.temporal.modifier === 'recent',
    mapTo: { templateId: 'time_last_30_days_changes', category: 'time' },
  },
  {
    id: 'RULE-024',
    priority: 30,
    name: 'By Document Type Fallback',
    condition: (signals) => !!signals.docType && !signals.state,
    mapTo: { templateId: 'doc_by_type', category: 'discovery' },
  },
  {
    id: 'RULE-025',
    priority: 30,
    name: 'By Lifecycle State Fallback',
    condition: (signals) => !!signals.state && !signals.docType,
    mapTo: { templateId: 'doc_by_lifecycle_state', category: 'discovery' },
  },

  // --- Catch-all (Priority 0) ---
  {
    id: 'RULE-099',
    priority: 0,
    name: 'Default: All Accessible Documents',
    condition: () => true,
    mapTo: { templateId: 'doc_all_accessible', category: 'discovery' },
  },
];

// Sort rules by priority descending (highest priority checked first)
INTENT_MAPPING_RULES.sort((a, b) => b.priority - a.priority);

// ─────────────────────────────────────────────────────────────
// SECTION 3: PARSER IMPLEMENTATION
// ─────────────────────────────────────────────────────────────

class QueryParser {
  /**
   * Main entry point.
   * @param {string} rawQuery - User input string
   * @param {Object} context - { userRole, activeDocType, activeProduct }
   * @returns {IntentObject} Structured intent object
   */
  parse(rawQuery, context = {}) {
    const startTime = Date.now();

    // Step 1: Normalize
    const normalized = this._normalize(rawQuery);

    // Step 2: Tokenize
    const tokens = this._tokenize(normalized);

    // Step 3: Extract keyword signals
    const signals = this._extractSignals(normalized, tokens);

    // Step 4: Apply context overrides (UI context from active filters)
    this._applyContext(signals, context);

    // Step 5: Match rules to determine intent
    const matchedRule = this._matchRule(signals);

    // Step 6: Build VQL parameters from signals
    const params = this._buildParams(signals, context);

    // Step 7: Handle ambiguity
    const ambiguity = this._detectAmbiguity(signals, matchedRule);

    const intentObject = {
      // --- Input ---
      rawQuery,
      normalized,
      tokens,

      // --- Extracted Signals ---
      signals,

      // --- Intent Resolution ---
      intent: {
        ruleId: matchedRule.id,
        ruleName: matchedRule.name,
        templateId: matchedRule.mapTo.templateId,
        category: matchedRule.mapTo.category,
        requiresDocId: matchedRule.mapTo.requiresDocId || false,
      },

      // --- VQL Parameters ---
      params,

      // --- Ambiguity ---
      ambiguity,

      // --- Metadata ---
      parseTimeMs: Date.now() - startTime,
      parsedAt: new Date().toISOString(),
      context,
    };

    return intentObject;
  }

  /**
   * STEP 1: Normalize input
   * Lowercase, trim, collapse whitespace, remove punctuation
   */
  _normalize(rawQuery) {
    return rawQuery
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, ' ')   // Remove punctuation except hyphens
      .replace(/\s+/g, ' ')        // Collapse multiple spaces
      .trim();
  }

  /**
   * STEP 2: Tokenize into words and bigrams/trigrams
   */
  _tokenize(normalized) {
    const words = normalized.split(' ').filter(w => w.length > 1);
    const bigrams = [];
    const trigrams = [];

    for (let i = 0; i < words.length - 1; i++) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    for (let i = 0; i < words.length - 2; i++) {
      trigrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }

    return { words, bigrams, trigrams, all: [...trigrams, ...bigrams, ...words] };
  }

  /**
   * STEP 3: Extract signals from normalized text
   * Checks trigrams > bigrams > unigrams for each dictionary
   * (Longer matches take precedence over shorter ones)
   */
  _extractSignals(normalized, tokens) {
    const signals = {
      docType: null,
      docType2: null,     // Second doc type if query mentions two types (e.g., "deviation linked to CAPA")
      state: null,
      temporal: null,
      severity: null,
      audit: null,
      product: null,
      version: null,
      rawKeywords: [],
    };

    const searchTerms = tokens.all;  // Trigrams first, then bigrams, then unigrams

    // --- Document Type ---
    let docTypeMatches = [];
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.documentType[term]) {
        const match = KEYWORD_DICTIONARIES.documentType[term];
        docTypeMatches.push({ type: match.type, weight: match.weight, term });
      }
    }
    // Check prefix matches (e.g., "expir" matches "expiring")
    for (const word of tokens.words) {
      for (const [pattern, match] of Object.entries(KEYWORD_DICTIONARIES.documentType)) {
        if (word.startsWith(pattern) && pattern.length >= 4) {
          docTypeMatches.push({ type: match.type, weight: match.weight * 0.8, term: word });
        }
      }
    }
    // Sort by weight desc; assign first as primary, second as secondary
    docTypeMatches.sort((a, b) => b.weight - a.weight);
    const uniqueTypes = [...new Set(docTypeMatches.map(m => m.type))];
    signals.docType = uniqueTypes[0] || null;
    signals.docType2 = uniqueTypes[1] || null;

    // --- Lifecycle State ---
    let stateMatches = [];
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.lifecycleState[term]) {
        const match = KEYWORD_DICTIONARIES.lifecycleState[term];
        stateMatches.push({ state: match.state, weight: match.weight, term });
      }
    }
    stateMatches.sort((a, b) => b.weight - a.weight);
    signals.state = stateMatches[0]?.state || null;

    // --- Temporal ---
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.temporal[term]) {
        signals.temporal = KEYWORD_DICTIONARIES.temporal[term];
        break;
      }
    }
    // Prefix match for temporal (e.g., "expiring", "expiration")
    if (!signals.temporal) {
      for (const word of tokens.words) {
        for (const [pattern, match] of Object.entries(KEYWORD_DICTIONARIES.temporal)) {
          if (pattern.endsWith('...') && word.startsWith(pattern.slice(0, -3))) {
            signals.temporal = match;
            break;
          }
          if (word.startsWith('expir')) {
            signals.temporal = KEYWORD_DICTIONARIES.temporal['expir'];
            break;
          }
        }
        if (signals.temporal) break;
      }
    }

    // --- Severity ---
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.severity[term]) {
        signals.severity = KEYWORD_DICTIONARIES.severity[term].severity;
        break;
      }
    }

    // --- Audit ---
    // Collect ALL matching audit signals, then pick the most specific subtype
    // Priority: inspection > readiness > regulatory > gxp > gdp > gmp > general
    const AUDIT_SUBTYPE_PRIORITY = ['inspection', 'readiness', 'regulatory', 'gxp', 'gdp', 'gmp', 'general'];
    const auditMatches = [];
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.audit[term]) {
        auditMatches.push(KEYWORD_DICTIONARIES.audit[term]);
      }
    }
    if (auditMatches.length > 0) {
      auditMatches.sort((a, b) => {
        const ai = AUDIT_SUBTYPE_PRIORITY.indexOf(a.subtype);
        const bi = AUDIT_SUBTYPE_PRIORITY.indexOf(b.subtype);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      signals.audit = auditMatches[0];
    }

    // --- Version ---
    for (const term of searchTerms) {
      if (KEYWORD_DICTIONARIES.version[term]) {
        signals.version = KEYWORD_DICTIONARIES.version[term];
        break;
      }
    }

    // --- Collect all matched raw keywords ---
    signals.rawKeywords = [...new Set([
      docTypeMatches.map(m => m.term),
      stateMatches.map(m => m.term),
    ].flat())];

    return signals;
  }

  /**
   * STEP 4: Apply UI context overrides
   * If user has active filters in the UI, they override inferred signals
   */
  _applyContext(signals, context) {
    if (context.activeDocType && !signals.docType) {
      signals.docType = context.activeDocType;
      signals._contextOverride = true;
    }
    if (context.activeProduct) {
      signals.product = context.activeProduct;
    }
    if (context.userRole) {
      signals.userRole = context.userRole;
    }
  }

  /**
   * STEP 5: Match rules
   * Evaluates rules in priority order; returns first matching rule
   */
  _matchRule(signals) {
    for (const rule of INTENT_MAPPING_RULES) {
      try {
        if (rule.condition(signals)) {
          return rule;
        }
      } catch (e) {
        // Rule evaluation error → skip this rule, continue
        continue;
      }
    }
    // Should never reach here due to catch-all rule, but be safe
    return INTENT_MAPPING_RULES[INTENT_MAPPING_RULES.length - 1];
  }

  /**
   * STEP 6: Build VQL parameters from signals
   */
  _buildParams(signals, context) {
    const params = {};

    if (signals.temporal) {
      params.days_back = signals.temporal.days || 30;
      params.days_ahead = signals.temporal.days || 90;
    }

    if (signals.severity) {
      params.severity = signals.severity;
    }

    if (signals.product || context.activeProduct) {
      params.product_id = signals.product || context.activeProduct;
    }

    if (signals.state) {
      params.lifecycle_state = signals.state;
    }

    if (signals.docType) {
      params.type = signals.docType;
    }

    return params;
  }

  /**
   * STEP 7: Detect and report ambiguity
   * Returns ambiguity signals that the UI can surface to the user
   */
  _detectAmbiguity(signals, matchedRule) {
    const ambiguity = {
      isAmbiguous: false,
      reasons: [],
      alternativeTemplates: [],
    };

    // Check if multiple doc types were detected
    if (signals.docType && signals.docType2) {
      ambiguity.isAmbiguous = true;
      ambiguity.reasons.push(`Multiple document types detected: ${signals.docType}, ${signals.docType2}`);
    }

    // Check if query implies both "open" and "closed"
    if (signals.state === 'open__v' && signals.rawKeywords.includes('closed')) {
      ambiguity.isAmbiguous = true;
      ambiguity.reasons.push('Query mentions both open and closed states');
      ambiguity.alternativeTemplates.push('capa_closed');
    }

    // Check if doc type + state combination doesn't make logical sense
    if (signals.docType === 'CAPA__c' && signals.state === 'approved__v') {
      ambiguity.isAmbiguous = true;
      ambiguity.reasons.push("CAPAs use 'Closed' not 'Approved'. Interpreting as 'Closed' state.");
      ambiguity.stateCorrection = 'closed__v';
    }

    return ambiguity;
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4: EDGE CASE HANDLER
// ─────────────────────────────────────────────────────────────

const EDGE_CASE_RULES = [
  {
    id: 'EDGE-001',
    description: 'Empty query → return all accessible documents',
    detect: (rawQuery) => !rawQuery || rawQuery.trim().length === 0,
    resolve: () => ({ templateId: 'doc_all_accessible', params: {} }),
  },
  {
    id: 'EDGE-002',
    description: 'Query is a document ID (numeric or UUID format)',
    detect: (rawQuery) => /^[\d]{5,}$/.test(rawQuery.trim()) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawQuery.trim()),
    resolve: (rawQuery) => ({
      templateId: 'time_version_history',
      params: { doc_id: rawQuery.trim() },
      note: 'Input detected as document ID; showing version history',
    }),
  },
  {
    id: 'EDGE-003',
    description: 'Single character or too-short query',
    detect: (rawQuery) => rawQuery && rawQuery.trim().length < 3,
    resolve: () => ({
      templateId: 'doc_all_accessible',
      params: {},
      note: 'Query too short for keyword matching; showing all documents',
    }),
  },
  {
    id: 'EDGE-004',
    description: 'Query contains only stopwords',
    detect: (rawQuery) => {
      const stopwords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'show', 'me', 'find', 'get', 'list', 'all', 'any'];
      const words = rawQuery.toLowerCase().trim().split(/\s+/);
      return words.every(w => stopwords.includes(w));
    },
    resolve: () => ({
      templateId: 'doc_all_accessible',
      params: {},
      note: 'Query contains only common words; showing all documents',
    }),
  },
];

/**
 * Handle edge cases before main parse pipeline
 * @param {string} rawQuery
 * @returns {Object|null} Edge case resolution or null if none apply
 */
function handleEdgeCases(rawQuery) {
  for (const rule of EDGE_CASE_RULES) {
    if (rule.detect(rawQuery)) {
      const resolution = rule.resolve(rawQuery);
      return {
        ...resolution,
        edgeCaseRuleId: rule.id,
        edgeCaseDescription: rule.description,
        isEdgeCase: true,
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// SECTION 5: PUBLIC API
// ─────────────────────────────────────────────────────────────

const parser = new QueryParser();

/**
 * Parse a raw user query into a structured intent object.
 *
 * @param {string} rawQuery - Raw user input string
 * @param {Object} context  - { userRole, activeDocType, activeProduct }
 * @returns {IntentObject} Structured intent with templateId and params
 *
 * @example
 * parseQuery('show me approved SOPs for Drug-A')
 * // → { intent: { templateId: 'sop_by_product', ... }, params: { product_id: 'Drug-A' }, ... }
 */
function parseQuery(rawQuery, context = {}) {
  // Check edge cases first
  const edgeCase = handleEdgeCases(rawQuery);
  if (edgeCase) {
    return {
      rawQuery,
      normalized: rawQuery ? rawQuery.toLowerCase().trim() : '',
      tokens: {},
      signals: {},
      intent: {
        templateId: edgeCase.templateId,
        category: 'discovery',
        ruleId: edgeCase.edgeCaseRuleId,
        ruleName: edgeCase.edgeCaseDescription,
        requiresDocId: false,
      },
      params: edgeCase.params,
      ambiguity: { isAmbiguous: false, reasons: [] },
      note: edgeCase.note,
      isEdgeCase: true,
      parsedAt: new Date().toISOString(),
    };
  }

  return parser.parse(rawQuery, context);
}

module.exports = {
  parseQuery,
  QueryParser,
  KEYWORD_DICTIONARIES,
  INTENT_MAPPING_RULES,
  EDGE_CASE_RULES,
  handleEdgeCases,
};
