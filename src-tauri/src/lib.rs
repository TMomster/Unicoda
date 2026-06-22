use base64::Engine;
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use std::sync::OnceLock;
use tauri::Manager;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

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

    let file_path = config_dir.join(&filename);
    // 创建文件所在子目录（如 normal/literals/）
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let encrypted = dpapi::encrypt(data.as_bytes())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&encrypted);
    std::fs::write(&file_path, &encoded).map_err(|e| e.to_string())
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

/// 返回用户目录下的默认会话存储路径：{homeDir}/UnicodaSessions
#[tauri::command]
fn get_default_session_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let home = app_handle
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?;
    Ok(home.join("UnicodaSessions").to_string_lossy().to_string())
}

/// 保存文件到自定义目录（不加密）
/// filename 可以包含子路径（如 "normal/literals/1.json"），
/// 会自动创建所有必要的父目录。
#[tauri::command]
fn save_file_at_path(dir: String, filename: String, data: String) -> Result<(), String> {
    let full_path = std::path::Path::new(&dir).join(&filename);
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full_path, &data).map_err(|e| e.to_string())
}

/// 删除自定义目录下的文件（不加密）
#[tauri::command]
fn remove_file_at_path(dir: String, filename: String) -> Result<(), String> {
    let full_path = std::path::Path::new(&dir).join(&filename);
    if full_path.exists() {
        std::fs::remove_file(&full_path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// 写入文本文件到指定绝对路径（由 write_to_file 模组使用）
#[tauri::command]
fn write_text_file_at(path: String, data: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, &data).map_err(|e| e.to_string())
}

/// 从自定义目录读取文件
#[tauri::command]
fn load_file_from_path(dir: String, filename: String) -> Result<String, String> {
    let path = std::path::Path::new(&dir).join(&filename);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

// ─── 文件系统只读操作 ────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
    is_file: bool,
    size: u64,
    modified: String,
}

/// 列出目录内容，按"目录优先 + 字母序"排序返回。
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("目录不存在: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("不是目录: {}", path));
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            size: metadata.len(),
            modified,
        });
    }

    // 目录优先，再按字母序
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    Ok(entries)
}

#[derive(serde::Serialize)]
struct SearchFileResult {
    path: String,
    size: u64,
}

/// 在本地文件系统中按 glob 模式递归搜索文件。
/// 一次性在 Rust 端完成遍历，避免多次 IPC 调用。
#[tauri::command]
fn search_files(
    root_path: String,
    pattern: String,
    max_results: Option<u32>,
    max_depth: Option<usize>,
    case_sensitive: Option<bool>,
) -> Result<Vec<SearchFileResult>, String> {
    let root = std::path::Path::new(&root_path);
    if !root.exists() {
        return Err(format!("目录不存在: {}", root_path));
    }
    if !root.is_dir() {
        return Err(format!("不是目录: {}", root_path));
    }

    let max_results = max_results.unwrap_or(50).min(200) as usize;
    let max_depth = max_depth.unwrap_or(10).min(20);
    let case_sensitive = case_sensitive.unwrap_or(false);

    // 将 glob 模式转换为正则表达式
    let mut regex_str = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '*' => regex_str.push_str(".*"),
            '?' => regex_str.push('.'),
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                regex_str.push('\\');
                regex_str.push(ch);
            }
            _ => regex_str.push(ch),
        }
    }
    regex_str.push('$');

    let re = if case_sensitive {
        regex::Regex::new(&regex_str).map_err(|e| format!("正则表达式错误: {}", e))?
    } else {
        regex::RegexBuilder::new(&regex_str)
            .case_insensitive(true)
            .build()
            .map_err(|e| format!("正则表达式错误: {}", e))?
    };

    // 跳过隐藏目录和已知系统/缓存目录
    let skip_dirs: [&str; 6] = [".git", ".svn", ".hg", "node_modules", ".cache", "__pycache__"];

    let mut results = Vec::new();
    let walker = walkdir::WalkDir::new(&root_path)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter();

    for entry in walker {
        if results.len() >= max_results {
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // 跳过隐藏目录（以 . 开头）
        if entry
            .file_name()
            .to_str()
            .map(|s| s.starts_with('.'))
            .unwrap_or(false)
            && entry.file_type().is_dir()
        {
            continue;
        }

        // 跳过已知系统/缓存目录
        if entry.file_type().is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if skip_dirs.contains(&name.as_str()) {
                continue;
            }
        }

        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy();
            if re.is_match(&name) {
                let path = entry.path().to_string_lossy().to_string();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                results.push(SearchFileResult { path, size });
            }
        }
    }

    Ok(results)
}

#[derive(serde::Serialize)]
struct PathMetadata {
    exists: bool,
    is_dir: bool,
    is_file: bool,
    size: u64,
    modified: String,
    name: String,
    parent: Option<String>,
    canonical_path: String,
}

/// 获取路径的元信息（存在与否、类型、大小、修改时间、规范路径）。
#[tauri::command]
fn get_path_metadata(path: String) -> Result<PathMetadata, String> {
    let p = std::path::Path::new(&path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let parent = p.parent().map(|p| p.to_string_lossy().to_string());
    let canonical = std::fs::canonicalize(&p).unwrap_or_else(|_| p.to_path_buf());

    if !p.exists() {
        return Ok(PathMetadata {
            exists: false,
            is_dir: false,
            is_file: false,
            size: 0,
            modified: String::new(),
            name,
            parent,
            canonical_path: canonical.to_string_lossy().to_string(),
        });
    }

    let metadata = p.metadata().map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();

    Ok(PathMetadata {
        exists: true,
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        size: metadata.len(),
        modified,
        name,
        parent,
        canonical_path: canonical.to_string_lossy().to_string(),
    })
}

/// 读取文本文件内容，可选最大字符限制。
#[tauri::command]
fn read_text_file_at(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    if !p.is_file() {
        return Err(format!("不是文件: {}", path));
    }

    let content = std::fs::read_to_string(p)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if let Some(max) = max_bytes {
        if (content.len() as u64) > max {
            let safe_max = content.floor_char_boundary(max as usize);
            let mut truncated = content[..safe_max].to_string();
            truncated.push_str("\n\n... [内容过长，已截断]");
            return Ok(truncated);
        }
    }

    Ok(content)
}

/// 获取用户主目录路径。
#[tauri::command]
fn get_home_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .home_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.to_string_lossy().to_string())
}

// ─── 拖拽文件读取命令 ────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct FileContent {
    data: String,
    mime_type: String,
    is_image: bool,
    size: u64,
    name: String,
}

/// 读取拖拽丢入的文件内容。图片返回 base64 Data URL，文本返回 UTF-8 字符串。
#[tauri::command]
fn read_file_content(path: String) -> Result<FileContent, String> {
    use std::path::Path;
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    if !p.is_file() {
        return Err(format!("不是文件: {}", path));
    }

    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let size = p.metadata().map_err(|e| e.to_string())?.len();

    let mime_type = match p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        _ => "application/octet-stream",
    };
    let is_image = mime_type.starts_with("image/");

    if is_image {
        let bytes = std::fs::read(p).map_err(|e| format!("读取文件失败: {}", e))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(FileContent {
            data: format!("data:{};base64,{}", mime_type, encoded),
            mime_type: mime_type.to_string(),
            is_image: true,
            size,
            name,
        })
    } else {
        let text = std::fs::read_to_string(p).map_err(|e| format!("读取文件失败: {}", e))?;
        Ok(FileContent {
            data: text,
            mime_type: "text/plain".to_string(),
            is_image: false,
            size,
            name,
        })
    }
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

// ─── 命令执行 ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct CmdResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

/// 在本地 Shell 中执行任意命令。
/// Windows 使用 powershell，其余平台使用 sh -c。
/// PowerShell 下自动前置 UTF-8 编码设置，确保中文输出正确。
#[tauri::command]
async fn execute_command(
    command: String,
    working_dir: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let (shell, flag, cmd_arg): (&str, &str, String) = if cfg!(target_os = "windows") {
        // PowerShell 管道输出默认为 UTF-16LE，前置编码设置确保 UTF-8 捕获
        // 注意：仅设置 OutputEncoding，PowerShell 5.1 没有 ErrorEncoding 属性
        let ps_command = format!(
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8; {}",
            command
        );
        ("powershell", "-Command", ps_command)
    } else {
        ("sh", "-c", command)
    };

    let mut cmd = Command::new(shell);
    cmd.arg(flag)
        .arg(&cmd_arg)
        .kill_on_drop(true);

    if let Some(dir) = &working_dir {
        cmd.current_dir(dir);
    }

    let dur = Duration::from_millis(timeout_ms.unwrap_or(30_000));
    match timeout(dur, cmd.output()).await {
        Ok(Ok(output)) => Ok(CmdResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("进程执行失败: {}", e)),
        Err(_) => Ok(CmdResult {
            stdout: String::new(),
            stderr: "(命令执行超时)".to_string(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

// ─── 代码沙箱 ─────────────────────────────────────────────────────────────

/// 在隔离的临时目录中运行代码片段，支持超时控制。
/// 支持语言：python, javascript, typescript, shell, go, rust
#[tauri::command]
async fn run_code_sandbox(
    code: String,
    language: String,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let temp_base = std::env::temp_dir().join(format!("unicoda_sandbox_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_base).map_err(|e| e.to_string())?;

    let result = match language.as_str() {
        "python" | "py" => run_interpreter(&code, &temp_base, "python", "py", "snippet.py", timeout_ms).await,
        "javascript" | "js" => run_interpreter(&code, &temp_base, "node", "js", "snippet.js", timeout_ms).await,
        "typescript" | "ts" => run_interpreter(&code, &temp_base, "npx", "_ts", "snippet.ts", timeout_ms).await,
        "shell" | "sh" | "bash" => run_shell_snippet(&code, &temp_base, timeout_ms).await,
        "go" => run_interpreter(&code, &temp_base, "go", "_go", "main.go", timeout_ms).await,
        "rust" => run_rust_sandbox(&code, &temp_base, timeout_ms).await,
        _ => {
            let _ = std::fs::remove_dir_all(&temp_base);
            return Err(format!("不支持的 language: {}. 支持的: python, javascript, typescript, shell, go, rust", language));
        }
    };

    let _ = std::fs::remove_dir_all(&temp_base);
    result
}

async fn run_interpreter(
    code: &str,
    dir: &Path,
    interpreter: &str,
    _ext: &str,
    filename: &str,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let file_path = dir.join(filename);
    std::fs::write(&file_path, code).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(interpreter);
    if interpreter == "npx" {
        cmd.arg("tsx");
    }
    if interpreter == "go" {
        cmd.arg("run");
    }
    cmd.arg(file_path.to_string_lossy().to_string())
        .current_dir(dir)
        .kill_on_drop(true);

    let dur = Duration::from_millis(timeout_ms.unwrap_or(10_000));
    match timeout(dur, cmd.output()).await {
        Ok(Ok(output)) => Ok(CmdResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("进程执行失败: {}", e)),
        Err(_) => Ok(CmdResult {
            stdout: String::new(),
            stderr: "(执行超时)".to_string(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

async fn run_shell_snippet(
    code: &str,
    dir: &Path,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let ext = if cfg!(target_os = "windows") { "bat" } else { "sh" };
    let filename = format!("snippet.{}", ext);
    let file_path = dir.join(&filename);
    std::fs::write(&file_path, code).map_err(|e| e.to_string())?;

    let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };
    let runner = file_path.to_string_lossy().to_string();

    // Windows 用 cmd /C snippet.bat，Unix 用 sh snippet.sh
    let mut cmd = Command::new(shell);
    if cfg!(target_os = "windows") {
        cmd.arg(flag).arg(&runner);
    } else {
        cmd.arg(flag).arg(&runner);
    }
    cmd.current_dir(dir).kill_on_drop(true);

    let dur = Duration::from_millis(timeout_ms.unwrap_or(10_000));
    match timeout(dur, cmd.output()).await {
        Ok(Ok(output)) => Ok(CmdResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("进程执行失败: {}", e)),
        Err(_) => Ok(CmdResult {
            stdout: String::new(),
            stderr: "(执行超时)".to_string(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

async fn run_rust_sandbox(
    code: &str,
    dir: &Path,
    timeout_ms: Option<u64>,
) -> Result<CmdResult, String> {
    let src_dir = dir.join("src");
    std::fs::create_dir_all(&src_dir).map_err(|e| e.to_string())?;
    std::fs::write(src_dir.join("main.rs"), code).map_err(|e| e.to_string())?;

    let cargo_toml = r#"[package]
name = "snippet"
version = "0.1.0"
edition = "2021"

[dependencies]
"#;
    std::fs::write(dir.join("Cargo.toml"), cargo_toml).map_err(|e| e.to_string())?;

    let mut cmd = Command::new("cargo");
    cmd.args(["run", "--manifest-path", dir.join("Cargo.toml").to_string_lossy().as_ref()])
        .current_dir(dir)
        .kill_on_drop(true);

    let dur = Duration::from_millis(timeout_ms.unwrap_or(30_000));
    match timeout(dur, cmd.output()).await {
        Ok(Ok(output)) => Ok(CmdResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Err(format!("Rust 执行失败: {}", e)),
        Err(_) => Ok(CmdResult {
            stdout: String::new(),
            stderr: "(编译/运行超时)".to_string(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

// ─── App Entry ─────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            http_fetch,
            save_config,
            load_config,
            get_config_dir_path,
            get_default_session_dir,
            save_file_at_path,
            write_text_file_at,
            load_file_from_path,
            remove_file_at_path,
            list_directory,
            search_files,
            get_path_metadata,
            read_text_file_at,
            get_home_directory,
            save_credential,
            load_credential,
            delete_credential,
            clear_search_cookies,
            get_cookie_info,
            read_file_content,
            execute_command,
            run_code_sandbox,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
