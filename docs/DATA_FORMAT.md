# Data format

## Canonical database
The canonical state is one local SQLite database owned by the Rust side of the Tauri application. React and feature components use repository/portability/workspace interfaces only. Mutations use optimistic revisions and event/calendar-setting changes are committed together with append-only audit entries.

Calendar Studio starts with a bootstrap database under the application-local data directory. The user can choose a permanent local Calendar Studio folder; its `calendar.db` then becomes canonical and the selected folder path is persisted separately in app configuration. When the selected target does not yet contain a database, Calendar Studio clones the current database into it with SQLite `VACUUM INTO` before switching, preserving existing work.

A previously selected workspace is never silently recreated if its `calendar.db` disappears or becomes unavailable. Startup falls back to the bootstrap database and exposes a visible warning so an inaccessible disk/folder cannot masquerade as data loss.

Recommended user workspace shape:

```text
CalendarStudioData/
  calendar.db
  backups/
  exports/
  imports/
  attachments/              # only when attachments are introduced
```

Before an existing older database is migrated, Calendar Studio creates a SQLite backup under `backups/`. Before a portable import replaces current state, another backup is created before the replacement transaction starts.

## Portable JSON v1

```json
{
  "format": "calendar-studio-export",
  "formatVersion": 1,
  "exportedAt": "ISO-8601",
  "calendarYears": [],
  "events": [],
  "organizers": [],
  "audit": [],
  "checksum": "sha256:<64 lowercase hex chars>"
}
```

The checksum is SHA-256 over canonical JSON of every field except `checksum`; object keys are sorted recursively and array order is preserved. Calendar Studio itself exports years/events/audit in deterministic order before hashing.

Import validation rejects unsupported format versions, invalid checksum, malformed or unsupported enum values, duplicate stable IDs/audit IDs, invalid domain event data, dangling parents and parent cycles before storage mutation.

`organizers` is intentionally empty in format v1 because the first release currently uses `organizerName` on the event. A later organizer-directory format version must define migration explicitly instead of silently reinterpreting v1.

### Restore semantics
Import is restore, not CRUD replay. Stable event IDs, revision numbers, soft archive state, calendar mode/revision and original audit IDs/history are preserved. Production storage first creates a backup and then replaces events/settings/audit in one SQLite `IMMEDIATE` transaction. A failed replacement rolls back without leaving a half-imported database.
