/**
 * VQL QUERY TEMPLATE LIBRARY — VeevaVaultSearch
 *
 * Reusable, parameterized VQL templates for Veeva Vault.
 * All queries are deterministic, audit-safe, and use only VQL syntax.
 *
 * Template format:
 *   id:          Unique template identifier
 *   category:    Top-level category for UI grouping
 *   name:        Human-readable template name
 *   description: What this query returns and why it's useful
 *   filters:     Named parameters injected at runtime
 *   vql:         VQL string with {{param}} placeholders
 *   explanation: Field-by-field explanation for audit trail
 *
 * Usage:
 *   const rendered = VQLTemplateLibrary.render('sop_approved', { product: 'Drug-A' });
 *
 * ─────────────────────────────────────────────────────────────
 * MDL SCHEMA BLOCK (P2-5)
 * ─────────────────────────────────────────────────────────────
 * After connecting to a Vault tenant and running schema discovery
 * (connect.html → Step 4), the search panel automatically detects
 * your tenant's real type/field/state names and stores them in
 * localStorage under "vault_schema".
 *
 * To permanently bake those names into this file so they become
 * the compile-time defaults (useful for CI/CD or server-side
 * rendering), do the following:
 *
 *   1. Open search-panel.html in a browser connected to Vault.
 *   2. Click the ⚙ (gear) icon → "Discovered Schema" tab.
 *   3. Click "Copy MDL block".
 *   4. Paste the copied block here, replacing the PLACEHOLDER
 *      block below.
 *   5. Update VAULT_CONFIG_DEFAULTS with the overrides listed
 *      inside the block.
 *
 * PLACEHOLDER — paste your tenant's discovered MDL block here:
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║  DISCOVERED VAULT SCHEMA  ·  (not yet discovered)       ║
 * ║  Run schema discovery in connect.html to populate this. ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * VAULT_CONFIG_DEFAULTS overrides to add:
 *   (none — using VQL API default field names)
 *
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// HELPER: Template renderer
// ─────────────────────────────────────────────────────────────

function renderVQL(template, params = {}) {
  let vql = template.vql;

  // Replace named parameters
  for (const [key, value] of Object.entries(params)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    vql = vql.replace(placeholder, value);
  }

  // Remove optional blocks if their param is missing
  vql = vql.replace(/\{\{#if \w+\}\}.*?\{\{\/if\}\}/gs, '');

  // Clean up extra whitespace
  vql = vql.replace(/\s+/g, ' ').trim();

  return {
    templateId: template.id,
    vql,
    params,
    generatedAt: new Date().toISOString(),
    auditNote: `Query generated from template: ${template.id}`,
  };
}

// ─────────────────────────────────────────────────────────────
// SECTION 1: DOCUMENT DISCOVERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const DOCUMENT_DISCOVERY_TEMPLATES = [
  {
    id: 'doc_all_accessible',
    category: 'Document Discovery',
    name: 'All Accessible Documents',
    description: 'Returns all documents the current user can see, latest version only, sorted by last modification date.',
    filters: {},
    vql: `
      SELECT id, name__v, type__v, subtype__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             last_modified_date__v, owner__v, status__v
      FROM documents
      WHERE is_latest_version__v = true
        AND lifecycle_state__v != 'obsolete__v'
      ORDER BY last_modified_date__v DESC
      LIMIT 100
    `,
    explanation: `
      - is_latest_version__v = true        → Only the most recent version of each document
      - lifecycle_state__v != 'obsolete__v' → Excludes retired documents from default view
      - ORDER BY last_modified_date__v DESC → Most recently changed documents appear first
      - LIMIT 100                           → Pagination guard; use OFFSET for subsequent pages
    `,
  },

  {
    id: 'doc_by_type',
    category: 'Document Discovery',
    name: 'Documents by Type',
    description: 'Returns all latest-version documents of a specific document type.',
    filters: {
      type: { required: true, vqlField: 'type__v', description: 'Vault document type (e.g., Standard Operating Procedure__c)' },
    },
    vql: `
      SELECT id, name__v, type__v, subtype__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = '{{type}}'
        AND is_latest_version__v = true
        AND lifecycle_state__v != 'obsolete__v'
      ORDER BY name__v ASC
    `,
    explanation: `
      - type__v = '{{type}}'              → Exact match on Vault document type API name
      - is_latest_version__v = true        → Latest version only (no version noise)
      - lifecycle_state__v != 'obsolete__v' → Exclude retired documents
      - ORDER BY name__v ASC               → Alphabetical for predictable ordering
    `,
  },

  {
    id: 'doc_by_lifecycle_state',
    category: 'Document Discovery',
    name: 'Documents by Lifecycle State',
    description: 'Returns all documents in a specific lifecycle state (e.g., "approved__v", "draft__v").',
    filters: {
      lifecycle_state: { required: true, vqlField: 'lifecycle_state__v', description: 'Vault lifecycle state API name' },
    },
    vql: `
      SELECT id, name__v, type__v, lifecycle_state__v,
             major_version_number__v, owner__v, last_modified_date__v
      FROM documents
      WHERE lifecycle_state__v = '{{lifecycle_state}}'
        AND is_latest_version__v = true
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - lifecycle_state__v = '{{lifecycle_state}}' → Exact state match
      - is_latest_version__v = true                 → Only current version
    `,
  },

  {
    id: 'doc_by_product',
    category: 'Document Discovery',
    name: 'Documents by Product',
    description: 'Returns all documents associated with a specific product.',
    filters: {
      product_id: { required: true, vqlField: 'product__v', description: 'Product object ID in Vault' },
    },
    vql: `
      SELECT id, name__v, type__v, lifecycle_state__v,
             major_version_number__v, product__v, last_modified_date__v
      FROM documents
      WHERE product__v CONTAINS '{{product_id}}'
        AND is_latest_version__v = true
        AND lifecycle_state__v != 'obsolete__v'
      ORDER BY type__v ASC, name__v ASC
    `,
    explanation: `
      - product__v CONTAINS '{{product_id}}' → Multi-value picklist contains check
      - Sorted by type then name for organized browsing
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 2: SOP QUERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const SOP_TEMPLATES = [
  {
    id: 'sop_approved',
    category: 'SOP',
    name: 'Approved SOPs',
    description: 'Returns all currently approved Standard Operating Procedures. Most common compliance query.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             effective_date__v, owner__v, last_modified_date__v
      FROM documents
      WHERE type__v = 'Standard Operating Procedure__c'
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY name__v ASC
    `,
    explanation: `
      - type__v = 'Standard Operating Procedure__c'   → SOP type only
      - lifecycle_state__v IN ('approved__v','effective__v') → Both approved and in-effect states
      - is_latest_version__v = true                    → Current version only
    `,
  },

  {
    id: 'sop_latest_all_states',
    category: 'SOP',
    name: 'Latest SOPs (All States)',
    description: 'Returns latest version of all SOPs regardless of state — useful for QA admin review.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             last_modified_date__v, owner__v, created_by__v
      FROM documents
      WHERE type__v = 'Standard Operating Procedure__c'
        AND is_latest_version__v = true
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - No lifecycle_state__v filter → Returns ALL states including draft, in_review__v
      - is_latest_version__v = true  → Latest version only (no historical versions)
      - Useful for: QA admin oversight, workflow management
      - Access: QA_ADMIN role only (enforced at permission layer)
    `,
  },

  {
    id: 'sop_by_product',
    category: 'SOP',
    name: 'SOPs for a Product',
    description: 'Returns approved SOPs associated with a specific product.',
    filters: {
      product_id: { required: true, vqlField: 'product__v', description: 'Product object ID' },
    },
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             major_version_number__v, product__v, effective_date__v
      FROM documents
      WHERE type__v = 'Standard Operating Procedure__c'
        AND product__v CONTAINS '{{product_id}}'
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY name__v ASC
    `,
    explanation: `
      - product__v CONTAINS '{{product_id}}' → Product association (multi-value field)
      - Combined with SOP type and approved states
    `,
  },

  {
    id: 'sop_recently_updated',
    category: 'SOP',
    name: 'Recently Updated SOPs',
    description: 'SOPs modified in the last N days. Default: 30 days.',
    filters: {
      days_back: { required: false, default: 30, vqlField: 'last_modified_date__v', description: 'Number of days to look back' },
    },
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             major_version_number__v, last_modified_date__v,
             last_modified_by__v
      FROM documents
      WHERE type__v = 'Standard Operating Procedure__c'
        AND is_latest_version__v = true
        AND last_modified_date__v >= dateadd(now(), -{{days_back}}, 'day')
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - dateadd(now(), -{{days_back}}, 'day') → VQL date arithmetic function
      - Default 30-day window; configurable via filter
      - Shows all states: helps QA track what changed recently
    `,
  },

  {
    id: 'sop_expiring_soon',
    category: 'SOP',
    name: 'SOPs Expiring Soon',
    description: 'Approved SOPs whose expiration date falls within the next N days.',
    filters: {
      days_ahead: { required: false, default: 90, description: 'Number of days to look ahead for expiration' },
    },
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             major_version_number__v, expiration_date__v,
             effective_date__v, owner__v
      FROM documents
      WHERE type__v = 'Standard Operating Procedure__c'
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
        AND expiration_date__v != null
        AND expiration_date__v <= dateadd(now(), {{days_ahead}}, 'day')
        AND expiration_date__v >= now()
      ORDER BY expiration_date__v ASC
    `,
    explanation: `
      - expiration_date__v != null                          → Only docs with expiry set
      - expiration_date__v <= dateadd(now(), N, 'day')     → Expires within N days
      - expiration_date__v >= now()                         → Not yet expired
      - ORDER BY expiration_date__v ASC                    → Soonest expiry first
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 3: DEVIATION QUERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const DEVIATION_TEMPLATES = [
  {
    id: 'deviation_all_open',
    category: 'Deviation',
    name: 'All Open Deviations',
    description: 'Returns all open deviation reports currently under investigation.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, deviation_type__v,
             created_date__v, owner__v, product__v
      FROM documents
      WHERE type__v = 'Deviation__c'
        AND lifecycle_state__v IN ('open__v', 'in_progress__v')
        AND is_latest_version__v = true
      ORDER BY severity__v ASC, created_date__v DESC
    `,
    explanation: `
      - type__v = 'Deviation__c'                         → Deviation documents only
      - lifecycle_state__v IN ('open__v','in_progress__v') → Active investigations only
      - ORDER BY severity__v ASC, created_date__v DESC    → Critical first, then newest
    `,
  },

  {
    id: 'deviation_reports_by_product',
    category: 'Deviation',
    name: 'Deviation Reports for a Product',
    description: 'All deviations (any state) linked to a specific product.',
    filters: {
      product_id: { required: true, vqlField: 'product__v', description: 'Product object ID' },
    },
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, deviation_type__v,
             created_date__v, owner__v, capa_id__c
      FROM documents
      WHERE type__v = 'Deviation__c'
        AND product__v CONTAINS '{{product_id}}'
        AND is_latest_version__v = true
      ORDER BY created_date__v DESC
    `,
    explanation: `
      - product__v CONTAINS '{{product_id}}' → Product filter
      - No state filter → Returns all states for product-level oversight
      - capa_id__c included → Links deviation to CAPA for traceability
    `,
  },

  {
    id: 'deviation_high_severity',
    category: 'Deviation',
    name: 'High Severity Deviations',
    description: 'Returns Critical and Major severity deviations that are open.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, deviation_type__v,
             created_date__v, owner__v, capa_id__c, product__v
      FROM documents
      WHERE type__v = 'Deviation__c'
        AND severity__v IN ('critical__v', 'major__v')
        AND lifecycle_state__v IN ('open__v', 'in_progress__v')
        AND is_latest_version__v = true
      ORDER BY severity__v ASC, created_date__v DESC
    `,
    explanation: `
      - severity__v IN ('critical__v','major__v') → High severity filter
      - Open/In Progress states only              → Active issues
      - Critical listed before Major (ASC sort)   → Worst first
    `,
  },

  {
    id: 'deviation_linked_capa',
    category: 'Deviation',
    name: 'Deviations with Linked CAPAs',
    description: 'Deviations that have a CAPA record associated — for traceability review.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, capa_id__c, created_date__v,
             owner__v, product__v
      FROM documents
      WHERE type__v = 'Deviation__c'
        AND capa_id__c != null
        AND is_latest_version__v = true
      ORDER BY created_date__v DESC
    `,
    explanation: `
      - capa_id__c != null → Ensures CAPA relationship exists (traceability check)
      - All lifecycle states → Shows closed deviations with CAPA for audit
    `,
  },

  {
    id: 'deviation_sop_violations',
    category: 'Deviation',
    name: 'Procedural Deviations (SOP Violations)',
    description: 'Deviations classified as procedural — indicates SOP was not followed.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, deviation_type__v,
             created_date__v, owner__v, product__v
      FROM documents
      WHERE type__v = 'Deviation__c'
        AND deviation_type__v = 'Procedural Deviation__c'
        AND is_latest_version__v = true
      ORDER BY created_date__v DESC
    `,
    explanation: `
      - deviation_type__v = 'Procedural Deviation__c' → Procedural/SOP-related deviations
      - Useful for: identifying which SOPs have compliance issues
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 4: CAPA QUERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const CAPA_TEMPLATES = [
  {
    id: 'capa_open',
    category: 'CAPA',
    name: 'Open CAPAs',
    description: 'All open Corrective and Preventive Actions requiring attention.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, priority__v,
             created_date__v, owner__v, product__v
      FROM documents
      WHERE type__v = 'CAPA__c'
        AND lifecycle_state__v IN ('open__v', 'in_progress__v')
        AND is_latest_version__v = true
      ORDER BY priority__v ASC, created_date__v DESC
    `,
    explanation: `
      - type__v = 'CAPA__c'                              → CAPA documents only
      - lifecycle_state__v IN ('open__v','in_progress__v') → Active CAPAs
      - ORDER BY priority__v ASC                         → Highest priority first
    `,
  },

  {
    id: 'capa_closed',
    category: 'CAPA',
    name: 'Closed CAPAs',
    description: 'Completed and verified CAPAs. Used for audit evidence and trend analysis.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, last_modified_date__v,
             owner__v, product__v
      FROM documents
      WHERE type__v = 'CAPA__c'
        AND lifecycle_state__v = 'closed__v'
        AND is_latest_version__v = true
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - lifecycle_state__v = 'closed__v' → Only completed CAPAs
      - Closed date approximated via last_modified_date__v
      - Useful for: inspection readiness, effectiveness checks
    `,
  },

  {
    id: 'capa_high_severity',
    category: 'CAPA',
    name: 'High Severity CAPAs',
    description: 'Critical and Major severity CAPAs — these require executive attention.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, priority__v,
             created_date__v, owner__v, product__v
      FROM documents
      WHERE type__v = 'CAPA__c'
        AND severity__v IN ('critical__v', 'major__v')
        AND is_latest_version__v = true
      ORDER BY severity__v ASC, lifecycle_state__v ASC, created_date__v DESC
    `,
    explanation: `
      - severity__v IN ('critical__v','major__v') → High severity only
      - All lifecycle states → Shows open and closed critical CAPAs
      - Sorted: Critical first, then by state (Open before Closed)
    `,
  },

  {
    id: 'capa_overdue',
    category: 'CAPA',
    name: 'Overdue CAPAs',
    description: 'Open CAPAs that are past their target completion date.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, expiration_date__v,
             owner__v, product__v, created_date__v
      FROM documents
      WHERE type__v = 'CAPA__c'
        AND lifecycle_state__v IN ('open__v', 'in_progress__v')
        AND expiration_date__v != null
        AND expiration_date__v < now()
        AND is_latest_version__v = true
      ORDER BY expiration_date__v ASC
    `,
    explanation: `
      - expiration_date__v < now()     → Past due date
      - Still open states              → Not yet resolved
      - ORDER BY expiration_date__v ASC → Most overdue first (earliest due date)
    `,
  },

  {
    id: 'capa_by_product',
    category: 'CAPA',
    name: 'CAPAs for a Product',
    description: 'All CAPAs associated with a specific product — for product quality oversight.',
    filters: {
      product_id: { required: true, vqlField: 'product__v', description: 'Product object ID' },
    },
    vql: `
      SELECT id, name__v, title__v, lifecycle_state__v,
             severity__v, priority__v,
             created_date__v, owner__v
      FROM documents
      WHERE type__v = 'CAPA__c'
        AND product__v CONTAINS '{{product_id}}'
        AND is_latest_version__v = true
      ORDER BY lifecycle_state__v ASC, severity__v ASC
    `,
    explanation: `
      - product__v CONTAINS '{{product_id}}' → Product-scoped CAPA view
      - All states → Complete product quality picture
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 5: AUDIT / COMPLIANCE QUERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const AUDIT_TEMPLATES = [
  {
    id: 'audit_ready_docs',
    category: 'Audit',
    name: 'Audit-Ready Documents',
    description: 'All approved, GxP-relevant documents in effective state — the core inspection package.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, effective_date__v,
             expiration_date__v, owner__v, gxp_relevant__c
      FROM documents
      WHERE lifecycle_state__v IN ('approved__v', 'effective__v')
        AND gxp_relevant__c = true
        AND is_latest_version__v = true
        AND expiration_date__v > now()
      ORDER BY type__v ASC, name__v ASC
    `,
    explanation: `
      - lifecycle_state__v IN ('approved__v','effective__v') → Only approved documents
      - gxp_relevant__c = true                               → GxP-relevant documents only
      - expiration_date__v > now()                           → Not expired
      - is_latest_version__v = true                          → Current version
      - Sorted by type then name for systematic audit walk
    `,
  },

  {
    id: 'audit_inspection_package',
    category: 'Audit',
    name: 'Inspection-Ready Package',
    description: 'Documents needed for regulatory inspection: SOPs, Deviations, CAPAs, all in approved/closed states.',
    filters: {
      product_id: { required: false, vqlField: 'product__v', description: 'Optional: scope to a product' },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, effective_date__v,
             severity__v, owner__v, product__v
      FROM documents
      WHERE type__v IN (
          'Standard Operating Procedure__c',
          'Deviation__c',
          'CAPA__c',
          'Report__c'
        )
        AND lifecycle_state__v IN ('approved__v', 'effective__v', 'closed__v')
        AND is_latest_version__v = true
      ORDER BY type__v ASC, name__v ASC
    `,
    explanation: `
      - type__v IN (SOP, Deviation, CAPA, Report) → Core inspection document types
      - Approved/Effective/Closed states          → Finalized documents only (no drafts)
      - is_latest_version__v = true               → Inspectors see current versions
      - No AI scoring — every document meeting criteria is returned
    `,
  },

  {
    id: 'audit_change_log',
    category: 'Audit',
    name: 'Recent Change Log',
    description: 'Documents modified in the last 30 days — for pre-inspection change review.',
    filters: {
      days_back: { required: false, default: 30, description: 'Days to look back (default: 30)' },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, last_modified_date__v,
             last_modified_by__v
      FROM documents
      WHERE last_modified_date__v >= dateadd(now(), -{{days_back}}, 'day')
        AND lifecycle_state__v NOT IN ('obsolete__v', 'superseded__v')
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - dateadd window captures all recent changes
      - Excludes obsolete/superseded states       → Focus on active document changes
      - ORDER BY last_modified_date__v DESC       → Most recent changes first
    `,
  },

  {
    id: 'audit_unsigned_docs',
    category: 'Audit',
    name: 'Documents Missing Electronic Signature',
    description: 'GxP-relevant documents in approved state that lack an electronic signature.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, electronic_signature__v,
             owner__v, effective_date__v
      FROM documents
      WHERE gxp_relevant__c = true
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND electronic_signature__v = false
        AND is_latest_version__v = true
      ORDER BY type__v ASC, name__v ASC
    `,
    explanation: `
      - electronic_signature__v = false → Unsigned documents (compliance gap)
      - Approved/Effective state         → Should be signed if in these states
      - Useful for: pre-inspection compliance gap analysis
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 6: TIME-BASED QUERY TEMPLATES
// ─────────────────────────────────────────────────────────────

const TIME_BASED_TEMPLATES = [
  {
    id: 'time_last_30_days_changes',
    category: 'Time-Based',
    name: 'Changes in Last 30 Days',
    description: 'All document modifications across all types in the last 30 days.',
    filters: {
      days_back: { required: false, default: 30 },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             last_modified_date__v, last_modified_by__v
      FROM documents
      WHERE last_modified_date__v >= dateadd(now(), -{{days_back}}, 'day')
      ORDER BY last_modified_date__v DESC
      LIMIT 200
    `,
    explanation: `
      - Broad time-window query; no type or state filter
      - LIMIT 200 guards against large result sets
      - Returns all document types for cross-functional review
    `,
  },

  {
    id: 'time_recently_approved',
    category: 'Time-Based',
    name: 'Recently Approved Documents',
    description: 'Documents that transitioned to Approved or Effective state in the last N days.',
    filters: {
      days_back: { required: false, default: 30, description: 'Look-back window in days' },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, approved_date__v, owner__v
      FROM documents
      WHERE lifecycle_state__v IN ('approved__v', 'effective__v')
        AND approved_date__v >= dateadd(now(), -{{days_back}}, 'day')
        AND is_latest_version__v = true
      ORDER BY approved_date__v DESC
    `,
    explanation: `
      - approved_date__v >= dateadd window  → Only recently approved
      - Not using last_modified_date__v     → More precise: approval date, not edit date
      - is_latest_version__v = true         → Latest version
    `,
  },

  {
    id: 'time_expiring_documents',
    category: 'Time-Based',
    name: 'Expiring Documents (Next 90 Days)',
    description: 'All documents with expiration dates within the next 90 days — for renewal planning.',
    filters: {
      days_ahead: { required: false, default: 90, description: 'Days to look ahead for expiration' },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, expiration_date__v,
             effective_date__v, owner__v
      FROM documents
      WHERE expiration_date__v != null
        AND expiration_date__v >= now()
        AND expiration_date__v <= dateadd(now(), {{days_ahead}}, 'day')
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY expiration_date__v ASC
    `,
    explanation: `
      - expiration_date__v between now and now+N  → Upcoming expirations
      - Still approved/effective state             → Active documents about to expire
      - ORDER BY expiration_date__v ASC            → Soonest first (action priority)
    `,
  },

  {
    id: 'time_new_documents',
    category: 'Time-Based',
    name: 'Newly Created Documents',
    description: 'Documents created from scratch (not revised) in the last N days.',
    filters: {
      days_back: { required: false, default: 30 },
    },
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, created_date__v, created_by__v
      FROM documents
      WHERE created_date__v >= dateadd(now(), -{{days_back}}, 'day')
        AND major_version_number__v = 0
        AND minor_version_number__v = 1
      ORDER BY created_date__v DESC
    `,
    explanation: `
      - created_date__v >= dateadd window       → New documents only
      - major_version_number__v = 0 AND minor = 1 → First version (0.1) — truly new
      - Useful for: tracking new document creation velocity
    `,
  },

  {
    id: 'time_version_history',
    category: 'Time-Based',
    name: 'Full Version History for a Document',
    description: 'All versions of a specific document, newest first.',
    filters: {
      doc_id: { required: true, vqlField: 'id', description: 'Base document ID (not version_id)' },
    },
    vql: `
      SELECT id, version_id, name__v, lifecycle_state__v,
             major_version_number__v, minor_version_number__v,
             created_date__v, approved_date__v,
             last_modified_by__v, status__v
      FROM documents
      WHERE id = '{{doc_id}}'
      ORDER BY major_version_number__v DESC, minor_version_number__v DESC
    `,
    explanation: `
      - id = '{{doc_id}}'                          → Vault returns ALL versions for this ID
      - No is_latest_version__v filter              → Intentionally fetches all versions
      - ORDER newest version first                  → Most relevant version visible first
      - Note: Vault returns all versions when you query by doc id without version filter
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 7: SPECIALTY TEMPLATE PACKS
//   eTMF | RIM | Safety | PromoMats
// ─────────────────────────────────────────────────────────────

const ETMF_TEMPLATES = [
  {
    id: 'etmf_all_docs',
    category: 'eTMF',
    name: 'All eTMF Documents',
    description: 'All Trial Master File documents, grouped by study. Used for TMF oversight and health checks.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, clinical_study__c, last_modified_date__v,
             owner__v
      FROM documents
      WHERE type__v = 'TMF__c'
        AND is_latest_version__v = true
      ORDER BY clinical_study__c ASC, name__v ASC
    `,
    explanation: `
      - type__v = 'TMF__c'              → Trial Master File document type
      - is_latest_version__v = true      → Latest versions only
      - Grouped by study then name        → Structured TMF review
    `,
  },
  {
    id: 'etmf_by_study',
    category: 'eTMF',
    name: 'eTMF Documents by Study',
    description: 'Active TMF documents grouped by clinical study — excludes obsolete and closed.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, clinical_study__c, last_modified_date__v
      FROM documents
      WHERE type__v = 'TMF__c'
        AND clinical_study__c != null
        AND lifecycle_state__v NOT IN ('obsolete__v', 'closed__v')
        AND is_latest_version__v = true
      ORDER BY clinical_study__c ASC, type__v ASC, name__v ASC
    `,
    explanation: `
      - clinical_study__c != null        → Study-linked documents only
      - Excludes Obsolete and Closed      → Active TMF content only
    `,
  },
];

const RIM_TEMPLATES = [
  {
    id: 'rim_submissions',
    category: 'RIM',
    name: 'Regulatory Submissions',
    description: 'Documents in submitted, pending, or under-review lifecycle states — regulatory dossiers in flight.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = 'Regulatory__c'
        AND lifecycle_state__v IN ('submitted__v', 'pending_approval__v', 'in_review__v')
        AND is_latest_version__v = true
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - type__v = 'Regulatory__c'        → Regulatory document type
      - Submitted/Pending/In Review       → Documents actively in regulatory pipeline
    `,
  },
  {
    id: 'rim_approved_labels',
    category: 'RIM',
    name: 'Approved Product Labels',
    description: 'Regulatory documents in approved or effective state — current authorized labels.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = 'Regulatory__c'
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY name__v ASC
    `,
    explanation: `
      - Approved/Effective states         → Current authorized labels only
      - is_latest_version__v = true       → No superseded versions
    `,
  },
];

const SAFETY_TEMPLATES = [
  {
    id: 'safety_adverse_events',
    category: 'Safety',
    name: 'Open Adverse Event Cases',
    description: 'Adverse event documents currently under investigation — sorted by severity.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             severity__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = 'AdverseEvent__c'
        AND lifecycle_state__v IN ('open__v', 'in_progress__v')
        AND is_latest_version__v = true
      ORDER BY severity__v ASC, last_modified_date__v DESC
    `,
    explanation: `
      - type__v = 'AdverseEvent__c'      → Adverse event documents
      - Open/In Progress                  → Active investigations
      - ORDER BY severity__v ASC          → Critical cases first
    `,
  },
  {
    id: 'safety_open_cases',
    category: 'Safety',
    name: 'Open Safety Cases (All Types)',
    description: 'All open safety documents: adverse events and safety cases combined — for pharmacovigilance oversight.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             severity__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v IN ('AdverseEvent__c', 'SafetyCase__c')
        AND lifecycle_state__v != 'closed__v'
        AND is_latest_version__v = true
      ORDER BY last_modified_date__v DESC
    `,
    explanation: `
      - type__v IN (AdverseEvent, SafetyCase) → All pharmacovigilance document types
      - Not Closed                             → Open investigations only
    `,
  },
];

const PROMOMATS_TEMPLATES = [
  {
    id: 'promomats_approved',
    category: 'PromoMats',
    name: 'Approved Promotional Content',
    description: 'All currently approved promotional materials — safe to use for marketing and sales.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = 'PromotionalMaterial__c'
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY name__v ASC
    `,
    explanation: `
      - type__v = 'PromotionalMaterial__c' → Promotional content type
      - Approved/Effective                  → Only currently approved content
    `,
  },
  {
    id: 'promomats_expiring',
    category: 'PromoMats',
    name: 'Promotional Content Expiring in 90 Days',
    description: 'Approved promotional materials whose approval expires within 90 days — requires renewal.',
    filters: {},
    vql: `
      SELECT id, name__v, title__v, type__v, lifecycle_state__v,
             major_version_number__v, expiration_date__v, last_modified_date__v, owner__v
      FROM documents
      WHERE type__v = 'PromotionalMaterial__c'
        AND expiration_date__v > now()
        AND expiration_date__v <= dateadd(now(), 90, 'day')
        AND lifecycle_state__v IN ('approved__v', 'effective__v')
        AND is_latest_version__v = true
      ORDER BY expiration_date__v ASC
    `,
    explanation: `
      - expiration window <= 90 days       → Due for renewal
      - Approved/Effective only            → Active content that must be renewed
      - ORDER BY expiration_date__v ASC    → Most urgent first
    `,
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 8: FULL TEMPLATE LIBRARY INDEX
// ─────────────────────────────────────────────────────────────

const ALL_TEMPLATES = [
  ...DOCUMENT_DISCOVERY_TEMPLATES,
  ...SOP_TEMPLATES,
  ...DEVIATION_TEMPLATES,
  ...CAPA_TEMPLATES,
  ...AUDIT_TEMPLATES,
  ...TIME_BASED_TEMPLATES,
  ...ETMF_TEMPLATES,
  ...RIM_TEMPLATES,
  ...SAFETY_TEMPLATES,
  ...PROMOMATS_TEMPLATES,
];

// Build lookup map for O(1) access by template ID
const TEMPLATE_MAP = ALL_TEMPLATES.reduce((map, t) => {
  map[t.id] = t;
  return map;
}, {});

// ─────────────────────────────────────────────────────────────
// SECTION 9: PUBLIC API
// ─────────────────────────────────────────────────────────────

const VQLTemplateLibrary = {
  /**
   * Get all templates (optionally filtered by category)
   * @param {string} [category] - Optional category filter
   * @returns {Array} Matching templates
   */
  getAll(category) {
    if (category) {
      return ALL_TEMPLATES.filter(t => t.category.toLowerCase() === category.toLowerCase());
    }
    return ALL_TEMPLATES;
  },

  /**
   * Get a single template by ID
   * @param {string} id - Template ID
   * @returns {Object|null} Template or null
   */
  getById(id) {
    return TEMPLATE_MAP[id] || null;
  },

  /**
   * Render a template with parameters substituted
   * @param {string} id - Template ID
   * @param {Object} params - Parameter key/value pairs
   * @returns {Object} { templateId, vql, params, generatedAt, auditNote }
   */
  render(id, params = {}) {
    const template = this.getById(id);
    if (!template) {
      throw new Error(`VQL template not found: ${id}`);
    }

    // Apply defaults for missing optional params
    const mergedParams = {};
    if (template.filters) {
      for (const [key, filterDef] of Object.entries(template.filters)) {
        mergedParams[key] = params[key] !== undefined
          ? params[key]
          : (filterDef.default !== undefined ? filterDef.default : null);
      }
    }
    Object.assign(mergedParams, params);

    // Validate required params
    if (template.filters) {
      for (const [key, filterDef] of Object.entries(template.filters)) {
        if (filterDef.required && !mergedParams[key]) {
          throw new Error(`Required parameter missing for template ${id}: ${key}`);
        }
      }
    }

    return renderVQL(template, mergedParams);
  },

  /**
   * List all available categories
   * @returns {string[]} Unique category names
   */
  getCategories() {
    return [...new Set(ALL_TEMPLATES.map(t => t.category))];
  },

  /**
   * Search templates by keyword in name/description
   * @param {string} keyword
   * @returns {Array} Matching templates (ordered by relevance — deterministic)
   */
  search(keyword) {
    const kw = keyword.toLowerCase();
    return ALL_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw) ||
      t.category.toLowerCase().includes(kw)
    );
  },
};

module.exports = {
  VQLTemplateLibrary,
  DOCUMENT_DISCOVERY_TEMPLATES,
  SOP_TEMPLATES,
  DEVIATION_TEMPLATES,
  CAPA_TEMPLATES,
  AUDIT_TEMPLATES,
  TIME_BASED_TEMPLATES,
  ETMF_TEMPLATES,
  RIM_TEMPLATES,
  SAFETY_TEMPLATES,
  PROMOMATS_TEMPLATES,
  ALL_TEMPLATES,
};
