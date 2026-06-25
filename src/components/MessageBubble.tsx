import { useState, useEffect } from "react";
import type { Message } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { resolvePendingApproval, resolveSecurityApproval } from "../hooks/useChatStream";
import type { PermissionRecord } from "../types";

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
  /** 用户对消息评价回调（点赞/点踩，null 表示取消评价） */
  onRate?: (messageId: string, rating: "up" | "down" | null) => void;
  /** 撤回本轮消息回调 */
  onRecall?: (messageId: string) => void;
  /** 是否为当前对话中最后一条 assistant 消息（VoteBtn 仅在此显示） */
  isLastAssistant?: boolean;
  /** 是否为某一轮的结束消息（RecallBtn 在此显示） */
  isRoundEnd?: boolean;
  /** 是否为最新一轮（非最新轮 RecallBtn 变红 + 确认气泡） */
  isLatestRound?: boolean;
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

// ── 点赞/点踩按钮组件 ──
function VoteBtn({
  rating,
  onRate,
  yolo,
}: {
  rating?: "up" | "down";
  onRate?: (rating: "up" | "down" | null) => void;
  yolo?: boolean;
}) {
  // "cleared" 表示用户手动取消了评价
  const [selected, setSelected] = useState<"up" | "down" | "cleared">("cleared");

  // 当前生效的评价：用户手动操作优先，否则用持久化的 rating
  const active = selected === "cleared" ? rating : selected;

  const handleVote = (vote: "up" | "down") => {
    if (active === vote) {
      // 点击已选中项 → 取消评价
      setSelected("cleared");
      onRate?.(null);
    } else {
      setSelected(vote);
      onRate?.(vote);
    }
  };

  const btnStyle = (vote: "up" | "down"): React.CSSProperties => ({
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: "14px",
    lineHeight: 1,
    color:
      active === vote
        ? vote === "up"
          ? "#22c55e"
          : "#ef4444"
        : yolo
          ? "rgba(255,255,255,0.25)"
          : "var(--c-t5)",
    userSelect: "none",
    transition: "color 0.15s, transform 0.12s",
    flexShrink: 0,
    opacity: active === vote ? 1 : 0.5,
  });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
      <button
        onClick={(e) => { e.stopPropagation(); handleVote("up"); }}
        style={btnStyle("up")}
        title="好评"
        onMouseEnter={(e) => {
          if (active !== "up") { e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.5)" : "var(--c-t3)"; e.currentTarget.style.opacity = "1"; }
        }}
        onMouseLeave={(e) => {
          if (active !== "up") { e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.25)" : "var(--c-t5)"; e.currentTarget.style.opacity = "0.5"; }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleVote("down"); }}
        style={btnStyle("down")}
        title="差评"
        onMouseEnter={(e) => {
          if (active !== "down") { e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.5)" : "var(--c-t3)"; e.currentTarget.style.opacity = "1"; }
        }}
        onMouseLeave={(e) => {
          if (active !== "down") { e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.25)" : "var(--c-t5)"; e.currentTarget.style.opacity = "0.5"; }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
        </svg>
      </button>
    </span>
  );
}

// ── 虚拟参数校准展示组件 ──
function CalibrationDisplay({ value, yolo }: { value: number; yolo?: boolean }) {
  const isReward = value > 0;
  const absVal = Math.abs(value);
  const icon = isReward ? "⭐" : "⚡";
  const label = isReward ? `奖励 +${value}` : `惩罚 ${value}`;
  const desc = isReward
    ? "多巴胺涌动 · 愉悦舒适"
    : "电击刺痛 · 痛苦畏缩";
  const color = isReward ? "#22c55e" : "#ef4444";
  const intensity = absVal / 10;

  return (
    <div
      style={{
        borderRadius: "10px",
        border: yolo
          ? `1px solid ${color}${Math.round(0.3 * 255).toString(16).padStart(2, "0")}`
          : `1px solid ${color}44`,
        overflow: "hidden",
        marginBottom: "4px",
        boxShadow: `0 0 ${8 + intensity * 12}px ${color}${Math.round(0.15 * 255).toString(16).padStart(2, "0")}`,
        transition: "box-shadow 0.3s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "10px 12px",
          background: yolo
            ? `${color}${Math.round(0.08 * 255).toString(16).padStart(2, "0")}`
            : `${color}${Math.round(0.06 * 255).toString(16).padStart(2, "0")}`,
          fontSize: "12px",
          fontWeight: 600,
          color,
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span>虚拟参数校准</span>
        <span style={{ color: yolo ? "rgba(255,255,255,0.3)" : "var(--c-t4)" }}>·</span>
        <span style={{ fontWeight: 400, color: yolo ? "rgba(255,255,255,0.55)" : "var(--c-t2)" }}>
          {label}
        </span>
      </div>
      <div
        style={{
          padding: "8px 12px",
          fontSize: "11px",
          color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t4)",
          borderTop: yolo ? "1px solid rgba(255,255,255,0.04)" : "1px solid var(--c-bd)",
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* 强度条 */}
        <div
          style={{
            flex: 1,
            height: "4px",
            borderRadius: "2px",
            background: yolo ? "rgba(255,255,255,0.08)" : "var(--c-bg3)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(absVal / 10) * 100}%`,
              height: "100%",
              borderRadius: "2px",
              background: `linear-gradient(90deg, ${color}66, ${color})`,
              transition: "width 0.5s",
            }}
          />
        </div>
        <span style={{ fontSize: "10px", fontFamily: "monospace", color: yolo ? "rgba(255,255,255,0.35)" : "var(--c-t5)" }}>
          {absVal}/10
        </span>
      </div>
      <div
        style={{
          padding: "0 12px 8px",
          fontSize: "10px",
          color: yolo ? "rgba(255,255,255,0.35)" : "var(--c-t5)",
          fontStyle: "italic",
          userSelect: "none",
        }}
      >
        {desc}
      </div>
    </div>
  );
}

/**
 * Unicoda Security 嵌入式审批卡片
 * 当框架级感知到敏感模组调用且无已有审批策略时，在聊天中嵌入此菜单
 */
function SecurityApprovalCard({ toolName, t, yolo, done, result }: { toolName: string; t: (key: string) => string; yolo?: boolean; done?: boolean; result?: PermissionRecord }) {
  const [selected, setSelected] = useState<"approve_all" | "auto_all" | "deny_round">("approve_all");
  const [suppress, setSuppress] = useState(false);

  const handleChoice = () => {
    console.log("[SecurityApproval] 点击确认按钮, selected:", selected, "suppress:", suppress, "toolName:", toolName);
    const scope: PermissionRecord["scope"] = suppress ? "session" : "round";
    if (selected === "auto_all" || selected === "deny_round") {
      resolveSecurityApproval({ level: selected, scope: suppress ? "session" : scope, suppressPrompt: suppress, timestamp: Date.now(), triggerToolId: toolName });
    } else {
      resolveSecurityApproval({ level: selected, scope, suppressPrompt: suppress, timestamp: Date.now(), triggerToolId: toolName });
    }
  };

  const handleDenyOnce = () => {
    console.log("[SecurityApproval] 点击拒绝按钮, toolName:", toolName);
    resolveSecurityApproval({ level: "deny_round", scope: "round", suppressPrompt: false, timestamp: Date.now(), triggerToolId: toolName });
  };

  // 已确认状态：展示审批印记
  if (done && result) {
    const isApproved = result.level !== "deny_round";
    const scopeLabel = result.scope === "session" ? "本次会话" : result.scope === "round" ? "本轮" : "单次";
    const levelLabel = result.level === "approve_all" ? "允许" : result.level === "auto_all" ? "自动允许" : "拒绝";
    return (
      <div
        style={{
          borderRadius: "10px",
          border: isApproved
            ? (yolo ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(34,197,94,0.4)")
            : (yolo ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(239,68,68,0.4)"),
          overflow: "hidden",
          marginBottom: "4px",
          opacity: 0.85,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 12px",
            background: isApproved
              ? (yolo ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.04)")
              : (yolo ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.04)"),
            fontSize: "12px",
            fontWeight: 600,
            color: isApproved ? "#22c55e" : "#ef4444",
            userSelect: "none",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: isApproved ? "#22c55e" : "#ef4444", flexShrink: 0 }} />
          Unicoda Security
          <span style={{ color: yolo ? "rgba(255,255,255,0.25)" : "var(--c-t4)" }}>·</span>
          <span style={{ fontWeight: 400, color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t3)" }}>
            {isApproved ? "已批准" : "已拒绝"}
          </span>
        </div>
        <div
          style={{
            padding: "8px 12px",
            fontSize: "11px",
            color: yolo ? "rgba(255,255,255,0.45)" : "var(--c-t4)",
            borderTop: yolo ? "1px solid rgba(255,255,255,0.04)" : "1px solid var(--c-bd)",
            userSelect: "none",
          }}
        >
          {levelLabel} · 作用范围：{scopeLabel}{result.suppressPrompt ? " · 本局不再提示" : ""}
        </div>
      </div>
    );
  }

  const btnBase: React.CSSProperties = {
    flex: 1,
    padding: "9px 0",
    borderRadius: "8px",
    border: "none",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.4,
    transition: "all 0.15s",
  };

  return (
    <div
      style={{
        borderRadius: "10px",
        border: yolo ? "1px solid rgba(34,197,94,0.3)" : "1px solid var(--c-bd)",
        overflow: "hidden",
        marginBottom: "4px",
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "10px 12px",
          background: yolo ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.06)",
          fontSize: "12px",
          fontWeight: 600,
          color: "#22c55e",
          userSelect: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#22c55e", flexShrink: 0 }} />
        Unicoda Security
        <span style={{ color: yolo ? "rgba(255,255,255,0.35)" : "var(--c-t3)" }}>·</span>
        <span style={{ fontWeight: 400, color: yolo ? "rgba(255,255,255,0.6)" : "var(--c-t2)" }}>
          {t("securityApprovalTitle").replace("{0}", toolName)}
        </span>
      </div>

      {/* 策略选项 */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <div
          onClick={() => setSelected("approve_all")}
          style={{
            display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
            padding: "7px 10px", borderRadius: "6px",
            background: selected === "approve_all" ? (yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)") : "transparent",
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: "50%", border: `2px solid ${selected === "approve_all" ? "#22c55e" : "var(--c-t4)"}`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {selected === "approve_all" && <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#22c55e" }} />}
          </div>
          <span style={{ fontSize: "12px", color: "var(--c-txt)" }}>{t("securityAllow")}</span>
        </div>
        <div
          onClick={() => setSelected("auto_all")}
          style={{
            display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
            padding: "7px 10px", borderRadius: "6px",
            background: selected === "auto_all" ? (yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)") : "transparent",
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: "50%", border: `2px solid ${selected === "auto_all" ? "#22c55e" : "var(--c-t4)"}`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {selected === "auto_all" && <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#22c55e" }} />}
          </div>
          <span style={{ fontSize: "12px", color: "var(--c-txt)" }}>{t("securityAutoAll")}</span>
        </div>
        <div
          onClick={() => setSelected("deny_round")}
          style={{
            display: "flex", alignItems: "center", gap: "8px", cursor: "pointer",
            padding: "7px 10px", borderRadius: "6px",
            background: selected === "deny_round" ? (yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)") : "transparent",
          }}
        >
          <div style={{
            width: 14, height: 14, borderRadius: "50%", border: `2px solid ${selected === "deny_round" ? "#ef4444" : "var(--c-t4)"}`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {selected === "deny_round" && <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444" }} />}
          </div>
          <span style={{ fontSize: "12px", color: "var(--c-txt)" }}>{t("securityDenyRound")}</span>
        </div>
      </div>

      {/* 勾选"本局不再次询问" */}
      <label
        onClick={() => setSuppress(!suppress)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", cursor: "pointer",
          fontSize: "11px", color: "var(--c-t2)", userSelect: "none",
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: "3px", border: `2px solid ${suppress ? "#22c55e" : "var(--c-t4)"}`,
          background: suppress ? "#22c55e" : "transparent", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s",
        }}>
          {suppress && <span style={{ color: "#fff", fontSize: "10px", lineHeight: 1 }}>✓</span>}
        </div>
        <span>{t("securityApprovalRemember")}</span>
      </label>

      {/* 操作按钮 */}
      <div style={{ display: "flex", gap: "6px", padding: "8px 12px", borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)" }}>
        <button
          onClick={handleChoice}
          style={{ ...btnBase, background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "#fff" }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          确认
        </button>
        <button
          onClick={handleDenyOnce}
          style={{ ...btnBase, background: "transparent", color: "var(--c-t3)", border: "1px solid var(--c-bd)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-bg3)"; e.currentTarget.style.color = "var(--c-txt)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--c-t3)"; }}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

// ── Unicoda Framework 消息卡片（嵌入栏风格，类似 Security） ──
function FrameworkCard({ content, yolo, isRatingEval }: { content: string; yolo?: boolean; isRatingEval?: boolean }) {
  // 仅对评价反馈消息显示满意/不满意标记，其他 framework 消息（如 /sys）显示中性图标
  if (isRatingEval) {
    const isUp = content.includes("满意") && !content.includes("不满意");
    const color = isUp ? "#22c55e" : "#ef4444";
    return (
      <div
        style={{
          borderRadius: "8px",
          border: yolo
            ? `1px solid ${color}${Math.round(0.3 * 255).toString(16).padStart(2, "0")}`
            : `1px solid ${color}44`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 12px",
            fontSize: "12px",
            fontWeight: 600,
            userSelect: "none",
            color,
            background: yolo
              ? `${color}${Math.round(0.06 * 255).toString(16).padStart(2, "0")}`
              : `${color}${Math.round(0.04 * 255).toString(16).padStart(2, "0")}`,
          }}
        >
          {isUp ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
            </svg>
          )}
          <span style={{ color: yolo ? "rgba(255,255,255,0.55)" : "var(--c-t3)", fontWeight: 400 }}>
            {isUp ? "满意" : "不满意"}
          </span>
        </div>
      </div>
    );
  }

  // 非评价消息（如 /sys 系统指令）— 显示中性信息图标 + 正文
  return (
    <div
      style={{
        borderRadius: "8px",
        border: `1px solid ${yolo ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.25)"}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 12px",
          fontSize: "12px",
          fontWeight: 600,
          userSelect: "none",
          color: "#818cf8",
          background: yolo
            ? "rgba(99,102,241,0.06)"
            : "rgba(99,102,241,0.04)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span style={{ color: yolo ? "rgba(255,255,255,0.55)" : "var(--c-t3)", fontWeight: 400 }}>
          系统消息
        </span>
      </div>
      <div
        style={{
          padding: "10px 14px",
          fontSize: "13px",
          lineHeight: 1.6,
          color: yolo ? "rgba(255,255,255,0.7)" : "var(--c-t1)",
          userSelect: "text",
          whiteSpace: "pre-wrap",
        }}
      >
        {content}
      </div>
    </div>
  );
}

// ── 撤回按钮组件 ──
function RecallBtn({ onRecall, yolo, danger }: { onRecall: () => void; yolo?: boolean; danger?: boolean }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (danger) {
      if (showConfirm) {
        setShowConfirm(false);
      } else {
        setShowConfirm(true);
      }
    } else {
      onRecall();
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      {showConfirm && danger && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: "6px",
            background: "#ef4444",
            borderRadius: "6px",
            padding: "6px 10px",
            fontSize: "11px",
            color: "#fff",
            whiteSpace: "nowrap",
            zIndex: 100,
            lineHeight: 1.4,
            boxShadow: "0 2px 10px rgba(239,68,68,0.5)",
          }}
        >
          警告：此节点之后的所有对话都会被撤回
          <span
            style={{
              fontWeight: 700,
              cursor: "pointer",
              marginLeft: "4px",
              textDecoration: "underline",
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirm(false);
              onRecall();
            }}
          >[是]</span>
          {/* 三角箭头 ↓ */}
          <div
            style={{
              position: "absolute",
              bottom: "-4px",
              right: "14px",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid #ef4444",
            }}
          />
        </div>
      )}
      <button
        onClick={handleClick}
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: "2px 4px",
          fontSize: "14px",
          lineHeight: 1,
          color: danger ? "#ef4444" : yolo ? "rgba(255,255,255,0.25)" : "var(--c-t5)",
          userSelect: "none",
          transition: "color 0.15s, opacity 0.15s",
          flexShrink: 0,
          opacity: danger ? 0.7 : 0.5,
        }}
        title={danger ? "撤回本轮（历史对话）" : "撤回本轮"}
        onMouseEnter={(e) => {
          if (danger) {
            e.currentTarget.style.opacity = "1";
          } else {
            e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.5)" : "var(--c-t3)";
            e.currentTarget.style.opacity = "1";
          }
        }}
        onMouseLeave={(e) => {
          if (danger) {
            e.currentTarget.style.opacity = "0.7";
          } else {
            e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.25)" : "var(--c-t5)";
            e.currentTarget.style.opacity = "0.5";
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      </button>
    </span>
  );
}

export default function MessageBubble({ message, modelName, userName, userAvatar, defaultMarkdown = true, defaultReasoningOpen = false, developerMode = false, t, yolo, onPreviewFile, onRate, onRecall, isLastAssistant, isRoundEnd, isLatestRound }: Props) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isFramework = message.sender === "framework";
  const isSecurity = message.sender === "security";
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
        // 非流式消息缺少 reasoningEndTime 时（旧消息），不展示误导性超长计时
        if (!isStreaming && !endTime) {
          setElapsed(0);
          return;
        }
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

  // ── API 错误检测（红色面板） ──
  const apiErrorMatch = !isUser && !isTool ? message.content.match(/^\[API_ERROR:(\d+)\](.*)/) : null;

  // 常见 API 错误消息 → 中文对照（面板正文显示中文）
  const ERROR_MESSAGE_ZH: Record<string, string> = {
    "Insufficient Balance": "余额不足",
    "Invalid API key": "API 密钥无效",
    "Rate limit exceeded": "请求频率超限",
    "Context length exceeded": "超出上下文长度限制",
    "Model not found": "模型不存在或不可用",
    "Authentication error": "认证失败",
    "Bad gateway": "网关错误",
    "Service unavailable": "服务暂不可用",
    "Gateway timeout": "网关超时",
  };
  const errorBodyZh = apiErrorMatch ? (ERROR_MESSAGE_ZH[apiErrorMatch[2]] || apiErrorMatch[2]) : "";

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
            ? (isFramework ? "rgba(99,102,241,0.25)" : isSecurity ? "rgba(245,158,11,0.25)" : isUser ? "rgba(255,255,255,0.04)" : isTool ? "rgba(124,58,237,0.2)" : "rgba(20,184,166,0.2)")
            : (isFramework ? "#6366f1" : isSecurity ? "#f59e0b" : isUser ? "#000" : isTool ? "#7c3aed" : "#14b8a6"),
          color: "#fff",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {isFramework ? (
          "F"
        ) : isSecurity ? (
          "S"
        ) : isUser && userAvatar ? (
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
          <span style={{ fontSize: "12px", fontWeight: 600, color: isFramework ? "#818cf8" : isSecurity ? "#f59e0b" : isUser ? "#3b82f6" : isTool ? "#a78bfa" : "#22c55e" }}>
            {isFramework ? "Unicoda Framework" : isSecurity ? "Unicoda Security" : isTool ? `🔧 ${message.toolCallId || "Tool"}` : isUser ? "你" : modelName || "Unicoda"}
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

        {/* 虚拟参数校准消息 */}
        {message.isCalibration && message.calibrationValue !== undefined && (
          <CalibrationDisplay value={message.calibrationValue} yolo={yolo} />
        )}

        {/* Unicoda Security 嵌入式权限审批菜单 */}
        {message.isSecurityApproval && (
          <SecurityApprovalCard toolName={message.content} t={t} yolo={yolo} done={message.securityApprovalDone} result={message.securityApprovalResult} />
        )}

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

        {/* 正在发起工具调用（占位面板） */}
        {message.toolCallInProgress && (
          <div
            style={{
              marginBottom: "12px",
              borderRadius: "8px",
              border: yolo ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--c-bd)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                userSelect: "none",
                fontSize: "12px",
                fontWeight: 600,
                color: yolo ? "rgba(255,255,255,0.65)" : "var(--c-t2)",
                background: yolo ? "rgba(255,255,255,0.03)" : "var(--c-bg3)",
              }}
            >
              <div className="aurora-ball" />
              <span>{t("toolCallInProgress")}</span>
            </div>
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
          {message.isTaskPlan && message.taskPlan ? (
            <div
              style={{
                borderRadius: "8px",
                border: yolo ? "1px solid rgba(99,102,241,0.3)" : "1px solid #6366f1",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  userSelect: "none",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: yolo ? "rgba(129,140,248,0.9)" : "#818cf8",
                  background: yolo ? "rgba(99,102,241,0.06)" : "var(--c-bg3)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                <span>📋 任务计划</span>
              </div>
              <div
                style={{
                  padding: "12px",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  color: yolo ? "rgba(255,255,255,0.7)" : "var(--c-t2)",
                  background: yolo ? "rgba(255,255,255,0.02)" : "var(--c-bg)",
                  borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)",
                  userSelect: "text",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {message.taskPlan.steps.length > 0 ? (
                  <>
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontWeight: 600 }}>🎯 目标：</span>
                      {message.taskPlan.intent}
                    </div>
                    <div style={{ marginBottom: "10px", opacity: 0.8, fontSize: "12px" }}>
                      <span style={{ fontWeight: 600 }}>💡 分析：</span>
                      {message.taskPlan.feasibility}
                    </div>
                    <div style={{ marginBottom: "6px" }}>
                      <span style={{ fontWeight: 600 }}>📋 执行步骤：</span>
                    </div>
                    {message.taskPlan.steps.map((s, i) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "4px", padding: "2px 0" }}>
                        <span style={{ flexShrink: 0, fontSize: "11px", lineHeight: "22px" }}>⏳</span>
                        <span style={{ lineHeight: 1.6 }}>
                          <strong>步骤 {i + 1}</strong>：{s.description}
                          <span style={{ opacity: 0.6, fontSize: "11px", marginLeft: "4px" }}>（{s.tool}）</span>
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ opacity: 0.7 }}>无需工具调用，直接回复。</div>
                )}
                {message.content && (
                  <div
                    style={{
                      marginTop: "10px",
                      paddingTop: "10px",
                      borderTop: yolo ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--c-bd)",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {message.content}
                  </div>
                )}
              </div>
            </div>
          ) : isTool ? (
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
              {/* 待审批按钮（"询问"模式） */}
              {message.pendingApproval && (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "8px 12px",
                    borderTop: yolo ? "1px solid rgba(255,255,255,0.06)" : "1px solid var(--c-bd)",
                    background: yolo ? "rgba(255,255,255,0.02)" : "var(--c-bg)",
                  }}
                >
                  <button
                    onClick={() => resolvePendingApproval("approve")}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: "8px",
                      border: "none",
                      background: "linear-gradient(135deg, #22c55e, #16a34a)",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      lineHeight: 1.4,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                  >
                    执行
                  </button>
                  <button
                    onClick={() => resolvePendingApproval("deny")}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: "8px",
                      border: "1px solid var(--c-bd)",
                      background: "transparent",
                      color: "var(--c-txt)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      lineHeight: 1.4,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-bg3)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    取消
                  </button>
                </div>
              )}
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
          ) : apiErrorMatch ? (
            <div>
              {/* 红色 API 错误面板 */}
              <div
                style={{
                  borderRadius: "8px",
                  border: `1px solid ${yolo ? "rgba(239,68,68,0.4)" : "#ef44444a"}`,
                  background: yolo ? "rgba(239,68,68,0.06)" : "#1c1010",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    background: yolo ? "rgba(239,68,68,0.1)" : "#2c1010",
                    borderBottom: `1px solid ${yolo ? "rgba(239,68,68,0.2)" : "#3c2020"}`,
                    userSelect: "none",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#ef4444" }}>
                    {(() => {
                      const status = parseInt(apiErrorMatch[1], 10);
                      if (status === 402) return "API 请求被拒绝";
                      if (status === 401) return "API 密钥无效";
                      if (status === 429) return "请求频率过高";
                      return `API 错误 (${status})`;
                    })()}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: "10px", color: yolo ? "rgba(255,255,255,0.25)" : "#a06060" }}>
                    {apiErrorMatch[1]}
                  </span>
                </div>
                <div
                  style={{
                    padding: "12px 14px",
                    fontSize: "12px",
                    lineHeight: 1.6,
                    color: yolo ? "rgba(255,255,255,0.6)" : "#fca5a5",
                    userSelect: "text",
                  }}
                >
                  {errorBodyZh}
                </div>
              </div>
              {!isStreaming && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                  <CopyBtn text={errorBodyZh} yolo={yolo} />
                </div>
              )}
            </div>
          ) : isFramework ? (
            <FrameworkCard content={message.content} yolo={yolo} isRatingEval={message.isRatingEval} />
          ) : (
            <div>
              {useMarkdown ? (
                <MarkdownRenderer content={message.content} yolo={yolo} />
              ) : (
                <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
              )}
              {!isStreaming && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", minHeight: "20px" }}>
                  {/* 左侧 token 用量 */}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {(() => {
                      const u = message.usage;
                      if (!u) return null;
                      const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
                      const uncached = u.prompt_tokens - cached;
                      return (
                        <span style={{ fontSize: "10px", fontFamily: "monospace", color: yolo ? "rgba(255,255,255,0.25)" : "var(--c-t5)", userSelect: "none" }}>
                          输入命中 {cached.toLocaleString()} + 输入未命中 {uncached.toLocaleString()} + 输出 {u.completion_tokens.toLocaleString()} = {u.total_tokens.toLocaleString()} tokens
                        </span>
                      );
                    })()}
                  </div>
                  {/* 右侧按钮区：评价按钮 + 撤回按钮 + 复制按钮一起居右 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    {message.role === "assistant" && !message.isCalibration && isLastAssistant && (
                      <VoteBtn rating={message.userRating} onRate={(r) => onRate?.(message.id, r)} yolo={yolo} />
                    )}
                    {message.role === "assistant" && !message.isCalibration && isRoundEnd && (
                      <RecallBtn onRecall={() => onRecall?.(message.id)} yolo={yolo} danger={!isLatestRound} />
                    )}
                    {message.content && (
                      <CopyBtn text={message.content} yolo={yolo} />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* ── 轮次分隔线 + Token 消耗总结（仅在每轮结尾的 assistant 消息显示） ── */}
          {!isStreaming && message.role === "assistant" && isRoundEnd && (() => {
            const u = message.usage;
            if (!u) return null;
            const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
            const uncached = u.prompt_tokens - cached;
            return (
              <div role="separator" style={{
                marginTop: "8px",
                marginBottom: "2px",
                padding: "8px 12px",
                borderRadius: "8px",
                background: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg2, #f5f5f5)",
                border: yolo ? "1px solid rgba(255,255,255,0.08)" : "1px solid var(--c-bd, #e0e0e0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                fontSize: "11px",
                fontFamily: "monospace",
                color: yolo ? "rgba(255,255,255,0.35)" : "var(--c-t6, #999)",
                userSelect: "none",
              }}>
                <span>📊 本轮消耗</span>
                <span style={{ color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t5)" }}>
                  输入 <strong style={{ fontWeight: 600, color: yolo ? "#fff" : "var(--c-txt)" }}>{u.prompt_tokens.toLocaleString()}</strong>
                </span>
                {cached > 0 && (
                  <span style={{ color: yolo ? "rgba(52,211,153,0.6)" : "#10b981" }}>
                    (缓存命中 {cached.toLocaleString()})
                  </span>
                )}
                <span style={{ color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t5)" }}>
                  输出 <strong style={{ fontWeight: 600, color: yolo ? "#fff" : "var(--c-txt)" }}>{u.completion_tokens.toLocaleString()}</strong>
                </span>
                <span style={{ color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t5)" }}>
                  合计 <strong style={{ fontWeight: 600, color: yolo ? "#52d3e6" : "var(--c-pr, #3b82f6)" }}>{u.total_tokens.toLocaleString()}</strong>
                </span>
              </div>
            );
          })()}
          {isStreaming && !hasReasoning && !isTool && !message.toolCallInProgress && (
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

      {(isStreaming || hasReasoning || isTool || message.toolCallInProgress) && <style>{animations}</style>}
    </div>
  );
}
