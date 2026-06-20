/**
 * 代码沙箱模组（run_code_sandbox）。
 *
 * 等级：sensitive（敏感模组，仅 Agent 模式可调用）
 *
 * 功能：在隔离的临时目录中运行代码片段，支持超时控制。
 *       支持语言：python / javascript / typescript / shell / go / rust。
 *
 * 安全机制：
 * - 每次执行创建唯一临时目录，执行后自动清理
 * - 超时保护（默认 10 秒，Rust 编译默认 30 秒）
 * - 子进程 kill_on_drop 确保超时时进程树被清理
 * - 工作目录限制在临时目录内
 *
 * ⚠️ 注意：本沙箱是"轻量隔离"——通过临时目录 + 进程管理实现，并非完整
 *    操作系统级沙箱。不建议运行不受信任的第三方代码。对个人开发环境中的
 *    自己写的代码片段而言，安全级别已足够。
 *
 * 参数：
 *   code      - （必填）要执行的代码内容
 *   language  - （必填）编程语言：python / javascript / typescript / shell / go / rust
 *   timeoutMs - （可选）超时毫秒数（默认 10000）
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

function formatResult(r: CmdResult, language: string): string {
  const lines: string[] = [];
  lines.push(`[语言: ${language}]\n`);
  if (r.stdout) lines.push(`[标准输出]\n${r.stdout}`);
  if (r.stderr) lines.push(`[标准错误]\n${r.stderr}`);
  if (r.timed_out) lines.push("\n⚠️ 执行超时，进程已终止");
  lines.push(`\n[退出码: ${r.exit_code}]`);
  return lines.join("\n");
}

const mod: Module = {
  id: "run_code_sandbox",
  name: "代码沙箱",
  description:
    "在隔离的临时目录中运行代码片段，支持超时保护，执行后自动清理。\n\n" +
    "工作原理：在后端创建一个唯一临时目录，将代码写入临时文件，启动对应语言的" +
    "解释器/编译器执行，通过管道捕获输出，执行完成后清理临时目录。\n\n" +
    "支持的语言：\n" +
    "- python / py — 使用 python 解释器（需系统已安装）\n" +
    "- javascript / js — 使用 node 解释器\n" +
    "- typescript / ts — 使用 npx tsx（需 node + tsx 已安装）\n" +
    "- shell / sh / bash — 使用系统 shell（Windows 用 cmd，其他用 sh）\n" +
    "- go — 使用 go run（需 go 已安装）\n" +
    "- rust — 创建完整 cargo 项目编译运行（需 rustc + cargo 已安装，超时默认 30 秒）\n\n" +
    "⚠️ 此模组具有代码执行能力，请确认用户意图后再使用。" +
    "本沙箱为轻量隔离，不建议运行不受信任的第三方代码。",
  level: "sensitive",
  parameters: [
    {
      name: "code",
      type: "string",
      required: true,
      description: "要执行的代码文本内容。",
    },
    {
      name: "language",
      type: "string",
      required: true,
      description:
        "编程语言标识。支持：python, javascript, typescript, shell, go, rust。",
    },
    {
      name: "timeoutMs",
      type: "string",
      required: false,
      default: "10000",
      description:
        "执行超时毫秒数（默认 10000，即 10 秒）。Rust 编译任务建议设为 30000 以上。",
    },
  ],
  execute: async function* (params, _signal) {
    const code = params.code;
    const language = params.language;

    if (!code) {
      yield "错误：run_code_sandbox 需要提供 code 参数。";
      return;
    }
    if (!language) {
      yield "错误：run_code_sandbox 需要提供 language 参数。";
      return;
    }

    const supported = ["python", "py", "javascript", "js", "typescript", "ts", "shell", "sh", "bash", "go", "rust"];
    const normalized = language.toLowerCase();
    if (!supported.includes(normalized)) {
      yield `错误：不支持的 language "${language}"。支持：${supported.join(", ")}`;
      return;
    }

    try {
      const result = await invoke<CmdResult>("run_code_sandbox", {
        code,
        language: normalized,
        timeoutMs: params.timeoutMs ? parseInt(params.timeoutMs, 10) : null,
      });

      yield formatResult(result, normalized);
    } catch (err) {
      yield `错误：沙箱执行失败 - ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
