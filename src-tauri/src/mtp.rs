use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Deserialize;

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct MtpEntry {
    pub scorecard: String,
    pub scorecard_name: String,
    pub scorecard_mtime: i64,
    pub activity: String,
    pub activity_name: String,
    pub activity_mtime: i64,
    pub activity_size: u64,
}

/// Kill Android File Transfer and download up to `count` rounds starting at `offset`.
pub fn download_rounds(dest_dir: &Path, count: usize, offset: usize) -> Result<Vec<MtpEntry>, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Cannot create dest dir: {}", e))?;

    let _ = Command::new("pkill").arg("-f").arg("Android File Transfer").output();
    std::thread::sleep(std::time::Duration::from_secs(1));

    let binary = find_binary()?;

    let output = Command::new(&binary)
        .arg(dest_dir.to_str().unwrap())
        .arg(count.to_string())
        .arg(offset.to_string())
        .output()
        .map_err(|e| format!("Failed to run garmin_mtp: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("garmin_mtp failed: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Strip any libmtp diagnostic lines before the JSON array
    let json_start = stdout.find('[').ok_or("No JSON array in output")?;
    let json_str = &stdout[json_start..];

    let entries: Vec<MtpEntry> = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {} (raw: {})", e, stdout))?;

    Ok(entries)
}

fn find_binary() -> Result<PathBuf, String> {
    let candidates = [
        std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join("garmin_mtp"))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/native/garmin_mtp")),
        Some(PathBuf::from("/usr/local/bin/garmin_mtp")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() { return Ok(candidate); }
    }
    Err("garmin_mtp binary not found".into())
}
