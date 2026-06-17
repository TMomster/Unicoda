import { useState, useEffect } from "react";
import type { Message } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  message: Message;
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  t: (key: string) => string;
}

const blinkStyle = `
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
`;

export default function MessageBubble({ message, modelName, userName, userAvatar, defaultMarkdown = true, defaultReasoningOpen = false, t }: Props) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming;
  const hasReasoning = !!message.reasoningContent;
  const [reasoningOpen, setReasoningOpen] = useState(defaultReasoningOpen);
  const [elapsed, setElapsed] = useState(0);
  const [useMarkdown, setUseMarkdown] = useState(defaultMarkdown);

  useEffect(() => {
    if (hasReasoning) {
      const startTime = message.timestamp;
      const updateElapsed = () => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      };
      updateElapsed(); // set initial immediately
      if (isStreaming) {
        const interval = setInterval(updateElapsed, 1000);
        return () => clearInterval(interval);
      }
    }
  }, [hasReasoning, isStreaming, message.timestamp]);

  const reasoningTitle = `${isStreaming ? t("reasoningInProgress") : t("reasoning")}（${elapsed}s）`;

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "16px 0",
        borderBottom: "1px solid #1a1a1e",
      }}
    >
      {/* Avatar: 用户黑底白字（或自定义头像），模型绿松石色底白字 */}
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
          backgroundColor: isUser ? "#000" : "#14b8a6",
          color: "#fff",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {isUser && userAvatar ? (
          <img src={userAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
          <span style={{ fontSize: "12px", fontWeight: 600, color: isUser ? "#3b82f6" : "#22c55e" }}>
            {isUser ? "你" : modelName || "Unison"}
          </span>
          <button
            onClick={() => setUseMarkdown(!useMarkdown)}
            title={t("markdownBtnTitle")}
            style={{
              border: "none",
              background: "transparent",
              color: useMarkdown ? "#3b82f6" : "#4a4a4e",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              padding: "0 2px",
              lineHeight: 1,
              letterSpacing: "0.5px",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { if (!useMarkdown) e.currentTarget.style.color = "#6a6a6e"; }}
            onMouseLeave={(e) => { if (!useMarkdown) e.currentTarget.style.color = "#4a4a4e"; }}
          >
            M
          </button>
        </div>

        {/* 思考过程（可折叠） */}
        {hasReasoning && (
          <div
            style={{
              marginBottom: "12px",
              borderRadius: "8px",
              border: "1px solid #2a2a2e",
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
                color: "#a0a0a0",
                background: "#151518",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1e"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#151518"; }}
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
              {isStreaming && <div className="aurora-ball" />}
              <span>{reasoningTitle}</span>
            </div>
            {reasoningOpen && (
              <div
                style={{
                  padding: "12px",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  color: "#8a8a8e",
                  background: "#0f0f11",
                  borderTop: "1px solid #2a2a2e",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontStyle: "italic",
                }}
              >
                {message.reasoningContent}
                {isStreaming && <span className="streaming-cursor">▊</span>}
              </div>
            )}
          </div>
        )}

        {/* 回复内容 */}
        <div
          style={{
            fontSize: "14px",
            lineHeight: 1.7,
            color: "#d4d4d8",
            wordBreak: "break-word",
          }}
        >
          {isUser ? (
            <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
          ) : useMarkdown ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
          )}
          {isStreaming && !hasReasoning && (
            <span className="streaming-cursor">▊</span>
          )}
        </div>
      </div>

      {(isStreaming || hasReasoning) && <style>{blinkStyle}</style>}
    </div>
  );
}
