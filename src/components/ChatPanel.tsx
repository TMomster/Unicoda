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
          color: "#e0e0e0",
          letterSpacing: "-0.3px",
        }}
      >
        {t("yourRequestOurCode")}
      </h1>
      <p
        style={{
          fontSize: "14px",
          color: "#6a6a6e",
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
        border: "1px solid #2a2a2e",
        fontSize: "12px",
        color: "#8a8a8e",
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 显式滚动容器自身，避免 scrollIntoView 在 transform scale 环境下误滚动父容器
    const container = scrollRef.current;
    if (container) {
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
        backgroundColor: "#0f0f11",
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
          <MessageBubble key={msg.id} message={msg} modelName={modelName} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} />
        ))}
      </div>
    </div>
  );
}
