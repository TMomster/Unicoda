import { useState, useRef, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";

const styles = document.createElement("style");
styles.textContent = `
  @keyframes drop-up {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes drop-up-out {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(6px) scale(0.95);
    }
  }
`;
document.head.appendChild(styles);

const MODES = ["Chat", "Work", "Yolo"] as const;
type Mode = (typeof MODES)[number];

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
}

export default function InputBar({ onSend, onStop, disabled }: Props) {
  const { t } = useTheme();
  const { models, selectedModelId, setSelectedModelId } = useModels();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("Chat");
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startClose = () => {
    if (!modeOpen && !modelOpen) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setModeOpen(false);
      setModelOpen(false);
      setClosing(false);
    }, 180);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const closeAll = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setModeOpen(false);
    setModelOpen(false);
    setClosing(false);
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);

  return (
    <div
      style={{
        backgroundColor: "#0f0f11",
        padding: "0 16px 16px",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          position: "relative",
        }}
      >
        {/* Input container */}
        <div
          style={{
            padding: "6px 8px 4px",
            borderRadius: "14px",
            border: "1px solid #3a3a3e",
            backgroundColor: "#1a1a1e",
            transition: "border-color 0.15s",
          }}
        >
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? t("generating") : t("inputPlaceholder")}
            rows={1}
            className="input-area"
            disabled={disabled}
            style={{
              width: "100%",
              resize: "none",
              border: "none",
              backgroundColor: "transparent",
              color: "#e0e0e0",
              fontSize: "14px",
              lineHeight: 1.5,
              outline: "none",
              fontFamily: "inherit",
              padding: "4px 8px",
              maxHeight: "200px",
              boxSizing: "border-box",
              opacity: disabled ? 0.4 : 1,
            }}
          />

          {/* Bottom bar: selectors + send */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 4px",
              marginTop: "6px",
            }}
          >
            {/* Left: selectors */}
            <div style={{ display: "flex", gap: "6px" }}>
              {/* Mode selector */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => {
                    closeAll();
                    setModeOpen(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "3px 10px",
                    borderRadius: "6px",
                    border: "1px solid #3a3a3e",
                    backgroundColor: modeOpen ? "#1e1e22" : "transparent",
                    color: "#a0a0a0",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: "inherit",
                    height: "32px",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1e1e22"; e.currentTarget.style.borderColor = "#5a5a5e"; }}
                  onMouseLeave={(e) => {
                    if (!modeOpen && !closing) {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.borderColor = "#3a3a3e";
                    }
                  }}
                >
                  {mode}
                  <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: modeOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", flexShrink: 0 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {(modeOpen || closing) && (
                  <>
                    <div onClick={startClose} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 4px)",
                        left: "4px",
                        zIndex: 100,
                        backgroundColor: "#1e1e22",
                        border: "1px solid #39393e",
                        borderRadius: "8px",
                        padding: "4px",
                        boxShadow: "0 -4px 24px rgba(0,0,0,0.5)",
                        minWidth: "140px",
                        animation: `${closing ? "drop-up-out" : "drop-up"} 0.18s ease-out both`,
                        transformOrigin: "bottom left",
                      }}
                    >
                      {MODES.map((m) => {
                        const isSelected = m === mode;
                        const unsupported = m !== "Chat";
                        return (
                          <button
                            key={m}
                            onClick={() => {
                              if (unsupported) return;
                              setMode(m);
                              startClose();
                            }}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#2a2a2e"; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              width: "100%",
                              padding: "7px 12px",
                              borderRadius: "6px",
                              border: "none",
                              fontSize: "13px",
                              fontWeight: isSelected ? 600 : 400,
                              textAlign: "left",
                              cursor: unsupported ? "default" : "pointer",
                              backgroundColor: isSelected ? "rgba(37,99,235,0.15)" : "transparent",
                              color: isSelected ? "#e0e0e0" : unsupported ? "#6a6a6e" : "#8a8a8e",
                              transition: "all 0.15s",
                              fontFamily: "inherit",
                              opacity: unsupported && !isSelected ? 0.6 : 1,
                            }}
                          >
                            <span style={{ flex: 1 }}>{m}</span>
                            {unsupported && (
                              <span style={{ fontSize: "11px", color: "#5a5a5e" }}>
                                暂不支持
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Model selector */}
              {models.length > 0 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => {
                      closeAll();
                      setModelOpen(true);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "3px 10px 3px 8px",
                      borderRadius: "6px",
                      border: "1px solid #3a3a3e",
                      backgroundColor: modelOpen ? "#1e1e22" : "transparent",
                      color: "#a0a0a0",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontFamily: "inherit",
                      maxWidth: "160px",
                      height: "32px",
                      boxSizing: "border-box",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#1e1e22"; e.currentTarget.style.borderColor = "#5a5a5e"; }}
                    onMouseLeave={(e) => {
                      if (!modelOpen && !closing) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.borderColor = "#3a3a3e";
                      }
                    }}
                  >
                    {/* Status dot */}
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: selectedModel?.apiKey ? "#22c55e" : "#5a5a5e",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {selectedModel?.name ?? "Select model"}
                    </span>
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: modelOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", flexShrink: 0 }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {(modelOpen || closing) && (
                    <>
                      <div onClick={startClose} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 4px)",
                          left: "4px",
                          zIndex: 100,
                          backgroundColor: "#1e1e22",
                          border: "1px solid #39393e",
                          borderRadius: "8px",
                          padding: "4px",
                          boxShadow: "0 -4px 24px rgba(0,0,0,0.5)",
                          minWidth: "260px",
                          animation: `${closing ? "drop-up-out" : "drop-up"} 0.18s ease-out both`,
                          transformOrigin: "bottom left",
                        }}
                      >
                        {models.map((m) => {
                          const isSelected = m.id === selectedModelId;
                          const hasKey = m.apiKey.length > 0;
                          return (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedModelId(m.id);
                                startClose();
                              }}
                              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "#2a2a2e"; }}
                              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                width: "100%",
                                padding: "7px 12px",
                                borderRadius: "6px",
                                border: "none",
                                fontSize: "13px",
                                fontWeight: isSelected ? 600 : 400,
                                textAlign: "left",
                                cursor: "pointer",
                                backgroundColor: isSelected ? "rgba(37,99,235,0.15)" : "transparent",
                                color: isSelected ? "#e0e0e0" : "#8a8a8e",
                                transition: "all 0.15s",
                                fontFamily: "inherit",
                              }}
                            >
                              <span
                                style={{
                                  width: "6px",
                                  height: "6px",
                                  borderRadius: "50%",
                                  backgroundColor: hasKey ? "#22c55e" : "#5a5a5e",
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ flex: 1 }}>{m.name}</span>
                              <span style={{ fontSize: "11px", color: "#5a5a5e" }}>{m.provider}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right: Send / Stop button */}
            {disabled ? (
              <button
                onClick={onStop}
                title={t("stopGeneration")}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  fontSize: "16px",
                  flexShrink: 0,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#dc2626"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#ef4444"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!text.trim()}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: text.trim() ? "pointer" : "default",
                  backgroundColor: text.trim() ? "#2563eb" : "#2a2a2e",
                  color: text.trim() ? "#fff" : "#6a6a6e",
                  fontSize: "16px",
                  flexShrink: 0,
                  transition: "all 0.15s",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <p
          style={{
            fontSize: "11px",
            color: "#5a5a5e",
            textAlign: "center",
            marginTop: "8px",
            userSelect: "none",
            lineHeight: 1.6,
          }}
        >
          {t("aiDisclaimer")}
          <br />
          Unison · designed by Momster
        </p>
      </div>
    </div>
  );
}
