/** 敏感模组操作审批记录 */
export interface PermissionRecord {
  /** 用户选择 */
  level: "approve_all" | "auto_all" | "deny_round";
  /** 作用域：single（仅本次）/ round（本轮）/ session（本局会话） */
  scope: "single" | "round" | "session";
  /** 是否勾选"本局会话内不再提示" */
  suppressPrompt: boolean;
  /** 操作时间戳 */
  timestamp: number;
  /** 触发审批的敏感模组 ID */
  triggerToolId?: string;
}

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
  /** 等待用户审批中（role="tool" 时使用），此时显示"执行"/"取消"按钮 */
  pendingApproval?: boolean;
  /**
   * 开发者调试信息（仅开发者模式开启时记录）。
   * 附加在 assistant 消息上，记录该轮次触发的工具调用详情。
   */
  toolDebugInfo?: ToolDebugEntry[];
  /** 上传的文件附件 */
  files?: FileAttachment[];
  /** 正在发起工具调用中（仅 assistant 消息，content 中已剥离 <tool_call> 标签） */
  toolCallInProgress?: boolean;
  /** 任务计划执行的步骤数量（仅 task_plan 执行后的 assistant 消息） */
  toolCallResultCount?: number;
  /** 是否为任务计划卡片消息（独立 UI 卡片展示） */
  isTaskPlan?: boolean;
  /** 任务计划数据 */
  taskPlan?: { intent: string; feasibility: string; steps: { id: string; tool: string; description: string }[] };
  /** 敏感模组操作审批记录（附加在 system 消息上持久化） */
  permissionRecord?: PermissionRecord;
  /** 是否为 Unicoda Security 嵌入式权限审批菜单消息 */
  isSecurityApproval?: boolean;
  /** Security 审批菜单是否已处理（确认/拒绝后设为 true，保留菜单印记） */
  securityApprovalDone?: boolean;
  /** Security 审批结果 */
  securityApprovalResult?: PermissionRecord;
  /** API 返回的 token 消耗统计（仅 assistant 消息，流结束后设置） */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface Conversation {
  id: string;
  title: string;
  /** 字面量消息数组：用户界面上看到的完整消息记录，永不压缩 */
  messages: Message[];
  /** 记忆量消息数组：实际发送给模型的消息记录。可能被压缩（不同于 messages），
   * 如果为 undefined 则回退使用 messages。 */
  memoryMessages?: Message[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** 是否已完成自动标题生成（仅在新会话第一次对话完成后触发一次） */
  autoTitleDone?: boolean;
  /** Yolo 模式下每个会话独立记录的工作区路径。为空时使用全局 sessionPath。 */
  workspacePath?: string;
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
