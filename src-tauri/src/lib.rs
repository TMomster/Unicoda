use tauri::Manager;

fn get_config_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("configs"))
}

#[tauri::command]
fn save_config(app_handle: tauri::AppHandle, filename: String, data: String) -> Result<(), String> {
    let config_dir = get_config_dir(&app_handle)?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join(&filename), &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config(app_handle: tauri::AppHandle, filename: String) -> Result<String, String> {
    let config_dir = get_config_dir(&app_handle)?;
    std::fs::read_to_string(config_dir.join(&filename)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config_dir_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_dir = get_config_dir(&app_handle)?;
    Ok(config_dir.to_string_lossy().to_string())
}

/// 保存文件到自定义目录
#[tauri::command]
fn save_file_at_path(dir: String, filename: String, data: String) -> Result<(), String> {
    let path = std::path::Path::new(&dir);
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    std::fs::write(path.join(&filename), &data).map_err(|e| e.to_string())
}

/// 从自定义目录读取文件
#[tauri::command]
fn load_file_from_path(dir: String, filename: String) -> Result<String, String> {
    let path = std::path::Path::new(&dir).join(&filename);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_config,
            load_config,
            get_config_dir_path,
            save_file_at_path,
            load_file_from_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
