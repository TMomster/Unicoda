/**
 * 代码检查模组（lint_code）。
 *
 * 等级：normal（所有模式可用）
 *
 * 功能：对指定文件或代码片段执行 lint 检查，报告语法/风格/类型问题。
 * 支持多种语言，自动检测文件类型并选择对应的 lint 工具。
 *
 * 参数：
 *   path     - （可选）要检查的文件路径，从文件扩展名自动推断语言
 *   code     - （可选）要检查的代码内容（与 path 二选一，使用 code 时需提供 language）
 *   language - （可选，配合 code 使用）代码语言标识
 *              js/ts/jsx/tsx/css/html/json/md/python/rust
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

// ── 语言推断 ─────────────────────────────────────────

interface CmdResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

const EXT_MAP: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html",
  json: "json", jsonc: "json",
  md: "markdown", mdx: "markdown",
  py: "python", pyw: "python",
  rs: "rust",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql",
  go: "go",
  java: "java", kt: "kotlin",
};

function detectLanguage(path?: string, lang?: string): string {
  if (lang) return lang.toLowerCase();
  if (!path) return "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? ext;
}

// ── JSON 内置校验 ────────────────────────────────────

function lintJson(code: string): string {
  try {
    JSON.parse(code);
    return "✅ JSON 语法正确，无错误。";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 提取行号（JSON.parse 错误格式：Unexpected token ... at position X (line Y column Z)）
    const lineMatch = msg.match(/line\s+(\d+)/i);
    const colMatch = msg.match(/column\s+(\d+)/i);
    const posMatch = msg.match(/position\s+(\d+)/i);
    const info = [];
    if (lineMatch) info.push(`第 ${lineMatch[1]} 行`);
    if (colMatch) info.push(`第 ${colMatch[1]} 列`);
    if (posMatch) info.push(`位置 ${posMatch[1]}`);
    const loc = info.length > 0 ? `（${info.join("，")}）` : "";
    return `❌ JSON 语法错误${loc}：\n${msg}`;
  }
}

// ── 执行命令 ───────────────────────────────────────

async function runCmd(
  command: string,
  timeoutMs: number = 30000,
): Promise<{ success: boolean; output: string }> {
  try {
    const result = await invoke<CmdResult>("execute_command", {
      command,
      workingDir: null,
      timeoutMs,
    });
    const lines: string[] = [];
    if (result.stdout) lines.push(result.stdout.trimEnd());
    if (result.stderr) lines.push(result.stderr.trimEnd());
    const output = lines.join("\n");
    if (result.exit_code === 0) {
      return { success: true, output: output || "✅ 检查通过，未发现问题。" };
    }
    return { success: false, output: output || `⚠️ 检查完成，退出码: ${result.exit_code}` };
  } catch (err) {
    return {
      success: false,
      output: `❌ 执行失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── PowerShell 路径安全转义 ───────────────────────
// PowerShell 双引号字符串中，" 需要写作 "" 转义
function escapePSPath(p: string): string {
  // PowerShell 双引号字符串中，" 需要写作 "" 转义，$ 需要写作 `$ 转义，反引号需要写作 `` 转义
  return p.replace(/`/g, "``").replace(/\$/g, "`$").replace(/"/g, '""');
}

// ── 各语言的 lint 命令构建 ─────────────────────────

function buildLintCommand(language: string, path: string, code: string): string {
  // json 不走命令
  if (language === "json") return "";

  const safePath = escapePSPath(path);

  switch (language) {
    case "javascript":
    case "jsx":
      // 优先检查本地 eslint，否则用 npx
      return `if (Get-Command eslint -ErrorAction SilentlyContinue) { eslint "${safePath}" } else { npx --yes eslint "${safePath}" }`;
    case "typescript":
    case "tsx":
      return `if (Get-Command eslint -ErrorAction SilentlyContinue) { eslint --ext .ts,.tsx "${safePath}" } else { npx --yes eslint --ext .ts,.tsx "${safePath}" }`;
    case "css":
    case "scss":
    case "less":
      return `if (Get-Command stylelint -ErrorAction SilentlyContinue) { stylelint "${safePath}" } else { npx --yes stylelint "${safePath}" }`;
    case "html":
      return `if (Get-Command htmlhint -ErrorAction SilentlyContinue) { htmlhint "${safePath}" } else { npx --yes htmlhint "${safePath}" }`;
    case "markdown":
      return `if (Get-Command markdownlint -ErrorAction SilentlyContinue) { markdownlint "${safePath}" } else { npx --yes markdownlint-cli "${safePath}" }`;
    case "python":
      return `python -m flake8 "${safePath}" 2> $null; if ($LASTEXITCODE -ne 0) { python -m pylint "${safePath}" 2> $null }`;
    case "rust":
      return `cargo clippy --all-targets 2>&1`;
    case "yaml":
      return `if (Get-Command yamllint -ErrorAction SilentlyContinue) { yamllint "${safePath}" } else { python -m yamllint "${safePath}" 2> $null }`;
    default:
      return "";
  }
}

function buildInlineTempCmd(language: string, code: string): string {
  // 对无法直接执行的格式采用临时文件
  const tempDir = "$env:TEMP";
  const ext = Object.entries(EXT_MAP).find(([, v]) => v === language)?.[0] ?? "txt";
  const tempFile = `${tempDir}/unicoda_lint_temp.${ext}`;
  // 将代码写入临时文件，执行 lint，然后删除
  const encoded = code.replace(/'/g, "''").replace(/\r?\n/g, "`n");
  const writeCmd = `Set-Content -Path '${tempFile}' -Value '${encoded}' -Encoding UTF8`;
  const lintCmd = buildLintCommand(language, tempFile, code);
  const cleanupCmd = `Remove-Item -Path '${tempFile}' -Force -ErrorAction SilentlyContinue`;
  return `${writeCmd}; ${lintCmd}; ${cleanupCmd}`;
}

// ── 格式化输出 ─────────────────────────────────────

function formatOutput(language: string, result: { success: boolean; output: string }, path?: string): string {
  const langName = language.charAt(0).toUpperCase() + language.slice(1);
  const header = path ? `📋 ${langName} 代码检查报告\n━━━━━━━━━━━━━━━━━━━━━━\n文件：${path}\n` : `📋 ${langName} 代码检查报告\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  return `${header}\n${result.output}`;
}

// ── 模块定义 ───────────────────────────────────────

const mod: Module = {
  id: "lint_code",
  name: "代码检查",
  description:
    "对代码文件或代码片段执行 lint 检查，报告语法错误、风格问题和潜在缺陷。\n\n" +
    "支持的格式（通过文件扩展名或 language 参数指定）：\n" +
    "- JavaScript/JSX (.js/.jsx/.mjs) — eslint\n" +
    "- TypeScript/TSX (.ts/.tsx) — eslint\n" +
    "- CSS/SCSS/Less (.css/.scss/.less) — stylelint\n" +
    "- HTML (.html/.htm) — htmlhint\n" +
    "- JSON (.json) — 内置语法校验（无需额外工具）\n" +
    "- Markdown (.md) — markdownlint\n" +
    "- Python (.py) — flake8 / pylint\n" +
    "- Rust (.rs) — cargo clippy\n" +
    "- YAML (.yaml/.yml) — yamllint\n\n" +
    "使用方法：\n" +
    "1. 传入 path 参数检查文件（推荐）\n" +
    "2. 传入 code + language 检查代码片段\n" +
    "提示用户：lint 工具（eslint 等）需要提前安装或通过 npx 自动下载。",
  userDescription: "检查代码语法、风格和潜在问题",
  level: "normal",
  parameters: [
    {
      name: "path",
      type: "string",
      required: false,
      description:
        "要检查的文件绝对路径，如 C:\\Users\\Name\\src\\index.ts。从文件扩展名自动推断语言。",
    },
    {
      name: "code",
      type: "string",
      required: false,
      description:
        "要检查的代码内容。与 path 二选一，使用 code 时必须同时指定 language。",
    },
    {
      name: "language",
      type: "string",
      required: false,
      description:
        "代码语言标识。可选值：javascript / typescript / css / html / json / markdown / python / rust / yaml。与 code 配合使用，或补充 path 的自动推断。",
    },
  ],
  execute: async function* (params, _signal) {
    const path = params.path?.trim();
    let code = params.code?.trim();
    const language = detectLanguage(path, params.language);

    // 校验参数
    if (!path && !code) {
      yield "参数不足：请提供 path（文件路径）或 code + language（代码内容 + 语言）。";
      return;
    }

    // 从文件读取代码（如果给了 path 没给 code）
    if (path && !code) {
      try {
        code = await invoke<string>("read_text_file_at", {
          path,
          maxBytes: null as unknown as number | null,
        });
      } catch (err) {
        yield `❌ 读取文件失败：${err instanceof Error ? err.message : String(err)}`;
        return;
      }
    }

    if (!code) {
      yield "❌ 无法获取要检查的代码内容。";
      return;
    }

    // 语言检测失败但给了 path
    if (!language && path) {
      yield `⚠️ 无法从文件路径推断语言（${path}），请通过 language 参数指定。支持：javascript, typescript, css, html, json, markdown, python, rust, yaml`;
      return;
    }

    // JSON 内置校验
    if (language === "json") {
      const result = lintJson(code);
      yield formatOutput(language, { success: !result.startsWith("❌"), output: result }, path);
      return;
    }

    // 构建命令
    let command: string;
    if (path) {
      command = buildLintCommand(language, path, code);
    } else {
      command = buildInlineTempCmd(language, code);
    }

    if (!command) {
      yield `⚠️ 暂不支持 ${language} 语言的 lint 检查。支持：javascript, typescript, css, html, json, markdown, python, rust, yaml`;
      return;
    }

    // 检查是否需要先安装工具
    yield `🔍 正在检查 ${language} 代码...\n`;

    const result = await runCmd(command, 60000);
    yield formatOutput(language, result, path);
  },
};

registerModule(mod);
