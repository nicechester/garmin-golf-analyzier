# Garmin Analyzer

A desktop application for analyzing Garmin golf round data. Built with Tauri 2, Rust, and vanilla JavaScript.

## Overview

Garmin watches store golf activity data in two separate FIT files per round:

- **Activity file** (`GARMIN/Activity/`) — GPS track, heart rate timeline, shot detections, health metrics
- **Scorecard file** (`GARMIN/SCORCRDS/`) — per-hole scores, putts, fairways, GIR, course definition

This app reads both files, links them by timestamp, and presents a combined view of golf performance and health data.

## Features

### Overview Tab
Round summary with score, distance walked, calories, avg/max HR, altitude range, and avg swing tempo. Includes a hole-by-hole scorecard with color-coded results (eagle/birdie/par/bogey), GIR, fairways hit, and a health section showing Body Battery drain, stress, and HR zone breakdown.

![Overview](images/overview.png)

### Shot Map Tab
Interactive Leaflet map showing every shot as a colored line and dot, color-coded by club category (Driver, Fairway Wood, Iron, Wedge, Putter). Features:
- Hole selector buttons to zoom into individual holes
- Club abbreviation labels (`Dr`, `W3`, `I7`, `PW`, `H` etc.) next to each shot dot
- Distance in yards on each shot line
- Putt count shown inline next to each hole number marker
- 2-column hover popups showing club, distance, HR sparkline, altitude, swing tempo, direction arrow (traffic-signal style), and strokes gained
- GPS trail toggle to show walking path
- Scroll/double-click zoom disabled — use `+`/`−` buttons only
- Round Timeline chart below the map showing HR, altitude, stress, and swing tempo over time with hole markers

![Shot Map](images/shotmap1.png)
![Shot Map — hole detail](images/shotmap2.png)

### Course Stats Tab
Breakdown of tee shots, approach shots, wedges, and putting with direction analysis (left/straight/right), avg/max distance, and a club summary table.

![Course Stats](images/coursestats1.png)
![Course Stats — club summary](images/coursestats2.png)

### Shot Analysis Tab
Strokes Gained analysis based on Mark Broadie's *Every Shot Counts* methodology using a 15-handicap amateur baseline. Features:
- Summary cards: total SG and per-category (Off the Tee, Approach, Short Game, Putting)
- Horizontal bar chart showing gain/loss by category
- Best and worst 3 shots highlight
- Club analysis table with mis-shot tendency (direction bias), distance consistency rating (★★★ to ☆☆☆), and avg SG per club
- Shot dispersion heatmaps grouped by distance-to-green bucket (0–50, 51–100, 101–150, 151–200, 200+ yds) showing a 5×5 direction × distance grid with shot count and avg SG per cell
- Per-hole breakdown table with per-shot SG badges

![Shot Analysis — strokes gained](images/shotanalysis1.png)
![Shot Analysis — dispersion](images/shotanalysis2.png)

### Swing Tempo
Swing tempo is captured from mesg #104 in the activity FIT file as a 5-minute rolling average. The ratio (backswing:downswing) is displayed in the round header, on the timeline chart as green dots, and in individual shot popups when available.

### Ask AI
The ✨ Ask AI button builds a comprehensive markdown prompt from all round data — scorecard, shot details, strokes gained, club analysis, shot dispersion patterns, swing tempo, and a full 1-minute health timeline (HR, altitude, stress, tempo) — and copies it to the clipboard ready to paste into [Gemini](https://gemini.google.com) or [ChatGPT](https://chatgpt.com).

![Ask AI](images/ask-ai.png)

## Download

Pre-built macOS binaries are available on the [Releases page](https://github.com/nicechester/garmin-golf-analyzier/releases).

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
| `get_clubs` | Returns all `ClubInfo` entries loaded from `Clubs.fit` |
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

### ClubInfo

Parsed from `Clubs.fit` (mesg #173) in the `GARMIN/Clubs/` folder on the watch.

| Field | Description |
|-------|-------------|
| `club_id` | Opaque `u64` identifier — matches `club_id` on `ShotPosition` |
| `club_type` | `ClubType` enum (Driver, 3-Wood, 5-Iron, PW, SW, Putter, etc.) |
| `name` | Display name derived from `ClubType` (e.g. `"7-Iron"`, `"SW"`) |
| `avg_distance_cm` | Average carry distance in centimetres as recorded by the watch |

`ClubType` maps Garmin's internal enum values (field `f2` in mesg #173) to named variants. `category()` returns a grouping string used by the Course Stats tab:

| Category | Club types |
|----------|------------|
| `tee` | Driver |
| `fairway_wood` | 3/5/7-Wood, Hybrid |
| `iron` | 2–9 Iron |
| `wedge` | PW, GW, SW, LW |
| `putt` | Putter |

Clubs are loaded once at startup from the path returned by `garmin_mtp` in the `clubs_path` JSON field. They are stored in `AppState.clubs` and passed to `enrich_shots()` after parsing each round.

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
4. Download `Clubs.fit` from `GARMIN/Clubs/` — club definitions (name, type, avg distance)
5. Download both scorecard and activity files to a temp directory
6. Output a JSON object with file paths and metadata to stdout, including `clubs_path`

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
