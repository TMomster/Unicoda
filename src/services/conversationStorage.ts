/**
 * 会话库持久化服务
 *
 * 存储结构（单一会话库根路径）：
 *   {sessionPath}/
 *     normal/
 *       metadata.json         ← 会话列表元数据（不含消息体）
 *       literals/{id}.json    ← 字面量：用户界面上看到的完整消息记录（永不压缩）
 *       memory/{id}.json      ← 记忆量：实际发给模型的消息记录（可能被压缩）
 *     yolo/
 *       metadata.json
 *       literals/{id}.json
 *       memory/{id}.json
 *
 * "字面量" 文件保存用户看到的完整、未压缩的对话历史。
 * "记忆量" 文件保存实际发送给模型的对话数据，压缩仅影响记忆量文件。
 * 上下文容量计算（token 用量）基于记忆量文件。
 */

import type { Conversation, Message } from "../types";
import { writeConfigFile, readConfigFile, resolveDefaultSessionDir } from "../utils/configStorage";

// ── 文件名常量 ──────────────────────────────────────────────

const METADATA_FILE = "metadata";
const LITERALS_DIR = "literals";
const MEMORY_DIR = "memory";

// ── 元数据定义（不含 messages / memoryMessages） ──────────────

export interface ConversationMeta {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  autoTitleDone?: boolean;
  workspacePath?: string;
}

// ── 路径辅助 ──────────────────────────────────────────────────

function subPath(mode: "normal" | "yolo"): string {
  return `${mode}`;
}

function literalPath(convId: string, mode: "normal" | "yolo"): string {
  return `${mode}/${LITERALS_DIR}/${convId}`;
}

function memoryPath(convId: string, mode: "normal" | "yolo"): string {
  return `${mode}/${MEMORY_DIR}/${convId}`;
}

// ── 元数据读写 ────────────────────────────────────────────────

export async function loadMetadata(
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<ConversationMeta[]> {
  const key = `${subPath(mode)}/${METADATA_FILE}`;
  return readConfigFile<ConversationMeta[]>(key, [], sessionPath);
}

export async function saveMetadata(
  metas: ConversationMeta[],
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<void> {
  const key = `${subPath(mode)}/${METADATA_FILE}`;
  await writeConfigFile(key, metas, sessionPath);
}

// ── 字面量（literals）读写 ──────────────────────────────────

export async function loadLiteralMessages(
  convId: string,
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<Message[] | null> {
  const key = literalPath(convId, mode);
  try {
    return await readConfigFile<Message[]>(key, null as unknown as Message[], sessionPath);
  } catch {
    return null;
  }
}

export async function saveLiteralMessages(
  convId: string,
  messages: Message[],
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<void> {
  const key = literalPath(convId, mode);
  await writeConfigFile(key, messages, sessionPath);
}

// ── 记忆量（memory）读写 ────────────────────────────────────

export async function loadMemoryMessages(
  convId: string,
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<Message[] | null> {
  const key = memoryPath(convId, mode);
  try {
    return await readConfigFile<Message[]>(key, null as unknown as Message[], sessionPath);
  } catch {
    return null;
  }
}

export async function saveMemoryMessages(
  convId: string,
  messages: Message[],
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<void> {
  const key = memoryPath(convId, mode);
  await writeConfigFile(key, messages, sessionPath);
}

// ── 删除会话相关文件 ───────────────────────────────────────────

export async function deleteConversationFiles(
  convId: string,
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<void> {
  const actualPath = sessionPath || await resolveDefaultSessionDir();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_file_at_path", {
      dir: actualPath,
      filename: `${literalPath(convId, mode)}.json`,
    });
    await invoke("remove_file_at_path", {
      dir: actualPath,
      filename: `${memoryPath(convId, mode)}.json`,
    });
  } catch {
    // 静默忽略
  }
}

// ── 会话数据完整落盘（元数据 + 字面量 + 记忆量） ─────────────

export async function flushConversationData(
  activeConv: Conversation | null,
  metas: ConversationMeta[],
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<void> {
  // 1. 写元数据
  await saveMetadata(metas, mode, sessionPath);
  // 2. 写当前活跃会话的消息文件
  if (activeConv) {
    await saveLiteralMessages(activeConv.id, activeConv.messages, mode, sessionPath);
    await saveMemoryMessages(
      activeConv.id,
      activeConv.memoryMessages ?? activeConv.messages,
      mode,
      sessionPath,
    );
  }
}

// ── 从 Conversation 提取元数据 ────────────────────────────────

export function toMeta(conv: Conversation): ConversationMeta {
  return {
    id: conv.id,
    title: conv.title,
    pinned: conv.pinned,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    autoTitleDone: conv.autoTitleDone,
    workspacePath: conv.workspacePath,
  };
}

// ── 从旧格式一次性迁移到新格式 ────────────────────────────────
// 将旧的单文件格式（全部 conversations 写在一起）迁移为新文件格式

export async function migrateFromOldFormat(
  oldKey: string,
  mode: "normal" | "yolo",
  sessionPath: string,
): Promise<boolean> {
  const actualPath = sessionPath || await resolveDefaultSessionDir();
  if (!actualPath) return false;
  try {
    const raw = localStorage.getItem(oldKey);
    if (!raw) return false;
    const oldConvs: Conversation[] = JSON.parse(raw);
    if (oldConvs.length === 0) return false;

    // 检查是否已迁移（文件已存在）
    const existingMetas = await loadMetadata(mode, actualPath);
    if (existingMetas.length > 0) return false;

    const metas: ConversationMeta[] = [];
    for (const conv of oldConvs) {
      metas.push(toMeta(conv));
      // 字面量 = memory = 原 messages
      await saveLiteralMessages(conv.id, conv.messages, mode, actualPath);
      await saveMemoryMessages(conv.id, conv.messages, mode, actualPath);
    }
    await saveMetadata(metas, mode, actualPath);

    // 清理旧 localStorage 数据
    localStorage.removeItem(oldKey);

    // 清理旧磁盘文件（旧格式是单文件 {actualPath}/{oldKey}.json）
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("remove_file_at_path", { dir: actualPath, filename: `${oldKey}.json` });
    } catch { /* 忽略删除失败 */ }

    return true;
  } catch {
    return false;
  }
}
