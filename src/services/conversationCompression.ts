/**
 * 对话历史压缩服务
 *
 * 将早期对话压缩为 AI 生成的摘要，保留关键上下文的同时大幅减少 token 消耗。
 * 压缩后的摘要以 `[Conversation History Summary]` 标识的系统消息替换旧消息，
 * 最近 N 轮对话完整保留。
 */

import type { Message, ModelConfig } from "../types";
import { streamChatCompletion } from "./modelApi";

/** 压缩时保留的最近完整轮数（1 轮 = 1 user + 1 assistant） */
export const KEEP_ROUNDS = 20;

/** 需要压缩的最小消息数，低于此数无需压缩 */
export const MIN_MESSAGES_FOR_COMPRESSION = KEEP_ROUNDS * 2 + 2; // 42

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

  // 构建摘要 prompt（中英双语，更详细的结构化要求）
  const summaryMessages: { role: string; content: string }[] = [
    {
      role: "system",
      content:
        "You are a memory compression specialist. Compress the following conversation into a structured, detailed summary. " +
        "Write the summary in Chinese (use English only for technical terms when necessary).\n\n" +
        "## Mandatory sections to fill:\n" +
        "### 1. 用户核心需求与偏好\n" +
        "   - 用户的长期目标、项目方向、反复强调的偏好\n" +
        "   - 用户对回复风格/格式的偏好（如：要详细/简洁、要代码示例、要中文/英文等）\n\n" +
        "### 2. 角色/性格设定\n" +
        "   - 用户要求模型扮演的角色、性格、语气\n" +
        "   - 任何 /system 或 /sys 注入的系统指令\n\n" +
        "### 3. 关键决策与协议\n" +
        "   - 双方达成的重要共识、方向变更\n" +
        "   - 用户拒绝/否决的内容\n\n" +
        "### 4. 技术方案与代码（如有）\n" +
        "   - 使用的语言、框架、库、版本\n" +
        "   - 关键代码架构决策\n" +
        "   - 已解决的问题和遗留问题\n\n" +
        "### 5. 重要事实与引用\n" +
        "   - 讨论中提到的名字、数字、时间、链接、参考信息\n\n" +
        "### 6. 用户情感与反馈\n" +
        "   - 用户对哪些回复满意/不满意\n" +
        "   - 用户表达的情感状态（兴奋、沮丧等）\n\n" +
        "## Quality rules:\n" +
        "- Minimum 400 characters, maximum 1200 characters\n" +
        "- Be specific with names, numbers, and code details — don't generalize\n" +
        "- Preserve exact terminology and jargon the user used\n" +
        "- If a section has nothing to record, omit it rather than writing \"nothing\"\n" +
        "- Output ONLY the summary text, no meta-commentary",
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
    content: `[Conversation History Summary]\n${trimmed}`,
    timestamp: Date.now(),
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    summary: trimmed,
  };
}

const SUMMARY_PREFIXES = ["[对话历史摘要]", "[Conversation History Summary]"];

/** 检查消息列表中是否已有压缩摘要 */
export function hasCompressionSummary(messages: Message[]): boolean {
  return messages.some((m) => SUMMARY_PREFIXES.some((p) => m.content.startsWith(p)));
}
