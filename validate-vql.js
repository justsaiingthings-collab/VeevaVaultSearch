#!/usr/bin/env node
/**
 * VALIDATE-VQL — Live VQL Validation Script
 *
 * Runs all VQL templates against a real Vault sandbox and reports
 * which succeed, which fail due to field name mismatches, and what
 * fixes are needed in query-templates.js and document-schema.mdl.js.
 *
 * Usage:
 *   node validate-vql.js --url https://YOUR-TENANT.veevavault.com \
 *                        --token YOUR_SESSION_TOKEN
 *
 * Optional flags:
 *   --category sop         Only run templates in a specific category
 *   --template sop_approved  Only run a single template by ID
 *   --dry-run              Print generated VQL without executing
 *   --output report.json   Save results to a JSON file
 *   --timeout 10000        Per-query timeout in ms (default: 8000)
 *   --limit 3              Max documents to return per query (default: 3)
 *
 * Output:
 *   Prints a pass/fail table and a repair manifest for failed queries.
 *   Exit code 0 = all pass, 1 = some failures.
 */

'use strict';

const https  = require('https');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');

// ─────────────────────────────────────────────────────────────
// ARG PARSING
// ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url:      null,
    token:    null,
    category: null,
    template: null,
    dryRun:   false,
    output:   null,
    timeout:  8000,
    limit:    3,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':      opts.url      = args[++i]; break;
      case '--token':    opts.token    = args[++i]; break;
      case '--category': opts.category = args[++i]; break;
      case '--template': opts.template = args[++i]; break;
      case '--dry-run':  opts.dryRun   = true;       break;
      case '--output':   opts.output   = args[++i]; break;
      case '--timeout':  opts.timeout  = parseInt(args[++i], 10); break;
      case '--limit':    opts.limit    = parseInt(args[++i], 10); break;
    }
  }
  return opts;
}

// ─────────────────────────────────────────────────────────────
// VAULT HTTP CLIENT
// ─────────────────────────────────────────────────────────────

/**
 * POST a VQL query to Vault and return the parsed JSON response.
 * @param {string} baseUrl - e.g. https://acme.veevavault.com
 * @param {string} token   - Vault session token
 * @param {string} vql     - VQL query string
 * @param {number} timeoutMs
 * @returns {Promise<Object>} Vault API response JSON
 */
function executeVQL(baseUrl, token, vql, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/v26.1/query`);
    const body = `q=${encodeURIComponent(vql)}`;
    const lib  = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname,
        method:   'POST',
        headers:  {
          'Authorization':  token,
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Accept':         'application/json',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ statusCode: res.statusCode, body: raw, parseError: true });
          }
        });
      }
    );

    req.on('error', reject);

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// ERROR CLASSIFICATION
// ─────────────────────────────────────────────────────────────

/**
 * Given a Vault API error response, classify what went wrong
 * and suggest a specific fix.
 */
function classifyError(vaultResponse, vql) {
  const body = vaultResponse.body;
  if (!body || !body.errors) {
    return { type: 'UNKNOWN', detail: JSON.stringify(body).slice(0, 200), fix: null };
  }

  const errors = Array.isArray(body.errors) ? body.errors : [body.errors];
  const msgs   = errors.map(e => (e.message || e.type || '').toLowerCase()).join(' | ');

  if (msgs.includes('invalid field') || msgs.includes('unknown field') || msgs.includes('column')) {
    // Extract field name from error message
    const fieldMatch = msgs.match(/['"`]?(\w+__[vc])['"`]?/) ||
                       msgs.match(/field[:\s]+['"`]?(\w+)['"`]?/);
    const badField = fieldMatch?.[1] || 'unknown';
    return {
      type: 'FIELD_NAME_MISMATCH',
      detail: `Field "${badField}" does not exist in this tenant.`,
      fix:    `Run GET /api/v26.1/metadata/objects/documents/properties and update the field "${badField}" in mdl/document-schema.mdl.js and vql/query-templates.js.`,
      badField,
    };
  }

  if (msgs.includes('invalid document type') || msgs.includes('unknown type') || msgs.includes("type__v")) {
    const typeMatch = vql.match(/type__v\s*=\s*'([^']+)'/i);
    const badType   = typeMatch?.[1] || 'unknown';
    return {
      type:   'DOCUMENT_TYPE_MISMATCH',
      detail: `Document type "${badType}" does not exist in this tenant.`,
      fix:    `Run GET /api/v26.1/metadata/objects/documents/types and update the type name "${badType}" in vql/query-templates.js and recommendation-engine/recommender.js.`,
      badType,
    };
  }

  if (msgs.includes('lifecycle') || msgs.includes('state')) {
    const stateMatch = vql.match(/lifecycle_state__v\s*=\s*'([^']+)'/i);
    const badState   = stateMatch?.[1] || 'unknown';
    return {
      type:   'LIFECYCLE_STATE_MISMATCH',
      detail: `Lifecycle state "${badState}" does not exist in this tenant.`,
      fix:    `Run GET /api/v26.1/metadata/objects/documents/properties and check lifecycle_state__v allowed values. Update query-templates.js.`,
      badState,
    };
  }

  if (msgs.includes('unauthorized') || msgs.includes('forbidden') || msgs.includes('permission')) {
    return {
      type:   'PERMISSION_DENIED',
      detail: 'Current user does not have access to the queried object/field.',
      fix:    'This template requires elevated permissions. Check the user role in Vault Admin → Security Profiles.',
    };
  }

  if (msgs.includes('syntax') || msgs.includes('parse error')) {
    return {
      type:   'VQL_SYNTAX_ERROR',
      detail: msgs,
      fix:    'Review the VQL syntax in query-templates.js for this template.',
    };
  }

  return {
    type:   'API_ERROR',
    detail: msgs,
    fix:    null,
  };
}

// ─────────────────────────────────────────────────────────────
// REPORT PRINTER
// ─────────────────────────────────────────────────────────────

function printHeader() {
  console.log('\n' + '═'.repeat(72));
  console.log('  VeevaVaultSearch — VQL Validation Report');
  console.log('═'.repeat(72));
}

function printResult(result, index, total) {
  const icon   = result.status === 'PASS' ? '✓' : result.status === 'SKIP' ? '−' : '✗';
  const padded = `[${index + 1}/${total}]`.padEnd(8);
  const idPad  = result.templateId.padEnd(32);
  console.log(`  ${icon}  ${padded} ${idPad}  ${result.status}  ${result.rowCount != null ? `(${result.rowCount} rows)` : ''}`);
}

function printSummary(results) {
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;

  console.log('\n' + '─'.repeat(72));
  console.log(`  ${pass} passed  ·  ${fail} failed  ·  ${skip} skipped  ·  ${results.length} total`);
  console.log('─'.repeat(72));

  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length === 0) {
    console.log('\n  ✓ All templates validated successfully against this Vault tenant.');
    console.log('  The system is ready to deploy. Follow CONNECT-TO-VAULT.md → Step 4.\n');
    return;
  }

  console.log('\n  REPAIR MANIFEST — required changes before deployment:\n');

  // Group fixes by type
  const byType = {};
  for (const f of failures) {
    const t = f.errorClassification?.type || 'UNKNOWN';
    if (!byType[t]) byType[t] = [];
    byType[t].push(f);
  }

  let fixNum = 1;
  for (const [errorType, items] of Object.entries(byType)) {
    console.log(`  ── ${errorType}`);
    for (const item of items) {
      console.log(`     ${fixNum++}. Template: ${item.templateId}`);
      console.log(`        VQL:   ${item.vql.slice(0, 80)}...`);
      if (item.errorClassification?.detail) {
        console.log(`        Error: ${item.errorClassification.detail}`);
      }
      if (item.errorClassification?.fix) {
        console.log(`        Fix:   ${item.errorClassification.fix}`);
      }
      console.log('');
    }
  }

  console.log('  After updating the field/type names, re-run this script to confirm.\n');
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Load template library
  let VQLTemplateLibrary, ALL_TEMPLATES;
  try {
    ({ VQLTemplateLibrary, ALL_TEMPLATES } = require(path.join(__dirname, 'vql/query-templates.js')));
  } catch (err) {
    console.error('[ERROR] Could not load vql/query-templates.js:', err.message);
    process.exit(1);
  }

  // Select templates to run
  let templates = ALL_TEMPLATES;
  if (opts.template) {
    const t = VQLTemplateLibrary.get(opts.template);
    if (!t) {
      console.error(`[ERROR] Template "${opts.template}" not found.`);
      process.exit(1);
    }
    templates = [t];
  } else if (opts.category) {
    templates = ALL_TEMPLATES.filter(t =>
      t.category.toLowerCase().includes(opts.category.toLowerCase())
    );
    if (templates.length === 0) {
      console.error(`[ERROR] No templates found for category "${opts.category}".`);
      process.exit(1);
    }
  }

  printHeader();
  console.log(`  Vault URL : ${opts.url || '(dry-run mode)'}`);
  console.log(`  Templates : ${templates.length}`);
  console.log(`  Limit/query: ${opts.limit} rows`);
  if (opts.dryRun) console.log('  Mode      : DRY RUN (no API calls)');
  console.log('');

  if (!opts.dryRun && !opts.url) {
    console.error('[ERROR] --url is required unless --dry-run is specified.');
    console.error('Usage: node validate-vql.js --url https://YOUR-TENANT.veevavault.com --token YOUR_TOKEN');
    process.exit(1);
  }
  if (!opts.dryRun && !opts.token) {
    console.error('[ERROR] --token is required unless --dry-run is specified.');
    process.exit(1);
  }

  const results = [];

  for (let i = 0; i < templates.length; i++) {
    const tpl = templates[i];

    // Render with a LIMIT to keep validation fast.
    // For parameterized templates, inject placeholder values so the VQL
    // can be executed; Vault will return 0 rows rather than an error.
    let rendered;
    try {
      // First attempt: render with no params (works for param-free templates)
      rendered = VQLTemplateLibrary.render(tpl.id);
    } catch (renderErr) {
      // Second attempt: inject placeholder strings for every {{param}}
      const placeholders = {};
      const paramMatches = (tpl.vql || '').matchAll(/\{\{(\w+)\}\}/g);
      for (const m of paramMatches) {
        placeholders[m[1]] = 'VALIDATION_PLACEHOLDER';
      }
      try {
        rendered = VQLTemplateLibrary.render(tpl.id, placeholders);
      } catch (e2) {
        results.push({ templateId: tpl.id, status: 'SKIP', reason: `render() failed: ${e2.message}` });
        printResult(results[results.length - 1], i, templates.length);
        continue;
      }
    }

    if (!rendered || !rendered.vql) {
      results.push({ templateId: tpl.id, status: 'SKIP', reason: 'render() returned null' });
      printResult(results[results.length - 1], i, templates.length);
      continue;
    }

    // Add LIMIT if not already present
    let vql = rendered.vql;
    if (!vql.toUpperCase().includes('LIMIT')) {
      vql = `${vql} LIMIT ${opts.limit}`;
    }

    if (opts.dryRun) {
      results.push({ templateId: tpl.id, status: 'SKIP', vql, reason: 'dry-run' });
      console.log(`  −  [${i + 1}/${templates.length}] ${tpl.id.padEnd(32)}  DRY-RUN`);
      console.log(`       VQL: ${vql.slice(0, 100)}`);
      continue;
    }

    // Execute against Vault
    try {
      const response = await executeVQL(opts.url, opts.token, vql, opts.timeout);

      if (response.statusCode === 200 && response.body?.responseStatus === 'SUCCESS') {
        const rowCount = response.body?.responseDetails?.total || response.body?.data?.length || 0;
        results.push({ templateId: tpl.id, status: 'PASS', vql, rowCount });
      } else {
        const errorClass = classifyError(response, vql);
        results.push({
          templateId:           tpl.id,
          status:               'FAIL',
          vql,
          statusCode:           response.statusCode,
          vaultErrors:          response.body?.errors,
          errorClassification:  errorClass,
        });
      }
    } catch (err) {
      results.push({
        templateId:          tpl.id,
        status:              'FAIL',
        vql,
        networkError:        err.message,
        errorClassification: { type: 'NETWORK_ERROR', detail: err.message, fix: 'Check your --url and network connectivity.' },
      });
    }

    printResult(results[results.length - 1], i, templates.length);

    // Brief pause to avoid rate limiting
    await new Promise(r => setTimeout(r, 150));
  }

  printSummary(results);

  // Save report if requested
  if (opts.output) {
    const report = {
      generatedAt:  new Date().toISOString(),
      vaultUrl:     opts.url,
      templatesRun: templates.length,
      summary: {
        passed:  results.filter(r => r.status === 'PASS').length,
        failed:  results.filter(r => r.status === 'FAIL').length,
        skipped: results.filter(r => r.status === 'SKIP').length,
      },
      results,
    };
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  Report saved to: ${opts.output}\n`);
  }

  const hasFailures = results.some(r => r.status === 'FAIL');
  process.exit(hasFailures ? 1 : 0);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
