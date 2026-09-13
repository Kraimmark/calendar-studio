## 0.9.18 — 2026-09-07

### Fixed
- Finalized the six Rust/rusqlite statement-lifetime fixes discovered by the real Windows compiler without changing SQL, ordering or persistence semantics.
- Removed the two Clippy `-D warnings` blockers structurally: the large create-event enum payload is boxed, and audit insertion now uses a typed `AuditInsert` request instead of a nine-argument helper.
- Kept audit summaries in named locals where needed so borrowed values remain valid and explicit.
- Retained the post-0.9.17 ESLint fixes: underscore discard variables, offline declaration-file exception, type alias cleanup, explicit duplicate loop and unused import removal.

### Added
- Own Windows application icon at `src-tauri/icons/icon.ico`; the release no longer needs the temporary Build Station bootstrap icon.
- Release snapshot/report for the real Windows gate and the reproducibility freeze.

### Verification
- Corrected 0.9.17 source passed the real `KRAIMMARK-BUILD-01` release gate in workflow run `33980325516`: 91/91 tests, ESLint, production frontend build, rustfmt, Clippy with `-D warnings`, and Tauri NSIS all passed.
- Generated installer: `Calendar Studio_0.9.17_x64-setup.exe`; SHA-256 `DA29E94FD4530699FD16A4585BD4231011012D2C87D049AF379325929DDD7E02`.
- Successful source candidate generated exact lockfiles with SHA-256 `c09b8496116ce7cfd9bd2edd22e2c2f0d92d45204c30af6ffac806d4a5ff78f4` (`package-lock.json`) and `41889b8cd2453ab1ffee0bc13531065c013b964f31e392124a0e8149481193f8` (`src-tauri/Cargo.lock`).
- The final 0.9.18 direct-source gate is still pending until those exact lockfile bytes are restored into the frozen source tree; this changelog does not claim 0.9.18 release-ready before that rerun.

## 0.9.17 — 2026-09-04

### Fixed
- Portable import now cross-checks CalendarSettings `mode`, approve/reopen metadata and audit action history before destructive replacement.
- Contiguous settings audit revisions may no longer describe impossible mode transitions, and the current audited transition must agree with canonical metadata.

### Verification
- `npm run check:offline`: PASS (91/91 tests).
- Full Windows/Tauri gate remains assigned to `KRAIMMARK-BUILD-01`.

## 0.9.16 — 2026-09-04

### Fixed
- Portable import now rejects temporally impossible canonical/audit state before destructive replacement.
- Validates lifecycle/audit timestamps against `exportedAt`, revision chronology, current Event `updatedAt`, and CalendarSettings approval/reopen metadata pairs.

### Verification
- `npm run check:offline`: PASS (87/87 tests).
- Full Windows/Tauri gate remains assigned to `KRAIMMARK-BUILD-01`.

## 0.9.15 — 2026-09-04

### Fixed
- Portable import now rejects impossible audit revision transitions even when a valid checksum is recomputed.
- Event `create` audit must be `null -> 1`; all other audited mutations must advance exactly one revision from a positive base revision.
- Duplicate resulting revisions for the same audited entity are rejected before database replacement.

### Verification
- `npm run check:offline`: PASS.
- Full Windows/Tauri gate remains assigned to `KRAIMMARK-BUILD-01` once repository routing is available.

## 0.9.14 — 2026-09-04

### Fixed
- In-memory/reference repository now records audit `entityType` explicitly. A no-mode-change CalendarSettings update can no longer be misclassified as an Event audit entry.
- Added regression coverage for CalendarSettings `update` audit parity with production Rust storage.

### Verification
- `npm run check:offline`: PASS.
- Full Windows/Tauri gate remains assigned to `KRAIMMARK-BUILD-01` once repository routing is available.

# Changelog

Calendar Studio keeps one factual application version across `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

## 0.9.13 — 2026-09-04
- Hardened portable JSON import validation before destructive state replacement.
- Audit entries must reference an imported canonical Event/calendar-settings entity, use an action compatible with that entity type, and never claim a resulting revision newer than the imported entity.
- Semantic integrity is checked even when the package checksum has been validly recomputed.
- Synchronized README checkpoint/version with the factual application version and added regression coverage plus DEC-024.

## 0.9.12 — 2026-09-04
- Added explicit confirmation before approving or reopening the yearly calendar.
- Confirmation text explains the edit-lock consequence of approval and the edit-enable consequence of reopening.
- The existing revisioned/audited CalendarSettings mutation remains unchanged.
- Added regression coverage and DEC-023.

## 0.9.11 — 2026-09-04
- Added explicit confirmation before soft-archiving an Event.
- The confirmation distinguishes a clean editor from a dirty draft and explicitly warns when unsaved edits would be lost.
- Archive remains reversible and continues through the existing optimistic-revision/audit path; no persistence contract changed.
- Added regression coverage and DEC-022.

## 0.9.10 — 2026-09-04
- Prevented accidental loss of unsaved Event editor drafts.
- Escape, backdrop click, header Close and footer Cancel now share one close guard and require explicit confirmation only for dirty editable drafts.
- Read-only dialogs and clean drafts still close immediately; saving remains non-interruptible.
- Added regression coverage for discard-confirmation policy and DEC-021.

## 0.9.9 — 2026-09-04
- Fixed stale dangerous-action confirmations in the Event editor.
- EKP manual-edit confirmation now resets after any further draft edit.
- Daylight override confirmation now resets only when the exact warning set changes.
- Added pure confirmation-key tests and DEC-020.

## 0.9.7 — 2026-09-04

### Added
- Searchable and sortable soft-archive library in the existing calendar sidebar.
- Search across title, organizer, venue, notes, discipline/status/source metadata and historical event dates.
- Explicit archive sorting by archive time, title, event date and discipline.
- Pure `buildArchivedLibrary` domain projection with deterministic sorting and regression tests.

### Verification
- `npm run check:offline`: PASS.
- 72/72 automated tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- Soft-delete storage, restore semantics, revisions and audit are unchanged.

## 0.9.6 — 2026-09-04

### Added
- Grouped «Нарушения и риски» panel over the existing canonical warning engine.
- Stable rule groups with affected-event/date counts and quick navigation to linked dates/events.
- Pure `summarizeCalendarWarnings` domain projection with deterministic ordering and deduplication.

### Verification
- `npm run check:offline`: PASS.
- 69/69 automated tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- No persistence schema, Event contract or warning-rule changes.

## 0.9.5 — 2026-09-04

### Added
- Searchable and sortable undated-event planning library in the existing sidebar queue.
- Search across title, organizer, venue, notes and existing planning metadata.
- Explicit sort modes: recently updated, title, discipline and status.
- Distinct empty states for an actually empty queue versus no matches for the current search.
- Pure `buildUndatedLibrary` domain projection with deterministic sorting and regression tests.

### Verification
- `npm run check:offline`: PASS.
- 67/67 automated tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- No persistence schema or Event contract changes.

## 0.9.4 — 2026-09-04

### Added
- Optional 12-month annual overview as a pure presentation over the same canonical Event repository.
- Per-month start/primary/risk summaries and compact day markers for event starts and warning dates.
- Year navigation, month drill-down and revision-aware drag-to-date from the annual view.
- Pure `buildAnnualOverview` domain projection with regression coverage; no persistence schema or Event migration.

### Verification
- `npm run check:offline`: PASS.
- 64/64 automated tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- React feature boundary scan found no direct SQLite/filesystem access.
- Full ESLint/Vite build remains environment-blocked in this sandbox because project npm dependencies are not installed. The existing Windows Build Station remains the correct build target, but no accessible `Kraimmark/calendar-studio` repository is currently exposed to the connected GitHub installation.

## 0.9.3 — 2026-09-03

### Added
- First calendar-parity slice based on the proven old annual editor, without restoring its legacy persistence model.
- Independent semantic visibility gates for our manual plan, Saint Petersburg EKP, other-region EKP, TRF, all-Russian, departmental, airgun, UTM/training and build records.
- Discipline filter independent from semantic layers, plus one-action reset to the complete calendar view.
- Pure domain projection for layer visibility with regression tests; no SQLite migration or Event rewrite is required.

### Changed
- Calendar layer controls are no longer limited to the legacy `match / utm / build` grouping. An event may belong to several semantic visibility gates at once.
- The parity pass intentionally does not identify «Вечно живые» by title heuristics; a dedicated semantic marker must be introduced explicitly before that layer is added.

### Verification
- `npm run check:offline`: PASS.
- 61/61 automated tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- Full ESLint/Vite build remains blocked by unavailable npm dependencies in the active environment; Cargo/Rust is unavailable.

## 0.9.2 — 2026-09-03

### Fixed
- Reconstructed the previously completed optimistic-conflict UX from the last reported slice: stale editor saves keep the local draft visible, show opened/current revisions and offer an explicit «Обновить форму» action.
- Refreshing a conflicted editor warns before discarding unsaved local changes.
- Drag/drop, restore and calendar-mode revision conflicts refresh current state and show a human-readable retry message instead of leaking raw `Revision conflict` text.

### Verification
- The recovered 0.9.1 source already contained the repository-level optimistic concurrency contract; the reconstructed UI path is covered by offline UI typecheck and the existing stale-revision repository tests.

## 0.9.1 — 2026-09-03

### Fixed
- Approved mode is now consistently read-only: restore-from-archive and destructive JSON import are disabled until the user explicitly returns the calendar to planning mode.
- `editable` is true only for an explicitly loaded `planning` setting, avoiding accidental mutation affordances while settings are absent or failed to load.

### Verification
- Covered by the same offline type/domain/storage gate as 0.9.0; full results are recorded in the snapshot report.

## 0.9.0 — 2026-09-03

### Added
- User-selectable local Calendar Studio workspace. The canonical `calendar.db` lives in the selected directory; the app-local database is retained only as a safe bootstrap/fallback.
- First permanent workspace selection clones the current bootstrap database with SQLite `VACUUM INTO` so existing work is not silently abandoned.
- Explicit startup warning when a previously selected workspace is unavailable instead of silently recreating an empty database there.
- Native Tauri folder picker behind a `WorkspaceManager` application boundary; React still has no direct filesystem/SQLite access.
- Editor focus trap, Escape handling and focus restoration.
- Bundled Inter Variable font dependency and responsive polish for 1280/900/620 layouts.
- Minimal archive panel that exposes the already-supported soft-restore operation without adding the deferred rich archive/search screen.
- Fifth calendar warning for a planned build range inside the two-week all-Russian preparation zone when that build actually overlaps another active calendar record.
- Regression tests defining build-overlap semantics.

### Fixed
- Removed stale success-banner CSS references to nonexistent design tokens.
- Prevented a saved-but-unavailable workspace from looking like an empty newly-created canonical database.
- Updated documentation that still described user-selectable workspace, focus trapping and restore UI as pending.

### Verification
- `npm run check:offline`: PASS.
- 57/57 automated domain/storage/portability tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- Chromium CSS/layout proxy checks: no document-level horizontal overflow at 1280/900/620 px; at 620 px horizontal scrolling is confined to the calendar grid; light-theme surfaces remain light; editor remains scrollable with visible action footer.
- Full Vite/React build and ESLint remain blocked because npm dependency installation times out in this environment.
- Rust/Cargo toolchain is unavailable, so Rust/Tauri compile and real Windows smoke remain pending release gates.

## 0.7.0 — 2026-09-03

### Added
- Versioned `calendar-studio-export` JSON package v1 with deterministic SHA-256 checksum.
- Import validation for format/version, checksum, duplicate event/audit IDs, supported enum values, event-domain validation, parent references and parent cycles.
- Portability acceptance test: export → clean store → import preserves stable event IDs, revisions, shifts, approved calendar settings and complete audit history.
- Production Tauri portability boundary for raw state export and atomic replacement.
- Automatic SQLite `VACUUM INTO` backup before destructive import and before migrating an existing older schema.
- SQLite behavioral tests proving pre-import backup integrity and rollback of a failed replacement transaction.
- Calendar UI actions for JSON export/import; import performs validation first and requires explicit destructive-action confirmation.

### Changed
- Portable format v1 intentionally exports an empty `organizers` array while release 1.0 still uses the documented text `organizerName` migration path.
- Full-state import preserves IDs/revisions/audit instead of replaying normal CRUD operations and accidentally generating new history.

### Verification
- `npm run check:offline`: PASS.
- 54/54 automated domain/storage/portability tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- UI boundary scan: no direct SQLite/filesystem access from React feature/components.
- npm dependency installation remains environment-blocked by registry timeout; full Vite/ESLint checks remain pending.
- Rust/Cargo toolchain remains unavailable, so new Rust portability commands are source-reviewed but not yet compiled in this environment.

## 0.6.0 — 2026-09-03

### Added
- Planning slice: drag-and-drop between undated queue and month days, date-preserving moves, selected-date/range quick creation, keyboard create alternative, layers, primary/all counter scope and planning/approved year controls.
- Calendar warning engine for monthly overload, ordinary match spacing, TRF spacing and all-Russian same-discipline preparation buffer.
- Regression-safe airgun/firearm spacing semantics: airgun and non-airgun events are evaluated in independent ordinary-spacing streams.
- Parent-event editing and explicit confirmation before modifying an existing EKP-sourced record.
- Local Saint Petersburg daylight calculation (UTC+3) with civil dawn/dusk, sunrise/sunset, daylight/night duration and buffered safe day/night windows.
- Day-offset-aware solar times for white-night dates where civil dusk occurs after local midnight.
- Registration and shift editing, including overnight shifts and explicit red confirmation when a shift falls outside the calculated safe window.
- Calendar warning strip and daylight side panel linked to selected/hovered dates.
- Regression tests for early-morning night shifts belonging to the night that began on the previous calendar date.

### Changed
- Drag-and-drop never clips an event at a year boundary: moves preserve duration or fail explicitly.
- Approved mode freezes mutating calendar actions while preserving read-only event inspection.
- Ordinary 14-day spacing cannot be hidden by inserting an event from the other airgun/firearm group between two conflicting matches.

### Verification
- `npm run check:offline`: PASS.
- 48/48 automated domain/storage tests: PASS.
- Domain TypeScript and offline React/UI typechecks: PASS.
- UI/persistence boundary scan: no direct SQLite/filesystem access from React feature/components.
- `npm install` still times out in the current environment, therefore real Vite/React build and ESLint remain blocked.
- Rust/Cargo are unavailable in the current environment, therefore the Rust persistence boundary still requires first compilation on a machine with the Rust toolchain.

## 0.3.0 — 2026-09-03

### Added
- Rust-side `rusqlite` production persistence boundary with Tauri commands and app-managed local database state.
- Atomic event/calendar-setting mutation + append-only audit transactions.
- Explicit command error mapping for not-found, duplicate-ID and optimistic revision conflicts.
- SQLite transaction tests proving audit failure rolls back the entity mutation.
- Migration 0004 to repair calendar-year ownership for dated early-development rows.
- Domain month event segmentation and non-overlapping lane allocation.
- Real month UI driven by `buildMonth`, month navigation, undated queue and counters.
- Basic create/edit/archive event editor wired through `CalendarRepository`.
- Offline UI TypeScript check with local declaration stubs, used only as a fallback while npm dependencies are unavailable.

### Changed
- Removed runtime dependency on `@tauri-apps/plugin-sql`; the public guest API does not provide a transaction handle suitable for proving atomic event+audit writes across pooled calls.
- Event date validation now requires both start/end or neither, matching dated versus undated product states.
- Event-specific visual colours were moved into semantic design tokens instead of being scattered through component CSS.
- Storage error classes moved out of the in-memory repository so production infrastructure does not depend on a test/reference implementation.

### Verification
- `npm run check:offline`: PASS.
- 27/27 automated domain/storage tests: PASS.
- Offline UI typecheck: PASS.
- Full npm build/lint remain blocked because package installation times out in the current environment.
- Rust/Cargo compilation remains blocked because the toolchain is unavailable in the current environment.

## 0.2.0 — 2026-09-03

### Added
- Pure Gregorian date-only primitives and Monday-first month builder for years 2026–2100.
- Event validation primitives for required title, event-year dates, registration, EKP, planning bounds, shift time format and parent-cycle protection.
- Explicit revision-conflict helpers.
- Append-only audit contract.
- Reference in-memory repository used to verify optimistic concurrency, revision increments, soft archive/restore and audit semantics before the production SQLite adapter is written.
- Internal `calendarYear` ownership for events, required to support per-year undated queues.
- First-release text `organizerName` field and forward migration path.
- SQLite migrations 0002 and 0003.
- Dependency-light offline tests using Node's built-in test runner and a separate domain TypeScript build.

### Fixed
- Removed an accidental restriction that forced registration opening/closing dates into the event calendar year. Cross-year registration is valid.
- Replaced the non-portable initial test-directory invocation with a cross-platform test discovery script.
- Added the `CHANGELOG.md` required by the master specification.

### Verification
- Domain/migration suite passes across all supported year/month combinations, leap-day edge cases, stale revision conflicts, archive/restore and audit behavior.
- Full React/Tauri build remains environment-blocked until npm dependencies and Rust/Cargo are available.

## 0.1.0 — 2026-09-02

### Added
- Standalone Tauri 2 + React + TypeScript skeleton.
- Semantic day/night theme tokens and responsive empty calendar shell.
- Initial SQLite schema and Tauri migration wiring.
- Initial Event/CalendarSettings types and repository boundary.
- MASTER_SPEC, README and supporting decision/data/UX documents.
