import { useEffect, useState, useCallback } from "react";
import type { Module } from "../modules/types";
import type { KnowledgeEntry } from "../services/knowledgeBase";
import { getAllModules } from "../modules/registry";
import {
  getAllKnowledgeEntries,
  toggleKnowledgeEntry,
} from "../services/knowledgeBase";
import { useTheme } from "../contexts/ThemeContext";

const C = {
  bg: "#0f0f11",
  border: "#2a2a2e",
  txt: "#e0e0e0",
  t2: "#a0a0a0",
  t3: "#7a7a7e",
  t4: "#5a5a5e",
  ac: "#2563eb",
};

/** 等级标签的颜色映射 */
const LEVEL_STYLES: Record<string, { color: string; bg: string }> = {
  low: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  high: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
};

interface Props {
  onBack: () => void;
}

export default function ModulesPanel({ onBack }: Props) {
  const { t } = useTheme();
  const [mods, setMods] = useState<Module[]>([]);
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);

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

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: C.bg,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "18px 32px",
          borderBottom: `1px solid ${C.border}`,
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
            border: `1px solid ${C.border}`,
            background: C.bg,
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
            e.currentTarget.style.borderColor = C.border;
            e.currentTarget.style.color = C.t3;
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <div
            style={{
              fontSize: "17px",
              fontWeight: 700,
              color: C.txt,
              lineHeight: 1.6,
            }}
          >
            {t("modulesTitle")}
          </div>
          <div style={{ fontSize: "12px", color: C.t4, marginTop: "2px" }}>
            Unison
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "0 0 48px" }}
      >
        {/* ─── 模组分隔 ─── */}
        <div
          style={{
            padding: "24px 32px 8px",
            fontSize: "13px",
            fontWeight: 700,
            color: C.t2,
            letterSpacing: "0.5px",
          }}
        >
          🧩 {t("modulesTitle")}
        </div>

        {mods.length === 0 && (
          <div
            style={{
              padding: "24px 32px",
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
          const ls = LEVEL_STYLES[mod.level] ?? LEVEL_STYLES.low;
          return (
            <div key={mod.id} style={{ padding: "0 32px 16px" }}>
              <div
                style={{
                  padding: "20px 24px",
                  borderRadius: "12px",
                  border: `1px solid ${C.border}`,
                  background: "#141417",
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
                  {mod.description}
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
                    {mod.level === "low" ? "Chat, Agent" : "Agent"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* ─── 知识库分隔 ─── */}
        <div
          style={{
            padding: "24px 32px 8px",
            fontSize: "13px",
            fontWeight: 700,
            color: C.t2,
            letterSpacing: "0.5px",
            marginTop: "16px",
          }}
        >
          📚 {t("knowledgeBase")}
        </div>

        <div
          style={{
            padding: "0 32px 8px",
            fontSize: "12px",
            color: C.t4,
            lineHeight: 1.7,
          }}
        >
          {t("knowledgeBaseDesc")}
        </div>

        {kbEntries.map((entry) => (
          <div key={entry.id} style={{ padding: "0 32px 12px" }}>
            <div
              style={{
                padding: "16px 20px",
                borderRadius: "12px",
                border: `1px solid ${C.border}`,
                background: "#141417",
                display: "flex",
                alignItems: "flex-start",
                gap: "14px",
              }}
            >
              {/* 开关 */}
              <button
                onClick={() => handleToggleKb(entry.id)}
                title={entry.enabled ? t("kbEntryEnabled") : t("kbEntryDisabled")}
                style={{
                  width: "36px",
                  height: "20px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  position: "relative",
                  flexShrink: 0,
                  marginTop: "2px",
                  backgroundColor: entry.enabled ? "#2563eb" : "#3a3a3e",
                  transition: "background 0.2s",
                  padding: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "2px",
                    left: entry.enabled ? "18px" : "2px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    transition: "left 0.2s",
                  }}
                />
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: C.txt,
                    marginBottom: "6px",
                    lineHeight: 1.5,
                  }}
                >
                  {entry.title}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: C.t3,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {entry.content}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
