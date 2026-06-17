export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 模型的思考/推理过程内容（DeepSeek thinking 模式） */
  reasoningContent?: string;
  timestamp: number;
  streaming?: boolean;
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
