use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::{new_uuid, timestamp, AppInfo, ClientInfo, PlusMessage, ServerStatus};

/// 全局服务器状态
pub struct PlusServerManager {
    pub running: Arc<AtomicBool>,
    pub port: Mutex<Option<u16>>,
    pub clients: Arc<Mutex<Vec<ClientInfo>>>,
    server_thread: Mutex<Option<thread::JoinHandle<()>>>,
}

impl PlusServerManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Mutex::new(None),
            clients: Arc::new(Mutex::new(Vec::new())),
            server_thread: Mutex::new(None),
        }
    }

    /// 启动 TCP 服务器，监听 51787-51797 范围内的一个空闲端口
    pub fn start(&self) -> Result<u16, String> {
        if self.running.load(Ordering::Relaxed) {
            let port = *self.port.lock().unwrap();
            if let Some(p) = port {
                return Ok(p);
            }
        }

        // 尝试绑定端口
        let listener = find_available_port(51787, 51797)?;
        let port = listener.local_addr().map_err(|e| format!("获取地址失败: {}", e))?.port();

        eprintln!("[PlusServer] 启动 TCP 服务器在端口 {}", port);

        // 写入端口文件，供 Pompeii 发现
        write_port_file(port)?;

        // 更新状态
        self.running.store(true, Ordering::Relaxed);
        *self.port.lock().unwrap() = Some(port);

        // 清空旧客户端列表
        self.clients.lock().unwrap().clear();

        // 启动后台线程处理连接
        let running = self.running.clone();
        let clients = self.clients.clone();
        let listener = Arc::new(listener);

        let handle = thread::spawn(move || {
            listener.set_nonblocking(true).ok();
            let mut incoming = Vec::new();

            while running.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, addr)) => {
                        eprintln!("[PlusServer] 新连接来自: {}", addr);
                        let clients_clone = clients.clone();
                        let running_clone = running.clone();
                        incoming.push(thread::spawn(move || {
                            handle_client(stream, addr.to_string(), clients_clone, running_clone);
                        }));
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // 没有待处理的连接，休眠短暂时间
                        thread::sleep(Duration::from_millis(200));
                    }
                    Err(e) => {
                        eprintln!("[PlusServer] 接受连接失败: {}", e);
                        thread::sleep(Duration::from_secs(1));
                    }
                }

                // 清理已完成的线程
                incoming.retain(|h| !h.is_finished());
            }

            // 发送 SHUTDOWN 给所有客户端
            eprintln!("[PlusServer] 服务器停止，等待连接关闭...");
            // 等待最多 2 秒
            for h in incoming.drain(..) {
                let _ = h.join();
            }
            eprintln!("[PlusServer] 服务器已完全停止");
        });

        *self.server_thread.lock().unwrap() = Some(handle);

        eprintln!("[PlusServer] 服务器已在端口 {} 上启动", port);
        Ok(port)
    }

    /// 停止 TCP 服务器
    pub fn stop(&self) {
        if !self.running.load(Ordering::Relaxed) {
            return;
        }

        eprintln!("[PlusServer] 正在停止服务器...");
        self.running.store(false, Ordering::Relaxed);

        // 移除端口文件
        remove_port_file();

        // 清空客户端列表
        self.clients.lock().unwrap().clear();
        *self.port.lock().unwrap() = None;

        eprintln!("[PlusServer] 服务器已停止");
    }

    /// 获取当前服务器状态
    pub fn get_status(&self, enabled: bool) -> ServerStatus {
        let clients = self.clients.lock().unwrap().clone();
        let port = *self.port.lock().unwrap();
        ServerStatus {
            running: self.running.load(Ordering::Relaxed),
            port,
            clients,
            enabled,
        }
    }
}

unsafe impl Send for PlusServerManager {}
unsafe impl Sync for PlusServerManager {}

// ─── 客户端连接处理 ───

fn handle_client(stream: TcpStream, addr: String, clients: Arc<Mutex<Vec<ClientInfo>>>, running: Arc<AtomicBool>) {
    let peer = stream.peer_addr().ok().map(|a| a.to_string()).unwrap_or_else(|| addr.clone());

    // 设置读超时
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));

    let (reader, mut writer) = match stream.try_clone() {
        Ok(r) => (r, stream),
        Err(e) => {
            eprintln!("[PlusServer] 克隆流失败: {}", e);
            return;
        }
    };

    // 发送欢迎消息（ACK）
    let ack = PlusMessage {
        msg_type: "WELCOME".into(),
        id: new_uuid(),
        timestamp: timestamp(),
        version: "0.1".into(),
        app: Some(AppInfo {
            name: "Unicoda".into(),
            version: "0.1.0".into(),
            description: "AI 编程助手".into(),
        }),
        capabilities: None,
        capability: None,
        params: None,
        in_response_to: None,
        success: Some(true),
        data: None,
        error: None,
        status: Some("connected".into()),
        reason: None,
    };

    if let Err(e) = send_message(&mut writer, &ack) {
        eprintln!("[PlusServer] 发送 WELCOME 失败: {}", e);
        return;
    }

    let _client_info: Option<ClientInfo> = None;
    let buf_reader = BufReader::new(reader);

    for line in buf_reader.lines() {
        if !running.load(Ordering::Relaxed) {
            break;
        }

        let text = match line {
            Ok(t) => t,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => {
                eprintln!("[PlusServer] 客户端 {} 连接断开: {}", peer, e);
                break;
            }
        };

        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }

        let msg: PlusMessage = match serde_json::from_str(&trimmed) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[PlusServer] JSON 解析失败 (来自 {}): {}", peer, e);
                continue;
            }
        };

        match msg.msg_type.as_str() {
            "CAPABILITY_ANNOUNCE" => {
                let app = msg.app.unwrap_or(AppInfo {
                    name: "Unknown".into(),
                    version: "0.0.0".into(),
                    description: String::new(),
                });
                let caps = msg.capabilities.unwrap_or_default();
                let caps_count = caps.len();

                let info = ClientInfo {
                    app_name: app.name.clone(),
                    app_version: app.version.clone(),
                    app_description: app.description.clone(),
                    capabilities: caps,
                    connected_at: timestamp(),
                    last_heartbeat: timestamp(),
                    remote_addr: peer.clone(),
                    capabilities_count: caps_count,
                };

                // 更新/添加客户端
                let mut list = clients.lock().unwrap();
                if let Some(pos) = list.iter().position(|c| c.remote_addr == peer) {
                    list[pos] = info.clone();
                } else {
                    list.push(info.clone());
                }

                eprintln!("[PlusServer] ← CAPABILITY_ANNOUNCE ({} — {} 个能力)", app.name, caps_count);
            }

            "HEARTBEAT" => {
                // 更新客户端在线状态
                let mut list = clients.lock().unwrap();
                if let Some(c) = list.iter_mut().find(|c| c.remote_addr == peer) {
                    c.last_heartbeat = timestamp();
                }
                drop(list); // 释放锁，避免与 send_message 冲突

                // 回复心跳，防止客户端读超时
                let hb = PlusMessage {
                    msg_type: "HEARTBEAT".into(),
                    id: new_uuid(),
                    timestamp: timestamp(),
                    version: "0.1".into(),
                    app: None,
                    capabilities: None,
                    capability: None,
                    params: None,
                    in_response_to: None,
                    success: None,
                    data: None,
                    error: None,
                    status: None,
                    reason: None,
                };
                let _ = send_message(&mut writer, &hb);
            }

            "SHUTDOWN" => {
                let reason = msg.reason.as_deref().unwrap_or("unknown");
                eprintln!("[PlusServer] ← SHUTDOWN ({}): {}", peer, reason);
                break;
            }

            "OPERATION_RESULT" => {
                // 操作结果，目前仅日志记录
                let success = msg.success.unwrap_or(false);
                let in_response_to = msg.in_response_to.as_deref().unwrap_or("unknown");
                if success {
                    eprintln!("[PlusServer] ← OPERATION_RESULT (success, response_to={})", in_response_to);
                } else {
                    let default_err = "unknown".to_string();
                    let err_msg = msg.error.as_ref().map(|e| &e.message).unwrap_or(&default_err);
                    eprintln!("[PlusServer] ← OPERATION_RESULT (failed, response_to={}, error={})", in_response_to, err_msg);
                }
            }

            _ => {
                eprintln!("[PlusServer] ← 未知消息类型: {} (来自 {})", msg.msg_type, peer);
            }
        }
    }

    // 客户端断开
    let mut list = clients.lock().unwrap();
    list.retain(|c| c.remote_addr != peer);
    eprintln!("[PlusServer] 客户端 {} 已断开", peer);
}

// ─── 工具函数 ───

fn send_message(stream: &mut TcpStream, msg: &PlusMessage) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| format!("序列化失败: {}", e))?;
    writeln!(stream, "{}", json).map_err(|e| format!("写入失败: {}", e))?;
    stream.flush().map_err(|e| format!("flush 失败: {}", e))?;
    Ok(())
}

/// 在指定端口范围内查找空闲端口并绑定
fn find_available_port(start: u16, end: u16) -> Result<TcpListener, String> {
    for port in start..=end {
        let addr = format!("127.0.0.1:{}", port);
        match TcpListener::bind(&addr) {
            Ok(listener) => {
                return Ok(listener);
            }
            Err(_) => {
                continue;
            }
        }
    }
    Err(format!("无法绑定端口 {}-{}，所有端口均被占用", start, end))
}

/// 获取端口文件的标准路径
/// 与 Pompeii 的 discovery.rs 中路径一致
fn get_port_file_path() -> std::path::PathBuf {
    // Windows: %APPDATA%\Unicoda\unicodaplus.json
    // macOS:   ~/Library/Application Support/Unicoda/unicodaplus.json
    // Linux:   ~/.local/share/Unicoda/unicodaplus.json
    let base = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("Unicoda").join("unicodaplus.json")
}

/// 写入端口文件，供 Pompeii 发现
fn write_port_file(port: u16) -> Result<(), String> {
    let path = get_port_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let port_info = serde_json::json!({
        "version": "0.1",
        "host": "127.0.0.1",
        "port": port,
        "pid": std::process::id(),
        "started_at": timestamp(),
    });

    std::fs::write(&path, serde_json::to_string_pretty(&port_info).unwrap())
        .map_err(|e| format!("写入端口文件失败: {}", e))?;

    eprintln!("[PlusServer] 端口文件写入: {:?}", path);
    Ok(())
}

/// 移除端口文件
fn remove_port_file() {
    let path = get_port_file_path();
    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            eprintln!("[PlusServer] 删除端口文件失败: {}", e);
        } else {
            eprintln!("[PlusServer] 端口文件已删除");
        }
    }
}
