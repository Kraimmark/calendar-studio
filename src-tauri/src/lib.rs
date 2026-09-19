mod storage;

use std::fs;
use storage::{
    calendar_append_audit, calendar_archive_event, calendar_delete_event, calendar_export_state,
    calendar_get_event, calendar_get_settings, calendar_get_workspace_status, calendar_list_audit,
    calendar_list_events, calendar_replace_state, calendar_replace_year_project,
    calendar_restore_event, calendar_save_event, calendar_save_settings, calendar_switch_workspace,
    StorageState,
};
use tauri::Manager;

#[tauri::command]
fn calendar_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn calendar_write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn calendar_write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

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
            calendar_replace_year_project,
            calendar_get_workspace_status,
            calendar_switch_workspace,
            calendar_read_text_file,
            calendar_write_text_file,
            calendar_write_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Calendar Studio");
}
