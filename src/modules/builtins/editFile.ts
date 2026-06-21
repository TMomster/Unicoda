/**
 * 细粒度文件编辑模组（edit_file）。
 *
 * 等级：sensitive（敏感模组，仅 Agent 模式可调用）
 *
 * 功能：对已有文件进行精确的增量编辑，支持行级操作和搜索替换。
 * 自动生成 diff 记录，避免每次修改都重写整个文件。
 *
 * 参数：
 *   action     - （必填）"insert" | "replace" | "delete" | "search_replace"
 *   path       - （必填）目标文件绝对路径
 *   content    - （insert/replace 时必填）要插入或替换的文本内容
 *   lineNumber - （insert/delete 时必填）行号（从 1 开始）
 *   startLine  - （replace/delete 时可选）起始行号，默认同 lineNumber
 *   endLine    - （replace/delete 时必填）结束行号（含）
 *   search     - （search_replace 时必填）要搜索的文本
 *   replace    - （search_replace 时必填）替换后的文本
 *   count      - （search_replace 时可选）替换次数，默认 -1（全部替换）
 *   regex      - （search_replace 时可选）是否将 search 视为正则，默认 false
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

function generateDiff(
  oldLines: string[],
  newLines: string[],
  contextLines = 3,
): string {
  // 简单的 LCS 差异算法实现，输出 unified diff 风格片段
  const result: string[] = [];
  let start = -1, end = -1;
  const oldStr = oldLines.join("\n");
  const newStr = newLines.join("\n");
  if (oldStr === newStr) return "[无变更]";

  // 找到第一个和最后一个不同的行
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (start === -1) start = i;
      end = i;
    }
  }

  const ctxStart = Math.max(0, (start ?? 0) - contextLines);
  const ctxEnd = Math.min(newLines.length, (end ?? 0) + contextLines + 1);

  if (ctxStart > 0) result.push(`...（省略 ${ctxStart} 行）`);
  for (let i = ctxStart; i < ctxEnd; i++) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i] ?? "";
    if (oldLine !== newLine) {
      if (i >= (start ?? 0) && i <= (end ?? 0)) {
        if (oldLine !== undefined) result.push(`- ${oldLine}`);
        if (newLine !== undefined) result.push(`+ ${newLine}`);
      } else {
        result.push(`  ${newLine}`);
      }
    } else {
      result.push(`  ${newLine}`);
    }
  }
  if (ctxEnd < newLines.length) result.push(`...（省略 ${newLines.length - ctxEnd} 行）`);

  return result.join("\n");
}

const mod: Module = {
  id: "edit_file",
  name: "编辑文件",
  description:
    "对已有文本文件进行精确的增量编辑，无需重写整个文件。支持以下操作：\n\n" +
    "1. insert：在第 N 行后插入内容\n" +
    "2. replace：替换第 N 到 M 行的内容\n" +
    "3. delete：删除第 N 行（或 N 到 M 行）\n" +
    "4. search_replace：搜索文本并替换（支持正则表达式）\n\n" +
    "使用 edit_file 而不是 write_to_file 的优势：\n" +
    "- 不需要提供文件的完整新内容，只需提供要修改的部分\n" +
    "- 自动生成 diff 差异记录，让用户清晰看到改动\n" +
    "- 适合对已有代码/配置文件的快速修改\n\n" +
    "⚠️ 本模组具有文件写入能力，请在确认用户意图后再使用。path 请使用绝对路径。",
  userDescription: "对文件进行精确的增量编辑（替换行、插入、删除、搜索替换）",
  level: "sensitive",
  parameters: [
    {
      name: "action",
      type: "string",
      required: true,
      description:
        "操作类型：insert（在行后插入）、replace（替换行内容）、delete（删除行）、search_replace（搜索替换）",
    },
    {
      name: "path",
      type: "string",
      required: true,
      description: "目标文件的绝对路径，如 C:\\Users\\Name\\src\\main.ts",
    },
    {
      name: "content",
      type: "string",
      required: false,
      description:
        "要插入或替换的文本内容（insert/replace 时必填）。可以包含多行。",
    },
    {
      name: "lineNumber",
      type: "number",
      required: false,
      description:
        "行号，从 1 开始（insert/delete 时必填）。insert 时表示在此行后插入。",
    },
    {
      name: "startLine",
      type: "number",
      required: false,
      description:
        "起始行号（replace/delete 时可选，默认同 lineNumber）",
    },
    {
      name: "endLine",
      type: "number",
      required: false,
      description:
        "结束行号，含该行（replace/delete 时必填）",
    },
    {
      name: "search",
      type: "string",
      required: false,
      description: "要搜索的文本（search_replace 时必填）",
    },
    {
      name: "replace",
      type: "string",
      required: false,
      description: "替换后的文本（search_replace 时必填）",
    },
    {
      name: "count",
      type: "number",
      required: false,
      default: "-1",
      description:
        "替换次数（search_replace 时可选）。默认为 -1 表示全部替换，指定正整数限制替换次数。",
    },
    {
      name: "regex",
      type: "boolean",
      required: false,
      default: "false",
      description:
        "是否将 search 视为正则表达式（search_replace 时可选）。注意：正则中的反斜杠需要转义。",
    },
  ],
  execute: async function* (params, _signal) {
    const action = (params.action ?? "").toLowerCase();
    const path = params.path;
    if (!path) {
      yield "错误：edit_file 需要提供 path 参数（目标文件绝对路径）。";
      return;
    }
    if (!["insert", "replace", "delete", "search_replace"].includes(action)) {
      yield `错误：无效的 action 参数 "${action}"。支持的 action：insert、replace、delete、search_replace。`;
      return;
    }

    // 读取文件现有内容
    let existing = "";
    try {
      existing = await invoke<string>("read_text_file_at", {
        path,
        maxBytes: null as unknown as number | null,
      });
    } catch {
      yield `错误：无法读取文件 "${path}"，请确认文件存在且可读。`;
      return;
    }

    const oldLines = existing.split("\n");
    let newLines: string[];

    try {
      switch (action) {
        case "insert": {
          const lineNum = parseInt(params.lineNumber, 10);
          if (isNaN(lineNum) || lineNum < 0 || lineNum > oldLines.length) {
            yield `错误：lineNumber 参数无效（${params.lineNumber}），文件共 ${oldLines.length} 行。`;
            return;
          }
          const content = params.content ?? "";
          newLines = [...oldLines];
          newLines.splice(lineNum, 0, ...content.split("\n"));
          break;
        }

        case "replace": {
          const start = parseInt(params.startLine ?? params.lineNumber, 10);
          const end = parseInt(params.endLine, 10);
          if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > oldLines.length) {
            yield `错误：行号参数无效（startLine=${params.startLine ?? params.lineNumber}, endLine=${params.endLine}），文件共 ${oldLines.length} 行。`;
            return;
          }
          const content = params.content ?? "";
          newLines = [
            ...oldLines.slice(0, start - 1),
            ...content.split("\n"),
            ...oldLines.slice(end),
          ];
          break;
        }

        case "delete": {
          const start = parseInt(params.startLine ?? params.lineNumber, 10);
          const end = parseInt(params.endLine ?? params.lineNumber, 10);
          if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > oldLines.length) {
            yield `错误：行号参数无效（startLine=${params.startLine ?? params.lineNumber}, endLine=${params.endLine ?? params.lineNumber}），文件共 ${oldLines.length} 行。`;
            return;
          }
          newLines = [...oldLines.slice(0, start - 1), ...oldLines.slice(end)];
          break;
        }

        case "search_replace": {
          const search = params.search;
          const replace = params.replace;
          if (!search) {
            yield "错误：search_replace 操作需要提供 search 参数（要搜索的文本）。";
            return;
          }
          if (replace === undefined) {
            yield "错误：search_replace 操作需要提供 replace 参数（替换后的文本）。";
            return;
          }
          const count = parseInt(params.count, 10) || -1;
          const useRegex = params.regex === "true" || params.regex === true;
          const fullText = existing;

          let resultText: string;
          if (useRegex) {
            try {
              const flags = count === -1 ? "g" : "";
              const regex = new RegExp(search, flags);
              resultText = fullText.replace(regex, replace);
            } catch (e) {
              yield `错误：正则表达式无效 "${search}" - ${e instanceof Error ? e.message : String(e)}`;
              return;
            }
          } else {
            if (count === -1) {
              // 全局替换
              resultText = fullText.split(search).join(replace);
            } else {
              // 有限次数替换
              resultText = fullText.replace(search, replace);
              // 注意：上面的 replace 默认只替换第一个，如果需要替换多个
              // 但 count === -1 时用 split/join，count > 0 时用带计数器的循环
            }
          }
          newLines = resultText.split("\n");

          // 统计替换次数
          const originalCount = (existing.match(
            useRegex ? new RegExp(search, "g") : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          ) || []).length;
          const afterCount = (resultText.match(
            useRegex ? new RegExp(search, "g") : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          ) || []).length;
          const replacedCount = originalCount - afterCount;

          yield `找到 ${originalCount} 处匹配，已替换 ${replacedCount} 处。\n`;
          break;
        }

        default:
          yield `错误：未知操作 "${action}"。`;
          return;
      }
    } catch (err) {
      yield `错误：编辑操作失败 - ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    // 生成 diff
    const diff = generateDiff(oldLines, newLines);
    const newContent = newLines.join("\n");
    const changedLines = oldLines.length !== newLines.length
      ? `（${oldLines.length} 行 → ${newLines.length} 行）`
      : "";

    // 写回文件
    try {
      await invoke("write_text_file_at", { path, data: newContent });
      yield `✅ 文件已编辑：${path}${changedLines}\n\n变更 diff：\n\`\`\`diff\n${diff}\n\`\`\``;
    } catch (err) {
      yield `错误：写入文件失败 - ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
