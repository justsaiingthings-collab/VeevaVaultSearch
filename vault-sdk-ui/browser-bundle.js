/**
 * VeevaVaultSearch — Browser Bundle
 *
 * Browser-compatible (no require/module.exports) version of:
 *   - rule-engine.js   → window.VaultParser.parseQuery()
 *   - recommender.js   → window.VaultRecommender.getRecommendations()
 *                        window.VaultRecommender.getStarterRecommendations()
 *
 * This is an IIFE that sets two globals. Include before search-panel.html
 * closes its <script> block.
 *
 * Kept deliberately framework-free and build-tool-free so it runs
 * directly in any browser via a plain <script src="browser-bundle.js">.
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // SECTION 1: KEYWORD DICTIONARIES  (mirrors rule-engine.js)
  // ─────────────────────────────────────────────────────────────
  const KEYWORD_DICTIONARIES = {
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
      // eTMF / Clinical
      'tmf':                          { type: 'TMF__c',                          weight: 10 },
      'trial master file':            { type: 'TMF__c',                          weight: 10 },
      'informed consent':             { type: 'InformedConsent__c',              weight: 10 },
      'investigator brochure':        { type: 'InvestigatorBrochure__c',         weight: 10 },
      // RIM / Regulatory
      'submission':                   { type: 'Submission__c',                   weight: 10 },
      'dossier':                      { type: 'Submission__c',                   weight: 8  },
      'nda':                          { type: 'Submission__c',                   weight: 9  },
      'bla':                          { type: 'Submission__c',                   weight: 9  },
      // Safety
      'adverse event':                { type: 'AdverseEvent__c',                 weight: 10 },
      'safety case':                  { type: 'SafetyCase__c',                   weight: 10 },
      'icsr':                         { type: 'SafetyCase__c',                   weight: 10 },
    },

    lifecycleState: {
      'approved':       { state: 'Approved__v',    weight: 10 },
      'effective':      { state: 'Effective__v',   weight: 10 },
      'current':        { state: 'Effective__v',   weight: 8  },
      'active':         { state: 'Effective__v',   weight: 7  },
      'draft':          { state: 'Draft__v',        weight: 10 },
      'in review':      { state: 'In Review__v',   weight: 10 },
      'under review':   { state: 'In Review__v',   weight: 10 },
      'pending':        { state: 'In Review__v',   weight: 7  },
      'open':           { state: 'Open__v',         weight: 10 },
      'closed':         { state: 'Closed__v',       weight: 10 },
      'obsolete':       { state: 'Obsolete__v',     weight: 10 },
      'superseded':     { state: 'Superseded__v',   weight: 10 },
      'old':            { state: 'Superseded__v',   weight: 5  },
      'in progress':    { state: 'In Progress__v',  weight: 10 },
      'ongoing':        { state: 'In Progress__v',  weight: 6  },
      'submitted':      { state: 'Submitted__v',    weight: 10 },
      'accepted':       { state: 'Accepted__v',     weight: 10 },
    },

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
      'expir':         { modifier: 'expiring', days: 90  },
      'due soon':      { modifier: 'expiring', days: 90  },
      'overdue':       { modifier: 'overdue',  days: null },
      'past due':      { modifier: 'overdue',  days: null },
    },

    severity: {
      'critical':  { severity: 'Critical__v', weight: 10 },
      'major':     { severity: 'Major__v',    weight: 10 },
      'minor':     { severity: 'Minor__v',    weight: 10 },
      'high':      { severity: 'Critical__v', weight: 8  },
      'severe':    { severity: 'Critical__v', weight: 8  },
      'serious':   { severity: 'Major__v',    weight: 7  },
      'low':       { severity: 'Minor__v',    weight: 8  },
    },

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

    version: {
      'version':        { modifier: 'version_info'    },
      'history':        { modifier: 'version_history' },
      'all versions':   { modifier: 'version_history' },
      'previous':       { modifier: 'version_history' },
      'old version':    { modifier: 'version_history' },
      'latest version': { modifier: 'latest'          },
      'current version':{ modifier: 'latest'          },
    },
  };

  // ─────────────────────────────────────────────────────────────
  // SECTION 2: INTENT MAPPING RULES
  // ─────────────────────────────────────────────────────────────
  const INTENT_MAPPING_RULES = [
    { id:'RULE-001', priority:100, name:'Audit Inspection Package',
      condition: s => s.audit && (s.audit.subtype==='inspection'||s.audit.subtype==='readiness'),
      mapTo: { templateId:'audit_inspection_package', category:'audit' } },
    { id:'RULE-002', priority:100, name:'High Severity Deviation',
      condition: s => s.docType==='Deviation__c' && s.severity && ['Critical__v','Major__v'].includes(s.severity),
      mapTo: { templateId:'deviation_high_severity', category:'deviation' } },
    { id:'RULE-003', priority:100, name:'Deviation with CAPA link',
      condition: s => s.docType==='Deviation__c' && s.docType2==='CAPA__c',
      mapTo: { templateId:'deviation_linked_capa', category:'deviation' } },
    { id:'RULE-004', priority:100, name:'Overdue CAPAs',
      condition: s => s.docType==='CAPA__c' && s.temporal && s.temporal.modifier==='overdue',
      mapTo: { templateId:'capa_overdue', category:'capa' } },
    { id:'RULE-005', priority:100, name:'Expiring SOPs',
      condition: s => s.docType==='Standard Operating Procedure__c' && s.temporal && s.temporal.modifier==='expiring',
      mapTo: { templateId:'sop_expiring_soon', category:'sop' } },
    { id:'RULE-006', priority:100, name:'Expiring Any Documents',
      condition: s => s.temporal && s.temporal.modifier==='expiring' && !s.docType,
      mapTo: { templateId:'time_expiring_documents', category:'time' } },
    { id:'RULE-007', priority:100, name:'Version History Request',
      condition: s => s.version && s.version.modifier==='version_history',
      mapTo: { templateId:'time_version_history', category:'time', requiresDocId:true } },
    { id:'RULE-010', priority:70, name:'Approved SOPs',
      condition: s => s.docType==='Standard Operating Procedure__c' && s.state && ['Approved__v','Effective__v'].includes(s.state),
      mapTo: { templateId:'sop_approved', category:'sop' } },
    { id:'RULE-011', priority:70, name:'SOPs for Product',
      condition: s => s.docType==='Standard Operating Procedure__c' && s.product,
      mapTo: { templateId:'sop_by_product', category:'sop' } },
    { id:'RULE-012', priority:70, name:'Open Deviations',
      condition: s => s.docType==='Deviation__c' && (!s.state||s.state==='Open__v'||s.state==='In Progress__v'),
      mapTo: { templateId:'deviation_all_open', category:'deviation' } },
    { id:'RULE-013', priority:70, name:'Open CAPAs',
      condition: s => s.docType==='CAPA__c' && (!s.state||s.state==='Open__v'||s.state==='In Progress__v'),
      mapTo: { templateId:'capa_open', category:'capa' } },
    { id:'RULE-014', priority:70, name:'Closed CAPAs',
      condition: s => s.docType==='CAPA__c' && s.state==='Closed__v',
      mapTo: { templateId:'capa_closed', category:'capa' } },
    { id:'RULE-015', priority:80, name:'High Severity CAPAs',
      condition: s => s.docType==='CAPA__c' && s.severity && ['Critical__v','Major__v'].includes(s.severity),
      mapTo: { templateId:'capa_high_severity', category:'capa' } },
    { id:'RULE-016', priority:70, name:'Audit Ready Documents',
      condition: s => s.audit && !s.docType,
      mapTo: { templateId:'audit_ready_docs', category:'audit' } },
    { id:'RULE-020', priority:30, name:'SOP Fallback',
      condition: s => s.docType==='Standard Operating Procedure__c',
      mapTo: { templateId:'sop_approved', category:'sop' } },
    { id:'RULE-021', priority:30, name:'Deviation Fallback',
      condition: s => s.docType==='Deviation__c',
      mapTo: { templateId:'deviation_all_open', category:'deviation' } },
    { id:'RULE-022', priority:30, name:'CAPA Fallback',
      condition: s => s.docType==='CAPA__c',
      mapTo: { templateId:'capa_open', category:'capa' } },
    { id:'RULE-023', priority:30, name:'Recent Changes Fallback',
      condition: s => s.temporal && s.temporal.modifier==='recent',
      mapTo: { templateId:'time_last_30_days_changes', category:'time' } },
    { id:'RULE-024', priority:30, name:'By Document Type Fallback',
      condition: s => !!s.docType && !s.state,
      mapTo: { templateId:'doc_by_type', category:'discovery' } },
    { id:'RULE-025', priority:30, name:'By Lifecycle State Fallback',
      condition: s => !!s.state && !s.docType,
      mapTo: { templateId:'doc_by_lifecycle_state', category:'discovery' } },
    { id:'RULE-099', priority:0, name:'Default: All Accessible Documents',
      condition: () => true,
      mapTo: { templateId:'doc_all_accessible', category:'discovery' } },
  ].sort((a, b) => b.priority - a.priority);

  // ─────────────────────────────────────────────────────────────
  // SECTION 3: EDGE CASE RULES
  // ─────────────────────────────────────────────────────────────
  const EDGE_CASE_RULES = [
    { id:'EDGE-001', detect: q => !q||q.trim().length===0,
      resolve: () => ({ templateId:'doc_all_accessible', params:{} }) },
    { id:'EDGE-002', detect: q => /^[\d]{5,}$/.test(q.trim()),
      resolve: q => ({ templateId:'time_version_history', params:{ doc_id: q.trim() }, note:'Input detected as document ID' }) },
    { id:'EDGE-003', detect: q => q && q.trim().length < 3,
      resolve: () => ({ templateId:'doc_all_accessible', params:{}, note:'Query too short' }) },
    { id:'EDGE-004',
      detect: q => {
        const stopwords = ['the','a','an','is','are','was','were','show','me','find','get','list','all','any'];
        return q.toLowerCase().trim().split(/\s+/).every(w => stopwords.includes(w));
      },
      resolve: () => ({ templateId:'doc_all_accessible', params:{}, note:'Only stopwords' }) },
  ];

  // ─────────────────────────────────────────────────────────────
  // SECTION 4: PARSER
  // ─────────────────────────────────────────────────────────────
  function _normalize(raw) {
    return raw.toLowerCase().trim().replace(/[^\w\s-]/g,' ').replace(/\s+/g,' ').trim();
  }

  function _tokenize(normalized) {
    const words = normalized.split(' ').filter(w => w.length > 1);
    const bigrams = [], trigrams = [];
    for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]} ${words[i+1]}`);
    for (let i = 0; i < words.length - 2; i++) trigrams.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
    return { words, bigrams, trigrams, all: [...trigrams, ...bigrams, ...words] };
  }

  function _extractSignals(normalized, tokens) {
    const signals = { docType:null, docType2:null, state:null, temporal:null, severity:null, audit:null, product:null, version:null, rawKeywords:[] };
    const terms = tokens.all;

    // Document type
    let dtMatches = [];
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.documentType[t]) {
        const m = KEYWORD_DICTIONARIES.documentType[t];
        dtMatches.push({ type:m.type, weight:m.weight, term:t });
      }
    }
    dtMatches.sort((a,b) => b.weight - a.weight);
    const uniqTypes = [...new Set(dtMatches.map(m=>m.type))];
    signals.docType  = uniqTypes[0] || null;
    signals.docType2 = uniqTypes[1] || null;

    // Lifecycle state
    let stMatches = [];
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.lifecycleState[t]) {
        const m = KEYWORD_DICTIONARIES.lifecycleState[t];
        stMatches.push({ state:m.state, weight:m.weight });
      }
    }
    stMatches.sort((a,b) => b.weight - a.weight);
    signals.state = stMatches[0]?.state || null;

    // Temporal
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.temporal[t]) { signals.temporal = KEYWORD_DICTIONARIES.temporal[t]; break; }
    }
    if (!signals.temporal) {
      for (const w of tokens.words) {
        if (w.startsWith('expir')) { signals.temporal = KEYWORD_DICTIONARIES.temporal['expir']; break; }
      }
    }

    // Severity
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.severity[t]) { signals.severity = KEYWORD_DICTIONARIES.severity[t].severity; break; }
    }

    // Audit
    const AUDIT_PRIO = ['inspection','readiness','regulatory','gxp','gdp','gmp','general'];
    const auditMatches = [];
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.audit[t]) auditMatches.push(KEYWORD_DICTIONARIES.audit[t]);
    }
    if (auditMatches.length > 0) {
      auditMatches.sort((a,b) => {
        const ai = AUDIT_PRIO.indexOf(a.subtype), bi = AUDIT_PRIO.indexOf(b.subtype);
        return (ai===-1?99:ai) - (bi===-1?99:bi);
      });
      signals.audit = auditMatches[0];
    }

    // Version
    for (const t of terms) {
      if (KEYWORD_DICTIONARIES.version[t]) { signals.version = KEYWORD_DICTIONARIES.version[t]; break; }
    }

    signals.rawKeywords = [...new Set([...dtMatches.map(m=>m.term), ...stMatches.map(m=>m.state)])];
    return signals;
  }

  function _matchRule(signals) {
    for (const rule of INTENT_MAPPING_RULES) {
      try { if (rule.condition(signals)) return rule; } catch {}
    }
    return INTENT_MAPPING_RULES[INTENT_MAPPING_RULES.length - 1];
  }

  function _buildParams(signals, context) {
    const params = {};
    if (signals.temporal) { params.days_back = signals.temporal.days || 30; params.days_ahead = signals.temporal.days || 90; }
    if (signals.severity) params.severity = signals.severity;
    if (signals.product || context.activeProduct) params.product_id = signals.product || context.activeProduct;
    if (signals.state) params.lifecycle_state = signals.state;
    if (signals.docType) params.type = signals.docType;
    return params;
  }

  function _detectAmbiguity(signals, matchedRule) {
    const ambiguity = { isAmbiguous:false, reasons:[], alternativeTemplates:[] };
    if (signals.docType && signals.docType2) {
      ambiguity.isAmbiguous = true;
      ambiguity.reasons.push(`Multiple document types detected: ${signals.docType}, ${signals.docType2}`);
    }
    if (signals.docType==='CAPA__c' && signals.state==='Approved__v') {
      ambiguity.isAmbiguous = true;
      ambiguity.reasons.push("CAPAs use 'Closed' not 'Approved'. Interpreting as 'Closed' state.");
      ambiguity.stateCorrection = 'Closed__v';
    }
    return ambiguity;
  }

  /**
   * Parse a raw user query string into a structured intent object.
   * Deterministic — same input always produces same output.
   *
   * @param {string} rawQuery
   * @param {Object} [context] - { userRole, activeDocType, activeProduct }
   * @returns {Object} intentObject
   */
  function parseQuery(rawQuery, context = {}) {
    // Edge cases first
    for (const rule of EDGE_CASE_RULES) {
      if (rule.detect(rawQuery || '')) {
        const res = rule.resolve(rawQuery || '');
        return {
          rawQuery, normalized: (rawQuery||'').toLowerCase().trim(), tokens:{}, signals:{},
          intent: { templateId:res.templateId, category:'discovery', ruleId:rule.id, ruleName:rule.id, requiresDocId:false },
          params: res.params, ambiguity:{ isAmbiguous:false, reasons:[] },
          note: res.note, isEdgeCase:true, parsedAt: new Date().toISOString(),
        };
      }
    }

    const t0 = Date.now();
    const normalized = _normalize(rawQuery);
    const tokens = _tokenize(normalized);
    const signals = _extractSignals(normalized, tokens);

    // Apply context overrides
    if (context.activeDocType && !signals.docType) { signals.docType = context.activeDocType; signals._contextOverride = true; }
    if (context.activeProduct) signals.product = context.activeProduct;
    if (context.userRole) signals.userRole = context.userRole;

    const matchedRule = _matchRule(signals);
    const params = _buildParams(signals, context);
    const ambiguity = _detectAmbiguity(signals, matchedRule);

    return {
      rawQuery, normalized, tokens, signals,
      intent: { ruleId:matchedRule.id, ruleName:matchedRule.name, templateId:matchedRule.mapTo.templateId, category:matchedRule.mapTo.category, requiresDocId:matchedRule.mapTo.requiresDocId||false },
      params, ambiguity, parseTimeMs: Date.now()-t0, parsedAt: new Date().toISOString(), context,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SECTION 5: RECOMMENDATION CATALOG  (mirrors recommender.js)
  // ─────────────────────────────────────────────────────────────
  const RECOMMENDATION_CATALOG = [
    { id:'REC-SOP-001', label:'Approved SOPs', description:'All currently approved SOPs', templateId:'sop_approved', category:'sop', icon:'📋', baseScore:50,
      triggers:{ keywords:['sop','standard operating','procedure'], roles:['QA_USER','QA_ADMIN','REGULATORY_USER'] },
      roleBonus:{ QA_USER:20, QA_ADMIN:15, REGULATORY_USER:10 }, contextBonus:{ docType:'Standard Operating Procedure__c', bonus:25 }, params:{} },
    { id:'REC-SOP-002', label:'SOPs Updated This Month', description:'SOPs modified in the last 30 days', templateId:'sop_recently_updated', category:'sop', icon:'🔄', baseScore:40,
      triggers:{ keywords:['sop','recent','updated','changed'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:20, QA_USER:15 }, contextBonus:{ docType:'Standard Operating Procedure__c', bonus:20 }, params:{ days_back:30 } },
    { id:'REC-SOP-003', label:'SOPs Expiring Soon', description:'SOPs due for renewal in 90 days', templateId:'sop_expiring_soon', category:'sop', icon:'⏰', baseScore:45,
      triggers:{ keywords:['sop','expir','renew','due'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:25, QA_USER:20 }, contextBonus:{ docType:'Standard Operating Procedure__c', bonus:15 }, params:{ days_ahead:90 }, timeBonus:{ endOfQuarter:30 } },
    { id:'REC-DEV-001', label:'Open Deviations', description:'All deviations under investigation', templateId:'deviation_all_open', category:'deviation', icon:'⚠️', baseScore:55,
      triggers:{ keywords:['deviation','incident','oos','out of spec'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:20, QA_USER:20 }, contextBonus:{ docType:'Deviation__c', bonus:30 }, params:{} },
    { id:'REC-DEV-002', label:'Critical & Major Deviations', description:'High-severity deviations', templateId:'deviation_high_severity', category:'deviation', icon:'🚨', baseScore:60,
      triggers:{ keywords:['critical','major','severe','deviation'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:25, QA_USER:20 }, contextBonus:{ docType:'Deviation__c', bonus:20 }, params:{} },
    { id:'REC-DEV-003', label:'Deviations with Open CAPAs', description:'Deviations linked to CAPA records', templateId:'deviation_linked_capa', category:'deviation', icon:'🔗', baseScore:45,
      triggers:{ keywords:['deviation','capa','linked','traceability'], roles:['QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:30 }, contextBonus:{ docType:'Deviation__c', bonus:25 }, params:{} },
    { id:'REC-DEV-004', label:'SOP Violation Deviations', description:'Procedural deviations — SOP not followed', templateId:'deviation_sop_violations', category:'deviation', icon:'📌', baseScore:40,
      triggers:{ keywords:['sop violation','procedural','procedure deviation'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:15, QA_USER:15 }, contextBonus:{ docType:'Deviation__c', bonus:10 }, params:{} },
    { id:'REC-CAPA-001', label:'Open CAPAs', description:'All open Corrective and Preventive Actions', templateId:'capa_open', category:'capa', icon:'🔧', baseScore:55,
      triggers:{ keywords:['capa','corrective','preventive','action'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:20, QA_USER:20 }, contextBonus:{ docType:'CAPA__c', bonus:30 }, params:{} },
    { id:'REC-CAPA-002', label:'Overdue CAPAs', description:'CAPAs past their target completion date', templateId:'capa_overdue', category:'capa', icon:'🔴', baseScore:65,
      triggers:{ keywords:['overdue','past due','late','capa'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:30, QA_USER:25 }, contextBonus:{ docType:'CAPA__c', bonus:25 }, params:{}, timeBonus:{ always:10 } },
    { id:'REC-CAPA-003', label:'High Severity CAPAs', description:'Critical and Major CAPAs', templateId:'capa_high_severity', category:'capa', icon:'🚨', baseScore:60,
      triggers:{ keywords:['critical','major','high severity','capa'], roles:['QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:30, QA_USER:15 }, contextBonus:{ docType:'CAPA__c', bonus:20 }, params:{} },
    { id:'REC-CAPA-004', label:'Closed CAPAs', description:'Completed CAPAs — for audit evidence', templateId:'capa_closed', category:'capa', icon:'✅', baseScore:35,
      triggers:{ keywords:['closed','completed','resolved','capa'], roles:['QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:20 }, contextBonus:{ docType:'CAPA__c', bonus:15 }, params:{} },
    { id:'REC-AUD-001', label:'Audit-Ready Documents', description:'GxP-relevant approved/effective documents', templateId:'audit_ready_docs', category:'audit', icon:'🏛️', baseScore:60,
      triggers:{ keywords:['audit','inspection','compliance','gxp','ready'], roles:['QA_USER','QA_ADMIN','REGULATORY_USER'] },
      roleBonus:{ QA_ADMIN:25, QA_USER:15, REGULATORY_USER:30 }, contextBonus:{ category:'audit', bonus:25 }, params:{} },
    { id:'REC-AUD-002', label:'Inspection Package', description:'Full inspection-ready document set', templateId:'audit_inspection_package', category:'audit', icon:'📦', baseScore:65,
      triggers:{ keywords:['inspection','fda','ema','package'], roles:['QA_ADMIN','REGULATORY_USER'] },
      roleBonus:{ QA_ADMIN:30, REGULATORY_USER:35 }, contextBonus:{ category:'audit', bonus:30 }, params:{} },
    { id:'REC-AUD-003', label:'Change Log (30 days)', description:'All document changes in the last 30 days', templateId:'audit_change_log', category:'audit', icon:'📝', baseScore:45,
      triggers:{ keywords:['change','modified','updated','log','audit trail'], roles:['QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:25 }, contextBonus:{ category:'audit', bonus:15 }, params:{ days_back:30 } },
    { id:'REC-AUD-004', label:'Missing e-Signatures', description:'Approved documents missing electronic signature', templateId:'audit_unsigned_docs', category:'audit', icon:'✍️', baseScore:55,
      triggers:{ keywords:['signature','unsigned','e-signature','missing signature'], roles:['QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:30 }, contextBonus:{ category:'audit', bonus:20 }, params:{} },
    { id:'REC-TIME-001', label:'Recently Approved', description:'Documents approved in the last 30 days', templateId:'time_recently_approved', category:'time', icon:'✨', baseScore:40,
      triggers:{ keywords:['recently approved','new approvals','approved this month'], roles:['ALL'] },
      roleBonus:{}, contextBonus:{}, params:{ days_back:30 } },
    { id:'REC-TIME-002', label:'Expiring in 90 Days', description:'All documents expiring in the next 90 days', templateId:'time_expiring_documents', category:'time', icon:'⏳', baseScore:50,
      triggers:{ keywords:['expir','renew','due','expiration'], roles:['QA_USER','QA_ADMIN'] },
      roleBonus:{ QA_ADMIN:20, QA_USER:15 }, contextBonus:{}, params:{ days_ahead:90 }, timeBonus:{ endOfQuarter:25 } },
    { id:'REC-TIME-003', label:'All Recent Changes', description:'Documents modified in the last 30 days', templateId:'time_last_30_days_changes', category:'time', icon:'🕐', baseScore:35,
      triggers:{ keywords:['recent','changes','modified','updated'], roles:['ALL'] },
      roleBonus:{}, contextBonus:{}, params:{ days_back:30 } },
    { id:'REC-REG-001', label:'Regulatory Submissions', description:'Documents in submitted/accepted lifecycle', templateId:'doc_by_lifecycle_state', category:'regulatory', icon:'🏛️', baseScore:30,
      triggers:{ keywords:['submission','submitted','regulatory'], roles:['REGULATORY_USER'] },
      roleBonus:{ REGULATORY_USER:50 }, contextBonus:{}, params:{ lifecycle_state:'Submitted__v' } },
    { id:'REC-CLIN-001', label:'Study Protocols', description:'All approved study protocols', templateId:'doc_by_type', category:'clinical', icon:'🧪', baseScore:30,
      triggers:{ keywords:['protocol','study','clinical','trial'], roles:['CLINICAL_USER'] },
      roleBonus:{ CLINICAL_USER:50 }, contextBonus:{ docType:'Protocol__c', bonus:25 }, params:{ type:'Protocol__c' } },
  ];

  // ─────────────────────────────────────────────────────────────
  // SECTION 6: SCORING ENGINE
  // ─────────────────────────────────────────────────────────────
  function _buildDateContext() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day   = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), month, 0).getDate();
    return {
      month, day,
      isEndOfMonth:   day >= daysInMonth - 5,
      isEndOfQuarter: (month===3||month===6||month===9||month===12) && day >= 20,
      isStartOfMonth: day <= 5,
    };
  }

  function _scoreRec(rec, ctx) {
    let score = rec.baseScore;
    if (ctx.keywords && rec.triggers.keywords) {
      let kBonus = 0;
      const ckws = ctx.keywords.map(k => k.toLowerCase());
      for (const tk of rec.triggers.keywords) {
        const tl = tk.toLowerCase();
        if (ckws.some(ck => ck.includes(tl) || tl.includes(ck))) kBonus = Math.min(kBonus+15, 45);
      }
      score += kBonus;
    }
    if (ctx.userRole && rec.roleBonus) score += (rec.roleBonus[ctx.userRole] || 0);
    if (ctx.activeDocType && rec.contextBonus && rec.contextBonus.docType) {
      if (ctx.activeDocType === rec.contextBonus.docType) score += rec.contextBonus.bonus;
    }
    if (rec.timeBonus && ctx.dateContext) {
      if (rec.timeBonus.always) score += rec.timeBonus.always;
      if (rec.timeBonus.endOfQuarter && ctx.dateContext.isEndOfQuarter) score += rec.timeBonus.endOfQuarter;
      if (rec.timeBonus.endOfMonth && ctx.dateContext.isEndOfMonth) score += rec.timeBonus.endOfMonth;
    }
    const allowed = rec.triggers.roles || [];
    if (!allowed.includes('ALL') && ctx.userRole && !allowed.includes(ctx.userRole)) score = 0;
    return score;
  }

  /**
   * Get ranked query recommendations.
   * @param {Object} context - { userRole, keywords, activeDocType, maxResults }
   * @returns {Object[]} recommendations sorted by score descending
   */
  function getRecommendations(context = {}) {
    const { userRole=null, keywords=[], activeDocType=null, maxResults=8 } = context;
    const dateContext = _buildDateContext();
    const ctx = { userRole, keywords, activeDocType, dateContext };
    const scored = RECOMMENDATION_CATALOG.map(rec => ({
      ...rec,
      score: _scoreRec(rec, ctx),
    }));
    return scored
      .filter(r => r.score > 0)
      .sort((a,b) => b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id))
      .slice(0, maxResults);
  }

  const ROLE_STARTERS = {
    QA_ADMIN:        ['REC-SOP-001','REC-DEV-001','REC-CAPA-002','REC-AUD-002','REC-AUD-004','REC-SOP-003'],
    QA_USER:         ['REC-SOP-001','REC-DEV-001','REC-CAPA-001','REC-SOP-003','REC-TIME-001'],
    CLINICAL_USER:   ['REC-CLIN-001','REC-SOP-001','REC-TIME-001'],
    REGULATORY_USER: ['REC-AUD-001','REC-AUD-002','REC-REG-001','REC-SOP-001','REC-TIME-001'],
    READ_ONLY:       ['REC-SOP-001','REC-TIME-001'],
    DEFAULT:         ['REC-SOP-001','REC-DEV-001','REC-CAPA-001','REC-AUD-001','REC-TIME-003'],
  };

  /**
   * Get role-specific starter recommendations for the initial empty-search state.
   * @param {string} userRole
   * @returns {Object[]}
   */
  function getStarterRecommendations(userRole) {
    const ids = ROLE_STARTERS[userRole] || ROLE_STARTERS.DEFAULT;
    const catalogMap = RECOMMENDATION_CATALOG.reduce((m,r) => { m[r.id]=r; return m; }, {});
    return ids.map(id => catalogMap[id]).filter(Boolean);
  }

  // ─────────────────────────────────────────────────────────────
  // EXPOSE GLOBALS
  // ─────────────────────────────────────────────────────────────
  global.VaultParser = { parseQuery };
  global.VaultRecommender = { getRecommendations, getStarterRecommendations, RECOMMENDATION_CATALOG };

}(typeof window !== 'undefined' ? window : this));
