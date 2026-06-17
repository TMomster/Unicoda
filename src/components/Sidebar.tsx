import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import AuroraLogo from "./AuroraLogo";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  collapsed: boolean;
  width: number;
  conversations: Conversation[];
  activeId: string | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: () => void;
  onResize: (width: number) => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  collapsed,
  width,
  conversations,
  activeId,
  onCreate,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  onToggleCollapse,
  onResize,
  onOpenSettings,
}: Props) {
  const { t, userName, userAvatar, setUserName } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [editingUserName, setEditingUserName] = useState(false);
  const [userNameEditValue, setUserNameEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingUserName && userNameInputRef.current) {
      userNameInputRef.current.focus();
      userNameInputRef.current.select();
    }
  }, [editingUserName]);

  const commitUserName = () => {
    if (userNameEditValue.trim()) {
      setUserName(userNameEditValue.trim());
    }
    setEditingUserName(false);
  };

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuId) return;
    const close = () => setContextMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenuId]);

  const query = search.toLowerCase().trim();

  // Sort & filter: pinned first, then by updatedAt desc; filter by search
  const filtered = [...conversations]
    .filter((c) => !query || c.title.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

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

  // --- Resize handle ---
  const [dragging, setDragging] = useState(false);
  const [dragHovered, setDragHovered] = useState(false);
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      ev.preventDefault();
      onResize(ev.clientX);
    };

    const onMouseUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onDelete(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onDelete]);

  const effectiveWidth = collapsed ? 48 : width;
  const iconBtn: React.CSSProperties = { width: "28px", height: "28px", borderRadius: "6px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", transition: "all 0.15s" };

  // ── Collapsed icon bar (fades on expand) ──
  const collapsedBar = (
    <div style={{ position: "absolute", left: 0, top: 0, width: "48px", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "12px", gap: "12px", opacity: collapsed ? 1 : 0, transition: "opacity 0.18s ease", pointerEvents: collapsed ? "auto" : "none", zIndex: collapsed ? 2 : 1 }}>
      <AuroraLogo size={28} />
      <button onClick={onOpenSettings} title={t("settings")} style={{ ...iconBtn, color: "#5a5a5e" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1e1e22"; e.currentTarget.style.color = "#8a8a8e"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#5a5a5e"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button onClick={onCreate} title={t("newConversation")} style={{ ...iconBtn, color: "#6a6a6e" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1e1e22"; e.currentTarget.style.color = "#a0a0a0"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button onClick={onToggleCollapse} title={t("expandSidebar")} style={{ ...iconBtn, color: "#6a6a6e" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1e1e22")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {/* 收起状态底部用户头像 */}
      <div style={{ marginTop: "auto", marginBottom: "12px" }}>
        <div title={userName}
          style={{ width: "28px", height: "28px", borderRadius: "6px", backgroundColor: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, userSelect: "none", overflow: "hidden" }}>
          {userAvatar ? (
            <img src={userAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            userName.charAt(0)
          )}
        </div>
      </div>
    </div>
  );

  // ── Unified sidebar render ──
  return (
    <div style={{
      width: `${effectiveWidth}px`, minWidth: `${effectiveWidth}px`, height: "100%",
      display: "flex", flexDirection: "column", backgroundColor: "#141417",
      borderRight: "1px solid #2a2a2e", position: "relative", overflow: "hidden",
      transition: "width 0.28s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
      userSelect: dragging ? "none" : undefined,
    }}>
      {collapsedBar}

      {/* Expanded content slides in/out */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
        transform: collapsed ? "translateX(-100%)" : "translateX(0)",
        opacity: collapsed ? 0 : 1,
        transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease 0.05s",
        pointerEvents: collapsed ? "none" : "auto",
      }}>
        {/* Header row */}
        <div style={{ padding: "14px 12px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AuroraLogo size={28} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#c0c0c0" }}>Unison</span>
          </div>
          <button onClick={onToggleCollapse} title={t("collapseSidebar")}
            style={{ width: "24px", height: "24px", borderRadius: "6px", border: "none", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1e1e22")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>

        {/* Conversations view */}
        <div style={{ padding: "0 12px", marginBottom: "10px" }}>
          <button onClick={onOpenSettings} title={t("settings")}
            style={{ width: "100%", padding: "7px 0", borderRadius: "8px", border: "1px solid #2a2a2e", background: "transparent", color: "#6a6a6e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1e1e22"; e.currentTarget.style.color = "#a0a0a0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t("sidebarSettings")}
          </button>
        </div>

        <div style={{ padding: "0 12px 10px" }}>
          <button onClick={onCreate}
            style={{ width: "100%", padding: "8px 0", borderRadius: "8px", border: "none", backgroundColor: "#2563eb", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1d4ed8")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#2563eb")}>
            {t("newChat")}
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", borderRadius: "8px", backgroundColor: "#1a1a1e", border: "1px solid #2a2a2e" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a5a5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchConversations")}
              style={{ flex: 1, border: "none", background: "transparent", color: "#c0c0c0", fontSize: "13px", outline: "none", fontFamily: "inherit" }} />
          </div>
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: "13px", color: "#5a5a5e" }}>
              {query ? t("noMatchConversations") : t("noConversations")}
            </div>
          )}
          {filtered.map((conv) => (
            <div key={conv.id} style={{ position: "relative" }}>
              <div onClick={() => onSelect(conv.id)} onDoubleClick={() => startRename(conv)} onContextMenu={(e) => { e.preventDefault(); setContextMenuId(conv.id); }}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", cursor: "pointer", marginBottom: "2px", backgroundColor: activeId === conv.id ? "#1e1e22" : "transparent", transition: "background 0.15s" }}
                onMouseEnter={(e) => { if (activeId !== conv.id) e.currentTarget.style.backgroundColor = "#1a1a1e"; }}
                onMouseLeave={(e) => { if (activeId !== conv.id) e.currentTarget.style.backgroundColor = "transparent"; }}>
                {conv.pinned && <span style={{ fontSize: "12px", flexShrink: 0 }}>📌</span>}
                {editingId === conv.id ? (
                  <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, background: "#1a1a1e", border: "1px solid #3a3a3e", borderRadius: "4px", color: "#e0e0e0", fontSize: "13px", padding: "2px 6px", outline: "none", fontFamily: "inherit" }} />
                ) : (
                  <span style={{ flex: 1, fontSize: "13px", color: activeId === conv.id ? "#e0e0e0" : "#a0a0a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.title}</span>
                )}
                <span style={{ fontSize: "11px", color: "#5a5a5e", flexShrink: 0 }}>{conv.messages.length}</span>
              </div>
              {contextMenuId === conv.id && (
                <div style={{ position: "absolute", right: "8px", top: "100%", zIndex: 100, backgroundColor: "#1e1e22", border: "1px solid #39393e", borderRadius: "8px", padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", minWidth: "130px" }} onClick={(e) => e.stopPropagation()}>
                  <CMItem onClick={() => { startRename(conv); setContextMenuId(null); }}>{t("contextRename")}</CMItem>
                  <CMItem onClick={() => { onTogglePin(conv.id); setContextMenuId(null); }}>{conv.pinned ? t("contextUnpin") : t("contextPin")}</CMItem>
                  <div style={{ height: "1px", backgroundColor: "#2a2a2e", margin: "4px 0" }} />
                  <CMItem danger onClick={() => { setConfirmDeleteId(conv.id); setContextMenuId(null); }}>{t("contextDelete")}</CMItem>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 用户信息 - 底部 */}
        <div style={{ borderTop: "1px solid #2a2a2e", padding: "10px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "5px", backgroundColor: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, flexShrink: 0, userSelect: "none", overflow: "hidden" }}>
              {userAvatar ? (
                <img src={userAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                userName.charAt(0)
              )}
            </div>
            {editingUserName ? (
              <input ref={userNameInputRef} value={userNameEditValue} onChange={(e) => setUserNameEditValue(e.target.value)}
                onBlur={commitUserName}
                onKeyDown={(e) => { if (e.key === "Enter") commitUserName(); if (e.key === "Escape") setEditingUserName(false); }}
                style={{ flex: 1, background: "#1a1a1e", border: "1px solid #3a3a3e", borderRadius: "4px", color: "#e0e0e0", fontSize: "13px", padding: "3px 6px", outline: "none", fontFamily: "inherit" }} />
            ) : (
              <span onClick={() => { setEditingUserName(true); setUserNameEditValue(userName); }}
                style={{ flex: 1, fontSize: "13px", color: "#a0a0a0", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "none", padding: "2px 0" }}
                title={t("clickToEdit")}>
                {userName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <ConfirmDialog
          title={t("deleteConfirmTitle")}
          message={t("deleteConfirmMessage")}
          confirmText={t("deleteConfirm")}
          cancelText={t("cancel")}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
          danger
        />
      )}

      {/* Drag handle */}
      <div onMouseDown={handleResizeStart} onMouseEnter={() => setDragHovered(true)} onMouseLeave={() => setDragHovered(false)}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "5px", cursor: "col-resize", zIndex: 50 }}>
        <div style={{ position: "absolute", right: "1px", top: 0, bottom: 0, width: "2px", backgroundColor: dragging || dragHovered ? "#3a3a3e" : "transparent", transition: "background 0.15s" }} />
      </div>
    </div>
  );
}

function CMItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "7px 10px",
        borderRadius: "6px",
        fontSize: "13px",
        color: danger ? "#ef4444" : "#c0c0c0",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2e")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {children}
    </div>
  );
}
