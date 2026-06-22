/**
 * 配置文件持久化工具
 *
 * 通过 Tauri IPC 将配置写入文件。
 * 若 Tauri 不可用（如在浏览器开发模式下），自动回退到 localStorage。
 *
 * - 配置文件（theme/lock/conversations）：写入加密文件（DPAPI，仅 Windows）
 * - API Key：存入 Windows Credential Manager（仅 Windows）
 * - sessionPath 文件：不加密（用于会话库等非敏感内容）
 *
 * sessionPath 参数约定：
 *   - undefined（不传）→ 使用加密的默认 configs 目录（供 ThemeContext 设置使用）
 *   - ""（空字符串）→ 使用用户目录下的 UnicodaSessions（新默认值）
 *   - "自定义路径" → 使用指定的自定义路径
 */

import { invoke } from "@tauri-apps/api/core";

// ── 默认会话路径缓存 ───────────────────────────────────────────

let defaultSessionDirPromise: Promise<string> | null = null;

/**
 * 解析用户目录下的默认会话存储路径（{homeDir}/UnicodaSessions）。
 * 结果会缓存，只调用一次 Rust IPC。
 */
export async function resolveDefaultSessionDir(): Promise<string> {
  if (!defaultSessionDirPromise) {
    defaultSessionDirPromise = invoke<string>("get_default_session_dir");
  }
  return defaultSessionDirPromise;
}

/**
 * 将数据异步写入 JSON 文件。
 * @param key 文件名键（自动拼接 .json）
 * @param data 要写入的数据
 * @param sessionPath 可选的自定义存储目录
 *   - undefined：使用加密的默认 configs 目录（ThemeContext 设置使用）
 *   - ""：使用用户目录下的 UnicodaSessions
 *   - "自定义路径"：使用指定的路径
 */
export async function writeConfigFile<T>(
  key: string,
  data: T,
  sessionPath?: string,
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  // localStorage 同步缓存
  try {
    localStorage.setItem(key, json);
  } catch { /* ignore */ }

  if (sessionPath !== undefined) {
    // sessionPath 已传入（可能为空字符串或自定义路径）→ 不加密
    const actualPath = sessionPath || await resolveDefaultSessionDir();
    try {
      await invoke("save_file_at_path", {
        dir: actualPath,
        filename: `${key}.json`,
        data: json,
      });
    } catch { /* ignore */ }
  } else {
    // undefined → 写入加密的默认 configs 目录
    try {
      await invoke("save_config", { filename: `${key}.json`, data: json });
    } catch { /* ignore */ }
  }
}

/**
 * 从 JSON 文件异步读取数据。
 * @param key 文件名键（自动拼接 .json）
 * @param fallback 文件不存在时的默认值
 * @param sessionPath 可选的自定义存储目录
 *   - undefined：使用加密的默认 configs 目录
 *   - ""：使用用户目录下的 UnicodaSessions
 *   - "自定义路径"：使用指定的路径
 */
export async function readConfigFile<T>(
  key: string,
  fallback: T,
  sessionPath?: string,
): Promise<T> {
  if (sessionPath !== undefined) {
    // sessionPath 已传入 → 从指定路径读取（不加密）
    const actualPath = sessionPath || await resolveDefaultSessionDir();
    try {
      const raw: string = await invoke("load_file_from_path", {
        dir: actualPath,
        filename: `${key}.json`,
      });
      return JSON.parse(raw) as T;
    } catch { /* 文件不存在，fallback 到 localStorage */ }
  } else {
    // undefined → 从加密的默认 configs 目录读取
    try {
      const raw: string = await invoke("load_config", {
        filename: `${key}.json`,
      });
      return JSON.parse(raw) as T;
    } catch { /* fallback 到 localStorage */ }
  }
  // localStorage 后备
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

/**
 * 获取加密配置文件目录的绝对路径（供设置面板显示）。
 */
export async function getConfigDir(): Promise<string | null> {
  try {
    return await invoke<string>("get_config_dir_path");
  } catch {
    return null;
  }
}

// ─── Windows Credential Manager API ─────────────────────────────────────

/** 凭据目标名前缀 */
const CRED_PREFIX = "Unicoda/apiKey/";

/**
 * 将 API Key 存入 Windows Credential Manager。
 * @param modelId 模型 ID
 * @param apiKey API 密钥
 */
export async function saveApiKey(modelId: string, apiKey: string): Promise<void> {
  if (!apiKey) return; // 空 key 不存储
  try {
    await invoke("save_credential", {
      target: `${CRED_PREFIX}${modelId}`,
      secret: apiKey,
    });
  } catch {
    // fallback: 存到 localStorage
    try {
      const keyMap = JSON.parse(localStorage.getItem("unicoda-apikeys") || "{}");
      keyMap[modelId] = apiKey;
      localStorage.setItem("unicoda-apikeys", JSON.stringify(keyMap));
    } catch { /* ignore */ }
  }
}

/**
 * 从 Windows Credential Manager 读取 API Key。
 * @param modelId 模型 ID
 */
export async function loadApiKey(modelId: string): Promise<string> {
  try {
    const result: string | null = await invoke("load_credential", {
      target: `${CRED_PREFIX}${modelId}`,
    });
    if (result) return result;
  } catch { /* fallback */ }

  // fallback: 从 localStorage 读取
  try {
    const keyMap = JSON.parse(localStorage.getItem("unicoda-apikeys") || "{}");
    return keyMap[modelId] || "";
  } catch { /* ignore */ }
  return "";
}

/**
 * 从 Windows Credential Manager 删除 API Key。
 * @param modelId 模型 ID
 */
export async function deleteApiKey(modelId: string): Promise<void> {
  try {
    await invoke("delete_credential", {
      target: `${CRED_PREFIX}${modelId}`,
    });
  } catch { /* ignore */ }

  // 同时清理 localStorage fallback
  try {
    const keyMap = JSON.parse(localStorage.getItem("unicoda-apikeys") || "{}");
    delete keyMap[modelId];
    localStorage.setItem("unicoda-apikeys", JSON.stringify(keyMap));
  } catch { /* ignore */ }
}
