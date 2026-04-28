/**
 * RECOMMENDED QUERY ENGINE — RULE-BASED RECOMMENDATION SYSTEM
 * VeevaVaultSearch
 *
 * Produces deterministic, ranked query recommendations based on:
 *  1. Keywords in the current search context
 *  2. Active document type context (what the user is browsing)
 *  3. User role (QA / Clinical / Regulatory)
 *  4. Time-based triggers (end of month, expiring soon)
 *
 * OUTPUT:
 *  - List of ranked QueryRecommendation objects
 *  - Each recommendation has a label, templateId, params, and score
 *
 * DETERMINISTIC SCORING:
 *  score = base_score + role_bonus + context_bonus + time_bonus
 *  All bonuses are fixed integer constants — no floating point inference.
 *
 * NO ML / NO AI / NO PROBABILISTIC SCORING.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// SECTION 1: QUERY RECOMMENDATION CATALOG
// Defines all possible recommendations; scoring applied at runtime
// ─────────────────────────────────────────────────────────────

const RECOMMENDATION_CATALOG = [

  // ── SOP RECOMMENDATIONS ──────────────────────────────────
  {
    id: 'REC-SOP-001',
    label: 'Approved SOPs',
    description: 'All currently approved Standard Operating Procedures',
    templateId: 'sop_approved',
    category: 'sop',
    icon: '📋',
    baseScore: 50,
    triggers: {
      keywords:    ['sop', 'standard operating', 'procedure'],
      docTypes:    ['Standard Operating Procedure__c'],
      roles:       ['QA_USER', 'QA_ADMIN', 'REGULATORY_USER'],
    },
    roleBonus:    { QA_USER: 20, QA_ADMIN: 15, REGULATORY_USER: 10 },
    contextBonus: { docType: 'Standard Operating Procedure__c', bonus: 25 },
    params:       {},
  },
  {
    id: 'REC-SOP-002',
    label: 'SOPs Updated This Month',
    description: 'Standard Operating Procedures modified in the last 30 days',
    templateId: 'sop_recently_updated',
    category: 'sop',
    icon: '🔄',
    baseScore: 40,
    triggers: {
      keywords:  ['sop', 'recent', 'updated', 'changed', 'modified'],
      docTypes:  ['Standard Operating Procedure__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 20, QA_USER: 15 },
    contextBonus: { docType: 'Standard Operating Procedure__c', bonus: 20 },
    params:       { days_back: 30 },
  },
  {
    id: 'REC-SOP-003',
    label: 'SOPs Expiring Soon',
    description: 'SOPs due for renewal in the next 90 days',
    templateId: 'sop_expiring_soon',
    category: 'sop',
    icon: '⏰',
    baseScore: 45,
    triggers: {
      keywords:  ['sop', 'expir', 'renew', 'due'],
      docTypes:  ['Standard Operating Procedure__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 25, QA_USER: 20 },
    contextBonus: { docType: 'Standard Operating Procedure__c', bonus: 15 },
    params:       { days_ahead: 90 },
    timeBonus:    { endOfQuarter: 30 },  // Extra boost if end-of-quarter
  },

  // ── DEVIATION RECOMMENDATIONS ────────────────────────────
  {
    id: 'REC-DEV-001',
    label: 'Open Deviations',
    description: 'All deviations currently under investigation',
    templateId: 'deviation_all_open',
    category: 'deviation',
    icon: '⚠️',
    baseScore: 55,
    triggers: {
      keywords:  ['deviation', 'deviations', 'incident', 'oos', 'out of spec'],
      docTypes:  ['Deviation__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 20, QA_USER: 20 },
    contextBonus: { docType: 'Deviation__c', bonus: 30 },
    params:       {},
  },
  {
    id: 'REC-DEV-002',
    label: 'Critical & Major Deviations',
    description: 'High-severity deviations requiring immediate attention',
    templateId: 'deviation_high_severity',
    category: 'deviation',
    icon: '🚨',
    baseScore: 60,
    triggers: {
      keywords:  ['critical', 'major', 'severe', 'high severity', 'deviation'],
      docTypes:  ['Deviation__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 25, QA_USER: 20 },
    contextBonus: { docType: 'Deviation__c', bonus: 20 },
    params:       {},
  },
  {
    id: 'REC-DEV-003',
    label: 'Deviations with Open CAPAs',
    description: 'Deviations linked to CAPA records — for traceability review',
    templateId: 'deviation_linked_capa',
    category: 'deviation',
    icon: '🔗',
    baseScore: 45,
    triggers: {
      keywords:  ['deviation', 'capa', 'linked', 'traceability'],
      docTypes:  ['Deviation__c', 'CAPA__c'],
      roles:     ['QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 30 },
    contextBonus: { docType: 'Deviation__c', bonus: 25 },
    params:       {},
  },
  {
    id: 'REC-DEV-004',
    label: 'SOP Violation Deviations',
    description: 'Procedural deviations indicating SOP was not followed',
    templateId: 'deviation_sop_violations',
    category: 'deviation',
    icon: '📌',
    baseScore: 40,
    triggers: {
      keywords:  ['sop violation', 'procedural', 'not followed', 'procedure deviation'],
      docTypes:  ['Deviation__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 15, QA_USER: 15 },
    contextBonus: { docType: 'Deviation__c', bonus: 10 },
    params:       {},
  },

  // ── CAPA RECOMMENDATIONS ─────────────────────────────────
  {
    id: 'REC-CAPA-001',
    label: 'Open CAPAs',
    description: 'All open Corrective and Preventive Actions',
    templateId: 'capa_open',
    category: 'capa',
    icon: '🔧',
    baseScore: 55,
    triggers: {
      keywords:  ['capa', 'corrective', 'preventive', 'action'],
      docTypes:  ['CAPA__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 20, QA_USER: 20 },
    contextBonus: { docType: 'CAPA__c', bonus: 30 },
    params:       {},
  },
  {
    id: 'REC-CAPA-002',
    label: 'Overdue CAPAs',
    description: 'CAPAs past their target completion date',
    templateId: 'capa_overdue',
    category: 'capa',
    icon: '🔴',
    baseScore: 65,
    triggers: {
      keywords:  ['overdue', 'past due', 'late', 'missed', 'capa'],
      docTypes:  ['CAPA__c'],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 30, QA_USER: 25 },
    contextBonus: { docType: 'CAPA__c', bonus: 25 },
    params:       {},
    timeBonus:    { always: 10 },  // Always boost overdue items
  },
  {
    id: 'REC-CAPA-003',
    label: 'High Severity CAPAs',
    description: 'Critical and Major CAPAs requiring executive attention',
    templateId: 'capa_high_severity',
    category: 'capa',
    icon: '🚨',
    baseScore: 60,
    triggers: {
      keywords:  ['critical', 'major', 'high severity', 'capa'],
      docTypes:  ['CAPA__c'],
      roles:     ['QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 30, QA_USER: 15 },
    contextBonus: { docType: 'CAPA__c', bonus: 20 },
    params:       {},
  },
  {
    id: 'REC-CAPA-004',
    label: 'Closed CAPAs',
    description: 'Completed CAPAs — for audit evidence and trend review',
    templateId: 'capa_closed',
    category: 'capa',
    icon: '✅',
    baseScore: 35,
    triggers: {
      keywords:  ['closed', 'completed', 'resolved', 'capa'],
      docTypes:  ['CAPA__c'],
      roles:     ['QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 20 },
    contextBonus: { docType: 'CAPA__c', bonus: 15 },
    params:       {},
  },

  // ── AUDIT RECOMMENDATIONS ────────────────────────────────
  {
    id: 'REC-AUD-001',
    label: 'Audit-Ready Documents',
    description: 'GxP-relevant documents in approved/effective state',
    templateId: 'audit_ready_docs',
    category: 'audit',
    icon: '🏛️',
    baseScore: 60,
    triggers: {
      keywords:  ['audit', 'inspection', 'compliance', 'gxp', 'ready'],
      docTypes:  [],
      roles:     ['QA_USER', 'QA_ADMIN', 'REGULATORY_USER'],
    },
    roleBonus:    { QA_ADMIN: 25, QA_USER: 15, REGULATORY_USER: 30 },
    contextBonus: { category: 'audit', bonus: 25 },
    params:       {},
  },
  {
    id: 'REC-AUD-002',
    label: 'Inspection Package',
    description: 'Full inspection-ready document set: SOPs, Deviations, CAPAs, Reports',
    templateId: 'audit_inspection_package',
    category: 'audit',
    icon: '📦',
    baseScore: 65,
    triggers: {
      keywords:  ['inspection', 'fda', 'ema', 'regulatory audit', 'package'],
      docTypes:  [],
      roles:     ['QA_ADMIN', 'REGULATORY_USER'],
    },
    roleBonus:    { QA_ADMIN: 30, REGULATORY_USER: 35 },
    contextBonus: { category: 'audit', bonus: 30 },
    params:       {},
  },
  {
    id: 'REC-AUD-003',
    label: 'Change Log (30 days)',
    description: 'All document changes in the last 30 days',
    templateId: 'audit_change_log',
    category: 'audit',
    icon: '📝',
    baseScore: 45,
    triggers: {
      keywords:  ['change', 'modified', 'updated', 'log', 'audit trail'],
      docTypes:  [],
      roles:     ['QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 25 },
    contextBonus: { category: 'audit', bonus: 15 },
    params:       { days_back: 30 },
  },
  {
    id: 'REC-AUD-004',
    label: 'Missing e-Signatures',
    description: 'Approved documents missing electronic signature',
    templateId: 'audit_unsigned_docs',
    category: 'audit',
    icon: '✍️',
    baseScore: 55,
    triggers: {
      keywords:  ['signature', 'unsigned', 'e-signature', 'esignature', 'missing signature'],
      docTypes:  [],
      roles:     ['QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 30 },
    contextBonus: { category: 'audit', bonus: 20 },
    params:       {},
  },

  // ── TIME-BASED RECOMMENDATIONS ───────────────────────────
  {
    id: 'REC-TIME-001',
    label: 'Recently Approved',
    description: 'Documents approved in the last 30 days',
    templateId: 'time_recently_approved',
    category: 'time',
    icon: '✨',
    baseScore: 40,
    triggers: {
      keywords:  ['recently approved', 'new approvals', 'approved this month'],
      docTypes:  [],
      roles:     ['ALL'],
    },
    roleBonus:    {},
    contextBonus: {},
    params:       { days_back: 30 },
  },
  {
    id: 'REC-TIME-002',
    label: 'Expiring in 90 Days',
    description: 'All documents with expiration dates in the next 90 days',
    templateId: 'time_expiring_documents',
    category: 'time',
    icon: '⏳',
    baseScore: 50,
    triggers: {
      keywords:  ['expir', 'renew', 'due', 'expiration'],
      docTypes:  [],
      roles:     ['QA_USER', 'QA_ADMIN'],
    },
    roleBonus:    { QA_ADMIN: 20, QA_USER: 15 },
    contextBonus: {},
    params:       { days_ahead: 90 },
    timeBonus:    { endOfQuarter: 25 },
  },
  {
    id: 'REC-TIME-003',
    label: 'All Recent Changes',
    description: 'Documents modified across all types in the last 30 days',
    templateId: 'time_last_30_days_changes',
    category: 'time',
    icon: '🕐',
    baseScore: 35,
    triggers: {
      keywords:  ['recent', 'changes', 'modified', 'updated'],
      docTypes:  [],
      roles:     ['ALL'],
    },
    roleBonus:    {},
    contextBonus: {},
    params:       { days_back: 30 },
  },

  // ── ROLE-SPECIFIC: REGULATORY USER ───────────────────────
  {
    id: 'REC-REG-001',
    label: 'Regulatory Submissions',
    description: 'All documents in submitted or accepted lifecycle states',
    templateId: 'doc_by_lifecycle_state',
    category: 'regulatory',
    icon: '🏛️',
    baseScore: 30,
    triggers: {
      keywords:  ['submission', 'submitted', 'regulatory'],
      docTypes:  [],
      roles:     ['REGULATORY_USER'],
    },
    roleBonus:    { REGULATORY_USER: 50 },
    contextBonus: {},
    params:       { lifecycle_state: 'submitted__v' },
  },

  // ── ROLE-SPECIFIC: CLINICAL USER ─────────────────────────
  {
    id: 'REC-CLIN-001',
    label: 'Study Protocols',
    description: 'All approved study protocols',
    templateId: 'doc_by_type',
    category: 'clinical',
    icon: '🧪',
    baseScore: 30,
    triggers: {
      keywords:  ['protocol', 'study', 'clinical', 'trial'],
      docTypes:  ['Protocol__c'],
      roles:     ['CLINICAL_USER'],
    },
    roleBonus:    { CLINICAL_USER: 50 },
    contextBonus: { docType: 'Protocol__c', bonus: 25 },
    params:       { type: 'Protocol__c' },
  },
];

// ─────────────────────────────────────────────────────────────
// SECTION 2: SCORING ENGINE
// Deterministic integer scoring — no floating point inference
// ─────────────────────────────────────────────────────────────

class RecommendationScorer {
  /**
   * Score a single recommendation for a given context.
   * @param {Object} rec         - Recommendation from catalog
   * @param {Object} context     - { userRole, keywords, activeDocType, dateContext }
   * @returns {number} Final deterministic score
   */
  score(rec, context) {
    let score = rec.baseScore;
    const scoreBreakdown = { base: rec.baseScore, keyword: 0, role: 0, docType: 0, time: 0 };

    // --- Keyword Bonus ---
    // +15 for each matching trigger keyword (capped at +45)
    if (context.keywords && rec.triggers.keywords) {
      let keywordBonus = 0;
      const contextKws = context.keywords.map(k => k.toLowerCase());
      for (const triggerKw of rec.triggers.keywords) {
        const triggerLower = triggerKw.toLowerCase();
        if (contextKws.some(ck => ck.includes(triggerLower) || triggerLower.includes(ck))) {
          keywordBonus = Math.min(keywordBonus + 15, 45);
        }
      }
      score += keywordBonus;
      scoreBreakdown.keyword = keywordBonus;
    }

    // --- Role Bonus ---
    // Fixed bonus per role from roleBonus map
    if (context.userRole && rec.roleBonus) {
      const bonus = rec.roleBonus[context.userRole] || 0;
      score += bonus;
      scoreBreakdown.role = bonus;
    }

    // --- Doc Type Context Bonus ---
    // If active doc type matches, apply context bonus
    if (context.activeDocType && rec.contextBonus && rec.contextBonus.docType) {
      if (context.activeDocType === rec.contextBonus.docType) {
        score += rec.contextBonus.bonus;
        scoreBreakdown.docType = rec.contextBonus.bonus;
      }
    }

    // --- Time-Based Bonus ---
    if (rec.timeBonus && context.dateContext) {
      if (rec.timeBonus.always) {
        score += rec.timeBonus.always;
        scoreBreakdown.time += rec.timeBonus.always;
      }
      if (rec.timeBonus.endOfQuarter && context.dateContext.isEndOfQuarter) {
        score += rec.timeBonus.endOfQuarter;
        scoreBreakdown.time += rec.timeBonus.endOfQuarter;
      }
      if (rec.timeBonus.endOfMonth && context.dateContext.isEndOfMonth) {
        score += rec.timeBonus.endOfMonth;
        scoreBreakdown.time += rec.timeBonus.endOfMonth;
      }
    }

    // --- Role Visibility Gate ---
    // If recommendation is role-restricted, zero out score for unauthorized roles
    const allowedRoles = rec.triggers.roles || [];
    if (!allowedRoles.includes('ALL') && context.userRole && !allowedRoles.includes(context.userRole)) {
      score = 0;  // Not visible to this role
    }

    return { finalScore: score, breakdown: scoreBreakdown };
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 3: DATE CONTEXT HELPER
// Provides deterministic time-based signals
// ─────────────────────────────────────────────────────────────

function buildDateContext() {
  const now = new Date();
  const month = now.getMonth() + 1;  // 1–12
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), month, 0).getDate();

  return {
    month,
    day,
    isEndOfMonth: day >= daysInMonth - 5,   // Last 5 days of month
    isEndOfQuarter: (
      (month === 3 || month === 6 || month === 9 || month === 12) &&
      day >= 20
    ),
    isStartOfMonth: day <= 5,
  };
}

// ─────────────────────────────────────────────────────────────
// SECTION 4: RECOMMENDATION ENGINE PUBLIC API
// ─────────────────────────────────────────────────────────────

const scorer = new RecommendationScorer();

/**
 * Generate ranked query recommendations.
 *
 * @param {Object} context - Recommendation context
 *   @param {string}   context.userRole       - 'QA_USER' | 'QA_ADMIN' | 'CLINICAL_USER' | 'REGULATORY_USER'
 *   @param {string[]} context.keywords        - Keywords extracted from current search or UI context
 *   @param {string}   context.activeDocType   - Currently active document type filter (optional)
 *   @param {number}   context.maxResults      - Max recommendations to return (default: 8)
 *   @param {boolean}  context.includeScores   - Include score breakdown in output (default: false)
 *
 * @returns {QueryRecommendation[]} Ranked recommendations
 */
function getRecommendations(context = {}) {
  const {
    userRole = null,
    keywords = [],
    activeDocType = null,
    maxResults = 8,
    includeScores = false,
  } = context;

  const dateContext = buildDateContext();
  const resolvedContext = { userRole, keywords, activeDocType, dateContext };

  // Score all recommendations
  const scored = RECOMMENDATION_CATALOG.map(rec => {
    const { finalScore, breakdown } = scorer.score(rec, resolvedContext);
    return {
      id: rec.id,
      label: rec.label,
      description: rec.description,
      templateId: rec.templateId,
      category: rec.category,
      icon: rec.icon,
      params: rec.params,
      score: finalScore,
      ...(includeScores ? { scoreBreakdown: breakdown } : {}),
    };
  });

  // Filter out zero-scored (role-gated) recommendations
  const visible = scored.filter(r => r.score > 0);

  // Sort by score descending (deterministic: ties broken by catalog order = id)
  visible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);  // Deterministic tiebreak
  });

  return visible.slice(0, maxResults);
}

/**
 * Get recommendations for a specific category.
 * @param {string} category - 'sop' | 'deviation' | 'capa' | 'audit' | 'time'
 * @param {Object} context  - Same as getRecommendations context
 * @returns {QueryRecommendation[]}
 */
function getRecommendationsByCategory(category, context = {}) {
  const all = getRecommendations({ ...context, maxResults: 100 });
  return all.filter(r => r.category === category);
}

/**
 * Get role-specific starter recommendations (for empty search state / initial UI load).
 * @param {string} userRole
 * @returns {QueryRecommendation[]}
 */
function getStarterRecommendations(userRole) {
  const ROLE_STARTERS = {
    QA_ADMIN: [
      'REC-SOP-001', 'REC-DEV-001', 'REC-CAPA-002',
      'REC-AUD-002', 'REC-AUD-004', 'REC-SOP-003',
    ],
    QA_USER: [
      'REC-SOP-001', 'REC-DEV-001', 'REC-CAPA-001',
      'REC-SOP-003', 'REC-TIME-001',
    ],
    CLINICAL_USER: [
      'REC-CLIN-001', 'REC-SOP-001', 'REC-TIME-001',
    ],
    REGULATORY_USER: [
      'REC-AUD-001', 'REC-AUD-002', 'REC-REG-001',
      'REC-SOP-001', 'REC-TIME-001',
    ],
    READ_ONLY: [
      'REC-SOP-001', 'REC-TIME-001',
    ],
    DEFAULT: [
      'REC-SOP-001', 'REC-DEV-001', 'REC-CAPA-001',
      'REC-AUD-001', 'REC-TIME-003',
    ],
  };

  const ids = ROLE_STARTERS[userRole] || ROLE_STARTERS.DEFAULT;
  const catalogMap = RECOMMENDATION_CATALOG.reduce((m, r) => { m[r.id] = r; return m; }, {});

  return ids
    .map(id => catalogMap[id])
    .filter(Boolean)
    .map(rec => ({
      id: rec.id,
      label: rec.label,
      description: rec.description,
      templateId: rec.templateId,
      category: rec.category,
      icon: rec.icon,
      params: rec.params,
    }));
}

/**
 * Sample output for QA_ADMIN with keyword "deviation":
 *
 * [
 *   { id: 'REC-DEV-001', label: 'Open Deviations', templateId: 'deviation_all_open',
 *     category: 'deviation', icon: '⚠️', score: 120 },
 *   { id: 'REC-DEV-002', label: 'Critical & Major Deviations', templateId: 'deviation_high_severity',
 *     category: 'deviation', icon: '🚨', score: 115 },
 *   { id: 'REC-CAPA-002', label: 'Overdue CAPAs', templateId: 'capa_overdue',
 *     category: 'capa', icon: '🔴', score: 105 },
 *   ...
 * ]
 */

module.exports = {
  getRecommendations,
  getRecommendationsByCategory,
  getStarterRecommendations,
  RECOMMENDATION_CATALOG,
  RecommendationScorer,
  buildDateContext,
};
