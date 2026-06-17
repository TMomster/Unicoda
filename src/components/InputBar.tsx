import { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import type { Message, Mode } from "../types";
import { hasCompressionSummary, MIN_MESSAGES_FOR_COMPRESSION } from "../services/conversationCompression";

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
  /* 标准 scrollbar-color 属性，WebView2 原生支持 */
  .input-area {
    scrollbar-width: thin;
    scrollbar-color: #3a3a3e transparent;
  }
  .input-area::-webkit-scrollbar {
    width: 5px;
  }
  .input-area::-webkit-scrollbar-track {
    background: transparent;
  }
  .input-area::-webkit-scrollbar-thumb {
    background: #3a3a3e;
    border-radius: 3px;
    min-height: 30px;
  }
  .input-area::-webkit-scrollbar-thumb:hover {
    background: #5a5a5e;
  }
  .chat-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .chat-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .chat-scroll::-webkit-scrollbar-thumb {
    background: #3a3a3e;
    border-radius: 3px;
    min-height: 30px;
  }
  .chat-scroll::-webkit-scrollbar-thumb:hover {
    background: #5a5a5e;
  }
`;
document.head.appendChild(styles);

const MODES = ["Chat", "Agent", "Yolo"] as const;

/**
 * 粗略估算 token 数量：中文 ~1.5 字符/token，英文 ~4 字符/token
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  let chinese = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) {
      chinese++;
    } else {
      other++;
    }
  }
  return Math.round(chinese / 1.5 + other / 4);
}

/** 根据百分比返回从蓝到红的颜色 hex */
function usageColor(pct: number): string {
  if (pct < 25) {
    const t = pct / 25;
    return `hsl(${240 - t * 120}, 80%, 55%)`;  // 蓝 → 绿
  } else if (pct < 60) {
    const t = (pct - 25) / 35;
    return `hsl(${120 - t * 60}, 85%, 50%)`;   // 绿 → 黄
  } else if (pct < 80) {
    const t = (pct - 60) / 20;
    return `hsl(${60 - t * 30}, 90%, 50%)`;    // 黄 → 橙
  } else {
    const t = (pct - 80) / 20;
    return `hsl(${30 - t * 30}, 95%, 50%)`;    // 橙 → 红
  }
}

interface Props {
  onSend: (text: string, mode?: Mode) => void;
  onStop: () => void;
  disabled: boolean;
  /** 上下文容量 + 压缩控制 */
  messages?: Message[];
  maxTokens?: number;
  compressionEnabled?: boolean;
  onToggleCompression?: () => void;
  onCompressNow?: () => void;
  isCompressing?: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

const LINE_HEIGHT_PX = 21;  // 14px font * 1.5 line-height
const MAX_NORMAL_LINES = 5;
const MAX_NORMAL_HEIGHT = MAX_NORMAL_LINES * LINE_HEIGHT_PX + 8;  // +8 for vertical padding

export default function InputBar({ onSend, onStop, disabled, messages, maxTokens, compressionEnabled, onToggleCompression, onCompressNow, isCompressing, mode, onModeChange }: Props) {
  const { t } = useTheme();
  const { models, selectedModelId, setSelectedModelId } = useModels();
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
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
      if (expanded) {
        const halfH = Math.floor(window.innerHeight / 2);
        el.style.height = Math.max(el.scrollHeight, halfH) + "px";
      } else {
        el.style.height = Math.min(el.scrollHeight, MAX_NORMAL_HEIGHT) + "px";
      }
    }
  }, [text, expanded]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, mode);
    setText("");
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Plain Enter → send
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      // Ctrl+Enter / Shift+Enter → insert newline at cursor
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newText = text.slice(0, start) + "\n" + text.slice(end);
      setText(newText);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
    }
  };

  const closeAll = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setModeOpen(false);
    setModelOpen(false);
    setClosing(false);
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);

  // 计算上下文用量
  const { usedTokens, pct } = useMemo(() => {
    if (!maxTokens || maxTokens <= 0 || !messages) return { usedTokens: 0, pct: 0 };
    const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    return {
      usedTokens: total,
      pct: Math.min(100, Math.round((total / maxTokens) * 100)),
    };
  }, [messages, maxTokens]);

  return (
    <div
      style={{
        backgroundColor: "#0f0f11",
        padding: "0 16px 5px",
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
            padding: "6px 8px 8px",
            borderRadius: "14px",
            border: "1px solid #3a3a3e",
            backgroundColor: "#1a1a1e",
            transition: "border-color 0.15s",
            position: "relative",
          }}
        >
          {/* Expand / Collapse button */}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "收起输入框" : "展开输入框到半屏高度"}
            style={{
              position: "absolute",
              top: "6px",
              right: "8px",
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: "4px",
              backgroundColor: "transparent",
              color: "#6a6a6e",
              cursor: "pointer",
              transition: "all 0.15s",
              zIndex: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#2a2a2e"; e.currentTarget.style.color = "#a0a0a0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#6a6a6e"; }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>

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
              padding: "4px 28px 4px 8px",
              maxHeight: expanded ? "none" : `${MAX_NORMAL_HEIGHT}px`,
              boxSizing: "border-box",
              opacity: disabled ? 0.4 : 1,
              overflowY: "auto",
              overflowX: "hidden",
              transition: "height 0.2s ease",
            }}
          />

          {/* Bottom bar: selectors + send */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 4px",
              marginTop: "4px",
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
                        const unsupported = m === "Yolo";
                        return (
                          <button
                            key={m}
                            onClick={() => {
                              if (unsupported) return;
                              onModeChange(m as Mode);
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

            {/* 上下文容量 + 压缩开关（与模型按钮统一高度和间距） */}
            {maxTokens && maxTokens > 0 && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "32px",
                  padding: "0 8px",
                  borderRadius: "6px",
                  border: "1px solid #3a3a3e",
                  fontSize: "11px",
                  color: "#8a8a8e",
                  userSelect: "none",
                  boxSizing: "border-box",
                }}
                title={`${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`}
              >
                {/* 指示灯 */}
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: usageColor(pct),
                    flexShrink: 0,
                    transition: "background-color 0.3s",
                  }}
                />
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {pct}%
                </span>
                <span style={{ color: "#5a5a5e" }}>
                  {usedTokens.toLocaleString()}/{maxTokens.toLocaleString()}
                </span>

                {/* 分隔线 */}
                <span
                  style={{
                    width: "1px",
                    height: "14px",
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                />

                {/* 压缩开关：单选按钮样式 */}
                <button
                  onClick={onToggleCompression}
                  title={
                    compressionEnabled
                      ? `对话压缩已开启，点击关闭`
                      : `点击开启对话压缩 — 将早期对话压缩为摘要，保留最近对话完整内容`
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: 0,
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    color: compressionEnabled ? "#60a5fa" : "#6a6a6e",
                    fontSize: "11px",
                    lineHeight: 1,
                    transition: "all 0.2s",
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  {/* 圆圈外观 */}
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      border: `2px solid ${compressionEnabled ? "#60a5fa" : "#5a5a5e"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "border-color 0.2s",
                    }}
                  >
                    {compressionEnabled && (
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: "#60a5fa",
                          transition: "background-color 0.2s",
                        }}
                      />
                    )}
                  </span>
                  <span>压缩上下文</span>
                </button>
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

        {/* 压缩操作按钮（手动压缩/压缩中/已压缩） */}
        {messages && messages.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "6px",
              marginTop: "0",
              minHeight: "0",
            }}
          >
            {/* 手动压缩按钮（开启 + 使用率高 + 消息数足够时显示） */}
            {compressionEnabled && pct > 50 && !isCompressing && messages && messages.length >= MIN_MESSAGES_FOR_COMPRESSION && (
              <button
                onClick={onCompressNow}
                title={`将旧对话压缩为摘要，保留最近 ${8} 轮完整消息以节省 token`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(251,191,36,0.3)",
                  fontSize: "11px",
                  cursor: "pointer",
                  backgroundColor: "rgba(251,191,36,0.1)",
                  color: "#fbbf24",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                <span>📦</span>
                <span>压缩旧对话</span>
              </button>
            )}

            {/* 压缩中动画 */}
            {isCompressing && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(59,130,246,0.15)",
                  color: "#60a5fa",
                  fontSize: "11px",
                }}
              >
                <span className="compression-spinner" style={{ fontSize: "12px" }}>
                  ⟳
                </span>
                <span>压缩中...</span>
                <style>{`
                  @keyframes compressionSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  .compression-spinner {
                    display: inline-block;
                    animation: compressionSpin 1s linear infinite;
                  }
                `}</style>
              </div>
            )}

            {/* 已有摘要标识 */}
            {!isCompressing && hasCompressionSummary(messages) && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(52,211,153,0.1)",
                  color: "#34d399",
                  fontSize: "11px",
                }}
              >
                <span>📋</span>
                <span>已压缩</span>
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        <p
          style={{
            fontSize: "11px",
            color: "#5a5a5e",
            textAlign: "center",
            marginTop: "0",
            marginBottom: "2px",
            userSelect: "none",
            lineHeight: 1.4,
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
