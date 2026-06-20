/**
 * 本地文件读取模组（read_from_files）。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 功能：允许模型浏览设备文件系统、读取文本文件内容、获取路径信息。
 * ⚠️ 仅支持只读操作，不支持写入、修改或删除文件。
 *
 * 操作（action 参数）：
 *   pwd      - 显示当前工作目录路径
 *   cd       - 切换当前目录（path 参数指定目标目录）
 *   list_dir - 列出目录内容（path 可选，默认当前目录）
 *   read_file- 读取文本文件内容（path 必填，maxChars 可选）
 *   get_info - 获取路径详细信息（path 可选，默认当前目录）
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

// ─── 接口定义 ─────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: string;
}

interface PathMetadata {
  exists: boolean;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: string;
  name: string;
  parent: string | null;
  canonical_path: string;
}

// ─── 模块状态 ─────────────────────────────────────────────────────────

let currentDir: string = "";
let homeDirInited = false;

async function ensureHomeDir(): Promise<void> {
  if (homeDirInited) return;
  const home = await invoke<string>("get_home_directory");
  currentDir = home;
  homeDirInited = true;
}

// ─── 路径工具函数 ───────────────────────────────────────────────────────

function isAbsolute(p: string): boolean {
  // Windows: C:\... 或 \\...\ 或 /
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[/\\]/.test(p)) return true;
  return false;
}

/** 解析路径（支持 ~ 为 home目录、相对路径） */
function resolvePath(target: string, cwd: string, home: string): string {
  // 展开 ~
  if (target.startsWith("~")) {
    target = home + target.slice(1);
  }
  // 绝对路径直通
  if (isAbsolute(target)) return target;
  // 相对路径 → 拼接当前目录
  const combined = cwd.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + target.replace(/\\/g, "/");
  return normalizePath(combined);
}

/** 规范化路径：处理 . 和 .. */
function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  const result: string[] = [];
  for (const seg of parts) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      }
      continue;
    }
    result.push(seg);
  }
  // 保留 UNC 或根前缀
  const isUnc = p.startsWith("//") || p.startsWith("\\\\");
  const hasDrive = /^[a-zA-Z]:$/.test(parts[0] || "");
  if (isUnc) return "//" + result.join("/");
  if (hasDrive) return parts[0] + "/" + result.slice(1).join("/");
  if (p.startsWith("/")) return "/" + result.join("/");
  return result.join("/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(epochSecs: string): string {
  if (!epochSecs) return "未知";
  const d = new Date(parseInt(epochSecs, 10) * 1000);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Module 定义 ───────────────────────────────────────────────────────

const mod: Module = {
  id: "read_from_files",
  name: "读取文件",
  description:
    "读取设备内的本地文件，支持浏览文件系统目录、查看目录内容、打开文本文件并获取文件/路径信息。\n\n" +
    "可执行的操作（通过 action 参数指定）：\n" +
    "- pwd：显示当前工作目录路径\n" +
    "- cd：切换到指定目录（path 参数指定目标目录，支持相对路径和绝对路径）\n" +
    "- list_dir：列出指定目录的内容（path 可选，默认当前目录），显示文件名、大小、修改时间\n" +
    "- read_file：读取指定文件的内容（path 必填），仅支持文本文件，默认最多 50000 字符\n" +
    "- get_info：获取路径的详细信息（path 可选，默认当前目录）\n\n" +
    "⚠️ 本模组仅支持读取文件，不支持写入、修改或删除操作。二进制文件无法读取内容。",
  level: "normal",
  parameters: [
    {
      name: "action",
      type: "string",
      required: true,
      description:
        "操作类型：pwd（显示当前目录）、cd（切换目录）、list_dir（列出目录内容）、read_file（读取文件内容）、get_info（获取路径信息）",
    },
    {
      name: "path",
      type: "string",
      required: false,
      description:
        "目标路径（绝对路径或相对路径）。cd 和 read_file 时必须提供；list_dir 和 get_info 可选，默认使用当前目录。支持 ~ 表示用户主目录",
    },
    {
      name: "maxChars",
      type: "number",
      required: false,
      default: "50000",
      description: "读取文件时最大字符数（500～200000），超出部分截断",
      min: 500,
      max: 200000,
    },
  ],
  execute: async function* (params, _signal) {
    await ensureHomeDir();
    const action = params.action;
    const home = await invoke<string>("get_home_directory");

    try {
      switch (action) {
        // ── pwd ──
        case "pwd": {
          yield `📁 当前工作目录：\n${currentDir}`;
          break;
        }

        // ── cd ──
        case "cd": {
          const target = params.path;
          if (!target) {
            yield "错误：cd 操作需要提供 path 参数。";
            return;
          }
          const resolved = resolvePath(target, currentDir, home);
          const info = await invoke<PathMetadata>("get_path_metadata", {
            path: resolved,
          });
          if (!info.exists) {
            yield `错误：目录不存在: ${resolved}`;
            return;
          }
          if (!info.is_dir) {
            yield `错误：不是目录: ${resolved}`;
            return;
          }
          currentDir = info.canonical_path;
          yield `📁 已切换到：${currentDir}`;
          break;
        }

        // ── list_dir ──
        case "list_dir": {
          const target = params.path
            ? resolvePath(params.path, currentDir, home)
            : currentDir;
          const entries = await invoke<DirEntry[]>("list_directory", {
            path: target,
          });

          const lines: string[] = [];
          lines.push(`📂 目录：${target}`);
          lines.push(`共 ${entries.length} 个条目\n`);

          if (entries.length === 0) {
            lines.push("（空目录）");
          } else {
            // 表头
            lines.push(
              `${"名称".padEnd(40)}${"类型".padEnd(6)}${"大小".padEnd(10)}修改时间`,
            );
            lines.push("─".repeat(70));
            for (const e of entries) {
              const icon = e.is_dir ? "📁" : "📄";
              const typeStr = e.is_dir ? "目录" : "文件";
              const sizeStr = e.is_file ? formatSize(e.size) : "-";
              const timeStr = formatTimestamp(e.modified);
              // 名称太长时截断
              const nameDisplay =
                e.name.length > 36
                  ? e.name.slice(0, 33) + "..."
                  : e.name;
              lines.push(
                `${icon} ${nameDisplay.padEnd(37)}${typeStr.padEnd(6)}${sizeStr.padEnd(10)}${timeStr}`,
              );
            }
          }

          yield lines.join("\n");
          break;
        }

        // ── read_file ──
        case "read_file": {
          const target = params.path;
          if (!target) {
            yield "错误：read_file 操作需要提供 path 参数。";
            return;
          }
          const resolved = resolvePath(target, currentDir, home);

          // 先获取路径信息判断类型
          const info = await invoke<PathMetadata>("get_path_metadata", {
            path: resolved,
          });
          if (!info.exists) {
            yield `错误：文件不存在: ${resolved}`;
            return;
          }
          if (!info.is_file) {
            yield `错误：路径不是文件: ${resolved}`;
            return;
          }

          const maxChars = Math.min(
            Math.max(parseInt(params.maxChars) || 50000, 500),
            200000,
          );

          try {
            const content = await invoke<string>("read_text_file_at", {
              path: resolved,
              maxBytes: maxChars,
            });
            yield `📄 文件：${resolved} (${formatSize(info.size)})\n\n${content}`;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes("不是有效的 UTF-8") ||
              msg.includes("stream did not contain valid UTF-8") ||
              msg.includes("未包含有效的 UTF-8")
            ) {
              yield `错误：文件 "${resolved}" 不是文本文件或包含无法解析的二进制内容，无法读取。`;
            } else {
              yield `读取文件失败: ${msg}`;
            }
          }
          break;
        }

        // ── get_info ──
        case "get_info": {
          const target = params.path
            ? resolvePath(params.path, currentDir, home)
            : currentDir;
          const info = await invoke<PathMetadata>("get_path_metadata", {
            path: target,
          });

          const lines: string[] = [];
          lines.push(`ℹ️ 路径信息：${target}\n`);
          lines.push(`名称: ${info.name}`);
          lines.push(`存在: ${info.exists}`);
          if (info.exists) {
            lines.push(`类型: ${info.is_dir ? "📁 目录" : info.is_file ? "📄 文件" : "其他"}`);
            lines.push(`大小: ${formatSize(info.size)}`);
            if (info.modified) {
              lines.push(`修改时间: ${formatTimestamp(info.modified)}`);
            }
            lines.push(`规范路径: ${info.canonical_path}`);
            if (info.parent) {
              lines.push(`父目录: ${info.parent}`);
            }
            if (info.is_dir) {
              // 显示前 20 项预览
              const entries = await invoke<DirEntry[]>("list_directory", {
                path: info.canonical_path,
              });
              lines.push(`\n目录内容预览（${entries.length} 个条目中的前 20 个）：`);
              const preview = entries.slice(0, 20);
              for (const e of preview) {
                const icon = e.is_dir ? "📁" : "📄";
                lines.push(`  ${icon} ${e.name}`);
              }
              if (entries.length > 20) {
                lines.push(`  ... 还有 ${entries.length - 20} 个条目`);
              }
            }
          }
          yield lines.join("\n");
          break;
        }

        default: {
          yield `错误：未知操作 "${action}"。可用操作：pwd, cd, list_dir, read_file, get_info。`;
        }
      }
    } catch (err) {
      yield `操作失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
