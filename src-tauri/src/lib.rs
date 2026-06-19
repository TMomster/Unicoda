use base64::Engine;
use std::collections::HashMap;
use std::error::Error;
use std::sync::OnceLock;
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
    use winapi::um::dpapi::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN};
    use winapi::um::wincrypt::DATA_BLOB;
    use winapi::um::winbase::LocalFree;

    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut data_in = DATA_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut data_out: DATA_BLOB = std::mem::zeroed();
            let ret = CryptProtectData(
                &mut data_in as *mut DATA_BLOB,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out as *mut DATA_BLOB,
            );
            if ret == 0 {
                return Err("DPAPI encrypt failed".to_string());
            }
            let result =
                std::slice::from_raw_parts(data_out.pbData as *const u8, data_out.cbData as usize)
                    .to_vec();
            LocalFree(data_out.pbData as *mut _);
            Ok(result)
        }
    }

    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut data_in = DATA_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut data_out: DATA_BLOB = std::mem::zeroed();
            let ret = CryptUnprotectData(
                &mut data_in as *mut DATA_BLOB,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out as *mut DATA_BLOB,
            );
            if ret == 0 {
                return Err("DPAPI decrypt failed".to_string());
            }
            let result =
                std::slice::from_raw_parts(data_out.pbData as *const u8, data_out.cbData as usize)
                    .to_vec();
            LocalFree(data_out.pbData as *mut _);
            Ok(result)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}

// ─── Windows Credential Manager ────────────────────────────────────────

#[cfg(target_os = "windows")]
mod credential_manager {
    use winapi::um::wincred::*;
    use winapi::shared::ntdef::LPCWSTR;

    pub fn save(target: &str, secret: &str) -> Result<(), String> {
        unsafe {
            let mut target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let secret_bytes = secret.as_bytes();
            let blob_size = secret_bytes.len() as u32;

            let mut cred: CREDENTIALW = std::mem::zeroed();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = target_wide.as_mut_ptr();
            cred.CredentialBlobSize = blob_size;
            cred.CredentialBlob = secret_bytes.as_ptr() as *mut u8;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;

            let ret = CredWriteW(&mut cred as *mut CREDENTIALW, 0);
            if ret == 0 {
                return Err("CredWriteW failed".to_string());
            }
            Ok(())
        }
    }

    pub fn load(target: &str) -> Result<Option<String>, String> {
        unsafe {
            let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let mut p_cred: *mut CREDENTIALW = std::ptr::null_mut();

            let ret = CredReadW(
                target_wide.as_ptr() as LPCWSTR,
                CRED_TYPE_GENERIC,
                0,
                &mut p_cred as *mut *mut CREDENTIALW,
            );
            if ret == 0 {
                let err = winapi::um::errhandlingapi::GetLastError();
                if err == 1168 /* ERROR_NOT_FOUND */ {
                    return Ok(None);
                }
                return Err(format!("CredReadW failed (error {})", err));
            }

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
    }

    pub fn delete(target: &str) -> Result<(), String> {
        unsafe {
            let target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let ret = CredDeleteW(
                target_wide.as_ptr() as LPCWSTR,
                CRED_TYPE_GENERIC,
                0,
            );
            if ret == 0 {
                let err = winapi::um::errhandlingapi::GetLastError();
                if err != 1168 /* ERROR_NOT_FOUND */ {
                    return Err(format!("CredDeleteW failed (error {})", err));
                }
            }
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

/// 从后端发起 HTTP GET 请求（绕过 WebView CORS 限制）。
/// 模拟真实浏览器的请求头、Cookie 支持、自动解码压缩内容，
/// 以最大限度降低搜索引擎的反爬检测。
// ─── Cookie 持久化管理 ──────────────────────────────────────────────────
/// Cookie 存储格式：{ "domain.com": { "COOKIE_NAME": "value", ... }, ... }
type CookieStore = HashMap<String, HashMap<String, String>>;

fn get_cookie_store_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(get_config_dir(app_handle)?.join("search_cookies.json"))
}

fn load_cookie_store(app_handle: &tauri::AppHandle) -> CookieStore {
    let path = match get_cookie_store_path(app_handle) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    if !path.exists() {
        return HashMap::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

fn save_cookie_store(app_handle: &tauri::AppHandle, store: &CookieStore) {
    if let Ok(path) = get_cookie_store_path(app_handle) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(data) = serde_json::to_string_pretty(store) {
            let _ = std::fs::write(&path, data);
        }
    }
}

/// 从 Set-Cookie 响应头中解析出 (name, value, domain)
fn parse_set_cookie(header: &str, request_host: &str) -> Option<(String, String, String)> {
    let parts: Vec<&str> = header.split(';').collect();
    if parts.is_empty() {
        return None;
    }
    let eq_pos = parts[0].find('=')?;
    let name = parts[0][..eq_pos].trim().to_string();
    let value = parts[0][eq_pos + 1..].trim().trim_end_matches(';').to_string();

    let mut domain = request_host.to_string();
    for part in &parts[1..] {
        let part = part.trim();
        if let Some(eq) = part.find('=') {
            let key = part[..eq].trim().to_lowercase();
            let val = part[eq + 1..].trim();
            if key == "domain" {
                let d = val.trim_start_matches('.');
                if !d.is_empty() {
                    domain = d.to_string();
                }
            }
        }
    }
    Some((name, value, domain))
}

/// 为指定 URL 构建 Cookie 请求头的值
fn build_cookie_header_for_url(store: &CookieStore, url: &str) -> Option<String> {
    let host = url.split('/').nth(2)?.to_lowercase();

    // 收集所有匹配域名下的 cookie
    let mut entries: Vec<String> = Vec::new();
    // 先精确匹配 host，再匹配从第一个点之后的部分（父域名）
    let domains: Vec<&str> = if let Some(dot_pos) = host.find('.') {
        vec![host.as_str(), &host[dot_pos + 1..]]
    } else {
        vec![host.as_str()]
    };
    for d in &domains {
        if let Some(cookies) = store.get(*d) {
            for (name, val) in cookies {
                entries.push(format!("{}={}", name, val));
            }
        }
    }
    if entries.is_empty() {
        None
    } else {
        Some(entries.join("; "))
    }
}

/// 全局复用的 HTTP 客户端（含持久 Cookie jar），避免每次请求新建连接和丢失 Cookie。
fn get_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .cookie_store(true) // Cookie 跨请求持久化，搜索引擎会据此判断是否为真人
            .build()
            .expect("Failed to create global HTTP client")
    })
}

/// 获取一个不经过系统代理的 HTTP client（用于访问本地服务）
fn get_local_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .cookie_store(true)
            .build()
            .expect("Failed to create local HTTP client")
    })
}

#[tauri::command]
async fn http_fetch(app_handle: tauri::AppHandle, url: String, user_agent: Option<String>, timeout_ms: Option<u64>, no_proxy: Option<bool>, accept_header: Option<String>) -> Result<String, String> {
    let ua = user_agent.unwrap_or_else(||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".to_string()
    );

    let use_no_proxy = no_proxy.unwrap_or(false);
    let client = if use_no_proxy { get_local_http_client() } else { get_http_client() };
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000));

    // ── 加载持久化 Cookie ──
    let cookie_store = load_cookie_store(&app_handle);

    let mut req = client
        .get(&url)
        .timeout(timeout)
        .header("User-Agent", &ua)
        .header("Accept", accept_header.clone().unwrap_or_else(|| "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8".to_string()))
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Sec-Ch-Ua", "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"")
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1")
        .header("Connection", "keep-alive");

    // ── 注入持久化的 Cookie ──
    if let Some(cookie_header) = build_cookie_header_for_url(&cookie_store, &url) {
        req = req.header("Cookie", cookie_header);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| {
            let kind = if e.is_connect() { "connect" } else if e.is_timeout() { "timeout" } else if e.is_body() { "body" } else if e.is_request() { "request" } else if e.is_decode() { "decode" } else { "unknown" };
            let src = e.source().map(|s| s.to_string()).unwrap_or_else(|| "none".to_string());
            format!("HTTP request failed (kind={}, source={}): {} - {}", kind, src, e.status().map(|s| s.to_string()).unwrap_or_else(|| "N/A".to_string()), e)
        })?;

    let status = resp.status();
    if status.is_redirection() {
        // 跟随重定向（reqwest 默认跟随，这里直接返回）
    } else if !status.is_success() {
        return Err(format!("HTTP {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")));
    }

    // ── 提取 Set-Cookie 并持久化 ──
    let host = url.split('/').nth(2).unwrap_or("").to_lowercase();
    let set_cookie_headers: Vec<String> = resp
        .headers()
        .get_all("Set-Cookie")
        .iter()
        .filter_map(|v| v.to_str().ok().map(String::from))
        .collect();

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if !set_cookie_headers.is_empty() {
        let mut store = cookie_store;
        for h in &set_cookie_headers {
            if let Some((name, value, domain)) = parse_set_cookie(h, &host) {
                store.entry(domain).or_default().insert(name, value);
            }
        }
        save_cookie_store(&app_handle, &store);
    }

    Ok(body)
}

/// 清除搜索 Cookie 文件
#[tauri::command]
fn clear_search_cookies(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = get_cookie_store_path(&app_handle)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除 Cookie 文件失败: {}", e))
    } else {
        Ok(())
    }
}

/// 获取 Cookie 信息（供 UI 展示）
#[derive(serde::Serialize)]
struct CookieInfo {
    count: usize,
    domains: Vec<String>,
    updated_at: String,
}

#[tauri::command]
fn get_cookie_info(app_handle: tauri::AppHandle) -> Result<CookieInfo, String> {
    let store = load_cookie_store(&app_handle);
    let total: usize = store.values().map(|c| c.len()).sum();
    let domains: Vec<String> = store.keys().cloned().collect();

    let path = get_cookie_store_path(&app_handle)?;
    let updated_at = if path.exists() {
        match path.metadata().and_then(|m| m.modified()) {
            Ok(time) => {
                let elapsed = time
                    .elapsed()
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if elapsed < 60 {
                    format!("{} 秒前", elapsed)
                } else if elapsed < 3600 {
                    format!("{} 分钟前", elapsed / 60)
                } else {
                    format!("{} 小时前", elapsed / 3600)
                }
            }
            Err(_) => "未知".to_string(),
        }
    } else {
        "无 Cookie 文件".to_string()
    };

    Ok(CookieInfo {
        count: total,
        domains,
        updated_at,
    })
}

/// 保存配置到加密文件
#[tauri::command]
fn save_config(app_handle: tauri::AppHandle, filename: String, data: String) -> Result<(), String> {
    let config_dir = get_config_dir(&app_handle)?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

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

/// 保存文件到自定义目录（不加密）
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

// ─── Credential Manager Commands ───────────────────────────────────────

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
            http_fetch,
            save_config,
            load_config,
            get_config_dir_path,
            save_file_at_path,
            load_file_from_path,
            save_credential,
            load_credential,
            delete_credential,
            clear_search_cookies,
            get_cookie_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
