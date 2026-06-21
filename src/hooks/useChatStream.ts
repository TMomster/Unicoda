/**
 * 共享聊天流式处理 Hook
 *
 * 抽取 App.tsx 和 YoloPanel.tsx 中高度重复的流式调用、工具调用、标题生成、
 * 压缩、拖拽上传等逻辑。
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, FileAttachment, Message, Mode, ModelConfig, PanelMode, ToolDebugEntry } from "../types";
import { streamChatCompletion } from "../services/modelApi";
import { buildAgentSystemPrompt, buildPlannerSystemPrompt, parseToolCalls, stripToolCalls, executeToolCall, type ToolCall, type ToolResult } from "../services/agentEngine";
import { parseTaskPlan, executeTaskPlan, type TaskPlan } from "../services/taskPlanner";
import { compressConversation, MIN_MESSAGES_FOR_COMPRESSION, hasCompressionSummary } from "../services/conversationCompression";
import { playNotificationSound } from "../utils/notificationSound";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let nextMsgId = 1;

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
    const spFirst100 = sp.replace(/\n/g, "\\n").slice(0, 200);
    console.log(`[buildApiMessages] system prompt (first 200 chars):`, spFirst100);
    const hasLangRule = sp.includes("【严格语言指令") || sp.includes("【STRICT LANGUAGE RULE") || sp.includes("【STRENGE SPRACHREGEL") || sp.includes("【厳格な言語ルール") || sp.includes("【RÈGLE LINGUISTIQUE STRICTE") || sp.includes("【REGLA DE IDIOMA ESTRICTA");
    console.log(`[buildApiMessages] system prompt contains language rule:`, hasLangRule);
    const kbExtra = prevMessages.find(
      (m) => m.role === "assistant" && (m.content.startsWith("[对话历史摘要]") || m.content.startsWith("[Conversation History Summary]")),
    );
    const systemContent = sp + (kbExtra ? `\n\n## 前期对话摘要\n\n${kbExtra.content}` : "");
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
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));
    let allToolResults: { role: string; content: string }[] = [];
    let complete = false;
    let toolCallRound = 0;

    while (!complete) {
      const assistantId = String(nextMsgId++);
      streamingMsgIdRef.current = assistantId;
      const placeholder: Message = { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streaming: true };
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, placeholder]));
      let fullContent = "";
      let fullReasoning = "";
      let reasoningEnded = false;
      const apiMessages = [...initialApiMessages, ...allToolResults];

      try {
        for await (const chunk of streamChatCompletion(selectedModel!, apiMessages, abortController.signal)) {
          fullContent += chunk.content;
          fullReasoning += (chunk.reasoningContent || "");
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
        msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false } : msg),
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
          const result = await executeToolCall(call, abortController.signal, selectedModel);
          const durationMs = Math.round(performance.now() - startTime);
          toolResults.push({ result, durationMs });

          const toolMsg: Message = {
            id: String(nextMsgId++),
            role: "tool",
            content: result.content,
            toolCallId: call.id,
            toolCallError: result.error,
            timestamp: Date.now(),
          };
          updateConv(activeId, (c) => ({ ...c, messages: [...c.messages, toolMsg], updatedAt: Date.now() }));

          allToolResults.push({
            role: "user" as const,
            content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
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
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, userMsg]));

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
      ? `🎯 **目标**：${taskPlan.intent}\n💡 **分析**：${taskPlan.feasibility}\n\n📋 **执行步骤**：${taskPlan.steps.length > 0 ? "" : "（无需工具，直接回复）"}\n${taskPlan.steps.map((s, i) => `  **步骤 ${i + 1}**：${s.description}（\`${s.tool}\`）`).join("\n")}`
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

      const stepResults = await executeTaskPlan(taskPlan, abortController.signal, selectedModel);

      let planExecSummary = planCardContent + "\n\n";
      for (let i = 0; i < stepResults.length; i++) {
        const sr = stepResults[i];
        const statusIcon = sr.result.error ? "❌" : "✅";
        planExecSummary += `${statusIcon} **步骤 ${i + 1}**：${taskPlan.steps[i]?.description}（${sr.durationMs}ms）\n`;
      }
      updateConv(activeId, (c) => withMsgUpdate(c, (msgs) =>
        msgs.map((msg) =>
          msg.id === planMsgId
            ? { ...msg, content: planExecSummary, toolCallResultCount: stepResults.length }
            : msg,
        ),
      ));

      for (let i = 0; i < stepResults.length; i++) {
        if (abortController.signal.aborted) break;
        const sr = stepResults[i];
        const toolMsg: Message = {
          id: String(nextMsgId++),
          role: "tool",
          content: sr.result.error ? "" : sr.result.content,
          toolCallId: `${taskPlan.steps[i]?.id || "plan-step-" + i}`,
          toolCallError: sr.result.error,
          timestamp: Date.now(),
        };
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, toolMsg]));

        allToolResults.push({
          role: "user" as const,
          content: `[任务执行结果 - ${taskPlan.steps[i]?.description || "步骤" + (i + 1)} (工具: ${taskPlan.steps[i]?.tool})]\n${sr.result.error ? `执行错误：${sr.result.error}` : sr.result.content}`,
        });
      }

      allToolResults.push({
        role: "user" as const,
        content: `[系统强制指令] 所有任务计划步骤已全部执行完毕。以下是你必须遵守的最重要规则：

1. **禁止输出任何 <tool_call> 或 <task_plan> 标签**——所有工具调用已经完成。
2. **基于上述所有工具执行结果，直接生成最终回复给用户**。
3. 如果你的某个步骤返回为空或错误，基于已有信息尽力回答即可，**不要尝试重新调用**。
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
    const finalApiMessages = [...initialApiMessages, ...allToolResults];

    try {
      for await (const chunk of streamChatCompletion(selectedModel!, finalApiMessages, abortController.signal)) {
        fullContent += chunk.content;
        fullReasoning += (chunk.reasoningContent || "");
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
      msgs.map((msg) => msg.id === assistantId ? { ...msg, streaming: false } : msg),
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
        const result = await executeToolCall(call, abortController.signal, selectedModel);
        const toolMsg: Message = {
          id: String(nextMsgId++),
          role: "tool",
          content: result.content,
          toolCallId: call.id,
          toolCallError: result.error,
          timestamp: Date.now(),
        };
        updateConv(activeId, (c) => withMsgUpdate(c, (msgs) => [...msgs, toolMsg]));
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

      if (abortRef.current) abortRef.current.abort();

      const userMsg: Message = {
        id: String(nextMsgId++),
        role: "user",
        content: text,
        timestamp: Date.now(),
        files,
      };

      const currentConv = conversations.find((c) => c.id === activeId);
      const prevMessages = currentConv?.memoryMessages ?? currentConv?.messages ?? [];

      const needsAutoTitle = currentConv
        && currentConv.messages.length === 0
        && !currentConv.autoTitleDone;

      setIsStreaming(true);
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        if (currentMode === "Agent") {
          await handleAgentSend(userMsg, prevMessages, currentMode, abortController, activeId);
        } else {
          await handleChatSend(userMsg, prevMessages, currentMode, abortController, activeId);
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
