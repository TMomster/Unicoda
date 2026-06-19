import { useRef, useEffect } from "react";
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userNearBottomRef = useRef(true);

  // Track scroll position — only auto-scroll if user is near the bottom
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && userNearBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  if (messages.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div
      ref={scrollRef}
      className="chat-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        backgroundColor: yolo ? "transparent" : "var(--c-bg)",
        position: "relative",
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
  );
}
