#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod parser;
mod store;
mod mtp;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use sha2::Digest;
use models::{GolfRound, RoundSummary};
use store::Store;
use tauri::State;

struct AppState {
    store: Mutex<Store>,
    fit_dir: PathBuf,
}

fn hash_file(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_default();
    let mut h = sha2::Sha256::new();
    h.update(&bytes);
    hex::encode(h.finalize())
}

fn parse_and_save(
    act_path: &Path,
    sc_path: &Path,
    store: &Store,
) -> Result<RoundSummary, String> {
    if store.contains(act_path) {
        if let Some(round) = store.load(act_path) {
            return Ok(RoundSummary::from(&round));
        }
    }

    let mut round = parser::parse_activity(act_path)?;
    let scorecard  = parser::parse_scorecard(sc_path)?;
    round.scorecard = Some(scorecard);
    round.id = hash_file(act_path);

    let summary = RoundSummary::from(&round);
    store.save(act_path, &round)?;
    Ok(summary)
}

/// Sync N rounds from the watch starting at offset.
/// count=10, offset=0  → latest 10 rounds
/// count=10, offset=10 → next 10 (rounds 11-20)
#[tauri::command]
async fn sync_rounds(
    count: usize,
    offset: usize,
    state: State<'_, AppState>,
) -> Result<Vec<RoundSummary>, String> {
    let fit_dir = state.fit_dir.clone();
    let entries = mtp::download_rounds(&fit_dir, count, offset)?;

    let mut summaries = Vec::new();
    for entry in &entries {
        let sc_path  = Path::new(&entry.scorecard);
        let act_path = Path::new(&entry.activity);
        match parse_and_save(act_path, sc_path, &state.store.lock().unwrap()) {
            Ok(s)  => summaries.push(s),
            Err(e) => eprintln!("Parse error {}: {}", entry.activity_name, e),
        }
    }
    Ok(summaries)
}

/// Import FIT files from explicit paths.
#[tauri::command]
async fn import_fit_files(
    scorecard_paths: Vec<String>,
    activity_paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RoundSummary>, String> {
    let mut scorecards: Vec<models::Scorecard> = Vec::new();
    for path in &scorecard_paths {
        match parser::parse_scorecard(Path::new(path)) {
            Ok(sc) => scorecards.push(sc),
            Err(e) => eprintln!("Scorecard parse error {}: {}", path, e),
        }
    }

    let mut summaries = Vec::new();
    for path in &activity_paths {
        let act_path = Path::new(path);
        let store = state.store.lock().unwrap();

        if store.contains(act_path) {
            if let Some(round) = store.load(act_path) {
                summaries.push(RoundSummary::from(&round));
                continue;
            }
        }

        let mut round = match parser::parse_activity(act_path) {
            Ok(r)  => r,
            Err(e) => { eprintln!("Activity parse error {}: {}", path, e); continue; }
        };

        let matched_sc = scorecards.iter().find(|sc| {
            (sc.tee_time_ts - round.start_ts).abs() < 43200
        }).cloned();
        round.scorecard = matched_sc;
        round.id = hash_file(act_path);

        let summary = RoundSummary::from(&round);
        store.save(act_path, &round)?;
        summaries.push(summary);
    }

    summaries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(summaries)
}

#[tauri::command]
fn get_all_rounds(state: State<'_, AppState>) -> Vec<RoundSummary> {
    state.store.lock().unwrap().all_summaries()
}

#[tauri::command]
fn get_round_detail(id: String, state: State<'_, AppState>) -> Option<GolfRound> {
    state.store.lock().unwrap().load_by_id(&id)
}

#[tauri::command]
fn get_store_stats(state: State<'_, AppState>) -> serde_json::Value {
    let count = state.store.lock().unwrap().count();
    serde_json::json!({ "round_count": count })
}

fn main() {
    let app_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("garmin-analyzer");
    std::fs::create_dir_all(&app_dir).ok();

    let db_path = app_dir.join("rounds.db");
    let fit_dir = app_dir.join("fit-files");
    std::fs::create_dir_all(&fit_dir).ok();

    let store = Store::open(&db_path).expect("Failed to open store");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { store: Mutex::new(store), fit_dir })
        .invoke_handler(tauri::generate_handler![
            sync_rounds,
            import_fit_files,
            get_all_rounds,
            get_round_detail,
            get_store_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
