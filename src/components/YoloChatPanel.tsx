import { useRef, useEffect, useState, useCallback } from "react";
import type { Message, FileAttachment } from "../types";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: Message[];
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  developerMode?: boolean;
  t: (key: string) => string;
  onPreviewFile?: (file: FileAttachment) => void;
  /** 模型正在生成中 */
  isStreaming?: boolean;
}

/**
 * Yolo-mode dedicated chat panel.
 * Renders messages inside a stable semi-transparent dark panel
 * instead of floating directly on the aurora background.
 * This eliminates text fuzziness caused by the animated aurora gradients.
 */
export default function YoloChatPanel({
  messages,
  modelName,
  userName,
  userAvatar,
  defaultMarkdown,
  defaultReasoningOpen,
  developerMode,
  t,
  onPreviewFile,
  isStreaming,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // 监听滚动：仅用于更新按钮显隐
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight >= 5);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // 自动滚动：直接读取 DOM 实时 scroll 位置，不在底部绝不滚动
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight - scrollTop - clientHeight >= 5) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
  }, [messages, isStreaming]);

  // 按钮点击：平滑滚到底部
  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollBtn(false);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div ref={scrollRef} className="chat-scroll" style={{
        flex: 1,
        overflowY: "auto",
      }}>
        <div style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "0 24px",
        }}>
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              modelName={modelName}
              userName={userName}
              userAvatar={userAvatar}
              defaultMarkdown={defaultMarkdown}
              defaultReasoningOpen={defaultReasoningOpen}
              developerMode={developerMode}
              t={t}
              yolo
              onPreviewFile={onPreviewFile}
            />
          ))}
        </div>
      </div>

      {/* 滚到底部按钮 — 放在外层容器中，不随内容滚动 */}
      <button
        onClick={scrollToBottom}
        aria-label="滚动到底部"
        style={{
          position: "absolute",
          bottom: "16px",
          right: "24px",
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "none",
          backgroundColor: "var(--c-pr)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          zIndex: 10,
          opacity: showScrollBtn ? 1 : 0,
          transition: "opacity 0.2s",
          pointerEvents: showScrollBtn ? "auto" : "none",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </button>
    </div>
  );
}
