/**
 * 共享聊天流式处理 Hook
 *
 * 抽取 App.tsx 和 YoloPanel.tsx 中高度重复的流式调用、工具调用、标题生成、
 * 压缩、拖拽上传等逻辑。
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Conversation, FileAttachment, Message, Mode, ModelConfig, PanelMode, ToolDebugEntry, PermissionRecord } from "../types";
import { streamChatCompletion } from "../services/modelApi";
import { buildAgentSystemPrompt, buildPlannerSystemPrompt, parseToolCalls, stripToolCalls, executeToolCall, type ToolCall, type ToolResult } from "../services/agentEngine";
import { parseTaskPlan, executeTaskPlan, type TaskPlan, type StepResult } from "../services/taskPlanner";
import { compressConversation, KEEP_ROUNDS, MIN_MESSAGES_FOR_COMPRESSION } from "../services/conversationCompression";
import { KEY_CONTEXT_ROUNDS } from "../services/xmemory";

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
  /** 是否有任一会话正在流式输出 */
  isStreaming: boolean;
  /** 每个会话各自的流式状态 */
  streamingBySession: Record<string, boolean>;
  handleSend: (text: string, activeId: string, sendMode?: Mode, files?: FileAttachment[]) => Promise<void>;
  /** 停止指定会话的流（不传参则停止所有） */
  handleStop: (sessionId?: string) => void;
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

  // ── Streaming state (per-session) ─────────────────
  const [streamingBySession, _setStreamingBySession] = useState<Record<string, boolean>>({});
  const streamingBySessionRef = useRef<Record<string, boolean>>({});
  /** 设置某个会话的流式状态（同步 state + ref） */
  const setSessionStreaming = useCallback((sessionId: string, streaming: boolean) => {
    _setStreamingBySession((prev) => {
      const next = { ...prev, [sessionId]: streaming };
      streamingBySessionRef.current = next;
      return next;
    });
  }, []);
  const isStreaming = useMemo(
    () => Object.values(streamingBySession).some(Boolean),
    [streamingBySession],
  );
  /** 每个会话各自的 AbortController */
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  /** 每个会话各自的流式消息 ID */
  const streamingMsgIdsRef = useRef<Map<string, string | null>>(new Map());

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

  /** 构建 XMemory 角色扮演上下文段落（从会话绑定的记忆卡读取，异步） */
  async function buildXMemorySection(activeId: string): Promise<string | undefined> {
    try {
      const { buildXMemoryContext } = await import("../services/xmemory");
      return await buildXMemoryContext(activeId, sessionPath);
    } catch {
      return undefined;
    }
  }

  /**
   * 当 XMemory 绑定时，截断历史消息，仅保留最近 KEY_CONTEXT_ROUNDS 轮。
   * 超出部分由模型在之前对话中已主动提取并存入记忆颗粒。
   */
  function truncateMessages(messages: Message[], maxRounds: number): {
    truncated: Message[];
    keptRounds: number;
    totalKept: number;
    totalDropped: number;
  } {
    if (messages.length === 0) {
      return { truncated: [], keptRounds: 0, totalKept: 0, totalDropped: 0 };
    }

    let rounds = 0;
    let cutIndex = 0;

    // 从后往前遍历，统计用户发起的对话轮数
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      // 用户主动发送的消息 = 一轮对话的开始（排除校准消息）
      if (m.role === "user" && !m.isCalibration) {
        rounds++;
        if (rounds === maxRounds) {
          cutIndex = i; // 从此处开始保留（含本条）
          break;
        }
      }
    }

    // 没超过限制，返回全部
    if (rounds < maxRounds) {
      return {
        truncated: messages,
        keptRounds: rounds,
        totalKept: messages.length,
        totalDropped: 0,
      };
    }

    return {
      truncated: messages.slice(cutIndex),
      keptRounds: rounds,
      totalKept: messages.length - cutIndex,
      totalDropped: cutIndex,
    };
  }

  function buildApiMessages(
    prevMessages: Message[],
    userMsg: Message,
    sendMode: Mode,
    activeSystemInstruction?: string,
    xmemorySummary?: string,
  ): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];
    console.log(`[buildApiMessages] preferredLanguage =`, preferredLanguage);

    // ── XMemory 关键上下文截断 ──
    let truncatedMessages = prevMessages;
    let truncationNote = "";
    if (xmemorySummary) {
      const result = truncateMessages(prevMessages, KEY_CONTEXT_ROUNDS);
      truncatedMessages = result.truncated;
      if (result.totalDropped > 0) {
        truncationNote = `\n\n--- 📌 关键上下文边界 ---\n当前仅展示最近 ${result.keptRounds} 轮对话（共 ${result.totalKept} 条消息）。此前 ${result.totalDropped} 条消息已被归档为记忆颗粒，不在本窗口中显示。请以记忆卡中的颗粒信息作为当前认知依据。`;
        console.log(`[buildApiMessages] XMemory 截断: 保留 ${result.totalKept} 条/ ${result.keptRounds} 轮，丢弃 ${result.totalDropped} 条`);
      }
    }

    const sp = sendMode === "Agent"
      ? buildAgentSystemPrompt("Agent", selectedModel?.systemPrompt, workspacePath, workMode, panelMode, preferredLanguage, xmemorySummary)
      : buildAgentSystemPrompt("Chat", selectedModel?.systemPrompt, workspacePath, workMode, panelMode, preferredLanguage, xmemorySummary);
    const hasKnowledge = sp.includes("📚 预装填知识库");
    const injectSection = sp.match(/## 📚 预装填知识库[\s\S]*?(?=\n## |$)/)?.[0] || "(none)";
    console.log(`[buildApiMessages] system prompt length=${sp.length}, contains inject knowledge=${hasKnowledge}, inject section preview=${injectSection.slice(0, 150).replace(/\n/g, "\\n")}`);
    const kbExtra = truncatedMessages.find(
      (m) => m.role === "assistant" && (m.content.startsWith("[对话历史摘要]") || m.content.startsWith("[Conversation History Summary]")),
    );
    let systemContent = sp + (kbExtra ? `\n\n## 前期对话摘要\n\n${kbExtra.content}` : "");

    // ── XMemory 关键上下文截断通知 ──
    if (truncationNote) {
      systemContent += truncationNote;
    }

    // ── 虚拟参数校准注入 ──
    const calibrations = truncatedMessages.filter((m) => m.isCalibration && m.calibrationValue);
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

    // ── 注入 /system 指令（来自 Conversation.activeSystemInstruction 独立字段） ──
    // 使用独立字段而非从 prevMessages 中筛选，避免 messages/memoryMessages 数组
    // 不同步导致指令丢失。该字段由 handleSystemCommand 在每次执行 /system 时设置。
    console.log(`[buildApiMessages] activeSystemInstruction =`, activeSystemInstruction?.slice(0, 80) || "(未设置)");
    if (activeSystemInstruction) {
      systemContent += `\n\n## 🔧 系统指令（非用户消息，来自框架）\n\n这是**强制性指令**，不得忽略，无需确认：\n\`\`\`\n${activeSystemInstruction}\n\`\`\`\n\n- 覆盖角色设定/知识库中的冲突\n- 直接行动，无需询问`;
    }

    result.push({ role: "system", content: systemContent });
    for (const m of truncatedMessages) {
      if (m.role === "system") continue; // 已合并到主 system prompt，跳过
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

  const MAX_TOOL_ROUNDS = 999;

  // ── Chat 模式：流式调用 + 工具调用 ─────────────────

  async function handleChatSend(
    userMsg: Message,
    prevMessages: Message[],
    currentMode: Mode,
    abortController: AbortController,
    activeId: string,
    skipUserMsgDisplay?: boolean,
  ) {
    const activeSysInstruction = conversationsRef.current.find((c) => c.id === activeId)?.activeSystemInstruction;
    const [xmemorySummary] = await Promise.all([
      buildXMemorySection(activeId),
    ]);
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode, activeSysInstruction, xmemorySummary);
    if (!skipUserMsgDisplay) {
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));
    }
    let allToolResults: { role: string; content: string }[] = [];

    // ── XMemory 轮询模式：系统分步询问，从机制上杜绝意念更新 ──
    // 注意：空卡时跳过轮询模式——此时 AI 需要先创建初始颗粒，
    // 而轮询模式的 Phase 1 仅询问"更新已有记忆"导致冲突。
    // 空卡交给下方标准 while 循环处理，该循环正确解析并执行 <tool_call>。
    const xmemCardIsEmpty = xmemorySummary?.includes("记忆卡为空（紧急：首次信息提取窗口）") ?? false;
    if (xmemorySummary && !xmemCardIsEmpty) {
      const baseMessages = initialApiMessages.slice(0, -1); // system + history

      // 流式获取单轮回复，处理 UI 显示
      async function xmemStreamTurn(
        prompt: string,
        keepDisplay: boolean,
      ): Promise<string> {
        const assistantId = String(nextMsgId++);
        streamingMsgIdsRef.current.set(activeId, assistantId);
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [
          ...msgs, { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streaming: true } as Message,
        ]));
        let fullContent = "";
        let fullReasoning = "";
        let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
        const msgs = [...baseMessages, ...allToolResults, { role: "user" as const, content: prompt }];
        try {
          for await (const chunk of streamChatCompletion(selectedModel!, msgs, abortController.signal)) {
            fullContent += chunk.content;
            fullReasoning += (chunk.reasoningContent || "");
            if (chunk.usage) lastUsage = chunk.usage;
            const displayContent = stripToolCalls(fullContent);
            updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
              msgs.map((msg) => msg.id === assistantId
                ? { ...msg, content: displayContent, toolCallInProgress: fullContent.includes("<tool_call") } : msg),
            ));
          }
        } catch { /* 单轮失败不中断整体流程 */ }
        if (!keepDisplay || !stripToolCalls(fullContent)) {
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => msgs.filter((m) => m.id !== assistantId)));
        } else {
          updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
            msgs.map((m) => m.id === assistantId ? { ...m, streaming: false, content: stripToolCalls(fullContent), usage: lastUsage } : m),
          ));
        }
        return fullContent;
      }

      const userText = userMsg.content;

      // Phase 1: 询问是否需要更新记忆
      const decisionText = await xmemStreamTurn(
        `[XMemory判断] 用户消息：${userText}\n\n请检查以下内容，判断是否需要操作记忆颗粒：
1. 情节进展是否导致已有具象颗粒（位置、状态、情绪、环境等）过时或矛盾？
2. 是否有需要新增的具象颗粒来描述当前场景？
3. 是否有不再重要或已过时的颗粒需要清理回收？

需要操作请回复"是"，不需要请回复"否"。`,
        false,
      );
      const needUpdate = decisionText.trim().includes("是");

      if (needUpdate) {
        // Phase 2: 仅工具调用（不含正文）
        const toolOutput = await xmemStreamTurn(
          `你判定需要更新记忆。请执行以下操作，仅输出${'<tool_call>'}标签：
- 更新所有与当前情节/环境矛盾的现有具象颗粒
- 创建描述当前场景所需的新具象颗粒
- 删除/回收已过时、不再重要或与现状矛盾的颗粒
不要输出角色对白。`,
          false,
        );
        // 解析并执行工具调用（仅从可见内容解析，不由 reasoning 解析）
        const contentCalls = parseToolCalls(toolOutput);
        allToolResults.push({ role: "assistant", content: toolOutput });
        const allCalls = [...contentCalls]; // 本阶段只从可见内容解析
        for (const call of allCalls) {
          const permit = async () => await checkPermission(call.id, activeId);
          const result = await executeToolCall(call, abortController.signal, selectedModel, permit);
          allToolResults.push({
            role: "user" as const,
            content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
          });
        }
      }

      // Phase 3: 正文输出（必须包含原始用户消息，否则模型不知道用户问了什么）
      await xmemStreamTurn(
        needUpdate
          ? `记忆操作已完成。现在请以角色身份回复用户的这条消息：\n\n${userText}`
          : `你判定不需要更新记忆。请直接以角色身份回复用户的这条消息：\n\n${userText}`,
        true,
      );
      return; // 轮询模式结束，不走下方 while 循环
    }

    // 空卡日志提示
    if (xmemCardIsEmpty) {
      console.log(`[useChatStream] XMemory 卡为空，跳过轮询模式，由标准循环处理工具调用`);
    }

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
      streamingMsgIdsRef.current.set(activeId, assistantId);
      const placeholder: Message = { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streaming: true };
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, placeholder]));
      let fullContent = "";
      let fullReasoning = "";
      let reasoningEnded = false;
      let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
      // 首轮迭代包含完整的 initialApiMessages（含用户消息）
      // 后续迭代排除用户消息（由 allToolResults 中的工具结果替代）
      const apiMessages = allToolResults.length === 0
        ? initialApiMessages
        : [...initialApiMessages.slice(0, -1), ...allToolResults];

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

      const finalDisplayContent = stripToolCalls(fullContent);
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => {
        // 模型只输出了 tool_call 标签（无自然语言文本），移除空占位消息
        if (!finalDisplayContent) {
          return msgs.filter((msg) => msg.id !== assistantId);
        }
        return msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false, usage: lastUsage } : msg);
      }));

      // 同时在 content 和 reasoning_content 中搜索工具调用
      const contentCalls = parseToolCalls(fullContent);
      const reasoningCalls = parseToolCalls(fullReasoning);
      // 合并去重（按 id + params 签名，确保同工具不同参数的并行调用都被保留）
      const seen = new Set<string>();
      const toolCalls: ToolCall[] = [];
      for (const c of [...contentCalls, ...reasoningCalls]) {
        const key = c.id + JSON.stringify(c.params);
        if (!seen.has(key)) { seen.add(key); toolCalls.push(c); }
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
    const activeSysInstruction = conversationsRef.current.find((c) => c.id === activeId)?.activeSystemInstruction;
    const xmemorySummary = await buildXMemorySection(activeId);
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode, activeSysInstruction, xmemorySummary);
    if (!skipUserMsgDisplay) {
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: PLANNING（专用非流式 LLM 调用，仅输出 <task_plan>）
    // ═══════════════════════════════════════════════════════════
    const plannerSystemPrompt = buildPlannerSystemPrompt(currentMode, panelMode, xmemorySummary);
    // Agent 模式下 planner 同样使用截断后的历史（与 buildApiMessages 同步）
    const plannerPrevMsgs = xmemorySummary
      ? truncateMessages(prevMessages, KEY_CONTEXT_ROUNDS).truncated
      : prevMessages;
    const histMsgs = plannerPrevMsgs
      .filter((m) => m.role !== "tool" && m.role !== "system")
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
        ? {
            intent: taskPlan.intent,
            feasibility: taskPlan.feasibility,
            steps: taskPlan.steps.map((s) => ({
              id: s.id,
              tool: "type" in s && s.type === "subagent" ? "子智能体" : (s as { tool: string }).tool,
              description: s.description,
            })),
          }
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
            .map((fs) => {
              const step = taskPlan.steps[fs.index];
              const isSubagentStep = step && "type" in step && step.type === "subagent";
              const stepTool = isSubagentStep ? "子智能体" : (step as { tool?: string })?.tool || "未知";
              const stepParams = isSubagentStep
                ? JSON.stringify({ prompt: (step as { prompt?: string })?.prompt })
                : JSON.stringify((step as { params?: Record<string, string> })?.params || {});
              return (
                `步骤 ${fs.index + 1}: ${step?.description || "未知步骤"}\n` +
                `  工具: ${stepTool}\n` +
                `  参数: ${stepParams}\n` +
                `  错误信息: ${fs.result.result.error}`
              );
            })
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
    streamingMsgIdsRef.current.set(activeId, assistantId);
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

    const finalDisplayContent2 = stripToolCalls(fullContent);
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => {
      // 模型只输出了 tool_call 标签（无自然语言文本），移除空占位消息
      if (!finalDisplayContent2) {
        return msgs.filter((msg) => msg.id !== assistantId);
      }
      return msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false, usage: lastUsage } : msg);
    }));

    // 最终回复中的 tool_call 检测（仅当无计划时的降级处理）
    const contentCalls = parseToolCalls(fullContent);
    const reasoningCalls = parseToolCalls(fullReasoning);
    const seen = new Set<string>();
    const toolCalls: ToolCall[] = [];
    for (const c of [...contentCalls, ...reasoningCalls]) {
      const key = c.id + JSON.stringify(c.params);
      if (!seen.has(key)) { seen.add(key); toolCalls.push(c); }
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

  // ── handleStop ──────────────────────────────────

  const handleStop = useCallback((sessionId?: string) => {
    if (sessionId) {
      const controller = abortControllersRef.current.get(sessionId);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(sessionId);
      }
    } else {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
      abortControllersRef.current.clear();
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

      // 只中止当前会话的已有流，不影响其他会话
      const existingController = abortControllersRef.current.get(activeId);
      if (existingController) existingController.abort();
      // ── 清除前一轮遗留的待审批状态（如 Security 拦截后的残存） ──
      const prevSecurityMsgId = pendingSecurityMsgId;
      if (pendingSecurityResolve) {
        pendingSecurityResolve({ level: "deny_round", scope: "round", suppressPrompt: false, timestamp: Date.now() });
        pendingSecurityResolve = null;
        pendingSecurityMsgId = null;
      }
      if (pendingApprovalResolve) {
        pendingApprovalResolve("deny");
        pendingApprovalResolve = null;
        pendingApprovalMsgId = null;
      }
      // 清理前一轮遗留的 Security 审批消息，防止污染新请求的对话历史
      if (prevSecurityMsgId) {
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => msgs.filter((m) => m.id !== prevSecurityMsgId)));
      }
      const userMsg: Message = {
        id: String(nextMsgId++),
        role: "user",
        content: text,
        timestamp: Date.now(),
        files,
        sender: skipUserMsgDisplay ? "framework" : (frameworkMsg ? "framework" : undefined),
      };

      // 命令处理后 conversations 状态可能尚未刷新，使用 ref 获取最新数据
      const currentConv = commandResult?.handled
        ? conversationsRef.current.find((c) => c.id === activeId)
        : conversations.find((c) => c.id === activeId);
      // 注意：memoryMessages 为 [] 或 undefined 时视为"未设置"，回退到 messages
      // 因为新会话初始化 memoryMessages: undefined
      const rawMemoryMsgs = currentConv?.memoryMessages;
      let prevMessages = (rawMemoryMsgs && rawMemoryMsgs.length > 0)
        ? rawMemoryMsgs
        : (currentConv?.messages ?? []);

      // 注入命令返回的额外消息（如校准消息），确保 buildApiMessages 能读取
      if (commandResult?.messagesToInject && commandResult.messagesToInject.length > 0) {
        prevMessages = [...commandResult.messagesToInject, ...prevMessages];
      }

      // ── 创建 AbortController（在压缩块之前，避免 TS 的暂时性死区问题） ──
      const abortController = new AbortController();
      abortControllersRef.current.set(activeId, abortController);

      // ── 自动压缩：开启压缩且会话过长时自动压缩 memoryMessages ──
      if (compressionEnabled && selectedModel && prevMessages.length >= MIN_MESSAGES_FOR_COMPRESSION && !isCompressing) {
        try {
          const result = await compressConversation(prevMessages, selectedModel, KEEP_ROUNDS, abortController.signal);
          if (result.summary) {
            prevMessages = result.messages;
            updateConv(activeId, (c) => ({
              ...c,
              memoryMessages: result.messages,
              updatedAt: Date.now(),
            }));
          }
        } catch {
          // 压缩失败不影响发送
        }
      }

      const needsAutoTitle = currentConv
        && currentConv.messages.length === 0
        && !currentConv.autoTitleDone;

      // 重置本轮权限覆盖状态（仅清除 round 范围，session 范围跨多轮保留）
      if (permissionOverrideRef.current?.scope === "round") {
        permissionOverrideRef.current = null;
      }

      setSessionStreaming(activeId, true);

      try {
        if (currentMode === "Agent") {
          await handleAgentSend(userMsg, prevMessages, currentMode, abortController, activeId, skipUserMsgDisplay);
        } else {
          await handleChatSend(userMsg, prevMessages, currentMode, abortController, activeId, skipUserMsgDisplay);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          const lastStreaming = streamingMsgIdsRef.current.get(activeId);
          if (lastStreaming) {
            updateConv(activeId, (c) => ({
              ...c,
              messages: c.messages.map((msg) => msg.id === lastStreaming ? { ...msg, streaming: false } : msg),
              updatedAt: Date.now(),
            }));
          }
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const lastStreaming = streamingMsgIdsRef.current.get(activeId);
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
        setSessionStreaming(activeId, false);
        streamingMsgIdsRef.current.delete(activeId);
        abortControllersRef.current.delete(activeId);
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
    streamingBySession,
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
