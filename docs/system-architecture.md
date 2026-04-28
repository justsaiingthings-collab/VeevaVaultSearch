# VeevaVaultSearch — P0 System Architecture

**Structured Search & Guided Retrieval Layer for Veeva Vault**

> Deterministic | Audit-Safe | Regulated Pharma | No AI / No ML

---

## 1. SYSTEM ARCHITECTURE

### Full Data Flow

```
USER INPUT (Vault SDK UI)
        │
        ▼
┌─────────────────────────────────────────┐
│        VAULT SDK UI LAYER               │
│  search-panel.html / search-panel.js    │
│                                         │
│  • Search Bar (debounced input)         │
│  • Recommended Query Chips (role-based) │
│  • Filter Panel (MDL-driven)            │
│  • Results Panel (version-grouped)      │
│  • VQL Preview (audit transparency)     │
└──────────────────┬──────────────────────┘
                   │ rawQuery + context
                   ▼
┌─────────────────────────────────────────┐
│        QUERY PARSER (Rule Engine)       │
│  query-parser/rule-engine.js            │
│                                         │
│  1. normalize()     → lowercase, trim   │
│  2. tokenize()      → unigrams+bigrams  │
│  3. extractSignals()→ docType, state,   │
│                        temporal, sev    │
│  4. matchRule()     → priority-ordered  │
│  5. buildParams()   → VQL substitution  │
│  → IntentObject { templateId, params }  │
└──────────────────┬──────────────────────┘
                   │ intentObject
                   ▼
┌─────────────────────────────────────────┐
│        VQL QUERY BUILDER                │
│  vql/query-templates.js                 │
│                                         │
│  • Template Library (25+ templates)     │
│  • VQLTemplateLibrary.render(id,params) │
│  • Parameter substitution              │
│  • Pagination injection                 │
│  → rendered VQL string                  │
└──────────────────┬──────────────────────┘
                   │ rendered VQL
                   ▼
┌─────────────────────────────────────────┐
│     PERMISSIONS GUARD (Pre-Query)       │
│  security/permissions-guard.js          │
│                                         │
│  • Session token validation             │
│  • Role resolution                      │
│  • VQL injection sanitization           │
│  • Audit log: every query               │
└──────────────────┬──────────────────────┘
                   │ validated VQL + session token
                   ▼
┌─────────────────────────────────────────┐
│       VQL EXECUTION SERVICE             │
│  backend-services/query-service.js      │
│                                         │
│  POST /api/v24.1/query                  │
│  Authorization: Bearer {sessionToken}   │
│  ← Vault enforces security profile      │
│  ← Returns only user-accessible docs    │
└──────────────────┬──────────────────────┘
                   │ raw Vault records
                   ▼
┌─────────────────────────────────────────┐
│   RESULT AGGREGATION SERVICE            │
│  backend-services/query-service.js      │
│                                         │
│  1. normalizeRecord()  → field mapping  │
│  2. applyACL()         → EXCLUDE rules  │
│  3. groupByDocument()  → version group  │
│  4. sortGroups()       → latest first   │
│  → AggregatedResult { groups, counts }  │
└──────────────────┬──────────────────────┘
                   │ filtered + grouped results
                   ▼
┌─────────────────────────────────────────┐
│     RECOMMENDATION SERVICE              │
│  recommendation-engine/recommender.js   │
│                                         │
│  • Keyword-triggered rule scoring       │
│  • Role bonus (fixed integers)          │
│  • Doc type context bonus               │
│  • Time-based bonus (EOQ, EOM)          │
│  → ranked QueryRecommendation[]         │
└──────────────────┬──────────────────────┘
                   │ SearchResponse
                   ▼
┌─────────────────────────────────────────┐
│        VAULT SDK UI LAYER               │
│  (renders results + chips + VQL panel)  │
└─────────────────────────────────────────┘
```

---

## 2. MDL DATA MODEL

### Document Entity (Key Fields)

| Field | VQL Name | Type | Notes |
|-------|----------|------|-------|
| id | id | ID | Base document ID (same across versions) |
| name | name__v | STRING | Display name |
| type | type__v | PICKLIST | SOP, Deviation, CAPA, etc. |
| lifecycle_state | lifecycle_state__v | PICKLIST | Approved, Draft, Open, etc. |
| major_version | major_version_number__v | NUMBER | Version grouping |
| minor_version | minor_version_number__v | NUMBER | Minor rev |
| is_latest | is_latest_version__v | BOOLEAN | Latest version flag |
| product | product__v | OBJECT | Multi-value product link |
| severity | severity__v | PICKLIST | Critical, Major, Minor |
| gxp_relevant | gxp_relevant__c | BOOLEAN | GxP filter |
| expiration_date | expiration_date__v | DATETIME | Expiry alerts |

### Version Hierarchy Rules

1. **Latest Approved First**: `ORDER BY major_version_number__v DESC` where `lifecycle_state__v IN ('approved__v', 'effective__v')`
2. **Version Group Key**: All records sharing `id` (not `version_id`) belong to one document group
3. **Superseded Suppression**: Obsolete/Superseded versions hidden unless explicitly requested
4. **Minor Version Collapse**: Minor versions (1.1, 1.2) collapsed under major version card in UI

### Lifecycle States

```
QualityDocs:  Draft → In Review → Approved → Effective → Superseded → Obsolete
Submission:   Draft → Under Review → Approved → Submitted → Accepted/Rejected
QualityEvent: Open → In Progress → Pending Review → Closed/Cancelled
```

---

## 3. VQL TEMPLATE LIBRARY (Summary)

25 templates across 6 categories:

| Category | Templates |
|----------|-----------|
| Document Discovery | doc_all_accessible, doc_by_type, doc_by_lifecycle_state, doc_by_product |
| SOP | sop_approved, sop_latest_all_states, sop_by_product, sop_recently_updated, sop_expiring_soon |
| Deviation | deviation_all_open, deviation_reports_by_product, deviation_high_severity, deviation_linked_capa, deviation_sop_violations |
| CAPA | capa_open, capa_closed, capa_high_severity, capa_overdue, capa_by_product |
| Audit | audit_ready_docs, audit_inspection_package, audit_change_log, audit_unsigned_docs |
| Time-Based | time_last_30_days_changes, time_recently_approved, time_expiring_documents, time_new_documents, time_version_history |

Each template:
- Has a unique `id`
- Contains parameterized VQL with `{{param}}` placeholders
- Documents every WHERE clause condition in `explanation` field
- Is fully auditable (templateId logged with every query)

---

## 4. QUERY PARSER DESIGN

### Input → Output

```
Input:  "show me critical deviations"
Output: {
  intent: { templateId: 'deviation_high_severity', ruleId: 'RULE-002' },
  signals: { docType: 'Deviation__c', severity: 'critical__v' },
  params:  { severity: 'critical__v' },
  ambiguity: { isAmbiguous: false }
}
```

### Rule Priority

| Priority | Rule Type | Examples |
|----------|-----------|---------|
| 100 | High specificity | Overdue CAPAs, Expiring SOPs, Audit Package |
| 70 | Medium specificity | Approved SOPs, High Severity, Open Deviations |
| 30 | Type/State fallback | Any SOP, Any CAPA, Any Deviation |
| 0 | Catch-all | All accessible documents |

### Ambiguity Handling

- Multiple doc types detected → note primary match, offer secondary
- CAPA + "approved" → corrected to "Closed" (CAPA uses Closed not Approved)
- Query too short (<3 chars) → fall through to all documents
- Pure stopwords → all documents
- Numeric input → detected as document ID → show version history

---

## 5. RECOMMENDATION ENGINE

### Scoring Formula

```
score = baseScore + keywordBonus + roleBonus + docTypeContextBonus + timeBonus

Where:
  keywordBonus     = +15 per matched trigger keyword (max +45)
  roleBonus        = fixed integer from role map (0–50)
  contextBonus     = fixed integer if active doc type matches (+10 to +30)
  timeBonus.always = always-on boost (e.g., overdue items)
  timeBonus.EOQ    = +25–30 at end of quarter (months 3,6,9,12, days 20+)
```

All scoring values are hardcoded integers. No floating point inference.

### Role Starter Chips

| Role | Default Chips |
|------|---------------|
| QA_ADMIN | Approved SOPs, Open Deviations, Overdue CAPAs, Audit-Ready Docs, Missing e-Signatures, SOPs Expiring |
| QA_USER | Approved SOPs, Open Deviations, Open CAPAs, SOPs Expiring |
| Clinical | Study Protocols, Approved SOPs, Audit-Ready Docs |
| Regulatory | Audit-Ready Docs, Inspection Package, Submissions |

---

## 6. FRONTEND UX (ASCII WIREFRAMES)

### Search Panel Layout

```
╔══════════════════════════════════════════════════════════════════════╗
║  🔍 SmartSearch  [🔍 approved SOPs for Drug-A___________] [Roles ▾] ║
╠══════════╦═══════════════════════════════════════════════════════════╣
║ FILTERS  ║ Suggested: [📋 Approved SOPs] [⚠️ Open Deviations] ...   ║
║          ║───────────────────────────────────────────────────────────║
║ Doc Type ║ Template: sop_approved    Rule: RULE-010   [Show VQL ▾]  ║
║ ☑ SOP    ║───────────────────────────────────────────────────────────║
║ ☑ Deviat ║ 42 documents  •  Approved SOPs              180ms        ║
║ ☑ CAPA   ║                                                           ║
║          ║  ┌──────────────────────────────────────────────────┐    ║
║ Status   ║  │ 📋 SOP-MFG-001: Raw Material Handling            │    ║
║ ☑ Appr'd ║  │    SOP  v3.0  [Effective]             Mar 15    │    ║
║ ☑ Effect ║  │                              [4 versions ▾]      │    ║
║ ☐ Draft  ║  └──────────────────────────────────────────────────┘    ║
║          ║  ┌──────────────────────────────────────────────────┐    ║
║ Last Mod ║  │ 📋 SOP-QC-042: In-Process Sampling              │    ║
║ ◉ 30 days║  │    SOP  v2.1  [Approved]              Apr 2     │    ║
║          ║  └──────────────────────────────────────────────────┘    ║
║ Severity ║  ┌──────────────────────────────────────────────────┐    ║
║ ☐ Critcl ║  │ 📋 SOP-REG-005: CTD Module Preparation          │    ║
║ ☐ Major  ║  │    SOP  v4.0  [Effective] [⏰ Expires Jul 10]   │    ║
║          ║  └──────────────────────────────────────────────────┘    ║
║ Version  ║                                                           ║
║ ◉ Latest ║  ← Previous  [1] [2] [3]  Next →                       ║
║ ○ All    ║                                                           ║
╚══════════╩═══════════════════════════════════════════════════════════╝
```

### Version Expansion

```
┌──────────────────────────────────────────────────────────┐
│ 📋 SOP-MFG-001: Raw Material Handling                    │
│    SOP  v3.0  [Effective]           Mar 15  [4 versions ▴]│
├──────────────────────────────────────────────────────────┤
│ VERSION HISTORY                                           │
│   SOP-MFG-001: Raw Material...  v3.0 [Effective] Mar 2025│
│   SOP-MFG-001: Raw Material...  v2.1 [Superseded] Sep 24│
│   SOP-MFG-001: Raw Material...  v2.0 [Superseded] Mar 24│
│   SOP-MFG-001: Raw Material...  v1.0 [Superseded] Jun 23│
└──────────────────────────────────────────────────────────┘
```

### VQL Transparency Panel (collapsed by default)

```
┌──────────────────────────────────────────────────────────┐
│ Template: sop_approved  •  Rule: RULE-010  [Show VQL ▴]  │
├──────────────────────────────────────────────────────────┤
│  SELECT id, name__v, title__v, lifecycle_state__v,       │
│    major_version_number__v, effective_date__v            │
│  FROM documents                                          │
│  WHERE type__v = 'Standard Operating Procedure__c'       │
│    AND lifecycle_state__v IN ('approved__v','effective__v')│
│    AND is_latest_version__v = true                       │
│  ORDER BY name__v ASC                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 7. BACKEND SERVICES

### Service Responsibilities

| Service | File | Responsibility |
|---------|------|----------------|
| QueryService | backend-services/query-service.js | Orchestrator: parse → build → execute → aggregate |
| VQLExecutionService | backend-services/query-service.js | POST to /api/v24.1/query with session token |
| ResultAggregationService | backend-services/query-service.js | Normalize, ACL-filter, group by document |
| MetadataService | backend-services/query-service.js | Serve MDL schema and filter definitions to UI |
| RecommendationService | backend-services/query-service.js | Wrap recommendation engine with 60s in-memory cache |

### QueryService API

```javascript
// Main search
const result = await queryService.search({
  rawQuery: 'approved SOPs for Drug-A',
  sessionToken: 'vault_oauth_token',
  userRole: 'QA_USER',
  page: 0,
  pageSize: 25,
});

// Execute template directly (from chip click)
const result = await queryService.executeTemplate(
  'sop_approved',
  { product_id: 'VV-PROD-001' },
  { sessionToken, userRole: 'QA_USER' }
);
```

### Result Shape

```javascript
{
  query: {
    raw: 'approved SOPs',
    templateId: 'sop_approved',
    vqlExecuted: 'SELECT id, name__v FROM documents WHERE ...',
    ruleApplied: 'RULE-010',
  },
  results: [
    {
      documentId: '100001',
      primaryVersion: { name: '...', lifecycleState: 'effective__v', ... },
      versionCount: 3,
      versions: [...],      // Only if includeVersionHistory=true
      hasMultipleVersions: true,
    },
    ...
  ],
  totalDocuments: 42,
  filteredByACL: 3,         // How many were excluded
  recommendations: [...],   // 5 contextual chips
  totalTimeMs: 185,
}
```

---

## 8. SECURITY & PERMISSIONS MODEL

### Defense-in-Depth Layers

```
Layer 1 (Vault-Native):
  Vault REST API enforces user's security profile on EVERY request.
  Session token → Vault → enforces document-level security.
  → Cannot be bypassed. Vault NEVER returns unauthorized documents.

Layer 2 (Application Pre-Query):
  PermissionsGuard.preQueryCheck():
  - Session token format validation
  - Role resolution (unknown roles → READ_ONLY, never fail open)
  - VQL injection prevention (pattern matching on all user inputs)
  - Every query logged with masked session token

Layer 3 (Application Post-Query):
  PermissionsGuard.filter():
  - Document type access check against role profile
  - Lifecycle state access check (drafts blocked for non-admins)
  - Obsolete version suppression
  - Product scope enforcement
  Applied BEFORE results are serialized for UI.
```

### Role Permission Matrix

| Permission | QA_ADMIN | QA_USER | Clinical | Regulatory |
|-----------|----------|---------|---------|------------|
| View Drafts | ✓ | ✗ | ✗ | ✗ |
| View Obsolete | ✓ | ✗ | ✗ | ✗ |
| All Versions | ✓ | ✗ | ✗ | ✗ |
| SOPs | ✓ | ✓ | ✓ | ✓ |
| Deviations | ✓ | ✓ | ✗ | ✗ |
| CAPAs | ✓ | ✓ | ✗ | ✗ |
| Protocols | ✓ | ✗ | ✓ | ✓ |

### VQL Injection Prevention

Blocked patterns:
- `' OR '1'='1` (value injection)
- `--` and `/* */` (comment injection)
- Nested `SELECT`, `DROP`, `DELETE`, `UNION`

All user-supplied parameters go through `VQLSanitizer.sanitize()` before template substitution.

### Audit Trail

Every search is logged:
```json
{
  "type": "SEARCH",
  "timestamp": "2025-04-24T14:32:00Z",
  "userId": "user_12345",
  "userRole": "QA_USER",
  "rawQuery": "approved SOPs",
  "templateId": "sop_approved",
  "resultCount": 42,
  "filteredByACL": 0,
  "sessionToken": "abcd****wxyz",
  "executionMs": 185
}
```

---

## 9. DEPLOYMENT ARCHITECTURE

### Vault SDK Deployment

```
Vault Tenant (acme.veevavault.com)
├── Vault SDK Application (embedded panel)
│   ├── search-panel.html    → Vault UI Extension
│   ├── search-panel.js      → Bundled with vault-sdk-client.js
│   └── Registered as:       Documents > Custom Tab > SmartSearch
│
├── Backend Services (customer-hosted or cloud)
│   ├── Node.js service       → query-service.js
│   ├── Endpoint:             https://api.customer.internal/vault-search/
│   ├── Auth:                 Session token pass-through (NEVER stored)
│   └── Network:              Private VPN or VPC-to-VPC
│
└── Vault REST API
    ├── /api/v24.1/query      → VQL execution
    ├── /api/v24.1/objects/   → Object lookups (products, studies)
    └── Auth: Bearer {vaultSessionToken}
```

### Latency Budget

| Stage | Target | Typical |
|-------|--------|---------|
| Parse + build VQL | <5ms | <2ms |
| Vault API round-trip | <1000ms | 200-800ms |
| Aggregation + ACL | <50ms | <20ms |
| UI render | <100ms | <50ms |
| **Total** | **<2000ms** | **~500ms** |

### Scaling Assumptions

- Vault API handles all storage/compute scaling
- Backend services are stateless → horizontal scaling via load balancer
- Recommendation cache: 60s TTL, role+keyword keyed, in-process
- No external databases required

---

## 10. MVP IMPLEMENTATION PLAN (3 WEEKS)

### Week 1: Foundation

**Target:** Working search with static query packs

- [x] `mdl/document-schema.mdl.js` — Full MDL schema
- [x] `vql/query-templates.js` — 25 VQL templates
- [x] `vault-sdk-ui/search-panel.html` — Interactive UI prototype
- [ ] Register Vault SDK application in tenant
- [ ] Connect to real Vault sandbox via VQL endpoint
- [ ] Validate all 25 template VQL strings execute without errors

**Definition of done:**
- User can click a chip and see real Vault documents in results
- VQL panel shows exact query executed

---

### Week 2: Intelligence Layer

**Target:** Parser + Recommendations wired to UI

- [x] `query-parser/rule-engine.js` — Rule-based parser
- [x] `recommendation-engine/recommender.js` — Scoring engine
- [ ] Wire parser output to VQL template selection
- [ ] Integrate recommendation chips with live role-based scoring
- [ ] Add MDL-driven filter panel connected to VQL WHERE clauses
- [ ] Test edge cases: empty queries, injection attempts, unknown terms

**Definition of done:**
- Typing "approved SOPs" routes to `sop_approved` template
- Chips update when role is changed
- Invalid inputs are blocked and logged

---

### Week 3: Production Hardening

**Target:** Security, version grouping, polish

- [x] `security/permissions-guard.js` — ACL + audit logging
- [x] `backend-services/query-service.js` — Full service layer
- [ ] Version grouping UI: collapse/expand minor versions
- [ ] Pagination: LIMIT/OFFSET on all queries
- [ ] End-to-end permission hardening:
  - Test with QA_USER: verify drafts not visible
  - Test with Clinical: verify deviations not visible
  - Test injection: verify blocked
- [ ] Performance validation: <2s on 10 concurrent users
- [ ] Audit log validation: every query logged to Vault audit object

**Definition of done:**
- All ACL rules tested across all 4 roles
- Audit log readable by QA Admin
- No document leakage across roles verified

---

## FILE STRUCTURE

```
VeevaVaultSearch/
├── mdl/
│   └── document-schema.mdl.js      ← MDL data model + permissions
├── vql/
│   └── query-templates.js          ← 25 VQL templates + render engine
├── query-parser/
│   └── rule-engine.js              ← Rule-based intent parser
├── recommendation-engine/
│   └── recommender.js              ← Deterministic scoring engine
├── backend-services/
│   └── query-service.js            ← All 5 backend services
├── security/
│   └── permissions-guard.js        ← ACL, audit log, injection guard
├── vault-sdk-ui/
│   └── search-panel.html           ← Interactive Vault SDK UI
├── docs/
│   └── system-architecture.md      ← This document
└── config/
    └── vault-config.js             ← Environment configuration
```
