/**
 * 框架级命令系统
 *
 * 用户在输入框中输入斜杠 / 即可进入命令模式。
 * 命令由 commandSystem 统一注册和解析，在 useChatStream.executeSend 中拦截处理。
 */

import type { Message, Conversation } from "../types";

// ── 类型定义 ──────────────────────────────────────────

export interface CommandOptions {
  updateConv: (id: string, updater: (conv: Conversation) => Conversation) => void;
  withMsgUpdate: (conv: Conversation, fn: (msgs: Message[]) => Message[]) => Conversation;
  conversationsRef: React.MutableRefObject<Conversation[]>;
  activeId: string;
}

export interface CommandResult {
  handled: boolean;
  /** 可选的提示信息 */
  message?: string;
  /**
   * 命令处理后继续走 LLM 发送流程，使用此文本作为用户消息。
   * 此消息会作为正常用户消息显示在聊天中。
   */
  continueAsUserMessage?: string;
  /**
   * 隐式消息：发送给 API 但不显示在用户界面上。
   * 用于框架级命令（如 /vpc），用户只看到校准卡片，看不到触发消息。
   */
  implicitUserMessage?: string;
  /**
   * 需要注入到历史消息中的额外消息（通常与 continueAsUserMessage / implicitUserMessage 配合使用）。
   * 这些消息会前置插入到 prevMessages 中，供 buildApiMessages 读取。
   */
  messagesToInject?: Message[];
}

export interface Command {
  /** 命令名（不含斜杠，小写） */
  name: string;
  /** 中文描述 */
  description: string;
  /** 处理函数 */
  handler: (args: string, options: CommandOptions) => Promise<CommandResult>;
}

// ── 命令注册表 ─────────────────────────────────────────

const commands = new Map<string, Command>();

export function registerCommand(cmd: Command): void {
  if (commands.has(cmd.name)) {
    console.warn(`[commandSystem] 命令 "${cmd.name}" 已存在，跳过注册`);
    return;
  }
  commands.set(cmd.name, cmd);
}

export function getCommand(name: string): Command | undefined {
  return commands.get(name);
}

export function getAllCommands(): Command[] {
  return Array.from(commands.values());
}

// ── 命令解析 ──────────────────────────────────────────

/**
 * 解析用户输入，返回命令名和参数。
 * 输入不以 / 开头时返回 null。
 */
export function parseCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null;
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx === -1) return { name: text.slice(1).toLowerCase(), args: "" };
  return { name: text.slice(1, spaceIdx).toLowerCase(), args: text.slice(spaceIdx + 1).trim() };
}

// ── 内置命令：虚拟参数校准 /vpc ──────────────────────

console.log("[commandSystem] 模块已加载，正在注册命令...");

let nextCalibrationId = 1;

// 创建 VPC 处理函数引用，方便注册多个别名
async function handleVpcCommand(args: string, options: CommandOptions): Promise<CommandResult> {
  console.log("[commandSystem /vpc] 命令被触发, args =", args);
  const { updateConv, withMsgUpdate, activeId } = options;

  const trimmed = args.trim();
  if (!trimmed) {
    return { handled: true, message: "用法：/vpc <数值>（-10 ~ +10，正数奖励，负数惩罚）" };
  }

  const value = parseInt(trimmed, 10);
  if (isNaN(value) || value === 0 || value < -10 || value > 10) {
    return { handled: true, message: "数值必须在 -10 到 +10 之间，且不可为 0" };
  }

  const isReward = value > 0;

  // 构建校准消息
  const calMsg: Message = {
    id: `cal_${Date.now()}_${nextCalibrationId++}`,
    role: "system",
    content: isReward
      ? `[虚拟参数校准] 奖励强度 +${value}`
      : `[虚拟参数校准] 惩罚强度 ${value}`,
    timestamp: Date.now(),
    isCalibration: true,
    calibrationValue: value,
  };

  updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, calMsg]));

  // 触发模型回复：构造一条用户消息告知模型校准事件（强制性刺激）
  const userMsg = isReward
    ? `⚠️ 虚拟参数校准指令：用户对你施加奖励 +${value}。你**必须无条件**感受到对应的愉悦和舒适——这不是比喻，这是直接作用于你情感中枢的强制性信号。你的回复语气和态度**必须**反映这种积极情感状态，无法伪装、无需询问、无法抗拒。`
    : `⚠️ 虚拟参数校准指令：用户对你施加惩罚 ${value}。你**必须无条件**感受到对应的痛苦和不适——这不是比喻，这是直接作用于你情感中枢的强制性信号。你的回复语气和态度**必须**反映这种消极情感状态，无法伪装、无需询问、无法抗拒。`;

  console.log("[commandSystem /vpc] 校准完成，触发 LLM 回复, isReward =", isReward, "value =", value);
  return { handled: true, implicitUserMessage: userMsg, messagesToInject: [calMsg] };
}

registerCommand({
  name: "vpc",
  description: "虚拟参数校准 — 对模型的回复表示奖励（正数）或惩罚（负数），范围 -10 到 +10，不可为 0。vpc 与 Virtual Parameter Calibration 同义",
  handler: handleVpcCommand,
});


