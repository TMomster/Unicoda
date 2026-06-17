import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, Message, Mode } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import { streamChatCompletion } from "../services/modelApi";
import { writeConfigFile, readConfigFile } from "../utils/configStorage";
import { buildAgentSystemPrompt, parseToolCalls, stripToolCalls, executeToolCall } from "../services/agentEngine";
import ChatPanel from "./ChatPanel";
import InputBar from "./InputBar";
import SettingsPanel from "./SettingsPanel";

const STORAGE_KEY = "unison-yolo-conversations";
let nextConvId = 1;
let nextMsgId = 1;

function makeConvTitle(existing: Conversation[], locale: string): string {
  const prefix = locale === "en-US" ? "New Session" : "新会话";
  const pattern = locale === "en-US" ? /^New Session-(\d+)$/ : /^新会话-(\d+)$/;
  const nums = new Set<number>();
  for (const c of existing) { const m = c.title.match(pattern); if (m) nums.add(parseInt(m[1], 10)); }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}-${n}`;
}

function flushConversations(convs: Conversation[], path: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(convs)); } catch { /* ignore */ }
  writeConfigFile(STORAGE_KEY, convs, path);
}

// ── Aurora Background ───────────────────────────
function AuroraBackground() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timeRef = useRef(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const gradients = [
      { cx: 15, cy: 25, r: 55, color: "rgba(70, 200, 255, 0.25)" },
      { cx: 85, cy: 65, r: 50, color: "rgba(200, 100, 255, 0.2)" },
      { cx: 40, cy: 70, r: 55, color: "rgba(0, 255, 200, 0.18)" },
      { cx: 70, cy: 30, r: 50, color: "rgba(100, 220, 255, 0.2)" },
    ];
    const baseLinear = "linear-gradient(135deg, #0b2b5e 0%, #1a4b7a 25%, #3a6a9a 50%, #5a3a7a 75%, #2a4a7a 100%)";
    const animate = () => {
      timeRef.current += 0.008;
      const t = timeRef.current;
      const shifted = gradients.map((g, i) => `radial-gradient(circle at ${g.cx + Math.sin(t + i * 1.57) * 25}% ${g.cy + Math.cos(t * 0.8 + i * 1.57) * 20}%, ${g.color} 0%, transparent ${g.r + Math.sin(t * 0.6 + i) * 14}%)`);
      el.style.background = [...shifted, baseLinear].join(", ");
      el.style.backgroundBlendMode = "overlay, screen, lighten, normal, normal";
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);
  return <div ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />;
}

// ── Workspace Drawer ────────────────────────────
function WorkspaceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, sessionPath } = useTheme();
  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 29 }} />}
      <div style={{
        position: "relative", zIndex: 30, maxHeight: open ? "200px" : "0", overflow: "hidden",
        transition: "max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        backgroundColor: "rgba(20, 20, 25, 0.85)", backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: open ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}>
        <div style={{ padding: open ? "16px 24px" : "0 24px", opacity: open ? 1 : 0, transition: "opacity 0.2s ease 0.1s" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#c0c0c0" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: "middle", marginRight: "6px" }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {t("yoloWorkspace")}
            </span>
            <button onClick={onClose} style={{ width: "24px", height: "24px", borderRadius: "6px", border: "none", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div style={{ fontSize: "12px", color: "#8a8a8e", lineHeight: 1.8 }}>
            {sessionPath ? <span style={{ wordBreak: "break-all" }}>{sessionPath}</span> : <span style={{ color: "#5a5a5e" }}>{t("yoloNoWorkspace")}</span>}
          </div>
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#6a6a6e", lineHeight: 1.6 }}>{t("yoloWorkspaceDesc")}</div>
        </div>
      </div>
    </>
  );
}

// ── Yolo Header ─────────────────────────────────
function YoloHeader({ title, onBack, onToggleWorkspace, onOpenSettings }: {
  title: string; onBack: () => void; onToggleWorkspace: () => void; onOpenSettings: () => void;
}) {
  const [hover, setHover] = useState(false);
  const btnBase: React.CSSProperties = { width: "26px", height: "26px", borderRadius: "6px", border: "none", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" };
  return (
    <div data-tauri-drag-region style={{ height: "36px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", flexShrink: 0, userSelect: "none", backgroundColor: hover ? "rgba(255,255,255,0.04)" : "transparent", transition: "background 0.15s" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button onClick={onBack} title="返回默认面板" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span style={{ fontSize: "12px", fontWeight: 500, color: "#8a8a8e", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        <button onClick={onOpenSettings} title="设置" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
        <button onClick={onToggleWorkspace} title="工作区" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
      </div>
    </div>
  );
}

// ── Welcome screen ──────────────────────────────
function YoloWelcome() {
  const { t } = useTheme();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "40px 20px" }}>
      <div style={{ fontSize: "36px", fontWeight: 300, color: "rgba(255,255,255,0.7)", letterSpacing: "2px", textShadow: "0 0 40px rgba(200,220,255,0.3)" }}>
        {t("yoloWelcome")}
      </div>
      <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", textAlign: "center", maxWidth: "320px", lineHeight: 1.6 }}>
        {t("whatToDo")}
      </p>
    </div>
  );
}

// ── Settings with glass background ──────────────
function YoloSettingsOverlay({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, backgroundColor: "rgba(10, 10, 15, 0.6)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }} />
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column" }}>
        <SettingsPanel onBack={onBack} />
      </div>
    </div>
  );
}

// ── Main YoloPanel Component ────────────────────
interface Props { onBack?: () => void; }

export default function YoloPanel({ onBack }: Props) {
  const { scale, fontFamily, t, locale, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode } = useTheme();
  const { models, selectedModelId } = useModels();
  const selectedModel = models.find((m) => m.id === selectedModelId);

  // ── Conversations ────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded: Conversation[] = JSON.parse(raw);
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
          for (const m of c.messages ?? []) {
            const midNum = parseInt(m.id, 10);
            if (midNum >= nextMsgId) nextMsgId = midNum + 1;
          }
        }
        return loaded;
      }
    } catch { /* ignore */ }
    return [{ id: String(nextConvId++), title: makeConvTitle([], locale), messages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }];
  });

  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    readConfigFile<Conversation[]>(STORAGE_KEY, [], sessionPath).then((loaded) => {
      if (loaded.length > 0) {
        setConversations(loaded);
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
          for (const m of c.messages ?? []) {
            const midNum = parseInt(m.id, 10);
            if (midNum >= nextMsgId) nextMsgId = midNum + 1;
          }
        }
      }
    });
  }, [sessionPath]);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const sessionPathRef = useRef(sessionPath);
  sessionPathRef.current = sessionPath;

  const [activeId] = useState<string>(conversations[0].id);
  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const [mode, setMode] = useState<Mode>("Chat");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateConv = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  function buildApiMessages(prev: Message[], userMsg: Message, sendMode: Mode): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];
    const sp = sendMode === "Agent"
      ? buildAgentSystemPrompt("Agent", selectedModel?.systemPrompt)
      : buildAgentSystemPrompt("Chat", selectedModel?.systemPrompt);
    const kbExtra = prev.find((m) => m.role === "assistant" && m.content.startsWith("[对话历史摘要]"));
    result.push({ role: "system", content: sp + (kbExtra ? `\n\n## 前期对话摘要\n\n${kbExtra.content}` : "") });
    for (const m of prev.filter((m) => !m.content.startsWith("[对话历史摘要]"))) result.push({ role: m.role, content: m.content });
    result.push({ role: userMsg.role, content: userMsg.content });
    return result;
  }

  async function handleChatSend(userMsg: Message, prevMessages: Message[], currentMode: Mode, ac: AbortController, aid: string) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    updateConv(aid, (c) => ({ ...c, messages: [...c.messages, userMsg], updatedAt: Date.now() }));
    let allToolResults: { role: string; content: string }[] = [];
    let complete = false, toolCallRound = 0;
    const MAX_ROUNDS = 5;
    while (!complete) {
      const asstId = String(nextMsgId++);
      streamingMsgIdRef.current = asstId;
      updateConv(aid, (c) => ({ ...c, messages: [...c.messages, { id: asstId, role: "assistant", content: "", timestamp: Date.now(), streaming: true } as Message], updatedAt: Date.now() }));
      let fullContent = "", fullReasoning = "";
      for await (const chunk of streamChatCompletion(selectedModel!, [...initialApiMessages, ...allToolResults], ac.signal)) {
        fullContent += chunk.content; fullReasoning += chunk.reasoningContent;
        updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: fullContent, reasoningContent: fullReasoning } : m), updatedAt: Date.now() }));
      }
      updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, streaming: false } : m), updatedAt: Date.now() }));
      const toolCalls = parseToolCalls(fullContent);
      if (toolCalls.length === 0) {
        complete = true;
        const cc = stripToolCalls(fullContent);
        if (cc !== fullContent) updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: cc } : m), updatedAt: Date.now() }));
      } else if (toolCallRound < MAX_ROUNDS) {
        toolCallRound++;
        const cc = stripToolCalls(fullContent);
        if (cc !== fullContent) updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: cc } : m), updatedAt: Date.now() }));
        for (const call of toolCalls) {
          const result = await executeToolCall(call, ac.signal);
          updateConv(aid, (c) => ({ ...c, messages: [...c.messages, { id: String(nextMsgId++), role: "tool", content: result.content, toolCallId: call.id, toolCallError: result.error, timestamp: Date.now() } as Message], updatedAt: Date.now() }));
          allToolResults.push({ role: "user", content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}` });
          if (toolCalls.length > 1) await new Promise((r) => setTimeout(r, 500));
        }
      } else { complete = true; const cc = stripToolCalls(fullContent); if (cc) updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: cc } : m), updatedAt: Date.now() })); }
    }
  }

  async function handleAgentSend(userMsg: Message, prevMessages: Message[], currentMode: Mode, ac: AbortController, aid: string) {
    const initialApiMessages = buildApiMessages(prevMessages, userMsg, currentMode);
    updateConv(aid, (c) => ({ ...c, messages: [...c.messages, userMsg], updatedAt: Date.now() }));
    let allToolResults: { role: string; content: string }[] = [];
    let complete = false, toolRound = 0;
    const MAX_ROUNDS = 5;
    while (!complete && toolRound < MAX_ROUNDS) {
      const asstId = String(nextMsgId++);
      streamingMsgIdRef.current = asstId;
      updateConv(aid, (c) => ({ ...c, messages: [...c.messages, { id: asstId, role: "assistant", content: "", timestamp: Date.now(), streaming: true } as Message], updatedAt: Date.now() }));
      let fullContent = "", fullReasoning = "";
      for await (const chunk of streamChatCompletion(selectedModel!, [...initialApiMessages, ...allToolResults], ac.signal)) {
        fullContent += chunk.content; fullReasoning += chunk.reasoningContent;
        updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: fullContent, reasoningContent: fullReasoning } : m), updatedAt: Date.now() }));
      }
      updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, streaming: false } : m), updatedAt: Date.now() }));
      toolRound++;
      const toolCalls = parseToolCalls(fullContent);
      if (toolCalls.length === 0) {
        complete = true;
        const cc = stripToolCalls(fullContent);
        if (cc !== fullContent) updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: cc } : m), updatedAt: Date.now() }));
      } else {
        const cc = stripToolCalls(fullContent);
        if (cc !== fullContent) updateConv(aid, (c) => ({ ...c, messages: c.messages.map((m) => m.id === asstId ? { ...m, content: cc } : m), updatedAt: Date.now() }));
        for (const call of toolCalls) {
          const result = await executeToolCall(call, ac.signal);
          updateConv(aid, (c) => ({ ...c, messages: [...c.messages, { id: String(nextMsgId++), role: "tool", content: result.content, toolCallId: call.id, toolCallError: result.error, timestamp: Date.now() } as Message], updatedAt: Date.now() }));
          allToolResults.push({ role: "user", content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}` });
          if (toolCalls.length > 1) await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }

  const handleSend = useCallback(async (text: string, sendMode?: Mode) => {
    if (!activeId || !selectedModel) return;
    const currentMode = sendMode ?? mode;
    if (abortRef.current) abortRef.current.abort();
    const userMsg: Message = { id: String(nextMsgId++), role: "user", content: text, timestamp: Date.now() };
    const currentConv = conversations.find((c) => c.id === activeId);
    const prevMessages = currentConv?.messages ?? [];
    setIsStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      if (currentMode === "Agent") await handleAgentSend(userMsg, prevMessages, currentMode, ac, activeId);
      else await handleChatSend(userMsg, prevMessages, currentMode, ac, activeId);
    } catch (err: unknown) {
      const lastStreaming = streamingMsgIdRef.current;
      if (lastStreaming) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateConv(activeId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === lastStreaming ? { ...m, streaming: false } : m), updatedAt: Date.now() }));
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateConv(activeId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === lastStreaming ? { ...m, content: `**Error:** ${errorMsg}`, streaming: false } : m), updatedAt: Date.now() }));
        }
      }
    } finally {
      setIsStreaming(false);
      streamingMsgIdRef.current = null;
      abortRef.current = null;
      setTimeout(() => flushConversations(conversationsRef.current, sessionPathRef.current), 0);
    }
  }, [activeId, selectedModel, conversations, updateConv, mode]);

  const handleStop = useCallback(() => { if (abortRef.current) abortRef.current.abort(); }, []);

  const transformScale = scale / 100 * 0.70;
  const scaleStyle = { width: `${100 / transformScale}vw`, height: `${100 / transformScale}vh`, transform: `scale(${transformScale})`, transformOrigin: "top left" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily }}>
      <AuroraBackground />
      <div style={{ position: "fixed", inset: 0, zIndex: 1, backgroundColor: "rgba(10, 10, 15, 0.45)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }} />
      <div style={{ position: "relative", zIndex: 2, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, ...scaleStyle }}>
        <YoloHeader title={activeConv?.title ?? "Unison"} onBack={() => onBack?.()} onToggleWorkspace={() => setWorkspaceOpen((v) => !v)} onOpenSettings={() => setSettingsOpen(true)} />
        <WorkspaceDrawer open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div key={activeConv ? `yolo-chat-${activeId}` : "yolo-empty"} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {activeConv && activeConv.messages.length > 0 ? (
              <ChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} />
            ) : (
              <YoloWelcome />
            )}
            {activeConv && (
              <InputBar onSend={handleSend} onStop={handleStop} disabled={isStreaming} messages={activeConv.messages} maxTokens={selectedModel?.params?.maxTokens} mode={mode} onModeChange={setMode} />
            )}
          </div>
        </div>
      </div>
      {settingsOpen && <YoloSettingsOverlay onBack={() => setSettingsOpen(false)} />}
    </div>
  );
}
