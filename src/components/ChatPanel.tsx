import { useRef, useEffect, useMemo } from "react";
import type { Message } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import MessageBubble from "./MessageBubble";
import AuroraLogo from "./AuroraLogo";

interface Props {
  messages: Message[];
  maxTokens?: number;
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  t: (key: string) => string;
}

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
  // 蓝 (0%) → 绿 (25%) → 黄 (60%) → 橙 (80%) → 红 (100%)
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

export default function ChatPanel({ messages, maxTokens, modelName, userName, userAvatar, defaultMarkdown, defaultReasoningOpen, t }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 计算上下文用量
  const { usedTokens, pct } = useMemo(() => {
    if (!maxTokens || maxTokens <= 0) return { usedTokens: 0, pct: 0 };
    const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    return {
      usedTokens: total,
      pct: Math.min(100, Math.round((total / maxTokens) * 100)),
    };
  }, [messages, maxTokens]);

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
      style={{
        flex: 1,
        overflowY: "auto",
        backgroundColor: "#0f0f11",
        position: "relative",
      }}
    >
      {/* 上下文容量监控（粘在顶部） */}
      {maxTokens && maxTokens > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            justifyContent: "flex-end",
            padding: "6px 16px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "6px",
              backgroundColor: "rgba(15,15,17,0.75)",
              backdropFilter: "blur(6px)",
              fontSize: "11px",
              color: "#8a8a8e",
              userSelect: "none",
              pointerEvents: "auto",
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
          </div>
        </div>
      )}
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "0 24px",
        }}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} modelName={modelName} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} t={t} />
        ))}
      </div>
    </div>
  );
}
