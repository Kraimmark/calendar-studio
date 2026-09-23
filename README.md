# Calendar Studio

Standalone Windows desktop application for planning a competition calendar. It is intentionally independent from MATCH//OS runtime, Hub, users, judges, exercises, squadding, operational mode and MATCH//OS data folders.

## Current status

Version `0.9.18` release candidate — roadmap slices 1–7 are implemented and the Windows release gate has passed for the corrected 0.9.17 source. The remaining 0.9.18 release-engineering gate is reproducibility: freeze the exact generated lockfiles into source and re-run the same gate from that frozen tree. Calendar Studio can create and maintain year calendars, keep undated work in a queue, enforce explicit revision/audit semantics, calculate warnings/daylight, and move its canonical SQLite database to a user-selected local folder.

Implemented:
- React + TypeScript + Vite frontend with semantic light/dark design tokens and bundled Inter Variable font dependency;
- Tauri 2 Rust shell with a Rust-owned local SQLite canonical state;
- user-selectable Calendar Studio data folder with safe bootstrap fallback and visible warning if a saved folder is unavailable;
- migration runner with pre-migration backups and compatibility/backfill for early development snapshots;
- stable event IDs, revisions, optimistic concurrency, soft archive/restore and append-only audit;
- entity mutation + audit written atomically in one SQLite transaction;
- Gregorian date-only calendar logic for 2026–2100, including leap-year edge cases;
- month event segmentation and lane allocation so multi-day cards do not overlap;
- real month grid, undated queue, create/edit/archive/restore flow and sectioned event editor;
- drag-and-drop planning, range quick-create, keyboard alternatives and planning/approved modes;
- calendar layers, counters and warnings for monthly load, match/TRF spacing, all-Russian preparation buffer and conflicting build ranges;
- local Saint Petersburg daylight/safe-window calculations with overnight-shift support;
- versioned JSON export/import with SHA-256 validation, pre-import backup and atomic state replacement;
- editor focus trap, responsive layout work and Chromium CSS/layout proxy checks at 1280/900/620 px;
- dependency-light offline domain/storage tests and an offline UI typecheck for constrained environments.

## Local checks

```bash
npm install
npm run check:offline
# After dependencies are installed:
npm run check
```

Trusted desktop validation is performed on the existing `KRAIMMARK-BUILD-01` Build Station. The corrected source passed tests, ESLint, production frontend build, rustfmt, Clippy and Tauri NSIS end-to-end; the 0.9.18 frozen-source rerun remains required after the exact generated lockfiles are restored into this tree.

See `MASTER_SPEC.md` for the authoritative product requirements and `docs/UX_ACCEPTANCE.md` for the current release gates.

Current development checkpoint: **0.9.18 release candidate — corrected 0.9.17 source passed the real Windows gate on KRAIMMARK-BUILD-01 (91/91 tests → ESLint → frontend build → rustfmt → Clippy → Tauri NSIS). The final 0.9.18 direct-source gate is intentionally not claimed yet: exact `package-lock.json` and `src-tauri/Cargo.lock` from that successful source candidate must be committed first.**

## Windows release gate

Trusted Windows release verification is routed to the existing `KRAIMMARK-BUILD-01` Build Station through `.github/workflows/windows-build-station.yml`. The project-specific entry point is `scripts/build-station-release.ps1`; it does not install or reconfigure the shared Windows toolchain.

The gate runs tests, ESLint, the production frontend build, rustfmt, clippy and a Tauri NSIS build. Only a fully successful run copies the application executable and installer into `C:\BuildStation\artifacts\calendar-studio\<timestamp>\` and refreshes `C:\BuildStation\artifacts\calendar-studio\latest\`.

The repository-local workflow remains the intended final route, while the proven Build Station bridge may be used to gate a release-candidate branch until repository-level self-hosted routing is confirmed. Public or otherwise untrusted fork/PR code must not execute on the trusted Build Station.
