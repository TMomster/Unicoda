import { useRef, useEffect, useState, useCallback } from "react";
import type { Message } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import MessageBubble from "./MessageBubble";
import AuroraLogo from "./AuroraLogo";

interface Props {
  messages: Message[];
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  developerMode?: boolean;
  t: (key: string) => string;
  /** Yolo 玻璃模式 — 透明背景 */
  yolo?: boolean;
  /** 点击文件附件时回调 */
  onPreviewFile?: (file: import("../types").FileAttachment) => void;
  /** 模型正在生成中 */
  isStreaming?: boolean;
}

function WelcomeScreen() {
  const { t } = useTheme();
  const hints = [
    t("fileReadWrite"),
    t("commandExec"),
    t("codeGen"),
    t("projectAnalysis"),
  ];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "40px 20px",
      }}
    >
      {/* Aurora Logo */}
      <AuroraLogo size={70} fontSize={38} rounded={18} />
      <h1
        style={{
          fontSize: "22px",
          fontWeight: 700,
          color: "var(--c-txt)",
          letterSpacing: "-0.3px",
        }}
      >
        {t("yourRequestOurCode")}
      </h1>
      <p
        style={{
          fontSize: "14px",
          color: "var(--c-t5)",
          textAlign: "center",
          maxWidth: "400px",
          lineHeight: 1.6,
        }}
      >
        {t("whatToDo")}
      </p>

      {/* Feature hints */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: "8px",
        }}
      >
        {hints.map((hint) => (
          <Hint key={hint} tag={hint} />
        ))}
      </div>
    </div>
  );
}

function Hint({ tag }: { tag: string }) {
  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: "20px",
        border: "1px solid var(--c-bd)",
        fontSize: "12px",
        color: "var(--c-t6)",
        cursor: "default",
      }}
    >
      {tag}
    </span>
  );
}

export default function ChatPanel({
  messages,
  modelName,
  userName,
  userAvatar,
  defaultMarkdown,
  defaultReasoningOpen,
  developerMode,
  t,
  yolo,
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
    if (scrollHeight - scrollTop - clientHeight >= 5) return; // 用户不在底部，绝不干涉
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
  }, [messages, isStreaming]);

  // 按钮点击：平滑滚到底部
  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollBtn(false);
  }, []);

  if (messages.length === 0) {
    return <WelcomeScreen />;
  }

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
      <div
        ref={scrollRef}
        className="chat-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          backgroundColor: yolo ? "transparent" : "var(--c-bg)",
        }}
      >
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "0 24px",
          }}
        >
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} modelName={modelName} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} yolo={yolo} onPreviewFile={onPreviewFile} />
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
