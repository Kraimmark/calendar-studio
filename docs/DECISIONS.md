# Decisions

## DEC-001 — Standalone runtime
Calendar Studio is a separate application and repository. No MATCH//OS Hub, pairing, runtime integration or shared data folders.

## DEC-002 — Storage boundary
SQLite is local canonical storage. UI components do not call SQLite directly; persistence is accessed through repository/application boundaries.

## DEC-003 — Theme system
All UI colours are semantic CSS tokens. Both light and dark themes are first-class; light theme does not reuse dark nested surfaces.

## DEC-004 — Calendar-year ownership for undated events
An event has an internal `calendarYear` ownership value in addition to nullable `startDate`/`endDate`. This is required because the product has a per-year undated queue and the repository contract is `listEvents(year, ...)`; an undated event otherwise cannot be assigned to any year. `calendarYear` is persistence/domain bookkeeping, not a replacement for event dates. Dated events are still validated so their event dates belong to the selected calendar year.

## DEC-005 — First organizer slice
Release 1.0 starts with a text `organizerName` field while keeping a documented migration path to the versioned organizer directory described by MASTER_SPEC. Existing migrations are never edited retroactively; organizer support is introduced by migration 0002.

## DEC-006 — Atomic SQLite writes live on the Rust side
The production repository does not compose transactions through repeated JavaScript calls to `@tauri-apps/plugin-sql`. Its public JavaScript API exposes independent `execute/select` operations but no transaction handle, so an event mutation and its audit entry cannot be proven to share one pooled connection. Calendar Studio therefore owns SQLite through a Rust `rusqlite` connection behind Tauri commands. Every mutation uses one `IMMEDIATE` SQLite transaction that writes the entity state and its audit entry together. React still depends only on `CalendarRepository`; the Tauri adapter is an infrastructure detail. The app-local database path is only the bootstrap/fallback location; permanent workspace behavior is defined in DEC-011.
## DEC-007 — Calendar moves preserve intent, never silently clip
Drag-and-drop preserves the existing event duration. Moving an undated event to a day creates a one-day event. Moving back to the undated queue intentionally clears both dates. If preserving duration would cross the owning calendar-year boundary, the move is rejected with an explicit message rather than silently truncating dates.

## DEC-008 — Ordinary spacing is evaluated in airgun and non-airgun streams
The ordinary two-week warning deliberately ignores mixed airgun/firearm pairs. To prevent an intervening airgun event from hiding a firearm-to-firearm conflict (and vice versa), the rule is evaluated independently for airgun events and all non-airgun match events. TRF and all-Russian rules remain separate.

## DEC-009 — Daylight is local, deterministic and day-offset aware
Release 1.0 daylight calculations are local for Saint Petersburg (UTC+3), with no internet dependency. Solar clock values preserve an explicit day offset because civil dusk during white-night dates can occur after local midnight. Night-shift validation checks both the night beginning on the event date and, for early-morning shifts, the safe window that began on the previous date.
## DEC-010 — Portability v1 restores canonical state, it does not replay edits
The v1 JSON package carries calendar settings, complete events (including IDs/revisions/soft-archive state/shifts) and append-only audit entries plus a deterministic SHA-256 checksum. Import is validated before storage mutation. Production import creates a SQLite backup first, then replaces canonical state inside one immediate transaction. Imported entities and audit rows are inserted as canonical historical state rather than replayed through CRUD methods, because replay would manufacture new IDs/revisions/audit and violate the backup/restore contract. The `organizers` array is present but must be empty in v1 while the product uses text `organizerName`.


## DEC-011 — Workspace selection preserves data and fails visibly
The app-local SQLite file is a bootstrap/fallback location, not the permanent workspace contract. The user can select an existing local directory for Calendar Studio. If the target does not yet contain `calendar.db`, the active database is cloned there with SQLite `VACUUM INTO` before the connection is switched. If a saved workspace is unavailable on a later startup, Calendar Studio does not silently recreate an empty database at that path: it opens the bootstrap database and exposes an explicit warning. Workspace selection is an infrastructure concern behind `WorkspaceManager`; React does not gain direct filesystem access.

## DEC-012 — Minimal archive is enough for 1.0 restore semantics
Release 1.0 must expose soft restore because MASTER_SPEC requires archived events to be restorable. The dedicated rich archive/search screen remains a post-1.0 enhancement. Until then, a compact archived-events panel in the calendar sidebar exposes restore with the current optimistic revision while preserving all audit history.

## DEC-013 — All-Russian build-overlap warning is collision-based
The MASTER_SPEC warning about a build zone before an all-Russian event is interpreted conservatively. A dated `build` record merely existing inside the 14-day preparation window is not itself a warning. `all_russian_build_overlap` is emitted only when that build range intersects another active dated calendar record; the warning links the build, conflicting record and target all-Russian event. This avoids inventing a blanket prohibition on planned preparation work.

## DEC-014 — Calendar parity restores product behavior, not legacy taxonomy
The explicitly approved parity pass uses the first annual calendar editor and the MATCH//OS calendar as product references, while `MASTER_SPEC.md` remains the architectural boundary. Useful planning behavior may be restored when it improves the standalone calendar without introducing excluded MATCH//OS runtime functions. Semantic layers are projections over canonical `CalendarEvent` fields and are independent visibility gates: source (`manual`, EKP geography) is combined with optional semantics such as TRF, all-Russian, departmental, airgun, UTM and build. This avoids reintroducing legacy `eventClass`, title-based inference or a second persistence model. A dedicated «Вечно живые» layer must wait for an explicit semantic field/tag instead of guessing from event titles.

## DEC-015 — Annual overview is a projection, never a second calendar state
The optional 12-month overview is built from the same year-scoped `CalendarEvent` collection, semantic layer/discipline filters and warning engine as the detailed month view. It may aggregate starts, primary records and warning dates for navigation, but it owns no persistence, duplicated Event state or alternate warning rules. Editing actions continue through the existing repository methods and optimistic revision checks; switching views cannot change canonical data.

## DEC-016 — Undated library is a query projection over Events
Search, sorting and empty-state behavior for the «Без даты» library operate only on the already-loaded canonical Event collection. The library does not own a separate queue table or duplicate event records. Dragging an item to the calendar or returning a dated event to the queue continues through the existing repository update path and optimistic revision contract.

## DEC-017 — Risk panel is a projection over canonical warning results
The «Нарушения и риски» panel may group, count and link the output of `calculateWarnings`, but it does not evaluate calendar rules itself and owns no persistence. Rule labels/order are presentation metadata only. Event/date lists are deduplicated for navigation without changing warning payloads. This keeps the domain warning engine as the single source of truth and prevents React from drifting into a second business-rule implementation.

## DEC-018 — Archive search is a projection over soft-archived Events
The richer archive view does not introduce an archive table, deleted copy or alternate restore model. Search and sorting operate over already-loaded Events whose `archivedAt` is non-null. Restore remains the existing optimistic-revision repository mutation, so stable IDs, revision history and append-only audit are preserved.


## DEC-019 — Existing Build Station is the Windows release gate

**Status:** accepted (2026-09-04)

Calendar Studio must use the existing `KRAIMMARK-BUILD-01` Windows x64 Build Station for trusted Windows release verification instead of creating or provisioning a second desktop build environment.

The repository owns only its routing and project-specific build script. The workflow targets the established labels `self-hosted`, `Windows`, `X64`, `build-station`, `windows-desktop`, `msvc`, `tauri`, then runs tests, lint, production frontend build, rustfmt, clippy and a Tauri NSIS build. Successful executable/installer output is copied to `C:\BuildStation\artifacts\calendar-studio\<timestamp>\` and refreshed in `...\latest\` only after every verification step has passed.

This does not grant repository access to the runner by itself. Runner routing remains an external repository/organization configuration gate. Untrusted public fork/PR code must not be executed on the home self-hosted runner.


## DEC-020 — Dangerous-action confirmation authorizes an exact state

**Status:** accepted (2026-09-04)

A confirmation checkbox must not remain valid after the state it authorizes has materially changed. For an existing EKP-sourced Event, any subsequent draft edit invalidates the manual-edit confirmation. For daylight overrides, confirmation is tied to the exact calculated warning set (affected shift, date and warning statement), so changing dates, shift timing/type/name, or the daylight buffer re-arms confirmation when the risk statement changes. Unrelated edits that leave the warning set identical do not force a second daylight confirmation.

This is UI safety state only. It introduces no persistence, no Event field, no audit mutation and no second daylight/business-rule engine. The warning identity is derived from canonical `calculateShiftDaylightWarnings` output.


## DEC-021 — Dirty editor drafts require one consistent discard guard

**Status:** accepted (2026-09-04)

Closing an editable Event editor with unsaved changes is a data-loss action at the user-input level even though canonical SQLite state is unaffected. Escape, backdrop click, header Close and footer Cancel therefore route through one shared close guard. A dirty editable draft requires explicit confirmation before it is discarded; clean drafts and read-only inspection close immediately. Saving cannot be interrupted through the close guard.

This remains transient UI safety behavior only. It adds no Event field, persistence state, audit row or business rule, and does not alter optimistic concurrency, soft archive or repository boundaries.

## DEC-022 — Archive is reversible but still requires explicit confirmation
Soft archive does not destroy an Event, yet it removes the record from active planning and, when triggered from a dirty editor, can also discard unsaved draft input. The archive control therefore always requires an explicit confirmation. The prompt additionally mentions unsaved-draft loss only when the draft is dirty and states that the Event remains recoverable from the archive. This is transient UI safety behavior only: archive persistence, stable ID, optimistic revision checks and append-only audit remain unchanged.

## DEC-023 — Calendar approval/reopen is an explicit consequential transition
Changing a year between `planning` and `approved` is already revisioned and audited, but it changes the editability of the entire calendar. Both directions therefore require an explicit confirmation before the repository mutation starts. The confirmation explains the resulting edit lock or edit re-enable. No new persistence state is introduced, and optimistic concurrency remains the final authority if another revision wins the race after confirmation.



## DEC-024 — Portable import validates semantic audit integrity before replacement

**Status:** accepted (2026-09-04)

A valid SHA-256 checksum proves that a portable package is internally untampered relative to its checksum, not that its records describe a coherent Calendar Studio state. Before the destructive import path can replace SQLite, validation therefore also checks that every audit row references a canonical entity present in the package, that the action belongs to that entity type, and that an audit row never claims a resulting revision newer than the imported entity revision. This remains domain validation in `CalendarPortability`; React only displays validation failure and asks for the existing destructive-import confirmation. No schema, Event field or import format version changes.


## DEC-025 — Audit entity type is explicit at the repository boundary

**Status:** accepted (2026-09-04)

Repository audit recording must receive the entity type explicitly rather than infer it from the action name. The action `update` is valid for both Events and CalendarSettings, so action-based inference can misclassify a settings update as an Event audit row. Production Rust storage already records `calendar_settings` explicitly; the in-memory/reference repository now follows the same contract so tests cannot mask a production/domain parity defect.


## DEC-026 — Portable audit validates revision transitions, not only revision ceilings

**Status:** accepted (2026-09-04)

A checksum-valid import package must not be able to describe impossible mutation transitions. Event creation is valid only as `null -> 1`; every other audited mutation must carry a positive `baseRevision` and advance exactly by one. A single entity/revision pair may occur only once in the imported audit. This validation rejects internal contradictions before the destructive state-replacement boundary while still allowing incomplete historical audit, because the format does not require every past revision to be present.

## DEC-027 — Portable import validates temporal coherence before replacement

**Status:** accepted (2026-09-04)

A checksum-valid portable package must also describe a temporally possible canonical state. `exportedAt`, Event lifecycle timestamps, CalendarSettings transition timestamps and audit timestamps are validated as parseable timestamps; canonical/audit timestamps may not claim changes after the package export time; Event creation cannot be later than its update time; archive time cannot be later than the current Event update time; audit timestamps must not move backwards as revisions increase. When audit contains the current Event revision, its timestamp must match canonical `updatedAt`. Calendar approval/reopen metadata is stored as paired timestamp/actor values and invalid half-pairs are rejected. These checks remain pure import-domain validation and do not change schema or portable format v1.


## DEC-028 — Portable CalendarSettings history must describe one coherent mode state

**Status:** accepted (2026-09-04)

Portable import treats CalendarSettings mode, transition metadata and settings audit as one canonical history rather than independently valid records. Audit payload summaries for settings must name the resulting planning/approved mode; approve/reopen actions must end in the matching mode; contiguous audited revisions must describe a possible transition; and an audited current revision must agree with canonical mode and current transition metadata. Canonical approval/reopen timestamps must also be ordered consistently with the current mode. Historical audit may remain incomplete, so validation only infers transitions across revisions that are actually contiguous in the package. No schema or portable-format version changes.
