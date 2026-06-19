import { useState, useEffect } from "react";
import type { Message } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

import type { FileAttachment } from "../types";

interface Props {
  message: Message;
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  developerMode?: boolean;
  t: (key: string) => string;
  /** Yolo 玻璃模式风格 */
  yolo?: boolean;
  /** 点击文件附件预览回调 */
  onPreviewFile?: (file: FileAttachment) => void;
}

const animations = `
@keyframes cursor-blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
.streaming-cursor { animation: cursor-blink 0.8s step-end infinite; color: #22c55e; font-size: 14px; margin-left: 1px; }
@keyframes aurora-flow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes aurora-glow {
  0%, 100% { transform: scale(1); filter: brightness(1); box-shadow: 0 0 6px rgba(45,212,191,0.6), 0 0 12px rgba(129,140,248,0.3); }
  50% { transform: scale(1.2); filter: brightness(1.3); box-shadow: 0 0 10px rgba(45,212,191,0.8), 0 0 20px rgba(129,140,248,0.5), 0 0 30px rgba(52,211,153,0.3); }
}
.aurora-ball {
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #22d3ee, #818cf8, #34d399, #f472b6, #22d3ee);
  background-size: 300% 300%;
  animation: aurora-flow 3s ease-in-out infinite, aurora-glow 1.5s ease-in-out infinite;
}
@keyframes helix-bounce {
  0%, 100% { transform: translateY(-4px); }
  50% { transform: translateY(4px); }
}
.double-helix {
  display: inline-flex; gap: 2px; height: 12px; align-items: center; margin-left: 6px;
}
.double-helix .dot {
  width: 3px; height: 3px; border-radius: 50%;
  animation: helix-bounce 0.7s ease-in-out infinite;
}
.double-helix .dot:nth-child(1) { background: #22d3ee; animation-delay: 0s; }
.double-helix .dot:nth-child(2) { background: #818cf8; animation-delay: 0.1s; }
.double-helix .dot:nth-child(3) { background: #22d3ee; animation-delay: 0.2s; }
.double-helix .dot:nth-child(4) { background: #818cf8; animation-delay: 0.3s; }
.double-helix .dot:nth-child(5) { background: #22d3ee; animation-delay: 0.4s; }
.double-helix .dot:nth-child(6) { background: #818cf8; animation-delay: 0.5s; }
.double-helix .dot:nth-child(7) { background: #22d3ee; animation-delay: 0.6s; }
.double-helix .dot:nth-child(8) { background: #818cf8; animation-delay: 0.7s; }
`;

// ── 复制按钮组件 ──
function CopyBtn({ text, yolo }: { text: string; yolo?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "2px 6px",
        fontSize: "12px",
        lineHeight: 1,
        color: copied ? "#22c55e" : yolo ? "rgba(255,255,255,0.35)" : "var(--c-t4)",
        userSelect: "none",
        transition: "color 0.15s",
        flexShrink: 0,
      }}
      title={copied ? "已复制" : "复制"}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.7)" : "var(--c-t2)";
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.35)" : "var(--c-t4)";
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function MessageBubble({ message, modelName, userName, userAvatar, defaultMarkdown = true, defaultReasoningOpen = false, developerMode = false, t, yolo, onPreviewFile }: Props) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isStreaming = message.streaming;
  const hasReasoning = !!message.reasoningContent;
  const [reasoningOpen, setReasoningOpen] = useState(defaultReasoningOpen);
  const [toolOpen, setToolOpen] = useState(false); // 工具调用默认折叠
  const [elapsed, setElapsed] = useState(0);
  const [useMarkdown, setUseMarkdown] = useState(defaultMarkdown);
  const [devDebugOpen, setDevDebugOpen] = useState(false); // 开发者调试面板

  useEffect(() => {
    if (hasReasoning) {
      const startTime = message.timestamp;
      const endTime = message.reasoningEndTime;
      const updateElapsed = () => {
        const now = endTime ?? Date.now();
        setElapsed(Math.floor((now - startTime) / 1000));
      };
      updateElapsed();
      // 仅当思考阶段未结束且仍在 streaming 时继续计时
      if (isStreaming && !endTime) {
        const interval = setInterval(updateElapsed, 1000);
        return () => clearInterval(interval);
      }
    }
  }, [hasReasoning, isStreaming, message.timestamp, message.reasoningEndTime]);

  const reasoningInProgress = isStreaming && !message.reasoningEndTime;
  const reasoningTitle = `${reasoningInProgress ? t("reasoningInProgress") : t("reasoning")}（${elapsed}s）`;

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "16px 0",
        borderBottom: yolo ? "1px solid rgba(255,255,255,0.04)" : "1px solid var(--c-bg2)",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: "30px",
          height: "30px",
          borderRadius: "6px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
          fontWeight: 700,
          backgroundColor: yolo
            ? (isUser ? "rgba(255,255,255,0.04)" : isTool ? "rgba(124,58,237,0.2)" : "rgba(20,184,166,0.2)")
            : (isUser ? "#000" : isTool ? "#7c3aed" : "#14b8a6"),
          color: "#fff",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {isUser && userAvatar ? (
          <img src={userAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : isTool ? (
          "🔧"
        ) : isUser ? (
          (userName?.charAt(0) || "U")
        ) : (
          (modelName?.charAt(0) || "A")
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "6px",
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 600, color: isUser ? "#3b82f6" : isTool ? "#a78bfa" : "#22c55e" }}>
            {isTool ? `🔧 ${message.toolCallId || "Tool"}` : isUser ? "你" : modelName || "Unison"}
          </span>
          {!isTool && (
            <button
              onClick={() => setUseMarkdown(!useMarkdown)}
              title={t("markdownBtnTitle")}
              style={{
                border: "none",
                background: "transparent",
                color: useMarkdown ? "var(--c-ac)" : "var(--c-t4)",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                padding: "0 2px",
                lineHeight: 1,
                letterSpacing: "0.5px",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { if (!useMarkdown) e.currentTarget.style.color = "var(--c-t2)"; }}
              onMouseLeave={(e) => { if (!useMarkdown) e.currentTarget.style.color = "var(--c-t4)"; }}
            >
              M
            </button>
          )}
        </div>

        {/* 思考过程（可折叠） */}
        {hasReasoning && (
          <div
            style={{
              marginBottom: "12px",
              borderRadius: "8px",
              border: yolo ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--c-bd)",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => setReasoningOpen(!reasoningOpen)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                cursor: "pointer",
                userSelect: "none",
                fontSize: "12px",
                fontWeight: 600,
                color: yolo ? "rgba(255,255,255,0.65)" : "var(--c-t2)",
                background: yolo ? "rgba(255,255,255,0.03)" : "var(--c-bg3)",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.03)" : "var(--c-bg3)"; }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transition: "transform 0.2s",
                  transform: reasoningOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {reasoningInProgress && <div className="aurora-ball" />}
              <span>{reasoningTitle}</span>
              <div style={{ flex: 1 }} />
              {message.reasoningContent && !reasoningInProgress && (
                <CopyBtn text={message.reasoningContent} yolo={yolo} />
              )}
            </div>
            {reasoningOpen && (
              <div
                style={{
                  padding: "12px",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t6)",
                  background: yolo ? "rgba(255,255,255,0.02)" : "var(--c-bg2)",
                  borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontStyle: "italic",
                  userSelect: "text",
                }}
              >
                {message.reasoningContent}
                {reasoningInProgress && <span className="streaming-cursor">▊</span>}
              </div>
            )}
          </div>
        )}

        {/* 回复内容 */}
        <div
          style={{
            fontSize: "14px",
            lineHeight: 1.7,
            color: "var(--c-txt)",
            wordBreak: "break-word",
            userSelect: "text",
          }}
        >
          {isTool ? (
            <div
              style={{
                borderRadius: "8px",
                border: yolo ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--c-bd)",
                overflow: "hidden",
              }}
            >
              {/* 工具调用标题栏 — 始终可见 */}
              <div
                onClick={() => setToolOpen(!toolOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  userSelect: "none",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: yolo ? "rgba(167,139,250,0.8)" : "#a78bfa",
                  background: yolo ? "rgba(255,255,255,0.03)" : "var(--c-bg3)",
                  transition: "background 0.12s",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = yolo ? "rgba(255,255,255,0.03)" : "var(--c-bg3)"; }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{
                    transition: "transform 0.2s",
                    transform: toolOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>🔧 {message.toolCallId || "Tool"}</span>
                {isStreaming && <div className="double-helix"><div className="dot" /><div className="dot" /><div className="dot" /><div className="dot" /><div className="dot" /><div className="dot" /><div className="dot" /><div className="dot" /></div>}
                <div style={{ flex: 1 }} />
                {(message.content || message.toolCallError) && !isStreaming && (
                  <CopyBtn text={message.toolCallError || message.content} yolo={yolo} />
                )}
              </div>
              {/* 工具调用结果 — 可折叠，默认收起 */}
              {toolOpen && (
                <div
                  style={{
                    padding: "10px 12px",
                    fontSize: "12px",
                    fontFamily: "ui-monospace, monospace",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: message.toolCallError ? "#ef4444" : yolo ? "rgba(255,255,255,0.55)" : "var(--c-t2)",
                    background: yolo ? "rgba(255,255,255,0.02)" : "var(--c-bg)",
                    borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)",
                    userSelect: "text",
                  }}
                >
                  {isStreaming && !message.content
                    ? "_(执行中...)_"
                    : message.content || (message.toolCallError ? message.toolCallError : "(空结果)")}
                </div>
              )}
            </div>
          ) : isUser ? (
            <div>
              {message.content && <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>}
              {message.files && message.files.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: message.content ? "8px" : 0 }}>
                  {message.files.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => onPreviewFile?.(file)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        padding: "5px 10px", borderRadius: "6px",
                        backgroundColor: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg2)",
                        border: yolo ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--c-bd2)",
                        cursor: "pointer", userSelect: "none",
                        transition: "all 0.12s",
                        maxWidth: "220px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(59,130,246,0.12)" : "#25252a"; e.currentTarget.style.borderColor = "#3b82f6"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg2)"; e.currentTarget.style.borderColor = yolo ? "rgba(255,255,255,0.1)" : "var(--c-bd2)"; }}
                    >
                      {file.isImage ? (
                        <img src={file.data} alt="" style={{ width: "18px", height: "18px", borderRadius: "3px", objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      )}
                      <span style={{ fontSize: "12px", color: "var(--c-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {file.name}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-t5)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                        <polyline points="15 3 21 3 21 9" />
                        <polyline points="9 21 3 21 3 15" />
                        <line x1="21" y1="3" x2="14" y2="10" />
                      </svg>
                    </div>
                  ))}
                </div>
              )}
              {message.content && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                  <CopyBtn text={message.content} yolo={yolo} />
                </div>
              )}
            </div>
          ) : (
            <div>
              {useMarkdown ? (
                <MarkdownRenderer content={message.content} yolo={yolo} />
              ) : (
                <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
              )}
              {message.content && !isStreaming && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                  <CopyBtn text={message.content} yolo={yolo} />
                </div>
              )}
            </div>
          )}
          {isStreaming && !hasReasoning && !isTool && (
            <span className="streaming-cursor">▊</span>
          )}
        </div>

        {/* ── 开发者调试面板（仅 assistant 且有 toolDebugInfo 时显示） ── */}
        {developerMode && message.role === "assistant" && message.toolDebugInfo && message.toolDebugInfo.length > 0 && (
          <div
            style={{
              marginTop: "12px",
              borderRadius: "8px",
              border: yolo ? "1px solid rgba(245,158,11,0.3)" : "1px solid #f59e0b",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => setDevDebugOpen(!devDebugOpen)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                cursor: "pointer",
                userSelect: "none",
                fontSize: "12px",
                fontWeight: 600,
                color: yolo ? "rgba(245,158,11,0.8)" : "#f59e0b",
                background: yolo ? "rgba(245,158,11,0.05)" : "#1c1a14",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = yolo ? "rgba(245,158,11,0.1)" : "#252218"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = yolo ? "rgba(245,158,11,0.05)" : "#1c1a14"; }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transition: "transform 0.2s",
                  transform: devDebugOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>🐞 {t("developerMode")} ({message.toolDebugInfo.length} 次调用)</span>
              <div style={{ flex: 1 }} />
              {message.toolDebugInfo && (
                <CopyBtn text={message.toolDebugInfo.map((e, i) =>
                  `[第${e.round + 1}轮调用 #${i + 1}] ${e.error ? "失败" : "成功"}${e.durationMs !== undefined ? ` (${e.durationMs}ms)` : ""}\n请求参数:\n${e.rawToolCall}${e.error ? `\n错误:\n${e.error}` : ""}${e.result ? `\n执行结果:\n${e.result}` : ""}`
                ).join("\n\n")} yolo={yolo} />
              )}
            </div>
            {devDebugOpen && (
              <div style={{ padding: "12px", background: yolo ? "rgba(255,255,255,0.02)" : "var(--c-bg)", borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)" }}>
                {message.toolDebugInfo.map((entry, i) => (
                  <div key={i} style={{ marginBottom: i < message.toolDebugInfo!.length - 1 ? "16px" : 0 }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#f59e0b", marginBottom: "8px", lineHeight: 1.6 }}>
                      ── 第 {entry.round + 1} 轮调用 #{i + 1} ── {entry.error ? <span style={{ color: "#ef4444" }}>失败</span> : <span style={{ color: "#22c55e" }}>成功</span>} {entry.durationMs !== undefined && <span style={{ color: "var(--c-t2)" }}>({entry.durationMs}ms)</span>}
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <div style={{ fontSize: "11px", color: "#ffd700", marginBottom: "4px", lineHeight: 1.6 }}>▶ 请求参数</div>
                      <pre style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--c-t2)", background: "#18181b", padding: "8px 10px", borderRadius: "4px", overflow: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace" }}>{entry.rawToolCall}</pre>
                    </div>
                    {entry.error && (
                      <div>
                        <div style={{ fontSize: "11px", color: "#ef4444", marginBottom: "4px", lineHeight: 1.6 }}>▶ 错误</div>
                        <pre style={{ fontSize: "11px", lineHeight: 1.5, color: "#f87171", background: "#1c1010", padding: "8px 10px", borderRadius: "4px", overflow: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace" }}>{entry.error}</pre>
                      </div>
                    )}
                    {entry.result && (
                      <div>
                        <div style={{ fontSize: "11px", color: "#22c55e", marginBottom: "4px", lineHeight: 1.6 }}>▶ 执行结果</div>
                        <pre style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--c-t2)", background: "#18181b", padding: "8px 10px", borderRadius: "4px", overflow: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", maxHeight: "200px" }}>{entry.result}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(isStreaming || hasReasoning || isTool) && <style>{animations}</style>}
    </div>
  );
}
