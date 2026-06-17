import { useState, useCallback, useRef, useEffect } from "react";
import type { Conversation, Message } from "./types";
import { useTheme, scaleToTransform } from "./contexts/ThemeContext";
import { useModels } from "./contexts/ModelContext";
import { ModelProvider } from "./contexts/ModelContext";
import { LockProvider } from "./contexts/LockContext";
import { streamChatCompletion } from "./services/modelApi";
import { writeConfigFile, readConfigFile } from "./utils/configStorage";
import LockOverlay from "./components/LockOverlay";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import InputBar from "./components/InputBar";
import TitleBar from "./components/TitleBar";
import SettingsPanel from "./components/SettingsPanel";

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
function MainContent() {
  const { scale, fontFamily, t, locale, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen } = useTheme();
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
      const nextId = conversations.find((c) => c.id !== id)?.id ?? null;
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (next.length === 0) {
          const fresh: Conversation = {
            id: String(nextConvId++),
            title: makeConvTitle(prev.filter((c) => c.id !== id), locale),
            messages: [],
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          return [fresh];
        }
        // 同步写入会话库
        flushConversations(next, sessionPath);
        return next;
      });
      if (activeId === id) {
        setActiveId(nextId ?? String(nextConvId));
      }
    },
    [activeId, conversations, locale, sessionPath],
  );

  // ── Send message + call model API ──────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      if (!activeId || !selectedModel) return;

      // Cancel any existing streaming
      if (abortRef.current) {
        abortRef.current.abort();
      }

      // 1. Add user message
      const userMsg: Message = {
        id: String(nextMsgId++),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const assistantId = String(nextMsgId++);
      streamingMsgIdRef.current = assistantId;

      // 2. Add placeholder assistant message
      const assistantPlaceholder: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      };

      // Get current messages for API call before updating state
      const currentConv = conversations.find((c) => c.id === activeId);
      const prevMessages = currentConv?.messages ?? [];
      const apiMessages = [...prevMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Update conv with user + placeholder
      updateConv(activeId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg, assistantPlaceholder],
        updatedAt: Date.now(),
      }));

      setIsStreaming(true);

      // 3. Start streaming API call
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        let fullContent = "";
        let fullReasoning = "";
        for await (const chunk of streamChatCompletion(
          selectedModel,
          apiMessages,
          abortController.signal,
        )) {
          fullContent += chunk.content;
          fullReasoning += chunk.reasoningContent;
          // Update assistant message content in real-time
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

        // Mark streaming as complete
        updateConv(activeId, (c) => ({
          ...c,
          messages: c.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, streaming: false }
              : msg,
          ),
          updatedAt: Date.now(),
        }));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User stopped — keep partial content
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId
                ? { ...msg, streaming: false }
                : msg,
            ),
            updatedAt: Date.now(),
          }));
        } else {
          // Show error in assistant message
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateConv(activeId, (c) => ({
            ...c,
            messages: c.messages.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: `**Error:** ${errorMsg}`, streaming: false }
                : msg,
            ),
            updatedAt: Date.now(),
          }));
        }
      } finally {
        setIsStreaming(false);
        streamingMsgIdRef.current = null;
        abortRef.current = null;
        // 流式传输结束，将最新对话写入文件
        setTimeout(() => {
          flushConversations(conversationsRef.current, sessionPathRef.current);
        }, 0);
      }
    },
    [activeId, selectedModel, conversations, updateConv],
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

  const transformScale = scaleToTransform(scale);

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
      }}
    >
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
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onResize={handleResizeSidebar}
          onOpenSettings={() => setSettingsOpen(true)}
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
              <ChatPanel messages={activeConv.messages} maxTokens={selectedModel?.params?.maxTokens} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} t={t} />
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
              animation: "settingsFadeIn 0.2s ease",
            }}
          >
            <style>{`
              @keyframes settingsFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
            `}</style>
            <SettingsPanel onBack={() => setSettingsOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root component — providers wrap the inner content ────────────
export default function App() {
  const { locale } = useTheme();
  return (
    <LockProvider>
    <ModelProvider>
      <MainContent />
      <LockOverlay locale={locale} />
    </ModelProvider>
    </LockProvider>
  );
}
