mod storage;

use storage::{
    calendar_append_audit, calendar_archive_event, calendar_delete_event, calendar_export_state,
    calendar_get_event, calendar_get_settings, calendar_get_workspace_status, calendar_list_audit,
    calendar_list_events, calendar_replace_state, calendar_restore_event, calendar_save_event,
    calendar_save_settings, calendar_switch_workspace, StorageState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            let bootstrap_database_path = data_dir.join("calendar.db");
            let workspace_config_path = config_dir.join("workspace.json");
            let storage = StorageState::open(&bootstrap_database_path, &workspace_config_path)
                .map_err(std::io::Error::other)?;
            app.manage(storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            calendar_list_events,
            calendar_get_event,
            calendar_save_event,
            calendar_archive_event,
            calendar_restore_event,
            calendar_delete_event,
            calendar_get_settings,
            calendar_save_settings,
            calendar_list_audit,
            calendar_append_audit,
            calendar_export_state,
            calendar_replace_state,
            calendar_get_workspace_status,
            calendar_switch_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Calendar Studio");
}
