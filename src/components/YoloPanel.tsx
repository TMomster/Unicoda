import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, Message, Mode, FileAttachment } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import { streamChatCompletion } from "../services/modelApi";
import { writeConfigFile, readConfigFile } from "../utils/configStorage";
import { buildAgentSystemPrompt, parseToolCalls, stripToolCalls, executeToolCall } from "../services/agentEngine";
import { compressConversation, MIN_MESSAGES_FOR_COMPRESSION } from "../services/conversationCompression";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "../constants/windowIcons";
import AuroraBackground from "./AuroraBackground";
import YoloChatPanel from "./YoloChatPanel";
import InputBar from "./InputBar";
import SettingsPanel from "./SettingsPanel";
import ComponentsPanel from "./ComponentsPanel";
import FilePreviewPanel from "./FilePreviewPanel";

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

// ── Workspace Drawer (glass consistent) ──────
function WorkspaceDrawer({ open, onClose, onSelectFolder }: {
  open: boolean; onClose: () => void; onSelectFolder: () => void;
}) {
  const { t, sessionPath } = useTheme();
  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 29 }} />}
      <div style={{
        position: "relative", zIndex: 30, maxHeight: open ? "240px" : "0", overflow: "hidden",
        transition: "max-height 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        backgroundColor: "rgba(8, 8, 12, 0.35)", backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: open ? "1px solid rgba(255,255,255,0.08)" : "none",
      }}>
        <div style={{
          padding: open ? "18px 24px 20px" : "0 24px",
          opacity: open ? 1 : 0,
          transition: "opacity 0.25s ease 0.1s",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(100,180,255,0.7)" strokeWidth="1.8">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#c0c0c0", letterSpacing: "0.3px" }}>
                {t("yoloWorkspace")}
              </span>
            </div>
            <button onClick={onClose}
              style={{ width: "26px", height: "26px", borderRadius: "6px", border: "none", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div style={{
            padding: "12px 16px", borderRadius: "8px",
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            fontSize: "12px", color: "#8a8a8e", lineHeight: 1.8,
          }}>
            {sessionPath ? (
              <span style={{ wordBreak: "break-all", color: "#a0a0a0" }}>{sessionPath}</span>
            ) : (
              <span style={{ color: "#5a5a5e", fontStyle: "italic" }}>{t("yoloNoWorkspace")}</span>
            )}
          </div>

          <div style={{ marginTop: "14px", display: "flex", gap: "8px" }}>
            <button onClick={onSelectFolder}
              style={{
                flex: 1, padding: "9px 14px", borderRadius: "8px", border: "1px solid rgba(59,130,246,0.3)",
                background: "rgba(59,130,246,0.1)", color: "#60a5fa", fontSize: "12px", fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6, transition: "all 0.15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.2)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.1)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <polyline points="12 11 12 17" /><line x1="9" y1="14" x2="15" y2="14" />
              </svg>
              {t("yoloSelectFolder")}
            </button>
          </div>

          <div style={{ marginTop: "10px", fontSize: "11px", color: "rgba(255,255,255,0.25)", lineHeight: 1.6, textAlign: "center" }}>
            {t("yoloWorkspaceDesc")}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Yolo session sidebar (slides from left) ───
function YoloSessionSidebar({ open, onClose, conversations, activeId, onSelect, onCreate, onDelete }: {
  open: boolean; onClose: () => void;
  conversations: Conversation[]; activeId: string;
  onSelect: (id: string) => void; onCreate: () => void; onDelete: (id: string) => void;
}) {
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!contextMenuId) return;
    const close = () => setContextMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenuId]);

  const sorted = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  return (
    <div style={{
      width: open ? "240px" : "0",
      overflow: "hidden",
      flexShrink: 0,
      transition: "width 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "240px",
        height: "100%",
        display: "flex", flexDirection: "column",
        backgroundColor: "transparent", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
      }}>
        {/* Header */}
        <div style={{
          height: "40px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          userSelect: "none",
        }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#b0b0b8", letterSpacing: "0.3px" }}>会话</span>
          <button onClick={onClose}
            style={{ width: "24px", height: "24px", borderRadius: "6px", border: "none", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* New session button */}
        <div style={{ padding: "10px 12px", flexShrink: 0 }}>
          <button onClick={() => { onCreate(); onClose(); }}
            style={{
              width: "100%", padding: "8px 0", borderRadius: "8px",
              border: "1px solid rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.08)",
              color: "#60a5fa", fontSize: "12px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.18)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.5)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.08)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)"; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            <span>新会话</span>
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {sorted.map((conv) => {
            const isActive = conv.id === activeId;
            return (
              <div key={conv.id} style={{ position: "relative" }}>
                <div
                  onClick={() => { onSelect(conv.id); onClose(); }}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuId(conv.id); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "8px 10px", borderRadius: "6px", cursor: "pointer",
                    marginBottom: "2px",
                    backgroundColor: isActive ? "rgba(37,99,235,0.12)" : "transparent",
                    color: isActive ? "#d0d0d8" : "#a0a0a8",
                    fontSize: "12px", lineHeight: 1.6, fontFamily: "inherit",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}>
                  {conv.pinned && <span style={{ fontSize: "10px", color: "#60a5fa", flexShrink: 0 }}>📌</span>}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.title}</span>
                  <span style={{ fontSize: "10px", color: "#5a5a5e", flexShrink: 0 }}>{conv.messages.length}</span>
                </div>
                {/* Right-click context menu */}
                {contextMenuId === conv.id && (
                  <div style={{
                    position: "absolute", right: "8px", top: "100%", zIndex: 100,
                    backgroundColor: "rgba(15,15,20,0.75)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px",
                    padding: "4px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    minWidth: "120px",
                  }} onClick={(e) => e.stopPropagation()}>
                    <div onClick={() => { setContextMenuId(null); onDelete(conv.id); }}
                      style={{
                        padding: "7px 10px", borderRadius: "6px", fontSize: "12px",
                        color: "#ef4444", cursor: "pointer", transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                      删除会话
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Yolo Header (window controls on right) ─────
function YoloHeader({ title, onBack, onToggleSession, onToggleWorkspace, onOpenSettings, onOpenComponents }: {
  title: string; onBack: () => void; onToggleSession: () => void; onToggleWorkspace: () => void; onOpenSettings: () => void; onOpenComponents: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaxRestore = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  const btnBase: React.CSSProperties = {
    width: "28px", height: "28px", borderRadius: "7px", border: "none",
    background: "transparent", color: "#6a6a6e", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
  };
  const winBtn: React.CSSProperties = {
    width: "46px", height: "36px", border: "none",
    background: "transparent", color: "#8a8a8e", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.12s",
  };

  return (
    <div data-tauri-drag-region style={{
      height: "40px", display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 0 0 10px", flexShrink: 0, userSelect: "none",
      backgroundColor: hover ? "rgba(255,255,255,0.03)" : "transparent",
      transition: "background 0.2s",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* ── Left: back | workspace | session | settings ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button onClick={onBack} title="返回默认面板" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div style={{ width: "1px", height: "16px", backgroundColor: "rgba(255,255,255,0.06)" }} />
        <button onClick={onToggleWorkspace} title="工作区" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
        <button onClick={onToggleSession}
          style={{
            ...btnBase, width: "auto", height: "28px", padding: "0 8px", gap: "5px",
            fontSize: "12px", fontWeight: 500, color: "#b0b0b8", letterSpacing: "0.3px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#d0d0d8"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#b0b0b8"; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </button>
        <button onClick={onOpenSettings} title="设置" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
        <button onClick={onOpenComponents} title="组件" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#c0c0c0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      </div>
      {/* ── Right: minimize | maximize/restore | close ── */}
      <div style={{ display: "flex", height: "100%", alignItems: "stretch" }}>
        <button onClick={handleMinimize} style={winBtn}
          title="最小化"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
          <MinimizeIcon />
        </button>
        <button onClick={handleMaxRestore} style={winBtn}
          title={isMaximized ? "还原" : "最大化"}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
          {isMaximized ? <RestoreIcon bgFill="transparent" /> : <MaximizeIcon />}
        </button>
        <button onClick={handleClose} style={{ ...winBtn, marginRight: 0 }}
          title="关闭"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#e81123"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#8a8a8e"; }}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// ── Welcome screen (enhanced) ────────────────
function YoloWelcome() {
  const { t } = useTheme();
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 80); return () => clearTimeout(t); }, []);
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: "24px", padding: "40px 20px",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(12px)",
      transition: "opacity 0.6s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
    }}>
      <div style={{
        width: "60px", height: "2px",
        background: "linear-gradient(90deg, transparent, rgba(100, 200, 255, 0.5), transparent)",
        borderRadius: "1px",
      }} />
      <div style={{
        fontSize: "40px", fontWeight: 200, color: "rgba(255,255,255,0.75)",
        letterSpacing: "4px",
        textShadow: "0 0 60px rgba(150,200,255,0.25), 0 0 120px rgba(100,150,255,0.1)",
      }}>
        {t("yoloWelcome")}
      </div>
      <p style={{
        fontSize: "13px", color: "rgba(255,255,255,0.3)",
        textAlign: "center", maxWidth: "340px", lineHeight: 1.8,
        letterSpacing: "0.5px",
      }}>
        {t("whatToDo")}
      </p>
      <div style={{
        width: "40px", height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(200, 150, 255, 0.3), transparent)",
        borderRadius: "1px", marginTop: "8px",
      }} />
    </div>
  );
}

// ── Main YoloPanel Component ────────────────────
interface Props { onBack?: () => void; }

export default function YoloPanel({ onBack }: Props) {
  const { fontFamily, t, locale, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode, setSessionPath } = useTheme();
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

  const [activeId, setActiveId] = useState<string>(conversations[0].id);
  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  // ── Session management ──────────────────────
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
      const updated = [...prev, conv];
      flushConversations(updated, sessionPath);
      return updated;
    });
    setActiveId(newId);
  }, [locale, sessionPath]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(prev, locale),
          messages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPath);
        setActiveId(fresh.id);
        return [fresh];
      }
      flushConversations(next, sessionPath);
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
  }, [activeId, locale, sessionPath]);
  const [mode, setMode] = useState<Mode>("Chat");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnim, setSettingsAnim] = useState<"enter" | "exit">("enter");
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [componentsAnim, setComponentsAnim] = useState<"enter" | "exit">("enter");
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

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

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setSettingsAnim("enter");
  }, []);

  const openComponents = useCallback(() => {
    setComponentsOpen(true);
    setComponentsAnim("enter");
  }, []);

  const closeComponents = useCallback(() => {
    setComponentsAnim("exit");
    setTimeout(() => {
      setComponentsOpen(false);
      setComponentsAnim("enter");
    }, 250);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsAnim("exit");
    setTimeout(() => {
      setSettingsOpen(false);
      setSettingsAnim("enter");
    }, 250);
  }, []);

  const updateConv = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

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

  function buildApiMessages(prev: Message[], userMsg: Message, sendMode: Mode): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];
    const sp = sendMode === "Agent"
      ? buildAgentSystemPrompt("Agent", selectedModel?.systemPrompt)
      : buildAgentSystemPrompt("Chat", selectedModel?.systemPrompt);
    const kbExtra = prev.find((m) => m.role === "assistant" && m.content.startsWith("[对话历史摘要]"));
    result.push({ role: "system", content: sp + (kbExtra ? `\n\n## 前期对话摘要\n\n${kbExtra.content}` : "") });
    for (const m of prev) {
      if (m.content.startsWith("[对话历史摘要]")) continue;
      if (m.role === "tool") {
        result.push({ role: "user" as const, content: `[工具执行结果 - ${m.toolCallId || "unknown"}]\n${m.toolCallError ? `执行错误：${m.toolCallError}` : m.content}` });
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
          const result = await executeToolCall(call, ac.signal, selectedModel);
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
          const result = await executeToolCall(call, ac.signal, selectedModel);
          updateConv(aid, (c) => ({ ...c, messages: [...c.messages, { id: String(nextMsgId++), role: "tool", content: result.content, toolCallId: call.id, toolCallError: result.error, timestamp: Date.now() } as Message], updatedAt: Date.now() }));
          allToolResults.push({ role: "user", content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}` });
          if (toolCalls.length > 1) await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }

  // ── 自动标题生成 ─────────────────────────────────
  async function generateConversationTitle(
    model: import("../types").ModelConfig,
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
    // 持久化到文件（setTimeout 0 等待 state 更新后再读 ref）
    setTimeout(() => {
      flushConversations(conversationsRef.current, sessionPathRef.current);
    }, 0);
  }

  const handleSend = useCallback(async (text: string, sendMode?: Mode, files?: FileAttachment[]) => {
    if (!activeId || !selectedModel) return;
    const currentMode = sendMode ?? mode;
    if (abortRef.current) abortRef.current.abort();
    const userMsg: Message = { id: String(nextMsgId++), role: "user", content: text, timestamp: Date.now(), files };
    const currentConv = conversations.find((c) => c.id === activeId);
    const prevMessages = currentConv?.messages ?? [];

    // 判断是否需要自动标题：全新会话（无消息）且未标记过
    const needsAutoTitle = currentConv
      && currentConv.messages.length === 0
      && !currentConv.autoTitleDone;

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
          const displayContent = errorMsg.startsWith("[API_ERROR:")
            ? errorMsg
            : `**Error:** ${errorMsg}`;
          updateConv(activeId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === lastStreaming ? { ...m, content: displayContent, streaming: false } : m), updatedAt: Date.now() }));
        }
      }
    } finally {
      setIsStreaming(false);
      streamingMsgIdRef.current = null;
      abortRef.current = null;
      setTimeout(() => flushConversations(conversationsRef.current, sessionPathRef.current), 0);

      // 流式完成后，如需自动标题则调用模型生成
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
  }, [activeId, selectedModel, conversations, updateConv, mode]);

  const handleStop = useCallback(() => { if (abortRef.current) abortRef.current.abort(); }, []);

  const handleSelectFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected: string | null = await open({ directory: true, multiple: false, title: "Select Workspace Folder" });
      if (selected) setSessionPath(selected);
    } catch { /* fallback */ }
  }, [setSessionPath]);

  return (
    <div
      style={{
      position: "fixed", inset: 0, zIndex: 1000,
      display: "flex", flexDirection: "column", fontFamily,
    }}>
      <style>{`
        @keyframes yolo-card-enter {
          0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes yolo-header-enter {
          0%   { opacity: 0; transform: translateY(-6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes yolo-content-enter {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes yolo-input-enter {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes yolo-slide-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes settings-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
      <AuroraBackground />
      <div style={{
        position: "relative", zIndex: 1,
        flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        <div style={{ animation: "yolo-header-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both" }}>
          <YoloHeader title={activeConv?.title ?? "Unison"} onBack={() => onBack?.()} onToggleSession={() => setSessionOpen((v) => !v)} onToggleWorkspace={() => setWorkspaceOpen((v) => !v)} onOpenSettings={openSettings} onOpenComponents={openComponents} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
          <YoloSessionSidebar open={sessionOpen} onClose={() => setSessionOpen(false)} conversations={conversations} activeId={activeId} onSelect={handleSelect} onCreate={handleCreate} onDelete={handleDelete} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} onClick={() => { if (sessionOpen) setSessionOpen(false); }}>
            <WorkspaceDrawer open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} onSelectFolder={handleSelectFolder} />
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
            }}>
              <div key={activeConv ? `yolo-chat-${activeId}` : "yolo-empty"} style={{
                flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
                animation: "yolo-content-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.18s both",
              }}>
                {activeConv && activeConv.messages.length > 0 ? (
                  <YoloChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} onPreviewFile={setPreviewFile} />
                ) : (
                  <YoloWelcome />
                )}
              </div>
              {activeConv && (
                <InputBar onSend={handleSend} onStop={handleStop} disabled={isStreaming} messages={activeConv.messages} maxTokens={selectedModel?.params?.maxTokens} compressionEnabled={compressionEnabled} onToggleCompression={handleToggleCompression} onCompressNow={handleCompressNow} isCompressing={isCompressing} mode={mode} onModeChange={setMode} yolo pendingFiles={pendingFiles} onRemovePendingFile={handleRemovePendingFile} onClearPendingFiles={() => setPendingFiles([])} dragOver={dragOver} />
              )}
            </div>
          </div>
        </div>
        </div>
      {settingsOpen && (
        <div style={{ animation: settingsAnim === "exit" ? "settings-fade-out 0.25s ease both" : undefined }}>
          <SettingsPanel onBack={closeSettings} yolo />
        </div>
      )}
      {componentsOpen && (
        <div style={{ animation: componentsAnim === "exit" ? "settings-fade-out 0.25s ease both" : undefined }}>
          <ComponentsPanel onBack={closeComponents} yolo />
        </div>
      )}
      <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />

    </div>
  );
}
