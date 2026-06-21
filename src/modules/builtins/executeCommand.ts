/**
 * 命令执行模组（execute_command）。
 *
 * 等级：sensitive（敏感模组，仅 Agent 模式可调用）
 *
 * 功能：在用户本地 Shell 中执行任意命令（npm install, cargo build, python script.py 等），
 *       返回 stdout / stderr / 退出码。支持超时控制和工作目录指定。
 *
 * ⚠️ 此模组具有代码执行能力，需确认用户意图后再使用。
 *
 * 参数：
 *   command     - （必填）要执行的命令字符串，如 "npm install"、"python script.py"
 *   workingDir  - （可选）工作目录绝对路径，默认为项目根目录
 *   timeoutMs   - （可选）超时毫秒数，默认 30000（30 秒）
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

interface CmdResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

function formatResult(command: string, r: CmdResult): string {
  const lines: string[] = [];
  lines.push(`> ${command}`);
  lines.push(`[退出码: ${r.exit_code}]${r.timed_out ? " ⚠️ 执行超时" : ""}`);
  if (r.stdout) lines.push(`\n[标准输出]\n${r.stdout}`);
  if (r.stderr) lines.push(`\n[标准错误]\n${r.stderr}`);
  return lines.join("\n");
}

const mod: Module = {
  id: "execute_command",
  name: "执行命令",
  description:
    "在用户本地 Shell 中执行命令行指令，返回标准输出、标准错误和退出码。\n\n" +
    "工作原理：Unicoda 在后端启动一个子进程执行命令，通过管道捕获 stdout/stderr。" +
    "支持超时保护（默认 30 秒），超时后进程自动终止。\n\n" +
    "Windows 平台使用 PowerShell 执行命令（自动配置 UTF-8 编码以确保中文输出正确），" +
    "非 Windows 平台使用 sh。\n\n" +
    "可执行的操作包括但不限于：\n" +
    "- 包管理：npm install / pip install / cargo add\n" +
    "- 构建：npm run build / cargo build / make\n" +
    "- 运行脚本：python script.py / node app.js\n" +
    "- 文件操作：dir / ls / mkdir / copy / Remove-Item\n" +
    "- Git 操作：git status / git log\n\n" +
    "⚠️ 此模组具有代码执行能力，请确认用户意图后再使用。" +
    "⚠️ Windows 下使用 PowerShell，请使用 PowerShell 语法（如 Remove-Item 而非 del/rd）。",
  userDescription: "在本地系统中执行命令行指令（敏感操作）",
  level: "sensitive",
  parameters: [
    {
      name: "command",
      type: "string",
      required: true,
      description: "要执行的命令字符串。Windows 下使用 PowerShell 执行（自动 UTF-8 编码），请使用 PowerShell 语法。",
    },
    {
      name: "workingDir",
      type: "string",
      required: false,
      description: "工作目录的绝对路径。不指定则使用 Unicoda 进程当前工作目录。",
    },
    {
      name: "timeoutMs",
      type: "string",
      required: false,
      default: "30000",
      description: "执行超时毫秒数。超过此时间进程将被强制终止。",
    },
  ],
  execute: async function* (params, _signal) {
    const command = params.command;
    if (!command) {
      yield "错误：execute_command 需要提供 command 参数。";
      return;
    }

    try {
      const result = await invoke<CmdResult>("execute_command", {
        command,
        workingDir: params.workingDir || null,
        timeoutMs: params.timeoutMs ? parseInt(params.timeoutMs, 10) : null,
      });

      yield formatResult(command, result);
    } catch (err) {
      yield `错误：命令执行失败 - ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
