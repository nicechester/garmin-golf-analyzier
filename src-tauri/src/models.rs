use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const GARMIN_EPOCH_OFFSET: i64 = 631065600;

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
}

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
    // New fields
    pub min_altitude_meters: Option<f32>,
    pub max_altitude_meters: Option<f32>,
    pub avg_swing_tempo: Option<f32>,   // backswing/downswing ratio (e.g. 3.0)
    pub shots: Vec<GolfShot>,
    pub health_timeline: Vec<HealthSample>,
    pub scorecard: Option<Scorecard>,
}

impl GolfRound {
    pub fn start_datetime(&self) -> DateTime<Utc> {
        DateTime::from_timestamp(self.start_ts + GARMIN_EPOCH_OFFSET, 0)
            .unwrap_or_default()
    }
}

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
    // New fields
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
