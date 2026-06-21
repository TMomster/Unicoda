import { useEffect, useState, useCallback } from "react";
import type { Module } from "../modules/types";
import type { KnowledgeEntry, KnowledgeMode } from "../services/knowledgeBase";
import { getAllModules } from "../modules/registry";
import {
  getAllKnowledgeEntries,
  toggleKnowledgeEntry,
  addUserKnowledgeCard,
  updateUserKnowledgeCard,
  deleteUserKnowledgeCard,
} from "../services/knowledgeBase";
import { useTheme } from "../contexts/ThemeContext";
import AuroraBackground from "./AuroraBackground";

const C = {
  bg: "var(--c-bg)",
  border: "var(--c-bd)",
  txt: "var(--c-txt)",
  t2: "var(--c-t2)",
  t3: "var(--c-t3)",
  t4: "var(--c-t4)",
  ac: "var(--c-ac)",
};

const LEVEL_STYLES: Record<string, { color: string; bg: string }> = {
  normal: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  sensitive: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

type KbTab = "modules" | "knowledge";

interface Props {
  onBack: () => void;
  /** Yolo 玻璃模式样式 */
  yolo?: boolean;
}

export default function ComponentsPanel({ onBack, yolo }: Props) {
  const { t } = useTheme();
  const [tab, setTab] = useState<KbTab>("modules");
  const [mods, setMods] = useState<Module[]>([]);
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);

  // Knowledge card editor state
  const [editingCard, setEditingCard] = useState<{
    id?: string;
    title: string;
    content: string;
    summary: string;
    mode: KnowledgeMode;
  } | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [modeCollapsed, setModeCollapsed] = useState<Record<KnowledgeMode, boolean>>({ framework: false, normal: false, yolo: false });
  const [subCollapsed, setSubCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMods(getAllModules());
    setKbEntries(getAllKnowledgeEntries());
  }, []);

  const refreshKb = useCallback(() => {
    setKbEntries(getAllKnowledgeEntries());
  }, []);

  const handleToggleKb = useCallback(
    (id: string) => {
      toggleKnowledgeEntry(id);
      refreshKb();
    },
    [refreshKb],
  );

  const openNewCard = () => {
    setEditingCard({ title: "", content: "", summary: "", mode: "framework" });
    setShowEditor(true);
  };

  const openEditCard = (entry: KnowledgeEntry) => {
    if (entry.builtin) return;
    setEditingCard({ id: entry.id, title: entry.title, content: entry.content, summary: entry.summary || "", mode: entry.mode });
    setShowEditor(true);
  };

  const saveCard = () => {
    if (!editingCard) return;
    if (!editingCard.title.trim() || !editingCard.content.trim()) return;
    const summaryVal = editingCard.summary.trim() || undefined;
    if (editingCard.id) {
      updateUserKnowledgeCard(editingCard.id, editingCard.title.trim(), editingCard.content.trim(), editingCard.mode, summaryVal);
    } else {
      addUserKnowledgeCard(editingCard.title.trim(), editingCard.content.trim(), editingCard.mode, summaryVal);
    }
    setShowEditor(false);
    setEditingCard(null);
    refreshKb();
  };

  const confirmDelete = (id: string) => {
    deleteUserKnowledgeCard(id);
    setDeleteConfirm(null);
    refreshKb();
  };

  return (
    <div
      style={
        yolo
          ? { position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column" }
          : { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }
      }
    >
      {yolo && <AuroraBackground />}
      {yolo && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            backgroundColor: "rgba(10,10,18,0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "18px 32px",
          borderBottom: `1px solid ${yolo ? "rgba(255,255,255,0.08)" : C.border}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          title={t("back")}
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "8px",
            border: `1px solid ${yolo ? "rgba(255,255,255,0.15)" : C.border}`,
            background: "transparent",
            color: C.t3,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.t3;
            e.currentTarget.style.color = C.txt;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = yolo ? "rgba(255,255,255,0.15)" : C.border;
            e.currentTarget.style.color = C.t3;
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "17px",
              fontWeight: 700,
              color: C.txt,
              lineHeight: 1.6,
            }}
          >
            {t("componentsTitle")}
          </div>
          <div style={{ fontSize: "12px", color: C.t4, marginTop: "2px" }}>
            Unicoda
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "0",
          padding: "0 32px",
          borderBottom: `1px solid ${yolo ? "rgba(255,255,255,0.06)" : C.border}`,
          flexShrink: 0,
        }}
      >
        {(["modules", "knowledge"] as KbTab[]).map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "12px 20px",
                border: "none",
                background: "transparent",
                color: active ? C.txt : C.t4,
                fontSize: "13px",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                borderBottom: active ? `2px solid ${C.ac}` : "2px solid transparent",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = C.t2;
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = C.t4;
              }}
            >
              {key === "modules" ? t("componentsTabModules") : t("componentsTabKnowledge")}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "0 0 48px" }}
      >
        {tab === "modules" && (
          <>
            {mods.length === 0 && (
              <div
                style={{
                  padding: "40px 32px",
                  textAlign: "center",
                  fontSize: "13px",
                  color: C.t4,
                  lineHeight: 1.8,
                }}
              >
                {t("noModules")}
              </div>
            )}

            {mods.map((mod) => {
              const ls = LEVEL_STYLES[mod.level] ?? LEVEL_STYLES.normal;
              return (
                <div key={mod.id} style={{ padding: "0 32px 16px" }}>
                  <div
                    style={{
                      padding: "20px 24px",
                      borderRadius: "12px",
                      border: `1px solid ${C.border}`,
                      background: yolo ? "rgba(255,255,255,0.04)" : "var(--c-bg2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "15px",
                          fontWeight: 700,
                          color: C.txt,
                          lineHeight: 1.6,
                        }}
                      >
                        {mod.name}
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: ls.color,
                          backgroundColor: ls.bg,
                          padding: "3px 10px",
                          borderRadius: "4px",
                          lineHeight: 1.6,
                          textTransform: "uppercase",
                        }}
                      >
                        {t(`moduleLevel_${mod.level}`)}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: "13px",
                        color: C.t2,
                        lineHeight: 1.8,
                        marginBottom: "12px",
                      }}
                    >
                      {mod.userDescription || mod.description}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        fontSize: "12px",
                        color: C.t3,
                        lineHeight: 1.6,
                      }}
                    >
                      <span>
                        <span style={{ color: C.t4 }}>ID: </span>
                        <code
                          style={{
                            padding: "1px 6px",
                            borderRadius: "3px",
                            backgroundColor: C.bg,
                            border: `1px solid ${C.border}`,
                            color: "#60a5fa",
                            fontSize: "11px",
                          }}
                        >
                          {mod.id}
                        </code>
                      </span>
                      <span>
                        <span style={{ color: C.t4 }}>
                          {t("moduleAvailableIn")}:{" "}
                        </span>
                        {mod.level === "normal" ? "Chat, Agent" : "Agent"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "knowledge" && (() => {
          const query = searchQuery.trim().toLowerCase();
          const filtered = query
            ? kbEntries.filter(
                (e) =>
                  e.title.toLowerCase().includes(query) ||
                  e.content.toLowerCase().includes(query),
              )
            : kbEntries;
          return (
            <>
              {/* Search bar */}
              <div style={{ padding: "16px 32px 8px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: `1px solid ${C.border}`,
                    background: yolo ? "rgba(255,255,255,0.05)" : "var(--c-bg2)",
                    transition: "border-color 0.15s",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.t4} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("searchKnowledge")}
                    style={{
                      flex: 1,
                      border: "none",
                      background: "transparent",
                      color: C.txt,
                      fontSize: "13px",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: C.t4,
                        cursor: "pointer",
                        padding: "2px",
                        display: "flex",
                        lineHeight: 1,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Add card button */}
              <div
                style={{
                  padding: "8px 32px 12px",
                  display: "flex",
                  justifyContent: "flex-start",
                }}
              >
                <button
                  onClick={openNewCard}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 16px",
                    borderRadius: "8px",
                    border: `1px solid ${C.ac}`,
                    background: "rgba(37,99,235,0.1)",
                    color: "#60a5fa",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(37,99,235,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(37,99,235,0.1)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t("addKnowledgeCard")}
                </button>
              </div>

              {/* Knowledge card editor modal */}
              {showEditor && editingCard && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 300,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.5)",
                  }}
                  onClick={() => setShowEditor(false)}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: "480px",
                      maxWidth: "90vw",
                      maxHeight: "80vh",
                      display: "flex",
                      flexDirection: "column",
                      background: yolo ? "rgba(15,15,25,0.85)" : "var(--c-bg2)",
                      border: `1px solid ${C.border}`,
                      borderRadius: "14px",
                      padding: "24px",
                      ...(yolo
                        ? { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }
                        : {}),
                    }}
                  >
                    <div style={{ fontSize: "15px", fontWeight: 700, color: C.txt, marginBottom: "16px" }}>
                      {editingCard.id ? t("editCard") : t("addKnowledgeCard")}
                    </div>
                    {/* Mode selector */}
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "12px", color: C.t3, marginBottom: "6px", fontWeight: 500 }}>
                        {t("kbModeLabel")}
                      </div>
                      <select
                        value={editingCard.mode}
                        onChange={(e) => setEditingCard((prev) => prev ? { ...prev, mode: e.target.value as KnowledgeMode } : null)}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: "8px",
                          border: `1px solid ${C.border}`,
                          background: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg)",
                          color: C.txt,
                          fontSize: "13px",
                          outline: "none",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                          cursor: "pointer",
                          appearance: "auto",
                        }}
                      >
                        <option value="framework">{t("kbMode_framework")}</option>
                        <option value="normal">{t("kbMode_normal")}</option>
                        <option value="yolo">{t("kbMode_yolo")}</option>
                      </select>
                    </div>
                    <input
                      value={editingCard.title}
                      onChange={(e) => setEditingCard((prev) => prev ? { ...prev, title: e.target.value } : null)}
                      placeholder={t("knowledgeCardTitlePlaceholder")}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${C.border}`,
                        background: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg)",
                        color: C.txt,
                        fontSize: "13px",
                        outline: "none",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                        marginBottom: "12px",
                      }}
                    />
                    <textarea
                      value={editingCard.summary}
                      onChange={(e) => setEditingCard((prev) => prev ? { ...prev, summary: e.target.value } : null)}
                      placeholder={t("knowledgeCardSummaryPlaceholder")}
                      rows={2}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${C.border}`,
                        background: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg)",
                        color: C.txt,
                        fontSize: "13px",
                        outline: "none",
                        fontFamily: "inherit",
                        resize: "vertical",
                        boxSizing: "border-box",
                        marginBottom: "12px",
                        lineHeight: 1.6,
                      }}
                    />
                    <textarea
                      value={editingCard.content}
                      onChange={(e) => setEditingCard((prev) => prev ? { ...prev, content: e.target.value } : null)}
                      placeholder={t("knowledgeCardContentPlaceholder")}
                      rows={6}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${C.border}`,
                        background: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg)",
                        color: C.txt,
                        fontSize: "13px",
                        outline: "none",
                        fontFamily: "inherit",
                        resize: "vertical",
                        boxSizing: "border-box",
                        marginBottom: "16px",
                        lineHeight: 1.6,
                      }}
                    />
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => { setShowEditor(false); setEditingCard(null); }}
                        style={{
                          padding: "8px 18px",
                          borderRadius: "8px",
                          border: `1px solid ${C.border}`,
                          background: "transparent",
                          color: C.t3,
                          fontSize: "13px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {t("cancel")}
                      </button>
                      <button
                        onClick={saveCard}
                        disabled={!editingCard.title.trim() || !editingCard.content.trim()}
                        style={{
                          padding: "8px 18px",
                          borderRadius: "8px",
                          border: "none",
                          background: !editingCard.title.trim() || !editingCard.content.trim() ? "var(--c-bd2)" : C.ac,
                          color: !editingCard.title.trim() || !editingCard.content.trim() ? "var(--c-t5)" : "#fff",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: !editingCard.title.trim() || !editingCard.content.trim() ? "default" : "pointer",
                          fontFamily: "inherit",
                          transition: "all 0.15s",
                        }}
                      >
                        {t("save")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete confirm modal */}
              {deleteConfirm && (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 300,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.5)",
                  }}
                  onClick={() => setDeleteConfirm(null)}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: "360px",
                      background: yolo ? "rgba(15,15,25,0.85)" : "var(--c-bg2)",
                      border: `1px solid ${C.border}`,
                      borderRadius: "14px",
                      padding: "24px",
                      ...(yolo
                        ? { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }
                        : {}),
                    }}
                  >
                    <div style={{ fontSize: "15px", fontWeight: 700, color: C.txt, marginBottom: "12px" }}>
                      {t("confirmDeleteKb")}
                    </div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        style={{
                          padding: "8px 18px",
                          borderRadius: "8px",
                          border: `1px solid ${C.border}`,
                          background: "transparent",
                          color: C.t3,
                          fontSize: "13px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {t("cancel")}
                      </button>
                      <button
                        onClick={() => confirmDelete(deleteConfirm)}
                        style={{
                          padding: "8px 18px",
                          borderRadius: "8px",
                          border: "none",
                          background: "#ef4444",
                          color: "#fff",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {t("deleteConfirm")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {kbEntries.length === 0 && (
                <div style={{ padding: "40px 32px", textAlign: "center", fontSize: "13px", color: C.t4, lineHeight: 1.8 }}>
                  {t("noModules")}
                </div>
              )}

              {/* Mode-grouped sections with two-level collapse */}
              {(["framework", "normal", "yolo"] as KnowledgeMode[]).map((kbm) => {
                const modeEntries = filtered.filter((e) => e.mode === kbm);
                if (modeEntries.length === 0) return null;
                const modeColl = modeCollapsed[kbm];
                const builtins = modeEntries.filter((e) => e.builtin);
                const users = modeEntries.filter((e) => !e.builtin);
                return (
                  <div key={kbm} style={{ paddingTop: "16px" }}>
                    {/* Mode-level header */}
                    <div style={{ padding: "0 32px" }}>
                      <button
                        onClick={() => setModeCollapsed((prev) => ({ ...prev, [kbm]: !prev[kbm] }))}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          width: "100%",
                          padding: "10px 0",
                          border: "none",
                          background: "transparent",
                          color: C.t2,
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                          borderBottom: `1px solid ${C.border}`,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = C.txt; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = C.t2; }}
                      >
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                          style={{ transform: modeColl ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <span>{t(`kbModeSection_${kbm}`)}</span>
                        <span style={{ color: C.t4, fontSize: "11px", fontWeight: 400 }}>({modeEntries.length})</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: "10px", color: C.t4, fontWeight: 400, letterSpacing: 0 }}>
                          {modeColl ? t("expandSection") : t("collapseSection")}
                        </span>
                      </button>
                    </div>

                    {/* Sub-sections: 内置 and 用户 */}
                    {!modeColl && (
                      <>
                        {builtins.length > 0 && (
                          <SubSection
                            label={t("builtinCardSection")}
                            count={builtins.length}
                            subKey={`${kbm}-builtin`}
                            collapsed={subCollapsed[`${kbm}-builtin`] ?? false}
                            onToggle={(key) => setSubCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
                            C={C}
                            t={t}
                          >
                            {builtins.map((entry) => (
                              <div key={entry.id} style={{ padding: "8px 32px 0" }}>
                                <KbCard entry={entry} builtin toggleFn={handleToggleKb} openEdit={openEditCard} onDelete={setDeleteConfirm} yolo={yolo} C={C} t={t} />
                              </div>
                            ))}
                          </SubSection>
                        )}
                        {users.length > 0 && (
                          <SubSection
                            label={t("userCardSection")}
                            count={users.length}
                            subKey={`${kbm}-user`}
                            collapsed={subCollapsed[`${kbm}-user`] ?? false}
                            onToggle={(key) => setSubCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
                            C={C}
                            t={t}
                          >
                            {users.map((entry) => (
                              <div key={entry.id} style={{ padding: "8px 32px 0" }}>
                                <KbCard entry={entry} builtin={false} toggleFn={handleToggleKb} openEdit={openEditCard} onDelete={setDeleteConfirm} yolo={yolo} C={C} t={t} />
                              </div>
                            ))}
                          </SubSection>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* No results feedback */}
              {query && filtered.length === 0 && (
                <div style={{ padding: "40px 32px", textAlign: "center", fontSize: "13px", color: C.t4, lineHeight: 1.8 }}>
                  {t("noModules")}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
    </div>
  );
}

/** 单个知识卡卡片展示 */
function KbCard({
  entry, builtin, toggleFn, openEdit, onDelete, yolo, C, t,
}: {
  entry: KnowledgeEntry;
  builtin: boolean;
  toggleFn: (id: string) => void;
  openEdit: (entry: KnowledgeEntry) => void;
  onDelete: (id: string) => void;
  yolo?: boolean;
  C: Record<string, string>;
  t: (key: string) => string;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRadius: "12px",
        border: `1px solid ${C.border}`,
        background: yolo ? "rgba(255,255,255,0.04)" : "var(--c-bg2)",
        display: "flex",
        alignItems: "flex-start",
        gap: "14px",
      }}
    >
      {!builtin ? (
        <button
          onClick={() => toggleFn(entry.id)}
          title={entry.enabled ? t("kbEntryEnabled") : t("kbEntryDisabled")}
          style={{
            width: "36px", height: "20px", borderRadius: "10px", border: "none",
            cursor: "pointer", position: "relative", flexShrink: 0, marginTop: "2px",
            backgroundColor: entry.enabled ? "var(--c-ac)" : "var(--c-bd2)",
            transition: "background 0.2s", padding: 0,
          }}
        >
          <span
            style={{
              position: "absolute", top: "2px",
              left: entry.enabled ? "18px" : "2px",
              width: "16px", height: "16px",
              borderRadius: "50%", backgroundColor: "#fff",
              transition: "left 0.2s",
            }}
          />
        </button>
      ) : (
        <div style={{ width: "36px", flexShrink: 0, marginTop: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "11px", color: C.t4, padding: "3px 18px", borderRadius: "4px", border: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
            {t("builtinCard")}
          </span>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: C.txt, lineHeight: 1.5 }}>
            {entry.title}
          </div>
          {!builtin && (
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
              <button
                onClick={() => openEdit(entry)}
                title={t("editCard")}
                style={{ width: "26px", height: "26px", borderRadius: "5px", border: "none", background: "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.08)" : "var(--c-bd)"; e.currentTarget.style.color = C.txt; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                onClick={() => onDelete(entry.id)}
                title={t("deleteCard")}
                style={{ width: "26px", height: "26px", borderRadius: "5px", border: "none", background: "transparent", color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.t3; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div
          style={{
            fontSize: "12px", color: C.t3, lineHeight: 1.7,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            display: "-webkit-box",
            WebkitLineClamp: builtin ? 3 : 6,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {builtin
            ? (entry.summary || truncateKbContent(entry.content))
            : (entry.summary || (entry.content.length > 50 ? entry.content.slice(0, 50) + "…" : entry.content))}
        </div>
      </div>
    </div>
  );
}

/** 截取 Kbase 内置条目的缩略描述（取第一个段落的纯文本前 200 字） */
function truncateKbContent(content: string): string {
  const cleaned = content
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`{1,3}/g, "")
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/>\s*/g, "")
    .replace(/^[\s-]+/gm, "")
    .replace(/\n{2,}/g, " ")
    .trim();
  return cleaned.length > 200 ? cleaned.slice(0, 200) + "…" : cleaned;
}

/** 二级折叠子区域（内置 / 用户） */
function SubSection({
  label, count, subKey, collapsed, onToggle, children, C, t,
}: {
  label: string;
  count: number;
  subKey: string;
  collapsed: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
  C: Record<string, string>;
  t: (key: string) => string;
}) {
  return (
    <div style={{ padding: "0 32px 0 52px" }}>
      <button
        onClick={() => onToggle(subKey)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          width: "100%",
          padding: "8px 0",
          border: "none",
          background: "transparent",
          color: C.t4,
          fontSize: "11px",
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.t2; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.t4; }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span>{label}</span>
        <span style={{ color: C.t4, fontSize: "10px", fontWeight: 400 }}>({count})</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "9px", color: C.t4, fontWeight: 400 }}>
          {collapsed ? t("expandSection") : t("collapseSection")}
        </span>
      </button>
      {!collapsed && children}
    </div>
  );
}
