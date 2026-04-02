use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const GARMIN_EPOCH_OFFSET: i64 = 631065600;

// ── GPS ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpsPoint {
    pub lat: f64,
    pub lon: f64,
}

impl GpsPoint {
    pub fn from_semicircles(lat: i32, lon: i32) -> Self {
        let factor = 180.0 / 2f64.powi(31);
        Self { lat: lat as f64 * factor, lon: lon as f64 * factor }
    }

    pub fn distance_meters_to(&self, other: &GpsPoint) -> f64 {
        let r = 6_371_000.0f64;
        let d_lat = (other.lat - self.lat).to_radians();
        let d_lon = (other.lon - self.lon).to_radians();
        let a = (d_lat / 2.0).sin().powi(2)
            + self.lat.to_radians().cos()
            * other.lat.to_radians().cos()
            * (d_lon / 2.0).sin().powi(2);
        r * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
    }
}

// ── Club ─────────────────────────────────────────────────────────────────────

/// Garmin club type enum (f2 in mesg #173)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClubType {
    Driver,
    Wood3,
    Wood5,
    Wood7,
    Hybrid,
    Iron2, Iron3, Iron4, Iron5, Iron6, Iron7, Iron8, Iron9,
    PitchingWedge,
    GapWedge,
    SandWedge,
    LobWedge,
    Putter,
    Unknown(u8),
}

impl ClubType {
    pub fn from_enum(v: u8) -> Self {
        match v {
            1  => ClubType::Driver,
            2  => ClubType::Wood3,
            3  => ClubType::Wood5,
            4  => ClubType::Wood7,
            5  | 6 => ClubType::Hybrid,
            7  => ClubType::Iron2,
            8  => ClubType::Iron3,
            9  => ClubType::Iron4,
            10 => ClubType::Iron5,
            11 => ClubType::Iron6,
            12 => ClubType::Iron7,  // not in data but standard
            13 => ClubType::Iron8,
            14 => ClubType::Iron5,  // re-check: f2=14 in data
            15 => ClubType::Iron6,
            16 => ClubType::Iron7,
            17 => ClubType::Iron8,
            18 => ClubType::Iron9,
            19 => ClubType::PitchingWedge,
            20 => ClubType::GapWedge,
            21 => ClubType::SandWedge,
            22 => ClubType::LobWedge,
            23 => ClubType::Putter,
            n  => ClubType::Unknown(n),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            ClubType::Driver        => "Driver",
            ClubType::Wood3         => "3-Wood",
            ClubType::Wood5         => "5-Wood",
            ClubType::Wood7         => "7-Wood",
            ClubType::Hybrid        => "Hybrid",
            ClubType::Iron2         => "2-Iron",
            ClubType::Iron3         => "3-Iron",
            ClubType::Iron4         => "4-Iron",
            ClubType::Iron5         => "5-Iron",
            ClubType::Iron6         => "6-Iron",
            ClubType::Iron7         => "7-Iron",
            ClubType::Iron8         => "8-Iron",
            ClubType::Iron9         => "9-Iron",
            ClubType::PitchingWedge => "PW",
            ClubType::GapWedge      => "GW",
            ClubType::SandWedge     => "SW",
            ClubType::LobWedge      => "LW",
            ClubType::Putter        => "Putter",
            ClubType::Unknown(_)    => "Unknown",
        }
    }

    pub fn category(&self) -> &'static str {
        match self {
            ClubType::Driver => "tee",
            ClubType::Wood3 | ClubType::Wood5 | ClubType::Wood7 | ClubType::Hybrid => "fairway_wood",
            ClubType::Iron2 | ClubType::Iron3 | ClubType::Iron4
            | ClubType::Iron5 | ClubType::Iron6 | ClubType::Iron7
            | ClubType::Iron8 | ClubType::Iron9 => "iron",
            ClubType::PitchingWedge | ClubType::GapWedge
            | ClubType::SandWedge   | ClubType::LobWedge => "wedge",
            ClubType::Putter => "putt",
            ClubType::Unknown(_) => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClubInfo {
    pub club_id: u64,
    pub club_type: ClubType,
    pub name: String,           // custom name or default
    pub avg_distance_cm: u32,   // f6
}

impl ClubInfo {
    #[allow(dead_code)]
    pub fn avg_distance_yards(&self) -> f64 { self.avg_distance_cm as f64 / 91.44 }
    #[allow(dead_code)]
    pub fn avg_distance_meters(&self) -> f64 { self.avg_distance_cm as f64 / 100.0 }
}

// ── Swing Tempo ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TempoSample {
    pub timestamp: i64,   // Garmin epoch
    pub ratio: f32,       // backswing/downswing ratio (e.g. 3.0 = 3:1)
}

// ── Health ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSample {
    pub timestamp: i64,
    pub position: Option<GpsPoint>,
    pub heart_rate: Option<u8>,
    pub stress_proxy: Option<u8>,
    pub body_battery: Option<u8>,
    pub distance_meters: Option<f64>,
    pub altitude_meters: Option<f64>,
}

// ── Shots ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GolfShot {
    pub timestamp: i64,
    pub shot_number: u32,
    pub position: Option<GpsPoint>,
    pub heart_rate_at_shot: Option<u8>,
    pub stress_at_shot: Option<u8>,
    pub is_drive: bool,
    pub distance_to_next_meters: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShotPosition {
    pub from: GpsPoint,
    pub to: GpsPoint,
    pub club_id: u64,
    pub club_name: Option<String>,
    pub club_category: Option<String>,
    pub distance_meters: Option<f64>,
    pub heart_rate: Option<u8>,
    pub altitude_meters: Option<f64>,
    pub swing_tempo: Option<f32>,
    pub timestamp: Option<i64>,   // Garmin epoch, matched from health timeline
}

// ── Scorecard ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoleScore {
    pub hole_number: u8,
    pub score: i8,
    pub putts: i8,
    pub fairway_hit: bool,
    pub shots: Vec<ShotPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoleDefinition {
    pub hole_number: u8,
    pub par: u8,
    pub handicap: u8,
    pub distance_cm: u32,
    pub tee_position: Option<GpsPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scorecard {
    pub course_id: u64,
    pub course_name: String,
    pub round_start_ts: i64,
    pub tee_time_ts: i64,
    pub round_end_ts: i64,
    pub front_par: u8,
    pub back_par: u8,
    pub total_par: u8,
    pub tee_color: String,
    pub course_rating: f32,
    pub slope: u8,
    pub player_name: String,
    pub front_score: u8,
    pub back_score: u8,
    pub total_score: u8,
    pub total_putts: u8,
    pub gir: u8,
    pub fairways_hit: u8,
    pub hole_definitions: Vec<HoleDefinition>,
    pub hole_scores: Vec<HoleScore>,
}

impl Scorecard {
    pub fn holes_played(&self) -> usize { self.hole_scores.len() }

    pub fn scored_par(&self) -> u8 {
        let par_map: std::collections::HashMap<u8, u8> = self.hole_definitions
            .iter().map(|h| (h.hole_number, h.par)).collect();
        self.hole_scores.iter()
            .map(|hs| par_map.get(&hs.hole_number).copied().unwrap_or(0))
            .sum()
    }

    pub fn score_over_par(&self) -> i16 {
        self.total_score as i16 - self.scored_par() as i16
    }
}

// ── Round ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GolfRound {
    pub id: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub duration_seconds: f32,
    pub distance_meters: f32,
    pub calories: Option<u16>,
    pub avg_heart_rate: Option<u8>,
    pub max_heart_rate: Option<u8>,
    pub total_ascent: Option<u16>,
    pub total_descent: Option<u16>,
    pub min_altitude_meters: Option<f32>,
    pub max_altitude_meters: Option<f32>,
    pub avg_swing_tempo: Option<f32>,
    #[serde(default)]
    pub tempo_timeline: Vec<TempoSample>,
    pub shots: Vec<GolfShot>,
    pub health_timeline: Vec<HealthSample>,
    pub scorecard: Option<Scorecard>,
    pub clubs: Vec<ClubInfo>,           // from Clubs.fit
}

impl GolfRound {
    pub fn start_datetime(&self) -> DateTime<Utc> {
        DateTime::from_timestamp(self.start_ts + GARMIN_EPOCH_OFFSET, 0)
            .unwrap_or_default()
    }
}

// ── Summary ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundSummary {
    pub id: String,
    pub date: String,
    pub time: String,
    pub course_name: String,
    pub total_score: u8,
    pub scored_par: u8,
    pub score_over_par: i16,
    pub holes_played: usize,
    pub duration_minutes: u32,
    pub distance_km: f32,
    pub avg_heart_rate: Option<u8>,
    pub calories: Option<u16>,
    pub total_putts: u8,
    pub gir: u8,
    pub fairways_hit: u8,
    pub min_altitude_meters: Option<f32>,
    pub max_altitude_meters: Option<f32>,
    pub avg_swing_tempo: Option<f32>,
}

impl From<&GolfRound> for RoundSummary {
    fn from(r: &GolfRound) -> Self {
        let dt = r.start_datetime();
        let sc = r.scorecard.as_ref();
        RoundSummary {
            id: r.id.clone(),
            date: dt.format("%Y-%m-%d").to_string(),
            time: dt.format("%H:%M").to_string(),
            course_name: sc.map(|s| s.course_name.clone()).unwrap_or_default(),
            total_score: sc.map(|s| s.total_score).unwrap_or(0),
            scored_par: sc.map(|s| s.scored_par()).unwrap_or(0),
            score_over_par: sc.map(|s| s.score_over_par()).unwrap_or(0),
            holes_played: sc.map(|s| s.holes_played()).unwrap_or(0),
            duration_minutes: (r.duration_seconds / 60.0) as u32,
            distance_km: r.distance_meters / 1000.0,
            avg_heart_rate: r.avg_heart_rate,
            calories: r.calories,
            total_putts: sc.map(|s| s.total_putts).unwrap_or(0),
            gir: sc.map(|s| s.gir).unwrap_or(0),
            fairways_hit: sc.map(|s| s.fairways_hit).unwrap_or(0),
            min_altitude_meters: r.min_altitude_meters,
            max_altitude_meters: r.max_altitude_meters,
            avg_swing_tempo: r.avg_swing_tempo,
        }
    }
}
