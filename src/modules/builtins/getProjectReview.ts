/**
 * 项目分析模组（get_project_review）。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 功能：分析指定项目的目录结构、文件类型分布、关键配置文件内容，
 *       生成项目结构概览，帮助快速了解项目。
 *
 * 输出包含：
 * - 项目概况：总文件数、总目录数、文件类型分布
 * - 目录结构：树状目录结构（默认深度 3 层）
 * - 关键配置文件内容：package.json、Cargo.toml、README.md 等
 *
 * 参数：
 *   path     - （必填）项目根目录绝对路径
 *   maxDepth - （可选）目录树展示深度，默认 3
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

interface FileTypeCount {
  ext: string;
  count: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".svn", ".idea", ".vscode", "__pycache__", ".next", "dist", "build", "target", ".cache", ".codebuddy", ".husky", "coverage"]);

const CONFIG_FILES = [
  "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt",
  "tsconfig.json", "vite.config.ts", "vite.config.js", "next.config.js",
  "webpack.config.js", ".env.example", "composer.json", "go.mod",
  "Makefile", "CMakeLists.txt", "README.md", "README.txt",
  "LICENSE", "docker-compose.yml", "Dockerfile",
];

async function walkDir(
  root: string,
  relPath: string,
  maxDepth: number,
  depth: number,
  fileCount: { total: number },
  dirCount: { total: number },
  typeMap: Map<string, number>,
  treeLines: string[],
): Promise<void> {
  if (depth > maxDepth) return;

  const fullPath = root + (relPath ? "/" + relPath : "");
  let entries: DirEntry[];
  try {
    entries = await invoke<DirEntry[]>("list_directory", { path: fullPath });
  } catch {
    return;
  }

  // 排序：目录优先，然后按名字
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const indent = "  ".repeat(depth);
  for (const entry of entries) {
    if (entry.name.startsWith(".") && depth === 0) continue;
    if (entry.is_dir && SKIP_DIRS.has(entry.name)) continue;

    const childRel = relPath ? relPath + "/" + entry.name : entry.name;

    if (entry.is_dir) {
      dirCount.total++;
      if (depth < maxDepth) {
        treeLines.push(`${indent}📁 ${entry.name}/`);
      }
      await walkDir(root, childRel, maxDepth, depth + 1, fileCount, dirCount, typeMap, treeLines);
    } else if (entry.is_file) {
      fileCount.total++;
      const ext = entry.name.includes(".")
        ? entry.name.substring(entry.name.lastIndexOf("."))
        : "(无扩展名)";
      typeMap.set(ext, (typeMap.get(ext) || 0) + 1);

      if (depth < maxDepth) {
        treeLines.push(`${indent}📄 ${entry.name}`);
      }
    }
  }
}

async function readConfig(root: string, filename: string): Promise<string | null> {
  const fullPath = root + "/" + filename;
  try {
    return await invoke<string>("read_text_file_at", {
      path: fullPath,
      maxBytes: 10_000,
    });
  } catch {
    return null;
  }
}

function formatFileTypes(typeMap: Map<string, number>): string {
  const sorted = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  for (const [ext, count] of sorted) {
    const pct = ((count / total) * 100).toFixed(1);
    lines.push(`- ${ext || "(无扩展名)"}: ${count} 个文件 (${pct}%)`);
  }
  return lines.join("\n");
}

const mod: Module = {
  id: "get_project_review",
  name: "项目分析",
  description:
    "分析指定项目的目录结构、文件类型分布、关键配置文件内容，生成项目结构概览。\n\n" +
    "工作原理：递归遍历项目目录，统计文件类型分布，读取常见配置文件内容，\n" +
    "生成目录树结构。自动跳过隐藏目录和常见构建目录。\n\n" +
    "适用于：\n" +
    "- 快速了解一个项目的整体结构和技术栈\n" +
    "- 开发前查看项目架构\n" +
    "- 分析不熟悉的代码库",
  userDescription: "分析本地项目的目录结构、文件类型分布和技术栈",
  level: "normal",
  parameters: [
    {
      name: "path",
      type: "string",
      required: true,
      description: "要分析的项目根目录绝对路径。",
    },
    {
      name: "maxDepth",
      type: "string",
      required: false,
      default: "3",
      description: "目录树展示深度（默认 3 层）。设为 0 不展示树结构。",
    },
  ],
  execute: async function* (params, _signal) {
    const path = params.path?.trim();
    if (!path) {
      yield "错误：get_project_review 需要提供 path 参数。";
      return;
    }

    const maxDepth = Math.min(8, Math.max(0, parseInt(params.maxDepth || "3", 10) || 3));
    const fileCount = { total: 0 };
    const dirCount = { total: 0 };
    const typeMap = new Map<string, number>();
    const treeLines: string[] = [];

    try {
      await walkDir(path, "", maxDepth, 0, fileCount, dirCount, typeMap, treeLines);
    } catch (err) {
      yield `错误：分析失败 - ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    const lines: string[] = [];
    lines.push(`> 项目分析: ${path}\n`);

    // 项目概况
    lines.push("## 项目概况");
    lines.push(`- 目录数: ${dirCount.total}`);
    lines.push(`- 文件数: ${fileCount.total}`);
    lines.push("");

    // 文件类型分布
    lines.push("## 文件类型分布");
    lines.push(formatFileTypes(typeMap));
    lines.push("");

    // 目录结构
    if (maxDepth > 0 && treeLines.length > 0) {
      lines.push("## 目录结构");
      lines.push(`\`\`\`\n${path}/\n${treeLines.join("\n")}\n\`\`\``);
      lines.push("");
    }

    // 关键配置文件
    const configContents: string[] = [];
    for (const cfg of CONFIG_FILES) {
      const content = await readConfig(path, cfg);
      if (content !== null) {
        configContents.push(`### ${cfg}\n\`\`\`\n${content.substring(0, 2000)}${content.length > 2000 ? "\n... [内容过长，已截断]" : ""}\n\`\`\``);
      }
    }
    if (configContents.length > 0) {
      lines.push("## 关键配置文件");
      lines.push(...configContents);
    }

    yield lines.join("\n");
  },
};

registerModule(mod);
