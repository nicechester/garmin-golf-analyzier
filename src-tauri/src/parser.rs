use std::collections::BTreeMap;
use std::path::Path;
use fitparser::{FitDataRecord, Value, profile::MesgNum};
use crate::models::*;

const MESG_SESSION:    u16 = 18;
const MESG_RECORD:     u16 = 20;
const MESG_SHOT:       u16 = 325;
const MESG_SWING:      u16 = 104;
const MESG_ROUND_INFO: u16 = 190;
const MESG_PLAYER:     u16 = 191;
const MESG_HOLE_SCORE: u16 = 192;
const MESG_HOLE_DEF:   u16 = 193;
const MESG_SHOT_POS:   u16 = 194;
const MESG_CLUB_DEF:   u16 = 173;

fn field_u64(record: &FitDataRecord, num: u8) -> Option<u64> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::UInt8(v)  => Some(*v as u64),
        Value::UInt16(v) => Some(*v as u64),
        Value::UInt32(v) => Some(*v as u64),
        Value::UInt64(v) => Some(*v),
        _ => None,
    })
}

fn field_i64(record: &FitDataRecord, num: u8) -> Option<i64> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::SInt8(v)  => Some(*v as i64),
        Value::SInt16(v) => Some(*v as i64),
        Value::SInt32(v) => Some(*v as i64),
        Value::SInt64(v) => Some(*v),
        Value::UInt8(v)  => Some(*v as i64),
        Value::UInt16(v) => Some(*v as i64),
        Value::UInt32(v) => Some(*v as i64),
        Value::Timestamp(t) => Some(t.timestamp() - GARMIN_EPOCH_OFFSET),
        _ => None,
    })
}

fn field_f32(record: &FitDataRecord, num: u8) -> Option<f32> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::Float32(v) => Some(*v),
        Value::Float64(v) => Some(*v as f32),
        _ => None,
    })
}

fn field_any_f32(record: &FitDataRecord, num: u8) -> Option<f32> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::UInt8(v)   => Some(*v as f32),
        Value::UInt16(v)  => Some(*v as f32),
        Value::UInt32(v)  => Some(*v as f32),
        Value::SInt8(v)   => Some(*v as f32),
        Value::SInt16(v)  => Some(*v as f32),
        Value::SInt32(v)  => Some(*v as f32),
        Value::Float32(v) => Some(*v),
        Value::Float64(v) => Some(*v as f32),
        _ => None,
    })
}

fn field_str(record: &FitDataRecord, num: u8) -> Option<String> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::String(s) => Some(s.clone()),
        _ => None,
    })
}

fn field_enum_u8(record: &FitDataRecord, num: u8) -> Option<u8> {
    record.fields().iter().find(|f| f.number() == num).and_then(|f| match f.value() {
        Value::Enum(v)  => Some(*v),
        Value::UInt8(v) => Some(*v),
        _ => None,
    })
}

fn mesg_num(record: &FitDataRecord) -> u16 {
    match record.kind() {
        MesgNum::Session     => MESG_SESSION,
        MesgNum::Record      => MESG_RECORD,
        MesgNum::GpsMetadata => 160,
        MesgNum::Value(n)    => n,
        _ => 0,
    }
}

// ── Clubs.fit parser ─────────────────────────────────────────────────────────

pub fn parse_clubs(path: &Path) -> Result<Vec<ClubInfo>, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {}: {}", path.display(), e))?;
    let records = fitparser::from_reader(&mut file)
        .map_err(|e| format!("FIT parse error: {}", e))?;

    let mut clubs = Vec::new();
    for record in &records {
        if mesg_num(record) == MESG_CLUB_DEF {
            let club_id      = field_u64(record, 1).unwrap_or(0);
            let type_enum    = field_enum_u8(record, 2).unwrap_or(0);
            let custom_name  = field_str(record, 3).unwrap_or_default();
            let avg_dist_cm  = field_u64(record, 6).unwrap_or(0) as u32;
            let club_type    = ClubType::from_enum(type_enum);
            let name = if custom_name.is_empty() {
                club_type.name().to_string()
            } else {
                custom_name
            };
            clubs.push(ClubInfo { club_id, club_type, name, avg_distance_cm: avg_dist_cm });
        }
    }
    Ok(clubs)
}

// ── Activity parser ──────────────────────────────────────────────────────────

pub fn parse_activity(path: &Path) -> Result<GolfRound, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {}: {}", path.display(), e))?;
    let records = fitparser::from_reader(&mut file)
        .map_err(|e| format!("FIT parse error: {}", e))?;

    let mut start_ts: i64 = 0;
    let mut end_ts: i64 = 0;
    let mut duration: f32 = 0.0;
    let mut distance: f32 = 0.0;
    let mut calories: Option<u16> = None;
    let mut avg_hr: Option<u8> = None;
    let mut max_hr: Option<u8> = None;
    let mut ascent: Option<u16> = None;
    let mut descent: Option<u16> = None;
    let mut health: Vec<HealthSample> = Vec::new();
    let mut raw_shots: Vec<(i64, bool)> = Vec::new();
    let mut alt_min: Option<f32> = None;
    let mut alt_max: Option<f32> = None;
    let mut tempo_samples: Vec<TempoSample> = Vec::new();

    for record in &records {
        match mesg_num(record) {
            MESG_SESSION => {
                if let Some(v) = field_i64(record, 2)   { start_ts = v; }
                if let Some(v) = field_i64(record, 253) { end_ts = v; }
                if let Some(v) = field_f32(record, 8)   { duration = v; }
                if let Some(v) = field_f32(record, 9)   { distance = v; }
                if let Some(v) = field_u64(record, 11)  { calories = Some(v as u16); }
                if let Some(v) = field_u64(record, 16)  { avg_hr = Some(v as u8); }
                if let Some(v) = field_u64(record, 17)  { max_hr = Some(v as u8); }
                if let Some(v) = field_u64(record, 22)  { ascent = Some(v as u16); }
                if let Some(v) = field_u64(record, 23)  { descent = Some(v as u16); }
            }
            MESG_RECORD => {
                let ts = match field_i64(record, 253) { Some(v) => v, None => continue };
                let pos = match (field_i64(record, 0), field_i64(record, 1)) {
                    (Some(lat), Some(lon)) => Some(GpsPoint::from_semicircles(lat as i32, lon as i32)),
                    _ => None,
                };
                let hr     = field_u64(record, 3).map(|v| v as u8);
                let stress = field_u64(record, 135).map(|v| (v as u8).min(100));
                let bb     = field_u64(record, 143).map(|v| v as u8);
                let dist   = field_f32(record, 5).map(|v| v as f64);
                let alt    = field_f32(record, 78).map(|v| v as f64);
                health.push(HealthSample { timestamp: ts, position: pos, heart_rate: hr,
                    stress_proxy: stress, body_battery: bb, distance_meters: dist,
                    altitude_meters: alt });
            }
            160 => {
                if let Some(alt) = field_f32(record, 3) {
                    alt_min = Some(alt_min.map_or(alt, |m: f32| m.min(alt)));
                    alt_max = Some(alt_max.map_or(alt, |m: f32| m.max(alt)));
                }
            }
            MESG_SWING => {
                let ts = match field_i64(record, 253) { Some(v) => v, None => continue };
                if let (Some(back_ms), Some(down_cs)) = (field_any_f32(record, 0), field_any_f32(record, 3)) {
                    if down_cs > 0.0 {
                        let ratio = back_ms / (down_cs * 10.0); // f0=ms, f3=centiseconds
                        if ratio >= 1.5 && ratio <= 6.0 {
                            tempo_samples.push(TempoSample { timestamp: ts, ratio });
                        }
                    }
                }
            }
            MESG_SHOT => {
                let ts = match field_i64(record, 253) { Some(v) => v, None => continue };
                let f0 = field_u64(record, 0).unwrap_or(0);
                let f2 = field_u64(record, 2).unwrap_or(0);
                if f0 != 0 { raw_shots.push((ts, f2 == 1)); }
            }
            _ => {}
        }
    }

    let avg_swing_tempo = if tempo_samples.is_empty() { None }
        else { Some(tempo_samples.iter().map(|s| s.ratio).sum::<f32>() / tempo_samples.len() as f32) };

    // Build health index for shot correlation
    let health_index: BTreeMap<i64, usize> = health.iter().enumerate()
        .map(|(i, s)| (s.timestamp, i)).collect();

    let nearest = |ts: i64| -> Option<&HealthSample> {
        let floor = health_index.range(..=ts).next_back();
        let ceil  = health_index.range(ts..).next();
        match (floor, ceil) {
            (None, None) => None,
            (Some((_, &i)), None) => Some(&health[i]),
            (None, Some((_, &i))) => Some(&health[i]),
            (Some((&ft, &fi)), Some((&ct, &ci))) =>
                if ts - ft <= ct - ts { Some(&health[fi]) } else { Some(&health[ci]) }
        }
    };

    let mut shots: Vec<GolfShot> = raw_shots.iter().enumerate().map(|(i, &(ts, is_drive))| {
        let sample = nearest(ts);
        GolfShot {
            timestamp: ts,
            shot_number: (i + 1) as u32,
            position: sample.and_then(|s| s.position.clone()),
            heart_rate_at_shot: sample.and_then(|s| s.heart_rate),
            stress_at_shot: sample.and_then(|s| s.stress_proxy),
            is_drive,
            distance_to_next_meters: None,
        }
    }).collect();

    for i in 0..shots.len().saturating_sub(1) {
        if let (Some(a), Some(b)) = (shots[i].position.clone(), shots[i+1].position.clone()) {
            shots[i].distance_to_next_meters = Some(a.distance_meters_to(&b));
        }
    }

    Ok(GolfRound {
        id: String::new(),
        start_ts, end_ts, duration_seconds: duration, distance_meters: distance,
        calories, avg_heart_rate: avg_hr, max_heart_rate: max_hr,
        total_ascent: ascent, total_descent: descent,
        min_altitude_meters: alt_min, max_altitude_meters: alt_max,
        avg_swing_tempo, tempo_timeline: tempo_samples, shots, health_timeline: health,
        scorecard: None, clubs: Vec::new(),
    })
}

// ── Scorecard parser ─────────────────────────────────────────────────────────

pub fn parse_scorecard(path: &Path) -> Result<Scorecard, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {}: {}", path.display(), e))?;
    let records = fitparser::from_reader(&mut file)
        .map_err(|e| format!("FIT parse error: {}", e))?;

    let mut course_id: u64 = 0;
    let mut course_name = String::new();
    let mut round_start_ts: i64 = 0;
    let mut tee_time_ts: i64 = 0;
    let mut round_end_ts: i64 = 0;
    let mut front_par: u8 = 0;
    let mut back_par: u8 = 0;
    let mut total_par: u8 = 0;
    let mut tee_color = String::new();
    let mut course_rating: f32 = 0.0;
    let mut slope: u8 = 0;
    let mut player_name = String::from("Player1");
    let mut front_score: u8 = 0;
    let mut back_score: u8 = 0;
    let mut total_score: u8 = 0;
    let mut total_putts: u8 = 0;
    let mut gir: u8 = 0;
    let mut fairways_hit: u8 = 0;
    let mut hole_defs: Vec<HoleDefinition> = Vec::new();
    let mut hole_scores: Vec<HoleScore> = Vec::new();
    let mut shots_by_hole: BTreeMap<u8, Vec<ShotPosition>> = BTreeMap::new();

    for record in &records {
        match mesg_num(record) {
            MESG_ROUND_INFO => {
                course_id      = field_u64(record, 0).unwrap_or(0);
                course_name    = field_str(record, 1).unwrap_or_default();
                round_start_ts = field_i64(record, 2).unwrap_or(0);
                tee_time_ts    = field_i64(record, 3).unwrap_or(0);
                round_end_ts   = field_i64(record, 4).unwrap_or(0);
                front_par      = field_u64(record, 8).unwrap_or(0) as u8;
                back_par       = field_u64(record, 9).unwrap_or(0) as u8;
                total_par      = field_u64(record, 10).unwrap_or(0) as u8;
                tee_color      = field_str(record, 11).unwrap_or_default();
                slope          = field_u64(record, 12).unwrap_or(0) as u8;
                course_rating  = field_f32(record, 21).unwrap_or(0.0);
            }
            MESG_PLAYER => {
                player_name  = field_str(record, 0).unwrap_or_else(|| "Player1".into());
                front_score  = field_u64(record, 2).unwrap_or(0) as u8;
                back_score   = field_u64(record, 3).unwrap_or(0) as u8;
                total_score  = field_u64(record, 4).unwrap_or(0) as u8;
                gir          = field_u64(record, 8).unwrap_or(0) as u8;
                total_putts  = field_u64(record, 9).unwrap_or(0) as u8;
                fairways_hit = field_u64(record, 7).unwrap_or(0) as u8;
            }
            MESG_HOLE_DEF => {
                let hole_num = field_u64(record, 0).unwrap_or(0) as u8;
                let par      = field_u64(record, 2).unwrap_or(0) as u8;
                let handicap = field_u64(record, 3).unwrap_or(0) as u8;
                let dist_cm  = field_u64(record, 1).unwrap_or(0) as u32;
                let tee_pos  = match (field_i64(record, 4), field_i64(record, 5)) {
                    (Some(lat), Some(lon)) => Some(GpsPoint::from_semicircles(lat as i32, lon as i32)),
                    _ => None,
                };
                hole_defs.push(HoleDefinition { hole_number: hole_num, par, handicap,
                    distance_cm: dist_cm, tee_position: tee_pos });
            }
            MESG_HOLE_SCORE => {
                let hole_num    = field_i64(record, 1).unwrap_or(0) as u8;
                let score       = field_i64(record, 2).unwrap_or(0) as i8;
                let putts       = field_i64(record, 5).unwrap_or(0) as i8;
                let f6          = field_u64(record, 6).unwrap_or(0);
                let fairway_hit = f6 == 2;
                hole_scores.push(HoleScore { hole_number: hole_num, score, putts,
                    fairway_hit, shots: Vec::new() });
            }
            MESG_SHOT_POS => {
                let hole = field_i64(record, 1).unwrap_or(0) as u8;
                if let (Some(f2), Some(f3), Some(f4), Some(f5)) = (
                    field_i64(record, 2), field_i64(record, 3),
                    field_i64(record, 4), field_i64(record, 5),
                ) {
                    let from    = GpsPoint::from_semicircles(f2 as i32, f3 as i32);
                    let to      = GpsPoint::from_semicircles(f4 as i32, f5 as i32);
                    let club_id = field_u64(record, 7).unwrap_or(0);
                    let dist    = Some(from.distance_meters_to(&to));
                    shots_by_hole.entry(hole).or_default().push(ShotPosition {
                        from, to, club_id,
                        club_name: None, club_category: None,
                        distance_meters: dist,
                        heart_rate: None, altitude_meters: None, swing_tempo: None,
                        timestamp: None,
                    });
                }
            }
            _ => {}
        }
    }

    for hs in &mut hole_scores {
        if let Some(shots) = shots_by_hole.remove(&hs.hole_number) {
            hs.shots = shots;
        }
    }
    hole_scores.sort_by_key(|h| h.hole_number);
    hole_defs.sort_by_key(|h| h.hole_number);

    Ok(Scorecard {
        course_id, course_name, round_start_ts, tee_time_ts, round_end_ts,
        front_par, back_par, total_par, tee_color, course_rating, slope,
        player_name, front_score, back_score, total_score, total_putts, gir,
        fairways_hit, hole_definitions: hole_defs, hole_scores,
    })
}

/// Enrich scorecard shot positions with club info and health data from the activity.
pub fn enrich_shots(scorecard: &mut Scorecard, clubs: &[ClubInfo], health: &[HealthSample], tempo: &[TempoSample]) {
    let club_map: std::collections::HashMap<u64, &ClubInfo> =
        clubs.iter().map(|c| (c.club_id, c)).collect();

    // Build health index by timestamp
    let health_index: BTreeMap<i64, usize> = health.iter().enumerate()
        .map(|(i, s)| (s.timestamp, i)).collect();

    let nearest_health = |ts: i64| -> Option<&HealthSample> {
        let floor = health_index.range(..=ts).next_back();
        let ceil  = health_index.range(ts..).next();
        match (floor, ceil) {
            (None, None) => None,
            (Some((_, &i)), None) => Some(&health[i]),
            (None, Some((_, &i))) => Some(&health[i]),
            (Some((&ft, &fi)), Some((&ct, &ci))) =>
                if ts - ft <= ct - ts { Some(&health[fi]) } else { Some(&health[ci]) }
        }
    };

    // We don't have per-shot timestamps in scorecard shots, so use GPS proximity
    // to find the nearest health sample
    for hs in &mut scorecard.hole_scores {
        for shot in &mut hs.shots {
            // Enrich with club info (skip id=0 = no club recorded)
            if shot.club_id > 0 {
                if let Some(club) = club_map.get(&shot.club_id) {
                    shot.club_name     = Some(club.name.clone());
                    shot.club_category = Some(club.club_type.category().to_string());
                }
            }
            // Find nearest health sample by GPS proximity to shot.from
            let mut best_ts: Option<i64> = None;
            let mut best_dist = f64::MAX;
            for s in health {
                if let Some(pos) = &s.position {
                    let d = pos.distance_meters_to(&shot.from);
                    if d < best_dist {
                        best_dist = d;
                        best_ts = Some(s.timestamp);
                    }
                }
            }
            if let Some(ts) = best_ts {
                if let Some(sample) = nearest_health(ts) {
                    shot.heart_rate      = sample.heart_rate;
                    shot.altitude_meters = sample.altitude_meters;
                    shot.timestamp       = Some(sample.timestamp);
                }
                // Nearest tempo sample by timestamp
                if !tempo.is_empty() {
                    let best_tempo = tempo.iter().min_by_key(|t| (t.timestamp - best_ts.unwrap()).abs());
                    shot.swing_tempo = best_tempo.map(|t| t.ratio);
                }
            }
        }
    }
}
