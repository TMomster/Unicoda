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
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
  /** 是否为虚拟参数校准消息（/vpc 命令） */
  isCalibration?: boolean;
  /** 校准值：正数为奖励，负数为惩罚 */
  calibrationValue?: number;
  /** 消息发送方标识，用于区分不同系统账号的消息 */
  sender?: "user" | "assistant" | "framework" | "security" | "system";
  /** 用户对模型回复的评价（点赞/点踩），由用户点击后设置 */
  userRating?: "up" | "down";
  /** 是否为评价系统消息（显示在对话中的评价记录） */
  isRatingEval?: boolean;
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
  /** 由 /system 命令注入的活跃系统指令。独立于 messages/memoryMessages 数组，
   * 不受压缩或数组同步问题影响。buildApiMessages 会将其合并到主 system prompt。 */
  activeSystemInstruction?: string;
  /** 绑定的 XMemory 特化记忆卡 ID（每个会话只能绑定一张，一次绑定不可更改） */
  boundXMemoryCardId?: string;
}

// ── XMemory 特化记忆类型 (v5) ────────────────────────────────────

/** 记忆颗粒类型 */
export type GranuleType = "abstract" | "concrete";

/** 单颗记忆颗粒，卡片内部管理的基本记忆单元 */
export interface XMemoryGranule {
  /** 唯一编号：4 位数字字符串（如 "3742"），不与所属卡片中其他颗粒编号冲突 */
  id: string;
  /** 颗粒标题（由模型自主命名） */
  title: string;
  /** 颗粒类型：abstract=抽象感知（长期记忆），concrete=具象感知（当下环境记忆） */
  type: GranuleType;
  /** 重要级别 */
  importance: "high" | "medium" | "low";
  /** 记忆内容（结构化 Markdown，由模型自主编辑） */
  content: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后修改时间戳 */
  updatedAt: number;
}

/** 特化记忆卡，作为容器管理多个记忆颗粒 */
export interface XMemoryCard {
  /** 唯一编号：4 位数字字符串（如 "3742"），不与现有编号冲突 */
  id: string;
  /** 用户可读的标题 */
  title: string;
  /** 可选的描述信息 */
  description: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后修改时间戳 */
  updatedAt: number;
  /** 是否启用（禁用后不注入 system prompt，模型不主动读取） */
  enabled: boolean;
  /** 本卡管理的记忆颗粒列表 */
  granules: XMemoryGranule[];
  /** 已被删除/释放的颗粒 ID 集合，用于回收复用 */
  releasedGranuleIds: string[];
}

/** 会话-记忆卡绑定记录（独立于卡片存储，实现"一个会话绑定一张卡，一张卡可被多会话绑定"） */
export interface XMemoryBinding {
  /** 会话 ID */
  sessionId: string;
  /** 绑定的记忆卡 ID */
  cardId: string;
  /** 绑定时间戳 */
  boundAt: number;
}

/** XMemory 持久化存储结构 (v5) */
export interface XMemoryStore {
  version: 5;
  cards: XMemoryCard[];
  /** 会话绑定列表（独立的顶级数组，不再嵌入卡片内） */
  bindings: XMemoryBinding[];
  /** 已被删除/释放的卡片 ID 集合，用于回收复用 */
  releasedIds: string[];
}

/** XMemory 导出格式（不含 id 和绑定信息，可安全分享） */
export interface XMemoryCardExport {
  title: string;
  description: string;
  granules: Omit<XMemoryGranule, "id">[];
  exportedAt: number;
  /** 导出格式版本 */
  version: number;
}

// 向后兼容：保留旧类型别名
/** @deprecated 使用 XMemoryBinding 替代 */
export type SessionBinding = XMemoryBinding;
/** @deprecated 使用 XMemoryCardExport 替代 */
export type MemoryCardExport = XMemoryCardExport;

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
