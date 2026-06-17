export interface ToolDebugEntry {
  /** 当前工具调用轮次（从 0 开始） */
  round: number;
  /** 模型输出的原始工具调用 JSON */
  rawToolCall: string;
  /** 执行结果，执行成功后填充 */
  result?: string;
  /** 错误信息，执行失败后填充 */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  /** 模型的思考/推理过程内容（DeepSeek thinking 模式） */
  reasoningContent?: string;
  reasoningEndTime?: number;
  timestamp: number;
  streaming?: boolean;
  /** 工具调用的 ID（仅 role="tool" 时使用） */
  toolCallId?: string;
  /** 工具调用错误信息 */
  toolCallError?: string;
  /**
   * 开发者调试信息（仅开发者模式开启时记录）。
   * 附加在 assistant 消息上，记录该轮次触发的工具调用详情。
   */
  toolDebugInfo?: ToolDebugEntry[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  /** 已废弃（DeepSeek 不再生效） */
  frequencyPenalty?: number;
  /** 已废弃（DeepSeek 不再生效） */
  presencePenalty?: number;
  /** DeepSeek 思考模式 */
  thinkingType?: "enabled" | "disabled";
  /** DeepSeek 推理强度 */
  reasoningEffort?: "high" | "max";
}

export type Mode = "Chat" | "Agent";

export type PanelMode = "Default" | "Yolo";

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  modelName: string;
  baseUrl: string;
  systemPrompt?: string;
  params: ModelParams;
}
