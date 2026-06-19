import { useState, useCallback, useRef, useEffect } from "react";
import type { Conversation, Message, Mode, PanelMode } from "./types";
import { useTheme, scaleToTransform } from "./contexts/ThemeContext";
import { useModels } from "./contexts/ModelContext";
import { ModelProvider } from "./contexts/ModelContext";
import { LockProvider } from "./contexts/LockContext";
import { streamChatCompletion } from "./services/modelApi";
import { writeConfigFile, readConfigFile } from "./utils/configStorage";
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
import LockOverlay from "./components/LockOverlay";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import InputBar from "./components/InputBar";
import TitleBar from "./components/TitleBar";
import SettingsPanel from "./components/SettingsPanel";
import ModulesPanel from "./components/ModulesPanel";
import YoloPanel from "./components/YoloPanel";

/** 将当前会话列表写入文件（仅流式完成后调用） */
function flushConversations(convs: Conversation[], path: string) {
  try {
    localStorage.setItem("unison-conversations", JSON.stringify(convs));
  } catch { /* ignore */ }
  writeConfigFile("unison-conversations", convs, path);
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
  const { scale, fontFamily, t, locale, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem("unison-conversations");
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
    readConfigFile<Conversation[]>("unison-conversations", [], sessionPath).then((loaded) => {
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
  const [modulesOpen, setModulesOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("Chat");
  useEffect(() => {
    initBuiltinModules();
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
    result.push({ role: userMsg.role, content: userMsg.content });
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

      const apiMessages = [...initialApiMessages, ...allToolResults];

      for await (const chunk of streamChatCompletion(
        selectedModel!,
        apiMessages,
        abortController.signal,
      )) {
        fullContent += chunk.content;
        fullReasoning += chunk.reasoningContent;
        updateConv(activeId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, reasoningContent: fullReasoning }
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

      const apiMessages = [...initialApiMessages, ...allToolResults];

      for await (const chunk of streamChatCompletion(
        selectedModel!,
        apiMessages,
        abortController.signal,
      )) {
        fullContent += chunk.content;
        fullReasoning += chunk.reasoningContent;
        updateConv(activeId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, reasoningContent: fullReasoning }
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

  const handleSend = useCallback(
    async (text: string, sendMode?: Mode) => {
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
      };

      const currentConv = conversations.find((c) => c.id === activeId);
      const prevMessages = currentConv?.messages ?? [];

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
            updateConv(activeId, (c) => ({
              ...c,
              messages: c.messages.map((msg) =>
                msg.id === lastStreaming
                  ? { ...msg, content: `**Error:** ${errorMsg}`, streaming: false }
                  : msg,
              ),
              updatedAt: Date.now(),
            }));
          }
        }
      } finally {
        setIsStreaming(false);
        streamingMsgIdRef.current = null;
        abortRef.current = null;
        setTimeout(() => {
          flushConversations(conversationsRef.current, sessionPathRef.current);
        }, 0);
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

  const transformScale = scaleToTransform(scale);

  // ── Blur transition derived values ─────────────
  const defaultOpacity = !isTransitioning
    ? (panelMode === "Default" ? 1 : 0)
    : (panelMode === "Default" && transitionPhase !== "fade" ? 1 : 0);
  const yoloOpacity = !isTransitioning
    ? (panelMode === "Yolo" ? 1 : 0)
    : (panelMode === "Yolo" && transitionPhase !== "fade" ? 1 : 0);
  const blurOpacity = isTransitioning && transitionPhase !== "reveal" ? 1 : 0;

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
      style={{
        width: `${100 / transformScale}vw`,
        height: `${100 / transformScale}vh`,
        transform: `scale(${transformScale})`,
        transformOrigin: "top left",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0f0f11",
        color: "#e0e0e0",
        fontFamily,
        position: "relative",
        overflow: "hidden",
      }}
    >
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
        <TitleBar title={activeConv?.title ?? "Unison"} />

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
            onOpenModules={() => setModulesOpen(true)}
            onTogglePanel={handleTogglePanel}
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
                <ChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6a6a6e",
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
                />
              )}
            </div>
          </div>

          {/* ── Settings Overlay (covers entire window) ── */}
          {settingsOpen && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 200,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#0f0f11",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <style>{`
                @keyframes fadeIn {
                  from { opacity: 0; }
                  to { opacity: 1; }
                }
              `}</style>
              <SettingsPanel onBack={() => setSettingsOpen(false)} />
            </div>
          )}

          {/* ── Modules/KB Overlay ── */}
          {modulesOpen && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 200,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#0f0f11",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <ModulesPanel onBack={() => setModulesOpen(false)} />
            </div>
          )}
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
    </div>
  );
}

// ─── Root component — providers wrap the inner content ────────────
export default function App() {
  const { locale } = useTheme();
  const [panelMode, setPanelMode] = useState<PanelMode>("Default");
  return (
    <LockProvider>
    <ModelProvider>
      <MainContent panelMode={panelMode} setPanelMode={setPanelMode} />
      <LockOverlay locale={locale} yolo={panelMode === "Yolo"} />
    </ModelProvider>
    </LockProvider>
  );
}
