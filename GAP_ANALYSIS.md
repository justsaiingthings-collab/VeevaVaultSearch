# VaultSearch — Gap Analysis & Engineering Roadmap
**Author:** Senior Staff Engineer review  
**Date:** April 2026  
**Codebase snapshot:** search-panel.html (2 666 lines), 7 HTML pages, 1 Lambda proxy

---

## Executive Summary

The product is a well-architected proof of concept. The core ideas — query-template abstraction, rule-based intent engine, version grouping, and audit-ready query packs — are sound and solve genuine pain. However, **11 critical gaps** prevent production deployment at an arbitrary Vault customer, and **9 high-value product gaps** limit its usefulness even at customers where it technically runs. This document catalogs every gap, rates its severity, and provides a concrete implementation path for each.

---

## Gap Severity Legend

| Label | Meaning |
|-------|---------|
| 🔴 **P0** | Blocks production use entirely. Causes silent failures or security issues. |
| 🟠 **P1** | Severely limits product value. Workarounds exist but are painful. |
| 🟡 **P2** | Meaningful UX or ops gap. Nice-to-have for initial launch, required for scale. |
| 🟢 **P3** | Enterprise / compliance hardening. Required before FDA-regulated use. |

---

## Part 1 — Data Layer Gaps

### G-01 🔴 Hardcoded document type names break on any non-standard Vault

**What is broken:**  
Every VQL template hardcodes `type__v = 'Standard Operating Procedure__c'`, `'Deviation__c'`, `'CAPA__c'`, `'Policy__c'`, `'Regulatory__c'`. These are custom API names that vary per customer. One customer calls it `SOP__c`, another `standard_operating_procedure__c`, another `Quality_SOP__c`. Every query silently returns zero rows on those Vaults with no error surfaced to the user.

Currently there are **11 occurrences** of hardcoded `type__v = '...'` in VQL_RAW and 141 references to `lifecycle_state__v` assuming a fixed set of states.

**Why it matters:**  
This is the single biggest reason the product fails at most real Vault deployments. A QA admin runs "Open Deviations", gets zero results, and assumes the tool is broken — because it is.

**Implementation path:**

Step 1 — Boot-time schema discovery (add to `connect.html` after auth):
```javascript
async function discoverSchema(live) {
  const [types, states, fields] = await Promise.all([
    executeVQL(`SELECT name, label FROM allDocumentFields 
                WHERE name LIKE '%type__v%' LIMIT 200`),
    executeVQL(`SELECT name, label, lifecycle__vr.name__v 
                FROM lifecyclestate__v LIMIT 500`),
    executeVQL(`SELECT name, label, type__v 
                FROM allDocumentFields 
                WHERE scope = 'DocumentVersion' LIMIT 500`),
  ]);
  sessionStorage.setItem('vault_schema', JSON.stringify({ types, states, fields }));
}
```

Step 2 — Config file per Vault module (ship with defaults):
```json
// vault-config.json — QualityDocs default
{
  "module": "QualityDocs",
  "types": {
    "sop":       "Standard Operating Procedure__c",
    "deviation": "Deviation__c",
    "capa":      "CAPA__c",
    "policy":    "Policy__c",
    "protocol":  "Protocol__c",
    "report":    "Report__c"
  },
  "states": {
    "approved":   ["approved__v", "effective__v"],
    "draft":      ["draft__v"],
    "pending":    ["pending_approval__v"],
    "obsolete":   ["obsolete__v", "superseded__v"]
  },
  "fields": {
    "severity":      "severity__v",
    "gxp":           "gxp_relevant__c",
    "expiry":        "expiration_date__v",
    "review_due":    "periodic_review_date__v",
    "product":       "product__c",
    "study":         "study_id__c",
    "capa_link":     "capa_id__c"
  }
}
```

Step 3 — VQL builder reads from config, not hardcoded strings:
```javascript
function buildQuery(templateId, cfg) {
  const t = cfg.types;
  const s = cfg.states;
  const f = cfg.fields;
  
  if (templateId === 'sop_approved') {
    return `SELECT id, name__v, type__v, lifecycle_state__v
            FROM documents
            WHERE type__v = '${t.sop}'
            AND lifecycle_state__v IN (${s.approved.map(v=>`'${v}'`).join(',')})
            AND is_latest_version__v = true
            ORDER BY name__v ASC LIMIT 50`;
  }
  // ... all templates follow this pattern
}
```

Step 4 — Add a "Setup" page in the UI where a Vault admin maps their custom type/field names to the logical concepts. Pre-populate from schema discovery. Save to `localStorage` as `vault_config`.

**Effort:** 2 sprints (config schema design + template refactor)

---

### G-02 🔴 All queries target `FROM documents` — CAPAs and Deviations are often Objects

**What is broken:**  
In many Vault QMS configurations (VaultQMS, Veeva Vault QualityOne), CAPAs, Deviations, Change Controls, and Complaints are stored as **Vault Object records** (`FROM capaaction__v`, `FROM deviation__v`), not document records. Every query using `FROM documents WHERE type__v = 'CAPA__c'` returns zero rows with no error because the object doesn't exist as a document type on those Vaults.

**Why it matters:**  
The two most queried modules in pharma QMS are CAPAs and Deviations. If both return nothing, the product has zero value for that customer.

**Implementation path:**

Add a `source` flag to each template definition:
```javascript
const TEMPLATES = {
  capa_open: {
    source: 'documents',       // 'documents' | 'objects' | 'auto'
    object_type: 'capaaction__v',
    vql_docs:    `SELECT id, name__v, type__v, lifecycle_state__v ... FROM documents WHERE type__v = '${cfg.types.capa}'...`,
    vql_objects: `SELECT id, name__v, status__v, severity__v, due_date__v, assigned_to__vr.name__v FROM capaaction__v WHERE status__v NOT IN ('closed__v','cancelled__v') ORDER BY severity__v ASC LIMIT 50`,
  }
}
```

During schema discovery, probe which path works:
```javascript
async function detectSourceType(cfg) {
  // Try documents first
  const docTest = await executeVQL(
    `SELECT id FROM documents WHERE type__v = '${cfg.types.capa}' LIMIT 1`
  ).catch(() => null);
  
  if (docTest?.length > 0) return 'documents';
  
  // Try objects
  const objTest = await executeVQL(
    `SELECT id FROM capaaction__v LIMIT 1`
  ).catch(() => null);
  
  if (objTest !== null) return 'objects';
  
  return null; // module not present in this Vault
}
```

Store per-module source type in config and route queries accordingly.

**Effort:** 1.5 sprints (dual-query engine + object VQL library)

---

### G-03 🔴 Pagination exists in the DOM but is never implemented

**What is broken:**  
There is a `<div class="pagination-bar" id="paginationBar" style="display:none">` in the HTML. It is never shown. Every query has `LIMIT 50` or `LIMIT 100`. A user searching for "all SOPs" in a 5 000-document Vault sees 50 results and has no way to see the rest. Worse — they don't know they're seeing only 50.

**Why it matters:**  
For audit-readiness searches ("all GxP documents") an incomplete result set is worse than no result — it creates a false sense of completeness.

**Implementation path:**

Vault VQL supports `PAGESIZE` and returns `next_page_url` in the response envelope:
```json
{
  "responseStatus": "SUCCESS",
  "responseDetails": {
    "total": 487,
    "pageoffset": 0,
    "pagesize": 50,
    "size": 50
  },
  "next_page_url": "/api/v24.1/query?next_page=...",
  "data": [...]
}
```

Implement cursor-based pagination:
```javascript
// In executeVQL — return full envelope, not just data
async function executeVQL(vql, nextPageUrl = null) {
  const url = nextPageUrl
    ? `${LIVE.baseUrl}${nextPageUrl}`
    : `${LIVE.baseUrl}/api/${LIVE.apiVer}/query`;
  // ... fetch logic
  return { data: normalizedDocs, nextPageUrl: resp.next_page_url || null, total: resp.responseDetails?.total };
}

// Track pagination state
const PAGE = { nextUrl: null, total: 0, loaded: 0 };

// "Load more" button handler
document.getElementById('loadMoreBtn').addEventListener('click', async () => {
  if (!PAGE.nextUrl) return;
  const { data, nextPageUrl } = await executeVQL(null, PAGE.nextUrl);
  PAGE.nextUrl = nextPageUrl;
  PAGE.loaded += data.length;
  appendResults(data);  // append, don't replace
  updatePaginationBar();
});
```

Show count honestly: "Showing 50 of 487 documents — Load 50 more"

**Effort:** 0.5 sprints

---

### G-04 🟠 Version history only works in demo mode — never fetched in live mode

**What is broken:**  
`MOCK_VERSIONS` is a hardcoded JS object with version histories for ~15 documents. In live mode, when a user clicks the version history expander, `MOCK_VERSIONS[doc.id]` always returns `undefined` because the live doc IDs don't match the mock keys. The version panel silently shows nothing.

**Why it matters:**  
Version confusion ("am I looking at the right version?") is one of the core pain points the product is designed to solve.

**Implementation path:**
```javascript
async function fetchVersionHistory(doc) {
  if (!LIVE) {
    return MOCK_VERSIONS[doc.id] || [];
  }
  
  // Vault documents use name__v as the document identity across versions
  const vql = `SELECT id, name__v, major_version_number__v, minor_version_number__v,
                       lifecycle_state__v, last_modified_date__v, owner__v
               FROM documents
               WHERE name__v = '${doc.name__v.replace(/'/g, "''")}'
               ORDER BY major_version_number__v DESC, minor_version_number__v DESC
               LIMIT 20`;
  
  const versions = await executeVQL(vql);
  return versions.map(v => ({
    major: v.major_version_number__v,
    minor: v.minor_version_number__v,
    state: v.lifecycle_state__v,
    date:  v.last_modified_date__v?.slice(0, 10),
    owner: v.owner__v,
    id:    v.id,
  }));
}
```

Cache results per doc ID to avoid re-fetching on collapse/expand:
```javascript
const VERSION_CACHE = new Map();

async function onVersionExpand(doc) {
  if (!VERSION_CACHE.has(doc.id)) {
    const history = await fetchVersionHistory(doc);
    VERSION_CACHE.set(doc.id, history);
  }
  renderVersionHistory(VERSION_CACHE.get(doc.id));
}
```

**Effort:** 0.5 sprints

---

### G-05 🟠 No field existence validation — bad fields cause silent VQL errors

**What is broken:**  
Queries reference `gxp_relevant__c`, `severity__v`, `capa_id__c`, `periodic_review_date__v`, `expiration_date__v`. If any of these don't exist on the Vault, the VQL throws a `FIELD_NOT_FOUND` error. The error handler catches it, falls back to demo data, and shows a yellow warning that auto-dismisses in 8 seconds. The user sees 95 demo docs, thinks the query worked, and acts on stale mock data.

**Implementation path:**  
During schema discovery, build a `KNOWN_FIELDS` set. In the VQL builder, conditionally include optional fields:
```javascript
function selectFields(required, optional, knownFields) {
  const safe = optional.filter(f => knownFields.has(f));
  return [...required, ...safe].join(', ');
}

// Usage
const fields = selectFields(
  ['id', 'name__v', 'type__v', 'lifecycle_state__v'],
  ['gxp_relevant__c', 'severity__v', 'expiration_date__v'],
  KNOWN_FIELDS
);
```

Never fall back to demo data silently — show a clear "Live query failed" state with the actual error, not a timed toast.

**Effort:** 0.5 sprints (schema discovery already addresses this if G-01 is fixed)

---

## Part 2 — Authentication & Security Gaps

### G-06 🔴 Client-side role ACL is security theater

**What is broken:**  
`ROLE_ACL` in the code filters results after they're fetched based on a dropdown the user controls. A user can change their own role to `QA_ADMIN` and see drafts that their real Vault role would not permit. Conversely, the filter might hide documents the user legitimately has access to. The Vault API already enforces real permissions — the client-side layer creates confusion and a false security posture.

```javascript
// This is entirely bypassable — user controls S.role
const ROLE_ACL = {
  QA_ADMIN:        { drafts: true,  types: ['ALL'] },
  QA_USER:         { drafts: false, types: ['SOP','Deviation','CAPA','Report'] },
  // ...
};
```

**Implementation path:**  
Remove `applyACL()` entirely for live mode. The Vault API returns only what the authenticated user has permission to see — that is the only ACL that matters.

Keep the role switcher as a **UX personalization tool only** (changes which chips are shown, not which results are visible). Rename it "View Mode" to avoid implying it's an access control.

For demo mode, ACL can remain as a simulation of the concept.

```javascript
function applyACL(docs, role) {
  if (LIVE) return docs;  // Vault enforces real permissions — don't filter
  // Demo mode: simulate role-based visibility
  const acl = ROLE_ACL[role] || ROLE_ACL.QA_USER;
  return docs.filter(/* ... */);
}
```

**Effort:** 0.25 sprints (mostly deletion + label change)

---

### G-07 🟠 Session token stored in `sessionStorage` is XSS-vulnerable

**What is broken:**  
`sessionStorage.getItem('vault_session_token')` is readable by any JavaScript on the page. A single XSS vector — a malicious script injected via a DOM-based XSS in a user-controlled field like the search input — can exfiltrate the Vault session token. In pharma, this token provides access to clinical trial data, regulatory submissions, and audit records.

**Implementation path:**

Option A (recommended) — Token lives only in the Lambda proxy:
```
Browser ──[OAuth code]──► Lambda proxy ──► Vault /auth/oauth
                          Lambda sets httpOnly cookie
Browser ──[httpOnly cookie]──► Lambda proxy ──► Vault API
```
The browser never sees the raw Vault token. The Lambda proxy acts as a BFF (Backend for Frontend). All VQL executes server-side.

Option B (acceptable for MVP) — Keep sessionStorage but add input sanitization and CSP header:
```
Content-Security-Policy: default-src 'self'; script-src 'self';
```
This prevents injected scripts from running and limits the XSS surface. Add this header from the Lambda proxy on all HTML responses.

Also: current search input uses `S.searchText` directly in VQL strings (even with single-quote escaping, other VQL metacharacters could cause issues). Use a proper allow-list on `S.searchText`:
```javascript
function sanitizeVQLInput(raw) {
  return (raw || '').replace(/['"\\;*%]/g, '').trim().slice(0, 200);
}
```

**Effort:** 1 sprint for Option A, 0.25 sprints for Option B

---

### G-08 🟠 30-minute session expiry with no proactive refresh

**What is broken:**  
Vault session tokens expire after 30 minutes of inactivity. A user opens the app, runs some searches, takes a call, comes back 35 minutes later and searches again. The query silently fails with `INVALID_SESSION_ID`, falls back to demo data, shows an 8-second yellow toast, then shows 95 mock pharma docs as if nothing happened. The user acts on mock data thinking it's real.

**Implementation path:**  
Implement a token heartbeat:
```javascript
const SESSION_HEARTBEAT_MS = 25 * 60 * 1000; // 25 min

async function refreshSession() {
  try {
    await executeVQL(`SELECT id FROM documents LIMIT 1`);
  } catch (err) {
    if (err.message.includes('INVALID_SESSION_ID')) {
      showReconnectBanner();
    }
  }
}

// Keep session alive while tab is visible
let heartbeat = setInterval(refreshSession, SESSION_HEARTBEAT_MS);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(heartbeat);
  } else {
    refreshSession();   // immediate check on tab refocus
    heartbeat = setInterval(refreshSession, SESSION_HEARTBEAT_MS);
  }
});
```

For OAuth-based auth, implement token refresh using the refresh token obtained during PKCE flow.

**Effort:** 0.5 sprints

---

## Part 3 — Query Engine Gaps

### G-09 🟠 No query composition — can't combine filters

**What is broken:**  
Every template is atomic. A user cannot ask "open CAPAs for Vexatrol created in the last 30 days" or "approved SOPs modified by David Kim". The parser maps the input to exactly one template and executes it. There is no way to AND-combine conditions across different facets.

**Why it matters:**  
The most common real-world queries from QA managers are multi-dimensional: product × status × date × assignee. The current system can only answer single-dimension questions.

**Implementation path:**  
Introduce a `QueryContext` object that accumulates filters from multiple sources (chips, sidebar, freetext, date picker):

```javascript
const QueryContext = {
  baseTemplate:  null,    // e.g. 'capa_open'
  productFilter: null,    // e.g. 'Vexatrol'
  ownerFilter:   null,    // e.g. 'David Kim'
  dateFrom:      null,    // e.g. '2026-01-01'
  dateTo:        null,
  typeFilter:    [],      // from sidebar checkboxes
  stateFilter:  [],
};

function buildComposedVQL(ctx, cfg) {
  const base = VQL_TEMPLATES[ctx.baseTemplate];
  let where = base.whereClause;            // e.g. "type__v = 'CAPA__c' AND lifecycle_state__v IN (...)"
  
  if (ctx.productFilter) {
    where += ` AND ${cfg.fields.product} CONTAINS('${sanitize(ctx.productFilter)}')`;
  }
  if (ctx.ownerFilter) {
    where += ` AND owner__v CONTAINS('${sanitize(ctx.ownerFilter)}')`;
  }
  if (ctx.dateFrom) {
    where += ` AND last_modified_date__v >= '${ctx.dateFrom}'`;
  }
  
  return `SELECT ${base.fields} FROM documents WHERE ${where} 
          AND is_latest_version__v = true 
          ORDER BY last_modified_date__v DESC LIMIT 50`;
}
```

The sidebar filters already collect type/state selections — wire them into `QueryContext` instead of client-side post-filtering.

**Effort:** 1.5 sprints

---

### G-10 🟡 Parser covers ~70% of natural-language intents — no observability on failures

**What is broken:**  
31 rules cover the obvious cases well. But any query that misses all rules silently falls to RULE-098 (name search) or RULE-099 (all docs). There is no logging of which queries were unmatched, so there is no way to know what users are actually typing and what rule additions would have the highest impact.

**Implementation path:**

Add query telemetry to the Lambda proxy:
```javascript
// In proxy handler — log every query dispatch
await cloudwatch.putMetricData({
  Namespace: 'VaultSearch',
  MetricData: [{
    MetricName: 'QueryDispatched',
    Dimensions: [
      { Name: 'Template', Value: tid },
      { Name: 'Rule',     Value: rule },
      { Name: 'IsNameSearch', Value: String(rule === 'RULE-098') },
    ],
    Value: 1, Unit: 'Count',
  }]
}).promise();

// Log unmatched queries (raw text) for analysis — strip PII first
if (rule === 'RULE-098' || rule === 'RULE-099') {
  console.log(JSON.stringify({ event: 'UNMATCHED_QUERY', rawLength: raw.length, tid, ts: Date.now() }));
}
```

After 2 weeks of real usage, export the `UNMATCHED_QUERY` logs, cluster by n-gram patterns, and convert the top 20 clusters into new parser rules. This data-driven rule expansion is more effective than guessing.

**Effort:** 0.25 sprints for instrumentation; rule expansion is ongoing

---

### G-11 🟡 No result ranking — newest-modified always wins

**What is broken:**  
All queries order by `last_modified_date__v DESC`. A document touched by an automated process (metadata update, workflow transition) bubbles to the top even if it is irrelevant. Frequently-accessed documents are not surfaced preferentially.

**Implementation path:**  
Track per-document access frequency in `localStorage`:
```javascript
const ACCESS_LOG = JSON.parse(localStorage.getItem('doc_access') || '{}');

function recordAccess(docId) {
  ACCESS_LOG[docId] = (ACCESS_LOG[docId] || 0) + 1;
  localStorage.setItem('doc_access', JSON.stringify(ACCESS_LOG));
}

function rerankResults(docs) {
  return docs.sort((a, b) => {
    const freqScore = (ACCESS_LOG[b.id] || 0) - (ACCESS_LOG[a.id] || 0);
    if (freqScore !== 0) return freqScore;
    return new Date(b.modified) - new Date(a.modified);
  });
}
```

For name_search results, add a simple relevance score (exact prefix match > contains):
```javascript
function nameScore(doc, query) {
  const n = (doc.name__v || '').toLowerCase();
  const q = query.toLowerCase();
  if (n.startsWith(q)) return 3;
  if (n.includes(' ' + q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}
```

**Effort:** 0.25 sprints

---

## Part 4 — Operational Gaps

### G-12 🔴 Single-file architecture — unscalable, untestable, unmaintainable

**What is broken:**  
`search-panel.html` is **2 666 lines** of mixed HTML, CSS, and JavaScript with no separation of concerns. There is no build system, no test runner, no linting, no bundling. Adding a feature requires navigating a single enormous file. Bugs introduced in one section can silently affect another. There is no way to run unit tests on `parseToTemplate()` without loading the entire browser page.

**Implementation path — 3-phase migration:**

**Phase 1 (2 weeks) — Extract and organize, no framework:**
```
vault-sdk-ui/
  js/
    config.js         # ROLE_ACL, TYPE_KEY, STATE_META
    mock-data.js      # MOCK_DOCS, MOCK_VERSIONS
    vql-templates.js  # VQL_RAW, VQLS, QT, TNAMES
    parser.js         # parseToTemplate() — pure function, easily testable
    query-engine.js   # runQuery(), executeVQL(), normalizeVaultDoc()
    render.js         # renderResults(), renderVersionHistory()
    ui.js             # event listeners, E object, S state
  css/
    tokens.css
    layout.css
    components.css
    mobile.css
  search-panel.html   # shell only, <script src="..."> tags
```

**Phase 2 (1 sprint) — Add Jest for the pure functions:**
```javascript
// parser.test.js
import { parseToTemplate } from './js/parser.js';

test('routes open CAPAs correctly', () => {
  expect(parseToTemplate('open CAPAs').tid).toBe('capa_open');
});
test('routes doc numbers to name_search', () => {
  expect(parseToTemplate('SOP-MFG-001').tid).toBe('name_search');
});
test('show me everything → doc_all_accessible', () => {
  expect(parseToTemplate('show me everything').tid).toBe('doc_all_accessible');
});
// 50+ cases — all the parseToTemplate edge cases we discovered
```

**Phase 3 (1 sprint) — Vite + lightweight framework if needed:**  
If the product is growing beyond 5-6 pages, migrate to Vite with vanilla TS. Avoid React unless the UI complexity genuinely requires it — the current Vault-embedded context benefits from minimal dependencies.

**Effort:** Phase 1 = 2 weeks. Phase 2 = 0.5 sprints. Phase 3 = 1 sprint.

---

### G-13 🟠 No caching — identical queries hammer Vault API

**What is broken:**  
Every chip click, role switch, and filter change calls `executeVQL()` unconditionally. The same VQL string can be executed 20 times in a session with identical results. Vault API response time is 200–800ms, sometimes higher on large tenants. The UX shows a spinner on every interaction.

**Implementation path — two-tier cache:**

**Tier 1 — In-memory (tab session):**
```javascript
const QUERY_CACHE = new Map();

async function executeVQLCached(vql, ttlMs = 60_000) {
  const key = vql.trim().toLowerCase();
  const cached = QUERY_CACHE.get(key);
  
  if (cached && Date.now() - cached.ts < ttlMs) {
    return { data: cached.data, fromCache: true };
  }
  
  const result = await executeVQL(vql);
  QUERY_CACHE.set(key, { data: result, ts: Date.now() });
  return { data: result, fromCache: false };
}
```

**Tier 2 — Lambda proxy cache (Redis / ElastiCache):**  
For the periodic_review_overdue and audit_ready_docs queries that don't change minute-to-minute, cache at the proxy level with a 5-minute TTL. Add a cache-bust parameter `?refresh=1` for explicit user refreshes.

Show a "Loaded from cache · 2 min ago · Refresh" indicator in the QIB bar.

**Effort:** 0.5 sprints for Tier 1. 1 sprint for Tier 2.

---

### G-14 🟠 Lambda proxy has no rate limiting — can exhaust Vault API quotas

**What is broken:**  
Vault enforces API rate limits per session (approximately 500 requests/hour on most tenants) and per-tenant limits. The Lambda proxy has no per-user or per-session throttling. A misbehaving client (or a user who scripts the API) can exhaust the tenant's quota, blocking all other Vault API consumers including native Vault workflows.

**Implementation path:**  
Add token-bucket rate limiting at API Gateway:
```yaml
# serverless.yml or CDK
RateLimiting:
  ThrottleSettings:
    RateLimit: 10       # 10 req/sec per IP
    BurstLimit: 25
```

Or implement in Lambda with DynamoDB atomic counters:
```javascript
async function checkRateLimit(sessionToken) {
  const key = `ratelimit:${hashToken(sessionToken)}`;
  const count = await ddb.update({
    TableName: 'VaultSearchRateLimits',
    Key: { pk: key },
    UpdateExpression: 'ADD hits :one SET windowStart = if_not_exists(windowStart, :now)',
    ExpressionAttributeValues: { ':one': 1, ':now': Math.floor(Date.now() / 60000) },
    ReturnValues: 'ALL_NEW',
  }).promise();
  
  if (count.Attributes.hits > 100) {  // 100 req/min per session
    throw new Error('RATE_LIMIT_EXCEEDED');
  }
}
```

**Effort:** 0.5 sprints

---

## Part 5 — Product Feature Gaps

### G-15 🟠 No KPI dashboard — users have no operational overview

**What is broken:**  
A QA manager opening the app sees a search bar and a list of recent searches. There is no "you have 7 overdue periodic reviews, 3 critical open CAPAs, 12 documents expiring in 60 days" summary. The user has to know to run each query explicitly. Discovery of urgent items depends entirely on the user already knowing what to look for.

**Implementation path:**  
Add a dashboard landing state (shown before first search):
```javascript
async function loadDashboard() {
  // Run KPI queries in parallel — each is already in VQL_RAW
  const kpiQueries = [
    { id: 'periodic_review_overdue',  label: 'Reviews Overdue',    icon: '🔴', tid: 'periodic_review_overdue' },
    { id: 'awaiting_approval',         label: 'Awaiting Approval',  icon: '⏳', tid: 'awaiting_approval' },
    { id: 'deviation_without_capa',    label: 'Devs w/o CAPA',     icon: '🔗', tid: 'deviation_without_capa' },
    { id: 'labelling_expiring_60',     label: 'Expiring ≤60d',     icon: '🏷️', tid: 'labelling_expiring_60' },
  ];
  
  // COUNT(*) variant of each query — fast, no data transferred
  const counts = await Promise.all(kpiQueries.map(async q => {
    const countVql = VQL_RAW[q.tid]
      .replace(/^SELECT .* FROM/, 'SELECT COUNT(id) FROM')
      .replace(/LIMIT \d+$/, '');
    try {
      const result = await executeVQL(countVql);
      return { ...q, count: result[0]?.['COUNT(id)'] ?? 0 };
    } catch {
      return { ...q, count: null };
    }
  }));
  
  renderKPICards(counts);  // Clickable cards that fire the underlying query
}
```

Add a scheduled Lambda that pre-computes these counts every 15 minutes and caches them, so the dashboard loads in <200ms instead of making 4 parallel API calls.

**Effort:** 1 sprint

---

### G-16 🟡 No query-scoped notifications / alerts

**What is broken:**  
A QA admin has no way to say "alert me when a new Critical deviation is opened" or "notify me when SOP-MFG-001 reaches Approved state." The product is entirely reactive — you have to come back and search to find out if things changed.

**Why it matters:**  
This is a high-value feature that native Vault does not solve well. Vault has subscription notifications but they're not query-scoped.

**Implementation path:**  
Add a "Set Alert" button on any chip or query result:
```javascript
// Saved alert structure
{
  id: 'alert_001',
  name: 'Critical Deviations',
  tid:  'deviation_high_severity',
  vql:  'SELECT id FROM documents WHERE type__v = ... LIMIT 50',
  lastCount: 3,
  email: 'user@pharma.com',
  schedule: 'daily'  // 'immediate' | 'hourly' | 'daily'
}
```

Lambda scheduled function (EventBridge rule, every 15 min for immediate alerts):
```javascript
async function runAlerts() {
  const alerts = await ddb.scan({ TableName: 'VaultSearchAlerts' }).promise();
  
  for (const alert of alerts.Items) {
    const current = await proxyExecuteVQL(alert.vql, alert.vaultToken);
    const currentCount = current.total;
    
    if (currentCount !== alert.lastCount) {
      const delta = currentCount - alert.lastCount;
      await ses.sendEmail({
        To: alert.email,
        Subject: `VaultSearch Alert: ${alert.name} (${delta > 0 ? '+' : ''}${delta})`,
        Body: `Query "${alert.name}" returned ${currentCount} results (was ${alert.lastCount}).`
      }).promise();
      
      await ddb.update({ /* update lastCount */ });
    }
  }
}
```

**Effort:** 1.5 sprints (UI + Lambda alerting infrastructure)

---

### G-17 🟡 Saved searches and history are browser-local only

**What is broken:**  
Saved searches are in `localStorage` (single browser/device). Search history is in `sessionStorage` (lost on tab close). Neither is shared across team members. A QA manager who curates a set of useful saved searches can't share them with their team.

**Implementation path:**  
Move both to server-side storage via the Lambda proxy:
```javascript
// Save search
POST /api/saved-searches
{
  name: 'Critical Open CAPAs',
  tid: 'capa_high_severity',
  vql: '...',
  owner: 'user@pharma.com',
  shared: true,   // visible to all users on this Vault
  tags: ['QA', 'CAPA']
}

// Fetch shared searches on load
GET /api/saved-searches?vault={vaultHost}&shared=true
```

Store in DynamoDB with partition key `vaultHost` so searches are scoped to the correct Vault tenant. Shared searches become a collaboration primitive — a "search library" that the QA team maintains collectively.

**Effort:** 1 sprint

---

### G-18 🟡 No keyboard navigation — not accessible for power users

**What is broken:**  
There is no keyboard shortcut to focus the search bar, no arrow-key navigation through results, no Enter to open a document. Power users (auditors running dozens of queries) are forced onto the mouse for every interaction.

**Implementation path:**
```javascript
// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  // Cmd/Ctrl+K — focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    E.input.focus();
    E.input.select();
    return;
  }
  
  // Escape — clear search or close panels
  if (e.key === 'Escape') {
    if (document.activeElement === E.input) {
      E.input.blur();
    } else if (S.vqlOpen) {
      toggleVql(false);
    }
    return;
  }
});

// Arrow key navigation through results
let focusedResult = -1;
document.addEventListener('keydown', e => {
  const cards = [...document.querySelectorAll('.doc-card')];
  if (!cards.length) return;
  
  if (e.key === 'ArrowDown') {
    focusedResult = Math.min(focusedResult + 1, cards.length - 1);
    cards[focusedResult].focus();
    e.preventDefault();
  }
  if (e.key === 'ArrowUp') {
    focusedResult = Math.max(focusedResult - 1, 0);
    cards[focusedResult].focus();
    e.preventDefault();
  }
  if (e.key === 'Enter' && focusedResult >= 0) {
    cards[focusedResult].querySelector('.open-vault-btn')?.click();
  }
});
```

Add `tabindex="0"` and `role="listitem"` to `.doc-card`. Show a keyboard shortcut hint in the search bar placeholder.

**Effort:** 0.5 sprints

---

## Part 6 — Compliance & Regulated-Environment Gaps

### G-19 🔴 No server-side audit trail — 21 CFR Part 11 non-compliant

**What is broken:**  
FDA 21 CFR Part 11 requires that electronic records in regulated systems maintain an audit trail of who accessed what and when. Currently there is zero server-side logging of queries. A Lambda invocation log shows HTTP status codes, but not which user ran which query and what they saw.

**Why it matters:**  
If this product is used in a GxP-regulated workflow (reviewing documents for audit, signing off on compliance searches), the absence of an audit trail is a regulatory violation. This would fail a Vault inspection.

**Implementation path:**  
Log every query at the Lambda proxy level:
```javascript
// audit-log.js — called before returning results
async function writeAuditLog(event) {
  const entry = {
    timestamp:   new Date().toISOString(),
    requestId:   context.awsRequestId,
    vaultTenant: event.headers['X-Vault-URL'],
    userEmail:   await resolveUserEmail(event.headers['Authorization']),
    queryTemplate: event.body?.tid || 'unknown',
    vql:          event.body?.vql,
    resultCount:  results.length,
    clientIp:     event.requestContext.identity.sourceIp,
    userAgent:    event.headers['User-Agent'],
  };
  
  // Write to CloudWatch Logs — immutable, tamper-evident with CloudTrail
  console.log(JSON.stringify({ type: 'AUDIT', ...entry }));
  
  // Optionally also write to DynamoDB for query/reporting
  await ddb.put({ TableName: 'VaultSearchAuditLog', Item: entry }).promise();
}
```

Enable CloudTrail on the Lambda for tamper-evident log signing.

Also: add a "Query executed at [timestamp] by [user]" footer to CSV exports so exported data has provenance.

**Effort:** 0.5 sprints

---

### G-20 🟢 No GxP validation documentation (IQ/OQ/PQ)

**What is broken:**  
Any software used in a GxP-regulated workflow at a pharma company requires Installation Qualification, Operational Qualification, and Performance Qualification documentation before it can be used in regulated activities. This product has none.

**What's needed:**  
- IQ: Installation and configuration records, system inventory, version control evidence
- OQ: Test protocols proving the system does what it's specified to do (the parser tests in G-12 partially serve this)
- PQ: Performance qualification in the actual user environment

This is a documentation and process task, not an engineering task, but it gates enterprise sales.

**Effort:** 3–4 weeks (documentation + formal test execution)

---

## Prioritized Implementation Roadmap

### Sprint 1–2 (Weeks 1–4): Make it work at any Vault
| Gap | Deliverable |
|-----|------------|
| G-01 | Config layer + MDL schema discovery on connect |
| G-02 | Object vs Document source detection + dual-query engine |
| G-06 | Remove client-side ACL in live mode |
| G-03 | Implement pagination with "load more" |
| G-04 | Live version history fetch |

**Exit criteria:** Product works correctly on 3 different Vault tenant configurations (QualityDocs, QualityOne, eTMF).

---

### Sprint 3–4 (Weeks 5–8): Security & Ops foundation
| Gap | Deliverable |
|-----|------------|
| G-07 | httpOnly cookie auth via BFF proxy |
| G-08 | Session heartbeat + auto-reconnect |
| G-12 | Module extraction + Jest unit tests for parser |
| G-13 | In-memory query cache (60s TTL) |
| G-14 | API Gateway rate limiting |
| G-19 | Server-side audit log to CloudWatch |

**Exit criteria:** Security review passed. 95% parser coverage confirmed by test suite.

---

### Sprint 5–6 (Weeks 9–12): High-value product features
| Gap | Deliverable |
|-----|------------|
| G-09 | Query composition (product × status × date × owner) |
| G-15 | KPI dashboard with pre-computed counts |
| G-10 | Query telemetry + RULE-099 hit logging |
| G-17 | Server-side saved searches with team sharing |
| G-11 | Access-frequency result re-ranking |
| G-16 | Email alert subscriptions (daily digest) |

**Exit criteria:** QA admin can get a full operational picture within 30 seconds of opening the app without running a single manual query.

---

### Sprint 7–8 (Weeks 13–16): Polish & scale
| Gap | Deliverable |
|-----|------------|
| G-18 | Keyboard navigation (Cmd+K, arrows, Enter) |
| G-05 | Field-existence validation in query builder |
| G-13 | Lambda-level Redis cache (5-min TTL for heavy queries) |
| G-20 | IQ/OQ documentation (with QA team) |

---

## Effort Summary

| Priority | Gaps | Total Effort |
|----------|------|-------------|
| 🔴 P0 (5 gaps) | G-01, G-02, G-03, G-04, G-06 | ~4 sprints |
| 🟠 P1 (7 gaps) | G-05, G-07, G-08, G-09, G-13, G-14, G-15 | ~4 sprints |
| 🟡 P2 (5 gaps) | G-10, G-11, G-16, G-17, G-18 | ~2.5 sprints |
| 🟢 P3 (2 gaps) | G-19, G-20 | ~1.5 sprints |
| **Total** | **19 gaps** | **~12 sprints** |

A team of 2 engineers doing 2-week sprints can reach production-grade deployment in **~6 months**.

---

## What is Already Good

To be direct: the foundation is strong. The following design decisions are correct and do not need to change:

- **Deterministic, rule-based parser** — exactly right for regulated environments. No hallucinations, fully auditable.
- **VQL template library** — the right abstraction. Generalizes well to any Vault module once schema is configurable.
- **Version grouping concept** — solves a real and acknowledged pain point.
- **Separation of demo/live modes** — makes development and sales demos easy without mocking the entire Vault API.
- **Audit-ready query packs** — high-value differentiation. Native Vault has no equivalent.
- **CORS proxy architecture** — correct; direct browser-to-Vault is not viable.
- **OAuth PKCE flow** — correct auth pattern for a public client.
- **Mobile-responsive layout** — done correctly with sidebar drawer pattern.

The product is approximately **60% of the way to production**. The remaining 40% is mostly schema generalization, security hardening, and operational infrastructure — none of it requires redesigning the core.
