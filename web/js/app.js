import { invoke } from '@tauri-apps/api/core';
import { buildInsightsCard, buildInsightsText, generateInsights } from './nlg-engine.js';

const PAGE_SIZE = 10;

const state = {
    rounds: [],
    activeId: null,
    activeTab: 'overview',  // 'overview' | 'shotmap' | 'stats' | 'sg'
    searchTerm: '',
    syncOffset: 0,
    syncing: false,
    activeRound: null,      // full GolfRound for current detail
};

// ── Tauri commands ───────────────────────────────────────────────────────────

async function syncRounds(count, offset) {
    return invoke('sync_rounds', { count, offset });
}

async function getAllRounds() {
    return invoke('get_all_rounds');
}

async function getRoundDetail(id) {
    return invoke('get_round_detail', { id });
}

async function getStoreStats() {
    return invoke('get_store_stats');
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm z-50 ${
        isError ? 'bg-red-700' : 'bg-gray-800'} text-white`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3500);
}

function scoreClass(overPar) {
    if (overPar <= -1) return 'score-under';
    if (overPar === 0) return 'score-even';
    if (overPar <= 2)  return 'score-bogey';
    return 'score-over';
}

function holeRowClass(score, par) {
    const d = score - par;
    if (d <= -2) return 'hole-eagle';
    if (d === -1) return 'hole-birdie';
    if (d === 0)  return 'hole-par';
    if (d === 1)  return 'hole-bogey';
    return 'hole-double';
}

function overParStr(v) {
    if (v === 0) return 'E';
    return v > 0 ? `+${v}` : `${v}`;
}

function fmtAlt(min, max) {
    if (min == null || max == null) return null;
    return `${Math.round(min)}–${Math.round(max)} m`;
}

function fmtTempo(ratio) {
    if (ratio == null) return null;
    return `${ratio.toFixed(1)}:1`;
}

// ── Rounds list ──────────────────────────────────────────────────────────────

function renderRoundsList() {
    const list = document.getElementById('rounds-list');
    const filtered = state.rounds.filter(r =>
        !state.searchTerm ||
        r.course_name.toLowerCase().includes(state.searchTerm) ||
        r.date.includes(state.searchTerm)
    );

    const items = filtered.map(r => {
        const alt   = fmtAlt(r.min_altitude_meters, r.max_altitude_meters);
        const tempo = fmtTempo(r.avg_swing_tempo);
        return `
        <div class="round-item ${r.id === state.activeId ? 'active' : ''}" data-id="${r.id}">
            <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm text-gray-800 truncate">${r.course_name || 'Unknown Course'}</div>
                    <div class="text-xs text-gray-500">${r.date} · ${r.holes_played}H · ${r.duration_minutes}min</div>
                </div>
                <div class="ml-2 flex flex-col items-center">
                    <div class="score-badge ${scoreClass(r.score_over_par)}">${r.total_score || '—'}</div>
                    <div class="text-xs text-gray-500 mt-0.5">${r.total_score ? overParStr(r.score_over_par) : ''}</div>
                </div>
            </div>
            ${r.total_score ? `
            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>${r.total_putts}p</span>
                <span>${r.gir}/${r.holes_played} GIR</span>
                <span>${r.avg_heart_rate || '—'} bpm</span>
                ${alt   ? `<span>${alt}</span>` : ''}
                ${tempo ? `<span>Tempo ${tempo}</span>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');

    const moreBtn = `
        <button id="load-more-btn"
            class="w-full mt-2 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition">
            Load 10 more...
        </button>`;

    list.innerHTML = filtered.length === 0
        ? '<p class="text-gray-400 text-sm text-center mt-8">No rounds found.</p>'
        : items + moreBtn;

    list.querySelectorAll('.round-item').forEach(el => {
        el.addEventListener('click', () => loadDetail(el.dataset.id));
    });

    document.getElementById('load-more-btn')?.addEventListener('click', handleLoadMore);
}

// ── Round detail ─────────────────────────────────────────────────────────────

async function loadDetail(id) {
    // If same round, just switch tab rendering — no re-fetch
    if (state.activeRound?.id === id) {
        renderDetailTabs();
        return;
    }

    state.activeId    = id;
    state.activeTab   = 'overview';
    state.activeRound = null;
    renderRoundsList();

    const content = document.getElementById('detail-content');
    const empty   = document.getElementById('detail-empty');
    content.classList.remove('hidden');
    empty.classList.add('hidden');

    // Show tab bar immediately with a loading placeholder in the content area
    content.innerHTML = `
        <div class="flex border-b bg-white sticky top-0 z-10 pt-4 mb-4">
            <button class="detail-tab active" data-tab="overview">Overview</button>
            <button class="detail-tab" data-tab="shotmap">Shot Map</button>
            <button class="detail-tab" data-tab="stats">Course Stats</button>
        </div>
        <div class="text-center text-gray-400 py-12">Loading...</div>`;

    try {
        const round = await getRoundDetail(id);
        if (!round) { content.innerHTML = '<p class="text-red-500">Round not found.</p>'; return; }
        state.activeRound = round;
        renderDetailTabs();
    } catch (e) {
        content.innerHTML = `<p class="text-red-500">Error: ${e}</p>`;
    }
}

function renderDetailTabs() {
    const round   = state.activeRound;
    const content = document.getElementById('detail-content');
    if (!round) return;

    const sc = round.scorecard;
    const dt = new Date((round.start_ts + 631065600) * 1000);
    const dateStr = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const timeStr = dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'shotmap',  label: 'Shot Map' },
        { id: 'stats',    label: 'Course Stats' },
        { id: 'sg',       label: 'Shot Analysis' },
    ];

    const tabBar = `
    <div class="flex items-center border-b bg-white sticky top-0 z-10 pt-4 mb-4">
        <div class="flex flex-1">
        ${tabs.map(t => `
        <button class="detail-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
            ${t.label}
        </button>`).join('')}
        </div>
        <button id="ask-ai-btn"
            class="mr-4 mb-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-300
                   text-purple-700 hover:bg-purple-50 transition flex items-center gap-1.5">
            <span>✨</span> Ask AI
        </button>
    </div>`;

    let tabContent = '';
    if (state.activeTab === 'overview') {
        tabContent = `
            ${buildHeader(round, sc, dateStr, timeStr)}
            ${sc ? buildScorecard(sc) : ''}
            ${buildHealth(round)}
            ${buildHrZones(round)}`;
    } else if (state.activeTab === 'shotmap') {
        tabContent = buildShotMap(round);
    } else if (state.activeTab === 'stats') {
        tabContent = buildCourseStats(round);
    } else if (state.activeTab === 'sg') {
        tabContent = buildStrokesGainedTab(round);
    }

    content.innerHTML = tabBar + `<div class="space-y-6 pb-6">${tabContent}</div>`;

    // Wire tab buttons — no re-fetch, just re-render
    content.querySelectorAll('.detail-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.activeTab === btn.dataset.tab) return;
            state.activeTab = btn.dataset.tab;
            renderDetailTabs();
        });
    });

    // Ask AI button
    document.getElementById('ask-ai-btn')?.addEventListener('click', async () => {
        const prompt = buildAiPrompt(round);
        await navigator.clipboard.writeText(prompt);
        toast('Prompt copied! Paste it on gemini.google.com or chatgpt.com');
    });

    // Post-render hooks
    if (state.activeTab === 'overview') {
        // no chart in overview anymore
    } else if (state.activeTab === 'shotmap') {
        requestAnimationFrame(() => renderShotMap(round));
    }
}

function buildHeader(round, sc, dateStr, timeStr) {
    const alt   = fmtAlt(round.min_altitude_meters, round.max_altitude_meters);
    const tempo = fmtTempo(round.avg_swing_tempo);
    // Use scored_par (holes played) not total_par (full course)
    const parMap    = sc ? Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h])) : {};
    const scoredPar = sc ? sc.hole_scores.reduce((s, hs) => s + (parMap[hs.hole_number]?.par ?? 0), 0) : 0;
    const overPar   = sc ? sc.total_score - scoredPar : 0;
    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <div class="flex items-start justify-between">
            <div>
                <h2 class="text-2xl font-bold text-gray-800">${sc?.course_name || 'Golf Round'}</h2>
                <p class="text-gray-500 mt-1">${dateStr} · ${timeStr}</p>
                ${sc ? `<p class="text-sm text-gray-400 mt-0.5">${sc.tee_color} Tees · Rating ${sc.course_rating} · Slope ${sc.slope}</p>` : ''}
            </div>
            ${sc ? `
            <div class="text-center">
                <div class="score-badge ${scoreClass(overPar)} w-16 h-16 text-2xl">${sc.total_score}</div>
                <div class="text-sm font-medium mt-1 ${overPar > 0 ? 'text-red-600' : 'text-green-600'}">
                    ${overParStr(overPar)}
                </div>
            </div>` : ''}
        </div>
        <div class="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${Math.round(round.duration_seconds / 60)}</div>
                <div class="text-xs text-gray-500">Minutes</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${(round.distance_meters / 1000).toFixed(2)}</div>
                <div class="text-xs text-gray-500">km walked</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${round.avg_heart_rate || '—'}</div>
                <div class="text-xs text-gray-500">Avg HR</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${round.calories || '—'}</div>
                <div class="text-xs text-gray-500">Calories</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${alt || '—'}</div>
                <div class="text-xs text-gray-500">Altitude</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-lg font-bold text-gray-800">${tempo || '—'}</div>
                <div class="text-xs text-gray-500">Avg Tempo</div>
            </div>
        </div>
        ${round.total_ascent != null ? `
        <div class="mt-3 flex gap-4 text-xs text-gray-500 justify-center">
            <span>Ascent: ${round.total_ascent} m</span>
            <span>Descent: ${round.total_descent} m</span>
        </div>` : ''}
    </div>`;
}

// ── Timeline chart ───────────────────────────────────────────────────────────

let activeChart = null;
let activeHoleMarkers = []; // shared between renderTimelineChart and zoomTimeline
let activeTimelinePts = []; // health samples used in chart (downsampled)
const GARMIN_EPOCH = 631065600;

function buildTimeline(round) {
    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Round Timeline</h3>
        <p class="text-xs text-gray-400 mb-4">Heart rate, altitude and stress over time. Vertical lines mark hole transitions.</p>
        <div class="relative" style="height:260px">
            <canvas id="timeline-chart"></canvas>
        </div>
    </div>`;
}

function renderTimelineChart(round) {
    const canvas = document.getElementById('timeline-chart');
    if (!canvas) return;
    if (activeChart) { activeChart.destroy(); activeChart = null; }



    // Downsample to max 300 points
    const samples = round.health_timeline;
    const step = Math.max(1, Math.floor(samples.length / 300));
    const pts = samples.filter((_, i) => i % step === 0);
    activeTimelinePts = pts; // store for shot indicator

    const labels     = pts.map(s => {
        const d = new Date((s.timestamp + GARMIN_EPOCH) * 1000);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    });
    const hrData     = pts.map(s => s.heart_rate ?? null);
    const altData    = pts.map(s => s.altitude_meters != null ? +s.altitude_meters.toFixed(1) : null);
    const stressData = pts.map(s => s.stress_proxy ?? null);

    // Build tempo data — sparse samples mapped onto the health timeline index
    const tempoData = new Array(pts.length).fill(null);
    (round.tempo_timeline ?? []).forEach(t => {
        let closestIdx = 0, closestDiff = Infinity;
        pts.forEach((s, i) => {
            const diff = Math.abs(s.timestamp - t.timestamp);
            if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
        });
        tempoData[closestIdx] = +t.ratio.toFixed(2);
    });

    // Build hole markers and store in shared variable
    activeHoleMarkers = [];
    const sc = round.scorecard;
    if (sc?.hole_scores?.length > 0 && round.shots?.length > 0) {
        const sortedHoles = [...sc.hole_scores].sort((a, b) => a.hole_number - b.hole_number);
        let minTimestamp = -Infinity;

        sortedHoles.forEach(hs => {
            if (!hs.shots?.length) return;
            const shotFrom = hs.shots[0].from;
            // Find best matching activity shot after previous hole, within GPS proximity
            let best = null, bestDist = Infinity;
            for (const shot of round.shots) {
                if (!shot.position || shot.timestamp <= minTimestamp) continue;
                const d = (shot.position.lat - shotFrom.lat) ** 2
                        + (shot.position.lon - shotFrom.lon) ** 2;
                if (d < bestDist) { bestDist = d; best = shot; }
            }
            if (!best) return;
            minTimestamp = best.timestamp;

            // Find the closest label index by timestamp
            const shotUnix = best.timestamp + GARMIN_EPOCH;
            let closestIdx = 0, closestDiff = Infinity;
            pts.forEach((s, i) => {
                const diff = Math.abs((s.timestamp + GARMIN_EPOCH) - shotUnix);
                if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
            });
            activeHoleMarkers.push({ index: closestIdx, label: `H${hs.hole_number}` });
        });
    }

    // Inline plugin: hole markers + shot indicator
    let shotIndicatorIdx = null;
    const holeLinePlugin = {
        id: 'holeLines',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            // Hole markers
            activeHoleMarkers.forEach(({ index, label }) => {
                const xPos = x.getPixelForValue(index);
                if (xPos < x.left || xPos > x.right) return;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(xPos, top);
                ctx.lineTo(xPos, bottom);
                ctx.strokeStyle = 'rgba(99,102,241,0.55)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '9px sans-serif';
                ctx.fillStyle = '#6366f1';
                ctx.textAlign = 'center';
                ctx.fillText(label, xPos, top + 10);
                ctx.restore();
            });
            // Shot indicator — yellow diamond
            if (shotIndicatorIdx !== null) {
                const xPos = x.getPixelForValue(shotIndicatorIdx);
                if (xPos >= x.left && xPos <= x.right) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xPos, top);
                    ctx.lineTo(xPos, bottom);
                    ctx.strokeStyle = 'rgba(234,179,8,0.9)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.fillStyle = 'rgb(234,179,8)';
                    ctx.beginPath();
                    ctx.moveTo(xPos,     top + 4);
                    ctx.lineTo(xPos + 5, top + 9);
                    ctx.lineTo(xPos,     top + 14);
                    ctx.lineTo(xPos - 5, top + 9);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }
        }
    };
    // Expose so showShotOnTimeline can trigger a redraw
    window._setShotIndicator = (idx) => {
        shotIndicatorIdx = idx;
        if (activeChart) activeChart.draw();
    };

    activeChart = new Chart(canvas, {
        type: 'line',
        plugins: [holeLinePlugin],
        data: {
            labels,
            datasets: [
                {
                    label: 'HR (bpm)',
                    data: hrData,
                    borderColor: 'rgb(239,68,68)',
                    backgroundColor: 'rgba(239,68,68,0.07)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yHr',
                    spanGaps: true,
                },
                {
                    label: 'Altitude (m)',
                    data: altData,
                    borderColor: 'rgb(59,130,246)',
                    backgroundColor: 'rgba(59,130,246,0.07)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yAlt',
                    spanGaps: true,
                },
                {
                    label: 'Stress',
                    data: stressData,
                    borderColor: 'rgb(249,115,22)',
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0.3,
                    yAxisID: 'yHr',
                    borderDash: [4, 2],
                    spanGaps: true,
                },
                {
                    label: 'Tempo (ratio)',
                    data: tempoData,
                    borderColor: 'rgb(16,185,129)',
                    backgroundColor: 'rgb(16,185,129)',
                    borderWidth: 0,
                    pointRadius: tempoData.map(v => v !== null ? 5 : 0),
                    pointStyle: 'circle',
                    showLine: false,
                    yAxisID: 'yTempo',
                    spanGaps: false,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { title: items => items[0].label } },
            },
            scales: {
                x: {
                    type: 'category',
                    title: { display: true, text: 'Time of day', font: { size: 11 } },
                    ticks: { font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 },
                },
                yHr: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'HR / Stress', font: { size: 11 } },
                    ticks: { font: { size: 10 } },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                },
                yAlt: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Altitude (m)', font: { size: 11 } },
                    ticks: { font: { size: 10 } },
                    grid: { drawOnChartArea: false },
                },
                yTempo: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Tempo', font: { size: 11 } },
                    ticks: { font: { size: 10 }, callback: v => `${v.toFixed(1)}:1` },
                    grid: { drawOnChartArea: false },
                    min: 1.5,
                    max: 6.0,
                },
            }
        }
    });
}

// Show a shot's position on the timeline chart as a yellow indicator.
function showShotOnTimeline(shot) {
    if (!shot.timestamp || !activeTimelinePts.length) return;
    let closestIdx = 0, closestDiff = Infinity;
    activeTimelinePts.forEach((s, i) => {
        const diff = Math.abs(s.timestamp - shot.timestamp);
        if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
    });
    if (window._setShotIndicator) window._setShotIndicator(closestIdx);
}

function clearShotIndicator() {
    if (window._setShotIndicator) window._setShotIndicator(null);
}

// Zoom the timeline chart to a hole's time window, or reset to full round.
function zoomTimeline(holeFilter) {
    if (!activeChart) return;
    const xScale = activeChart.options.scales.x;

    if (holeFilter === 'all') {
        xScale.min = undefined;
        xScale.max = undefined;
        activeChart.update();
        return;
    }

    const holeNum = parseInt(holeFilter);
    const idx = activeHoleMarkers.findIndex(m => m.label === `H${holeNum}`);
    if (idx === -1) return;

    const startIdx = activeHoleMarkers[idx].index;
    const endIdx = idx + 1 < activeHoleMarkers.length
        ? activeHoleMarkers[idx + 1].index
        : activeChart.data.labels.length - 1;

    const buffer = Math.max(2, Math.round((endIdx - startIdx) * 0.1));
    xScale.min = Math.max(0, startIdx - buffer);
    xScale.max = Math.min(activeChart.data.labels.length - 1, endIdx + buffer);
    activeChart.update();
}

function buildScorecard(sc) {
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));
    // Sum par only for holes actually played
    const scoredPar = sc.hole_scores.reduce((sum, hs) => sum + (parMap[hs.hole_number]?.par ?? 0), 0);
    const rows = sc.hole_scores.map(hs => {
        const def  = parMap[hs.hole_number];
        const par  = def?.par || 0;
        const dist = def ? Math.round(def.distance_cm / 91.44) : '—';
        const diff = hs.score - par;
        const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
        return `
        <tr class="${holeRowClass(hs.score, par)}">
            <td class="font-medium">${hs.hole_number}</td>
            <td class="text-gray-500">${par}</td>
            <td class="text-gray-400 text-xs">${def?.handicap || '—'}</td>
            <td class="text-gray-400 text-xs">${dist}</td>
            <td class="font-bold">${hs.score} <span class="text-xs font-normal text-gray-500">(${diffStr})</span></td>
            <td>${hs.putts}</td>
            <td>${par === 3 ? '—' : (hs.fairway_hit ? '✓' : '✗')}</td>
            <td class="text-xs text-gray-400">${hs.shots.length}</td>
        </tr>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">Scorecard</h3>
        <div class="grid grid-cols-4 gap-4 mb-4 text-center">
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-700">${sc.total_putts}</div>
                <div class="text-xs text-gray-500">Putts</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-700">${sc.gir}/${sc.hole_scores.length}</div>
                <div class="text-xs text-gray-500">GIR</div>
            </div>
            <div class="bg-yellow-50 rounded-lg p-3">
                <div class="text-xl font-bold text-yellow-700">${sc.fairways_hit}</div>
                <div class="text-xs text-gray-500">Fairways Hit</div>
            </div>
            <div class="bg-purple-50 rounded-lg p-3">
                <div class="text-xl font-bold text-purple-700">${sc.hole_scores.length}</div>
                <div class="text-xs text-gray-500">Holes</div>
            </div>
        </div>
        <div class="overflow-x-auto">
            <table class="hole-table w-full text-sm">
                <thead>
                    <tr><th>Hole</th><th>Par</th><th>Hdcp</th><th>Yds</th><th>Score</th><th>Putts</th><th>FW</th><th>Shots</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="font-bold bg-gray-50">
                        <td>Total</td><td>${scoredPar}</td><td></td><td></td>
                        <td>${sc.total_score} (${overParStr(sc.total_score - scoredPar)})</td>
                        <td>${sc.total_putts}</td><td></td><td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
}

function buildHealth(round) {
    const bbSamples = round.health_timeline.filter(s => s.body_battery != null).map(s => s.body_battery);
    const bbStart = bbSamples[0];
    const bbEnd   = bbSamples[bbSamples.length - 1];
    const stressSamples = round.health_timeline.filter(s => s.stress_proxy != null && s.stress_proxy > 0).map(s => s.stress_proxy);
    const avgStress  = stressSamples.length ? Math.round(stressSamples.reduce((a,b) => a+b, 0) / stressSamples.length) : null;
    const peakStress = stressSamples.length ? Math.max(...stressSamples) : null;

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">Health During Round</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-xl font-bold text-red-600">${round.avg_heart_rate || '—'} / ${round.max_heart_rate || '—'}</div>
                <div class="text-xs text-gray-500">Avg / Max HR (bpm)</div>
            </div>
            ${bbStart != null ? `
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${bbStart}% → ${bbEnd}%</div>
                <div class="text-xs text-gray-500">Body Battery (−${bbStart - bbEnd}%)</div>
            </div>` : '<div></div>'}
            ${avgStress != null ? `
            <div class="bg-orange-50 rounded-lg p-3">
                <div class="text-xl font-bold text-orange-600">${avgStress} / ${peakStress}</div>
                <div class="text-xs text-gray-500">Avg / Peak Stress</div>
            </div>` : '<div></div>'}
        </div>
    </div>`;
}

function buildHrZones(round) {
    const MAX_HR = 185;
    const zones = [
        { name: 'Z1 Recovery',  color: 'bg-blue-300',   min: 0,    max: 0.50 },
        { name: 'Z2 Aerobic',   color: 'bg-green-400',  min: 0.50, max: 0.60 },
        { name: 'Z3 Tempo',     color: 'bg-yellow-400', min: 0.60, max: 0.70 },
        { name: 'Z4 Threshold', color: 'bg-orange-400', min: 0.70, max: 0.80 },
        { name: 'Z5 Anaerobic', color: 'bg-red-500',    min: 0.80, max: 1.00 },
    ];
    const counts = zones.map(z => ({
        ...z,
        count: round.health_timeline.filter(s => {
            if (!s.heart_rate) return false;
            const pct = s.heart_rate / MAX_HR;
            return pct >= z.min && pct < z.max;
        }).length
    }));
    const total = counts.reduce((a, b) => a + b.count, 0);
    if (total === 0) return '';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">HR Zones</h3>
        <div class="space-y-2">
        ${counts.map(z => {
            const pct  = (z.count / total * 100).toFixed(1);
            const mins = Math.round(z.count / 12);
            return `
            <div class="flex items-center gap-3">
                <div class="w-28 text-xs text-gray-600">${z.name}</div>
                <div class="flex-1 bg-gray-100 rounded-full h-2">
                    <div class="${z.color} zone-bar" style="width:${pct}%"></div>
                </div>
                <div class="w-20 text-xs text-gray-500 text-right">${pct}% (~${mins}min)</div>
            </div>`;
        }).join('')}
        </div>
    </div>`;
}

// ── Shot Map ─────────────────────────────────────────────────────────────────

let activeMap = null;

function buildShotMap(round) {
    const sc = round.scorecard;
    const holes = sc?.hole_scores ?? [];

    // Hole selector buttons
    const holeButtons = holes.map(hs => `
        <button class="hole-btn px-3 py-1 text-xs rounded-full border border-gray-300
            hover:bg-blue-50 hover:border-blue-400 transition" data-hole="${hs.hole_number}">
            H${hs.hole_number}
        </button>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-700">Shot Map</h3>
            <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400">Hole:</span>
                <button class="hole-btn px-3 py-1 text-xs rounded-full bg-blue-600 text-white border border-blue-600"
                    data-hole="all">All</button>
                ${holeButtons}
            </div>
        </div>
        <div id="shot-map-wrapper">
            <div id="shot-map"></div>
        </div>
        <div class="mt-3 flex items-center justify-between">
            <div id="shot-legend" class="flex flex-wrap gap-3 text-xs text-gray-500"></div>
            <button id="trail-toggle" class="px-3 py-1 text-xs rounded-full border border-gray-300
                hover:bg-gray-50 transition flex items-center gap-1">
                <span id="trail-icon">👣</span> Trail
            </button>
        </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Round Timeline</h3>
        <p class="text-xs text-gray-400 mb-4">Select a hole above to zoom in. HR, altitude and stress over time.</p>
        <div class="relative" style="height:240px">
            <canvas id="timeline-chart"></canvas>
        </div>
    </div>`;
}

// Mini HR sparkline for shot popups — shows ±5 min of HR around the shot timestamp
function hrSparkline(shot, healthTimeline) {
    if (!shot.timestamp || !healthTimeline?.length) return '';
    const W = 120, H = 32, PAD = 2;
    const windowSec = 300; // ±5 min
    const pts = healthTimeline.filter(s =>
        s.heart_rate != null &&
        Math.abs(s.timestamp - shot.timestamp) <= windowSec
    );
    if (pts.length < 3) return '';
    const hrs = pts.map(s => s.heart_rate);
    const minHr = Math.min(...hrs), maxHr = Math.max(...hrs);
    const range = maxHr - minHr || 1;
    const xStep = (W - PAD * 2) / (pts.length - 1);
    const toY = v => PAD + (H - PAD * 2) * (1 - (v - minHr) / range);
    const line = pts.map((s, i) => `${PAD + i * xStep},${toY(s.heart_rate)}`).join(' ');
    // Shot position marker
    let markerX = null;
    let closestDiff = Infinity;
    pts.forEach((s, i) => {
        const d = Math.abs(s.timestamp - shot.timestamp);
        if (d < closestDiff) { closestDiff = d; markerX = PAD + i * xStep; }
    });
    const marker = markerX != null
        ? `<line x1="${markerX}" y1="0" x2="${markerX}" y2="${H}" stroke="#facc15" stroke-width="1.5"/>`
        : '';
    return `<svg width="${W}" height="${H}" style="display:block;margin:4px 0 0">
        <polyline points="${line}" fill="none" stroke="#ef4444" stroke-width="1.5"/>
        ${marker}
        <text x="1" y="9" font-size="8" fill="#999">${maxHr}</text>
        <text x="1" y="${H - 1}" font-size="8" fill="#999">${minHr}</text>
    </svg>`;
}

// Direction arrow SVG — traffic-signal style (left / straight / right)
function dirArrowSvg(dev) {
    const abs = Math.abs(dev);
    let arrow, label, bg;
    if (abs < 15) {
        arrow = `<polygon points="20,6 28,22 12,22" fill="white"/>`; // up arrow
        label = 'Straight';
        bg = '#22c55e'; // green
    } else {
        const isFar = abs > 30;
        bg = isFar ? '#ef4444' : '#eab308'; // red or yellow
        label = (dev > 0 ? (isFar ? 'Far R' : 'Right') : (isFar ? 'Far L' : 'Left'));
        if (dev > 0) {
            arrow = `<polygon points="28,14 14,6 14,22" fill="white"/>`; // right arrow
        } else {
            arrow = `<polygon points="12,14 26,6 26,22" fill="white"/>`; // left arrow
        }
    }
    return `<div style="text-align:center">
        <svg width="40" height="28" style="display:block;margin:0 auto">
            <rect width="40" height="28" rx="6" fill="${bg}"/>
            ${arrow}
        </svg>
        <div style="font-size:9px;color:#666;margin-top:2px">${label}</div>
    </div>`;
}

const CLUB_COLORS = {
    tee:          '#ef4444',  // red
    fairway_wood: '#f97316',  // orange
    iron:         '#3b82f6',  // blue
    wedge:        '#8b5cf6',  // purple
    putt:         '#10b981',  // green
    unknown:      '#9ca3af',  // gray
};

function renderShotMap(round) {
    const mapEl = document.getElementById('shot-map');
    if (!mapEl) return;

    // Destroy previous map instance
    if (activeMap) { activeMap.remove(); activeMap = null; }

    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) {
        mapEl.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">No shot data available.</p>';
        return;
    }

    // Collect all shot positions to compute map bounds
    const allShots = sc.hole_scores.flatMap(hs =>
        hs.shots.map(s => ({ ...s, hole_number: hs.hole_number, score: hs.score }))
    );
    if (!allShots.length) return;

    const lats = allShots.flatMap(s => [s.from.lat, s.to.lat]);
    const lons = allShots.flatMap(s => [s.from.lon, s.to.lon]);
    const bounds = [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
    ];

    // Init Leaflet map — scroll zoom disabled, only +/- buttons
    activeMap = L.map('shot-map', {
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
    }).fitBounds(bounds, { padding: [30, 30] });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        maxNativeZoom: 19,
    }).addTo(activeMap);

    // Invalidate map size on window resize to maintain aspect ratio
    const resizeObserver = new ResizeObserver(() => activeMap?.invalidateSize());
    resizeObserver.observe(document.getElementById('shot-map-wrapper'));

    // Layer groups per hole for filtering
    const holeLayers = {};
    const holeLabelLayers = {}; // club abbr + distance labels, shown only when zoomed to a hole
    sc.hole_scores.forEach(hs => {
        holeLayers[hs.hole_number] = L.layerGroup().addTo(activeMap);
        holeLabelLayers[hs.hole_number] = L.layerGroup(); // not added yet
    });

    // Club abbreviation helper
    function clubAbbr(shot) {
        const name = shot.club_name ?? '';
        const cat  = shot.club_category ?? '';
        if (cat === 'putt') return 'P';
        if (!name) return cat.slice(0,1).toUpperCase();
        const m = name.match(/^(\d+)[-\s]?(Wood|Iron)/i);
        if (m) return (name.toLowerCase().includes('iron') ? 'I' : 'W') + m[1];
        if (name.length <= 3) return name;
        if (name === 'Driver') return 'Dr';
        if (name === 'Hybrid') return 'H';
        return name.slice(0, 2);
    }

    // Draw shots (including putts)
    // Build per-hole shot index for putt count lookup
    const holePutts = {};
    sc.hole_scores.forEach(hs => { holePutts[hs.hole_number] = hs.putts; });

    // Pre-compute SG lookup for shot popups
    const sgLookup = buildSgLookup(round);
    const holeShotIdx = {}; // track per-hole shot index for SG key

    // Pre-compute hole bearing (tee→green) per hole — matches Course Stats deviation calc
    const holeBearings = {};
    sc.hole_scores.forEach(hs => {
        if (!hs.shots.length) return;
        holeBearings[hs.hole_number] = bearing(hs.shots[0].from, hs.shots[hs.shots.length - 1].to);
    });

    allShots.forEach((shot, idx) => {
        const layer = holeLayers[shot.hole_number];
        if (!layer) return;

        const cat    = shot.club_category ?? 'unknown';
        const color  = CLUB_COLORS[cat] ?? CLUB_COLORS.unknown;
        const club   = shot.club_name ?? (cat === 'putt' ? 'Putter' : cat);
        const dist   = shot.distance_meters ? `${Math.round(shot.distance_meters * 1.09361)}yds` : '';
        const hr     = shot.heart_rate ? `${shot.heart_rate}bpm` : '';
        const alt    = shot.altitude_meters ? `${Math.round(shot.altitude_meters)}m alt` : '';
        const isPutt = cat === 'putt';

        // Line: dashed + thinner for putts, solid arrow for other shots
        const line = L.polyline(
            [[shot.from.lat, shot.from.lon], [shot.to.lat, shot.to.lon]],
            { color, weight: isPutt ? 1.5 : 2.5, opacity: 0.85,
              dashArray: isPutt ? '4 4' : null }
        ).addTo(layer);

        // Circle at shot origin: smaller for putts
        const shotNum = idx + 1;
        const circle = L.circleMarker([shot.from.lat, shot.from.lon], {
            radius: isPutt ? 4 : 6,
            color: 'white', weight: 1.5,
            fillColor: color, fillOpacity: 1,
        }).addTo(layer);

        // Direction arrow for non-putt shots — deviation from hole bearing (tee→green)
        let dirHtml = '';
        if (!isPutt && holeBearings[shot.hole_number] != null) {
            const shotBear = bearing(shot.from, shot.to);
            dirHtml = dirArrowSvg(deviation(shotBear, holeBearings[shot.hole_number]));
        }

        // Popup content — 2-column layout
        const shotIdxInHole = holeShotIdx[shot.hole_number] ?? 0;
        holeShotIdx[shot.hole_number] = shotIdxInHole + 1;
        const sgVal = sgLookup[`${shot.hole_number}-${shotIdxInHole}`];
        const spark = hr ? hrSparkline(shot, round.health_timeline) : '';
        const leftLines = [
            `<b>H${shot.hole_number} ${isPutt ? 'Putt' : `Shot ${shotNum}`}</b>`,
            `Club: ${club}`,
            dist ? `Dist: ${dist}` : null,
            isPutt ? `Putts: ${holePutts[shot.hole_number] ?? '?'}` : null,
            alt ? `Alt: ${alt}` : null,
            shot.swing_tempo != null ? `Tempo: ${shot.swing_tempo.toFixed(1)}:1` : null,
            sgVal != null ? `SG: ${sgBadge(sgVal)}` : null,
        ].filter(Boolean).join('<br>');
        const rightParts = [dirHtml, hr ? `<div style="text-align:center;font-size:11px;color:#666">${hr}</div>${spark}` : ''].filter(Boolean).join('');
        const popupHtml = rightParts
            ? `<div style="display:flex;gap:10px;align-items:flex-start">
                <div style="flex:1;font-size:12px;line-height:1.6">${leftLines}</div>
                <div style="display:flex;flex-direction:column;align-items:center;min-width:60px">${rightParts}</div>
               </div>`
            : `<div style="font-size:12px;line-height:1.6">${leftLines}</div>`;

        const popup = L.popup({ closeButton: false, offset: [0, -4], autoPan: false, maxWidth: 300 }).setContent(popupHtml);
        circle.bindPopup(popup);
        line.bindPopup(popup);

        // Hover: open popup + show timeline indicator; mouseout: close + clear
        const onOver = () => { circle.openPopup(); showShotOnTimeline(shot); };
        const onOut  = () => { circle.closePopup(); clearShotIndicator(); };
        circle.on('mouseover', onOver).on('mouseout', onOut);
        line.on('mouseover', () => { line.openPopup(); showShotOnTimeline(shot); })
            .on('mouseout', onOut);

        // Arrowhead dot at destination (skip for putts — destination is the hole)
        if (!isPutt) {
            L.circleMarker([shot.to.lat, shot.to.lon], {
                radius: 3, color, weight: 0,
                fillColor: color, fillOpacity: 0.6,
            }).addTo(layer);
        }

        // Club abbr label next to origin dot
        const abbr = clubAbbr(shot);
        const labelLayer = holeLabelLayers[shot.hole_number];
        if (labelLayer) {
            const abbrMarker = L.marker([shot.from.lat, shot.from.lon], {
                icon: L.divIcon({
                    className: '',
                    html: `<div style="font-size:12px;font-weight:700;color:${color};
                        background:rgba(255,255,255,0.9);border-radius:3px;
                        padding:1px 3px;white-space:nowrap;
                        text-shadow:0 0 2px white;line-height:1.4;cursor:pointer">${abbr}</div>`,
                    iconSize: [30, 18], iconAnchor: [-7, 9],
                }),
            }).addTo(labelLayer);
            abbrMarker.bindPopup(popup);
            abbrMarker.on('mouseover', onOver).on('mouseout', onOut);

            // Distance label at midpoint of line
            if (!isPutt && shot.distance_meters) {
                const mid = [
                    (shot.from.lat + shot.to.lat) / 2,
                    (shot.from.lon + shot.to.lon) / 2,
                ];
                const yds = Math.round(shot.distance_meters * 1.09361);
                const distMarker = L.marker(mid, {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="font-size:11px;color:#111827;
                            background:rgba(255,255,255,0.9);border-radius:3px;
                            padding:1px 3px;white-space:nowrap;
                            line-height:1.4;cursor:pointer">${yds}y</div>`,
                        iconSize: [34, 16], iconAnchor: [17, 8],
                    }),
                }).addTo(labelLayer);
                distMarker.bindPopup(popup);
                distMarker.on('mouseover', onOver).on('mouseout', onOut);
            }
        }
    });

    // Hole number circles at tee positions — hover shows score + putts
    const holeScoreMap = {};
    sc.hole_scores.forEach(hs => { holeScoreMap[hs.hole_number] = hs; });

    sc.hole_definitions.forEach(hd => {
        if (!hd.tee_position) return;
        const hs  = holeScoreMap[hd.hole_number];
        const par = hd.par;
        const score = hs?.score;
        const putts = hs?.putts;
        const diff  = score != null ? score - par : null;
        const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
        const distYds = hd.distance_cm ? Math.round(hd.distance_cm / 91.44) : null;

        const popupHtml = `
            <div style="min-width:120px">
                <b>Hole ${hd.hole_number}</b><br>
                Par ${par}${distYds ? ` · ${distYds} yds` : ''}<br>
                ${score != null ? `Score: <b>${score}</b> (${diffStr})<br>` : ''}
                ${putts != null ? `Putts: <b>${putts}</b>` : ''}
            </div>`;

        const marker = L.marker([hd.tee_position.lat, hd.tee_position.lon], {
            icon: L.divIcon({
                className: '',
                html: `<div style="display:flex;align-items:center;gap:3px;pointer-events:none">
                    <div style="background:#1e40af;color:white;border-radius:50%;
                        width:20px;height:20px;display:flex;align-items:center;
                        justify-content:center;font-size:10px;font-weight:700;
                        border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);
                        flex-shrink:0">${hd.hole_number}</div>
                    ${putts != null ? `<div style="font-size:11px;font-weight:600;color:#1e40af;
                        background:rgba(255,255,255,0.9);border-radius:3px;
                        padding:1px 4px;white-space:nowrap">${putts} putts</div>` : ''}
                </div>`,
                iconSize: [90, 20], iconAnchor: [10, 10],
            })
        }).addTo(activeMap);

        const holePopup = L.popup({ closeButton: false, autoPan: false }).setContent(popupHtml);
        marker.bindPopup(holePopup);
        marker.on('mouseover', () => marker.openPopup());
        marker.on('mouseout',  () => marker.closePopup());
    });

    // GPS trail layer from health_timeline
    const trailPts = round.health_timeline
        .filter(s => s.position?.lat && s.position?.lon)
        .map(s => [s.position.lat, s.position.lon]);
    const trailLayer = trailPts.length > 1
        ? L.polyline(trailPts, { color: '#6366f1', weight: 2, opacity: 0.5, dashArray: '4 4' })
        : null;

    // Legend
    const usedCats = [...new Set(allShots.map(s => s.club_category ?? 'unknown'))];
    const catLabels = { tee:'Driver/Tee', fairway_wood:'Fairway Wood', iron:'Iron',
                        wedge:'Wedge', putt:'Putter', unknown:'Unknown' };
    document.getElementById('shot-legend').innerHTML = usedCats.map(cat => `
        <span class="flex items-center gap-1">
            <span style="background:${CLUB_COLORS[cat]};width:12px;height:12px;
                border-radius:50%;display:inline-block"></span>
            ${catLabels[cat] ?? cat}
        </span>`).join('');

    // Trail toggle
    let trailVisible = false;
    const trailBtn = document.getElementById('trail-toggle');
    if (trailBtn && trailLayer) {
        trailBtn.addEventListener('click', () => {
            trailVisible = !trailVisible;
            if (trailVisible) {
                trailLayer.addTo(activeMap);
                trailBtn.classList.add('bg-indigo-100', 'border-indigo-400', 'text-indigo-700');
                trailBtn.classList.remove('border-gray-300');
            } else {
                activeMap.removeLayer(trailLayer);
                trailBtn.classList.remove('bg-indigo-100', 'border-indigo-400', 'text-indigo-700');
                trailBtn.classList.add('border-gray-300');
            }
        });
    } else if (trailBtn && !trailLayer) {
        trailBtn.disabled = true;
        trailBtn.classList.add('opacity-40');
    }

    // Hole filter buttons
    document.querySelectorAll('.hole-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active button style
            document.querySelectorAll('.hole-btn').forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                b.classList.add('border-gray-300');
            });
            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            btn.classList.remove('border-gray-300');

            const holeFilter = btn.dataset.hole;

            // Show/hide shot layers
            Object.entries(holeLayers).forEach(([holeNum, layer]) => {
                if (holeFilter === 'all' || holeNum === holeFilter) {
                    activeMap.addLayer(layer);
                } else {
                    activeMap.removeLayer(layer);
                }
            });

            // Show labels only when a single hole is selected
            Object.entries(holeLabelLayers).forEach(([holeNum, layer]) => {
                if (holeFilter !== 'all' && holeNum === holeFilter) {
                    activeMap.addLayer(layer);
                } else {
                    activeMap.removeLayer(layer);
                }
            });

            // Zoom map to selected hole or all
            if (holeFilter === 'all') {
                activeMap.fitBounds(bounds, { padding: [30, 30] });
            } else {
                const holeShots = allShots.filter(s => String(s.hole_number) === holeFilter);
                if (holeShots.length) {
                    const hlats = holeShots.flatMap(s => [s.from.lat, s.to.lat]);
                    const hlons = holeShots.flatMap(s => [s.from.lon, s.to.lon]);
                    activeMap.fitBounds([
                        [Math.min(...hlats), Math.min(...hlons)],
                        [Math.max(...hlats), Math.max(...hlons)],
                    ], { padding: [20, 20], maxZoom: 19 });
                }
            }

            // Zoom timeline chart to hole time window
            zoomTimeline(holeFilter);
        });
    });

    // Render timeline chart below the map
    requestAnimationFrame(() => renderTimelineChart(round));
}

// ── Course Stats ─────────────────────────────────────────────────────────────

function bearing(from, to) {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat   * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distMeters(from, to) {
    const R = 6371000;
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(from.lat*Math.PI/180) * Math.cos(to.lat*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function metersToYards(m) { return m * 1.09361; }

// Bearing deviation: positive = right of target, negative = left
function deviation(shotBearing, holeBearing) {
    let d = shotBearing - holeBearing;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function dirLabel(dev) {
    if (Math.abs(dev) < 10) return 'Straight';
    if (dev > 0) return dev > 30 ? 'Far Right' : 'Right';
    return dev < -30 ? 'Far Left' : 'Left';
}

function buildCourseStats(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) {
        return `<div class="bg-white rounded-xl shadow-sm border p-6">
            <p class="text-gray-400 text-sm">No scorecard data available.</p></div>`;
    }

    // Build enriched shot list with distance, bearing, deviation from hole direction
    const enriched = [];
    sc.hole_scores.forEach(hs => {
        const holeDef = sc.hole_definitions.find(h => h.hole_number === hs.hole_number);
        const shots = hs.shots;
        if (!shots.length) return;

        // Hole direction = bearing from first shot to last shot destination
        const firstFrom = shots[0].from;
        const lastTo    = shots[shots.length - 1].to;
        const holeBearing = bearing(firstFrom, lastTo);

        shots.forEach((shot, idx) => {
            const dist = distMeters(shot.from, shot.to);
            const bear = bearing(shot.from, shot.to);
            const dev  = deviation(bear, holeBearing);
            enriched.push({
                hole:     hs.hole_number,
                par:      holeDef?.par ?? 0,
                shotIdx:  idx,
                shotNum:  idx + 1,
                totalShots: shots.length,
                club:     shot.club_name ?? 'Unknown',
                cat:      shot.club_category ?? 'unknown',
                dist,
                distYds:  metersToYards(dist),
                bearing:  bear,
                deviation: dev,
                dirLabel: dirLabel(dev),
                hr:       shot.heart_rate,
                alt:      shot.altitude_meters,
            });
        });
    });

    const teeShots     = enriched.filter(s => s.cat === 'tee');
    const approachShots = enriched.filter(s => s.cat === 'fairway_wood' || s.cat === 'iron');
    const wedgeShots   = enriched.filter(s => s.cat === 'wedge');
    const putts        = enriched.filter(s => s.cat === 'putt');

    return `
    <div class="space-y-6">
        ${buildStatSection('Tee Shots', teeShots, true)}
        ${buildStatSection('Approach Shots', approachShots, false)}
        ${buildStatSection('Wedges', wedgeShots, false)}
        ${buildPuttSection(putts, sc)}
        ${buildClubSummary(enriched)}
    </div>`;
}

function buildStatSection(title, shots, isTee) {
    if (!shots.length) return '';

    const avgDist = shots.reduce((a, s) => a + s.distYds, 0) / shots.length;
    const maxDist = Math.max(...shots.map(s => s.distYds));
    const straight = shots.filter(s => Math.abs(s.deviation) < 15).length;
    const right    = shots.filter(s => s.deviation >= 15).length;
    const left     = shots.filter(s => s.deviation <= -15).length;

    const dirBar = (count, total, color, label) => {
        if (!count) return '';
        const pct = (count / total * 100).toFixed(0);
        return `<div class="flex items-center gap-2 text-xs">
            <div class="w-12 text-right text-gray-500">${label}</div>
            <div class="flex-1 bg-gray-100 rounded-full h-3">
                <div class="${color} h-3 rounded-full" style="width:${pct}%"></div>
            </div>
            <div class="w-12 text-gray-600">${count} (${pct}%)</div>
        </div>`;
    };

    const rows = shots.map(s => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-1.5 text-xs text-gray-500">H${s.hole} S${s.shotNum}</td>
            <td class="py-1.5 text-xs">${s.club}</td>
            <td class="py-1.5 text-xs font-medium">${Math.round(s.distYds)} yds</td>
            <td class="py-1.5 text-xs">
                <span class="${
                    Math.abs(s.deviation) < 15 ? 'text-green-600' :
                    Math.abs(s.deviation) < 30 ? 'text-yellow-600' : 'text-red-600'
                }">${s.dirLabel}</span>
                <span class="text-gray-400 ml-1">(${s.deviation > 0 ? '+' : ''}${Math.round(s.deviation)}°)</span>
            </td>
            ${s.hr ? `<td class="py-1.5 text-xs text-gray-400">${s.hr} bpm</td>` : '<td></td>'}
        </tr>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">${title}
            <span class="text-sm font-normal text-gray-400 ml-2">${shots.length} shots</span>
        </h3>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${Math.round(avgDist)}</div>
                <div class="text-xs text-gray-500">Avg (yds)</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${Math.round(maxDist)}</div>
                <div class="text-xs text-gray-500">Max (yds)</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${Math.round(straight / shots.length * 100)}%</div>
                <div class="text-xs text-gray-500">Straight</div>
            </div>
        </div>
        <div class="space-y-1.5 mb-4">
            ${dirBar(left,     shots.length, 'bg-blue-400',   'Left')}
            ${dirBar(straight, shots.length, 'bg-green-400',  'Straight')}
            ${dirBar(right,    shots.length, 'bg-orange-400', 'Right')}
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">Shot</th>
                    <th class="text-left py-1">Club</th>
                    <th class="text-left py-1">Dist</th>
                    <th class="text-left py-1">Direction</th>
                    <th class="text-left py-1">HR</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function buildPuttSection(putts, sc) {
    if (!putts.length) return '';

    const totalPutts = sc.hole_scores.reduce((a, h) => a + h.putts, 0);
    const holesPlayed = sc.hole_scores.length;
    const onePutts = sc.hole_scores.filter(h => h.putts === 1).length;
    const threePutts = sc.hole_scores.filter(h => h.putts >= 3).length;

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">Putting
            <span class="text-sm font-normal text-gray-400 ml-2">${totalPutts} total</span>
        </h3>
        <div class="grid grid-cols-4 gap-4 text-center">
            <div class="bg-gray-50 rounded-lg p-3">
                <div class="text-xl font-bold text-gray-800">${(totalPutts / holesPlayed).toFixed(1)}</div>
                <div class="text-xs text-gray-500">Per hole</div>
            </div>
            <div class="bg-green-50 rounded-lg p-3">
                <div class="text-xl font-bold text-green-600">${onePutts}</div>
                <div class="text-xs text-gray-500">1-putts</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3">
                <div class="text-xl font-bold text-blue-600">${totalPutts - onePutts - threePutts}</div>
                <div class="text-xs text-gray-500">2-putts</div>
            </div>
            <div class="bg-red-50 rounded-lg p-3">
                <div class="text-xl font-bold text-red-600">${threePutts}</div>
                <div class="text-xs text-gray-500">3-putts</div>
            </div>
        </div>
    </div>`;
}

function buildClubSummary(enriched) {
    // Group by club name, compute avg/max distance
    const byClub = {};
    enriched.filter(s => s.cat !== 'putt' && s.distYds > 5).forEach(s => {
        if (!byClub[s.club]) byClub[s.club] = [];
        byClub[s.club].push(s);
    });

    const catOrder = ['tee', 'fairway_wood', 'iron', 'wedge', 'unknown'];
    const clubs = Object.entries(byClub)
        .map(([name, shots]) => ({
            name,
            cat: shots[0].cat,
            count: shots.length,
            avg: shots.reduce((a, s) => a + s.distYds, 0) / shots.length,
            max: Math.max(...shots.map(s => s.distYds)),
            straight: shots.filter(s => Math.abs(s.deviation) < 15).length,
        }))
        .sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || b.avg - a.avg);

    const maxAvg = Math.max(...clubs.map(c => c.avg));

    const rows = clubs.map(c => `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2 text-sm font-medium">${c.name}</td>
            <td class="py-2 text-xs text-gray-400">${c.count}</td>
            <td class="py-2">
                <div class="flex items-center gap-2">
                    <div class="w-24 bg-gray-100 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full" style="width:${(c.avg/maxAvg*100).toFixed(0)}%"></div>
                    </div>
                    <span class="text-sm font-medium">${Math.round(c.avg)} yds</span>
                </div>
            </td>
            <td class="py-2 text-xs text-gray-400">${Math.round(c.max)} yds</td>
            <td class="py-2 text-xs ${c.straight/c.count > 0.6 ? 'text-green-600' : 'text-gray-400'}">
                ${Math.round(c.straight/c.count*100)}%
            </td>
        </tr>`).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">Club Summary</h3>
        <table class="w-full text-sm">
            <thead><tr class="text-xs text-gray-400 border-b">
                <th class="text-left py-1">Club</th>
                <th class="text-left py-1">Shots</th>
                <th class="text-left py-1">Avg Distance</th>
                <th class="text-left py-1">Max</th>
                <th class="text-left py-1">Straight%</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

// ── Strokes Gained (Broadie / Every Shot Counts) ─────────────────────────────

// Single-digit handicap baseline: expected strokes to hole out from given distance (yards).
// Sources: Mark Broadie "Every Shot Counts" scratch/single-digit amateur tables, interpolated.
// Keys: distance in yards → expected strokes. We interpolate between entries.
const SG_BASELINE_TEE = [
    // distance, expected strokes (from tee box)
    [100, 2.72], [125, 2.78], [150, 2.85], [175, 2.94], [200, 3.06],
    [225, 3.17], [250, 3.28], [275, 3.39], [300, 3.50], [325, 3.61],
    [350, 3.71], [375, 3.80], [400, 3.90], [425, 4.01], [450, 4.12],
    [475, 4.22], [500, 4.33], [525, 4.45], [550, 4.57], [575, 4.68], [600, 4.80],
];
const SG_BASELINE_FAIRWAY = [
    // distance, expected strokes (from fairway)
    [20, 2.45], [30, 2.50], [40, 2.55], [50, 2.61], [60, 2.67],
    [80, 2.76], [100, 2.85], [120, 2.96], [140, 3.08], [150, 3.15],
    [160, 3.21], [175, 3.31], [200, 3.46], [225, 3.62], [250, 3.78], [275, 3.94],
];
const SG_BASELINE_ROUGH = [
    // distance, expected strokes (from rough — ~0.15-0.2 penalty over fairway)
    [20, 2.60], [30, 2.65], [40, 2.71], [50, 2.78], [60, 2.84],
    [80, 2.94], [100, 3.04], [120, 3.16], [140, 3.29], [150, 3.36],
    [160, 3.43], [175, 3.53], [200, 3.69], [225, 3.86], [250, 4.03],
];
const SG_BASELINE_GREEN = [
    // distance in feet, expected putts (single-digit: better from short range)
    [1, 1.00], [2, 1.01], [3, 1.07], [4, 1.15], [5, 1.24],
    [6, 1.33], [8, 1.47], [10, 1.58], [15, 1.73], [20, 1.84],
    [25, 1.94], [30, 2.03], [40, 2.16], [50, 2.27], [60, 2.36], [90, 2.55],
];

function interpolateBaseline(table, dist) {
    if (dist <= table[0][0]) return table[0][1];
    if (dist >= table[table.length - 1][0]) return table[table.length - 1][1];
    for (let i = 0; i < table.length - 1; i++) {
        if (dist >= table[i][0] && dist <= table[i + 1][0]) {
            const t = (dist - table[i][0]) / (table[i + 1][0] - table[i][0]);
            return table[i][1] + t * (table[i + 1][1] - table[i][1]);
        }
    }
    return table[table.length - 1][1];
}

// Expected strokes from a position. lie: 'tee' | 'fairway' | 'rough' | 'green'
function expectedStrokes(distYards, lie) {
    if (lie === 'green') return interpolateBaseline(SG_BASELINE_GREEN, distYards * 3); // yards→feet
    if (lie === 'tee') return interpolateBaseline(SG_BASELINE_TEE, distYards);
    if (lie === 'rough') return interpolateBaseline(SG_BASELINE_ROUGH, distYards);
    return interpolateBaseline(SG_BASELINE_FAIRWAY, distYards);
}

// Compute strokes gained for an entire round. Returns { shots: [...], categories: {...} }
function computeStrokesGained(round) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return null;

    const sgShots = [];
    sc.hole_scores.forEach(hs => {
        const holeDef = sc.hole_definitions.find(h => h.hole_number === hs.hole_number);
        const shots = hs.shots;
        if (!shots.length) return;

        const green = shots[shots.length - 1].to; // last shot destination = hole location

        shots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            const isPutt = cat === 'putt';
            const isLastShot = idx === shots.length - 1;

            // Distance from shot origin to green
            const distBefore = metersToYards(distMeters(shot.from, green));
            // Distance from shot destination to green
            const distAfter = isLastShot ? 0 : metersToYards(distMeters(shot.to, green));

            // Determine lie
            let lieBefore, lieAfter;
            if (idx === 0) {
                lieBefore = 'tee';
            } else if (isPutt) {
                lieBefore = 'green';
            } else if (distBefore < 50) {
                lieBefore = 'fairway'; // short game — treat as fairway
            } else {
                // Use fairway_hit flag for 2nd shot on par 4/5 (tee shot hit fairway)
                lieBefore = (idx === 1 && hs.fairway_hit) ? 'fairway' : 'rough';
            }

            if (isLastShot) {
                lieAfter = 'holed';
            } else {
                const nextCat = shots[idx + 1]?.club_category;
                lieAfter = nextCat === 'putt' ? 'green' : (lieBefore === 'tee' && hs.fairway_hit ? 'fairway' : 'fairway');
            }

            const expBefore = expectedStrokes(distBefore, lieBefore);
            const expAfter = isLastShot ? 0 : expectedStrokes(distAfter, lieAfter);
            // SG = expected_before - (1 + expected_after)
            const sg = expBefore - 1 - expAfter;

            // Categorize: off-tee, approach, short-game, putting
            let sgCat;
            if (isPutt) {
                sgCat = 'putting';
            } else if (idx === 0 && (holeDef?.par ?? 0) >= 4) {
                sgCat = 'off_tee';
            } else if (distBefore < 50) {
                sgCat = 'short_game';
            } else {
                sgCat = 'approach';
            }

            sgShots.push({
                hole: hs.hole_number,
                shotIdx: idx,
                shotNum: idx + 1,
                club: shot.club_name ?? cat,
                cat: sgCat,
                distBefore: Math.round(distBefore),
                distAfter: Math.round(distAfter),
                lieBefore,
                sg: +sg.toFixed(3),
                from: shot.from,
                to: shot.to,
            });
        });
    });

    // Aggregate by category
    const cats = { off_tee: 0, approach: 0, short_game: 0, putting: 0 };
    const catCounts = { off_tee: 0, approach: 0, short_game: 0, putting: 0 };
    sgShots.forEach(s => {
        if (cats[s.cat] !== undefined) {
            cats[s.cat] += s.sg;
            catCounts[s.cat]++;
        }
    });
    const total = Object.values(cats).reduce((a, b) => a + b, 0);

    return { shots: sgShots, categories: cats, catCounts, total };
}

// Build a per-shot SG lookup keyed by "hole-shotIdx" for shot map popups
function buildSgLookup(round) {
    const sg = computeStrokesGained(round);
    if (!sg) return {};
    const map = {};
    sg.shots.forEach(s => { map[`${s.hole}-${s.shotIdx}`] = s.sg; });
    return map;
}

function sgColor(val) {
    if (val >= 0.3) return '#16a34a';  // strong gain
    if (val >= 0)   return '#22c55e';  // slight gain
    if (val >= -0.3) return '#f97316'; // slight loss
    return '#ef4444';                  // strong loss
}

function sgBadge(val) {
    if (val == null) return '';
    const sign = val >= 0 ? '+' : '';
    const c = sgColor(val);
    return `<span style="color:${c};font-weight:600;font-size:11px">${sign}${val.toFixed(2)}</span>`;
}

function buildStrokesGainedTab(round) {
    const sg = computeStrokesGained(round);
    if (!sg) return `<div class="bg-white rounded-xl shadow-sm border p-6">
        <p class="text-gray-400 text-sm">No scorecard data for Strokes Gained analysis.</p></div>`;

    // Build club stats for NLG context (reuse buildClubAnalysis logic inline)
    const _clubStats = (() => {
        const sc = round.scorecard;
        if (!sc?.hole_scores?.length) return [];
        const dirMap = {};
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
            shots.forEach((shot, idx) => {
                if ((shot.club_category ?? '') === 'putt') return;
                dirMap[`${hs.hole_number}-${idx}`] = {
                    dev: deviation(bearing(shot.from, shot.to), holeBear),
                    dist: metersToYards(distMeters(shot.from, shot.to)),
                };
            });
        });
        const byClub = {};
        sg.shots.forEach(s => {
            if (s.cat === 'putting') return;
            if (!byClub[s.club]) byClub[s.club] = [];
            const dir = dirMap[`${s.hole}-${s.shotIdx}`];
            byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
        });
        const _std = arr => arr.length < 2 ? 0 : Math.sqrt(arr.reduce((a,v) => a+(v - arr.reduce((x,y)=>x+y,0)/arr.length)**2, 0)/(arr.length-1));
        return Object.entries(byClub).filter(([,arr]) => arr.length >= 2).map(([name, arr]) => ({
            name, shots: arr.length,
            avgDist: arr.reduce((a,s)=>a+s.distYds,0)/arr.length,
            distStd: _std(arr.map(s=>s.distYds)),
            avgDev:  arr.reduce((a,s)=>a+s.dev,0)/arr.length,
            avgSg:   arr.reduce((a,s)=>a+s.sg,0)/arr.length,
        }));
    })();

    const _nlgCtx = buildAnalyticsContext(round, sg, _clubStats);
    const insightsCard = buildInsightsCard(_nlgCtx);

    const catLabels = {
        off_tee: 'Off the Tee', approach: 'Approach',
        short_game: 'Short Game', putting: 'Putting'
    };
    const catIcons = {
        off_tee: '🏌️', approach: '🎯', short_game: '⛳', putting: '🏁'
    };

    // Summary cards
    const totalCard = `
        <div class="bg-gray-50 rounded-lg p-4 text-center col-span-2 md:col-span-1">
            <div class="text-2xl font-bold" style="color:${sgColor(sg.total)}">
                ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(1)}
            </div>
            <div class="text-xs text-gray-500 mt-1">Total SG</div>
        </div>`;

    const catCards = Object.entries(catLabels).map(([key, label]) => {
        const val = sg.categories[key];
        const count = sg.catCounts[key];
        return `
        <div class="bg-gray-50 rounded-lg p-4 text-center">
            <div class="text-lg font-bold" style="color:${sgColor(val)}">
                ${val >= 0 ? '+' : ''}${val.toFixed(2)}
            </div>
            <div class="text-xs text-gray-500 mt-1">${catIcons[key]} ${label}</div>
            <div class="text-xs text-gray-400">${count} shots</div>
        </div>`;
    }).join('');

    // Category bar chart
    const maxAbs = Math.max(0.5, ...Object.values(sg.categories).map(Math.abs));
    const barChart = Object.entries(catLabels).map(([key, label]) => {
        const val = sg.categories[key];
        const pct = Math.abs(val) / maxAbs * 50;
        const isPos = val >= 0;
        return `
        <div class="flex items-center gap-3">
            <div class="w-24 text-xs text-gray-600 text-right">${label}</div>
            <div class="flex-1 flex items-center" style="height:24px">
                <div class="relative w-full bg-gray-100 rounded-full h-4">
                    <div class="absolute top-0 h-4 rounded-full" style="
                        background:${sgColor(val)};
                        width:${pct.toFixed(0)}%;
                        ${isPos ? 'left:50%' : `right:50%`}
                    "></div>
                    <div class="absolute top-0 left-1/2 w-px h-4 bg-gray-400"></div>
                </div>
            </div>
            <div class="w-16 text-xs font-medium text-right" style="color:${sgColor(val)}">
                ${val >= 0 ? '+' : ''}${val.toFixed(2)}
            </div>
        </div>`;
    }).join('');

    // Per-hole breakdown
    const holeMap = {};
    sg.shots.forEach(s => {
        if (!holeMap[s.hole]) holeMap[s.hole] = [];
        holeMap[s.hole].push(s);
    });

    const sc = round.scorecard;
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    const holeRows = sc.hole_scores.map(hs => {
        const shots = holeMap[hs.hole_number] || [];
        const holeSg = shots.reduce((a, s) => a + s.sg, 0);
        const def = parMap[hs.hole_number];
        const par = def?.par ?? 0;
        const diff = hs.score - par;
        const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);

        const shotCells = shots.map(s => `
            <div class="inline-flex items-center gap-1 mr-2 mb-1">
                <span class="text-xs text-gray-500">${s.club}</span>
                ${sgBadge(s.sg)}
            </div>`).join('');

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2 text-sm font-medium">H${hs.hole_number}</td>
            <td class="py-2 text-xs text-gray-500">P${par}</td>
            <td class="py-2 text-sm">${hs.score} <span class="text-xs text-gray-400">(${diffStr})</span></td>
            <td class="py-2 text-sm font-medium" style="color:${sgColor(holeSg)}">
                ${holeSg >= 0 ? '+' : ''}${holeSg.toFixed(2)}
            </td>
            <td class="py-2">${shotCells}</td>
        </tr>`;
    }).join('');

    // Best/worst shots
    const sorted = [...sg.shots].sort((a, b) => b.sg - a.sg);
    const best3 = sorted.slice(0, 3);
    const worst3 = sorted.slice(-3).reverse();

    const shotListHtml = (shots, label) => `
        <div>
            <div class="text-xs font-medium text-gray-500 mb-2">${label}</div>
            ${shots.map(s => `
                <div class="flex items-center justify-between py-1">
                    <span class="text-xs text-gray-600">H${s.hole} S${s.shotNum} · ${s.club} · ${s.distBefore}yds</span>
                    ${sgBadge(s.sg)}
                </div>`).join('')}
        </div>`;

    // Club analysis: merge SG shots with direction data
    const clubAnalysis = buildClubAnalysis(round, sg);
    const dispersion = buildDispersionHeatmaps(round, sg);

    return `
    ${insightsCard}
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Strokes Gained</h3>
        <p class="text-xs text-gray-400 mb-4">Based on Mark Broadie's Every Shot Counts · single-digit handicap baseline</p>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            ${totalCard}
            ${catCards}
        </div>
        <div class="space-y-2 mb-6">${barChart}</div>
        <div class="grid grid-cols-2 gap-6 mb-6">
            ${shotListHtml(best3, '🏆 Best Shots')}
            ${shotListHtml(worst3, '💀 Worst Shots')}
        </div>
    </div>
    ${clubAnalysis}
    ${dispersion}
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-4">Per-Hole Breakdown</h3>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">Hole</th>
                    <th class="text-left py-1">Par</th>
                    <th class="text-left py-1">Score</th>
                    <th class="text-left py-1">SG</th>
                    <th class="text-left py-1">Shots</th>
                </tr></thead>
                <tbody>${holeRows}</tbody>
            </table>
        </div>
    </div>
    <div class="bg-gray-50 rounded-xl border border-gray-200 p-6 text-sm text-gray-500 leading-relaxed">
        <h4 class="font-semibold text-gray-600 mb-2">How Strokes Gained Works</h4>
        <p class="mb-2">Strokes Gained, developed by Mark Broadie in <i>Every Shot Counts</i>, measures each shot's value by comparing your result to what a benchmark golfer (here, a single-digit handicap) would expect from the same position.</p>
        <p class="mb-2"><b>SG = Expected strokes before − 1 − Expected strokes after.</b> A positive value means you gained strokes (did better than baseline); negative means you lost strokes.</p>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs">
            <div><span class="font-medium text-gray-600">SG: Off the Tee</span> — Tee shots on par 4s and 5s</div>
            <div><span class="font-medium text-gray-600">SG: Approach</span> — Shots into the green from 50+ yards</div>
            <div><span class="font-medium text-gray-600">SG: Short Game</span> — Non-putt shots within 50 yards</div>
            <div><span class="font-medium text-gray-600">SG: Putting</span> — All putts on the green</div>
        </div>
        <p class="mt-3 text-xs text-gray-400">Lie detection is approximate — fairway/rough is inferred from the fairway-hit flag on tee shots. Baseline data is interpolated from Broadie's published single-digit handicap tables.</p>
    </div>`;
}

function buildClubAnalysis(round, sg) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return '';

    // Build direction data per shot keyed by hole-shotIdx
    const dirMap = {};
    sc.hole_scores.forEach(hs => {
        const shots = hs.shots;
        if (!shots.length) return;
        const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
        shots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            if (cat === 'putt') return;
            const dist = metersToYards(distMeters(shot.from, shot.to));
            const shotBear = bearing(shot.from, shot.to);
            const dev = deviation(shotBear, holeBear);
            dirMap[`${hs.hole_number}-${idx}`] = { dev, dist };
        });
    });

    // Group by club
    const byClub = {};
    sg.shots.forEach(s => {
        if (s.cat === 'putting') return;
        if (!byClub[s.club]) byClub[s.club] = [];
        const dir = dirMap[`${s.hole}-${s.shotIdx}`];
        byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
    });

    const stdDev = (arr) => {
        if (arr.length < 2) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / (arr.length - 1));
    };

    const clubs = Object.entries(byClub)
        .filter(([, shots]) => shots.length >= 2)
        .map(([name, shots]) => {
            const dists = shots.map(s => s.distYds);
            const devs = shots.map(s => s.dev);
            const sgs = shots.map(s => s.sg);
            const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
            const distStd = stdDev(dists);
            const avgDev = devs.reduce((a, b) => a + b, 0) / devs.length;
            const devStd = stdDev(devs);
            const avgSg = sgs.reduce((a, b) => a + b, 0) / sgs.length;
            const left = shots.filter(s => s.dev <= -15).length;
            const right = shots.filter(s => s.dev >= 15).length;
            const straight = shots.length - left - right;

            let tendency;
            if (Math.abs(avgDev) < 5) tendency = { label: 'Neutral', color: '#22c55e' };
            else if (avgDev < -5) tendency = { label: `Left bias (${Math.round(avgDev)}°)`, color: '#3b82f6' };
            else tendency = { label: `Right bias (+${Math.round(avgDev)}°)`, color: '#f97316' };

            // Consistency rating based on distance CV (coefficient of variation)
            const cv = avgDist > 0 ? distStd / avgDist : 0;
            let consistency;
            if (cv < 0.05) consistency = { label: 'Very consistent', color: '#16a34a', stars: '★★★' };
            else if (cv < 0.10) consistency = { label: 'Consistent', color: '#22c55e', stars: '★★☆' };
            else if (cv < 0.18) consistency = { label: 'Moderate', color: '#eab308', stars: '★☆☆' };
            else consistency = { label: 'Inconsistent', color: '#ef4444', stars: '☆☆☆' };

            return { name, shots: shots.length, avgDist, distStd, avgDev, devStd, avgSg, left, right, straight, tendency, consistency };
        })
        .sort((a, b) => b.avgDist - a.avgDist);

    if (!clubs.length) return '';

    const rows = clubs.map(c => {
        const total = c.shots;
        const lPct = (c.left / total * 100).toFixed(0);
        const sPct = (c.straight / total * 100).toFixed(0);
        const rPct = (c.right / total * 100).toFixed(0);
        // Mini direction bar
        const dirBar = `<div class="flex h-3 rounded-full overflow-hidden" style="width:80px">
            <div class="bg-blue-400" style="width:${lPct}%"></div>
            <div class="bg-green-400" style="width:${sPct}%"></div>
            <div class="bg-orange-400" style="width:${rPct}%"></div>
        </div>`;

        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50">
            <td class="py-2.5 text-sm font-medium">${c.name}</td>
            <td class="py-2.5 text-xs text-gray-400 text-center">${c.shots}</td>
            <td class="py-2.5 text-sm">${Math.round(c.avgDist)} <span class="text-xs text-gray-400">±${Math.round(c.distStd)}</span></td>
            <td class="py-2.5"><span style="color:${c.consistency.color}" class="text-xs font-medium">${c.consistency.stars} ${c.consistency.label}</span></td>
            <td class="py-2.5">
                <div class="flex items-center gap-2">
                    ${dirBar}
                    <span class="text-xs" style="color:${c.tendency.color}">${c.tendency.label}</span>
                </div>
            </td>
            <td class="py-2.5 text-sm font-medium" style="color:${sgColor(c.avgSg)}">
                ${c.avgSg >= 0 ? '+' : ''}${c.avgSg.toFixed(2)}
            </td>
        </tr>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Club Analysis</h3>
        <p class="text-xs text-gray-400 mb-4">Mis-shot tendency and consistency per club (min 2 shots)</p>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead><tr class="text-xs text-gray-400 border-b">
                    <th class="text-left py-1">Club</th>
                    <th class="text-center py-1">Shots</th>
                    <th class="text-left py-1">Avg Dist</th>
                    <th class="text-left py-1">Consistency</th>
                    <th class="text-left py-1">Tendency</th>
                    <th class="text-left py-1">Avg SG</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function buildDispersionHeatmaps(round, sg) {
    const sc = round.scorecard;
    if (!sc?.hole_scores?.length) return '';

    // Build enriched shot data with direction deviation and distance accuracy
    const shots = [];
    sc.hole_scores.forEach(hs => {
        const holeShots = hs.shots;
        if (!holeShots.length) return;
        const green = holeShots[holeShots.length - 1].to;
        const holeBear = bearing(holeShots[0].from, green);

        holeShots.forEach((shot, idx) => {
            const cat = shot.club_category ?? 'unknown';
            if (cat === 'putt') return;

            const distToGreenBefore = metersToYards(distMeters(shot.from, green));
            const distToGreenAfter = metersToYards(distMeters(shot.to, green));
            const shotDist = metersToYards(distMeters(shot.from, shot.to));
            const shotBear = bearing(shot.from, shot.to);
            const dev = deviation(shotBear, holeBear);

            // Distance accuracy: how far short/long of ideal
            // Ideal = land exactly on the line to green, covering distToGreenBefore yards
            // Positive = long, negative = short
            const idealDist = distToGreenBefore;
            const distDelta = shotDist - idealDist; // positive = long of target
            const distPct = idealDist > 0 ? (distDelta / idealDist) * 100 : 0;

            // Find matching SG
            const sgShot = sg.shots.find(s => s.hole === hs.hole_number && s.shotIdx === idx);

            shots.push({
                hole: hs.hole_number,
                club: shot.club_name ?? cat,
                cat,
                distToGreen: Math.round(distToGreenBefore),
                shotDist: Math.round(shotDist),
                dev,        // direction deviation in degrees
                distDelta,  // yards long(+) or short(-)
                distPct,    // % long/short
                sg: sgShot?.sg ?? 0,
            });
        });
    });

    if (!shots.length) return '';

    // Distance buckets
    const buckets = [
        { label: '0–50 yds',    min: 0,   max: 50 },
        { label: '51–100 yds',  min: 51,  max: 100 },
        { label: '101–150 yds', min: 101, max: 150 },
        { label: '151–200 yds', min: 151, max: 200 },
        { label: '200+ yds',    min: 201, max: 999 },
    ];

    // Direction bins and distance-result bins
    const dirBins = [
        { label: 'Far L',    min: -Infinity, max: -30 },
        { label: 'Left',     min: -30,       max: -10 },
        { label: 'Straight', min: -10,       max: 10 },
        { label: 'Right',    min: 10,        max: 30 },
        { label: 'Far R',    min: 30,        max: Infinity },
    ];
    const distBins = [
        { label: 'Way Long',  min: 15,        max: Infinity },
        { label: 'Long',      min: 5,         max: 15 },
        { label: 'Good',      min: -5,         max: 5 },
        { label: 'Short',     min: -15,        max: -5 },
        { label: 'Way Short', min: -Infinity,  max: -15 },
    ];

    function classify(val, bins) {
        for (const b of bins) {
            if (val >= b.min && val < b.max) return b.label;
        }
        return bins[bins.length - 1].label;
    }

    // Build heatmaps per bucket
    const heatmaps = buckets.map(bucket => {
        const bucketShots = shots.filter(s => s.distToGreen >= bucket.min && s.distToGreen <= bucket.max);
        if (bucketShots.length < 2) return null;

        // Build grid: distBin rows × dirBin cols
        const grid = {};
        distBins.forEach(db => {
            grid[db.label] = {};
            dirBins.forEach(dirB => {
                grid[db.label][dirB.label] = { count: 0, sgSum: 0 };
            });
        });

        bucketShots.forEach(s => {
            const dirLabel = classify(s.dev, dirBins);
            const distLabel = classify(s.distPct, distBins);
            grid[distLabel][dirLabel].count++;
            grid[distLabel][dirLabel].sgSum += s.sg;
        });

        const maxCount = Math.max(1, ...Object.values(grid).flatMap(row =>
            Object.values(row).map(c => c.count)
        ));

        // Render grid as HTML table
        const headerCells = dirBins.map(d =>
            `<th class="px-1 py-1 text-center" style="min-width:52px">${d.label}</th>`
        ).join('');

        const bodyRows = distBins.map(db => {
            const cells = dirBins.map(dirB => {
                const cell = grid[db.label][dirB.label];
                if (cell.count === 0) return `<td class="px-1 py-1 text-center"><span class="text-gray-200">·</span></td>`;
                const avgSg = cell.sgSum / cell.count;
                const intensity = cell.count / maxCount;
                // Blue intensity for count, text color for SG
                const bg = `rgba(59,130,246,${(0.08 + intensity * 0.5).toFixed(2)})`;
                const isGood = db.label === 'Good' && dirB.label === 'Straight';
                return `<td class="px-1 py-1 text-center" style="background:${bg};border-radius:4px">
                    <div class="text-sm font-bold" style="color:${sgColor(avgSg)}">${cell.count}</div>
                    <div class="text-xs" style="color:${sgColor(avgSg)}">${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(1)}</div>
                </td>`;
            }).join('');
            return `<tr><td class="px-2 py-1 text-xs text-gray-500 text-right font-medium whitespace-nowrap">${db.label}</td>${cells}</tr>`;
        }).join('');

        const avgSgBucket = bucketShots.reduce((a, s) => a + s.sg, 0) / bucketShots.length;

        return `
        <div>
            <div class="flex items-center gap-2 mb-2">
                <span class="text-sm font-medium text-gray-700">${bucket.label}</span>
                <span class="text-xs text-gray-400">${bucketShots.length} shots</span>
                <span class="text-xs font-medium" style="color:${sgColor(avgSgBucket)}">avg SG ${avgSgBucket >= 0 ? '+' : ''}${avgSgBucket.toFixed(2)}</span>
            </div>
            <table class="text-xs">
                <thead><tr><th></th>${headerCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>`;
    }).filter(Boolean);

    if (!heatmaps.length) return '';

    return `
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Shot Dispersion</h3>
        <p class="text-xs text-gray-400 mb-4">Where your shots land relative to target — count and avg SG per cell. Grouped by distance to green.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            ${heatmaps.join('')}
        </div>
        <div class="mt-4 flex items-center gap-4 text-xs text-gray-400">
            <span>Cell = shot count + avg SG</span>
            <span>Blue intensity = frequency</span>
            <span style="color:#22c55e">● Gained</span>
            <span style="color:#ef4444">● Lost</span>
        </div>
    </div>`;
}

// ── NLG Analytics Context ───────────────────────────────────────────────────
// Lives in app.js so it can access metersToYards, distMeters, bearing, deviation

function buildAnalyticsContext(round, sg, clubStats) {
    const sc = round.scorecard;
    if (!sc) return null;
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));

    const holesPlayed = sc.hole_scores.length;
    const onePutts    = sc.hole_scores.filter(h => h.putts === 1).length;
    const threePutts  = sc.hole_scores.filter(h => h.putts >= 3).length;
    const firHoles    = sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) >= 4);
    const fir         = firHoles.length > 0
        ? Math.round(firHoles.filter(h => h.fairway_hit).length / firHoles.length * 100) : 0;
    const girCount    = sc.hole_scores.filter(h =>
        h.shots.length <= (parMap[h.hole_number]?.par ?? 0) - 2).length;
    const girPct      = Math.round(girCount / holesPlayed * 100);
    const missedGir   = sc.hole_scores.filter(h =>
        h.shots.length > (parMap[h.hole_number]?.par ?? 0) - 2);
    const scramblingPct = missedGir.length > 0
        ? Math.round(missedGir.filter(h => h.score <= (parMap[h.hole_number]?.par ?? 0)).length / missedGir.length * 100)
        : 100;
    const frontNineScore = sc.hole_scores.filter(h => h.hole_number <= 9).length >= 8
        ? sc.hole_scores.filter(h => h.hole_number <= 9).reduce((a, h) => a + h.score, 0) : null;
    const backNineScore  = sc.hole_scores.filter(h => h.hole_number > 9).length >= 8
        ? sc.hole_scores.filter(h => h.hole_number > 9).reduce((a, h) => a + h.score, 0) : null;
    const avgOverPar = holes => holes.length > 0
        ? holes.reduce((a, h) => a + h.score - (parMap[h.hole_number]?.par ?? 0), 0) / holes.length : null;
    const par3AvgOverPar = avgOverPar(sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 3));
    const par5AvgOverPar = avgOverPar(sc.hole_scores.filter(h => (parMap[h.hole_number]?.par ?? 0) === 5));
    let maxConsecutiveBogeys = 0, curStreak = 0;
    sc.hole_scores.forEach(h => {
        h.score > (parMap[h.hole_number]?.par ?? 0)
            ? maxConsecutiveBogeys = Math.max(maxConsecutiveBogeys, ++curStreak)
            : (curStreak = 0);
    });

    const health = round.health_timeline ?? [];
    const bbSamples = health.filter(s => s.body_battery != null).map(s => s.body_battery);
    const bbEnd   = bbSamples[bbSamples.length - 1] ?? null;
    const bbDrain = bbSamples.length > 1 ? bbSamples[0] - bbEnd : null;
    const stressSamples = health.filter(s => s.stress_proxy > 0).map(s => s.stress_proxy);
    const avgStress = stressSamples.length
        ? Math.round(stressSamples.reduce((a, b) => a + b, 0) / stressSamples.length) : null;
    const hrSamples = health.filter(s => s.heart_rate != null);
    const mid = Math.floor(hrSamples.length / 2);
    const earlyRoundHr = mid > 0 ? hrSamples.slice(0, mid).reduce((a, s) => a + s.heart_rate, 0) / mid : null;
    const lateRoundHr  = mid > 0 ? hrSamples.slice(mid).reduce((a, s) => a + s.heart_rate, 0) / (hrSamples.length - mid) : null;

    const worstClub = clubStats?.length ? [...clubStats].sort((a, b) => a.avgSg - b.avgSg)[0] : null;
    const bestClub  = clubStats?.length ? [...clubStats].sort((a, b) => b.avgSg - a.avgSg)[0] : null;
    const driverClub = clubStats?.find(c => /driver/i.test(c.name)) ?? null;
    const wedgeClub  = clubStats?.filter(c => /pw|gw|sw|lw|wedge/i.test(c.name))
        .sort((a, b) => b.shots - a.shots)[0] ?? null;
    const ironClubs  = clubStats?.filter(c => /\d-iron|iron/i.test(c.name)) ?? [];
    const ironBias   = ironClubs.length
        ? ironClubs.reduce((a, c) => a + c.avgDev * c.shots, 0) / ironClubs.reduce((a, c) => a + c.shots, 0)
        : null;

    // Dispersion: find most-shot distance bucket
    let approachDispersion = null;
    const dispBuckets = [
        { label: '101–150 yds', min: 101, max: 150 }, { label: '151–200 yds', min: 151, max: 200 },
        { label: '51–100 yds', min: 51, max: 100 },   { label: '0–50 yds', min: 0, max: 50 },
        { label: '200+ yds', min: 201, max: 999 },
    ];
    for (const bucket of dispBuckets) {
        const deltas = [];
        sc.hole_scores.forEach(hs => {
            const shots = hs.shots;
            if (!shots.length) return;
            const green = shots[shots.length - 1].to;
            shots.forEach(shot => {
                if ((shot.club_category ?? '') === 'putt') return;
                const d = metersToYards(distMeters(shot.from, green));
                if (d >= bucket.min && d <= bucket.max) {
                    const actual = metersToYards(distMeters(shot.from, shot.to));
                    deltas.push(d > 0 ? (actual - d) / d * 100 : 0);
                }
            });
        });
        if (deltas.length >= 3) {
            approachDispersion = {
                label: bucket.label,
                shortPct: Math.round(deltas.filter(p => p < -5).length / deltas.length * 100),
                longPct:  Math.round(deltas.filter(p => p > 5).length  / deltas.length * 100),
            };
            break;
        }
    }

    const allDevs = clubStats?.flatMap(c => Array(c.shots).fill(Math.abs(c.avgDev))) ?? [];
    const overallDispersionAngle = allDevs.length
        ? allDevs.reduce((a, b) => a + b, 0) / allDevs.length : null;

    return {
        round, sc, sg, clubStats,
        holesPlayed, onePutts, threePutts, fir, girPct, scramblingPct,
        frontNineScore, backNineScore, par3AvgOverPar, par5AvgOverPar, maxConsecutiveBogeys,
        bbEnd, bbDrain, avgStress, earlyRoundHr, lateRoundHr,
        durationMin: Math.round(round.duration_seconds / 60),
        distanceKm: +(round.distance_meters / 1000).toFixed(2),
        altRange: round.max_altitude_meters != null ? round.max_altitude_meters - round.min_altitude_meters : null,
        avgTempo: round.avg_swing_tempo ?? null,
        worstClub, bestClub, driverClub, wedgeClub, ironBias,
        approachDispersion, overallDispersionAngle,
    };
}

// ── AI Prompt Builder ────────────────────────────────────────────────────────

function buildAiPrompt(round) {
    const sc = round.scorecard;
    const dt = new Date((round.start_ts + GARMIN_EPOCH) * 1000);
    const dateStr = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const parMap = sc ? Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h])) : {};
    const scoredPar = sc ? sc.hole_scores.reduce((s, hs) => s + (parMap[hs.hole_number]?.par ?? 0), 0) : 0;
    const overPar = sc ? sc.total_score - scoredPar : 0;

    const L = [];
    L.push('Please analyze my golf round comprehensively and provide insights on performance, patterns, and areas for improvement.\n');

    // Round summary
    L.push('## Round Summary');
    L.push(`Date: ${dateStr}`);
    L.push(`Course: ${sc?.course_name ?? 'Unknown'} (${sc?.tee_color ?? ''} tees, Rating ${sc?.course_rating ?? ''}, Slope ${sc?.slope ?? ''})`);
    L.push(`Score: ${sc?.total_score ?? '—'} (${overPar >= 0 ? '+' : ''}${overPar}) over par ${scoredPar}`);
    L.push(`Holes: ${sc?.hole_scores.length ?? '—'}, Duration: ${Math.round(round.duration_seconds / 60)} min, Distance: ${(round.distance_meters / 1000).toFixed(2)} km`);
    L.push(`Calories: ${round.calories ?? '—'}, Avg HR: ${round.avg_heart_rate ?? '—'} bpm, Max HR: ${round.max_heart_rate ?? '—'} bpm`);
    if (round.min_altitude_meters != null)
        L.push(`Altitude: ${Math.round(round.min_altitude_meters)}–${Math.round(round.max_altitude_meters)} m`);
    if (round.avg_swing_tempo != null)
        L.push(`Avg swing tempo: ${round.avg_swing_tempo.toFixed(1)}:1`);

    // Scorecard
    if (sc) {
        L.push('\n## Hole-by-Hole Scorecard');
        L.push('Hole | Par | Score | +/- | Putts | FW | Shots | Clubs');
        L.push('-----|-----|-------|-----|-------|----|-------|------');
        sc.hole_scores.forEach(hs => {
            const def = parMap[hs.hole_number];
            const par = def?.par ?? 0;
            const diff = hs.score - par;
            const diffStr = diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
            const fw = par === 3 ? 'n/a' : (hs.fairway_hit ? 'Y' : 'N');
            const clubs = [...new Set(hs.shots.filter(s => s.club_name).map(s => s.club_name))].join(', ') || '—';
            L.push(`H${hs.hole_number} | ${par} | ${hs.score} | ${diffStr} | ${hs.putts} | ${fw} | ${hs.shots.length} | ${clubs}`);
        });
        L.push(`Total | ${scoredPar} | ${sc.total_score} | ${overPar >= 0 ? '+' : ''}${overPar} | ${sc.total_putts} | ${sc.fairways_hit} FW | |`);
    }

    // Shot details
    if (sc) {
        L.push('\n## Shot Details');
        sc.hole_scores.forEach(hs => {
            const def = parMap[hs.hole_number];
            const distYds = def?.distance_cm ? Math.round(def.distance_cm / 91.44) : '?';
            L.push(`\nHole ${hs.hole_number} (Par ${def?.par ?? '?'}, ${distYds} yds):`);
            hs.shots.forEach((shot, i) => {
                const parts = [
                    `  Shot ${i+1}: ${shot.club_name ?? shot.club_category ?? 'Unknown'}`,
                    shot.distance_meters ? `${Math.round(shot.distance_meters * 1.09361)}yds` : null,
                    shot.heart_rate      ? `HR ${shot.heart_rate}bpm` : null,
                    shot.altitude_meters ? `Alt ${Math.round(shot.altitude_meters)}m` : null,
                    shot.swing_tempo     ? `Tempo ${shot.swing_tempo.toFixed(1)}:1` : null,
                ].filter(Boolean);
                L.push(parts.join(', '));
            });
        });
    }

    // NLG insights
    const _sg = computeStrokesGained(round);
    if (_sg) {
        const _ctx = buildAnalyticsContext(round, _sg, null);
        const insightsText = buildInsightsText(_ctx);
        if (insightsText) {
            L.push('\n## Pre-computed Insights');
            L.push(insightsText);
        }
    }

    // Strokes Gained summary
    const sg = computeStrokesGained(round);
    if (sg) {
        L.push('\n## Strokes Gained (single-digit handicap baseline)');
        L.push(`Total: ${sg.total >= 0 ? '+' : ''}${sg.total.toFixed(2)}`);
        const catNames = { off_tee: 'Off the Tee', approach: 'Approach', short_game: 'Short Game', putting: 'Putting' };
        Object.entries(catNames).forEach(([k, v]) => {
            const val = sg.categories[k];
            L.push(`${v}: ${val >= 0 ? '+' : ''}${val.toFixed(2)} (${sg.catCounts[k]} shots)`);
        });
        L.push('\nPer-shot SG:');
        L.push('Hole | Shot | Club | Dist | SG');
        L.push('-----|------|------|------|---');
        sg.shots.forEach(s => {
            L.push(`H${s.hole} | S${s.shotNum} | ${s.club} | ${s.distBefore}yds | ${s.sg >= 0 ? '+' : ''}${s.sg.toFixed(2)}`);
        });

        // Club analysis: tendency and consistency
        const sc = round.scorecard;
        if (sc?.hole_scores?.length) {
            const dirMap = {};
            sc.hole_scores.forEach(hs => {
                const shots = hs.shots;
                if (!shots.length) return;
                const holeBear = bearing(shots[0].from, shots[shots.length - 1].to);
                shots.forEach((shot, idx) => {
                    if ((shot.club_category ?? '') === 'putt') return;
                    const dev = deviation(bearing(shot.from, shot.to), holeBear);
                    const dist = metersToYards(distMeters(shot.from, shot.to));
                    dirMap[`${hs.hole_number}-${idx}`] = { dev, dist };
                });
            });

            const byClub = {};
            sg.shots.filter(s => s.cat !== 'putting').forEach(s => {
                if (!byClub[s.club]) byClub[s.club] = [];
                const dir = dirMap[`${s.hole}-${s.shotIdx}`];
                byClub[s.club].push({ ...s, dev: dir?.dev ?? 0, distYds: dir?.dist ?? s.distBefore });
            });

            const clubEntries = Object.entries(byClub).filter(([, arr]) => arr.length >= 2);
            if (clubEntries.length) {
                L.push('\n## Club Analysis (Tendency & Consistency)');
                L.push('Club | Shots | Avg Dist | Std Dev | Avg Deviation | Left% | Straight% | Right% | Avg SG');
                L.push('-----|-------|---------|---------|---------------|-------|-----------|--------|------');
                clubEntries.sort((a, b) => {
                    const avgA = a[1].reduce((s, x) => s + x.distYds, 0) / a[1].length;
                    const avgB = b[1].reduce((s, x) => s + x.distYds, 0) / b[1].length;
                    return avgB - avgA;
                }).forEach(([name, arr]) => {
                    const dists = arr.map(s => s.distYds);
                    const devs = arr.map(s => s.dev);
                    const avgDist = Math.round(dists.reduce((a, b) => a + b, 0) / dists.length);
                    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
                    const std = Math.round(Math.sqrt(dists.reduce((a, v) => a + (v - mean) ** 2, 0) / (dists.length - 1)));
                    const avgDev = Math.round(devs.reduce((a, b) => a + b, 0) / devs.length);
                    const left = Math.round(arr.filter(s => s.dev <= -15).length / arr.length * 100);
                    const right = Math.round(arr.filter(s => s.dev >= 15).length / arr.length * 100);
                    const straight = 100 - left - right;
                    const avgSg = (arr.reduce((a, s) => a + s.sg, 0) / arr.length);
                    L.push(`${name} | ${arr.length} | ${avgDist}yds | ±${std} | ${avgDev >= 0 ? '+' : ''}${avgDev}° | ${left}% | ${straight}% | ${right}% | ${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(2)}`);
                });
            }

            // Shot dispersion by distance bucket
            const allDispShots = [];
            sc.hole_scores.forEach(hs => {
                const shots = hs.shots;
                if (!shots.length) return;
                const green = shots[shots.length - 1].to;
                const holeBear = bearing(shots[0].from, green);
                shots.forEach((shot, idx) => {
                    if ((shot.club_category ?? '') === 'putt') return;
                    const distToGreen = metersToYards(distMeters(shot.from, green));
                    const shotDist = metersToYards(distMeters(shot.from, shot.to));
                    const dev = deviation(bearing(shot.from, shot.to), holeBear);
                    const distPct = distToGreen > 0 ? ((shotDist - distToGreen) / distToGreen) * 100 : 0;
                    const sgShot = sg.shots.find(s => s.hole === hs.hole_number && s.shotIdx === idx);
                    allDispShots.push({ distToGreen: Math.round(distToGreen), dev, distPct, sg: sgShot?.sg ?? 0 });
                });
            });

            const buckets = [
                { label: '0-50 yds', min: 0, max: 50 },
                { label: '51-100 yds', min: 51, max: 100 },
                { label: '101-150 yds', min: 101, max: 150 },
                { label: '151-200 yds', min: 151, max: 200 },
                { label: '200+ yds', min: 201, max: 999 },
            ];

            const dispBuckets = buckets.map(b => ({
                ...b, shots: allDispShots.filter(s => s.distToGreen >= b.min && s.distToGreen <= b.max)
            })).filter(b => b.shots.length >= 2);

            if (dispBuckets.length) {
                L.push('\n## Shot Dispersion Patterns');
                dispBuckets.forEach(b => {
                    const avgSg = (b.shots.reduce((a, s) => a + s.sg, 0) / b.shots.length);
                    const avgDev = Math.round(b.shots.reduce((a, s) => a + s.dev, 0) / b.shots.length);
                    const avgDistPct = (b.shots.reduce((a, s) => a + s.distPct, 0) / b.shots.length).toFixed(1);
                    const left = b.shots.filter(s => s.dev <= -10).length;
                    const right = b.shots.filter(s => s.dev >= 10).length;
                    const short = b.shots.filter(s => s.distPct < -5).length;
                    const long = b.shots.filter(s => s.distPct > 5).length;
                    L.push(`\n${b.label} (${b.shots.length} shots, avg SG ${avgSg >= 0 ? '+' : ''}${avgSg.toFixed(2)}):`);
                    L.push(`  Direction: avg ${avgDev >= 0 ? '+' : ''}${avgDev}° | ${left} left, ${b.shots.length - left - right} straight, ${right} right`);
                    L.push(`  Distance: avg ${avgDistPct}% of target | ${short} short, ${b.shots.length - short - long} good, ${long} long`);
                });
            }
        }
    }

    // Health summary + full timeline
    const health = round.health_timeline;
    if (health.length > 0) {
        const bbSamples = health.filter(s => s.body_battery != null).map(s => s.body_battery);
        const stressSamples = health.filter(s => s.stress_proxy != null && s.stress_proxy > 0).map(s => s.stress_proxy);
        L.push('\n## Health & Wellness Summary');
        if (bbSamples.length)
            L.push(`Body Battery: ${bbSamples[0]}% → ${bbSamples[bbSamples.length-1]}% (drained ${bbSamples[0] - bbSamples[bbSamples.length-1]}%)`);
        if (stressSamples.length) {
            const avg = Math.round(stressSamples.reduce((a,b) => a+b,0) / stressSamples.length);
            L.push(`Stress: avg ${avg}, peak ${Math.max(...stressSamples)}`);
        }

        // Downsample to ~1 sample per minute
        const totalSecs = health[health.length-1].timestamp - health[0].timestamp;
        const avgInterval = totalSecs / health.length || 4;
        const step = Math.max(1, Math.round(60 / avgInterval));
        const pts = health.filter((_, i) => i % step === 0);

        // Map tempo samples onto nearest health timestamp
        const tempoByTs = {};
        (round.tempo_timeline ?? []).forEach(t => {
            let best = null, bestDiff = Infinity;
            pts.forEach(s => { const d = Math.abs(s.timestamp - t.timestamp); if (d < bestDiff) { bestDiff = d; best = s.timestamp; } });
            if (best !== null) tempoByTs[best] = t.ratio;
        });

        L.push('\n## Health Timeline (1-min intervals)');
        L.push('Time | HR (bpm) | Altitude (m) | Stress | Tempo');
        L.push('-----|----------|--------------|--------|------');
        pts.forEach(s => {
            const d = new Date((s.timestamp + GARMIN_EPOCH) * 1000);
            const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            const hr  = s.heart_rate ?? '-';
            const alt = s.altitude_meters != null ? Math.round(s.altitude_meters) : '-';
            const str = s.stress_proxy ?? '-';
            const tmp = tempoByTs[s.timestamp] != null ? `${tempoByTs[s.timestamp].toFixed(1)}:1` : '-';
            L.push(`${time} | ${hr} | ${alt} | ${str} | ${tmp}`);
        });
    }

    L.push('\n---');
    L.push('Please provide: 1) Overall performance summary, 2) Strengths, 3) Areas for improvement, 4) Patterns (tempo, HR, stress vs score), 5) Specific recommendations.');
    return L.join('\n');
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function handleSync() {
    if (state.syncing) return;
    state.syncing = true;
    state.syncOffset = 0;

    const btn   = document.getElementById('sync-btn');
    const label = document.getElementById('sync-label');
    btn.disabled = true;
    label.textContent = 'Syncing...';

    try {
        const newSummaries = await syncRounds(PAGE_SIZE, 0);
        // Merge into state.rounds (deduplicate by id)
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));
        state.syncOffset = PAGE_SIZE;

        renderRoundsList();
        if (newSummaries.length > 0) loadDetail(newSummaries[0].id);
        toast(`Synced ${newSummaries.length} round(s)`);
        updateStats();
    } catch (e) {
        toast(`Sync failed: ${e}`, true);
    } finally {
        state.syncing = false;
        btn.disabled = false;
        label.textContent = 'Sync Watch';
    }
}

async function handleLoadMore() {
    if (state.syncing) return;
    state.syncing = true;

    const btn = document.getElementById('load-more-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

    try {
        const newSummaries = await syncRounds(PAGE_SIZE, state.syncOffset);
        const existing = new Map(state.rounds.map(r => [r.id, r]));
        newSummaries.forEach(r => existing.set(r.id, r));
        state.rounds = [...existing.values()].sort((a, b) => b.date.localeCompare(a.date));
        state.syncOffset += PAGE_SIZE;

        renderRoundsList();
        toast(`Loaded ${newSummaries.length} more round(s)`);
        updateStats();
    } catch (e) {
        toast(`Load failed: ${e}`, true);
    } finally {
        state.syncing = false;
    }
}

async function updateStats() {
    try {
        const stats = await getStoreStats();
        document.getElementById('store-stats').textContent =
            `${stats.round_count} round${stats.round_count !== 1 ? 's' : ''} stored`;
    } catch (_) {}
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    document.getElementById('sync-btn').addEventListener('click', handleSync);
    document.getElementById('search-input').addEventListener('input', e => {
        state.searchTerm = e.target.value.toLowerCase();
        renderRoundsList();
    });

    try {
        state.rounds = await getAllRounds();
        renderRoundsList();
        updateStats();
        if (state.rounds.length > 0) loadDetail(state.rounds[0].id);
    } catch (e) {
        console.error('Init error:', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
