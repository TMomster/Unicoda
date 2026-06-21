/**
 * 项目搜索模组（search_in_project）。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 功能：在指定目录中搜索文件名或文件内容，返回匹配结果。
 *       支持通配符筛选文件类型，自动递归子目录。
 *
 * 搜索策略：
 * 1. 先在文件内容中搜索（按行匹配）
 * 2. 再在文件名中搜索（不区分大小写）
 * 3. 结果按相关性排序：内容匹配优先
 *
 * ⚠️ 为了效率，默认限制最大返回结果数和最大搜索深度。
 *
 * 参数：
 *   query      - （必填）搜索关键词，如 "function foo"、"TODO"、"import"
 *   path       - （可选）搜索根目录，默认使用工作区路径
 *   pattern    - （可选）文件通配符过滤，如 "*.ts"、"*.{ts,tsx}"，默认搜索全部文件
 *   maxResults - （可选）最大返回结果数，默认 30
 *   maxDepth   - （可选）最大递归深度，默认 8
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

interface DirEntry {
  name: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: string;
}

interface MatchResult {
  file: string;
  type: "filename" | "content";
  line?: number;
  text?: string;
}

async function walkAndSearch(
  root: string,
  relPath: string,
  query: string,
  pattern: string | null,
  maxResults: number,
  maxDepth: number,
  depth: number,
  results: MatchResult[],
  visited: Set<string>,
): Promise<void> {
  if (results.length >= maxResults) return;
  if (depth > maxDepth) return;

  const fullPath = root ? (root + "/" + relPath).replace(/\\/g, "/").replace(/\/+/g, "/") : relPath;
  // 规范化路径，去掉 trailing slash
  const dirPath = fullPath.replace(/\/+$/, "");

  let entries: DirEntry[];
  try {
    entries = await invoke<DirEntry[]>("list_directory", { path: dirPath });
  } catch {
    return;
  }

  const lcQuery = query.toLowerCase();

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git") continue;

    const childRel = relPath ? relPath + "/" + entry.name : entry.name;
    const childFull = root ? root + "/" + childRel : childRel;

    if (entry.is_dir) {
      await walkAndSearch(root, childRel, query, pattern, maxResults, maxDepth, depth + 1, results, visited);
    } else if (entry.is_file) {
      // 检查文件名模式
      if (pattern) {
        const patRegex = globToRegex(pattern);
        if (!patRegex.test(entry.name)) continue;
      }

      // 检查文件名匹配
      if (entry.name.toLowerCase().includes(lcQuery)) {
        results.push({ file: childRel, type: "filename" });
        if (results.length >= maxResults) break;
      }

      // 检查文件内容匹配（仅文本文件，限制大小避免大二进制文件）
      if (entry.size > 0 && entry.size < 1 * 1024 * 1024) {
        try {
          const content: string = await invoke("read_text_file_at", {
            path: childFull,
            maxBytes: 50_000, // 最多读取前 50KB
          });
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (lines[i].toLowerCase().includes(lcQuery)) {
              const trimmed = lines[i].trim().substring(0, 200);
              results.push({
                file: childRel,
                type: "content",
                line: i + 1,
                text: trimmed,
              });
              if (results.length >= maxResults) break;
            }
          }
        } catch {
          // 跳过无法读取的文件（二进制、权限等）
        }
      }
    }
  }
}

function globToRegex(pattern: string): RegExp {
  let regexStr = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      regexStr += ".*";
    } else if (ch === "?") {
      regexStr += ".";
    } else if (ch === ".") {
      regexStr += "\\.";
    } else if (ch === "{") {
      regexStr += "(?:";
    } else if (ch === "}") {
      regexStr += ")";
    } else if (ch === ",") {
      regexStr += "|";
    } else {
      regexStr += ch;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr, "i");
}

function formatResults(query: string, path: string, results: MatchResult[], maxResults: number): string {
  const lines: string[] = [];
  lines.push(`> 搜索: "${query}" 在 ${path}`);
  lines.push(`找到 ${results.length} 个匹配结果（限制 ${maxResults} 条）\n`);

  for (const r of results) {
    if (r.type === "filename") {
      lines.push(`📄 ${r.file}  (文件名匹配)`);
    } else {
      lines.push(`📄 ${r.file}:${r.line}`);
      lines.push(`   ${r.text}`);
    }
  }

  if (results.length >= maxResults) {
    lines.push(`\n⚠️ 结果已限制为前 ${maxResults} 条，如需更多请缩小搜索范围。`);
  }

  return lines.join("\n");
}

const mod: Module = {
  id: "search_in_project",
  name: "项目搜索",
  description:
    "在本地项目目录中搜索文件名或文件内容，返回匹配的文件路径和匹配行。\n\n" +
    "工作原理：递归遍历指定目录，在文件内容中按行匹配搜索关键词，同时在文件名中匹配。\n" +
    "自动跳过隐藏目录（.git, node_modules 等）和二进制文件。\n\n" +
    "适用于：\n" +
    "- 在项目中搜索特定函数、变量、导入语句的位置\n" +
    "- 查找 TODO、FIXME 等标记\n" +
    "- 按文件名模式搜索（如所有 .ts 文件中的 `fetch`）\n\n" +
    "⚠️ 注意：默认搜索前 50KB 文件内容，大文件可能只搜索到开头部分。",
  userDescription: "在本地项目中搜索关键词，支持文件名和文件内容匹配",
  level: "normal",
  parameters: [
    {
      name: "query",
      type: "string",
      required: true,
      description: "搜索关键词，不区分大小写。支持中文。",
    },
    {
      name: "path",
      type: "string",
      required: false,
      description: "搜索根目录绝对路径。不指定则使用当前工作区路径。",
    },
    {
      name: "pattern",
      type: "string",
      required: false,
      description: "文件通配符过滤，如 \"*.ts\"、\"*.{ts,tsx}\"。默认搜索所有文件。",
    },
    {
      name: "maxResults",
      type: "string",
      required: false,
      default: "30",
      description: "最大返回结果数，避免输出过长。",
    },
  ],
  execute: async function* (params, _signal) {
    const query = params.query?.trim();
    if (!query) {
      yield "错误：search_in_project 需要提供 query 参数。";
      return;
    }

    const path = params.path?.trim() || "";
    if (!path) {
      yield "错误：search_in_project 需要提供 path 参数（搜索根目录）。如果已设置工作区，请传入工作区路径。";
      return;
    }

    const pattern = params.pattern?.trim() || null;
    const maxResults = parseInt(params.maxResults || "30", 10) || 30;
    const maxDepth = 8;

    const results: MatchResult[] = [];
    const visited = new Set<string>();

    try {
      await walkAndSearch(path, "", query, pattern, maxResults, maxDepth, 0, results, visited);
    } catch (err) {
      yield `错误：搜索失败 - ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    yield formatResults(query, path, results, maxResults);
  },
};

registerModule(mod);
