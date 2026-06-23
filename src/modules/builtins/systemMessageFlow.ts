/**
 * 系统消息流转（SYS）模组。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 作用：用户在聊天中输入 /system 或 /sys <指令> 即可向模型注入一条系统级指令，
 * 用于微调角色行为或设定上下文，不占用用户身份。
 * 此模组仅用于在模组列表中展示 SYS 功能的存在，不涉及模型自动调用。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";

const mod: Module = {
  id: "system_message_flow",
  name: "系统消息流转（SYS）",
  description:
    "用户可以通过 /system <指令> 或 /sys <指令> 命令向模型注入一条 role: system 的消息，用于微调角色行为、设定上下文或下发系统级指令，且不占用用户身份。此功能由用户主动触发，无需模型自动调用。",
  userDescription: "通过 /system 或 /sys 命令向模型注入系统级指令",
  level: "normal",
  execute: async function* (_params, _signal) {
    yield "系统消息流转（SYS）为命令触发功能，请在聊天输入框中使用 /system <指令> 或 /sys <指令> 命令。";
  },
};

registerModule(mod);
