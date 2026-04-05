// ── NLG Template Library ─────────────────────────────────────────────────────
// Each template: { code, condition(d) → bool, severity, tier, messages: [(d) → string] }
// d = the analytics context object built by buildAnalyticsContext()
// severity: 'critical' | 'warning' | 'positive' | 'info'
// tier: 1 (most important) → 4 (minor/positive)
// pick(arr) selects a random variant for natural variety

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : 0; }
function sgFmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }
function abs(v) { return Math.abs(v); }

export const NLG_TEMPLATES = [

    // ── TIER 1: Critical SG weaknesses ───────────────────────────────────────

    {
        code: 'SG_PUTTING_CRITICAL',
        condition: d => d.sg.categories.putting < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Putting was the biggest hole in your scorecard today — you lost ${sgFmt(d.sg.categories.putting)} strokes on the greens. That's the single biggest area to address.`,
            d => `The putter cost you ${sgFmt(d.sg.categories.putting)} strokes today. Even recovering half of that would have saved ${abs(d.sg.categories.putting / 2).toFixed(1)} shots.`,
            d => `You gave away ${sgFmt(d.sg.categories.putting)} strokes putting — more than any other part of your game. Green reading and lag putting should be your practice priority.`,
        ]
    },
    {
        code: 'SG_APPROACH_CRITICAL',
        condition: d => d.sg.categories.approach < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Approach play was your Achilles heel today — ${sgFmt(d.sg.categories.approach)} strokes lost on shots into the green. Better iron proximity would have a huge scoring impact.`,
            d => `You lost ${sgFmt(d.sg.categories.approach)} strokes on approach shots. That's the equivalent of turning several pars into bogeys just from poor iron play.`,
            d => `Iron play cost you ${sgFmt(d.sg.categories.approach)} strokes today. Focus on distance control — getting the ball within 20 feet consistently is the goal.`,
        ]
    },
    {
        code: 'SG_OFF_TEE_CRITICAL',
        condition: d => d.sg.categories.off_tee < -1.5,
        severity: 'critical', tier: 1,
        messages: [
            d => `Tee shots were a major problem today — ${sgFmt(d.sg.categories.off_tee)} strokes lost off the tee. Errant drives put you in recovery mode all round.`,
            d => `You lost ${sgFmt(d.sg.categories.off_tee)} strokes off the tee. Finding more fairways would immediately reduce your score by taking difficult recovery shots out of the equation.`,
            d => `The driver cost you ${sgFmt(d.sg.categories.off_tee)} strokes. Consider trading distance for accuracy — a shorter club off the tee on tight holes could save several shots.`,
        ]
    },
    {
        code: 'SG_SHORT_GAME_CRITICAL',
        condition: d => d.sg.categories.short_game < -1.0,
        severity: 'critical', tier: 1,
        messages: [
            d => `Your short game lost you ${sgFmt(d.sg.categories.short_game)} strokes today. Shots inside 50 yards are where scores are made or broken — this needs work.`,
            d => `The scoring zone (inside 50 yards) cost you ${sgFmt(d.sg.categories.short_game)} strokes. Chipping and pitching practice would have an outsized impact on your scores.`,
            d => `You lost ${sgFmt(d.sg.categories.short_game)} strokes around the green. Getting up-and-down more consistently from short range is the fastest way to lower your score.`,
        ]
    },

    // ── TIER 1: Strong SG positives ──────────────────────────────────────────

    {
        code: 'SG_PUTTING_STRONG',
        condition: d => d.sg.categories.putting > 1.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `The putter was on fire today — you gained ${sgFmt(d.sg.categories.putting)} strokes putting. That's elite-level performance on the greens.`,
            d => `Putting was your superpower today at ${sgFmt(d.sg.categories.putting)} strokes gained. Your green reading and pace control were excellent.`,
            d => `You gained ${sgFmt(d.sg.categories.putting)} strokes with the putter — a genuine strength that saved your scorecard today.`,
        ]
    },
    {
        code: 'SG_APPROACH_STRONG',
        condition: d => d.sg.categories.approach > 1.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `Ball striking was excellent today — ${sgFmt(d.sg.categories.approach)} strokes gained on approach shots. You were hitting it close consistently.`,
            d => `Your iron play gained you ${sgFmt(d.sg.categories.approach)} strokes today. That kind of approach play gives you birdie looks and takes pressure off the putter.`,
            d => `${sgFmt(d.sg.categories.approach)} strokes gained on approach — your irons were the standout part of your game today.`,
        ]
    },
    {
        code: 'SG_TOTAL_POSITIVE',
        condition: d => d.sg.total > 2.0,
        severity: 'positive', tier: 1,
        messages: [
            d => `Overall you gained ${sgFmt(d.sg.total)} strokes against the single-digit baseline today — a genuinely strong performance across the board.`,
            d => `${sgFmt(d.sg.total)} total strokes gained is an impressive round. You outperformed the single-digit benchmark in multiple areas.`,
        ]
    },

    // ── TIER 2: Correlations ─────────────────────────────────────────────────

    {
        code: 'HIGH_FIR_LOW_GIR',
        condition: d => d.fir >= 55 && d.girPct < 35,
        severity: 'critical', tier: 2,
        messages: [
            d => `You hit ${d.fir}% of fairways but only ${d.girPct}% of greens — your driving is setting you up well but the irons aren't converting. Distance control on approach shots is the gap.`,
            d => `Great driving (${d.fir}% FIR) but only ${d.girPct}% GIR tells a clear story: the iron play isn't capitalizing on good tee shots. Focus on mid-iron proximity.`,
            d => `${d.fir}% fairways hit is solid, but ${d.girPct}% GIR means you're leaving shots out there. Your approach distances suggest a club selection or distance control issue.`,
        ]
    },
    {
        code: 'LOW_FIR_HIGH_GIR',
        condition: d => d.fir < 35 && d.girPct >= 50,
        severity: 'info', tier: 2,
        messages: [
            d => `Interesting pattern — only ${d.fir}% fairways hit but ${d.girPct}% GIR. Your iron play is bailing out your driving. Imagine the scoring potential if you combined both.`,
            d => `You're hitting ${d.girPct}% of greens despite only ${d.fir}% fairways — impressive recovery iron play. Cleaning up the tee shots would make you even more dangerous.`,
        ]
    },
    {
        code: 'THREE_PUTTS',
        condition: d => d.threePutts >= 2,
        severity: 'critical', tier: 2,
        messages: [
            d => `${d.threePutts} three-putts today — each one is a direct stroke wasted. Lag putting from long range is costing you. Focus on getting the first putt within 3 feet.`,
            d => `You three-putted ${d.threePutts} times. That alone accounts for ${d.threePutts} extra strokes. Distance control on long putts should be your putting practice focus.`,
            d => `${d.threePutts} three-putts is a scorecard killer. Speed control on putts over 20 feet would eliminate most of these.`,
        ]
    },
    {
        code: 'GOOD_SCRAMBLING',
        condition: d => d.scramblingPct >= 50 && d.girPct < 45,
        severity: 'positive', tier: 2,
        messages: [
            d => `You only hit ${d.girPct}% of greens but scrambled well — your short game saved several shots today. That fighting spirit kept the score respectable.`,
            d => `Missing ${100 - d.girPct}% of greens but still scoring well shows strong short game resilience. Your up-and-down ability is a real asset.`,
        ]
    },
    {
        code: 'POOR_SCRAMBLING',
        condition: d => d.scramblingPct < 25 && d.girPct < 45,
        severity: 'critical', tier: 2,
        messages: [
            d => `You missed ${100 - d.girPct}% of greens and only scrambled ${d.scramblingPct}% of the time — a double whammy. Chipping and putting from off the green needs significant work.`,
            d => `Missing greens and failing to get up-and-down (${d.scramblingPct}% scrambling) is the most expensive combination in golf. Short game practice would have the biggest impact on your scores.`,
        ]
    },
    {
        code: 'HIGH_STRESS_POOR_SG',
        condition: d => d.avgStress > 55 && d.sg.total < -1.0,
        severity: 'warning', tier: 2,
        messages: [
            d => `Your average stress was ${d.avgStress} today and your SG was ${sgFmt(d.sg.total)} — high stress and poor performance often go hand in hand. Pre-shot routine and course management may help.`,
            d => `Elevated stress (avg ${d.avgStress}) combined with ${sgFmt(d.sg.total)} strokes gained suggests mental pressure may be affecting your swing. Breathing and routine work could help.`,
        ]
    },
    {
        code: 'HIGH_HR_LATE_ROUND',
        condition: d => d.lateRoundHr > d.earlyRoundHr + 8,
        severity: 'info', tier: 2,
        messages: [
            d => `Your heart rate climbed ${Math.round(d.lateRoundHr - d.earlyRoundHr)} bpm from the front to back nine — fatigue or pressure may have been a factor in the later holes.`,
            d => `HR was notably higher on the back nine (${Math.round(d.lateRoundHr)} vs ${Math.round(d.earlyRoundHr)} bpm). Physical conditioning or managing pressure late in rounds could be worth working on.`,
        ]
    },
    {
        code: 'BODY_BATTERY_LOW',
        condition: d => d.bbEnd != null && d.bbEnd < 20,
        severity: 'warning', tier: 2,
        messages: [
            d => `Your Body Battery finished at ${d.bbEnd}% — you were running on empty by the end. Recovery before your next round is important.`,
            d => `Ending the round at ${d.bbEnd}% Body Battery suggests significant physical exertion. Sleep and recovery quality will affect your next performance.`,
        ]
    },
    {
        code: 'BODY_BATTERY_DRAIN_HIGH',
        condition: d => d.bbDrain != null && d.bbDrain > 40,
        severity: 'info', tier: 2,
        messages: [
            d => `You drained ${d.bbDrain}% Body Battery today — a demanding round physically. Make sure to prioritize recovery.`,
            d => `A ${d.bbDrain}% Body Battery drain is significant. Golf is more physically demanding than it looks, especially walking a full round.`,
        ]
    },
    {
        code: 'FRONT_BACK_SPLIT_WORSE',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.backNineScore > d.frontNineScore + 4,
        severity: 'warning', tier: 2,
        messages: [
            d => `You scored ${d.frontNineScore} on the front but ${d.backNineScore} on the back — a ${d.backNineScore - d.frontNineScore} shot drop-off. Fatigue or concentration may be fading late in rounds.`,
            d => `Front nine: ${d.frontNineScore}, back nine: ${d.backNineScore}. That's a significant fade. Consider your energy management and course strategy for the second half.`,
        ]
    },
    {
        code: 'FRONT_BACK_SPLIT_BETTER',
        condition: d => d.backNineScore != null && d.frontNineScore != null && d.frontNineScore > d.backNineScore + 3,
        severity: 'positive', tier: 2,
        messages: [
            d => `Strong finish — you improved ${d.frontNineScore - d.backNineScore} shots from front (${d.frontNineScore}) to back (${d.backNineScore}). You play better when warmed up.`,
            d => `Back nine (${d.backNineScore}) was much better than the front (${d.frontNineScore}). You clearly found your rhythm as the round progressed.`,
        ]
    },
    {
        code: 'PAR3_STRUGGLES',
        condition: d => d.par3AvgOverPar > 0.8,
        severity: 'warning', tier: 2,
        messages: [
            d => `Par 3s averaged +${d.par3AvgOverPar.toFixed(1)} over par today — tee shots on short holes are costing you. Iron accuracy from the tee needs attention.`,
            d => `You struggled on par 3s (avg +${d.par3AvgOverPar.toFixed(1)}). These holes should be birdie or par opportunities — focus on hitting the green from the tee.`,
        ]
    },
    {
        code: 'PAR5_SCORING',
        condition: d => d.par5AvgOverPar > 0.5,
        severity: 'warning', tier: 2,
        messages: [
            d => `Par 5s averaged +${d.par5AvgOverPar.toFixed(1)} today — these scoring holes aren't yielding birdies. Layup strategy and short game on par 5s could unlock lower scores.`,
            d => `You're not taking advantage of par 5s (avg +${d.par5AvgOverPar.toFixed(1)}). Better course management — knowing when to go for it vs lay up — could save strokes here.`,
        ]
    },
    {
        code: 'PAR5_BIRDIE_MACHINE',
        condition: d => d.par5AvgOverPar < -0.3,
        severity: 'positive', tier: 2,
        messages: [
            d => `Par 5s are your scoring holes — averaging ${d.par5AvgOverPar.toFixed(1)} today. Your length and course management on these holes is a real strength.`,
            d => `You're eating up par 5s (avg ${d.par5AvgOverPar.toFixed(1)}). That's where your game is most dangerous.`,
        ]
    },
    {
        code: 'CONSECUTIVE_BOGEYS',
        condition: d => d.maxConsecutiveBogeys >= 3,
        severity: 'warning', tier: 2,
        messages: [
            d => `You had a run of ${d.maxConsecutiveBogeys} consecutive bogeys — momentum killers like this often come from one bad shot snowballing. Damage limitation and reset routines are key.`,
            d => `${d.maxConsecutiveBogeys} bogeys in a row at some point today. Breaking bad streaks early — taking your medicine and moving on — is a crucial mental skill.`,
        ]
    },

    // ── TIER 3: Club-specific ─────────────────────────────────────────────────

    {
        code: 'WORST_CLUB_SG',
        condition: d => d.worstClub != null && d.worstClub.avgSg < -0.3,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your ${d.worstClub.name} was your weakest club today (avg SG ${sgFmt(d.worstClub.avgSg)} over ${d.worstClub.shots} shots). Consider whether club selection or technique is the issue.`,
            d => `The ${d.worstClub.name} cost you the most strokes per shot (${sgFmt(d.worstClub.avgSg)} avg SG). It may be worth avoiding it in key situations until you've worked on it.`,
            d => `${d.worstClub.name} was a liability today — ${sgFmt(d.worstClub.avgSg)} avg SG. Targeted practice with this club would pay dividends.`,
        ]
    },
    {
        code: 'BEST_CLUB_SG',
        condition: d => d.bestClub != null && d.bestClub.avgSg > 0.2,
        severity: 'positive', tier: 3,
        messages: [
            d => `Your ${d.bestClub.name} was your best club today — ${sgFmt(d.bestClub.avgSg)} avg SG over ${d.bestClub.shots} shots. Lean on it when you need a reliable shot.`,
            d => `The ${d.bestClub.name} was dialed in today (${sgFmt(d.bestClub.avgSg)} avg SG). That's a club you can trust under pressure.`,
        ]
    },
    {
        code: 'DRIVER_INCONSISTENT',
        condition: d => d.driverClub != null && d.driverClub.distStd > 30,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver had high distance variance (±${Math.round(d.driverClub.distStd)} yds) — some big ones and some short ones. A more controlled, repeatable swing may trade a little distance for a lot more consistency.`,
            d => `Driver distance was all over the place today (±${Math.round(d.driverClub.distStd)} yds std dev). Tee it down slightly and focus on center contact over maximum distance.`,
        ]
    },
    {
        code: 'DRIVER_RIGHT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev > 12,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver has a consistent right bias (+${Math.round(d.driverClub.avgDev)}° avg) — a push or push-fade pattern. Check your alignment and club face at impact.`,
            d => `Tee shots are trending right (+${Math.round(d.driverClub.avgDev)}° avg deviation). This could be alignment, an open face, or an out-to-in swing path. Worth checking on the range.`,
        ]
    },
    {
        code: 'DRIVER_LEFT_BIAS',
        condition: d => d.driverClub != null && d.driverClub.avgDev < -12,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your Driver is pulling left (${Math.round(d.driverClub.avgDev)}° avg) — a hook or pull pattern. Check your grip pressure and swing path.`,
            d => `Tee shots are consistently left (${Math.round(d.driverClub.avgDev)}° avg deviation). A closed face or in-to-out path is likely the cause.`,
        ]
    },
    {
        code: 'IRONS_RIGHT_BIAS',
        condition: d => d.ironBias > 15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your irons have a consistent right bias (+${Math.round(d.ironBias)}° avg) — a push or fade pattern. This is likely a systematic swing issue worth addressing on the range.`,
            d => `Iron shots are trending right (+${Math.round(d.ironBias)}° avg). Check your ball position and ensure your body is aligned left of the target, not the club face.`,
        ]
    },
    {
        code: 'IRONS_LEFT_BIAS',
        condition: d => d.ironBias < -15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Your irons are pulling left (${Math.round(d.ironBias)}° avg) — a pull or draw pattern. Check your takeaway and ensure you're not coming over the top.`,
            d => `Iron shots consistently miss left (${Math.round(d.ironBias)}° avg deviation). An over-the-top swing path or closed face at impact is the likely culprit.`,
        ]
    },
    {
        code: 'WEDGE_INCONSISTENT',
        condition: d => d.wedgeClub != null && d.wedgeClub.distStd > 15,
        severity: 'warning', tier: 3,
        messages: [
            d => `Wedge distances were inconsistent today (±${Math.round(d.wedgeClub.distStd)} yds). Dialing in your wedge yardages through practice is one of the highest-ROI things you can do.`,
            d => `Your wedge play had high variance (±${Math.round(d.wedgeClub.distStd)} yds std dev). Knowing your exact carry distances for each wedge is critical for scoring.`,
        ]
    },
    {
        code: 'WEDGE_STRONG',
        condition: d => d.wedgeClub != null && d.wedgeClub.avgSg > 0.15,
        severity: 'positive', tier: 3,
        messages: [
            d => `Wedge play was a strength today — ${sgFmt(d.wedgeClub.avgSg)} avg SG. Your distance control inside 100 yards is giving you birdie looks.`,
            d => `Your wedges were dialed in today (${sgFmt(d.wedgeClub.avgSg)} avg SG). That kind of short game precision is what separates good rounds from great ones.`,
        ]
    },

    // ── TIER 3: Dispersion patterns ───────────────────────────────────────────

    {
        code: 'APPROACH_SHORT_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.shortPct > 55,
        severity: 'warning', tier: 3,
        messages: [
            d => `You're leaving approach shots short ${d.approachDispersion.shortPct}% of the time from ${d.approachDispersion.label}. Club up — most amateur golfers consistently underclub on approach shots.`,
            d => `${d.approachDispersion.shortPct}% of your approach shots from ${d.approachDispersion.label} came up short. Take one more club and make a smooth swing rather than forcing a longer club.`,
        ]
    },
    {
        code: 'APPROACH_LONG_PATTERN',
        condition: d => d.approachDispersion != null && d.approachDispersion.longPct > 45,
        severity: 'warning', tier: 3,
        messages: [
            d => `You're flying approach shots long ${d.approachDispersion.longPct}% of the time from ${d.approachDispersion.label}. Check your yardages — adrenaline or wind may be adding distance.`,
            d => `${d.approachDispersion.longPct}% of approaches from ${d.approachDispersion.label} went long. Club down and focus on solid contact rather than swinging harder.`,
        ]
    },
    {
        code: 'DISPERSION_TIGHT',
        condition: d => d.overallDispersionAngle < 12 && d.sg.catCounts.approach >= 4,
        severity: 'positive', tier: 3,
        messages: [
            d => `Your shot dispersion was tight today (avg ${Math.round(d.overallDispersionAngle)}° deviation) — you were hitting it consistently in the same direction. That's a sign of a repeatable swing.`,
            d => `Directional consistency was strong today — only ${Math.round(d.overallDispersionAngle)}° average deviation. A repeatable ball flight makes course management much easier.`,
        ]
    },

    // ── TIER 4: Minor observations & positives ────────────────────────────────

    {
        code: 'ONE_PUTTS_HIGH',
        condition: d => d.onePutts >= 4,
        severity: 'positive', tier: 4,
        messages: [
            d => `${d.onePutts} one-putts today — you were holing out from close range consistently. That's a real scoring asset.`,
            d => `${d.onePutts} one-putts is excellent. Your ability to convert from short range kept the scorecard clean.`,
        ]
    },
    {
        code: 'PUTTING_DISTANCE_CONTROL',
        condition: d => d.threePutts === 0 && d.sc?.total_putts <= d.sc?.hole_scores?.length * 1.8,
        severity: 'positive', tier: 4,
        messages: [
            d => `Zero three-putts today — your lag putting distance control was excellent. That's a sign of good green reading and pace judgment.`,
            d => `No three-putts is a great achievement. Your distance control on long putts kept you out of trouble all round.`,
        ]
    },
    {
        code: 'DISTANCE_WALKED',
        condition: d => d.distanceKm > 8,
        severity: 'info', tier: 4,
        messages: [
            d => `You walked ${d.distanceKm.toFixed(1)} km today — golf is more of a workout than people give it credit for. Good physical conditioning helps maintain focus late in rounds.`,
        ]
    },
    {
        code: 'ALTITUDE_RANGE',
        condition: d => d.altRange > 30,
        severity: 'info', tier: 4,
        messages: [
            d => `The course had ${Math.round(d.altRange)}m of elevation change today. Remember that altitude affects ball flight — uphill shots play longer, downhill shots play shorter.`,
            d => `Significant elevation change (${Math.round(d.altRange)}m) means club selection needs to account for uphill and downhill lies. This is a skill that improves with course experience.`,
        ]
    },
    {
        code: 'SWING_TEMPO_FAST',
        condition: d => d.avgTempo != null && d.avgTempo < 2.5,
        severity: 'warning', tier: 4,
        messages: [
            d => `Your avg swing tempo was ${d.avgTempo.toFixed(1)}:1 today — on the fast side. A slightly longer backswing pause often leads to better sequencing and more consistent contact.`,
            d => `Tempo at ${d.avgTempo.toFixed(1)}:1 is quick. Many tour pros are around 3:1. Slowing the transition slightly can improve both distance and accuracy.`,
        ]
    },
    {
        code: 'SWING_TEMPO_GOOD',
        condition: d => d.avgTempo != null && d.avgTempo >= 2.8 && d.avgTempo <= 3.5,
        severity: 'positive', tier: 4,
        messages: [
            d => `Your swing tempo (${d.avgTempo.toFixed(1)}:1) is in the ideal range. Good tempo is the foundation of consistent ball striking.`,
            d => `Tempo was solid today at ${d.avgTempo.toFixed(1)}:1 — right in the zone for consistent, powerful swings.`,
        ]
    },
    {
        code: 'ROUND_DURATION_LONG',
        condition: d => d.durationMin > 270,
        severity: 'info', tier: 4,
        messages: [
            d => `The round took ${Math.round(d.durationMin)} minutes — a long day out. Mental fatigue over 4+ hours can affect decision-making and focus on the back nine.`,
        ]
    },
    {
        code: 'SG_BALANCED',
        condition: d => Object.values(d.sg.categories).every(v => Math.abs(v) < 0.5),
        severity: 'info', tier: 4,
        messages: [
            d => `Your strokes gained were balanced across all categories today — no single area was a disaster or a standout. Consistent all-round play is a solid foundation.`,
            d => `No glaring weaknesses in the SG numbers today — everything was within half a stroke of baseline. That kind of balance is hard to achieve.`,
        ]
    },
];
