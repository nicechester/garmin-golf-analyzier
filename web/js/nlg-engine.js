// ── NLG Engine ────────────────────────────────────────────────────────────────
// Builds an analytics context from round data, evaluates all templates,
// ranks by severity + tier, and returns top N insights.

import { NLG_TEMPLATES } from './nlg-templates.js';

// Build the full analytics context object from round + computed data
export function buildAnalyticsContext(round, sg, clubStats) {
    const sc = round.scorecard;
    if (!sc) return null;

    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    // ── Scorecard metrics ────────────────────────────────────────────────────
    const holesPlayed = sc.hole_scores.length;
    const totalPutts  = sc.total_putts;
    const onePutts    = sc.hole_scores.filter(h => h.putts === 1).length;
    const threePutts  = sc.hole_scores.filter(h => h.putts >= 3).length;
    const firCount    = sc.hole_scores.filter(h => {
        const def = parMap[h.hole_number];
        return def?.par >= 4 && h.fairway_hit;
    }).length;
    const firHoles    = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) >= 4).length;
    const fir         = firHoles > 0 ? Math.round(firCount / firHoles * 100) : 0;

    const girCount    = sc.hole_scores.filter(h => {
        const par = parMap[h.hole_number]?.par ?? 0;
        return h.shots.length <= par - 2;
    }).length;
    const girPct      = Math.round(girCount / holesPlayed * 100);

    // Scrambling: missed GIR but made par or better
    const missedGir   = sc.hole_scores.filter(h => {
        const par = parMap[h.hole_number]?.par ?? 0;
        return h.shots.length > par - 2;
    });
    const scrambled   = missedGir.filter(h => {
        const par = parMap[h.hole_number]?.par ?? 0;
        return h.score <= par;
    }).length;
    const scramblingPct = missedGir.length > 0 ? Math.round(scrambled / missedGir.length * 100) : 100;

    // Front/back nine split
    const frontHoles  = sc.hole_scores.filter(h => h.hole_number <= 9);
    const backHoles   = sc.hole_scores.filter(h => h.hole_number > 9);
    const frontNineScore = frontHoles.length >= 8 ? frontHoles.reduce((a, h) => a + h.score, 0) : null;
    const backNineScore  = backHoles.length >= 8  ? backHoles.reduce((a, h) => a + h.score, 0)  : null;

    // Par type performance
    const par3Holes   = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 3);
    const par4Holes   = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 4);
    const par5Holes   = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 5);
    const avgOverPar  = (holes) => holes.length > 0
        ? holes.reduce((a, h) => a + (h.score - (parMap[h.hole_number]?.par ?? 0)), 0) / holes.length
        : null;
    const par3AvgOverPar = avgOverPar(par3Holes);
    const par4AvgOverPar = avgOverPar(par4Holes);
    const par5AvgOverPar = avgOverPar(par5Holes);

    // Consecutive bogeys
    let maxConsecutiveBogeys = 0, curStreak = 0;
    sc.hole_scores.forEach(h => {
        const par = parMap[h.hole_number]?.par ?? 0;
        if (h.score > par) { curStreak++; maxConsecutiveBogeys = Math.max(maxConsecutiveBogeys, curStreak); }
        else curStreak = 0;
    });

    // ── Health metrics ───────────────────────────────────────────────────────
    const health = round.health_timeline ?? [];
    const bbSamples = health.filter(s => s.body_battery != null).map(s => s.body_battery);
    const bbStart   = bbSamples[0] ?? null;
    const bbEnd     = bbSamples[bbSamples.length - 1] ?? null;
    const bbDrain   = bbStart != null && bbEnd != null ? bbStart - bbEnd : null;

    const stressSamples = health.filter(s => s.stress_proxy != null && s.stress_proxy > 0).map(s => s.stress_proxy);
    const avgStress = stressSamples.length
        ? Math.round(stressSamples.reduce((a, b) => a + b, 0) / stressSamples.length)
        : null;

    // HR split: first half vs second half of round
    const hrSamples = health.filter(s => s.heart_rate != null);
    const mid = Math.floor(hrSamples.length / 2);
    const earlyRoundHr = mid > 0
        ? hrSamples.slice(0, mid).reduce((a, s) => a + s.heart_rate, 0) / mid
        : null;
    const lateRoundHr = mid > 0
        ? hrSamples.slice(mid).reduce((a, s) => a + s.heart_rate, 0) / (hrSamples.length - mid)
        : null;

    // ── Club stats ───────────────────────────────────────────────────────────
    const worstClub = clubStats?.length
        ? [...clubStats].sort((a, b) => a.avgSg - b.avgSg)[0]
        : null;
    const bestClub = clubStats?.length
        ? [...clubStats].sort((a, b) => b.avgSg - a.avgSg)[0]
        : null;
    const driverClub = clubStats?.find(c =>
        c.name.toLowerCase().includes('driver') || c.name.toLowerCase() === 'dr'
    ) ?? null;
    const wedgeClub = clubStats?.length
        ? clubStats.filter(c => ['pw','gw','sw','lw','wedge'].some(w =>
            c.name.toLowerCase().includes(w))).sort((a, b) => b.shots - a.shots)[0] ?? null
        : null;

    // Iron bias: avg deviation across all iron shots
    const ironShots = sg?.shots?.filter(s =>
        s.cat === 'approach' || s.cat === 'off_tee'
    ) ?? [];
    // We need dev from clubStats for irons
    const ironClubs = clubStats?.filter(c => {
        const n = c.name.toLowerCase();
        return /\d-iron|iron/.test(n) || ['2i','3i','4i','5i','6i','7i','8i','9i'].includes(n);
    }) ?? [];
    const ironBias = ironClubs.length
        ? ironClubs.reduce((a, c) => a + c.avgDev * c.shots, 0) /
          ironClubs.reduce((a, c) => a + c.shots, 0)
        : null;

    // ── Dispersion: find most-played distance bucket ─────────────────────────
    const buckets = [
        { label: '101–150 yds', min: 101, max: 150 },
        { label: '151–200 yds', min: 151, max: 200 },
        { label: '51–100 yds',  min: 51,  max: 100 },
        { label: '0–50 yds',    min: 0,   max: 50  },
        { label: '200+ yds',    min: 201, max: 999  },
    ];
    let approachDispersion = null;
    if (sc?.hole_scores?.length) {
        for (const bucket of buckets) {
            const shots = [];
            sc.hole_scores.forEach(hs => {
                const holeShots = hs.shots;
                if (!holeShots.length) return;
                const green = holeShots[holeShots.length - 1].to;
                holeShots.forEach(shot => {
                    if ((shot.club_category ?? '') === 'putt') return;
                    const d = metersToYards(distMeters(shot.from, green));
                    if (d >= bucket.min && d <= bucket.max) {
                        const ideal = d;
                        const actual = metersToYards(distMeters(shot.from, shot.to));
                        const pctDelta = ideal > 0 ? (actual - ideal) / ideal * 100 : 0;
                        shots.push(pctDelta);
                    }
                });
            });
            if (shots.length >= 3) {
                const shortCount = shots.filter(p => p < -5).length;
                const longCount  = shots.filter(p => p > 5).length;
                approachDispersion = {
                    label: bucket.label,
                    shortPct: Math.round(shortCount / shots.length * 100),
                    longPct:  Math.round(longCount  / shots.length * 100),
                    count: shots.length,
                };
                break;
            }
        }
    }

    // Overall dispersion angle
    const allDevs = clubStats?.flatMap(c =>
        Array(c.shots).fill(Math.abs(c.avgDev))
    ) ?? [];
    const overallDispersionAngle = allDevs.length
        ? allDevs.reduce((a, b) => a + b, 0) / allDevs.length
        : null;

    return {
        round, sc, sg,
        // scorecard
        holesPlayed, totalPutts, onePutts, threePutts,
        fir, girPct, scramblingPct,
        frontNineScore, backNineScore,
        par3AvgOverPar, par4AvgOverPar, par5AvgOverPar,
        maxConsecutiveBogeys,
        // health
        bbStart, bbEnd, bbDrain, avgStress, earlyRoundHr, lateRoundHr,
        // round summary
        durationMin: Math.round(round.duration_seconds / 60),
        distanceKm: +(round.distance_meters / 1000).toFixed(2),
        altRange: round.max_altitude_meters != null
            ? round.max_altitude_meters - round.min_altitude_meters : null,
        avgTempo: round.avg_swing_tempo ?? null,
        // clubs
        clubStats, worstClub, bestClub, driverClub, wedgeClub, ironBias,
        // dispersion
        approachDispersion, overallDispersionAngle,
    };
}

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
