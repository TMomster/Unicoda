import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { Message } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import MessageBubble from "./MessageBubble";
import SecurityBubble from "./SecurityBubble";
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
  /** 用户对消息评价回调（点赞/点踩，null 取消评价） */
  onRate?: (messageId: string, rating: "up" | "down" | null) => void;
  /** 撤回本轮消息回调 */
  onRecall?: (messageId: string) => void;
  /** 模型正在生成中 */
  isStreaming?: boolean;
  /** 隐藏欢迎页的功能提示气泡（移动端使用） */
  hideWelcomeHints?: boolean;
}

function WelcomeScreen({ hideHints }: { hideHints?: boolean }) {
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
        {t("startNewChat")}
      </p>

      {/* Feature hints */}
      {!hideHints && (
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
      )}
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
  onRate,
  onRecall,
  isStreaming,
  hideWelcomeHints,
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

  // 计算每一轮的结束索引和最后一条 assistant 消息索引
  const { lastAssistantIdx, roundEndIndices, latestRoundEndIdx } = useMemo(() => {
    let lastAsst = -1;
    const roundEnds = new Set<number>();
    // 从后往前找最后一条 assistant 消息
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { lastAsst = i; break; }
    }
    // 找到每一轮的结束位置：assistant 之后跟 user 或是末尾
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "assistant" && (i === messages.length - 1 || messages[i + 1].role === "user")) {
        roundEnds.add(i);
      }
    }
    // 最新一轮 = roundEnds 中的最大索引
    let latest = -1;
    for (const idx of roundEnds) { if (idx > latest) latest = idx; }
    return { lastAssistantIdx: lastAsst, roundEndIndices: roundEnds, latestRoundEndIdx: latest };
  }, [messages]);

  if (messages.length === 0) {
    return <WelcomeScreen hideHints={hideWelcomeHints} />;
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
          <SecurityBubble t={t} />
          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id} message={msg} modelName={modelName} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} yolo={yolo} onPreviewFile={onPreviewFile} onRate={onRate} onRecall={onRecall} isLastAssistant={idx === lastAssistantIdx} isRoundEnd={roundEndIndices.has(idx)} isLatestRound={idx === latestRoundEndIdx} />
          ))}
          {(() => {
            const lastUsage = messages.filter((m) => m.role === "assistant" && m.usage).pop()?.usage;
            if (!lastUsage || isStreaming) return null;
            return (
              <div style={{ textAlign: "center", padding: "8px 0 4px", fontSize: "11px", color: "var(--c-t5)", userSelect: "none", fontFamily: "monospace" }}>
                ↑ {lastUsage.prompt_tokens.toLocaleString()} 输入 · {lastUsage.completion_tokens.toLocaleString()} 输出 · 共计 {lastUsage.total_tokens.toLocaleString()} tokens
              </div>
            );
          })()}
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
