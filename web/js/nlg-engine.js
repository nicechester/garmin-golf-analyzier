// ── NLG Engine ────────────────────────────────────────────────────────────────
// Evaluates NLG_TEMPLATES against an analytics context object,
// ranks by severity + tier, and returns top N insights.

import { NLG_TEMPLATES } from './nlg-templates.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, positive: 2, info: 3 };

// Evaluate all templates against context, return ranked insights
export function generateInsights(ctx, maxInsights = 6) {
    if (!ctx) return [];

    const fired = [];
    for (const tpl of NLG_TEMPLATES) {
        try {
            if (tpl.condition(ctx)) {
                const msg = tpl.messages[Math.floor(Math.random() * tpl.messages.length)](ctx);
                fired.push({ code: tpl.code, severity: tpl.severity, tier: tpl.tier, message: msg });
            }
        } catch (_) { /* skip if data missing */ }
    }

    // Sort: tier first, then severity
    fired.sort((a, b) =>
        a.tier !== b.tier ? a.tier - b.tier :
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );

    // Cap: max 2 positives, rest critical/warning/info
    const positives = fired.filter(f => f.severity === 'positive').slice(0, 2);
    const others    = fired.filter(f => f.severity !== 'positive').slice(0, maxInsights - positives.length);
    return [...others, ...positives].slice(0, maxInsights);
}

const SEVERITY_ICON = {
    critical: '🔴', warning: '🟡', positive: '🟢', info: '🔵'
};

// Render insights as an HTML card
export function buildInsightsCard(ctx) {
    const insights = generateInsights(ctx, 7);
    if (!insights.length) return '';

    const items = insights.map(i => `
        <div class="flex gap-3 py-3 border-b border-gray-50 last:border-0">
            <span class="text-base flex-shrink-0 mt-0.5">${SEVERITY_ICON[i.severity]}</span>
            <p class="text-sm text-gray-700 leading-relaxed">${i.message}</p>
        </div>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Key Insights</h3>
        <p class="text-xs text-gray-400 mb-4">Rule-based analysis of your round</p>
        ${items}
    </div>`;
}

// Plain text version for AI prompt
export function buildInsightsText(ctx) {
    const insights = generateInsights(ctx, 10);
    if (!insights.length) return '';
    return insights.map(i => `[${i.severity.toUpperCase()}] ${i.message}`).join('\n');
}
