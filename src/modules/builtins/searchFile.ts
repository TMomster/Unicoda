/**
 * 文件搜索模组（search_file）。
 *
 * 等级：normal（所有模式可用）
 *
 * 功能：在本地文件系统中搜索文件名，支持 glob 通配符匹配。
 *       自动递归子目录，跳过隐藏目录和系统目录。
 *       与 search_in_project 不同，本模组仅匹配文件名（不搜索内容），
 *       适合在大目录（如游戏库、下载目录等）中快速定位文件。
 *
 * ⚡ 搜索逻辑在 Rust 端（walkdir + regex）一次完成，避免多次 IPC 调用，
 *    搜索大目录时性能提升显著（数千次 IPC → 1 次）。
 *
 * 参数：
 *   pattern  - （必填）文件通配符模式，支持 * 和 ?，如 "*Sanoba*"、"Report*.pdf"
 *   path     - （必填）搜索根目录绝对路径，如 "G:\\games" 或 "/home/user/downloads"
 *   maxResults - （可选）最大返回结果数，默认 50，建议不超过 100
 *   maxDepth   - （可选）最大递归深度，默认 10
 *   caseSensitive - （可选）是否区分大小写，默认 false（不区分）
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

interface SearchFileResult {
  path: string;
  size: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatResults(
  pattern: string,
  rootPath: string,
  results: SearchFileResult[],
  maxResults: number,
): string {
  const lines: string[] = [];
  lines.push(`> 文件搜索: "${pattern}" 在 ${rootPath}`);
  lines.push(`找到 ${results.length} 个匹配文件（限制 ${maxResults} 条）\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sizeStr = formatFileSize(r.size);
    // 显示相对于根目录的路径，更简洁
    const relPath = r.path.replace(/\\/g, "/").replace(rootPath.replace(/\\/g, "/"), "").replace(/^\/+/, "");
    lines.push(`  ${i + 1}. ${relPath}  (${sizeStr})`);
  }

  if (results.length >= maxResults) {
    lines.push(`\n⚠️ 结果已限制为前 ${maxResults} 条，如需更多请缩小搜索范围或使用更精确的模式。`);
  }

  return lines.join("\n");
}

const mod: Module = {
  id: "search_file",
  name: "文件搜索",
  description:
    "在本地文件系统中搜索文件名，支持 glob 通配符模式（如 *、?）。\n\n" +
    "工作原理：递归遍历指定目录，对每个文件名进行 glob 模式匹配，返回匹配的文件路径和大小。\n" +
    "自动跳过隐藏目录（. 开头）、node_modules、.git 等系统目录。\n\n" +
    "适用于：\n" +
    "- 在任意目录（如游戏库、下载目录、文档文件夹）中快速定位文件\n" +
    "- 使用通配符模糊搜索，如 \"*Sanoba*\"、\"Report*.pdf\"、\"IMG_2024*\"\n" +
    "- 查找特定类型的文件，如 \"*.rar\"、\"*.zip\"\n\n" +
    "⚠️ 注意：仅匹配文件名，不搜索文件内容。搜索大目录（如整块磁盘）时建议限制 maxDepth。",
  userDescription: "在本地文件系统中搜索文件名，支持 glob 通配符模式",
  level: "normal",
  parameters: [
    {
      name: "pattern",
      type: "string",
      required: true,
      description:
        "文件通配符模式。例如：\"*Sanoba*\" 匹配所有名字含 Sanoba 的文件，" +
        "\"*.pdf\" 匹配所有 PDF 文件，" +
        "\"Report_2024_*\" 匹配以 Report_2024_ 开头的文件。" +
        "支持 *（任意字符）和 ?（单个字符）。",
    },
    {
      name: "path",
      type: "string",
      required: true,
      description:
        "搜索根目录的绝对路径。例如：\"G:\\\\games\" \"C:\\\\Users\\\\Downloads\" \"/home/user/docs\"。",
    },
    {
      name: "maxResults",
      type: "string",
      required: false,
      default: "50",
      description: "最大返回结果数，避免输出过长（1-200）。",
    },
    {
      name: "maxDepth",
      type: "string",
      required: false,
      default: "10",
      description: "最大递归搜索深度（1-20）。较浅的深度可加快搜索速度。",
    },
    {
      name: "caseSensitive",
      type: "string",
      required: false,
      default: "false",
      description: "是否区分大小写，设为 \"true\" 启用区分（默认不区分）。",
    },
  ],
  execute: async function* (params, _signal) {
    const pattern = params.pattern?.trim();
    if (!pattern) {
      yield "错误：search_file 需要提供 pattern 参数（通配符模式）。";
      return;
    }

    const rootPath = params.path?.trim();
    if (!rootPath) {
      yield "错误：search_file 需要提供 path 参数（搜索根目录绝对路径）。";
      return;
    }

    const maxResults = Math.min(Math.max(parseInt(params.maxResults || "50", 10) || 50, 1), 200);
    const maxDepth = Math.min(Math.max(parseInt(params.maxDepth || "10", 10) || 10, 1), 20);
    const caseSensitive = params.caseSensitive?.trim().toLowerCase() === "true";

    try {
      yield `🔍 正在搜索 "${pattern}" 在 ${rootPath} ...\n`;

      const results = await invoke<SearchFileResult[]>("search_files", {
        rootPath,
        pattern,
        maxResults,
        maxDepth,
        caseSensitive,
      });

      if (results.length === 0) {
        yield `没有找到匹配 "${pattern}" 的文件。`;
        return;
      }

      yield formatResults(pattern, rootPath, results, maxResults);
    } catch (err) {
      yield `错误：搜索失败 - ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
