export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  /** MIME 类型 */
  mimeType: string;
  /** 文件内容（文本文件）或 Data URL（图片） */
  data: string;
  /** 是否为图片文件 */
  isImage: boolean;
}

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
  /** 上传的文件附件 */
  files?: FileAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** 是否已完成自动标题生成（仅在新会话第一次对话完成后触发一次） */
  autoTitleDone?: boolean;
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
  /** 允许上传文件 */
  allowFileUpload?: boolean;
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
