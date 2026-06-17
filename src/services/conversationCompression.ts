/**
 * 对话历史压缩服务
 *
 * 将早期对话压缩为 AI 生成的摘要，保留关键上下文的同时大幅减少 token 消耗。
 * 压缩后的摘要以 `[对话历史摘要]` 标识的系统消息替换旧消息，
 * 最近 N 轮对话完整保留。
 */

import type { Message, ModelConfig } from "../types";
import { streamChatCompletion } from "./modelApi";

/** 压缩时保留的最近完整轮数（1 轮 = 1 user + 1 assistant） */
export const KEEP_ROUNDS = 8;

/** 需要压缩的最小消息数，低于此数无需压缩 */
export const MIN_MESSAGES_FOR_COMPRESSION = KEEP_ROUNDS * 2 + 2; // 18

export interface CompressionResult {
  /** 压缩后的消息数组 */
  messages: Message[];
  /** 生成的摘要文本（为空表示未实际压缩） */
  summary: string;
}

/**
 * 将旧消息压缩为摘要，保留最近 N 轮完整对话。
 *
 * @param messages   原始消息列表
 * @param model      用于生成摘要的模型配置
 * @param keepRounds 保留的最近完整轮数（1 轮 = 1 user + 1 assistant）
 * @param signal     AbortSignal
 */
export async function compressConversation(
  messages: Message[],
  model: ModelConfig,
  keepRounds: number = KEEP_ROUNDS,
  signal?: AbortSignal,
): Promise<CompressionResult> {
  // 最少需要 keepRounds+1 轮才有压缩意义
  const minMessages = keepRounds * 2 + 2;
  if (messages.length < minMessages) {
    return { messages, summary: "" };
  }

  // 分割点：保留最近 keepRounds 轮
  const keepCount = keepRounds * 2;
  const splitIndex = messages.length - keepCount;
  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // 构建摘要 prompt
  const summaryMessages: { role: string; content: string }[] = [
    {
      role: "system",
      content:
        "请用中文将以下对话内容压缩为一段精炼的摘要（200字以内），" +
        "保留所有关键信息：用户的需求、已给出的方案/代码、做出的决策。\n" +
        "只输出摘要文本，不要添加任何前缀或说明。",
    },
    ...oldMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // 调用模型生成摘要
  let summary = "";
  try {
    for await (const chunk of streamChatCompletion(
      model,
      summaryMessages,
      signal,
    )) {
      summary += chunk.content;
    }
  } catch {
    return { messages, summary: "" };
  }

  const trimmed = summary.trim();
  if (!trimmed) {
    return { messages, summary: "" };
  }

  // 构造压缩摘要消息
  const summaryMessage: Message = {
    id: `compressed-${Date.now()}`,
    role: "assistant",
    content: `[对话历史摘要]\n${trimmed}`,
    timestamp: Date.now(),
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    summary: trimmed,
  };
}

/** 检查消息列表中是否已有压缩摘要 */
export function hasCompressionSummary(messages: Message[]): boolean {
  return messages.some((m) => m.content.startsWith("[对话历史摘要]"));
}
