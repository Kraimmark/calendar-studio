use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const LATEST_SCHEMA_VERSION: i64 = 5;

pub struct StorageState {
    connection: Mutex<Connection>,
    database_path: Mutex<PathBuf>,
    bootstrap_database_path: PathBuf,
    workspace_config_path: PathBuf,
    startup_warning: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceConfig {
    directory_path: String,
}

impl StorageState {
    pub fn open(
        bootstrap_database_path: &Path,
        workspace_config_path: &Path,
    ) -> Result<Self, String> {
        let mut startup_warning = None;
        let mut selected_path = bootstrap_database_path.to_path_buf();

        if workspace_config_path.exists() {
            match fs::read_to_string(workspace_config_path)
                .map_err(|error| error.to_string())
                .and_then(|raw| {
                    serde_json::from_str::<WorkspaceConfig>(&raw).map_err(|error| error.to_string())
                }) {
                Ok(config) => {
                    let candidate = PathBuf::from(&config.directory_path).join("calendar.db");
                    if candidate.is_file() {
                        selected_path = candidate;
                    } else {
                        startup_warning = Some(format!(
                            "Сохранённая рабочая папка недоступна: {}. Открыта резервная локальная база; выберите рабочую папку заново.",
                            config.directory_path
                        ));
                    }
                }
                Err(error) => {
                    startup_warning = Some(format!(
                        "Не удалось прочитать настройку рабочей папки ({error}). Открыта резервная локальная база."
                    ));
                }
            }
        }

        let connection = match open_connection(&selected_path) {
            Ok(connection) => connection,
            Err(error) if selected_path != bootstrap_database_path => {
                startup_warning = Some(format!(
                    "Не удалось открыть выбранную рабочую базу: {error}. Открыта резервная локальная база; исходные данные не изменены."
                ));
                selected_path = bootstrap_database_path.to_path_buf();
                open_connection(&selected_path)?
            }
            Err(error) => return Err(error),
        };

        Ok(Self {
            connection: Mutex::new(connection),
            database_path: Mutex::new(selected_path),
            bootstrap_database_path: bootstrap_database_path.to_path_buf(),
            workspace_config_path: workspace_config_path.to_path_buf(),
            startup_warning: Mutex::new(startup_warning),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, CommandError> {
        self.connection.lock().map_err(|_| {
            CommandError::internal(
                "storage_lock_poisoned",
                "Не удалось получить доступ к локальной базе.",
            )
        })
    }

    fn current_database_path(&self) -> Result<PathBuf, CommandError> {
        self.database_path
            .lock()
            .map(|path| path.clone())
            .map_err(|_| {
                CommandError::internal(
                    "storage_path_lock_poisoned",
                    "Не удалось определить путь локальной базы.",
                )
            })
    }

    fn workspace_warning(&self) -> Result<Option<String>, CommandError> {
        self.startup_warning
            .lock()
            .map(|warning| warning.clone())
            .map_err(|_| {
                CommandError::internal(
                    "workspace_warning_lock_poisoned",
                    "Не удалось прочитать состояние рабочей папки.",
                )
            })
    }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let existing_schema = table_exists(&connection, "events").map_err(|error| error.to_string())?;
    let raw_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if existing_schema && raw_version < LATEST_SCHEMA_VERSION {
        backup_database(&connection, path, "before-migration")
            .map_err(|error| error.to_string())?;
    }
    migrate(&mut connection).map_err(|error| error.to_string())?;
    Ok(connection)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn table_exists(connection: &Connection, table: &str) -> rusqlite::Result<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
}

fn backup_database(
    connection: &Connection,
    database_path: &Path,
    reason: &str,
) -> rusqlite::Result<PathBuf> {
    let parent = database_path.parent().unwrap_or_else(|| Path::new("."));
    let backups = parent.join("backups");
    fs::create_dir_all(&backups)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let backup_path = backups.join(format!("calendar-{reason}-{millis}.db"));
    let target = backup_path.to_string_lossy().to_string();
    connection.execute("VACUUM INTO ?1", [target])?;
    Ok(backup_path)
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let mut version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;

    // Compatibility with the early development snapshots where migrations were
    // applied by tauri-plugin-sql and PRAGMA user_version remained zero.
    if version == 0 && table_exists(connection, "events")? {
        version = if column_exists(connection, "events", "calendar_year")? {
            3
        } else if column_exists(connection, "events", "organizer_name")? {
            2
        } else {
            1
        };
        connection.pragma_update(None, "user_version", version)?;
    }

    let migrations = [
        (1_i64, include_str!("../migrations/0001_init.sql")),
        (
            2_i64,
            include_str!("../migrations/0002_event_organizer_name.sql"),
        ),
        (
            3_i64,
            include_str!("../migrations/0003_event_calendar_year.sql"),
        ),
        (
            4_i64,
            include_str!("../migrations/0004_backfill_calendar_year.sql"),
        ),
        (
            5_i64,
            include_str!("../migrations/0005_accepted_warning_keys.sql"),
        ),
    ];

    for (target, sql) in migrations {
        if version >= target {
            continue;
        }
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(sql)?;
        transaction.pragma_update(None, "user_version", target)?;
        transaction.commit()?;
        version = target;
    }

    debug_assert_eq!(version, LATEST_SCHEMA_VERSION);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: String,
    message: String,
    entity_id: Option<String>,
    expected_revision: Option<i64>,
    actual_revision: Option<i64>,
}

impl CommandError {
    fn internal(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            entity_id: None,
            expected_revision: None,
            actual_revision: None,
        }
    }

    fn not_found(id: &str) -> Self {
        Self {
            code: "entity_not_found".into(),
            message: "Запись не найдена.".into(),
            entity_id: Some(id.into()),
            expected_revision: None,
            actual_revision: None,
        }
    }

    fn already_exists(id: &str) -> Self {
        Self {
            code: "entity_already_exists".into(),
            message: "Запись с таким идентификатором уже существует.".into(),
            entity_id: Some(id.into()),
            expected_revision: None,
            actual_revision: None,
        }
    }

    fn conflict(id: &str, expected: i64, actual: i64) -> Self {
        Self {
            code: "revision_conflict".into(),
            message: "Запись уже была изменена. Обновите форму и повторите действие.".into(),
            entity_id: Some(id.into()),
            expected_revision: Some(expected),
            actual_revision: Some(actual),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_request".into(),
            message: message.into(),
            entity_id: None,
            expected_revision: None,
            actual_revision: None,
        }
    }

    fn sqlite(error: rusqlite::Error) -> Self {
        Self::internal("sqlite_error", &error.to_string())
    }

    fn json(error: serde_json::Error) -> Self {
        Self::internal("serialization_error", &error.to_string())
    }
}

type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventShift {
    id: String,
    name: String,
    kind: String,
    starts_at: String,
    ends_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventRegistration {
    mode: String,
    opens_at: Option<String>,
    closes_at: Option<String>,
    priority_one_alerts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventData {
    title: String,
    organizer_name: String,
    kind: String,
    discipline: String,
    series: String,
    source: String,
    status: String,
    competition_status: Option<String>,
    competition_region: Option<String>,
    competition_phase: Option<String>,
    competition_stage_number: Option<i64>,
    start_date: Option<String>,
    end_date: Option<String>,
    is_primary: bool,
    parent_event_id: Option<String>,
    venue: String,
    venue_scope: String,
    notes: String,
    sticker_color: String,
    registration: EventRegistration,
    ekp_level: Option<String>,
    ekp_stage_number: Option<i64>,
    cover_path: Option<String>,
    daylight_buffer_minutes: i64,
    shifts: Vec<EventShift>,
    planned_exercise_count: Option<i64>,
    planned_squad_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    id: String,
    calendar_year: i64,
    revision: i64,
    created_at: String,
    created_by: String,
    updated_at: String,
    updated_by: String,
    archived_at: Option<String>,
    #[serde(flatten)]
    data: EventData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSettings {
    year: i64,
    mode: String,
    revision: i64,
    approved_at: Option<String>,
    approved_by: Option<String>,
    reopened_at: Option<String>,
    reopened_by: Option<String>,
    #[serde(default)]
    accepted_warning_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    audit_id: String,
    timestamp: String,
    actor: String,
    entity_type: String,
    entity_id: String,
    action: String,
    base_revision: Option<i64>,
    resulting_revision: i64,
    payload_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableState {
    calendar_years: Vec<CalendarSettings>,
    events: Vec<CalendarEvent>,
    organizers: Vec<Value>,
    audit: Vec<AuditEntry>,
}

#[derive(Debug, Default, Deserialize)]
pub struct EmptyPayload {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceStatePayload {
    state: PortableState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceYearProjectPayload {
    state: YearProjectState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearProjectState {
    year: i64,
    events: Vec<CalendarEvent>,
    settings: CalendarSettings,
    audit: Vec<AuditEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceStateResult {
    backup_reference: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchWorkspacePayload {
    directory_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    directory_path: String,
    database_path: String,
    is_bootstrap: bool,
    warning: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum SaveEventRequest {
    #[serde(rename = "create")]
    Create {
        id: String,
        #[serde(rename = "calendarYear")]
        calendar_year: i64,
        actor: String,
        timestamp: String,
        data: Box<EventData>,
    },
    #[serde(rename = "update")]
    Update {
        id: String,
        actor: String,
        timestamp: String,
        changes: Map<String, Value>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEventPayload {
    request: SaveEventRequest,
    expected_revision: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsPayload {
    year: i64,
    include_archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPayload {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionActionPayload {
    id: String,
    expected_revision: i64,
    actor: String,
    timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearPayload {
    year: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsPayload {
    year: i64,
    actor: String,
    timestamp: String,
    mode: String,
    expected_revision: i64,
    #[serde(default)]
    accepted_warning_keys: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryPayload {
    entity_id: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

fn bool_from_int(value: i64) -> bool {
    value != 0
}

fn event_data_from_row(row: &Row<'_>) -> rusqlite::Result<EventData> {
    Ok(EventData {
        title: row.get("title")?,
        organizer_name: row.get("organizer_name")?,
        kind: row.get("kind")?,
        discipline: row.get("discipline")?,
        series: row.get("series")?,
        source: row.get("source")?,
        status: row.get("status")?,
        competition_status: row.get("competition_status")?,
        competition_region: row.get("competition_region")?,
        competition_phase: row.get("competition_phase")?,
        competition_stage_number: row.get("competition_stage_number")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        is_primary: bool_from_int(row.get("is_primary")?),
        parent_event_id: row.get("parent_event_id")?,
        venue: row.get("venue")?,
        venue_scope: row.get("venue_scope")?,
        notes: row.get("notes")?,
        sticker_color: row.get("sticker_color")?,
        registration: EventRegistration {
            mode: row.get("registration_mode")?,
            opens_at: row.get("registration_opens_at")?,
            closes_at: row.get("registration_closes_at")?,
            priority_one_alerts: bool_from_int(row.get("priority_one_alerts")?),
        },
        ekp_level: row.get("ekp_level")?,
        ekp_stage_number: row.get("ekp_stage_number")?,
        cover_path: row.get("cover_path")?,
        daylight_buffer_minutes: row.get("daylight_buffer_minutes")?,
        shifts: Vec::new(),
        planned_exercise_count: row.get("planned_exercise_count")?,
        planned_squad_count: row.get("planned_squad_count")?,
    })
}

fn event_from_row(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get("id")?,
        calendar_year: row.get("calendar_year")?,
        revision: row.get("revision")?,
        created_at: row.get("created_at")?,
        created_by: row.get("created_by")?,
        updated_at: row.get("updated_at")?,
        updated_by: row.get("updated_by")?,
        archived_at: row.get("archived_at")?,
        data: event_data_from_row(row)?,
    })
}

fn load_shifts(connection: &Connection, event_id: &str) -> rusqlite::Result<Vec<EventShift>> {
    let mut statement = connection.prepare(
        "SELECT id, name, kind, starts_at, ends_at FROM event_shifts WHERE event_id=?1 ORDER BY rowid",
    )?;
    let rows = statement.query_map([event_id], |row| {
        Ok(EventShift {
            id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            starts_at: row.get(3)?,
            ends_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

fn load_event(connection: &Connection, id: &str) -> rusqlite::Result<Option<CalendarEvent>> {
    let mut event = connection
        .query_row("SELECT * FROM events WHERE id=?1", [id], event_from_row)
        .optional()?;
    if let Some(event) = event.as_mut() {
        event.data.shifts = load_shifts(connection, id)?;
    }
    Ok(event)
}

fn replace_shifts(
    transaction: &Transaction<'_>,
    event_id: &str,
    shifts: &[EventShift],
) -> rusqlite::Result<()> {
    transaction.execute("DELETE FROM event_shifts WHERE event_id=?1", [event_id])?;
    for shift in shifts {
        transaction.execute(
            "INSERT INTO event_shifts(id,event_id,name,kind,starts_at,ends_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![shift.id, event_id, shift.name, shift.kind, shift.starts_at, shift.ends_at],
        )?;
    }
    Ok(())
}

struct AuditInsert<'a> {
    timestamp: &'a str,
    actor: &'a str,
    entity_type: &'a str,
    entity_id: &'a str,
    action: &'a str,
    base_revision: Option<i64>,
    resulting_revision: i64,
    payload_summary: &'a str,
}

fn insert_audit(transaction: &Transaction<'_>, audit: AuditInsert<'_>) -> rusqlite::Result<()> {
    transaction.execute(
        "INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary)\n         VALUES(lower(hex(randomblob(16))),?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            audit.timestamp,
            audit.actor,
            audit.entity_type,
            audit.entity_id,
            audit.action,
            audit.base_revision,
            audit.resulting_revision,
            audit.payload_summary
        ],
    )?;
    Ok(())
}

fn insert_event(transaction: &Transaction<'_>, event: &CalendarEvent) -> rusqlite::Result<()> {
    let d = &event.data;
    transaction.execute(
        "INSERT INTO events(\n          id,revision,created_at,created_by,updated_at,updated_by,archived_at,title,kind,discipline,series,source,status,\n          competition_status,competition_region,competition_phase,competition_stage_number,start_date,end_date,is_primary,parent_event_id,\n          venue,venue_scope,notes,sticker_color,registration_mode,registration_opens_at,registration_closes_at,priority_one_alerts,\n          ekp_level,ekp_stage_number,cover_path,daylight_buffer_minutes,planned_exercise_count,planned_squad_count,organizer_name,calendar_year\n        ) VALUES(\n          ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37\n        )",
        params![
            event.id, event.revision, event.created_at, event.created_by, event.updated_at, event.updated_by, event.archived_at,
            d.title, d.kind, d.discipline, d.series, d.source, d.status, d.competition_status, d.competition_region, d.competition_phase,
            d.competition_stage_number, d.start_date, d.end_date, d.is_primary as i64, d.parent_event_id, d.venue, d.venue_scope,
            d.notes, d.sticker_color, d.registration.mode, d.registration.opens_at, d.registration.closes_at,
            d.registration.priority_one_alerts as i64, d.ekp_level, d.ekp_stage_number, d.cover_path, d.daylight_buffer_minutes,
            d.planned_exercise_count, d.planned_squad_count, d.organizer_name, event.calendar_year,
        ],
    )?;
    replace_shifts(transaction, &event.id, &d.shifts)
}

fn update_event_row(
    transaction: &Transaction<'_>,
    event: &CalendarEvent,
    expected_revision: i64,
) -> rusqlite::Result<usize> {
    let d = &event.data;
    let affected = transaction.execute(
        "UPDATE events SET\n          revision=?2,updated_at=?3,updated_by=?4,archived_at=?5,title=?6,kind=?7,discipline=?8,series=?9,source=?10,status=?11,\n          competition_status=?12,competition_region=?13,competition_phase=?14,competition_stage_number=?15,start_date=?16,end_date=?17,is_primary=?18,parent_event_id=?19,\n          venue=?20,venue_scope=?21,notes=?22,sticker_color=?23,registration_mode=?24,registration_opens_at=?25,registration_closes_at=?26,priority_one_alerts=?27,\n          ekp_level=?28,ekp_stage_number=?29,cover_path=?30,daylight_buffer_minutes=?31,planned_exercise_count=?32,planned_squad_count=?33,organizer_name=?34\n         WHERE id=?1 AND revision=?35",
        params![
            event.id, event.revision, event.updated_at, event.updated_by, event.archived_at, d.title, d.kind, d.discipline, d.series,
            d.source, d.status, d.competition_status, d.competition_region, d.competition_phase, d.competition_stage_number, d.start_date,
            d.end_date, d.is_primary as i64, d.parent_event_id, d.venue, d.venue_scope, d.notes, d.sticker_color, d.registration.mode,
            d.registration.opens_at, d.registration.closes_at, d.registration.priority_one_alerts as i64, d.ekp_level, d.ekp_stage_number,
            d.cover_path, d.daylight_buffer_minutes, d.planned_exercise_count, d.planned_squad_count, d.organizer_name, expected_revision,
        ],
    )?;
    if affected == 1 {
        replace_shifts(transaction, &event.id, &d.shifts)?;
    }
    Ok(affected)
}

fn merge_changes(current: &CalendarEvent, changes: Map<String, Value>) -> CommandResult<EventData> {
    let mut value = serde_json::to_value(&current.data).map_err(CommandError::json)?;
    let object = value.as_object_mut().ok_or_else(|| {
        CommandError::internal(
            "serialization_error",
            "Некорректное представление мероприятия.",
        )
    })?;
    for (key, patch_value) in changes {
        if !object.contains_key(&key) {
            return Err(CommandError::invalid(format!(
                "Неизвестное изменяемое поле: {key}"
            )));
        }
        object.insert(key, patch_value);
    }
    serde_json::from_value(value).map_err(CommandError::json)
}

fn current_revision(transaction: &Transaction<'_>, id: &str) -> rusqlite::Result<Option<i64>> {
    transaction
        .query_row("SELECT revision FROM events WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()
}

fn assert_revision(id: &str, expected: i64, actual: i64) -> CommandResult<()> {
    if expected != actual {
        Err(CommandError::conflict(id, expected, actual))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn calendar_list_events(
    state: tauri::State<'_, StorageState>,
    payload: ListEventsPayload,
) -> CommandResult<Vec<CalendarEvent>> {
    let connection = state.lock()?;
    let sql = if payload.include_archived {
        "SELECT id FROM events WHERE calendar_year=?1 ORDER BY COALESCE(start_date,'9999-12-31'), title, id"
    } else {
        "SELECT id FROM events WHERE calendar_year=?1 AND archived_at IS NULL ORDER BY COALESCE(start_date,'9999-12-31'), title, id"
    };
    let ids = {
        let mut statement = connection.prepare(sql).map_err(CommandError::sqlite)?;
        let event_ids = statement
            .query_map([payload.year], |row| row.get::<_, String>(0))
            .map_err(CommandError::sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::sqlite)?;
        event_ids
    };
    ids.into_iter()
        .map(|id| {
            load_event(&connection, &id)
                .map_err(CommandError::sqlite)?
                .ok_or_else(|| CommandError::not_found(&id))
        })
        .collect()
}

#[tauri::command]
pub fn calendar_get_event(
    state: tauri::State<'_, StorageState>,
    payload: IdPayload,
) -> CommandResult<Option<CalendarEvent>> {
    let connection = state.lock()?;
    load_event(&connection, &payload.id).map_err(CommandError::sqlite)
}

#[tauri::command]
pub fn calendar_save_event(
    state: tauri::State<'_, StorageState>,
    payload: SaveEventPayload,
) -> CommandResult<CalendarEvent> {
    let mut connection = state.lock()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;

    let result = match payload.request {
        SaveEventRequest::Create {
            id,
            calendar_year,
            actor,
            timestamp,
            data,
        } => {
            if payload.expected_revision.is_some() {
                return Err(CommandError::invalid(
                    "Создание требует expectedRevision=null.",
                ));
            }
            if current_revision(&transaction, &id)
                .map_err(CommandError::sqlite)?
                .is_some()
            {
                return Err(CommandError::already_exists(&id));
            }
            let event = CalendarEvent {
                id: id.clone(),
                calendar_year,
                revision: 1,
                created_at: timestamp.clone(),
                created_by: actor.clone(),
                updated_at: timestamp.clone(),
                updated_by: actor.clone(),
                archived_at: None,
                data: *data,
            };
            insert_event(&transaction, &event).map_err(CommandError::sqlite)?;
            insert_audit(
                &transaction,
                AuditInsert {
                    timestamp: &timestamp,
                    actor: &actor,
                    entity_type: "event",
                    entity_id: &id,
                    action: "create",
                    base_revision: None,
                    resulting_revision: 1,
                    payload_summary: "created",
                },
            )
            .map_err(CommandError::sqlite)?;
            event
        }
        SaveEventRequest::Update {
            id,
            actor,
            timestamp,
            changes,
        } => {
            let expected = payload
                .expected_revision
                .ok_or_else(|| CommandError::invalid("Изменение требует expectedRevision."))?;
            let current = load_event(&transaction, &id)
                .map_err(CommandError::sqlite)?
                .ok_or_else(|| CommandError::not_found(&id))?;
            assert_revision(&id, expected, current.revision)?;
            let changed_fields = {
                let mut fields = changes.keys().cloned().collect::<Vec<_>>();
                fields.sort();
                if fields.is_empty() {
                    "no-fields".into()
                } else {
                    fields.join(",")
                }
            };
            let data = merge_changes(&current, changes)?;
            let event = CalendarEvent {
                revision: current.revision + 1,
                updated_at: timestamp.clone(),
                updated_by: actor.clone(),
                data,
                ..current
            };
            let affected =
                update_event_row(&transaction, &event, expected).map_err(CommandError::sqlite)?;
            if affected != 1 {
                let actual = current_revision(&transaction, &id)
                    .map_err(CommandError::sqlite)?
                    .unwrap_or(expected);
                return Err(CommandError::conflict(&id, expected, actual));
            }
            let audit_summary = format!("fields:{changed_fields}");
            insert_audit(
                &transaction,
                AuditInsert {
                    timestamp: &timestamp,
                    actor: &actor,
                    entity_type: "event",
                    entity_id: &id,
                    action: "update",
                    base_revision: Some(expected),
                    resulting_revision: event.revision,
                    payload_summary: &audit_summary,
                },
            )
            .map_err(CommandError::sqlite)?;
            event
        }
    };

    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(result)
}

fn set_archive_state(
    state: tauri::State<'_, StorageState>,
    payload: RevisionActionPayload,
    archived: bool,
) -> CommandResult<CalendarEvent> {
    let mut connection = state.lock()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;
    let current = load_event(&transaction, &payload.id)
        .map_err(CommandError::sqlite)?
        .ok_or_else(|| CommandError::not_found(&payload.id))?;
    assert_revision(&payload.id, payload.expected_revision, current.revision)?;
    let action = if archived { "archive" } else { "restore" };
    let summary = if archived {
        "soft-archived"
    } else {
        "restored"
    };
    let event = CalendarEvent {
        revision: current.revision + 1,
        updated_at: payload.timestamp.clone(),
        updated_by: payload.actor.clone(),
        archived_at: if archived {
            Some(payload.timestamp.clone())
        } else {
            None
        },
        ..current
    };
    let affected = update_event_row(&transaction, &event, payload.expected_revision)
        .map_err(CommandError::sqlite)?;
    if affected != 1 {
        let actual = current_revision(&transaction, &payload.id)
            .map_err(CommandError::sqlite)?
            .unwrap_or(payload.expected_revision);
        return Err(CommandError::conflict(
            &payload.id,
            payload.expected_revision,
            actual,
        ));
    }
    insert_audit(
        &transaction,
        AuditInsert {
            timestamp: &payload.timestamp,
            actor: &payload.actor,
            entity_type: "event",
            entity_id: &payload.id,
            action,
            base_revision: Some(payload.expected_revision),
            resulting_revision: event.revision,
            payload_summary: summary,
        },
    )
    .map_err(CommandError::sqlite)?;
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(event)
}

#[tauri::command]
pub fn calendar_archive_event(
    state: tauri::State<'_, StorageState>,
    payload: RevisionActionPayload,
) -> CommandResult<CalendarEvent> {
    set_archive_state(state, payload, true)
}

#[tauri::command]
pub fn calendar_restore_event(
    state: tauri::State<'_, StorageState>,
    payload: RevisionActionPayload,
) -> CommandResult<CalendarEvent> {
    set_archive_state(state, payload, false)
}

#[tauri::command]
pub fn calendar_delete_event(
    state: tauri::State<'_, StorageState>,
    payload: RevisionActionPayload,
) -> CommandResult<Vec<String>> {
    let mut connection = state.lock()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;
    let current = load_event(&transaction, &payload.id)
        .map_err(CommandError::sqlite)?
        .ok_or_else(|| CommandError::not_found(&payload.id))?;
    assert_revision(&payload.id, payload.expected_revision, current.revision)?;

    let relationships = {
        let mut statement = transaction
            .prepare("SELECT id,parent_event_id FROM events")
            .map_err(CommandError::sqlite)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(CommandError::sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::sqlite)?;
        rows
    };
    let mut deleted_ids = vec![payload.id.clone()];
    let mut index = 0;
    while index < deleted_ids.len() {
        let parent = deleted_ids[index].clone();
        for (id, parent_id) in &relationships {
            if parent_id.as_deref() == Some(parent.as_str()) && !deleted_ids.contains(id) {
                deleted_ids.push(id.clone());
            }
        }
        index += 1;
    }

    for id in deleted_ids.iter().rev() {
        transaction
            .execute(
                "DELETE FROM audit_log WHERE entity_type='event' AND entity_id=?1",
                [id],
            )
            .map_err(CommandError::sqlite)?;
        transaction
            .execute("DELETE FROM events WHERE id=?1", [id])
            .map_err(CommandError::sqlite)?;
    }
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(deleted_ids)
}

fn default_settings(year: i64) -> CalendarSettings {
    CalendarSettings {
        year,
        mode: "planning".into(),
        revision: 1,
        approved_at: None,
        approved_by: None,
        reopened_at: None,
        reopened_by: None,
        accepted_warning_keys: Vec::new(),
    }
}

fn load_settings(connection: &Connection, year: i64) -> rusqlite::Result<Option<CalendarSettings>> {
    connection.query_row(
        "SELECT year,mode,revision,approved_at,approved_by,reopened_at,reopened_by,accepted_warning_keys FROM calendar_settings WHERE year=?1",
        [year],
        |row| Ok(CalendarSettings {
            year: row.get(0)?, mode: row.get(1)?, revision: row.get(2)?, approved_at: row.get(3)?, approved_by: row.get(4)?, reopened_at: row.get(5)?, reopened_by: row.get(6)?, accepted_warning_keys: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
        }),
    ).optional()
}

#[tauri::command]
pub fn calendar_get_settings(
    state: tauri::State<'_, StorageState>,
    payload: YearPayload,
) -> CommandResult<CalendarSettings> {
    let connection = state.lock()?;
    Ok(load_settings(&connection, payload.year)
        .map_err(CommandError::sqlite)?
        .unwrap_or_else(|| default_settings(payload.year)))
}

#[tauri::command]
pub fn calendar_save_settings(
    state: tauri::State<'_, StorageState>,
    payload: SaveSettingsPayload,
) -> CommandResult<CalendarSettings> {
    if payload.mode != "planning" && payload.mode != "approved" {
        return Err(CommandError::invalid("Неизвестный режим календаря."));
    }
    let mut connection = state.lock()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;
    let current = load_settings(&transaction, payload.year)
        .map_err(CommandError::sqlite)?
        .unwrap_or_else(|| default_settings(payload.year));
    assert_revision(
        &payload.year.to_string(),
        payload.expected_revision,
        current.revision,
    )?;
    let approving = payload.mode == "approved" && current.mode != "approved";
    let reopening = payload.mode == "planning" && current.mode != "planning";
    let updated = CalendarSettings {
        year: payload.year,
        mode: payload.mode.clone(),
        revision: current.revision + 1,
        approved_at: if approving {
            Some(payload.timestamp.clone())
        } else {
            current.approved_at
        },
        approved_by: if approving {
            Some(payload.actor.clone())
        } else {
            current.approved_by
        },
        reopened_at: if reopening {
            Some(payload.timestamp.clone())
        } else {
            current.reopened_at
        },
        reopened_by: if reopening {
            Some(payload.actor.clone())
        } else {
            current.reopened_by
        },
        accepted_warning_keys: {
            let mut keys = payload.accepted_warning_keys;
            keys.sort();
            keys.dedup();
            keys
        },
    };
    let accepted_warning_keys =
        serde_json::to_string(&updated.accepted_warning_keys).map_err(CommandError::json)?;
    transaction.execute(
        "INSERT INTO calendar_settings(year,mode,revision,approved_at,approved_by,reopened_at,reopened_by,accepted_warning_keys) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)\n         ON CONFLICT(year) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,approved_at=excluded.approved_at,approved_by=excluded.approved_by,reopened_at=excluded.reopened_at,reopened_by=excluded.reopened_by,accepted_warning_keys=excluded.accepted_warning_keys\n         WHERE calendar_settings.revision=?9",
        params![updated.year,updated.mode,updated.revision,updated.approved_at,updated.approved_by,updated.reopened_at,updated.reopened_by,accepted_warning_keys,payload.expected_revision],
    ).map_err(CommandError::sqlite)?;
    let action = if approving {
        "approve"
    } else if reopening {
        "reopen"
    } else {
        "update"
    };
    let entity_id = payload.year.to_string();
    let audit_summary = format!("mode:{}", updated.mode);
    insert_audit(
        &transaction,
        AuditInsert {
            timestamp: &payload.timestamp,
            actor: &payload.actor,
            entity_type: "calendar_settings",
            entity_id: &entity_id,
            action,
            base_revision: Some(current.revision),
            resulting_revision: updated.revision,
            payload_summary: &audit_summary,
        },
    )
    .map_err(CommandError::sqlite)?;
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(updated)
}

#[tauri::command]
pub fn calendar_append_audit(
    state: tauri::State<'_, StorageState>,
    payload: AuditEntry,
) -> CommandResult<()> {
    let mut connection = state.lock()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;
    transaction.execute(
        "INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![payload.audit_id,payload.timestamp,payload.actor,payload.entity_type,payload.entity_id,payload.action,payload.base_revision,payload.resulting_revision,payload.payload_summary],
    ).map_err(CommandError::sqlite)?;
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(())
}

#[tauri::command]
pub fn calendar_list_audit(
    state: tauri::State<'_, StorageState>,
    payload: AuditQueryPayload,
) -> CommandResult<Vec<AuditEntry>> {
    let connection = state.lock()?;
    let rows = if let Some(entity_id) = payload.entity_id {
        let mut statement = connection.prepare(
            "SELECT audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary\n             FROM audit_log WHERE entity_id=?1 AND (?2 IS NULL OR timestamp>=?2) AND (?3 IS NULL OR timestamp<=?3) ORDER BY timestamp,audit_id",
        ).map_err(CommandError::sqlite)?;
        let entries = statement
            .query_map(params![entity_id, payload.from, payload.to], audit_from_row)
            .map_err(CommandError::sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::sqlite)?;
        entries
    } else {
        let mut statement = connection.prepare(
            "SELECT audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary\n             FROM audit_log WHERE (?1 IS NULL OR timestamp>=?1) AND (?2 IS NULL OR timestamp<=?2) ORDER BY timestamp,audit_id",
        ).map_err(CommandError::sqlite)?;
        let entries = statement
            .query_map(params![payload.from, payload.to], audit_from_row)
            .map_err(CommandError::sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::sqlite)?;
        entries
    };
    Ok(rows)
}

fn load_all_events(connection: &Connection) -> rusqlite::Result<Vec<CalendarEvent>> {
    let ids = {
        let mut statement = connection.prepare("SELECT id FROM events ORDER BY id")?;
        let event_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        event_ids
    };
    ids.into_iter()
        .map(|id| load_event(connection, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows))
        .collect()
}

fn load_all_settings(connection: &Connection) -> rusqlite::Result<Vec<CalendarSettings>> {
    let mut statement = connection.prepare(
        "SELECT year,mode,revision,approved_at,approved_by,reopened_at,reopened_by,accepted_warning_keys FROM calendar_settings ORDER BY year",
    )?;
    let settings = statement
        .query_map([], |row| {
            Ok(CalendarSettings {
                year: row.get(0)?,
                mode: row.get(1)?,
                revision: row.get(2)?,
                approved_at: row.get(3)?,
                approved_by: row.get(4)?,
                reopened_at: row.get(5)?,
                reopened_by: row.get(6)?,
                accepted_warning_keys: serde_json::from_str(&row.get::<_, String>(7)?)
                    .unwrap_or_default(),
            })
        })?
        .collect();
    settings
}

fn load_all_audit(connection: &Connection) -> rusqlite::Result<Vec<AuditEntry>> {
    let mut statement = connection.prepare(
        "SELECT audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary FROM audit_log ORDER BY timestamp,audit_id",
    )?;
    let entries = statement.query_map([], audit_from_row)?.collect();
    entries
}

#[tauri::command]
pub fn calendar_export_state(
    state: tauri::State<'_, StorageState>,
    _payload: EmptyPayload,
) -> CommandResult<PortableState> {
    let connection = state.lock()?;
    Ok(PortableState {
        calendar_years: load_all_settings(&connection).map_err(CommandError::sqlite)?,
        events: load_all_events(&connection).map_err(CommandError::sqlite)?,
        organizers: Vec::new(),
        audit: load_all_audit(&connection).map_err(CommandError::sqlite)?,
    })
}

#[tauri::command]
pub fn calendar_replace_state(
    state: tauri::State<'_, StorageState>,
    payload: ReplaceStatePayload,
) -> CommandResult<ReplaceStateResult> {
    if !payload.state.organizers.is_empty() {
        return Err(CommandError::invalid(
            "Формат v1 не поддерживает непустой справочник организаторов.",
        ));
    }
    let mut connection = state.lock()?;
    let database_path = state.current_database_path()?;
    let backup_path = backup_database(&connection, &database_path, "before-import")
        .map_err(CommandError::sqlite)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;

    transaction
        .execute("DELETE FROM event_shifts", [])
        .map_err(CommandError::sqlite)?;
    transaction
        .execute("UPDATE events SET parent_event_id=NULL", [])
        .map_err(CommandError::sqlite)?;
    transaction
        .execute("DELETE FROM events", [])
        .map_err(CommandError::sqlite)?;
    transaction
        .execute("DELETE FROM calendar_settings", [])
        .map_err(CommandError::sqlite)?;
    transaction
        .execute("DELETE FROM audit_log", [])
        .map_err(CommandError::sqlite)?;

    for event in &payload.state.events {
        let mut without_parent = event.clone();
        without_parent.data.parent_event_id = None;
        insert_event(&transaction, &without_parent).map_err(CommandError::sqlite)?;
    }
    for event in &payload.state.events {
        if let Some(parent_id) = &event.data.parent_event_id {
            transaction
                .execute(
                    "UPDATE events SET parent_event_id=?2 WHERE id=?1",
                    params![event.id, parent_id],
                )
                .map_err(CommandError::sqlite)?;
        }
    }
    for settings in &payload.state.calendar_years {
        transaction.execute(
            "INSERT INTO calendar_settings(year,mode,revision,approved_at,approved_by,reopened_at,reopened_by,accepted_warning_keys) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![settings.year,settings.mode,settings.revision,settings.approved_at,settings.approved_by,settings.reopened_at,settings.reopened_by,serde_json::to_string(&settings.accepted_warning_keys).map_err(CommandError::json)?],
        ).map_err(CommandError::sqlite)?;
    }
    for entry in &payload.state.audit {
        transaction.execute(
            "INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![entry.audit_id,entry.timestamp,entry.actor,entry.entity_type,entry.entity_id,entry.action,entry.base_revision,entry.resulting_revision,entry.payload_summary],
        ).map_err(CommandError::sqlite)?;
    }
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(ReplaceStateResult {
        backup_reference: backup_path.to_string_lossy().to_string(),
    })
}

/// Atomically replaces exactly one calendar year and keeps every other year untouched.
/// A full SQLite backup is made first so a transferred project can never destroy a local plan silently.
#[tauri::command]
pub fn calendar_replace_year_project(
    state: tauri::State<'_, StorageState>,
    payload: ReplaceYearProjectPayload,
) -> CommandResult<ReplaceStateResult> {
    let project = payload.state;
    if project.settings.year != project.year {
        return Err(CommandError::invalid(
            "Настройки проекта принадлежат другому году.",
        ));
    }
    if project
        .events
        .iter()
        .any(|event| event.calendar_year != project.year)
    {
        return Err(CommandError::invalid(
            "Проект содержит мероприятия другого года.",
        ));
    }
    let event_ids = project
        .events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if project.audit.iter().any(|entry| {
        (entry.entity_type == "event" && !event_ids.contains(entry.entity_id.as_str()))
            || (entry.entity_type == "calendar_settings"
                && entry.entity_id != project.year.to_string())
    }) {
        return Err(CommandError::invalid(
            "Журнал проекта ссылается на данные вне выбранного года.",
        ));
    }

    let mut connection = state.lock()?;
    let database_path = state.current_database_path()?;
    let backup_path = backup_database(&connection, &database_path, "before-year-import")
        .map_err(CommandError::sqlite)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(CommandError::sqlite)?;

    transaction
        .execute(
            "DELETE FROM audit_log WHERE entity_type='event' AND entity_id IN (SELECT id FROM events WHERE calendar_year=?1)",
            [project.year],
        )
        .map_err(CommandError::sqlite)?;
    transaction
        .execute(
            "DELETE FROM audit_log WHERE entity_type='calendar_settings' AND entity_id=?1",
            [project.year.to_string()],
        )
        .map_err(CommandError::sqlite)?;
    transaction.execute(
        "DELETE FROM event_shifts WHERE event_id IN (SELECT id FROM events WHERE calendar_year=?1)",
        [project.year],
    )
    .map_err(CommandError::sqlite)?;
    transaction
        .execute(
            "UPDATE events SET parent_event_id=NULL WHERE calendar_year=?1",
            [project.year],
        )
        .map_err(CommandError::sqlite)?;
    transaction
        .execute("DELETE FROM events WHERE calendar_year=?1", [project.year])
        .map_err(CommandError::sqlite)?;
    transaction
        .execute(
            "DELETE FROM calendar_settings WHERE year=?1",
            [project.year],
        )
        .map_err(CommandError::sqlite)?;

    for event in &project.events {
        let mut without_parent = event.clone();
        without_parent.data.parent_event_id = None;
        insert_event(&transaction, &without_parent).map_err(CommandError::sqlite)?;
    }
    for event in &project.events {
        if let Some(parent_id) = &event.data.parent_event_id {
            transaction
                .execute(
                    "UPDATE events SET parent_event_id=?2 WHERE id=?1",
                    params![event.id, parent_id],
                )
                .map_err(CommandError::sqlite)?;
        }
    }
    transaction.execute(
        "INSERT INTO calendar_settings(year,mode,revision,approved_at,approved_by,reopened_at,reopened_by,accepted_warning_keys) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            project.settings.year,
            project.settings.mode,
            project.settings.revision,
            project.settings.approved_at,
            project.settings.approved_by,
            project.settings.reopened_at,
            project.settings.reopened_by,
            serde_json::to_string(&project.settings.accepted_warning_keys)
                .map_err(CommandError::json)?
        ],
    )
    .map_err(CommandError::sqlite)?;
    for entry in &project.audit {
        transaction.execute(
            "INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                entry.audit_id,
                entry.timestamp,
                entry.actor,
                entry.entity_type,
                entry.entity_id,
                entry.action,
                entry.base_revision,
                entry.resulting_revision,
                entry.payload_summary
            ],
        )
        .map_err(CommandError::sqlite)?;
    }
    transaction.commit().map_err(CommandError::sqlite)?;
    Ok(ReplaceStateResult {
        backup_reference: backup_path.to_string_lossy().to_string(),
    })
}

fn workspace_status(state: &StorageState) -> CommandResult<WorkspaceStatus> {
    let database_path = state.current_database_path()?;
    let directory_path = database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    Ok(WorkspaceStatus {
        directory_path: directory_path.to_string_lossy().to_string(),
        database_path: database_path.to_string_lossy().to_string(),
        is_bootstrap: database_path.as_path() == state.bootstrap_database_path.as_path(),
        warning: state.workspace_warning()?,
    })
}

fn persist_workspace_config(config_path: &Path, directory: &Path) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_vec_pretty(&WorkspaceConfig {
        directory_path: directory.to_string_lossy().to_string(),
    })
    .map_err(|error| error.to_string())?;
    let temp_path = config_path.with_extension("json.tmp");
    fs::write(&temp_path, payload).map_err(|error| error.to_string())?;
    if config_path.exists() {
        fs::remove_file(config_path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, config_path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn calendar_get_workspace_status(
    state: tauri::State<'_, StorageState>,
    _payload: EmptyPayload,
) -> CommandResult<WorkspaceStatus> {
    workspace_status(&state)
}

#[tauri::command]
pub fn calendar_switch_workspace(
    state: tauri::State<'_, StorageState>,
    payload: SwitchWorkspacePayload,
) -> CommandResult<WorkspaceStatus> {
    let directory = PathBuf::from(payload.directory_path.trim());
    if payload.directory_path.trim().is_empty() || !directory.is_dir() {
        return Err(CommandError::invalid(
            "Выбранная рабочая папка недоступна или не существует.",
        ));
    }

    let target_path = directory.join("calendar.db");
    let current_path = state.current_database_path()?;
    if target_path == current_path {
        persist_workspace_config(&state.workspace_config_path, &directory)
            .map_err(|error| CommandError::internal("workspace_config_write_failed", &error))?;
        if let Ok(mut warning) = state.startup_warning.lock() {
            *warning = None;
        }
        return workspace_status(&state);
    }

    // Prepare an existing destination before blocking the active connection. A missing
    // destination is cloned from the current database while that connection is locked,
    // so choosing a permanent folder cannot silently discard the user's current work.
    let prepared_existing = if target_path.exists() {
        Some(
            open_connection(&target_path)
                .map_err(|error| CommandError::internal("workspace_open_failed", &error))?,
        )
    } else {
        None
    };

    let mut current_connection = state.lock()?;
    let new_connection = if let Some(connection) = prepared_existing {
        connection
    } else {
        let target = target_path.to_string_lossy().to_string();
        current_connection
            .execute("VACUUM INTO ?1", [target])
            .map_err(CommandError::sqlite)?;
        match open_connection(&target_path) {
            Ok(connection) => connection,
            Err(error) => {
                let _ = fs::remove_file(&target_path);
                return Err(CommandError::internal(
                    "workspace_clone_open_failed",
                    &error,
                ));
            }
        }
    };

    persist_workspace_config(&state.workspace_config_path, &directory)
        .map_err(|error| CommandError::internal("workspace_config_write_failed", &error))?;

    let mut path = state.database_path.lock().map_err(|_| {
        CommandError::internal(
            "storage_path_lock_poisoned",
            "Не удалось изменить путь локальной базы.",
        )
    })?;
    *current_connection = new_connection;
    *path = target_path;
    if let Ok(mut warning) = state.startup_warning.lock() {
        *warning = None;
    }
    drop(path);
    drop(current_connection);
    workspace_status(&state)
}

fn audit_from_row(row: &Row<'_>) -> rusqlite::Result<AuditEntry> {
    Ok(AuditEntry {
        audit_id: row.get(0)?,
        timestamp: row.get(1)?,
        actor: row.get(2)?,
        entity_type: row.get(3)?,
        entity_id: row.get(4)?,
        action: row.get(5)?,
        base_revision: row.get(6)?,
        resulting_revision: row.get(7)?,
        payload_summary: row.get(8)?,
    })
}
