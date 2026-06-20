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
  onBatchDelete: (ids: string[]) => void;
  onBatchTogglePin: (ids: string[], pin: boolean) => void;
  onToggleCollapse: () => void;
  onResize: (width: number) => void;
  onOpenSettings: () => void;
  onOpenComponents: () => void;
  onTogglePanel: () => void;
  onPrint: () => void;
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
  onBatchDelete,
  onBatchTogglePin,
  onToggleCollapse,
  onResize,
  onOpenSettings,
  onOpenComponents,
  onTogglePanel,
  onPrint,
}: Props) {
  const { t, userName, userAvatar, setUserName } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [editingUserName, setEditingUserName] = useState(false);
  const [userNameEditValue, setUserNameEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
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
      <AuroraLogo size={28} onClick={onTogglePanel} title={t("yoloPanel")} />
      <button onClick={onOpenSettings} title={t("settings")} style={{ ...iconBtn, color: "var(--c-t4)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t4)"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button onClick={onOpenComponents} title={t("components")} style={{ ...iconBtn, color: "var(--c-t4)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t4)"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button onClick={onCreate} title={t("newConversation")} style={{ ...iconBtn, color: "var(--c-t5)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button onClick={onPrint} title={t("print")} style={{ ...iconBtn, color: "var(--c-t5)" }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" />
        </svg>
      </button>
      <button onClick={onToggleCollapse} title={t("expandSidebar")} style={{ ...iconBtn, color: "var(--c-t5)" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--c-bg3)")}
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
      display: "flex", flexDirection: "column", backgroundColor: "var(--c-bg)",
      borderRight: "1px solid var(--c-bd)", position: "relative", overflow: "hidden",
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
            <AuroraLogo size={28} onClick={onTogglePanel} title={t("yoloPanel")} style={{ cursor: "pointer" }} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--c-txt)" }}>Unicoda</span>
          </div>
          <button onClick={onToggleCollapse} title={t("collapseSidebar")}
            style={{ width: "24px", height: "24px", borderRadius: "6px", border: "none", background: "transparent", color: "var(--c-t5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--c-bg3)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </div>

        {/* Conversations view */}
        <div style={{ padding: "0 12px", marginBottom: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <button onClick={onOpenSettings} title={t("settings")}
            style={{ width: "100%", padding: "7px 0", borderRadius: "8px", border: "1px solid var(--c-bd)", background: "transparent", color: "var(--c-t5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t("sidebarSettings")}
          </button>
          <button onClick={onOpenComponents} title={t("components")}
            style={{ width: "100%", padding: "7px 0", borderRadius: "8px", border: "1px solid var(--c-bd)", background: "transparent", color: "var(--c-t5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            {t("components")}
          </button>
          <button onClick={onPrint} title={t("print")}
            style={{ width: "100%", padding: "7px 0", borderRadius: "8px", border: "1px solid var(--c-bd)", background: "transparent", color: "var(--c-t5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-t2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" />
            </svg>
            {t("print")}
          </button>
        </div>

        <div style={{ padding: "0 12px 10px" }}>
          <button onClick={onCreate}
            style={{ width: "100%", padding: "8px 0", borderRadius: "8px", border: "none", backgroundColor: "var(--c-ac)", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "background 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--c-ah)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--c-ac)")}>
            {t("newChat")}
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", borderRadius: "8px", backgroundColor: "var(--c-bg2)", border: "1px solid var(--c-bd)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-t4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchConversations")}
              style={{ flex: 1, border: "none", background: "transparent", color: "var(--c-txt)", fontSize: "13px", outline: "none", fontFamily: "inherit" }} />
          </div>
        </div>

        {/* Batch Toolbar */}
        <div style={{ padding: "0 8px 8px", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <button onClick={() => {
            const allFilteredIds = filtered.map((c) => c.id);
            if (selectedIds.size === allFilteredIds.length) {
              setSelectedIds(new Set());
            } else {
              setSelectedIds(new Set(allFilteredIds));
              setLastClickedId(null);
            }
          }}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--c-bd)", background: "transparent", color: "var(--c-t2)", cursor: "pointer", fontSize: "11px", transition: "all 0.15s", fontFamily: "inherit", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
            {selectedIds.size === filtered.length ? t("batchDeselectAll") : t("batchSelectAll")}
          </button>
          {selectedIds.size > 0 && (
            <span style={{ fontSize: "11px", color: "var(--c-t5)", flex: 1, textAlign: "right" }}>
              {t("batchSelected").replace("{0}", String(selectedIds.size))}
            </span>
          )}
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: "13px", color: "var(--c-t4)" }}>
              {query ? t("noMatchConversations") : t("noConversations")}
            </div>
          )}
          {filtered.map((conv) => {
            const isSelected = selectedIds.has(conv.id);
            return (
            <div key={conv.id} style={{ position: "relative" }}>
              <div onClick={(e) => {
                // 点击选框区域 -> 切换选中
                const target = e.target as HTMLElement;
                if (target.closest('[data-checkbox]')) {
                  if (e.shiftKey && lastClickedId) {
                    // Shift 范围选择
                    const ordered = filtered.map((c) => c.id);
                    const currI = ordered.indexOf(conv.id);
                    const prevI = ordered.indexOf(lastClickedId);
                    const [start, end] = currI < prevI ? [currI, prevI] : [prevI, currI];
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      // 如果当前项已选中则取消选中范围，否则选中范围
                      const willSelect = !next.has(conv.id);
                      for (let i = start; i <= end; i++) {
                        if (willSelect) next.add(ordered[i]);
                        else next.delete(ordered[i]);
                      }
                      return next;
                    });
                  } else {
                    // 普通点击切换
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(conv.id)) next.delete(conv.id); else next.add(conv.id);
                      return next;
                    });
                  }
                  setLastClickedId(conv.id);
                  return;
                }
                // 点击标题区域 -> 导航
                onSelect(conv.id);
              }} onDoubleClick={() => startRename(conv)} onContextMenu={(e) => { e.preventDefault(); setContextMenuId(conv.id); }}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", cursor: "pointer", marginBottom: "2px", backgroundColor: isSelected ? "#1e3a5f" : (activeId === conv.id ? "var(--c-bg3)" : "transparent"), transition: "background 0.15s" }}
                onMouseEnter={(e) => { if (!isSelected && activeId !== conv.id) e.currentTarget.style.backgroundColor = "var(--c-bg2)"; }}
                onMouseLeave={(e) => { if (!isSelected && activeId !== conv.id) e.currentTarget.style.backgroundColor = "transparent"; }}>
                {/* 始终显示复选框 */}
                <div data-checkbox style={{ width: "16px", height: "16px", borderRadius: "4px", border: isSelected ? "none" : "1.5px solid #4a4a4e", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? "var(--c-ac)" : "transparent", transition: "all 0.15s" }}>
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {conv.pinned && <span style={{ fontSize: "12px", flexShrink: 0 }}>📌</span>}
                {editingId === conv.id ? (
                  <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, background: "var(--c-bg2)", border: "1px solid var(--c-bd2)", borderRadius: "4px", color: "var(--c-txt)", fontSize: "13px", padding: "2px 6px", outline: "none", fontFamily: "inherit" }} />
                ) : (
                  <span style={{ flex: 1, fontSize: "13px", color: isSelected ? "var(--c-txt)" : (activeId === conv.id ? "var(--c-txt)" : "var(--c-t2)"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.title}</span>
                )}
                <span style={{ fontSize: "11px", color: "var(--c-t4)", flexShrink: 0 }}>{conv.messages.length}</span>
              </div>
              {contextMenuId === conv.id && (
                <div style={{ position: "absolute", right: "8px", top: "100%", zIndex: 100, backgroundColor: "var(--c-bg3)", border: "1px solid var(--c-bd2)", borderRadius: "8px", padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", minWidth: "130px" }} onClick={(e) => e.stopPropagation()}>
                  <CMItem onClick={() => { startRename(conv); setContextMenuId(null); }}>{t("contextRename")}</CMItem>
                  <CMItem onClick={() => { onTogglePin(conv.id); setContextMenuId(null); }}>{conv.pinned ? t("contextUnpin") : t("contextPin")}</CMItem>
                  <div style={{ height: "1px", backgroundColor: "var(--c-bd)", margin: "4px 0" }} />
                  <CMItem danger onClick={() => { setConfirmDeleteId(conv.id); setContextMenuId(null); }}>{t("contextDelete")}</CMItem>
                </div>
              )}
            </div>
            );
          })}
        </div>

        {/* Batch Action Bar */}
        {selectedIds.size > 0 && (
          <div style={{ padding: "8px 8px 10px", borderTop: "1px solid var(--c-bd)", display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={() => {
              const allPinned = filtered.filter((c) => selectedIds.has(c.id)).every((c) => c.pinned);
              onBatchTogglePin(Array.from(selectedIds), !allPinned);
            }}
              style={{ flex: 1, padding: "8px 0", borderRadius: "6px", border: "1px solid var(--c-bd)", background: "transparent", color: "var(--c-t2)", cursor: "pointer", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bg3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
              {filtered.filter((c) => selectedIds.has(c.id)).every((c) => c.pinned) ? t("batchUnpin") : t("batchPin")}
            </button>
            <button onClick={() => setConfirmBatchDelete(true)}
              style={{ flex: 1, padding: "8px 0", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: "12px", transition: "all 0.15s", fontFamily: "inherit" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.06)"; e.currentTarget.style.borderColor = "#ef4444"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}>
              {t("batchDelete")}
            </button>
          </div>
        )}

        {/* 用户信息 - 底部 */}
        <div style={{ borderTop: "1px solid var(--c-bd)", padding: "10px 12px", flexShrink: 0 }}>
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
                style={{ flex: 1, background: "var(--c-bg2)", border: "1px solid var(--c-bd2)", borderRadius: "4px", color: "var(--c-txt)", fontSize: "13px", padding: "3px 6px", outline: "none", fontFamily: "inherit" }} />
            ) : (
              <span onClick={() => { setEditingUserName(true); setUserNameEditValue(userName); }}
                style={{ flex: 1, fontSize: "13px", color: "var(--c-t2)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "none", padding: "2px 0" }}
                title={t("clickToEdit")}>
                {userName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialogs */}
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
      {confirmBatchDelete && (
        <ConfirmDialog
          title={t("deleteConfirmTitle")}
          message={t("batchDeleteConfirm").replace("{0}", String(selectedIds.size))}
          confirmText={t("deleteConfirm")}
          cancelText={t("cancel")}
          onConfirm={() => {
            onBatchDelete(Array.from(selectedIds));
            setSelectedIds(new Set());
            setLastClickedId(null);
            setConfirmBatchDelete(false);
          }}
          onCancel={() => setConfirmBatchDelete(false)}
          danger
        />
      )}

      {/* Drag handle */}
      <div onMouseDown={handleResizeStart} onMouseEnter={() => setDragHovered(true)} onMouseLeave={() => setDragHovered(false)}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "5px", cursor: "col-resize", zIndex: 50 }}>
        <div style={{ position: "absolute", right: "1px", top: 0, bottom: 0, width: "2px", backgroundColor: dragging || dragHovered ? "var(--c-bd2)" : "transparent", transition: "background 0.15s" }} />
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
        color: danger ? "#ef4444" : "var(--c-txt)",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--c-bd)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {children}
    </div>
  );
}
