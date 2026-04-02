import { invoke } from '@tauri-apps/api/core';

const PAGE_SIZE = 10;

const state = {
    rounds: [],
    activeId: null,
    activeTab: 'overview',  // 'overview' | 'shotmap' | 'stats'
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
    ];

    const tabBar = `
    <div class="flex border-b bg-white sticky top-0 z-10 pt-4 mb-4">
        ${tabs.map(t => `
        <button class="detail-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
            ${t.label}
        </button>`).join('')}
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
    document.getElementById('timeline-chart')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        <div id="shot-legend" class="mt-3 flex flex-wrap gap-3 text-xs text-gray-500"></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border p-6">
        <h3 class="text-lg font-semibold text-gray-700 mb-1">Round Timeline</h3>
        <p class="text-xs text-gray-400 mb-4">Select a hole above to zoom in. HR, altitude and stress over time.</p>
        <div class="relative" style="height:240px">
            <canvas id="timeline-chart"></canvas>
        </div>
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

    // Init Leaflet map
    activeMap = L.map('shot-map').fitBounds(bounds, { padding: [30, 30] });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(activeMap);

    // Invalidate map size on window resize to maintain aspect ratio
    const resizeObserver = new ResizeObserver(() => activeMap?.invalidateSize());
    resizeObserver.observe(document.getElementById('shot-map-wrapper'));

    // Layer groups per hole for filtering
    const holeLayers = {};
    sc.hole_scores.forEach(hs => { holeLayers[hs.hole_number] = L.layerGroup().addTo(activeMap); });

    // Draw shots (including putts)
    // Build per-hole shot index for putt count lookup
    const holePutts = {};
    sc.hole_scores.forEach(hs => { holePutts[hs.hole_number] = hs.putts; });

    allShots.forEach((shot, idx) => {
        const layer = holeLayers[shot.hole_number];
        if (!layer) return;

        const cat    = shot.club_category ?? 'unknown';
        const color  = CLUB_COLORS[cat] ?? CLUB_COLORS.unknown;
        const club   = shot.club_name ?? (cat === 'putt' ? 'Putter' : cat);
        const dist   = shot.distance_meters ? `${Math.round(shot.distance_meters)}m` : '';
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

        // Popup content — putts show hole putt count
        const puttsLine = isPutt ? `Putts this hole: ${holePutts[shot.hole_number] ?? '?'}` : null;
        const popupLines = [
            `<b>H${shot.hole_number} ${isPutt ? 'Putt' : `Shot ${shotNum}`}</b>`,
            `Club: ${club}`,
            dist      ? `Distance: ${dist}` : null,
            puttsLine,
            hr        ? `HR: ${hr}` : null,
            alt       ? `Alt: ${alt}` : null,
            shot.swing_tempo != null ? `Tempo: ${shot.swing_tempo.toFixed(1)}:1` : null,
        ].filter(Boolean).join('<br>');

        const popup = L.popup({ closeButton: false, offset: [0, -4] }).setContent(popupLines);
        circle.bindPopup(popup);
        line.bindPopup(popup);

        // Hover: open popup + show timeline indicator; mouseout: close + clear
        const onOver = () => { circle.openPopup(); showShotOnTimeline(shot); };
        const onOut  = () => { circle.closePopup(); clearShotIndicator(); };
        circle.on('mouseover', onOver).on('mouseout', onOut);
        line.on('mouseover',   () => { line.openPopup(); showShotOnTimeline(shot); })
            .on('mouseout',    onOut);

        // Arrowhead dot at destination (skip for putts — destination is the hole)
        if (!isPutt) {
            L.circleMarker([shot.to.lat, shot.to.lon], {
                radius: 3, color, weight: 0,
                fillColor: color, fillOpacity: 0.6,
            }).addTo(layer);
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
                html: `<div style="background:#1e40af;color:white;border-radius:50%;
                    width:20px;height:20px;display:flex;align-items:center;
                    justify-content:center;font-size:10px;font-weight:700;
                    border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);
                    cursor:pointer">
                    ${hd.hole_number}</div>`,
                iconSize: [20, 20], iconAnchor: [10, 10],
            })
        }).addTo(activeMap);

        marker.bindPopup(L.popup({ closeButton: false, offset: [0, -10] }).setContent(popupHtml));
        marker.on('mouseover', () => marker.openPopup());
        marker.on('mouseout',  () => marker.closePopup());
    });

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

            // Show/hide layers
            Object.entries(holeLayers).forEach(([holeNum, layer]) => {
                if (holeFilter === 'all' || holeNum === holeFilter) {
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
                    ], { padding: [50, 50], maxZoom: 18 });
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
