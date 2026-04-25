# Connecting VeevaVaultSearch to a Real Vault Instance

Complete this checklist when you have sandbox access ready.

---

## What You Need Before Starting

- Vault sandbox URL (e.g. `acme.veevavault.com`)
- Vault login credentials (username + password, or OAuth)
- Vault API version (check by visiting `GET https://YOUR-TENANT.veevavault.com/api`)

---

## Step 1 — Discover Your Tenant's Field Names

Run this API call (Postman or curl) after logging in:

```
GET https://YOUR-TENANT.veevavault.com/api/v24.1/metadata/objects/documents/properties
Authorization: {your session token}
```

**Why:** Your Vault's document field API names may differ from the defaults in
the code (e.g. your SOP type might be `sop__c` not `Standard Operating Procedure__c`).

**What to capture:**
- Exact `name` values for: document type, subtype, lifecycle_state, severity, product, study
- Whether lifecycle states use `__v` or `__c` suffixes
- Any custom fields (fields ending in `__c`) relevant to QA/deviation/CAPA

**Then:** Share the response and I will auto-diff it against the MDL schema and
fix all mismatches in `mdl/document-schema.mdl.js` and `vql/query-templates.js`.

---

## Step 2 — Validate VQL Queries Directly

Before touching the UI, confirm queries work raw. Run this in Postman:

```
POST https://YOUR-TENANT.veevavault.com/api/v24.1/query
Authorization: {session token}
Content-Type: application/x-www-form-urlencoded

q=SELECT id, name__v, type__v, lifecycle_state__v FROM documents WHERE is_latest_version__v = true LIMIT 5
```

**Expected:** `responseStatus: "SUCCESS"` and a `data` array with documents.

If this works, the connection is valid. If not, check your API version and token.

**Then:** I can run all 28 VQL templates against your sandbox via a validation
script (`node validate-vql.js`) and report which ones need field name fixes.

---

## Step 3 — Update Field Names to Match Your Tenant

**I do this step once you share the metadata from Step 1.**

Files that will be updated:
- `mdl/document-schema.mdl.js` — all field `vqlField` values
- `vql/query-templates.js` — all `WHERE type__v = '...'` and field references
- `recommendation-engine/recommender.js` — document type values in trigger maps

No logic changes — only string values that map to your tenant's API names.

---

## Step 4 — Wire Authentication in the UI

**I do this step.**

Replace the mock query function in `vault-sdk-ui/search-panel.html` with:

```javascript
// Vault SDK provides the session token via context
const token = await VaultUI.session.getToken();

async function executeVaultQuery(vql) {
  const response = await fetch(
    'https://YOUR-TENANT.veevavault.com/api/v24.1/query',
    {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ q: vql }),
    }
  );
  const data = await response.json();
  return data.data || [];
}
```

Also need to replace `YOUR-TENANT` with your actual Vault URL in `config/vault-config.js`.

---

## Step 5 — Package as a Vault SDK Component

**I do this step.**

I will generate:
- `descriptor.json` — component registration config
- Bundled `search-panel.js` — minified and self-contained
- `vault-search.vpk` — the deployable package file

Ready to upload via **Vault Admin → Vault SDK → Components → Import**.

---

## Step 6 — Deploy and Test in Vault

**You do this in your Vault Admin panel (~10 min):**

1. Go to **Admin → Vault SDK → Vault Package Manager**
2. Click **Import** and upload `vault-search.vpk`
3. Deploy the package
4. Go to **Admin → Configuration → Tabs** and register the component
   as a new tab under the Documents section
5. Open the Documents tab — SmartSearch panel should appear
6. Run a test search (e.g. type "approved SOPs")

**Success criteria:**
- Results appear within 2 seconds
- VQL preview panel shows the actual query executed
- Role-switching changes visible document types
- Version grouping collapses multiple versions of the same doc

---

## Notes for When You Return

- The mock UI (`vault-sdk-ui/search-panel.html`) is fully functional for demos
  using simulated data — open it in any browser to show stakeholders before
  real Vault access is ready.
- All 28 VQL templates, the parser, ACL logic, and recommendation engine are
  complete and will not change — only field name strings need updating.
- Estimated time to go live once you have sandbox credentials: **2–3 hours**.

---

## Quick Reference — Files to Update

| File | What Changes | Who |
|------|-------------|-----|
| `config/vault-config.js` | `baseUrl` → your Vault URL | You / Me |
| `mdl/document-schema.mdl.js` | Field `vqlField` values | Me (after Step 1) |
| `vql/query-templates.js` | Type/field name strings in VQL | Me (after Step 1) |
| `vault-sdk-ui/search-panel.html` | Replace mock fetch with real API call | Me (Step 4) |
| *(new)* `vault-search.vpk` | Deployment package | Me (Step 5) |
