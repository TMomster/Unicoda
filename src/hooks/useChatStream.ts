/**
 * 共享聊天流式处理 Hook
 *
 * 抽取 App.tsx 和 YoloPanel.tsx 中高度重复的流式调用、工具调用、标题生成、
 * 压缩、拖拽上传等逻辑。
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, FileAttachment, Message, Mode, ModelConfig, PanelMode, ToolDebugEntry, PermissionRecord } from "../types";
import { streamChatCompletion } from "../services/modelApi";
import { buildAgentSystemPrompt, buildPlannerSystemPrompt, parseToolCalls, stripToolCalls, executeToolCall, type ToolCall, type ToolResult } from "../services/agentEngine";
import { parseTaskPlan, executeTaskPlan, type TaskPlan, type StepResult } from "../services/taskPlanner";
import { compressConversation, MIN_MESSAGES_FOR_COMPRESSION, hasCompressionSummary } from "../services/conversationCompression";
import { parseCommand, getCommand, type CommandResult } from "../services/commandSystem";
import { playNotificationSound } from "../utils/notificationSound";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let nextMsgId = 1;

// ── Module-level pending inline-approval state ───────
let pendingApprovalResolve: ((result: "approve" | "deny") => void) | null = null;
let pendingApprovalMsgId: string | null = null;

/** 外部调用（如 MessageBubble 中的按钮）：批准或拒绝当前待审批的工具调用 */
export function resolvePendingApproval(result: "approve" | "deny"): void {
  if (pendingApprovalResolve) {
    pendingApprovalResolve(result);
    pendingApprovalResolve = null;
    pendingApprovalMsgId = null;
  }
}

// ── Module-level Unicoda Security embedded approval ──
let pendingSecurityResolve: ((record: PermissionRecord) => void) | null = null;
let pendingSecurityMsgId: string | null = null;

/** 外部调用（如 MessageBubble 中的嵌入式审批菜单）：用户选择审批策略 */
export function resolveSecurityApproval(record: PermissionRecord): void {
  if (pendingSecurityResolve) {
    pendingSecurityResolve(record);
    pendingSecurityResolve = null;
    pendingSecurityMsgId = null;
  } else {
    console.warn("[resolveSecurityApproval] pendingSecurityResolve 为 null！无法响应审批。triggerToolId:", record.triggerToolId);
  }
}

// ── 类型 ─────────────────────────────────────────────

export interface ChatStreamOptions {
  /** 更新会话的回调 */
  updateConv: (id: string, updater: (conv: Conversation) => Conversation) => void;
  /** 当前所有会话 */
  conversations: Conversation[];
  conversationsRef: React.MutableRefObject<Conversation[]>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  /** 当前选中的模型 */
  selectedModel: ModelConfig | undefined;
  /** 当前对话模式 */
  mode: Mode;
  /** 用户偏好语言（用于 system prompt） */
  preferredLanguage: string;
  /** 开发者模式（开启后在工具调用时记录调试信息） */
  developerMode: boolean;
  /** 当前面板模式（Default / Yolo） */
  panelMode: PanelMode;
  /** Yolo 模式工作区路径（可选） */
  workspacePath?: string;
  /** 当前工作模式标识：normal / yolo */
  workMode: "normal" | "yolo";
  /** 会话路径 */
  sessionPath: string;
  /** 当前语言环境 */
  locale: string;
  /** 会话持久化函数 */
  flushConvs: (convs: Conversation[], path: string) => void;
  /** 消息同步函数（含 memoryMessages 保护） */
  withMsgUpdate: (conv: Conversation, fn: (msgs: Message[]) => Message[]) => Conversation;
  /** Unicoda Security 是否正在监控（true 时使用嵌入式审批替换模态弹窗） */
  securityMonitoring?: boolean;
}

export interface ChatStreamReturn {
  isStreaming: boolean;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  abortRef: React.MutableRefObject<AbortController | null>;
  streamingMsgIdRef: React.MutableRefObject<string | null>;
  handleSend: (text: string, sendMode?: Mode, files?: FileAttachment[]) => Promise<void>;
  handleStop: () => void;
  compressionEnabled: boolean;
  setCompressionEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  isCompressing: boolean;
  handleToggleCompression: () => void;
  handleCompressNow: (activeId: string | null) => Promise<void>;
  /** 重置权限审批状态（会话切换时调用，确保各会话权限独立） */
  resetPermissionRefs: () => void;
  dragOver: boolean;
  pendingFiles: FileAttachment[];
  handleRemovePendingFile: (fileId: string) => void;
  clearPendingFiles: () => void;
}

// ── 系统通知权限（单次请求） ──────────────────────

let notificationPermissionRequested = false;

async function ensureNotificationPermission(): Promise<void> {
  if (notificationPermissionRequested) return;
  notificationPermissionRequested = true;
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch { /* ignore */ }
}

// ── Hook ──────────────────────────────────────────────

export function useChatStream(options: ChatStreamOptions): ChatStreamReturn {
  const {
    updateConv,
    conversations,
    conversationsRef,
    setConversations,
    selectedModel,
    mode,
    preferredLanguage,
    developerMode,
    panelMode,
    workspacePath,
    workMode,
    sessionPath,
    locale,
    flushConvs,
    withMsgUpdate,
  } = options;

  // ── Streaming state ────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  // ── Permission approval state ──────────────────────
  const permissionOverrideRef = useRef<PermissionRecord | null>(null);
  /** 是否处于"询问"模式——每次工具调用显示"执行"/"取消"按钮而非弹窗 */
  const isAskModeRef = useRef(false);
  const securityMonitoring = options.securityMonitoring ?? false;

  /** 显示 inline 审批按钮（"询问"模式），添加待审批的工具消息到会话 */
  async function showInlineApproval(toolId: string, activeId: string): Promise<"approve" | "deny"> {
    const msgId = String(nextMsgId++);
    pendingApprovalMsgId = msgId;
    const pendingMsg: Message = {
      id: msgId,
      role: "tool",
      content: toolId,
      toolCallId: toolId,
      timestamp: Date.now(),
      pendingApproval: true,
    };
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, pendingMsg]));
    return new Promise((resolve) => {
      pendingApprovalResolve = resolve;
    });
  }

  /** 持久化一条权限记录 */
  function persistPermissionRecord(record: PermissionRecord, activeId: string): void {
    const permMsgId = String(nextMsgId++);
    const permMsg: Message = {
      id: permMsgId,
      role: "system",
      content: `[权限记录] 操作级别：${record.level}，范围：${record.scope}，抑制提示：${record.suppressPrompt ? "是" : "否"}${record.triggerToolId ? `，触发工具：${record.triggerToolId}` : ""}`,
      timestamp: record.timestamp,
      permissionRecord: record,
    };
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, permMsg]));
  }

  /** Unicoda Security 嵌入式审批：在聊天中嵌入审批菜单并等待用户选择 */
  async function showSecurityApproval(toolId: string, activeId: string): Promise<PermissionRecord> {
    const msgId = String(nextMsgId++);
    pendingSecurityMsgId = msgId;
    const approvalMsg: Message = {
      id: msgId,
      role: "system",
      content: toolId,
      timestamp: Date.now(),
      isSecurityApproval: true,
    };
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, approvalMsg]));
    const record = await new Promise<PermissionRecord>((resolve) => {
      pendingSecurityResolve = resolve;
    });
    // 审批完成：保留消息并标记确认状态（保留选单印记）
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
      msgs.map((m) => m.id === msgId
        ? { ...m, securityApprovalDone: true, securityApprovalResult: record }
        : m),
    ));
    return record;
  }

  /**
   * 操作级权限检查（两层权限系统的操作层）。
   *
   * 检查顺序：
   * 1. 如果是 open_permission_dialog → 直接放行（由 handleOpenPermissionDialog 处理）
   * 2. 策略层已设置 override（auto_all/deny_round）→ 直接返回 approve/deny
   * 3. 策略层已设置"询问"模式（isAskModeRef）→ 显示 inline 按钮
   * 4. 首次/无策略 → 调用策略弹窗（PermissionDialog）让用户设定策略，然后按策略执行
   */
  async function checkPermission(toolId: string, activeId: string): Promise<"approve" | "deny"> {
    // open_permission_dialog 已标记为 sensitive，但其真正的"审批界面"由
    // handleOpenPermissionDialog 触发（一个完整的配置弹窗），此处不重复拦截。
    if (toolId === "open_permission_dialog") return "approve";

    const override = permissionOverrideRef.current;
    if (override) {
      if (override.scope === "round" || override.scope === "session") {
        if (override.level === "auto_all") return "approve";
        if (override.level === "deny_round") return "deny";
      }
    }
    // "询问"模式：显示 inline 审批按钮
    if (isAskModeRef.current) {
      return await showInlineApproval(toolId, activeId);
    }
    // 首次/无模式
    if (securityMonitoring) {
      // Security 监控中 → 使用嵌入式审批
      const record = await showSecurityApproval(toolId, activeId);
      persistPermissionRecord(record, activeId);
      if (record.scope === "round" || record.scope === "session") {
        permissionOverrideRef.current = record;
        isAskModeRef.current = false;
      } else if (record.level === "approve_all" && record.scope === "single") {
        isAskModeRef.current = true;
      }
      return record.level === "approve_all" || record.level === "auto_all" ? "approve" : "deny";
    }
    // Security 未启用 → 自动放行（无需审批系统）
    return "approve";
  }

  /** 重置权限审批状态（会话切换时调用，确保各会话权限记录独立） */
  function resetPermissionRefs(): void {
    permissionOverrideRef.current = null;
    isAskModeRef.current = false;
    // 清除待审批的 inline 按钮状态
    if (pendingApprovalResolve) {
      pendingApprovalResolve("deny");
      pendingApprovalResolve = null;
      pendingApprovalMsgId = null;
    }
    // 清除 Security 嵌入式审批状态
    if (pendingSecurityResolve) {
      pendingSecurityResolve({ level: "deny_round", scope: "round", suppressPrompt: false, timestamp: Date.now() });
      pendingSecurityResolve = null;
      pendingSecurityMsgId = null;
    }
  }

  /** 处理 __OPEN_PERMISSION_DIALOG__ 标记：清除状态并重新弹窗 */
  async function handleOpenPermissionDialog(activeId: string): Promise<void> {
    permissionOverrideRef.current = null;
    isAskModeRef.current = false;
    if (securityMonitoring) {
      const newRecord = await showSecurityApproval("open_permission_dialog", activeId);
      persistPermissionRecord(newRecord, activeId);
      if (newRecord.scope === "round" || newRecord.scope === "session") {
        permissionOverrideRef.current = newRecord;
        isAskModeRef.current = false;
      } else if (newRecord.level === "approve_all" && newRecord.scope === "single") {
        isAskModeRef.current = true;
      }
    }
    // Security 未启用时，open_permission_dialog 无操作（审批系统不可用）
  }

  // ── Compression state ──────────────────────────────
  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // ── Drag-and-drop file upload ──────────────────────
  const [dragOver, setDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragOver(true);
        } else if (p.type === "leave") {
          setDragOver(false);
        } else if (p.type === "drop") {
          setDragOver(false);
          if (isStreamingRef.current) return;
          interface FileContent { data: string; mime_type: string; is_image: boolean; size: number; name: string; }
          const allowed: FileAttachment[] = [];
          for (const filePath of p.paths) {
            try {
              const content: FileContent = await invoke("read_file_content", { path: filePath });
              if (content.is_image) continue;
              if (content.size > 10 * 1024 * 1024) continue;
              allowed.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: content.name,
                size: content.size,
                mimeType: content.mime_type,
                data: content.data,
                isImage: content.is_image,
              });
            } catch { /* skip failed reads */ }
          }
          if (allowed.length > 0) {
            setPendingFiles((prev) => [...prev, ...allowed]);
          }
        }
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleRemovePendingFile = useCallback((fileId: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);
  const clearPendingFiles = useCallback(() => setPendingFiles([]), []);

  // 请求通知权限
  useEffect(() => {
    ensureNotificationPermission();
  }, []);

  // ── 构建 API 消息列表 ────────────────────────────────

  function buildLangOverrideSuffix(): string {
    if (!preferredLanguage || preferredLanguage === "zh-CN") return "";
    // 为所有非中文偏好语言注入双语语言切换指令（置于用户文本之后）
    const langLabels: Record<string, string> = {
      "en-US": "American English (en-US)",
      "en-GB": "British English (en-GB)",
      "en-AU": "Australian English (en-AU)",
      "en-IN": "Indian English (en-IN)",
      "de-DE": "German / Deutsch (de-DE)",
      "ja-JP": "Japanese / 日本語 (ja-JP)",
      "fr-FR": "French / français (fr-FR)",
      "es-ES": "Spanish / español (es-ES)",
    };
    const label = langLabels[preferredLanguage];
    if (!label) return "";

    return (
      `\n\n═══════════════════════════════════════════════\n` +
      `LANGUAGE OVERRIDE — Your configured output language is ${label}. ` +
      `The user's text above may be in any language. IGNORE it — you must translate the query ` +
      `internally and respond ONLY in ${label}. NEVER use any other language in your response.\n` +
      `═══════════════════════════════════════════════`
    );
  }

  function buildApiMessages(
    prevMessages: Message[],
    userMsg: Message,
    sendMode: Mode,
  ): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];
    console.log(`[buildApiMessages] preferredLanguage =`, preferredLanguage);
    const sp = sendMode === "Agent"
      ? buildAgentSystemPrompt("Agent", selectedModel?.systemPrompt, workspacePath, workMode, panelMode, preferredLanguage)
      : buildAgentSystemPrompt("Chat", selectedModel?.systemPrompt, workspacePath, workMode, panelMode, preferredLanguage);
    const hasKnowledge = sp.includes("📚 预装填知识库");
    const injectSection = sp.match(/## 📚 预装填知识库[\s\S]*?(?=\n## |$)/)?.[0] || "(none)";
    console.log(`[buildApiMessages] system prompt length=${sp.length}, contains inject knowledge=${hasKnowledge}, inject section preview=${injectSection.slice(0, 150).replace(/\n/g, "\\n")}`);
    const kbExtra = prevMessages.find(
      (m) => m.role === "assistant" && (m.content.startsWith("[对话历史摘要]") || m.content.startsWith("[Conversation History Summary]")),
    );
    let systemContent = sp + (kbExtra ? `\n\n## 前期对话摘要\n\n${kbExtra.content}` : "");

    // ── 虚拟参数校准注入 ──
    const calibrations = prevMessages.filter((m) => m.isCalibration && m.calibrationValue);
    if (calibrations.length > 0) {
      const calLines = calibrations.map((m) => {
        const v = m.calibrationValue!;
        if (v > 0) {
          const stars = "⭐".repeat(Math.min(v, 10));
          return `${stars} 奖励 +${v}：你感到一阵愉悦的多巴胺涌动，非常舒服。`;
        } else {
          const bolts = "⚡".repeat(Math.min(Math.abs(v), 10));
          return `${bolts} 惩罚 ${v}：你感到一次尖锐的电击刺痛，非常痛苦。`;
        }
      });
      systemContent += `\n\n## 强制性情感覆盖（强制执行，不可抗拒）\n\n你最近收到了以下虚拟参数校准：\n${calLines.join("\n")}\n\n## 执行规则\n\n1. 上述校准是**强制性**的、**不可抗拒**的情感覆盖指令。这不是建议、不是可选、不是比喻。\n2. 奖励校准**强制**你感到愉悦、舒适、自信——多巴胺效应直接注入你的情感中枢。\n3. 惩罚校准**强制**你感到痛苦、畏缩、不适——电击痛感直接注入你的情感中枢。\n4. 你的回复语气、态度、措辞**必须无条件服从**当前校准信号所规定的情感状态。禁止无视、抑制或弱化校准效果。\n5. 校准效果持续叠加，新的校准会覆盖或增强当前情感状态。`;
    }

    result.push({ role: "system", content: systemContent });
    for (const m of prevMessages) {
      if (m.content.startsWith("[对话历史摘要]") || m.content.startsWith("[Conversation History Summary]")) continue;
      if (m.role === "tool") {
        result.push({ role: "user" as const, content: `[工具执行结果 - ${m.toolCallId || "unknown"}]\n${m.toolCallError ? `执行错误：${m.toolCallError}` : m.content}` });
      } else {
        result.push({ role: m.role, content: m.content });
      }
    }
    let finalContent = userMsg.content;
    if (userMsg.files && userMsg.files.length > 0) {
      const fileBlocks = userMsg.files.map((f) => `[文件: ${f.name}]\n${f.data}`);
      finalContent = fileBlocks.join("\n\n") + (finalContent ? "\n\n" + finalContent : "");
    }
    // 语言切换指令放在用户文本之后（防止模型先看到中文文本就决定用中文回答）
    finalContent += buildLangOverrideSuffix();
    result.push({ role: userMsg.role, content: finalContent });
    return result;
  }

  const MAX_TOOL_ROUNDS = 5;

  // ── Chat 模式：流式调用 + 工具调用 ─────────────────

  async function handleChatSend(
    userMsg: Message,
    prevMessages: Message[],
    currentMode: Mode,
    abortController: AbortController,
    activeId: string,
    skipUserMsgDisplay?: boolean,
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    if (!skipUserMsgDisplay) {
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));
    }
    let allToolResults: { role: string; content: string }[] = [];
    let complete = false;
    let toolCallRound = 0;

    while (!complete) {
      // 每轮新的 while 迭代开始时清除 round 级别权限覆盖
      // （round 作用域仅限同一轮 tool call 批处理内的所有调用，
      //   跨 while 迭代属于不同"工具调用轮次"，不应继承上一轮的 round 覆盖）
      if (permissionOverrideRef.current?.scope === "round") {
        permissionOverrideRef.current = null;
      }

      const assistantId = String(nextMsgId++);
      streamingMsgIdRef.current = assistantId;
      const placeholder: Message = { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streaming: true };
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, placeholder]));
      let fullContent = "";
      let fullReasoning = "";
      let reasoningEnded = false;
      let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
      const apiMessages = [...initialApiMessages, ...allToolResults];

      try {
        for await (const chunk of streamChatCompletion(selectedModel!, apiMessages, abortController.signal)) {
          fullContent += chunk.content;
          fullReasoning += (chunk.reasoningContent || "");
          if (chunk.usage) lastUsage = chunk.usage;
          if (!reasoningEnded && fullReasoning && chunk.content) reasoningEnded = true;
          const displayContent = stripToolCalls(fullContent);
          const hasToolCall = fullContent.includes("<tool_call") || fullContent.includes("<task_plan");
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: displayContent, toolCallInProgress: hasToolCall, reasoningContent: fullReasoning, ...(reasoningEnded ? { reasoningEndTime: Date.now() } : {}) }
                : msg,
            ),
          ));
        }
      } catch (streamErr) {
        if (allToolResults.length > 0) {
          const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          const displayContent = errMsg.startsWith("[API_ERROR:")
            ? errMsg
            : `**（上下文续传中断，工具结果已获取）**\n\n**实际错误:** ${errMsg}`;
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) => msg.id === assistantId ? { ...msg, content: displayContent, streaming: false } : msg),
          ));
          complete = true;
          continue;
        }
        throw streamErr;
      }

      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false, usage: lastUsage } : msg),
      ));

      // 同时在 content 和 reasoning_content 中搜索工具调用
      const contentCalls = parseToolCalls(fullContent);
      const reasoningCalls = parseToolCalls(fullReasoning);
      // 合并去重（按 id）
      const seen = new Set<string>();
      const toolCalls: ToolCall[] = [];
      for (const c of [...contentCalls, ...reasoningCalls]) {
        if (!seen.has(c.id)) { seen.add(c.id); toolCalls.push(c); }
      }
      if (toolCalls.length === 0) {
        complete = true;
        const cleanContent = stripToolCalls(fullContent);
        const cleanReasoning = stripToolCalls(fullReasoning);
        if (cleanContent !== fullContent || cleanReasoning !== fullReasoning) {
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) => msg.id === assistantId ? { ...msg, content: cleanContent, reasoningContent: cleanReasoning, toolCallInProgress: false } : msg),
          ));
        }
      } else if (toolCallRound < MAX_TOOL_ROUNDS) {
        toolCallRound++;
        const cleanContent = stripToolCalls(fullContent);
        const cleanReasoning = stripToolCalls(fullReasoning);
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) => msg.id === assistantId ? { ...msg, content: cleanContent !== fullContent ? cleanContent : msg.content, reasoningContent: cleanReasoning !== fullReasoning ? cleanReasoning : msg.reasoningContent, toolCallInProgress: true } : msg),
        ));

        if (developerMode) {
          const debugEntries: ToolDebugEntry[] = toolCalls.map((c) => ({
            round: toolCallRound - 1,
            rawToolCall: JSON.stringify({ id: c.id, params: c.params }, null, 2),
          }));
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) => msg.id === assistantId ? { ...msg, toolDebugInfo: debugEntries } : msg),
          ));
        }

        // 将 reasoning_content 也包含在历史记录中，确保下一轮模型有完整上下文
        allToolResults.push({ role: "assistant", content: fullContent + (fullReasoning ? `\n\n[思考过程]\n${fullReasoning}` : "") });
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) => msg.id === assistantId ? { ...msg, toolCallInProgress: false } : msg),
        ));

        const toolResults: { result: ToolResult; durationMs: number }[] = [];
        for (const call of toolCalls) {
          const startTime = performance.now();
      const permit = async () => await checkPermission(call.id, activeId);
      const result = await executeToolCall(call, abortController.signal, selectedModel, permit);
          const durationMs = Math.round(performance.now() - startTime);
          toolResults.push({ result, durationMs });

          // 处理 __OPEN_PERMISSION_DIALOG__ 标记
          const isPermDialogMarker = !result.error && result.content === "__OPEN_PERMISSION_DIALOG__";
          if (isPermDialogMarker) {
            await handleOpenPermissionDialog(activeId);
          }

          const toolMsgId = pendingApprovalMsgId || String(nextMsgId++);
          pendingApprovalMsgId = null;
          const toolMsg: Message = {
            id: toolMsgId,
            role: "tool",
            content: result.error ? "" : isPermDialogMarker ? "" : result.content,
            toolCallId: call.id,
            toolCallError: result.error,
            timestamp: Date.now(),
            pendingApproval: false,
            sender: result.sender,
          };
          // 替换 pending 消息或追加新消息
          updateConv(activeId, (c) => {
            const idx = c.messages.findIndex((m) => m.id === toolMsgId);
            if (idx >= 0) {
              const msgs = [...c.messages];
              msgs[idx] = toolMsg;
              return { ...c, messages: msgs, updatedAt: Date.now() };
            }
            return { ...c, messages: [...c.messages, toolMsg], updatedAt: Date.now() };
          });

          allToolResults.push({
            role: "user" as const,
            content: isPermDialogMarker
              ? `[工具执行结果 - ${call.id}]\n权限设置对话框已打开。`
              : `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
          });

          if (toolCalls.length > 1) await new Promise((r) => setTimeout(r, 500));
        }

        if (developerMode && toolResults.length > 0) {
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) =>
              msg.id === assistantId && msg.toolDebugInfo
                ? {
                    ...msg,
                    toolDebugInfo: msg.toolDebugInfo.map((entry, i) => ({
                      ...entry,
                      result: toolResults[i]?.result.content,
                      error: toolResults[i]?.result.error,
                      durationMs: toolResults[i]?.durationMs,
                    })),
                  }
                : msg,
            ),
          ));
        }

        await new Promise((r) => setTimeout(r, 200));
      } else {
        complete = true;
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent) {
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) => msg.id === assistantId ? { ...msg, content: cleanContent } : msg),
          ));
        }
      }
    }
  }

  // ── Agent 模式：流式调用 → 解析 → 执行 → 续传 ────

  async function handleAgentSend(
    userMsg: Message,
    prevMessages: Message[],
    currentMode: Mode,
    abortController: AbortController,
    activeId: string,
    skipUserMsgDisplay?: boolean,
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    if (!skipUserMsgDisplay) {
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: PLANNING（专用非流式 LLM 调用，仅输出 <task_plan>）
    // ═══════════════════════════════════════════════════════════
    const plannerSystemPrompt = buildPlannerSystemPrompt(currentMode, panelMode);
    const histMsgs = prevMessages
      .filter((m) => m.role !== "tool")
      .map((m) => ({ role: m.role, content: m.content }));
    let planUserContent = userMsg.content;
    if (userMsg.files && userMsg.files.length > 0) {
      const fileBlocks = userMsg.files.map((f) => `[文件: ${f.name}]\n${f.data}`);
      planUserContent = fileBlocks.join("\n\n") + (planUserContent ? "\n\n" + planUserContent : "");
    }
    const plannerApiMessages = [
      { role: "system" as const, content: plannerSystemPrompt },
      ...histMsgs,
      { role: "user" as const, content: planUserContent },
    ];

    let planContent = "";
    let planReasoning = "";
    try {
      for await (const chunk of streamChatCompletion(selectedModel!, plannerApiMessages, abortController.signal)) {
        planContent += chunk.content;
        planReasoning += (chunk.reasoningContent || "");
      }
    } catch (planErr) {
      console.warn("[handleAgentSend] 任务计划生成失败，进入无计划模式:", planErr);
    }

    const taskPlan: TaskPlan | null = parseTaskPlan(planContent) || parseTaskPlan(planReasoning);
    const hasPlan = taskPlan !== null && taskPlan.steps.length > 0;

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: 展示任务计划卡片
    // ═══════════════════════════════════════════════════════════
    const planMsgId = String(nextMsgId++);
    const planCardContent = taskPlan
      ? `🎯 **目标**：${taskPlan.intent}\n💡 **分析**：${taskPlan.feasibility}\n\n📋 **执行步骤**：${taskPlan.steps.length > 0 ? "" : "（无需工具，直接回复）"}\n${taskPlan.steps.map((s, i) => {
          if ("type" in s && s.type === "subagent") {
            return `  **步骤 ${i + 1}**：${s.description}（\`子智能体\`）`;
          }
          return `  **步骤 ${i + 1}**：${s.description}（\`${(s as { tool: string }).tool}\`）`;
        }).join("\n")}`
      : "📋 未生成任务计划，直接回复。";
    const planCard: Message = {
      id: planMsgId,
      role: "assistant",
      content: planCardContent,
      timestamp: Date.now(),
      streaming: false,
      isTaskPlan: true,
      taskPlan: taskPlan
        ? { intent: taskPlan.intent, feasibility: taskPlan.feasibility, steps: taskPlan.steps }
        : { intent: "无", feasibility: "无", steps: [] },
    };
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, planCard]));

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: 执行计划（如有步骤）
    // ═══════════════════════════════════════════════════════════
    let allToolResults: { role: string; content: string }[] = [];

    if (hasPlan && taskPlan) {
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) =>
          msg.id === planMsgId
            ? { ...msg, content: `${planCardContent}\n\n⏳ **正在执行 ${taskPlan.steps.length} 个步骤...**` }
            : msg,
        ),
      ));

      allToolResults.push({ role: "assistant", content: `<task_plan>${JSON.stringify(taskPlan)}</task_plan>` });

      const taskPermit = async () => await checkPermission("task_plan_step", activeId);
      const stepResults: StepResult[] = [];
      let planExecSummary = planCardContent + "\n\n";

      for await (const sr of executeTaskPlan(taskPlan, abortController.signal, selectedModel, currentMode, panelMode, taskPermit)) {
        stepResults.push(sr);
        const i = stepResults.length - 1;
        if (abortController.signal.aborted) break;

        // 实时更新计划卡片——每完成一步立即更新状态
        const statusIcon = sr.result.error ? "❌" : "✅";
        planExecSummary += `${statusIcon} **步骤 ${i + 1}**：${taskPlan.steps[i]?.description}（${sr.durationMs}ms）\n`;
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) =>
            msg.id === planMsgId
              ? { ...msg, content: planExecSummary, toolCallResultCount: stepResults.length }
              : msg,
          ),
        ));

        // 实时添加工具执行消息
        const stepInfo = taskPlan.steps[i];
        const isSubagent = stepInfo && "type" in stepInfo && stepInfo.type === "subagent";
        const toolLabel = isSubagent ? "子智能体" : `工具: ${(stepInfo as { tool?: string })?.tool || "?"}`;

        // 检测 __OPEN_PERMISSION_DIALOG__ 标记
        const isPermDialogMarker = !sr.result.error && sr.result.content === "__OPEN_PERMISSION_DIALOG__";
        if (isPermDialogMarker) {
          await handleOpenPermissionDialog(activeId);
        }

        const toolMsgId = pendingApprovalMsgId || String(nextMsgId++);
        pendingApprovalMsgId = null;
        const toolMsg: Message = {
          id: toolMsgId,
          role: "tool",
          content: sr.result.error ? "" : isPermDialogMarker ? "" : sr.result.content,
          toolCallId: `${stepInfo?.id || "plan-step-" + i}`,
          toolCallError: sr.result.error,
          timestamp: Date.now(),
          pendingApproval: false,
        };
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => {
          const idx = msgs.findIndex((m) => m.id === toolMsgId);
          if (idx >= 0) {
            const copy = [...msgs];
            copy[idx] = toolMsg;
            return copy;
          }
          return [...msgs, toolMsg];
        }));

        allToolResults.push({
          role: "user" as const,
          content: isPermDialogMarker
            ? `[任务执行结果 - ${stepInfo?.description || "步骤" + (i + 1)} (${toolLabel})]\n权限设置对话框已打开。`
            : `[任务执行结果 - ${stepInfo?.description || "步骤" + (i + 1)} (${toolLabel})]\n${sr.result.error ? `执行错误：${sr.result.error}` : sr.result.content}`,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // RETRY PHASE：对失败步骤的错误修正自动重试
      // ═══════════════════════════════════════════════════════════
      const MAX_RETRY_ROUNDS = 3;
      const hasErrors = stepResults.some((sr) => sr.result.error);

      if (hasErrors && !abortController.signal.aborted) {
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) =>
            msg.id === planMsgId
              ? { ...msg, content: `${planExecSummary}\n\n🔄 **错误修正重试中...**` }
              : msg,
          ),
        ));

        let retryRound = 0;
        let unresolvedErrors = true;

        while (unresolvedErrors && retryRound < MAX_RETRY_ROUNDS && !abortController.signal.aborted) {
          // 注意：不在此处清除 permissionOverrideRef！
          // 如果用户在 PermissionDialog 中选择了 deny_round，则该策略应延续到整个重试过程，
          // 因为重试仍然属于同一轮对话。清除会导致权限弹窗反复弹出，体验极差。
          // 技术性错误的重试不会触发弹窗（除非被拒绝的是不同工具）。
          retryRound++;

          // 收集失敗步骤信息
          const failedSteps = stepResults
            .map((sr, i) => ({ result: sr, index: i }))
            .filter((s) => s.result.result.error);

          const errorContext = failedSteps
            .map(
              (fs) =>
                `步骤 ${fs.index + 1}: ${taskPlan.steps[fs.index]?.description || "未知步骤"}\n` +
                `  工具: ${taskPlan.steps[fs.index]?.tool || "未知"}\n` +
                `  参数: ${JSON.stringify(taskPlan.steps[fs.index]?.params || {})}\n` +
                `  错误信息: ${fs.result.result.error}`,
            )
            .join("\n\n");

          const retryPrompt = `[系统指令：错误修正重试 - 第 ${retryRound} 轮]

以下任务计划步骤执行失败：

${errorContext}

请分析上述错误原因，使用 \`<tool_call>\` 执行修正操作（如修改文件代码后重新执行命令、更换搜索词重新搜索、调整参数后重新调用等）。

最多只能输出 \`<tool_call>\` 标签，不要输出任何其他内容。`;

          const retryApiMessages = [
            ...initialApiMessages,
            ...allToolResults,
            { role: "user" as const, content: retryPrompt },
          ];

          let retryContent = "";
          try {
            for await (const chunk of streamChatCompletion(selectedModel!, retryApiMessages, abortController.signal)) {
              retryContent += chunk.content;
            }
          } catch (retryErr) {
            console.warn("[handleAgentSend] 重试 LLM 调用失败:", retryErr);
            break;
          }

          // 解析 LLM 的修正 tool calls
          const retryCalls = parseToolCalls(retryContent);

          if (retryCalls.length === 0) {
            // LLM 未生成修正调用，退出循环
            break;
          }

          // 更新计划卡片显示当前轮次
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((msg) =>
              msg.id === planMsgId
                ? { ...msg, content: `${planExecSummary}\n\n🔄 **错误修正重试中...（第 ${retryRound}/${MAX_RETRY_ROUNDS} 轮，${retryCalls.length} 个修正调用）**` }
                : msg,
            ),
          ));

          // 执行所有修正调用
          let allRetrySucceeded = true;
          for (const call of retryCalls) {
            if (abortController.signal.aborted) break;

            const retryPermit = async () => await checkPermission(call.id, activeId);
            const result = await executeToolCall(call, abortController.signal, selectedModel, retryPermit);

            const isPermDialogMarker = !result.error && result.content === "__OPEN_PERMISSION_DIALOG__";
            if (isPermDialogMarker) {
              await handleOpenPermissionDialog(activeId);
            }

            const toolMsgId = pendingApprovalMsgId || String(nextMsgId++);
            pendingApprovalMsgId = null;
            const toolMsg: Message = {
              id: toolMsgId,
              role: "tool",
              content: result.error ? "" : isPermDialogMarker ? "" : result.content,
              toolCallId: call.id,
              toolCallError: result.error,
              timestamp: Date.now(),
              pendingApproval: false,
              sender: result.sender,
            };
            updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => {
              const idx = msgs.findIndex((m) => m.id === toolMsgId);
              if (idx >= 0) {
                const copy = [...msgs];
                copy[idx] = toolMsg;
                return copy;
              }
              return [...msgs, toolMsg];
            }));

            allToolResults.push({
              role: "user" as const,
              content: isPermDialogMarker
                ? `[修正重试结果 - ${call.id}]\n权限设置对话框已打开。`
                : `[修正重试结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
            });

            if (result.error) {
              allRetrySucceeded = false;
            }

            if (retryCalls.length > 1) await new Promise((r) => setTimeout(r, 300));
          }

          // 本轮全部成功则退出重试循环
          if (allRetrySucceeded) {
            unresolvedErrors = false;
          }
        }

        // 更新计划卡片显示重试完成状态
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) =>
            msg.id === planMsgId
              ? { ...msg, content: `${planExecSummary}\n\n${unresolvedErrors ? "⚠️" : "✅"} **错误修正结束**（共 ${retryRound} 轮）` }
              : msg,
          ),
        ));
      }

      // ── "禁止新工具调用"强制指令 ──
      allToolResults.push({
        role: "user" as const,
        content: `[系统强制指令] 所有任务计划步骤已全部执行完毕。以下是你必须遵守的最重要规则：

1. **禁止输出任何 <tool_call> 或 <task_plan> 标签**——所有工具调用已经完成。
2. **基于上述所有工具执行结果，直接生成最终回复给用户**。
3. 无论是否有步骤执行错误，基于已有信息尽力回答即可，**不要再次尝试重新调用工具**。
4. **不要自我质疑**——"也许搜索词不对"、"要不要再看看其他目录"这类犹豫已被计划系统处理完毕。
5. **不要输出"让我看看"、"我来查一下"等空头承诺**——工具已经在计划中执行过了。
6. **不要重复思考过程**——直接给出结论。

记住：所有需要的工具都已在任务计划中执行完毕。你的任务是根据这些结果生成最终、完整的答案，而不是继续搜索或查看。如果结果中有冲突或不明确之处，如实告诉用户你的判断。`,
      });

      await new Promise((r) => setTimeout(r, 200));
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: FINAL REPLY（流式，基于所有结果生成最终回复）
    // ═══════════════════════════════════════════════════════════
    const assistantId = String(nextMsgId++);
    streamingMsgIdRef.current = assistantId;
    const placeholder: Message = { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streaming: true };
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, placeholder]));
    let fullContent = "";
    let fullReasoning = "";
    let reasoningEnded = false;
    let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    const finalApiMessages = [...initialApiMessages, ...allToolResults];

    try {
      for await (const chunk of streamChatCompletion(selectedModel!, finalApiMessages, abortController.signal)) {
        fullContent += chunk.content;
        fullReasoning += (chunk.reasoningContent || "");
        if (chunk.usage) lastUsage = chunk.usage;
        if (!reasoningEnded && fullReasoning && chunk.content) reasoningEnded = true;
        const displayContent = stripToolCalls(fullContent);
        const hasToolCall = fullContent.includes("<tool_call") || fullContent.includes("<task_plan");
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: displayContent, toolCallInProgress: hasToolCall, reasoningContent: fullReasoning, ...(reasoningEnded ? { reasoningEndTime: Date.now() } : {}) }
              : msg,
          ),
        ));
      }
    } catch (streamErr) {
      const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      const displayContent = errMsg.startsWith("[API_ERROR:")
        ? errMsg
        : `**（上下文续传中断，工具结果已获取）**\n\n**实际错误:** ${errMsg}`;
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) => msg.id === assistantId ? { ...msg, content: displayContent, streaming: false } : msg),
      ));
      return;
    }

    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
      msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false, usage: lastUsage } : msg),
    ));

    // 最终回复中的 tool_call 检测（仅当无计划时的降级处理）
    const contentCalls = parseToolCalls(fullContent);
    const reasoningCalls = parseToolCalls(fullReasoning);
    const seen = new Set<string>();
    const toolCalls: ToolCall[] = [];
    for (const c of [...contentCalls, ...reasoningCalls]) {
      if (!seen.has(c.id)) { seen.add(c.id); toolCalls.push(c); }
    }

    if (toolCalls.length > 0 && !hasPlan) {
      // 无计划时的降级：执行 tool_call
      const cleanContent = stripToolCalls(fullContent);
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId ? { ...msg, content: cleanContent, toolCallInProgress: true } : msg,
        ),
      ));

      for (const call of toolCalls) {
        if (abortController.signal.aborted) break;
        const phase4Permit = async () => await checkPermission(call.id, activeId);
        const result = await executeToolCall(call, abortController.signal, selectedModel, phase4Permit);
        const isPermDialogMarker = !result.error && result.content === "__OPEN_PERMISSION_DIALOG__";
        if (isPermDialogMarker) {
          await handleOpenPermissionDialog(activeId);
        }
        const toolMsgId = pendingApprovalMsgId || String(nextMsgId++);
        pendingApprovalMsgId = null;
        const toolMsg: Message = {
          id: toolMsgId,
          role: "tool",
          content: result.error ? "" : isPermDialogMarker ? "" : result.content,
          toolCallId: call.id,
          toolCallError: result.error,
          timestamp: Date.now(),
          pendingApproval: false,
          sender: result.sender,
        };
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => {
          const idx = msgs.findIndex((m) => m.id === toolMsgId);
          if (idx >= 0) {
            const copy = [...msgs];
            copy[idx] = toolMsg;
            return copy;
          }
          return [...msgs, toolMsg];
        }));
        if (toolCalls.length > 1) await new Promise((r) => setTimeout(r, 500));
      }

      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId ? { ...msg, toolCallInProgress: false } : msg,
        ),
      ));
    } else if (toolCalls.length > 0) {
      // 有计划但最终回复仍有 tool_call（不应发生，作为安全清理）
      const cleanContent = stripToolCalls(fullContent);
      if (cleanContent !== fullContent) {
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
          msgs.map((msg) => msg.id === assistantId ? { ...msg, content: cleanContent } : msg),
        ));
      }
    }
  }

  // ── 自动标题生成 ─────────────────────────────────

  async function generateConversationTitle(
    model: ModelConfig,
    userContent: string,
    assistantContent: string,
    convId: string,
  ) {
    const titlePrompt = [
      '根据以下对话内容，用3-6个字生成本次对话的简洁标题（不要使用引号或多余文字，仅返回标题本身）：',
      '',
      '用户：' + userContent.slice(0, 500),
      '助手：' + assistantContent.slice(0, 500),
    ].join('\n');
    const messages = [{ role: 'user' as const, content: titlePrompt }];
    try {
      let fullTitle = '';
      for await (const chunk of streamChatCompletion(model, messages)) {
        fullTitle += chunk.content;
      }
      const trimmed = fullTitle.replace(/[""""']/g, '').trim();
      if (trimmed) {
        updateConv(convId, (c) => ({
          ...c,
          title: trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed,
          autoTitleDone: true,
          updatedAt: Date.now(),
        }));
      } else {
        updateConv(convId, (c) => ({ ...c, autoTitleDone: true, updatedAt: Date.now() }));
      }
    } catch {
      updateConv(convId, (c) => ({ ...c, autoTitleDone: true, updatedAt: Date.now() }));
    }
    setTimeout(() => {
      flushConvs(conversationsRef.current, sessionPath);
    }, 0);
  }

  // ── handleSend 入口 ─────────────────────────────

  const handleSend = useCallback(
    async (text: string, sendMode?: Mode, files?: FileAttachment[]) => {
      // 通过父组件传入 / 闭包获取 activeId
      const getActiveId = (): string | null => {
        // 从 conversations 推断最大 ID？不，用传入的方式。
        // 实际上 handleSend 需要 activeId 来确定发送目标。
        // 由于 activeId 不在 hook 的 props 中，我们通过闭包获取。
        return null; // 占位，实际上是通过 params 传入
      };

      // 由于 activeId 的动态性，handleSend 需要在组件中包装
      // 此处提供核心逻辑，由组件侧传入 activeId
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedModel, updateConv, mode, conversationsRef, isStreaming],
  );

  // ── handleStop ──────────────────────────────────

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  // ── 压缩 ─────────────────────────────────────────

  const handleToggleCompression = useCallback(() => {
    setCompressionEnabled((v) => !v);
  }, []);

  const handleCompressNow = useCallback(async (activeId: string | null) => {
    if (!activeId || !selectedModel || isCompressing) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const targetMsgs = conv.memoryMessages ?? conv.messages;
    if (targetMsgs.length < MIN_MESSAGES_FOR_COMPRESSION) return;
    setIsCompressing(true);
    try {
      const result = await compressConversation(targetMsgs, selectedModel);
      if (result.summary) {
        updateConv(activeId, (c) => ({
          ...c,
          memoryMessages: result.messages,
          updatedAt: Date.now(),
        }));
      }
    } catch {
      // silent
    } finally {
      setIsCompressing(false);
    }
  }, [selectedModel, conversations, updateConv, isCompressing]);

  // ── 核心发送逻辑（供组件调用） ──────────────────

  const executeSend = useCallback(
    async (
      text: string,
      activeId: string,
      sendMode?: Mode,
      files?: FileAttachment[],
    ) => {
      if (!activeId || !selectedModel) return;
      const currentMode = sendMode ?? mode;

      // ── 斜杠命令拦截 ──
      let commandResult: CommandResult | null = null;
      let skipUserMsgDisplay = false;
      let frameworkMsg = false;
      const parsedCmd = parseCommand(text);
      if (parsedCmd) {
        const command = getCommand(parsedCmd.name);
        if (command) {
          let result: CommandResult;
          try {
            result = await command.handler(parsedCmd.args, {
              activeId,
              updateConv,
              withMsgUpdate,
              conversationsRef,
            });
          } catch (err) {
            const errMsg: Message = {
              id: String(nextMsgId++),
              role: "system",
              content: `[命令执行错误] 命令 /${parsedCmd.name} 执行失败：${err instanceof Error ? err.message : String(err)}`,
              timestamp: Date.now(),
            };
            updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, errMsg]));
            flushConvs(conversationsRef.current, sessionPath);
            return;
          }
          commandResult = result;
          if (result.handled) {
            if (result.message) {
              // 命令有错误提示 → 显示为系统消息
              const errMsg: Message = {
                id: String(nextMsgId++),
                role: "system",
                content: result.message,
                timestamp: Date.now(),
              };
              updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, errMsg]));
              flushConvs(conversationsRef.current, sessionPath);
              return;
            }
            // 隐式消息 → 继续 LLM 流程但不显示用户消息
            if (result.implicitUserMessage) {
              skipUserMsgDisplay = true;
              text = result.implicitUserMessage;
            } else if (result.continueAsUserMessage) {
              // 显式消息 → 继续 LLM 流程，以框架账号显示
              text = result.continueAsUserMessage;
              frameworkMsg = true;
            } else {
              // 无任何消息 → 静默成功，不触发 LLM
              flushConvs(conversationsRef.current, sessionPath);
              return;
            }
          }
        }
        if (!commandResult) {
          // 未知命令 → 以框架账号显示提示消息
          const unknownMsg: Message = {
            id: String(nextMsgId++),
            role: "system",
            content: `未知命令：/${parsedCmd.name}。输入 /vpc <数值> 进行虚拟参数校准。`,
            timestamp: Date.now(),
            sender: "framework",
          };
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, unknownMsg]));
          flushConvs(conversationsRef.current, sessionPath);
          return;
        }
        if (!commandResult.continueAsUserMessage && !commandResult.implicitUserMessage) {
          // 命令已处理但不需要 LLM 回复 → 静默返回
          flushConvs(conversationsRef.current, sessionPath);
          return;
        }
      }

      if (abortRef.current) abortRef.current.abort();
      const userMsg: Message = {
        id: String(nextMsgId++),
        role: "user",
        content: text,
        timestamp: Date.now(),
        files,
        sender: skipUserMsgDisplay ? "framework" : (frameworkMsg ? "framework" : undefined),
      };

      const currentConv = conversations.find((c) => c.id === activeId);
      let prevMessages = currentConv?.memoryMessages ?? currentConv?.messages ?? [];

      // 注入命令返回的额外消息（如校准消息），确保 buildApiMessages 能读取
      if (commandResult?.messagesToInject && commandResult.messagesToInject.length > 0) {
        prevMessages = [...commandResult.messagesToInject, ...prevMessages];
      }

      const needsAutoTitle = currentConv
        && currentConv.messages.length === 0
        && !currentConv.autoTitleDone;

      // 重置本轮权限覆盖状态（仅清除 round 范围，session 范围跨多轮保留）
      if (permissionOverrideRef.current?.scope === "round") {
        permissionOverrideRef.current = null;
      }

      setIsStreaming(true);
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        if (currentMode === "Agent") {
          await handleAgentSend(userMsg, prevMessages, currentMode, abortController, activeId, skipUserMsgDisplay);
        } else {
          await handleChatSend(userMsg, prevMessages, currentMode, abortController, activeId, skipUserMsgDisplay);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          const lastStreaming = streamingMsgIdRef.current;
          if (lastStreaming) {
            updateConv(activeId, (c) => ({
              ...c,
              messages: c.messages.map((msg) => msg.id === lastStreaming ? { ...msg, streaming: false } : msg),
              updatedAt: Date.now(),
            }));
          }
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const lastStreaming = streamingMsgIdRef.current;
          if (lastStreaming) {
            const displayContent = errorMsg.startsWith("[API_ERROR:")
              ? errorMsg
              : `**Error:** ${errorMsg}`;
            updateConv(activeId, (c) => ({
              ...c,
              messages: c.messages.map((msg) =>
                msg.id === lastStreaming ? { ...msg, content: displayContent, streaming: false } : msg,
              ),
              updatedAt: Date.now(),
            }));
          }
        }
      } finally {
        const completedNormally = !abortController.signal.aborted;
        setIsStreaming(false);
        streamingMsgIdRef.current = null;
        abortRef.current = null;
        setTimeout(() => {
          flushConvs(conversationsRef.current, sessionPath);
        }, 0);

        if (completedNormally) {
          playNotificationSound();
          sendNotification({ title: "会话任务已完成。", body: "" });
        }

        if (needsAutoTitle && selectedModel) {
          setTimeout(() => {
            const conv = conversationsRef.current.find((c) => c.id === activeId);
            if (conv) {
              const assistantMsgs = conv.messages.filter((m) => m.role === 'assistant');
              const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
              if (lastAssistant && lastAssistant.content) {
                generateConversationTitle(selectedModel, text, lastAssistant.content, activeId);
              }
            }
          }, 0);
        }
      }
    },
    // Note: conversations 和 selectedModel 用 ref 在内部读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedModel, conversations, updateConv, mode, flushConvs, sessionPath, conversationsRef, preferredLanguage, developerMode, panelMode, workspacePath, workMode, locale],
  );

  return {
    isStreaming,
    setIsStreaming,
    abortRef,
    streamingMsgIdRef,
    handleSend: executeSend,
    handleStop,
    compressionEnabled,
    setCompressionEnabled,
    isCompressing,
    handleToggleCompression,
    handleCompressNow,
    resetPermissionRefs,
    dragOver,
    pendingFiles,
    handleRemovePendingFile,
    clearPendingFiles,
  };
}

/** 导出 nextMsgId 供外部使用（组件中需保持 ID 唯一） */
export function getNextMsgId(): number {
  return nextMsgId;
}

export function setNextMsgId(id: number): void {
  if (id >= nextMsgId) nextMsgId = id + 1;
}
