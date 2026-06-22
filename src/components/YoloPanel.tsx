import { useState, useRef, useEffect, useCallback } from "react";
import ConfirmDialog from "./ConfirmDialog";
import type { Conversation, Message, Mode, FileAttachment } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import { useSecurity } from "../contexts/SecurityContext";
import { useModels } from "../contexts/ModelContext";
import { useChatStream, setNextMsgId, type ChatStreamReturn } from "../hooks/useChatStream";
import { hasCompressionSummary } from "../services/conversationCompression";
import {
  loadMetadata, loadLiteralMessages, loadMemoryMessages,
  flushConversationData, deleteConversationFiles, migrateFromOldFormat, toMeta,
  type ConversationMeta,
} from "../services/conversationStorage";
import { updateUnicodaStatus } from "../modules/builtins/getUnicodaStatus";
import { updateWorkspacePath } from "../modules/builtins/getWorkspaceInfo";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "../constants/windowIcons";
import AuroraBackground from "./AuroraBackground";
import YoloChatPanel from "./YoloChatPanel";
import InputBar from "./InputBar";
import SettingsPanel from "./SettingsPanel";
import ComponentsPanel from "./ComponentsPanel";
import FilePreviewPanel from "./FilePreviewPanel";
import PrintDialog from "./PrintDialog";

let nextConvId = 1;

function makeConvTitle(existing: Conversation[], locale: string): string {
  const prefix = locale === "zh-CN" ? "新会话" : locale === "de-DE" ? "Neue Sitzung" : "New Session";
  const pattern = locale === "zh-CN" ? /^新会话-(\d+)$/ : locale === "de-DE" ? /^Neue Sitzung-(\d+)$/ : /^New Session-(\d+)$/;
  const nums = new Set<number>();
  for (const c of existing) { const m = c.title.match(pattern); if (m) nums.add(parseInt(m[1], 10)); }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}-${n}`;
}

// ── Workspace Drawer (glass consistent) ──────
function WorkspaceDrawer({ open, onClose, onSelectFolder, workspacePath }: {
  open: boolean; onClose: () => void; onSelectFolder: () => void; workspacePath: string;
}) {
  const { t } = useTheme();
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
              <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.92)", letterSpacing: "0.3px" }}>
                {t("yoloWorkspace")}
              </span>
            </div>
            <button onClick={onClose}
              style={{ width: "26px", height: "26px", borderRadius: "6px", border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div style={{
            padding: "12px 16px", borderRadius: "8px",
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            fontSize: "12px", color: "rgba(255,255,255,0.72)", lineHeight: 1.8,
          }}>
            {workspacePath ? (
              <span style={{ wordBreak: "break-all", color: "rgba(255,255,255,0.82)" }}>{workspacePath}</span>
            ) : (
              <span style={{ color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>{t("yoloNoWorkspace")}</span>
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

          <div style={{ marginTop: "10px", fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6, textAlign: "center" }}>
            {t("yoloWorkspaceDesc")}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Yolo session sidebar (slides from left) ───
function YoloSessionSidebar({ open, onClose, conversations, activeId, onSelect, onCreate, onDelete, onRename, onTogglePin, onBatchDelete, onBatchTogglePin }: {
  open: boolean; onClose: () => void;
  conversations: Conversation[]; activeId: string;
  onSelect: (id: string) => void; onCreate: () => void; onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onBatchTogglePin: (ids: string[], pin: boolean) => void;
}) {
  const { t } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenuId) return;
    const close = () => setContextMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenuId]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const sorted = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  return (
    <div style={{
      width: open ? "260px" : "0",
      overflow: "hidden",
      flexShrink: 0,
      transition: "width 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "260px",
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
          <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.88)", letterSpacing: "0.3px" }}>{t("sessions")}</span>
          <button onClick={onClose}
            style={{ width: "24px", height: "24px", borderRadius: "6px", border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
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
            <span>{t("newSession")}</span>
          </button>
        </div>

        {/* Batch Toolbar */}
        <div style={{ padding: "0 8px 8px", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <button onClick={() => {
            const allIds = sorted.map((c) => c.id);
            if (selectedIds.size === allIds.length) {
              setSelectedIds(new Set());
            } else {
              setSelectedIds(new Set(allIds));
              setLastClickedId(null);
            }
          }}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.72)", cursor: "pointer", fontSize: "11px", transition: "all 0.15s", fontFamily: "inherit", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
            {selectedIds.size === sorted.length ? t("batchDeselectAll") : t("batchSelectAll")}
          </button>
          {selectedIds.size > 0 && (
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", flex: 1, textAlign: "right" }}>
              {t("batchSelected").replace("{0}", String(selectedIds.size))}
            </span>
          )}
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {sorted.map((conv) => {
            const isActive = conv.id === activeId;
            const isSelected = selectedIds.has(conv.id);
            return (
              <div key={conv.id + conv.title} style={{ position: "relative" }}>
                <div
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('[data-checkbox]')) {
                      if (e.shiftKey && lastClickedId) {
                        const ordered = sorted.map((c) => c.id);
                        const currI = ordered.indexOf(conv.id);
                        const prevI = ordered.indexOf(lastClickedId);
                        const [start, end] = currI < prevI ? [currI, prevI] : [prevI, currI];
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          const willSelect = !next.has(conv.id);
                          for (let i = start; i <= end; i++) {
                            if (willSelect) next.add(ordered[i]);
                            else next.delete(ordered[i]);
                          }
                          return next;
                        });
                      } else {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(conv.id)) next.delete(conv.id); else next.add(conv.id);
                          return next;
                        });
                      }
                      setLastClickedId(conv.id);
                      return;
                    }
                    onSelect(conv.id);
                    onClose();
                  }}
                  onDoubleClick={() => startRename(conv)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenuId(conv.id); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "8px 10px", borderRadius: "6px", cursor: "pointer",
                    marginBottom: "2px",
                    backgroundColor: isSelected ? "rgba(37,99,235,0.18)" : isActive ? "rgba(37,99,235,0.10)" : "transparent",
                    color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.82)",
                    fontSize: "12px", lineHeight: 1.6, fontFamily: "inherit",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!isActive && !isSelected) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!isActive && !isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}>
                  {/* Checkbox */}
                  <div data-checkbox style={{
                    width: "16px", height: "16px", borderRadius: "4px",
                    border: isSelected ? "none" : "1.5px solid #4a4a4e",
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    backgroundColor: isSelected ? "#3b82f6" : "transparent",
                    transition: "all 0.12s",
                  }}>
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  {conv.pinned && <span style={{ fontSize: "10px", flexShrink: 0 }}>📌</span>}
                  {editingId === conv.id ? (
                    <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: "4px", color: "rgba(255,255,255,0.95)", fontSize: "12px", padding: "2px 6px",
                        outline: "none", fontFamily: "inherit",
                      }} />
                  ) : (
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isSelected || isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.82)" }}>{conv.title}</span>
                  )}
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>{conv.messages.length}</span>
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
                    <div onClick={() => { startRename(conv); setContextMenuId(null); }}
                      style={{ padding: "7px 10px", borderRadius: "6px", fontSize: "12px", color: "rgba(255,255,255,0.92)", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                      {t("contextRename")}
                    </div>
                    <div onClick={() => { onTogglePin(conv.id); setContextMenuId(null); }}
                      style={{ padding: "7px 10px", borderRadius: "6px", fontSize: "12px", color: "rgba(255,255,255,0.92)", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                      {conv.pinned ? t("contextUnpin") : t("contextPin")}
                    </div>
                    <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
                    <div onClick={() => { setContextMenuId(null); onDelete(conv.id); }}
                      style={{ padding: "7px 10px", borderRadius: "6px", fontSize: "12px", color: "#ef4444", cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}>
                      {t("contextDelete")}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Batch Action Bar */}
        {selectedIds.size > 0 && (
          <div style={{ padding: "8px 8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={() => {
              const allPinned = sorted.filter((c) => selectedIds.has(c.id)).every((c) => c.pinned);
              onBatchTogglePin(Array.from(selectedIds), !allPinned);
              setSelectedIds(new Set());
            }}
              style={{ flex: 1, padding: "8px 0", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.82)", cursor: "pointer", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
              {sorted.filter((c) => selectedIds.has(c.id)).every((c) => c.pinned) ? t("batchUnpin") : t("batchPin")}
            </button>
            <button onClick={() => setConfirmBatchDelete(true)}
              style={{ flex: 1, padding: "8px 0", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.06)"; e.currentTarget.style.borderColor = "#ef4444"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}>
              {t("batchDelete")}
            </button>
          </div>
        )}
      </div>

      {/* Confirm batch delete dialog */}
      {confirmBatchDelete && (
        <ConfirmDialog
          title={t("batchDelete")}
          message={t("batchDeleteConfirm").replace("{0}", String(selectedIds.size))}
          confirmText={t("confirmDelete")}
          cancelText={t("cancel")}
          danger
          onConfirm={() => {
            onBatchDelete(Array.from(selectedIds));
            setSelectedIds(new Set());
            setConfirmBatchDelete(false);
          }}
          onCancel={() => setConfirmBatchDelete(false)}
        />
      )}
    </div>
  );
}

// ── Yolo Header (window controls on right) ─────
function YoloHeader({ title, onBack, onToggleSession, onToggleWorkspace, onOpenSettings, onOpenComponents, onPrint }: {
  title: string; onBack: () => void; onToggleSession: () => void; onToggleWorkspace: () => void; onOpenSettings: () => void; onOpenComponents: () => void; onPrint: () => void;
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
    background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
  };
  const winBtn: React.CSSProperties = {
    width: "46px", height: "36px", border: "none",
    background: "transparent", color: "rgba(255,255,255,0.72)", cursor: "pointer",
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
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div style={{ width: "1px", height: "16px", backgroundColor: "rgba(255,255,255,0.06)" }} />
        <button onClick={onToggleWorkspace} title="工作区" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        </button>
        <button onClick={onToggleSession}
          style={{
            ...btnBase, width: "auto", height: "28px", padding: "0 8px", gap: "5px",
            fontSize: "12px", fontWeight: 500, color: "rgba(255,255,255,0.88)", letterSpacing: "0.3px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.95)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.88)"; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </button>
        <button onClick={onOpenSettings} title="设置" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
        <button onClick={onOpenComponents} title="组件" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button onClick={onPrint} title="打印" style={btnBase}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
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
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.72)"; }}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// ── Welcome screen (enhanced) ────────────────
function YoloWelcome({ subtitle }: { subtitle: string }) {
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
        fontSize: "40px", fontWeight: 200, color: "rgba(255,255,255,0.95)",
        letterSpacing: "4px",
        textShadow: "0 0 60px rgba(150,200,255,0.35), 0 0 120px rgba(100,150,255,0.15)",
      }}>
        {t("yoloWelcome")}
      </div>
      <p style={{
        fontSize: "13px", color: "rgba(255,255,255,0.7)",
        textAlign: "center", maxWidth: "340px", lineHeight: 1.8,
        letterSpacing: "0.5px",
      }}>
        {subtitle}
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
  const { fontFamily, t, locale, preferredLanguage, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode } = useTheme();
  const { securityEnabled } = useSecurity();
  const { models, selectedModelId } = useModels();
  const selectedModel = models.find((m) => m.id === selectedModelId);

  // ── withMsgUpdate: 同时更新 messages 和 memoryMessages ──
  const withMsgUpdate = useCallback((c: Conversation, fn: (msgs: Message[]) => Message[]) => {
    const newMsgs = fn(c.messages);
    const oldMemoryMsgs = c.memoryMessages ?? c.messages;
    const newMemoryMsgs = fn(oldMemoryMsgs);
    return {
      ...c,
      messages: newMsgs,
      memoryMessages: hasCompressionSummary(newMemoryMsgs) ? oldMemoryMsgs : newMemoryMsgs,
      updatedAt: Date.now(),
    };
  }, []);

  // ── Conversations ────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem("unicoda-yolo-conversations-meta");
      if (raw) {
        const metas: ConversationMeta[] = JSON.parse(raw);
        if (metas.length > 0) {
          const loaded: Conversation[] = metas.map((m) => ({
            ...m,
            messages: [],
            memoryMessages: [],
          }));
          for (const c of loaded) {
            const idNum = parseInt(c.id, 10);
            if (idNum >= nextConvId) nextConvId = idNum + 1;
          }
          return loaded;
        }
      }
    } catch { /* ignore */ }
    return [{ id: String(nextConvId++), title: makeConvTitle([], locale), messages: [], memoryMessages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }];
  });

  const [activeId, setActiveId] = useState<string>("");

  const initialLoadDone = useRef(false);
  const loadedConvIds = useRef(new Set<string>());
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    (async () => {
      // 1. 迁移旧格式
      await migrateFromOldFormat("unicoda-yolo-conversations", "yolo", sessionPath);

      // 2. 加载元数据
      const freshMetas = await loadMetadata("yolo", sessionPath);
      if (freshMetas.length > 0) {
        const loaded: Conversation[] = freshMetas.map((m) => ({
          ...m,
          messages: [],
          memoryMessages: [],
        }));
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
        }
        setConversations(loaded);
        try { localStorage.setItem("unicoda-yolo-conversations-meta", JSON.stringify(freshMetas)); } catch { /* ignore */ }
        return;
      }

      // 3. 兜底：尝试旧格式（兼容从未迁移的数据）
      if (sessionPath) {
        try {
          const { readConfigFile } = await import("../utils/configStorage");
          const oldKey = "unicoda-yolo-conversations";
          const loaded = await readConfigFile<Conversation[]>(oldKey, [], sessionPath);
          if (loaded.length > 0) {
            loaded.forEach((c) => { c.memoryMessages = c.memoryMessages ?? []; });
            setConversations(loaded);
            for (const c of loaded) {
              const idNum = parseInt(c.id, 10);
              if (idNum >= nextConvId) nextConvId = idNum + 1;
              // 同步消息 ID 到 hook 模块级变量
              const allMsgs = [...c.messages, ...(c.memoryMessages ?? [])];
              const maxId = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => parseInt(m.id, 10))) : 0;
              setNextMsgId(maxId);
            }
          }
        } catch { /* ignore */ }
      }
    })();
  }, [sessionPath]);

  // 4. 当前活跃会话的消息体按需加载（每个会话只加载一次）
  useEffect(() => {
    if (!activeId || loadedConvIds.current.has(activeId)) return;
    const id = activeId;
    loadedConvIds.current.add(activeId);
    (async () => {
      const literalMsgs = await loadLiteralMessages(id, "yolo", sessionPath);
      const memoryMsgs = await loadMemoryMessages(id, "yolo", sessionPath);
      if (literalMsgs || memoryMsgs) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: literalMsgs ?? c.messages,
                  memoryMessages: memoryMsgs ?? literalMsgs ?? c.messages,
                }
              : c,
        ),
        );
        // 初始化 nextMsgId，避免新消息 ID 与已加载消息冲突
        const msgsToScan = literalMsgs ?? [];
        const memMsgsToScan = memoryMsgs ?? [];
        const allIds = [...msgsToScan, ...memMsgsToScan].map(m => parseInt(m.id, 10));
        const maxId = allIds.length > 0 ? Math.max(...allIds) : 0;
        setNextMsgId(maxId);
      }
    })();
  }, [sessionPath, activeId]);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sessionPathRef = useRef(sessionPath);
  sessionPathRef.current = sessionPath;

  // ref holds chatStream before its hook call, preventing TDZ in handleSelect
  const chatStreamRef = useRef<ChatStreamReturn>(null!);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  // ── Session management ──────────────────────
  const handleCreate = useCallback(() => {
    const newId = String(nextConvId++);
    const pathRef = sessionPathRef.current;
    setConversations((prev) => {
      const conv: Conversation = {
        id: newId,
        title: makeConvTitle(prev, locale),
        messages: [],
        memoryMessages: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspacePath: undefined,
      };
      const updated = [...prev, conv];
      flushConversations(updated, pathRef);
      return updated;
    });
    setActiveId(newId);
  }, [locale]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    chatStreamRef.current.resetPermissionRefs();
  }, []);

  const handleDelete = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (sessionPathRef.current) {
        deleteConversationFiles(id, "yolo", sessionPathRef.current);
      }
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(prev, locale),
          messages: [],
          memoryMessages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPathRef.current);
        setActiveId("");
        return [fresh];
      }
      flushConversations(next, sessionPathRef.current);
      if (activeId === id) setActiveId("");
      return next;
    });
  }, [activeId, locale]);

  const updateConv = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  const handleRename = useCallback((id: string, title: string) => {
    updateConv(id, (c) => ({ ...c, title, updatedAt: Date.now() }));
    flushConversations(conversationsRef.current, sessionPathRef.current);
  }, [updateConv]);

  const handleTogglePin = useCallback((id: string) => {
    updateConv(id, (c) => ({ ...c, pinned: !c.pinned, updatedAt: Date.now() }));
    flushConversations(conversationsRef.current, sessionPathRef.current);
  }, [updateConv]);

  const handleBatchDelete = useCallback((ids: string[]) => {
    setConversations((prev) => {
      let next = prev.filter((c) => !ids.includes(c.id));
      ids.forEach((id) => {
        if (sessionPathRef.current) {
          deleteConversationFiles(id, "yolo", sessionPathRef.current);
        }
      });
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(prev, locale),
          messages: [],
          memoryMessages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPathRef.current);
        setActiveId("");
        return [fresh];
      }
      flushConversations(next, sessionPathRef.current);
      if (ids.includes(activeId)) setActiveId("");
      return next;
    });
  }, [activeId, locale]);

  const handleBatchTogglePin = useCallback((ids: string[], pin: boolean) => {
    setConversations((prev) => {
      const next = prev.map((c) =>
        ids.includes(c.id) ? { ...c, pinned: pin, updatedAt: Date.now() } : c,
      );
      flushConversations(next, sessionPathRef.current);
      return next;
    });
  }, []);

  const [mode, setMode] = useState<Mode>("Chat");

  // 同步工作状态到 getUnicodaStatus 模组（Yolo 模式下 panelMode 固定为 "Yolo"）
  useEffect(() => {
    updateUnicodaStatus({ panelMode: "Yolo", mode });
  }, [mode]);

  // 同步工作区路径到 getWorkspaceInfo 模组
  useEffect(() => {
    updateWorkspacePath(activeConv?.workspacePath || "");
  }, [activeConv?.workspacePath]);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnim, setSettingsAnim] = useState<"enter" | "exit">("enter");
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [componentsAnim, setComponentsAnim] = useState<"enter" | "exit">("enter");
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  /** 防抖落盘：同时保存元数据和当前活跃会话的消息体 */
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushConversations = useCallback(
    (convs: Conversation[], path: string) => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(async () => {
        flushTimerRef.current = null;
        // 从 ref 读取最新 activeId，避免 debounce 闭包捕获过期值
        const latestActiveId = activeIdRef.current;
        const activeConv = convs.find((c) => c.id === latestActiveId) ?? null;
        const metas = convs.map(toMeta);
        await flushConversationData(activeConv, metas, "yolo", path);
        try { localStorage.setItem("unicoda-yolo-conversations-meta", JSON.stringify(metas)); } catch { /* ignore */ }
      }, 100);
    },
    [], // 无依赖：所有需要的最新值通过 ref 读取
  );

  // ── Security 审批流程（由 UnicodaSecurity 全权负责） ──
  const securityMonitoring = securityEnabled;

  // ── Chat stream hook ──────────────────────────────
  const chatStream = useChatStream({
    updateConv,
    conversations,
    conversationsRef,
    setConversations,
    selectedModel,
    mode,
    preferredLanguage,
    developerMode,
    panelMode: "Yolo",
    workspacePath: activeConv?.workspacePath || undefined,
    workMode: "yolo",
    sessionPath: sessionPathRef.current,
    locale,
    flushConvs: flushConversations,
    withMsgUpdate,
    securityMonitoring,
  });
  chatStreamRef.current = chatStream;

  const handleSendWrapper = useCallback(
    (text: string, sendMode?: Mode, files?: FileAttachment[]) => {
      chatStream.handleSend(text, activeId, sendMode, files);
    },
    [chatStream.handleSend, activeId],
  );

  const handleCompressNowWrapper = useCallback(() => {
    chatStream.handleCompressNow(activeId);
  }, [chatStream.handleCompressNow, activeId]);

  // ── Ctrl+P Print Dialog ──
  const handleCreateRef = useRef(handleCreate);
  handleCreateRef.current = handleCreate;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        handleCreateRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        if (!activeConv) return;
        setPrintOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeConv]);

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

  const handlePrint = useCallback(() => {
    if (!activeConv) return;
    setPrintOpen(true);
  }, [activeConv]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected: string | null = await open({ directory: true, multiple: false, title: "Select Workspace Folder" });
      if (selected && activeId) {
        // 更新当前会话的独立工作区路径
        updateConv(activeId, (c) => ({
          ...c,
          workspacePath: selected,
          updatedAt: Date.now(),
        }));
        // workspacePath 是 Yolo 模式的项目工作区，与会话存储路径 sessionPath 无关
      }
    } catch { /* fallback */ }
  }, [activeId, updateConv]);

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
          <YoloHeader title={activeConv?.title ?? "Unicoda"} onBack={() => onBack?.()} onToggleSession={() => setSessionOpen((v) => !v)} onToggleWorkspace={() => setWorkspaceOpen((v) => !v)} onOpenSettings={openSettings} onOpenComponents={openComponents} onPrint={handlePrint} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
          <YoloSessionSidebar open={sessionOpen} onClose={() => setSessionOpen(false)} conversations={conversations} activeId={activeId} onSelect={handleSelect} onCreate={handleCreate} onDelete={handleDelete} onRename={handleRename} onTogglePin={handleTogglePin} onBatchDelete={handleBatchDelete} onBatchTogglePin={handleBatchTogglePin} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} onClick={() => { if (sessionOpen) setSessionOpen(false); }}>
            <WorkspaceDrawer open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} onSelectFolder={handleSelectFolder} workspacePath={activeConv?.workspacePath || ""} />
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
            }}>
              <div key={activeConv ? `yolo-chat-${activeId}` : "yolo-empty"} style={{
                flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
                animation: "yolo-content-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.18s both",
              }}>
                {activeConv && activeConv.messages.length > 0 ? (
                  <YoloChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} onPreviewFile={setPreviewFile} isStreaming={chatStream.isStreaming} />
                ) : !activeConv ? (
                  <YoloWelcome subtitle={t("whatToDo")} />
                ) : (
                  <YoloWelcome subtitle={t("startNewChat")} />
                )}
              </div>
              {activeConv && (
                <InputBar key={activeId} onSend={handleSendWrapper} onStop={chatStream.handleStop} disabled={chatStream.isStreaming} messages={activeConv.messages} memoryMessages={activeConv.memoryMessages ?? activeConv.messages} maxTokens={selectedModel?.params?.maxTokens} compressionEnabled={chatStream.compressionEnabled} onToggleCompression={chatStream.handleToggleCompression} onCompressNow={handleCompressNowWrapper} isCompressing={chatStream.isCompressing} mode={mode} onModeChange={setMode} yolo preferredLanguage={preferredLanguage} pendingFiles={chatStream.pendingFiles} onRemovePendingFile={chatStream.handleRemovePendingFile} onClearPendingFiles={chatStream.clearPendingFiles} dragOver={chatStream.dragOver} />
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
      {printOpen && activeConv && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, backgroundColor: "var(--c-bg)" }}>
          <PrintDialog
            messages={activeConv.messages}
            modelName={selectedModel?.name}
            userName={userName}
            t={t}
            onClose={() => setPrintOpen(false)}
          />
        </div>
      )}
      <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />

    </div>
  );
}
