# UX acceptance

Current acceptance targets and status:
- [x] readable semantic light/dark theme foundation;
- [x] no dark nested cards intentionally reused in light theme tokens;
- [x] calendar grid may scroll horizontally;
- [x] focus-visible states and reduced-motion rule exist;
- [x] real Monday-first month cells from date-only domain logic;
- [x] multi-day event strips split at week boundaries and use non-overlapping lanes;
- [x] undated queue;
- [x] create/edit/soft archive/restore and read-only inspection in approved mode;
- [x] soft archive always requires explicit confirmation; a dirty editor additionally warns that unsaved draft changes will be discarded;
- [x] archived-events search/sort remains a projection over soft-deleted Events and preserves restore semantics;
- [x] drag-and-drop queue ↔ calendar and dated-event moves;
- [x] keyboard/editor alternative to drag-and-drop;
- [x] mouse range selection and quick creation with prefilled range;
- [x] planning/approved transition controls;
- [x] approval and reopening both require explicit confirmation describing the resulting editability change;
- [x] layers and all/primary counter scope;
- [x] four numbered acceptance warning classes plus the specified all-Russian build-overlap warning, with human-readable links;
- [x] explicit confirmation for editing an existing EKP-sourced event;
- [x] EKP confirmation is invalidated by any subsequent Event draft edit before save;
- [x] daylight-risk confirmation is invalidated when the affected shift/date/risk statement changes, but unrelated edits do not force needless reconfirmation;
- [x] parent-event field backed by domain cycle validation;
- [x] registration and shifts sections;
- [x] local Saint Petersburg daylight panel and shift-window confirmation;
- [x] focus trapping, Escape handling and focus restoration in the editor dialog;
- [x] dirty editable drafts cannot be discarded by Escape, backdrop click, Close or Cancel without explicit confirmation; clean/read-only dialogs close directly;
- [ ] real built-app visual checks at 1280, 900 and 620 px after frontend dependencies are available;
  - Chromium CSS/layout proxy has passed at 1280/900/620: no document overflow; only the calendar grid scrolls horizontally at 620; light-theme surfaces remain light; editor content scrolls while its action footer remains visible.
- [x] JSON export/import controls with validation and explicit destructive-action confirmation;
- [x] export → clean store → import acceptance scenario preserves ID/revision/settings/audit;
- [ ] full React/Vite smoke test after npm dependency installation succeeds;
- [ ] compiled Rust/Tauri persistence smoke test on a Rust-capable Windows environment.

The unchecked items are environment/polish gates, not permission to bypass the roadmap reliability slice.
