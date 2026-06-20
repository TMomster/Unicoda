import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useState, useCallback, useRef, useEffect } from "react";
import type { Conversation, FileAttachment, Message, Mode, PanelMode, ModelConfig } from "./types";
import { useTheme, scaleToTransform } from "./contexts/ThemeContext";
import { useModels } from "./contexts/ModelContext";
import { ModelProvider } from "./contexts/ModelContext";
import { LockProvider } from "./contexts/LockContext";
import { SearchProvider } from "./contexts/SearchContext";
import { streamChatCompletion } from "./services/modelApi";
import { writeConfigFile, readConfigFile } from "./utils/configStorage";
import { playNotificationSound } from "./utils/notificationSound";
import { initBuiltinModules } from "./modules/registry";
import {
  buildAgentSystemPrompt,
  parseToolCalls,
  stripToolCalls,
  executeToolCall,
} from "./services/agentEngine";
import {
  compressConversation,
  MIN_MESSAGES_FOR_COMPRESSION,
} from "./services/conversationCompression";
import { useLock } from "./contexts/LockContext";
import LockOverlay from "./components/LockOverlay";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import InputBar from "./components/InputBar";
import TitleBar from "./components/TitleBar";
import SettingsPanel from "./components/SettingsPanel";
import ComponentsPanel from "./components/ComponentsPanel";
import YoloPanel from "./components/YoloPanel";
import PrintDialog from "./components/PrintDialog";
import FilePreviewPanel from "./components/FilePreviewPanel";

/** 将当前会话列表写入文件（仅流式完成后调用） */
function flushConversations(convs: Conversation[], path: string) {
  try {
    localStorage.setItem("unicoda-conversations", JSON.stringify(convs));
  } catch { /* ignore */ }
  writeConfigFile("unicoda-conversations", convs, path);
}

let nextConvId = 1;
let nextMsgId = 1;

const MIN_SIDEBAR = 200;

function makeConvTitle(existing: Conversation[], locale: string): string {
  const prefix = locale === "en-US" ? "New Session" : "新会话";
  const pattern = locale === "en-US" ? /^New Session-(\d+)$/ : /^新会话-(\d+)$/;
  const nums = new Set<number>();
  for (const c of existing) {
    const m = c.title.match(pattern);
    if (m) nums.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}-${n}`;
}

// ─── Inner component that has access to ModelProvider context ──────
function MainContent({ panelMode, setPanelMode }: { panelMode: PanelMode; setPanelMode: React.Dispatch<React.SetStateAction<PanelMode>> }) {
  const { scale, fontFamily, t, locale, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode, theme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem("unicoda-conversations");
      if (raw) {
        const loaded: Conversation[] = JSON.parse(raw);
        // 确保每个会话有有效 id
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
          if (c.messages) {
            for (const m of c.messages) {
              const midNum = parseInt(m.id, 10);
              if (midNum >= nextMsgId) nextMsgId = midNum + 1;
            }
          }
        }
        return loaded;
      }
    } catch { /* ignore */ }
    return [
      {
        id: String(nextConvId++),
        title: makeConvTitle([], locale),
        messages: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  });

  // 异步初始化：启动时从文件加载
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    readConfigFile<Conversation[]>("unicoda-conversations", [], sessionPath).then((loaded) => {
      if (loaded.length > 0) {
        setConversations(loaded);
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
          if (c.messages) {
            for (const m of c.messages) {
              const midNum = parseInt(m.id, 10);
              if (midNum >= nextMsgId) nextMsgId = midNum + 1;
            }
          }
        }
      }
    });
  }, [sessionPath]);

  // Ref 持有最新会话列表和路径，供 handleSend 完成后写文件
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const sessionPathRef = useRef(sessionPath);
  sessionPathRef.current = sessionPath;

  const [activeId, setActiveId] = useState<string>(conversations[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const sidebarWidthRef = useRef(280);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<"blur" | "fade" | "reveal">("blur");
  const [yoloEntryKey, setYoloEntryKey] = useState(0);

  const handleTogglePanel = useCallback(() => {
    if (isTransitioning) return;
    const target = panelMode === "Default" ? "Yolo" : "Default";

    // Phase 1: blur covers the screen (300ms CSS transition)
    setIsTransitioning(true);
    setTransitionPhase("blur");

    // Phase 2: old UI fades out behind blur (350ms)
    setTimeout(() => { setTransitionPhase("fade"); }, 350);

    // Phase 3: swap panel + new UI fades in + blur fades out
    setTimeout(() => {
      setPanelMode(target);
      setTransitionPhase("reveal");
      if (target === "Yolo") setYoloEntryKey((k) => k + 1);
    }, 700);

    // Phase 4: transition complete
    setTimeout(() => { setIsTransitioning(false); }, 1100);
  }, [isTransitioning, panelMode]);

  // ── Model + streaming state ─────────────────────────────────────
  const { models, selectedModelId } = useModels();
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  // Helper to update conversation messages
  const updateConv = useCallback(
    (id: string, updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? updater(c) : c)),
      );
    },
    [],
  );

  const handleCreate = useCallback(() => {
    const newId = String(nextConvId++);
    setConversations((prev) => {
      const conv: Conversation = {
        id: newId,
        title: makeConvTitle(prev, locale),
        messages: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return [...prev, conv];
    });
    setActiveId(newId);
  }, [locale]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleRename = useCallback(
    (id: string, title: string) => {
      updateConv(id, (c) => ({ ...c, title, updatedAt: Date.now() }));
    },
    [updateConv],
  );

  const handleTogglePin = useCallback(
    (id: string) => {
      updateConv(id, (c) => ({
        ...c,
        pinned: !c.pinned,
        updatedAt: Date.now(),
      }));
    },
    [updateConv],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = conversations.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(conversations, locale),
          messages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPath);
        setConversations(() => [fresh]);
      } else {
        flushConversations(next, sessionPath);
        setConversations(() => next);
      }
      if (activeId === id) {
        setActiveId(next.length === 0 ? String(nextConvId) : next[0].id);
      }
    },
    [activeId, conversations, locale, sessionPath],
  );

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const next = conversations.filter((c) => !idSet.has(c.id));
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(conversations, locale),
          messages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPath);
        setConversations(() => [fresh]);
      } else {
        flushConversations(next, sessionPath);
        setConversations(() => next);
      }
      if (ids.includes(activeId)) {
        setActiveId(next.length === 0 ? String(nextConvId) : next[0].id);
      }
    },
    [activeId, conversations, locale, sessionPath],
  );

  const handleBatchTogglePin = useCallback(
    (ids: string[], pin: boolean) => {
      const idSet = new Set(ids);
      const next = conversations.map((c) =>
        idSet.has(c.id) ? { ...c, pinned: pin, updatedAt: Date.now() } : c,
      );
      flushConversations(next, sessionPath);
      setConversations(() => next);
    },
    [conversations, sessionPath],
  );

  // ── Module system integration ──────────────────────────────
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const [mode, setMode] = useState<Mode>("Chat");

  // ── Drag-and-drop file upload (Tauri native) ───────
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
              if (content.is_image) continue; // 跳过图片（与 InputBar 一致）
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

  // ── Toast notifications ─────────────────────────────
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, key: Date.now() });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  const { isLocked } = useLock();
  useEffect(() => {
    initBuiltinModules();
    // 请求系统通知权限（通过 Tauri 插件注册 AppUserModelId）
    (async () => {
      if (!(await isPermissionGranted())) {
        await requestPermission();
      }
    })();
  }, []);

  // ── Compression state ────────────────────────────────────
  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // ── Send message + call model API ──────────────────────────────

  /** 构建 API 消息列表（含 system prompt + 知识库，所有模式都注入基础身份） */
  function buildApiMessages(
    prevMessages: Message[],
    userMsg: Message,
    sendMode: Mode,
  ): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];

    // 所有模式都注入 system prompt（Agent 含完整模组协议+场景判断，Chat 含精简模组协议）
    let systemPrompt: string;
    if (sendMode === "Agent") {
      systemPrompt = buildAgentSystemPrompt(sendMode, selectedModel?.systemPrompt);
    } else {
      // Chat 模式：基础身份 + 精简低敏感模组文档 + 知识库
      systemPrompt = buildAgentSystemPrompt("Chat", selectedModel?.systemPrompt);
    }

    // 追加压缩摘要
    const kbExtra = prevMessages.find(
      (m) => m.role === "assistant" && m.content.startsWith("[对话历史摘要]"),
    );
    const finalSystem =
      systemPrompt +
      (kbExtra
        ? `\n\n## 前期对话摘要\n\n以下是你与用户之前对话的摘要，请注意参考：\n${kbExtra.content}`
        : "");

    result.push({ role: "system", content: finalSystem });

    // 过滤掉压缩摘要消息（已注入 system prompt），加上用户消息
    // role="tool" 的消息转为 user 角色注入，让模型在跨轮次后仍能看到原始工具执行结果
    for (const m of prevMessages) {
      if (m.content.startsWith("[对话历史摘要]")) continue;
      if (m.role === "tool") {
        result.push({
          role: "user" as const,
          content: `[工具执行结果 - ${m.toolCallId || "unknown"}]\n${m.toolCallError ? `执行错误：${m.toolCallError}` : m.content}`,
        });
      } else {
        result.push({ role: m.role, content: m.content });
      }
    }
    // 合并文件内容到用户消息
    let finalContent = userMsg.content;
    if (userMsg.files && userMsg.files.length > 0) {
      const fileBlocks = userMsg.files.map((f) => `[文件: ${f.name}]\n${f.data}`);
      finalContent = fileBlocks.join("\n\n") + (finalContent ? "\n\n" + finalContent : "");
    }
    result.push({ role: userMsg.role, content: finalContent });
    return result;
  }

  const MAX_TOOL_ROUNDS = 5;

  /** Chat 模式：流式调用 → 可选 tool call（仅低敏感模组，最多 1 轮） */
  async function handleChatSend(
    userMsg: Message,
    prevMessages: Message[],
    currentMode: Mode,
    abortController: AbortController,
    activeId: string,
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);

    // 先添加 user 消息
    updateConv(activeId, (c) => ({
      ...c,
      messages: [...c.messages, userMsg],
      updatedAt: Date.now(),
    }));

    let allToolResults: { role: string; content: string }[] = [];
    let complete = false;
    let toolCallRound = 0;
    const MAX_CHAT_TOOL_ROUNDS = 5;

    while (!complete) {
      const assistantId = String(nextMsgId++);
      streamingMsgIdRef.current = assistantId;

      const placeholder: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      };

      updateConv(activeId, (c) => ({
        ...c,
        messages: [...c.messages, placeholder],
        updatedAt: Date.now(),
      }));

      let fullContent = "";
      let fullReasoning = "";
      let reasoningEnded = false;

      const apiMessages = [...initialApiMessages, ...allToolResults];

      for await (const chunk of streamChatCompletion(
        selectedModel!,
        apiMessages,
        abortController.signal,
      )) {
        fullContent += chunk.content;
        fullReasoning += chunk.reasoningContent;
        // 检测思考阶段结束：有 reasoning 积累后首次收到内容片段
        if (!reasoningEnded && fullReasoning && chunk.content) {
          reasoningEnded = true;
        }
        updateConv(activeId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, reasoningContent: fullReasoning, ...(reasoningEnded ? { reasoningEndTime: Date.now() } : {}) }
              : msg,
          ),
          updatedAt: Date.now(),
        }));
      }

      // 标记当前 assistant 消息完成
      updateConv(activeId, (c) => ({
        ...c,
        messages: c.messages.map((msg) =>
          msg.id === assistantId ? { ...msg, streaming: false } : msg,
        ),
        updatedAt: Date.now(),
      }));

      // 解析 tool call
      const toolCalls = parseToolCalls(fullContent);
      if (toolCalls.length === 0) {
        complete = true;
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent !== fullContent) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: cleanContent } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
      } else if (toolCallRound < MAX_CHAT_TOOL_ROUNDS) {
        // 先清理可见消息中的 <tool_call> 内容，避免 JSON 泄漏到 UI
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent !== fullContent) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: cleanContent } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
        toolCallRound++;

        // ── 开发者模式：在 assistant 消息上记录调试信息 ──
        if (developerMode) {
          const debugEntries: import("./types").ToolDebugEntry[] = toolCalls.map((c) => ({
            round: toolCallRound - 1,
            rawToolCall: JSON.stringify({ id: c.id, params: c.params }, null, 2),
          }));
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, toolDebugInfo: debugEntries } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }

        // 执行所有 tool call（记录耗时以便开发者模式展示）
        const MIN_TOOL_INTERVAL_MS = 500;
        const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const toolResults: { result: import("./services/agentEngine").ToolResult; durationMs: number }[] = [];
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

          updateConv(activeId, (c) => ({
            ...c,
            messages: [...c.messages, toolMsg],
            updatedAt: Date.now(),
          }));

          allToolResults.push({
            role: "user" as const,
            content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
          });

          // 工具调用间加间隔，避免被服务端判定为爬虫
          if (toolCalls.length > 1) {
            await delay(MIN_TOOL_INTERVAL_MS);
          }
        }

        // ── 开发者模式：更新 assistant 消息上的调试信息（填入执行结果） ──
        if (developerMode && toolResults.length > 0) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
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
            updatedAt: Date.now(),
          }));
        }
      } else {
        // 超过最大工具调用轮数，不再执行，但清除 <tool_call> 标签
        complete = true;
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: cleanContent } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
      }
    }
  }

  /** Agent 模式：流式调用 → 解析 tool call → 执行 → 再调 LLM */
  async function handleAgentSend(
    userMsg: Message,
    prevMessages: Message[],
    currentMode: Mode,
    abortController: AbortController,
    activeId: string,
  ) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);

    // 先添加 user 消息（占位符由每轮循环创建）
    updateConv(activeId, (c) => ({
      ...c,
      messages: [...c.messages, userMsg],
      updatedAt: Date.now(),
    }));

    let allToolResults: { role: string; content: string }[] = [];
    let conversionComplete = false;
    let toolRound = 0;

    while (!conversionComplete && toolRound < MAX_TOOL_ROUNDS) {
      const assistantId = String(nextMsgId++);
      streamingMsgIdRef.current = assistantId;

      const placeholder: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      };

      updateConv(activeId, (c) => ({
        ...c,
        messages: [...c.messages, placeholder],
        updatedAt: Date.now(),
      }));

      let fullContent = "";
      let fullReasoning = "";
      let reasoningEnded = false;

      const apiMessages = [...initialApiMessages, ...allToolResults];

      for await (const chunk of streamChatCompletion(
        selectedModel!,
        apiMessages,
        abortController.signal,
      )) {
        fullContent += chunk.content;
        fullReasoning += chunk.reasoningContent;
        // 检测思考阶段结束：有 reasoning 积累后首次收到内容片段
        if (!reasoningEnded && fullReasoning && chunk.content) {
          reasoningEnded = true;
        }
        updateConv(activeId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, reasoningContent: fullReasoning, ...(reasoningEnded ? { reasoningEndTime: Date.now() } : {}) }
              : msg,
          ),
          updatedAt: Date.now(),
        }));
      }

      // 标记当前 assistant 消息完成
      updateConv(activeId, (c) => ({
        ...c,
        messages: c.messages.map((msg) =>
          msg.id === assistantId ? { ...msg, streaming: false } : msg,
        ),
        updatedAt: Date.now(),
      }));

      toolRound++;

      // 解析 tool call
      const toolCalls = parseToolCalls(fullContent);
      if (toolCalls.length === 0) {
        // 无 tool call → 完成，清除 tool call 标签
        conversionComplete = true;
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent !== fullContent) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: cleanContent } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
      } else {
        // 先清理可见消息中的 <tool_call> 内容，避免 JSON 泄漏到 UI
        const cleanContent = stripToolCalls(fullContent);
        if (cleanContent !== fullContent) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: cleanContent } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
        // ── 开发者模式：在 assistant 消息上记录调试信息 ──
        if (developerMode) {
          const debugEntries: import("./types").ToolDebugEntry[] = toolCalls.map((c) => ({
            round: toolRound - 1,
            rawToolCall: JSON.stringify({ id: c.id, params: c.params }, null, 2),
          }));
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, toolDebugInfo: debugEntries } : msg,
            ),
            updatedAt: Date.now(),
          }));
        }

        // 执行所有 tool call（记录耗时以便开发者模式展示）
        const MIN_TOOL_INTERVAL_MS = 500;
        const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const toolResults: { result: import("./services/agentEngine").ToolResult; durationMs: number }[] = [];
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

          updateConv(activeId, (c) => ({
            ...c,
            messages: [...c.messages, toolMsg],
            updatedAt: Date.now(),
          }));

          allToolResults.push({
            role: "user" as const,
            content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
          });

          // 工具调用间加间隔，避免被服务端判定为爬虫
          if (toolCalls.length > 1) {
            await delay(MIN_TOOL_INTERVAL_MS);
          }
        }

        // ── 开发者模式：更新 assistant 消息上的调试信息（填入执行结果） ──
        if (developerMode && toolResults.length > 0) {
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
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
            updatedAt: Date.now(),
          }));
        }
      }
    }
  }

  // ── 自动标题生成 ─────────────────────────────────
  /** 使用模型根据对话内容生成一个简洁标题（仅在新会话首次对话后触发） */
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
        // 空结果时也标记已尝试过，避免重复触发
        updateConv(convId, (c) => ({ ...c, autoTitleDone: true, updatedAt: Date.now() }));
      }
    } catch {
      // 静默失败，不阻塞用户
      updateConv(convId, (c) => ({ ...c, autoTitleDone: true, updatedAt: Date.now() }));
    }
    // 持久化到文件（setTimeout 0 等待 state 更新后再读 ref）
    setTimeout(() => {
      flushConversations(conversationsRef.current, sessionPathRef.current);
    }, 0);
  }

  const handleSend = useCallback(
    async (text: string, sendMode?: Mode, files?: FileAttachment[]) => {
      if (!activeId || !selectedModel) return;
      const currentMode = sendMode ?? mode;

      // Cancel any existing streaming
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const userMsg: Message = {
        id: String(nextMsgId++),
        role: "user",
        content: text,
        timestamp: Date.now(),
        files,
      };

      const currentConv = conversations.find((c) => c.id === activeId);
      const prevMessages = currentConv?.messages ?? [];

      // 判断是否需要自动标题：全新会话（无消息）且未标记过
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
              messages: c.messages.map((msg) =>
                msg.id === lastStreaming ? { ...msg, streaming: false } : msg,
              ),
              updatedAt: Date.now(),
            }));
          }
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const lastStreaming = streamingMsgIdRef.current;
          if (lastStreaming) {
            // 结构化 API 错误保持原样（MessageBubble 渲染为红色面板），其他错误依旧 Markdown 加粗
            const displayContent = errorMsg.startsWith("[API_ERROR:")
              ? errorMsg
              : `**Error:** ${errorMsg}`;
            updateConv(activeId, (c) => ({
              ...c,
              messages: c.messages.map((msg) =>
                msg.id === lastStreaming
                  ? { ...msg, content: displayContent, streaming: false }
                  : msg,
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
          flushConversations(conversationsRef.current, sessionPathRef.current);
        }, 0);

        // 会话完成后发送系统通知（屏幕右下角）
        if (completedNormally) {
          playNotificationSound();
          sendNotification({ title: "会话任务已完成。", body: "" });
        }

        // 流式完成后，如需自动标题则调用模型生成
        if (needsAutoTitle && selectedModel) {
          // 等待 React state 同步后获取最新对话中的 assistant 消息
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
    [activeId, selectedModel, conversations, updateConv, mode],
  );

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  // Clamp sidebar on window resize
  useEffect(() => {
    const clamp = () => {
      const max = Math.floor(window.innerWidth / 2);
      setSidebarWidth((w) => Math.max(MIN_SIDEBAR, Math.min(w, max)));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const handleResizeSidebar = useCallback((w: number) => {
    const max = Math.floor(window.innerWidth / 2);
    const clamped = Math.max(MIN_SIDEBAR, Math.min(w, max));
    sidebarWidthRef.current = clamped;
    setSidebarWidth(clamped);
  }, []);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  const handlePrint = useCallback(() => {
    if (!activeConv) {
      showToast("请先开始一个会话");
      return;
    }
    setPrintOpen(true);
  }, [activeConv, showToast]);

  const handleToggleCompression = useCallback(() => {
    setCompressionEnabled((v) => !v);
  }, []);

  const handleCompressNow = useCallback(async () => {
    if (!activeConv || !selectedModel || isCompressing) return;
    if (activeConv.messages.length < MIN_MESSAGES_FOR_COMPRESSION) return;
    setIsCompressing(true);
    try {
      const result = await compressConversation(
        activeConv.messages,
        selectedModel,
      );
      if (result.summary) {
        updateConv(activeId!, (c) => ({
          ...c,
          messages: result.messages,
          updatedAt: Date.now(),
        }));
      }
    } catch {
      // silent
    } finally {
      setIsCompressing(false);
    }
  }, [activeConv, activeId, selectedModel, updateConv, isCompressing]);

  // ── Ctrl+P Print Dialog (with context guards + toast) ──
  const printGuardRef = useRef({ isLocked: false, panelMode: "Default" as PanelMode, settingsOpen: false, componentsOpen: false, hasActiveConv: false });
  printGuardRef.current = { isLocked, panelMode, settingsOpen, componentsOpen, hasActiveConv: activeConv !== null };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        const g = printGuardRef.current;
        if (g.isLocked) {
          showToast("Unicoda 已锁定，请先解锁");
        } else if (g.panelMode === "Yolo") {
          showToast("Yolo 窗口不支持打印");
        } else if (g.settingsOpen) {
          showToast("设置界面不支持打印");
        } else if (g.componentsOpen) {
          showToast("组件管理界面不支持打印");
        } else if (!g.hasActiveConv) {
          showToast("请先开始一个会话");
        } else {
          setPrintOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showToast]);

  // ── 全局拦截浏览器默认按键/右键（捕获阶段） ──
  useEffect(() => {
    // 浏览器快捷键黑名单（Ctrl+key / Cmd+key）
    const blockedCtrl: string[] = ["t", "w", "n", "r", "s", "u", "h", "j", "d", "o", "F5", "F11"];
    // Ctrl+Shift 组合黑名单
    const blockedShiftCtrl: string[] = ["i", "j", "c", "n"];
    // F1-F12 全部拦截（开发工具、帮助等）
    const blockedFKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const handleKeyDown = (e: KeyboardEvent) => {
      // 拦截 F-键
      const fNum = parseInt(e.key.slice(1), 10);
      if (e.key.startsWith("F") && !isNaN(fNum) && blockedFKeys.includes(fNum)) {
        e.preventDefault();
        return;
      }
      // 拦截 Ctrl/Meta 浏览器快捷键
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (blockedCtrl.includes(key)) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && blockedShiftCtrl.includes(key)) {
          e.preventDefault();
          return;
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // 阻止浏览器右键菜单
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("contextmenu", handleContextMenu, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    };
  }, []);

  const transformScale = scaleToTransform(scale);

  // ── Blur transition derived values ─────────────
  const defaultOpacity = !isTransitioning
    ? (panelMode === "Default" ? 1 : 0)
    : (panelMode === "Default" && transitionPhase !== "fade" ? 1 : 0);
  const yoloOpacity = !isTransitioning
    ? (panelMode === "Yolo" ? 1 : 0)
    : (panelMode === "Yolo" && transitionPhase !== "fade" ? 1 : 0);
  const blurOpacity = isTransitioning && transitionPhase !== "reveal" ? 1 : 0;

  // Inject comprehensive CSS color tokens (dark = default, light overrides via [data-theme="light"])
  const themeStyleTag = (
    <style>{`
      [data-theme] {
        --c-bg: #0f0f11;   --c-bg2: #1a1a1e;   --c-bg3: #1e1e22;
        --c-txt: #e0e0e0;  --c-t2: #a0a0a0;     --c-t3: #7a7a7e;
        --c-t4: #5a5a5e;   --c-t5: #6a6a6e;     --c-t6: #8a8a8e;
        --c-bd: #2a2a2e;   --c-bd2: #3a3a3e;
        --c-ac: #2563eb;   --c-ah: #1d4ed8;     --c-bf: #2563eb;
      }
      [data-theme="light"] {
        --c-bg: #f2f2f5;   --c-bg2: #ffffff;    --c-bg3: #e8e8ec;
        --c-txt: #1a1a1e;  --c-t2: #5a5a5e;     --c-t3: #8a8a8e;
        --c-t4: #9a9a9e;   --c-t5: #7a7a7e;     --c-t6: #a0a0a0;
        --c-bd: #d4d4d8;   --c-bd2: #c8c8cc;
        --c-ac: #2563eb;   --c-ah: #1d4ed8;     --c-bf: #2563eb;
      }
    `}</style>
  );

  // Inject entrance keyframes for YoloPanel staggered animation
  const entranceStyleTag = (
    <style>{`
      @keyframes yolo-entrance-card {
        0%   { opacity: 0; transform: translateY(12px) scale(0.96); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes yolo-entrance-header {
        0%   { opacity: 0; transform: translateY(-8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes yolo-entrance-content {
        0%   { opacity: 0; transform: translateY(8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes yolo-entrance-input {
        0%   { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );

  return (
    <div
      data-theme={panelMode === "Yolo" ? "dark" : theme}
      style={{
        width: `${100 / transformScale}vw`,
        height: `${100 / transformScale}vh`,
        transform: `scale(${transformScale})`,
        transformOrigin: "top left",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
        color: "var(--c-txt)",
        fontFamily,
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {themeStyleTag}
      {entranceStyleTag}
      {/* ── Default UI (opacity controlled for transitions) ── */}
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        opacity: defaultOpacity,
        transition: "opacity 0.4s ease",
        pointerEvents: defaultOpacity > 0.5 ? "auto" : "none",
      }}>
        {/* Custom Title Bar */}
        <TitleBar title={activeConv?.title ?? "Unicoda"} />

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* Sidebar */}
          <Sidebar
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            conversations={conversations}
            activeId={activeId}
            onCreate={handleCreate}
            onSelect={handleSelect}
            onRename={handleRename}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            onBatchDelete={handleBatchDelete}
            onBatchTogglePin={handleBatchTogglePin}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onResize={handleResizeSidebar}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenComponents={() => setComponentsOpen(true)}
            onTogglePanel={handleTogglePanel}
            onPrint={handlePrint}
          />

          {/* Main Area */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div
              key={activeConv ? `chat-${activeId}` : "empty"}
              className="view-transition"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {/* Messages */}
              {activeConv ? (
                <ChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} onPreviewFile={setPreviewFile} isStreaming={isStreaming} />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--c-t5)",
                    fontSize: "14px",
                  }}
                >
                  {t("selectOrCreate")}
                </div>
              )}

              {/* Input */}
              {activeConv && (
                <InputBar
                  onSend={handleSend}
                  onStop={handleStop}
                  disabled={isStreaming}
                  messages={activeConv.messages}
                  maxTokens={selectedModel?.params?.maxTokens}
                  compressionEnabled={compressionEnabled}
                  onToggleCompression={handleToggleCompression}
                  onCompressNow={handleCompressNow}
                  isCompressing={isCompressing}
                  mode={mode}
                  onModeChange={setMode}
                  pendingFiles={pendingFiles}
                  onRemovePendingFile={handleRemovePendingFile}
                  onClearPendingFiles={() => setPendingFiles([])}
                  dragOver={dragOver}
                />
              )}
            </div>
          </div>

          {settingsOpen && <SettingsPanel onBack={() => setSettingsOpen(false)} />}

          {/* ── Components Overlay ── */}
          {componentsOpen && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 200,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--c-bg)",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <ComponentsPanel onBack={() => setComponentsOpen(false)} />
            </div>
          )}

          {/* ── Print Dialog Overlay ── */}
          {printOpen && activeConv && (
            <PrintDialog
              messages={activeConv.messages}
              modelName={selectedModel?.name}
              userName={userName}
              t={t}
              onClose={() => setPrintOpen(false)}
            />
          )}

          {/* ── File Preview Panel ── */}
          <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
      </div>

      {/* ── Yolo Panel (always mounted, opacity controlled) ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1000,
        opacity: yoloOpacity,
        transition: "opacity 0.4s ease 0.05s",
        pointerEvents: yoloOpacity > 0.5 ? "auto" : "none",
      }}>
        <YoloPanel key={panelMode === "Yolo" ? yoloEntryKey : 0} onBack={() => setPanelMode("Default")} />
      </div>

      {/* ── Blur transition overlay ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 999,
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        backgroundColor: "rgba(8, 8, 12, 0.75)",
        opacity: blurOpacity,
        transition: "opacity 0.3s ease",
        pointerEvents: "none",
      }} />

      {/* ── Toast notification ── */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      {toast && (
        <div key={toast.key} style={{
          position: "fixed", bottom: "80px", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100000,
          backgroundColor: "var(--c-bg2)",
          border: "1px solid var(--c-bd)",
          color: "var(--c-txt)",
          padding: "10px 22px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 500,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          animation: "toast-in 0.2s ease",
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}>
          {toast.message}
        </div>
      )}

      {/* ── Lock overlay (inside data-theme root so --c-bg resolves) ── */}
      <LockOverlay locale={locale} yolo={panelMode === "Yolo"} />

    </div>
  );
}

// ─── Root component — providers wrap the inner content ────────────
export default function App() {
  const [panelMode, setPanelMode] = useState<PanelMode>("Default");
  return (
    <LockProvider>
    <ModelProvider>
    <SearchProvider>
      <MainContent panelMode={panelMode} setPanelMode={setPanelMode} />

      {/* ── 版本标记（全局顶层，取反色） ── */}
      <span
        style={{
          position: "fixed",
          bottom: "10px",
          right: "14px",
          fontSize: "11px",
          color: "#fff",
          mixBlendMode: "difference",
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
          fontFamily: "inherit",
          zIndex: 99999,
        }}
      >
        [Alpha测试] 此版本不代表最终品质
      </span>
    </SearchProvider>
    </ModelProvider>
    </LockProvider>
  );
}
