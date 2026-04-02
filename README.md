# Garmin Analyzer

A desktop application for analyzing Garmin golf round data. Built with Tauri 2, Rust, and vanilla JavaScript.

## Overview

Garmin watches store golf activity data in two separate FIT files per round:

- **Activity file** (`GARMIN/Activity/`) — GPS track, heart rate timeline, shot detections, health metrics
- **Scorecard file** (`GARMIN/SCORCRDS/`) — per-hole scores, putts, fairways, GIR, course definition

This app reads both files, links them by timestamp, and presents a combined view of golf performance and health data.

## Architecture

```
tauri/
├── src-tauri/              Rust backend
│   ├── src/
│   │   ├── main.rs         Tauri entry point, command registration
│   │   ├── models.rs       Data structures (GolfRound, Scorecard, HoleScore, etc.)
│   │   ├── parser.rs       FIT file parsing for activity and scorecard files
│   │   ├── store.rs        Sled-based persistence layer
│   │   ├── mtp.rs          MTP watch connection via native binary
│   │   └── native/
│   │       ├── garmin_mtp.c    C source for libmtp helper
│   │       └── garmin_mtp      Compiled binary (macOS ARM64)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── web/                    Frontend (vanilla JS + Tailwind)
│   ├── index.html
│   ├── css/main.css
│   └── js/app.js
├── package.json
└── vite.config.js
```

## Prerequisites

### System dependencies

- macOS (ARM64 or x86_64)
- Rust toolchain (`rustup`)
- Node.js 18+
- libmtp (`brew install libmtp`)
- Tauri CLI (`npm install -g @tauri-apps/cli`)

### Build the native MTP helper

The `garmin_mtp` binary handles USB communication with the watch. It must be compiled separately because the JVM (and Tauri's Rust runtime) cannot claim the USB interface on macOS without the binary's process-level USB access.

```bash
clang -I/opt/homebrew/include -L/opt/homebrew/lib -lmtp \
  -o src-tauri/src/native/garmin_mtp \
  src-tauri/src/native/garmin_mtp.c
```

## Development

```bash
cd tauri
npm install
npm run tauri:dev
```

This starts the Vite dev server on port 9002 and launches the Tauri window with hot reload.

## Build

```bash
npm run tauri:build
```

The distributable app bundle is written to `src-tauri/target/release/bundle/`.

## Tauri Commands

All commands are invoked from the frontend via `invoke()` from `@tauri-apps/api/core`.

| Command | Description |
|---------|-------------|
| `sync_latest_round` | Kills Android File Transfer, runs `garmin_mtp` to download the latest scorecard and activity FIT files from the connected watch, parses and links them, saves to store, returns a `RoundSummary` |
| `import_fit_files(scorecard_paths, activity_paths)` | Bulk import from explicit file paths. Scorecard files are matched to activity files by tee timestamp within a 12-hour window |
| `get_all_rounds` | Returns all stored `RoundSummary` objects sorted newest first |
| `get_round_detail(id)` | Returns the full `GolfRound` for a given ID, including scorecard and health timeline |
| `get_store_stats` | Returns `{ round_count }` |

## Data Model

### GolfRound

Top-level record combining activity and scorecard data.

- `id` — SHA-256 of the activity FIT file (deduplication key)
- `start_ts`, `end_ts` — Garmin epoch timestamps (add 631065600 for Unix time)
- `duration_seconds`, `distance_meters`, `calories`
- `avg_heart_rate`, `max_heart_rate`, `total_ascent`, `total_descent`
- `shots` — `Vec<GolfShot>` from mesg #325 in the activity file
- `health_timeline` — `Vec<HealthSample>` from Record messages (~1 per 3-5 seconds)
- `scorecard` — `Option<Scorecard>` from the SCORCRDS FIT file

### Scorecard

Parsed from proprietary Garmin messages in the SCORCRDS FIT file.

| Message | Content |
|---------|---------|
| #190 | Round summary: course name, par, tee color, course rating, slope |
| #191 | Player summary: total score, putts, GIR, fairways hit |
| #192 | Per-hole scores: hole number, score, putts, fairway hit flag |
| #193 | Hole definitions: par, handicap, distance, tee GPS position |
| #194 | Shot positions: from/to GPS coordinates, club ID |

### HealthSample

One sample per Record message from the activity FIT file.

- `heart_rate` — bpm
- `stress_proxy` — field #135, 0-100 (Garmin proprietary stress indicator)
- `body_battery` — field #143 (Garmin Body Battery level)
- `altitude_meters` — from enhanced_altitude field
- `position` — GPS coordinates converted from semicircles

## Persistence

Rounds are stored in a [sled](https://github.com/spacejam/sled) embedded database at:

```
~/Library/Application Support/garmin-analyzer/rounds.db
```

The key for each round is the SHA-256 hash of the activity FIT file, which prevents duplicate imports if the same file is processed multiple times.

## MTP Watch Connection

The `garmin_mtp` binary uses libmtp to:

1. Detect the Garmin watch via USB
2. List files in `GARMIN/SCORCRDS/` — find the highest file ID (most recent scorecard)
3. List files in `GARMIN/Activity/` — find the activity whose `modificationdate` matches the scorecard
4. Download both files to a temp directory
5. Output a JSON object with file paths and metadata to stdout

Android File Transfer must not be running when syncing. The app kills it automatically before invoking the binary.

## Known Limitations

- macOS only. The `garmin_mtp` binary uses libmtp which requires macOS USB access that the Tauri process cannot obtain directly.
- The `garmin_mtp` binary path is resolved relative to the compiled executable. In development it looks for `src-tauri/src/native/garmin_mtp`.
- Scorecard data (per-hole scores, putts, GIR) is stored in proprietary Garmin message types (#190-194) in the SCORCRDS folder, not in the main activity FIT file.
- The Garmin FIT epoch starts December 31, 1989. All timestamps in FIT files must have 631065600 added to convert to Unix time.

## Dependencies

### Rust

| Crate | Purpose |
|-------|---------|
| `tauri 2` | Desktop app framework |
| `fitparser 0.10` | FIT file parsing |
| `sled 0.34` | Embedded key-value store |
| `serde / serde_json` | Serialization |
| `chrono` | Timestamp formatting |
| `sha2 / hex` | File hashing for deduplication |
| `dirs` | Platform data directory |

### JavaScript

| Package | Purpose |
|---------|---------|
| `@tauri-apps/api` | `invoke()` for Rust commands |
| `vite` | Dev server and bundler |
| Tailwind CSS (CDN) | Styling |
