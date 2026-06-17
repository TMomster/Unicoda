use tauri::Manager;

fn get_config_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("configs"))
}

// ─── DPAPI 加密/解密（仅 Windows） ─────────────────────────────────────

#[cfg(target_os = "windows")]
mod dpapi {
    use windows::Win32::Data::Dpapi::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN};
    use windows::Win32::Foundation::{LocalFree, BOOL};
    use windows::Win32::System::Memory::LocalFree as LocalFreeMem;

    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        let data_in = windows::Win32::Data::Dpapi::CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut data_out = windows::Win32::Data::Dpapi::CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &data_in,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
            .map_err(|e| format!("DPAPI encrypt failed: {}", e))?;

            let result = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();
            LocalFree(data_out.pbData as *mut _);
            Ok(result)
        }
    }

    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        let data_in = windows::Win32::Data::Dpapi::CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut data_out = windows::Win32::Data::Dpapi::CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &data_in,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
            .map_err(|e| format!("DPAPI decrypt failed: {}", e))?;

            let result = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();
            LocalFree(data_out.pbData as *mut _);
            Ok(result)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec()) // fallback: no encryption on non-Windows
    }
    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

// ─── Windows Credential Manager ────────────────────────────────────────

#[cfg(target_os = "windows")]
mod credential_manager {
    use windows::Win32::Security::Credentials::*;
    use windows::Win32::Foundation::{PWSTR, WIN32_ERROR};

    /// 保存凭据到 Windows Credential Manager
    pub fn save(target: &str, secret: &str) -> Result<(), String> {
        unsafe {
            let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let secret_bytes = secret.as_bytes();
            let blob_size = secret_bytes.len() as u32;

            let mut cred = CREDENTIALW::default();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = PWSTR(target_wide.as_ptr() as *mut _);
            cred.CredentialBlobSize = blob_size;
            cred.CredentialBlob = secret_bytes.as_ptr() as *mut u8;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;

            CredWriteW(&cred, 0)
                .map_err(|e| format!("CredWriteW failed: {}", e))?;
            Ok(())
        }
    }

    /// 从 Windows Credential Manager 读取凭据
    pub fn load(target: &str) -> Result<Option<String>, String> {
        unsafe {
            let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let mut p_cred: *mut CREDENTIALW = std::ptr::null_mut();

            match CredReadW(PWSTR(target_wide.as_ptr() as *mut _), CRED_TYPE_GENERIC, 0, &mut p_cred) {
                Ok(()) => {
                    let cred = &*p_cred;
                    let blob = std::slice::from_raw_parts(
                        cred.CredentialBlob as *const u8,
                        cred.CredentialBlobSize as usize,
                    );
                    let secret = String::from_utf8(blob.to_vec())
                        .map_err(|e| format!("UTF-8 decode failed: {}", e))?;
                    CredFree(p_cred as *mut _);
                    Ok(Some(secret))
                }
                Err(e) => {
                    if WIN32_ERROR(e.code.0) == WIN32_ERROR(0x80070490) // ERROR_NOT_FOUND
                    {
                        Ok(None)
                    } else {
                        Err(format!("CredReadW failed: {}", e))
                    }
                }
            }
        }
    }

    /// 从 Windows Credential Manager 删除凭据
    pub fn delete(target: &str) -> Result<(), String> {
        unsafe {
            let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            CredDeleteW(PWSTR(target_wide.as_ptr() as *mut _), CRED_TYPE_GENERIC, 0)
                .map_err(|e| format!("CredDeleteW failed: {}", e))?;
            Ok(())
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod credential_manager {
    pub fn save(_target: &str, _secret: &str) -> Result<(), String> {
        Err("Credential Manager is not available on this platform".to_string())
    }
    pub fn load(_target: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn delete(_target: &str) -> Result<(), String> {
        Ok(())
    }
}

// ─── Tauri Commands ────────────────────────────────────────────────────

/// 保存配置到加密文件
#[tauri::command]
fn save_config(app_handle: tauri::AppHandle, filename: String, data: String) -> Result<(), String> {
    let config_dir = get_config_dir(&app_handle)?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    // 用 base64(DPAPI(data)) 写入磁盘
    let encrypted = dpapi::encrypt(data.as_bytes())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&encrypted);
    std::fs::write(config_dir.join(&filename), &encoded).map_err(|e| e.to_string())
}

/// 从加密文件加载配置
#[tauri::command]
fn load_config(app_handle: tauri::AppHandle, filename: String) -> Result<String, String> {
    let config_dir = get_config_dir(&app_handle)?;
    let path = config_dir.join(&filename);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    let encoded = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(&encoded)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    let decrypted = dpapi::decrypt(&encrypted)?;

    String::from_utf8(decrypted).map_err(|e| format!("UTF-8 decode failed: {}", e))
}

#[tauri::command]
fn get_config_dir_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_dir = get_config_dir(&app_handle)?;
    Ok(config_dir.to_string_lossy().to_string())
}

/// 保存文件到自定义目录（不加密，用于会话库等非敏感数据）
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

// ─── Credential Manager Commands ────────────────────────────────────────

#[tauri::command]
fn save_credential(target: String, secret: String) -> Result<(), String> {
    credential_manager::save(&target, &secret)
}

#[tauri::command]
fn load_credential(target: String) -> Result<Option<String>, String> {
    credential_manager::load(&target)
}

#[tauri::command]
fn delete_credential(target: String) -> Result<(), String> {
    credential_manager::delete(&target)
}

// ─── App Entry ─────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_config,
            load_config,
            get_config_dir_path,
            save_file_at_path,
            load_file_from_path,
            save_credential,
            load_credential,
            delete_credential,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
