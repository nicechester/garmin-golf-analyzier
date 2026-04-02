import { invoke } from '@tauri-apps/api/core';

const PAGE_SIZE = 10;

const state = {
    rounds: [],
    activeId: null,
    searchTerm: '',
    syncOffset: 0,
    syncing: false,
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
    state.activeId = id;
    renderRoundsList();

    const content = document.getElementById('detail-content');
    const empty   = document.getElementById('detail-empty');
    content.innerHTML = '<div class="text-center text-gray-400 py-12">Loading...</div>';
    content.classList.remove('hidden');
    empty.classList.add('hidden');

    try {
        const round = await getRoundDetail(id);
        if (!round) { content.innerHTML = '<p class="text-red-500">Round not found.</p>'; return; }
        content.innerHTML = buildDetailHTML(round);
        // Render chart after DOM is updated
        requestAnimationFrame(() => renderTimelineChart(round));
    } catch (e) {
        content.innerHTML = `<p class="text-red-500">Error: ${e}</p>`;
    }
}

function buildDetailHTML(round) {
    const sc = round.scorecard;
    const dt = new Date((round.start_ts + 631065600) * 1000);
    const dateStr = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const timeStr = dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    return `
        ${buildHeader(round, sc, dateStr, timeStr)}
        ${buildTimeline(round)}
        ${sc ? buildScorecard(sc) : ''}
        ${buildHealth(round)}
        ${buildHrZones(round)}
    `;
}

function buildHeader(round, sc, dateStr, timeStr) {
    const alt   = fmtAlt(round.min_altitude_meters, round.max_altitude_meters);
    const tempo = fmtTempo(round.avg_swing_tempo);
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
                <div class="score-badge ${scoreClass(sc.total_score - sc.total_par)} w-16 h-16 text-2xl">${sc.total_score}</div>
                <div class="text-sm font-medium mt-1 ${sc.total_score - sc.total_par > 0 ? 'text-red-600' : 'text-green-600'}">
                    ${overParStr(sc.total_score - sc.total_par)}
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

    const GARMIN_EPOCH = 631065600;

    // Downsample to max 300 points
    const samples = round.health_timeline;
    const step = Math.max(1, Math.floor(samples.length / 300));
    const pts = samples.filter((_, i) => i % step === 0);

    const labels     = pts.map(s => {
        const d = new Date((s.timestamp + GARMIN_EPOCH) * 1000);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    });
    const hrData     = pts.map(s => s.heart_rate ?? null);
    const altData    = pts.map(s => s.altitude_meters != null ? +s.altitude_meters.toFixed(1) : null);
    const stressData = pts.map(s => s.stress_proxy ?? null);

    // Build hole markers: find the label index closest to each hole's first shot timestamp
    // Enforce monotonically increasing order so H18 can't match an early shot
    const holeMarkers = []; // { index, label }
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
            holeMarkers.push({ index: closestIdx, label: `H${hs.hole_number}` });
        });
    }

    // Inline plugin: draw vertical lines + labels for each hole marker
    const holeLinePlugin = {
        id: 'holeLines',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            holeMarkers.forEach(({ index, label }) => {
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
                // Label
                ctx.setLineDash([]);
                ctx.font = '9px sans-serif';
                ctx.fillStyle = '#6366f1';
                ctx.textAlign = 'center';
                ctx.fillText(label, xPos, top + 10);
                ctx.restore();
            });
        }
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
            }
        }
    });
}

function buildScorecard(sc) {
    const parMap = Object.fromEntries(sc.hole_definitions.map(h => [h.hole_number, h]));
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
                        <td>Total</td><td>${sc.total_par}</td><td></td><td></td>
                        <td>${sc.total_score} (${overParStr(sc.total_score - sc.total_par)})</td>
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
