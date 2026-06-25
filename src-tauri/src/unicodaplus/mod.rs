pub mod server;

use serde::{Deserialize, Serialize};

// ─── 协议消息类型（与 Pompeii 的 PlusMessage 完全兼容） ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlusMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub timestamp: u128,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<AppInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<Capability>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_response_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<Parameter>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parameter {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub required: bool,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#enum: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
}

// ─── 工具函数 ───

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

// ─── 客户端连接信息 ───

#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo {
    pub app_name: String,
    pub app_version: String,
    pub app_description: String,
    pub capabilities: Vec<Capability>,
    pub connected_at: u128,
    pub last_heartbeat: u128,
    pub remote_addr: String,
    pub capabilities_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub clients: Vec<ClientInfo>,
    pub enabled: bool,
}
