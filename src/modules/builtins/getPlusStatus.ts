/**
 * 获取 Unicoda Plus 服务状态模组。
 *
 * 等级：normal（所有模式可用）
 * 无参数。
 *
 * 作用：让模型了解 Unicoda Plus 服务的当前运行状态、已连接的外部应用信息，
 * 实现"按需查询"而非预装填动态数据。
 */
import { invoke } from "@tauri-apps/api/core";
import type { Module } from "../types";
import { registerModule } from "../registry";

interface PlusClientInfo {
  app_name: string;
  app_version: string;
  app_description: string;
  capabilities_count: number;
  connected_at: number;
  remote_addr: string;
}

interface PlusStatus {
  running: boolean;
  port: number | null;
  clients: PlusClientInfo[];
  enabled: boolean;
}

const mod: Module = {
  id: "get_plus_status",
  name: "获取 Unicoda Plus 服务状态",
  description:
    "获取当前 Unicoda Plus 服务的运行状态。" +
    "返回信息包括：服务是否启用、是否正在运行、监听端口、已连接的外部应用列表（每个应用的名称、版本、远程地址、注册能力数量）。" +
    "当用户询问外部应用（如「Pompeii 连上了吗」「有看到外部应用吗」）时使用此模组。" +
    "调用后返回详细的状态描述，你可以直接引用或转述给用户。",
  userDescription: "获取 Unicoda Plus 服务的运行状态和外部应用连接信息",
  level: "normal",
  parameters: [],
  execute: async function* (_params, _signal) {
    try {
      const status = await invoke<PlusStatus>("plus_get_status");
      if (!status.enabled) {
        yield "Unicoda Plus 服务当前已禁用。";
        return;
      }
      if (!status.running) {
        yield "Unicoda Plus 服务已启用但尚未运行。";
        return;
      }
      const lines: string[] = [];
      lines.push(`Unicoda Plus 服务正在运行，监听端口：${status.port}`);
      if (status.clients.length === 0) {
        lines.push("当前没有外部应用连接。");
      } else {
        lines.push(`已连接 ${status.clients.length} 个外部应用：`);
        for (const c of status.clients) {
          lines.push(
            `- **${c.app_name}** v${c.app_version}（${c.remote_addr}），注册了 ${c.capabilities_count} 个能力`,
          );
        }
        lines.push("");
        lines.push(
          "你可以使用这些已连接应用注册的模组能力，它们会出现在你的可用模组列表中，调用方式与普通模组一致。",
        );
      }
      yield lines.join("\n");
    } catch (e) {
      yield `获取 Unicoda Plus 状态失败：${e}`;
    }
  },
};

registerModule(mod);
