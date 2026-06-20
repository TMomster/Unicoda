/**
 * 文件写入模组（write_to_file）。
 *
 * 等级：sensitive（敏感模组，仅 Agent 模式可调用，Chat 模式不可见）
 *
 * 功能：允许模型向用户设备写入文本文件。
 * ⚠️ 此模组具有写入能力，使用前应确认用户意图。
 *
 * 参数：
 *   path     - （必填）目标文件绝对路径，如 C:\Users\Name\test.txt
 *   content  - （必填）要写入的文本内容
 *   action   - （可选）"write"（写入新文件/覆盖，默认）| "append"（追加到文件末尾）
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

const mod: Module = {
  id: "write_to_file",
  name: "写入文件",
  description:
    "向设备本地文件系统写入文本内容。支持创建新文件、覆盖已有文件或追加内容。\n\n" +
    "操作（通过 action 参数指定）：\n" +
    "- write（默认）：创建新文件或覆盖已有文件\n" +
    "- append：将内容追加到已有文件末尾（文件不存在时会自动创建）\n\n" +
    "⚠️ 本模组具有文件写入能力，请在确认用户意图后再使用。写入路径请使用绝对路径。",
  level: "sensitive",
  parameters: [
    {
      name: "path",
      type: "string",
      required: true,
      description:
        "目标文件的绝对路径，如 C:\\Users\\Name\\Documents\\notes.txt。路径中的父目录会自动创建。",
    },
    {
      name: "content",
      type: "string",
      required: true,
      description: "要写入文件的文本内容。",
    },
    {
      name: "action",
      type: "string",
      required: false,
      default: "write",
      description:
        "操作类型：write（写入/覆盖，默认）或 append（追加到文件末尾）",
    },
  ],
  execute: async function* (params, _signal) {
    const path = params.path;
    if (!path) {
      yield "错误：write_to_file 需要提供 path 参数（目标文件绝对路径）。";
      return;
    }
    const content = params.content ?? "";
    const action = (params.action ?? "write").toLowerCase();

    if (action === "append") {
      // 读取现有内容后追加
      let existing = "";
      try {
        existing = await invoke<string>("read_text_file_at", {
          path,
          maxBytes: null as unknown as number | null,
        });
      } catch {
        // 文件不存在，直接写入即可
      }
      const newContent = existing + content;
      try {
        await invoke("write_text_file_at", { path, data: newContent });
        const sizeHint = `（${newContent.length} 字符）`;
        yield `✅ 已追加内容到文件：${path}${sizeHint}`;
      } catch (err) {
        yield `错误：追加文件失败 - ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      // write（写入/覆盖）
      try {
        await invoke("write_text_file_at", { path, data: content });
        const sizeHint = `（${content.length} 字符）`;
        yield `✅ 文件已写入：${path}${sizeHint}`;
      } catch (err) {
        yield `错误：写入文件失败 - ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  },
};

registerModule(mod);
