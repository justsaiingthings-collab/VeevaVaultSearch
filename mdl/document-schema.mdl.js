/**
 * MDL DATA MODEL — VeevaVaultSearch
 * Veeva Vault Metadata Definition Layer (MDL)
 *
 * Defines the complete metadata schema for the Structured Search & Guided
 * Retrieval Layer. All fields map 1:1 to Vault object / document fields
 * accessible via VQL SELECT clauses.
 *
 * CONSTRAINTS:
 *  - No AI / No ML / No semantic search
 *  - All fields are deterministic and audit-safe
 *  - Permissions enforced at Vault API layer BEFORE results reach UI
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// SECTION 1: DOCUMENT ENTITY
// Maps to Vault binder/document object
// ─────────────────────────────────────────────────────────────

const DOCUMENT_ENTITY = {
  name: 'document',
  vaultObject: 'documents',        // VQL FROM clause target
  vqlAlias: 'doc',

  fields: {
    // --- Core Identity ---
    id:                   { type: 'ID',       vqlField: 'id',                   nullable: false },
    name:                 { type: 'STRING',   vqlField: 'name__v',              nullable: false },
    title:                { type: 'STRING',   vqlField: 'title__v',             nullable: true  },
    type:                 { type: 'PICKLIST', vqlField: 'type__v',              nullable: false },
    subtype:              { type: 'PICKLIST', vqlField: 'subtype__v',           nullable: true  },
    classification:       { type: 'PICKLIST', vqlField: 'classification__v',    nullable: true  },

    // --- Version & Lifecycle ---
    version_id:           { type: 'STRING',   vqlField: 'version_id',           nullable: false },
    major_version:        { type: 'NUMBER',   vqlField: 'major_version_number__v', nullable: false },
    minor_version:        { type: 'NUMBER',   vqlField: 'minor_version_number__v', nullable: false },
    status:               { type: 'PICKLIST', vqlField: 'status__v',            nullable: false },
    lifecycle:            { type: 'STRING',   vqlField: 'lifecycle__v',         nullable: false },
    lifecycle_state:      { type: 'PICKLIST', vqlField: 'lifecycle_state__v',   nullable: false },

    // --- Ownership & Authorship ---
    owner:                { type: 'USER',     vqlField: 'owner__v',             nullable: true  },
    created_by:           { type: 'USER',     vqlField: 'created_by__v',        nullable: false },
    last_modified_by:     { type: 'USER',     vqlField: 'last_modified_by__v',  nullable: true  },

    // --- Timestamps ---
    created_date:         { type: 'DATETIME', vqlField: 'created_date__v',      nullable: false },
    last_modified_date:   { type: 'DATETIME', vqlField: 'last_modified_date__v',nullable: false },
    approved_date:        { type: 'DATETIME', vqlField: 'approved_date__v',     nullable: true  },
    expiration_date:      { type: 'DATETIME', vqlField: 'expiration_date__v',   nullable: true  },
    effective_date:       { type: 'DATETIME', vqlField: 'effective_date__v',    nullable: true  },

    // --- Regulatory / Product Context ---
    product:              { type: 'OBJECT',   vqlField: 'product__v',           nullable: true  },
    study:                { type: 'OBJECT',   vqlField: 'study__v',             nullable: true  },
    country:              { type: 'PICKLIST', vqlField: 'country__v',           nullable: true  },
    regulatory_region:    { type: 'PICKLIST', vqlField: 'regulatory_region__v', nullable: true  },
    submission_type:      { type: 'PICKLIST', vqlField: 'submission_type__v',   nullable: true  },

    // --- Quality Context ---
    quality_event_type:   { type: 'PICKLIST', vqlField: 'quality_event_type__v',nullable: true  },
    deviation_type:       { type: 'PICKLIST', vqlField: 'deviation_type__v',    nullable: true  },
    capa_id:              { type: 'STRING',   vqlField: 'capa_id__c',           nullable: true  },
    severity:             { type: 'PICKLIST', vqlField: 'severity__v',          nullable: true  },
    priority:             { type: 'PICKLIST', vqlField: 'priority__v',          nullable: true  },

    // --- Audit / Compliance ---
    audit_trail:          { type: 'BOOLEAN',  vqlField: 'audit_trail__v',       nullable: false },
    electronic_signature: { type: 'BOOLEAN',  vqlField: 'electronic_signature__v', nullable: true },
    gxp_relevant:         { type: 'BOOLEAN',  vqlField: 'gxp_relevant__c',      nullable: true  },

    // --- Access Control ---
    sharing_settings:     { type: 'PICKLIST', vqlField: 'sharing_settings__v',  nullable: false },
  }
};

// ─────────────────────────────────────────────────────────────
// SECTION 2: VERSION ENTITY
// Maps to Vault version sub-object (allversions modifier in VQL)
// ─────────────────────────────────────────────────────────────

const VERSION_ENTITY = {
  name: 'version',
  vaultObject: 'documents',
  vqlModifier: 'FIND allversions',   // Used in VQL WHERE / FROM context

  fields: {
    version_id:           { type: 'STRING',   vqlField: 'version_id',                   nullable: false },
    major_version:        { type: 'NUMBER',   vqlField: 'major_version_number__v',       nullable: false },
    minor_version:        { type: 'NUMBER',   vqlField: 'minor_version_number__v',       nullable: false },
    status:               { type: 'PICKLIST', vqlField: 'status__v',                    nullable: false },
    lifecycle_state:      { type: 'PICKLIST', vqlField: 'lifecycle_state__v',            nullable: false },
    created_date:         { type: 'DATETIME', vqlField: 'created_date__v',               nullable: false },
    approved_date:        { type: 'DATETIME', vqlField: 'approved_date__v',              nullable: true  },
    is_latest:            { type: 'BOOLEAN',  vqlField: 'is_latest_version__v',          nullable: false },
    checksum:             { type: 'STRING',   vqlField: 'md5checksum__v',                nullable: true  },
  },

  /**
   * VERSION HIERARCHY RULES
   *
   * Rule 1 — Latest Approved First:
   *   SELECT max(major_version_number__v) WHERE status__v = 'Approved'
   *
   * Rule 2 — Latest Draft (when no approved exists):
   *   SELECT max(major_version_number__v) WHERE status__v = 'Draft'
   *
   * Rule 3 — Version Group Key:
   *   Documents are grouped by their base document ID (id field, not version_id).
   *   All version_ids sharing the same document id belong to the same version group.
   *
   * Rule 4 — Superseded Suppression:
   *   Versions with lifecycle_state__v = 'Obsolete' or 'Superseded' are hidden
   *   from default result sets unless the user explicitly requests version history.
   *
   * Rule 5 — Minor Versions:
   *   Minor versions (1.1, 1.2) are collapsed under the major version card
   *   and only shown on expand in the UI.
   */
  versionHierarchyRules: {
    defaultSort: ['major_version_number__v DESC', 'minor_version_number__v DESC'],
    suppressedStates: ['obsolete__v', 'superseded__v', 'archived__v'],
    latestApprovedFirst: true,
    collapseMinorVersions: true,
    groupByDocumentId: true,
  }
};

// ─────────────────────────────────────────────────────────────
// SECTION 3: LIFECYCLE STATE DEFINITIONS
// Maps valid lifecycle state transitions and search filter values
// ─────────────────────────────────────────────────────────────

const LIFECYCLE_STATES = {
  // Standard QualityDocs Lifecycle
  QualityDocs: {
    states: ['draft__v', 'in_review__v', 'approved__v', 'effective__v', 'superseded__v', 'obsolete__v'],
    searchableStates: ['draft__v', 'in_review__v', 'approved__v', 'effective__v'],
    approvedStates: ['approved__v', 'effective__v'],
    draftStates: ['draft__v', 'in_review__v'],
    terminalStates: ['superseded__v', 'obsolete__v'],
  },
  // Standard Submission Lifecycle
  Submission: {
    states: ['draft__v', 'under_review__v', 'approved__v', 'submitted__v', 'accepted__v', 'rejected__v'],
    searchableStates: ['draft__v', 'under_review__v', 'approved__v', 'submitted__v'],
    approvedStates: ['approved__v', 'submitted__v', 'accepted__v'],
    draftStates: ['draft__v', 'under_review__v'],
    terminalStates: ['rejected__v'],
  },
  // CAPA / Deviation Lifecycle
  QualityEvent: {
    states: ['open__v', 'in_progress__v', 'pending_review__v', 'closed__v', 'cancelled__v'],
    searchableStates: ['open__v', 'in_progress__v', 'pending_review__v'],
    openStates: ['open__v', 'in_progress__v'],
    closedStates: ['closed__v', 'cancelled__v'],
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 4: DOCUMENT TYPE TAXONOMY
// Maps Vault document types to search categories
// ─────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_TAXONOMY = {
  'SOP': {
    vaultType: 'Standard Operating Procedure__c',
    vaultSubtypes: ['Quality SOP__c', 'Clinical SOP__c', 'Regulatory SOP__c', 'Manufacturing SOP__c'],
    defaultLifecycle: 'QualityDocs',
    searchCategory: 'sop',
    auditRequired: true,
  },
  'Deviation': {
    vaultType: 'Deviation__c',
    vaultSubtypes: ['Manufacturing Deviation__c', 'Procedural Deviation__c', 'Laboratory Deviation__c'],
    defaultLifecycle: 'QualityEvent',
    searchCategory: 'deviation',
    auditRequired: true,
  },
  'CAPA': {
    vaultType: 'CAPA__c',
    vaultSubtypes: ['Corrective Action__c', 'Preventive Action__c'],
    defaultLifecycle: 'QualityEvent',
    searchCategory: 'capa',
    auditRequired: true,
  },
  'Protocol': {
    vaultType: 'Protocol__c',
    vaultSubtypes: ['Study Protocol__c', 'Validation Protocol__c'],
    defaultLifecycle: 'QualityDocs',
    searchCategory: 'protocol',
    auditRequired: true,
  },
  'Report': {
    vaultType: 'Report__c',
    vaultSubtypes: ['Audit Report__c', 'Study Report__c', 'Deviation Report__c', 'Inspection Report__c'],
    defaultLifecycle: 'QualityDocs',
    searchCategory: 'report',
    auditRequired: true,
  },
  'Policy': {
    vaultType: 'Policy__c',
    vaultSubtypes: ['Quality Policy__c', 'Regulatory Policy__c'],
    defaultLifecycle: 'QualityDocs',
    searchCategory: 'policy',
    auditRequired: false,
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 5: RELATIONSHIP MODEL
// Defines cross-object relationships for JOIN-style VQL queries
// ─────────────────────────────────────────────────────────────

const RELATIONSHIP_MODEL = {
  // Document → CAPA link
  document_to_capa: {
    type: 'MANY_TO_ONE',
    fromObject: 'documents',
    fromField: 'capa_id__c',
    toObject: 'capa__c',
    toField: 'id',
    vqlJoin: "SELECT id FROM capa__c WHERE id = doc.capa_id__c",
  },
  // Document → Deviation link
  document_to_deviation: {
    type: 'MANY_TO_ONE',
    fromObject: 'documents',
    fromField: 'deviation_id__c',
    toObject: 'deviation__c',
    toField: 'id',
    vqlJoin: "SELECT id FROM deviation__c WHERE id = doc.deviation_id__c",
  },
  // Document → Product link
  document_to_product: {
    type: 'MANY_TO_MANY',
    fromObject: 'documents',
    fromField: 'product__v',
    toObject: 'product__v',
    toField: 'id',
    vqlJoin: "SELECT id FROM product__v WHERE id CONTAINS doc.product__v",
  },
  // Document → Study link
  document_to_study: {
    type: 'MANY_TO_MANY',
    fromObject: 'documents',
    fromField: 'study__v',
    toObject: 'study__v',
    toField: 'id',
    vqlJoin: "SELECT id FROM study__v WHERE id CONTAINS doc.study__v",
  },
};

// ─────────────────────────────────────────────────────────────
// SECTION 6: PERMISSIONS MODEL
// Defines how Vault security model maps to search behavior
// ─────────────────────────────────────────────────────────────

const PERMISSIONS_MODEL = {
  /**
   * CRITICAL: All permission enforcement happens at the Vault API layer.
   * The Vault REST API automatically applies the calling user's security profile.
   * VQL queries ONLY return documents the user has VIEW access to.
   *
   * Additional application-layer checks are defined below for defense-in-depth.
   */

  vaultNativeEnforcement: {
    description: 'Vault REST API enforces user security profile on every VQL execution',
    mechanism: 'Session-scoped OAuth token passed in every API call header',
    header: 'Authorization: Bearer {session_id}',
    guarantee: 'Vault NEVER returns documents outside the user\'s security profile',
  },

  securityProfiles: {
    // Maps role names to VQL-level restrictions
    QA_ADMIN: {
      allowedTypes: ['ALL'],
      allowedStates: ['ALL'],
      canViewDrafts: true,
      canViewObsolete: true,
      canViewAllVersions: true,
    },
    QA_USER: {
      allowedTypes: ['SOP', 'Deviation', 'CAPA', 'Report'],
      allowedStates: ['approved__v', 'effective__v', 'open__v', 'in_progress__v', 'closed__v'],
      canViewDrafts: false,
      canViewObsolete: false,
      canViewAllVersions: false,
    },
    CLINICAL_USER: {
      allowedTypes: ['Protocol', 'Report', 'SOP'],
      allowedStates: ['approved__v', 'effective__v'],
      canViewDrafts: false,
      canViewObsolete: false,
      canViewAllVersions: false,
    },
    REGULATORY_USER: {
      allowedTypes: ['SOP', 'Policy', 'Report', 'Protocol'],
      allowedStates: ['approved__v', 'effective__v', 'submitted__v'],
      canViewDrafts: false,
      canViewObsolete: false,
      canViewAllVersions: false,
    },
    READ_ONLY: {
      allowedTypes: ['SOP', 'Policy'],
      allowedStates: ['approved__v', 'effective__v'],
      canViewDrafts: false,
      canViewObsolete: false,
      canViewAllVersions: false,
    },
  },

  /**
   * APPLICATION-LAYER ACL RULES
   * Applied BEFORE results are serialized and returned to UI.
   * Defense-in-depth on top of Vault native enforcement.
   */
  aclRules: [
    {
      id: 'ACL-001',
      name: 'Draft Visibility Gate',
      description: 'Strip draft documents for non-admin roles',
      condition: (doc, userRole) =>
        userRole !== 'QA_ADMIN' && doc.lifecycle_state__v.includes('Draft'),
      action: 'EXCLUDE',
    },
    {
      id: 'ACL-002',
      name: 'Obsolete Version Gate',
      description: 'Strip obsolete versions unless user requests version history',
      condition: (doc, userRole, queryContext) =>
        !queryContext.includeVersionHistory &&
        ['obsolete__v', 'superseded__v'].includes(doc.lifecycle_state__v),
      action: 'EXCLUDE',
    },
    {
      id: 'ACL-003',
      name: 'Product Scope Gate',
      description: 'Limit results to products assigned to user\'s product team',
      condition: (doc, userRole, queryContext, userContext) =>
        userContext.productScope.length > 0 &&
        !userContext.productScope.includes(doc.product__v),
      action: 'EXCLUDE',
    },
    {
      id: 'ACL-004',
      name: 'Cross-Type Leak Prevention',
      description: 'Prevent Clinical users from seeing Quality-only documents',
      condition: (doc, userRole) =>
        userRole === 'CLINICAL_USER' &&
        ['Deviation', 'CAPA'].includes(doc.type__v),
      action: 'EXCLUDE',
    },
  ],
};

// ─────────────────────────────────────────────────────────────
// SECTION 7: MDL FILTER SCHEMA
// Defines all available filters in the search UI
// Each filter maps to a VQL WHERE clause component
// ─────────────────────────────────────────────────────────────

const MDL_FILTER_SCHEMA = [
  {
    id: 'filter_doc_type',
    label: 'Document Type',
    vqlField: 'type__v',
    type: 'MULTI_PICKLIST',
    values: Object.keys(DOCUMENT_TYPE_TAXONOMY).map(k => ({
      label: k,
      value: DOCUMENT_TYPE_TAXONOMY[k].vaultType,
    })),
    vqlOperator: 'CONTAINS',
  },
  {
    id: 'filter_lifecycle_state',
    label: 'Status',
    vqlField: 'lifecycle_state__v',
    type: 'MULTI_PICKLIST',
    values: [
      { label: 'Draft',          value: 'draft__v'         },
      { label: 'In Review',      value: 'in_review__v'     },
      { label: 'Approved',       value: 'approved__v'      },
      { label: 'Effective',      value: 'effective__v'     },
      { label: 'Open',           value: 'open__v'          },
      { label: 'In Progress',    value: 'in_progress__v'   },
      { label: 'Closed',         value: 'closed__v'        },
      { label: 'Obsolete',       value: 'obsolete__v'      },
    ],
    vqlOperator: 'CONTAINS',
  },
  {
    id: 'filter_product',
    label: 'Product',
    vqlField: 'product__v',
    type: 'OBJECT_LOOKUP',
    lookupObject: 'product__v',
    vqlOperator: 'CONTAINS',
  },
  {
    id: 'filter_study',
    label: 'Study',
    vqlField: 'study__v',
    type: 'OBJECT_LOOKUP',
    lookupObject: 'study__v',
    vqlOperator: 'CONTAINS',
  },
  {
    id: 'filter_date_range',
    label: 'Last Modified',
    vqlField: 'last_modified_date__v',
    type: 'DATE_RANGE',
    presets: [
      { label: 'Last 7 days',   days: 7   },
      { label: 'Last 30 days',  days: 30  },
      { label: 'Last 90 days',  days: 90  },
      { label: 'This year',     days: 365 },
    ],
    vqlOperator: 'BETWEEN',
  },
  {
    id: 'filter_severity',
    label: 'Severity',
    vqlField: 'severity__v',
    type: 'PICKLIST',
    values: [
      { label: 'Critical', value: 'critical__v' },
      { label: 'Major',    value: 'major__v'    },
      { label: 'Minor',    value: 'minor__v'    },
    ],
    vqlOperator: '=',
  },
  {
    id: 'filter_version_display',
    label: 'Version Display',
    vqlField: null,   // UI-only; controls version grouping display
    type: 'TOGGLE',
    options: [
      { label: 'Latest Only',    value: 'latest'  },
      { label: 'All Versions',   value: 'all'     },
    ],
    default: 'latest',
  },
  {
    id: 'filter_gxp',
    label: 'GxP Relevant Only',
    vqlField: 'gxp_relevant__c',
    type: 'BOOLEAN_TOGGLE',
    vqlOperator: '=',
    vqlValue: 'true',
  },
];

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  DOCUMENT_ENTITY,
  VERSION_ENTITY,
  LIFECYCLE_STATES,
  DOCUMENT_TYPE_TAXONOMY,
  RELATIONSHIP_MODEL,
  PERMISSIONS_MODEL,
  MDL_FILTER_SCHEMA,
};
