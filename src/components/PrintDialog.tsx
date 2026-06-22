import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "../types";

interface PrintDialogProps {
  messages: Message[];
  modelName?: string;
  userName?: string;
  t: (key: string) => string;
  onClose: () => void;
}

type ColorScheme = "white" | "black" | "yolo";

/** 将 Markdown 格式化内容转换为纯文本（保留换行） */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim())
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/>\s+/g, "")
    .replace(/[-*+]\s+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 获取消息的简短摘要（用于列表卡片中的预览） */
function getMessagePreview(msg: Message, maxLen = 120): string {
  const text = stripMarkdown(msg.content);
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

const roleLabels: Record<string, string> = {
  user: "你",
  assistant: "Unicoda",
  tool: "工具",
  system: "系统",
};

const roleColors: Record<string, string> = {
  user: "#3b82f6",
  assistant: "#22c55e",
  tool: "#a78bfa",
  system: "#f59e0b",
};

const colorSchemeNames: Record<ColorScheme, string> = {
  white: "白色",
  black: "黑色",
  yolo: "Yolo",
};

type PrintSettingToggleProps = {
  checked: boolean;
  onChange: () => void;
  label: string;
};

function PrintSettingToggle({ checked, onChange, label }: PrintSettingToggleProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        cursor: "pointer",
        fontSize: "12px",
        color: checked ? "var(--c-txt)" : "var(--c-t4)",
        userSelect: "none",
        padding: "3px 6px",
        borderRadius: "4px",
        transition: "all 0.15s",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "14px",
          height: "14px",
          border: `2px solid ${checked ? "#3b82f6" : "var(--c-t4)"}`,
          borderRadius: "3px",
          background: checked ? "#3b82f6" : "transparent",
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.15s",
        }}
      />
      {label}
    </label>
  );
}

type SchemeButtonProps = {
  scheme: ColorScheme;
  current: ColorScheme;
  onChange: (s: ColorScheme) => void;
};

function SchemeButton({ scheme, current, onChange }: SchemeButtonProps) {
  const active = scheme === current;
  return (
    <button
      onClick={() => onChange(scheme)}
      style={{
        background: active ? "#3b82f6" : "transparent",
        border: active ? "1px solid #3b82f6" : "1px solid var(--c-bd2)",
        color: active ? "#fff" : "var(--c-t2)",
        padding: "3px 10px",
        borderRadius: "4px",
        fontSize: "12px",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {colorSchemeNames[scheme]}
    </button>
  );
}

export default function PrintDialog({
  messages,
  modelName,
  userName,
  t,
  onClose,
}: PrintDialogProps) {
  // ── Print settings ─────────────────────────────────
  const [hideToolCalls, setHideToolCalls] = useState(true);
  const [hideDebugInfo, setHideDebugInfo] = useState(true);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [colorScheme, setColorScheme] = useState<ColorScheme>("white");
  const [showReasoning, setShowReasoning] = useState(false);
  const [showModelInfo, setShowModelInfo] = useState(true);
  const [showUnisonInfo, setShowUnisonInfo] = useState(true);
  const [showAnchors, setShowAnchors] = useState(false);
  const [showSecurityApproval, setShowSecurityApproval] = useState(true);
  const [showTokenUsage, setShowTokenUsage] = useState(true);

  // 默认全选所有 user、assistant 和权限记录消息（跳过 tool 和普通 system）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const msg of messages) {
      if (msg.role === "user" || msg.role === "assistant" || msg.permissionRecord || msg.isSecurityApproval) {
        initial.add(msg.id);
      }
    }
    return initial;
  });
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── 导出菜单状态 ────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);

  // 点击外部关闭导出菜单
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node) &&
        exportBtnRef.current &&
        !exportBtnRef.current.contains(e.target as Node)
      ) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  // ── 构建导出文本 / Markdown ──────────────────────
  const buildExportContent = useCallback(
    (format: "txt" | "md"): string => {
      let selectedMsgs = messages.filter((m) => selectedIds.has(m.id));
      if (hideToolCalls) selectedMsgs = selectedMsgs.filter((m) => m.role !== "tool");
      if (hideDebugInfo) {
        selectedMsgs = selectedMsgs.filter(
          (m) => !(m.role === "assistant" && m.toolDebugInfo && m.toolDebugInfo.length > 0),
        );
      }
      if (selectedMsgs.length === 0) return "";

      const now = new Date();
      const dateStr = now.toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });

      const lines: string[] = [];

      if (format === "txt") {
        const sep = "─".repeat(48);
        lines.push(sep);
        lines.push("Unicoda 会话结果导出");
        lines.push(sep);
        if (modelName) lines.push(`模型：${modelName}`);
        lines.push(`共 ${selectedMsgs.length} 条消息 · ${dateStr}`);
        lines.push("");

        for (const msg of selectedMsgs) {
          const label = msg.role === "user" ? (userName || "你") : (modelName || roleLabels[msg.role] || "Unicoda");
          const ts = new Date(msg.timestamp).toLocaleString("zh-CN", {
            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
          });
          lines.push(`──── [${label}] ${ts} ────`);
          // 标签：深度思考、工具调用、任务计划、安全审批
          if (showReasoning && msg.reasoningContent) lines.push("【深度思考】");
          if (msg.role === "tool" && msg.toolCallId) lines.push(`【工具调用】${msg.toolCallId}`);
          if (msg.isTaskPlan) lines.push("【任务计划】");
          if (msg.isSecurityApproval) {
            const levelLabel = msg.securityApprovalDone
              ? (msg.securityApprovalResult?.level === "deny_round" ? "已拒绝" : "已批准")
              : "待审批";
            lines.push(`【安全审批】${levelLabel} · ${msg.content}`);
          }
          if (showReasoning && msg.reasoningContent) {
            lines.push(`[思考过程]`);
            lines.push(msg.reasoningContent);
          }
          // 工具调用拒绝/错误信息
          if (msg.role === "tool") {
            if (msg.toolCallError) {
              lines.push(`[执行错误] ${msg.toolCallError}`);
            } else if (msg.content) {
              lines.push(msg.content);
            } else {
              lines.push("(空结果)");
            }
          } else {
            lines.push(msg.content);
          }
          lines.push("");
        }
        // Token 记录
        if (showTokenUsage) {
          const lastTokenMsg = messages.filter((m) => m.role === "assistant" && m.usage).pop();
          if (lastTokenMsg?.usage) {
            lines.push(`──── Token 记录 ────`);
            lines.push(`输入：${lastTokenMsg.usage.prompt_tokens.toLocaleString()} · 输出：${lastTokenMsg.usage.completion_tokens.toLocaleString()} · 合计：${lastTokenMsg.usage.total_tokens.toLocaleString()} tokens`);
            lines.push("");
          }
        }
      } else {
        // md
        lines.push("# Unicoda 会话结果导出");
        lines.push("");
        if (modelName) lines.push(`- **模型**：${modelName}`);
        lines.push(`- **共 ${selectedMsgs.length} 条消息** · ${dateStr}`);
        lines.push("");
        lines.push("---");
        lines.push("");

        for (const msg of selectedMsgs) {
          const label = msg.role === "user" ? (userName || "你") : (modelName || roleLabels[msg.role] || "Unicoda");
          const ts = new Date(msg.timestamp).toLocaleString("zh-CN", {
            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
          });
          lines.push(`## ${label} — ${ts}`);
          lines.push("");
          // 标签
          const tags: string[] = [];
          if (showReasoning && msg.reasoningContent) tags.push("深度思考");
          if (msg.role === "tool" && msg.toolCallId) tags.push("工具调用");
          if (msg.isTaskPlan) tags.push("任务计划");
          if (msg.isSecurityApproval) {
            const levelLabel = msg.securityApprovalDone
              ? (msg.securityApprovalResult?.level === "deny_round" ? "已拒绝" : "已批准")
              : "待审批";
            tags.push(`安全审批(${levelLabel})`);
          }
          if (tags.length > 0) {
            lines.push(`> **标签**：${tags.join(" · ")}`);
            lines.push("");
          }
          if (showReasoning && msg.reasoningContent) {
            lines.push("> **思考过程**");
            lines.push(`> ${msg.reasoningContent.replace(/\n/g, "\n> ")}`);
            lines.push("");
          }
          // 工具调用错误/结果
          if (msg.role === "tool") {
            if (msg.toolCallError) {
              lines.push(`> **错误**：${msg.toolCallError}`);
              lines.push("");
            } else if (msg.content) {
              lines.push(msg.content);
              lines.push("");
            } else {
              lines.push("_(空结果)_");
              lines.push("");
            }
          } else {
            lines.push(msg.content);
            lines.push("");
          }
          lines.push("---");
          lines.push("");
        }
        // Token 记录
        if (showTokenUsage) {
          const lastTokenMsg = messages.filter((m) => m.role === "assistant" && m.usage).pop();
          if (lastTokenMsg?.usage) {
            lines.push(`## Token 记录`);
            lines.push("");
            lines.push(`- **输入**：${lastTokenMsg.usage.prompt_tokens.toLocaleString()}`);
            lines.push(`- **输出**：${lastTokenMsg.usage.completion_tokens.toLocaleString()}`);
            lines.push(`- **合计**：${lastTokenMsg.usage.total_tokens.toLocaleString()} tokens`);
            lines.push("");
            lines.push("---");
            lines.push("");
          }
        }
      }

      return lines.join("\n");
    },
    [messages, selectedIds, modelName, userName, hideToolCalls, hideDebugInfo, showReasoning, showTokenUsage],
  );

  const handleExport = useCallback(
    async (format: "txt" | "md") => {
      setShowExportMenu(false);
      const content = buildExportContent(format);
      if (!content) return;

      const ext = format === "txt" ? "txt" : "md";
      const defaultName = `Unicoda_会话导出_${new Date().toISOString().slice(0, 10)}.${ext}`;

      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const filePath = await save({
          defaultPath: defaultName,
          filters: [
            { name: format === "txt" ? "Text File" : "Markdown File", extensions: [ext] },
          ],
        });
        if (!filePath) return; // 用户取消

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_text_file_at", { path: filePath, data: "\uFEFF" + content });
      } catch {
        // 降级：浏览器 Blob 下载
        const mimeType = format === "txt" ? "text/plain" : "text/markdown";
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    },
    [buildExportContent],
  );

  // 打开时自动滚动到底部（最新消息）
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  const allVisible = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.permissionRecord || m.isSecurityApproval);
  const allSelected = allVisible.length > 0 && allVisible.every((m) => selectedIds.has(m.id));
  const selectedCount = selectedIds.size;

  // 根据设置过滤显示的消息（需在 toggleSelect 之前定义，避免 TDZ）
  const displayMessages = messages.filter((m) => {
    if (m.role === "system" && !m.permissionRecord && !m.isSecurityApproval) return false;
    if (m.role === "assistant" && (m.content.startsWith("[对话历史摘要]") || m.content.startsWith("[Conversation History Summary]"))) return false;
    if (hideToolCalls && m.role === "tool") return false;
    if (hideDebugInfo && m.role === "assistant" && m.toolDebugInfo && m.toolDebugInfo.length > 0) return false;
    if (!showSecurityApproval && m.isSecurityApproval) return false;
    return true;
  });

  const toggleSelect = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastClickedIdx !== null) {
          // Shift+click：选择范围内所有消息，跟随当前点击的 toggle 状态
          const start = Math.min(lastClickedIdx, index);
          const end = Math.max(lastClickedIdx, index);
          const isCurrentlySelected = prev.has(id);

          for (let i = start; i <= end; i++) {
            const m = displayMessages[i];
            if (m) {
              if (isCurrentlySelected) {
                next.add(m.id);
              } else {
                next.delete(m.id);
              }
            }
          }
        } else {
          // 普通点击：切换单个
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          setLastClickedIdx(index);
        }

        return next;
      });
    },
    [lastClickedIdx, displayMessages],
  );

  // 处理按住 Shift 点击时的 lastClickedIdx 更新（需在 toggleSelect 之外）
  const handleClick = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      if (!shiftKey) {
        setLastClickedIdx(index);
      }
      toggleSelect(id, index, shiftKey);
    },
    [toggleSelect],
  );

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisible.map((m) => m.id)));
    }
    setLastClickedIdx(null);
  }, [allSelected, allVisible]);

  // ── Build print CSS per color scheme ──────────────
  const getPrintStyles = useCallback(() => {
    const baseReset = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html { height: 100%; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    `;
    const contentPadding = "padding: 20mm 15mm;";
    switch (colorScheme) {
      case "black":
        return `
          @page { margin: 0; }
          ${baseReset}
          html { background: #0f0f11; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.7; color: #e0e0e0; ${contentPadding} background: #0f0f11; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-header { text-align: center; padding-bottom: 16px; margin-bottom: 24px; border-bottom: 2px solid #3a3a3e; }
          .print-header h1 { font-size: 18pt; font-weight: 700; color: #e0e0e0; }
          .print-header .print-meta { font-size: 10pt; color: #8a8a8e; margin-top: 4px; }
          .print-header .print-model-info,.print-header .print-unison-info { font-size: 9pt; color: #6a6a6e; margin-top: 2px; }
          .print-toc { margin-bottom: 24px; padding: 12px 16px; border: 1px solid #3a3a3e; border-radius: 6px; background: #18181b; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-toc h2 { font-size: 13pt; font-weight: 700; color: #e0e0e0; margin-bottom: 8px; }
          .print-toc ul { list-style: none; padding: 0; margin: 0; }
          .print-toc li { margin: 3px 0; font-size: 9pt; }
          .print-toc a { color: #60a5fa; text-decoration: none; }
          .print-toc a:hover { text-decoration: underline; }
          .print-message { margin-bottom: 20px; padding: 10px 14px; border-radius: 6px; border: 1px solid #2a2a2e; page-break-inside: avoid; }
          .print-message-user { background: #0a1428; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-assistant { background: #0a1a0f; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-tool { background: #140a24; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 10pt; }
          .print-role-label { font-weight: 700; }
          .print-timestamp { color: #6a6a6e; font-size: 9pt; }
          .print-reasoning { margin-top: 8px; padding: 8px 12px; border-left: 3px solid #3b82f6; background: #0a1428; border-radius: 4px; font-size: 10pt; font-style: italic; color: #8a8a8e; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-reasoning p { margin: 4px 0; }
          .print-content { font-size: 11pt; color: #d4d4d8; }
          .print-content p { margin: 6px 0; }
          .print-content pre { background: #18181b; border: 1px solid #2a2a2e; border-radius: 4px; padding: 8px 12px; font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 8px 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content code { font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; background: #1a1a1e; padding: 1px 4px; border-radius: 3px; color: #d4d4d8; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content pre code { background: none; padding: 0; }
          .print-content blockquote { border-left: 3px solid #3a3a3e; padding-left: 12px; margin: 8px 0; color: #8a8a8e; }
          .print-content ul,.print-content ol { margin: 6px 0; padding-left: 20px; }
          .print-content img { max-width: 100%; height: auto; }
          .print-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
          .print-content th,.print-content td { border: 1px solid #3a3a3e; padding: 6px 10px; text-align: left; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content th { background: #1a1a1e; font-weight: 600; }
          .print-footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #3a3a3e; font-size: 8pt; color: #6a6a6e; }`;
      case "yolo":
        return `
          @page { margin: 0; }
          ${baseReset}
          html { background: linear-gradient(135deg, #061a3a 0%, #0f3460 30%, #1a5276 50%, #4a2a6a 70%, #0d2137 100%), radial-gradient(circle at 20% 30%, rgba(30, 180, 255, 0.35) 0%, transparent 80%), radial-gradient(circle at 80% 60%, rgba(200, 80, 255, 0.30) 0%, transparent 75%), radial-gradient(circle at 45% 70%, rgba(0, 255, 200, 0.25) 0%, transparent 80%); background-blend-mode: overlay, screen, lighten, normal; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.7; color: #e0e0e0; ${contentPadding} background: linear-gradient(135deg, #061a3a 0%, #0f3460 30%, #1a5276 50%, #4a2a6a 70%, #0d2137 100%), radial-gradient(circle at 20% 30%, rgba(30, 180, 255, 0.35) 0%, transparent 80%), radial-gradient(circle at 80% 60%, rgba(200, 80, 255, 0.30) 0%, transparent 75%), radial-gradient(circle at 45% 70%, rgba(0, 255, 200, 0.25) 0%, transparent 80%); background-blend-mode: overlay, screen, lighten, normal; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-header { text-align: center; padding-bottom: 16px; margin-bottom: 24px; border-bottom: 2px solid rgba(255,255,255,0.15); }
          .print-header h1 { font-size: 18pt; font-weight: 700; color: #e0e0e0; }
          .print-header .print-meta { font-size: 10pt; color: #8a8a8e; margin-top: 4px; }
          .print-header .print-model-info,.print-header .print-unison-info { font-size: 9pt; color: rgba(255,255,255,0.5); margin-top: 2px; }
          .print-toc { margin-bottom: 24px; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; background: rgba(0,0,0,0.3); page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-toc h2 { font-size: 13pt; font-weight: 700; color: #e0e0e0; margin-bottom: 8px; }
          .print-toc ul { list-style: none; padding: 0; margin: 0; }
          .print-toc li { margin: 3px 0; font-size: 9pt; }
          .print-toc a { color: #60a5fa; text-decoration: none; }
          .print-toc a:hover { text-decoration: underline; }
          .print-message { margin-bottom: 20px; padding: 10px 14px; border-radius: 6px; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
          .print-message-user { background: rgba(10, 20, 40, 0.7); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-assistant { background: rgba(10, 26, 15, 0.7); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-tool { background: rgba(20, 10, 36, 0.7); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 10pt; }
          .print-role-label { font-weight: 700; }
          .print-timestamp { color: #6a6a6e; font-size: 9pt; }
          .print-reasoning { margin-top: 8px; padding: 8px 12px; border-left: 3px solid #3b82f6; background: rgba(10,20,40,0.5); border-radius: 4px; font-size: 10pt; font-style: italic; color: rgba(255,255,255,0.55); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-reasoning p { margin: 4px 0; }
          .print-content { font-size: 11pt; color: #d4d4d8; }
          .print-content p { margin: 6px 0; }
          .print-content pre { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 8px 12px; font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 8px 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content code { font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; color: #d4d4d8; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content pre code { background: none; padding: 0; }
          .print-content blockquote { border-left: 3px solid rgba(255,255,255,0.15); padding-left: 12px; margin: 8px 0; color: #8a8a8e; }
          .print-content ul,.print-content ol { margin: 6px 0; padding-left: 20px; }
          .print-content img { max-width: 100%; height: auto; }
          .print-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
          .print-content th,.print-content td { border: 1px solid rgba(255,255,255,0.1); padding: 6px 10px; text-align: left; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content th { background: rgba(0,0,0,0.3); font-weight: 600; }
          .print-footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 8pt; color: rgba(255,255,255,0.4); }`;
      default: // white
        return `
          @page { margin: 0; }
          ${baseReset}
          html { background: #fff; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.7; color: #222; ${contentPadding} background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-header { text-align: center; padding-bottom: 16px; margin-bottom: 24px; border-bottom: 2px solid #333; }
          .print-header h1 { font-size: 18pt; font-weight: 700; color: #111; }
          .print-header .print-meta { font-size: 10pt; color: #666; margin-top: 4px; }
          .print-header .print-model-info,.print-header .print-unison-info { font-size: 9pt; color: #888; margin-top: 2px; }
          .print-toc { margin-bottom: 24px; padding: 12px 16px; border: 1px solid #ddd; border-radius: 6px; background: #fafafa; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-toc h2 { font-size: 13pt; font-weight: 700; color: #111; margin-bottom: 8px; }
          .print-toc ul { list-style: none; padding: 0; margin: 0; }
          .print-toc li { margin: 3px 0; font-size: 9pt; }
          .print-toc a { color: #2563eb; text-decoration: none; }
          .print-toc a:hover { text-decoration: underline; }
          .print-message { margin-bottom: 20px; padding: 10px 14px; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
          .print-message-user { background: #f0f7ff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-assistant { background: #f6fdf6; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-tool { background: #f5f0ff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 10pt; }
          .print-role-label { font-weight: 700; }
          .print-timestamp { color: #999; font-size: 9pt; }
          .print-reasoning { margin-top: 8px; padding: 8px 12px; border-left: 3px solid #3b82f6; background: #f0f7ff; border-radius: 4px; font-size: 10pt; font-style: italic; color: #555; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-reasoning p { margin: 4px 0; }
          .print-content { font-size: 11pt; color: #333; }
          .print-content p { margin: 6px 0; }
          .print-content pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 8px 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content code { font-family: "SF Mono","Fira Code","Consolas",monospace; font-size: 10pt; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content pre code { background: none; padding: 0; }
          .print-content blockquote { border-left: 3px solid #ccc; padding-left: 12px; margin: 8px 0; color: #555; }
          .print-content ul,.print-content ol { margin: 6px 0; padding-left: 20px; }
          .print-content img { max-width: 100%; height: auto; }
          .print-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
          .print-content th,.print-content td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .print-content th { background: #f0f0f0; font-weight: 600; }
          .print-footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 8pt; color: #999; }`;
    }
  }, [colorScheme]);

  const handlePrint = useCallback(() => {
    // 根据设置过滤选中的消息
    let selectedMsgs = messages.filter((m) => selectedIds.has(m.id));
    if (hideToolCalls) selectedMsgs = selectedMsgs.filter((m) => m.role !== "tool");
    if (hideDebugInfo) {
      selectedMsgs = selectedMsgs.filter(
        (m) => !(m.role === "assistant" && m.toolDebugInfo && m.toolDebugInfo.length > 0),
      );
    }
    if (selectedMsgs.length === 0) return;

    const now = new Date();
    const dateStr = now.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });

    // ── 锚点目录 ──
    let tocHtml = "";
    if (showAnchors) {
      const tocItems = selectedMsgs
        .map((msg, i) => {
          const label = msg.role === "user" ? (userName || "你") : (modelName || roleLabels[msg.role] || "Unicoda");
          const preview = stripMarkdown(msg.content).slice(0, 50);
          return `<li><a href="#msg-${i}">${escapeHtml(label)}: ${escapeHtml(preview)}</a></li>`;
        })
        .join("\n");
      tocHtml = `<div class="print-toc"><h2>目录</h2><ul>${tocItems}</ul></div>`;
    }

    // ── 消息列表 ──
    const messageHtml = selectedMsgs
      .map((msg, i) => {
        const label = msg.role === "user" ? (userName || "你") : (modelName || roleLabels[msg.role] || "Unicoda");
        const ts = new Date(msg.timestamp).toLocaleString("zh-CN", {
          month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        // 标签（消息头下面显示）
        const tags: string[] = [];
        if (showReasoning && msg.reasoningContent) tags.push('<span style="color:#3b82f6;font-weight:600">深度思考</span>');
        if (msg.role === "tool" && msg.toolCallId) tags.push('<span style="color:#a78bfa;font-weight:600">工具调用</span>');
        if (msg.isTaskPlan) tags.push('<span style="color:#818cf8;font-weight:600">任务计划</span>');
        if (msg.isSecurityApproval) {
          const done = msg.securityApprovalDone;
          const isApproved = msg.securityApprovalResult?.level !== "deny_round";
          const stateLabel = done ? (isApproved ? "已批准" : "已拒绝") : "待审批";
          const color = !done ? "#f59e0b" : isApproved ? "#22c55e" : "#ef4444";
          tags.push(`<span style="color:${color};font-weight:600">安全审批(${stateLabel})</span>`);
        }
        const tagsHtml = tags.length > 0
          ? `<div style="font-size:9pt;margin-bottom:6px;display:flex;gap:8px;flex-wrap:wrap">${tags.join("")}</div>`
          : "";
        let contentHtml: string;
        if (msg.role === "tool") {
          if (msg.toolCallError) {
            contentHtml = `<div style="color:#ef4444;font-size:11pt"><strong>[执行错误]</strong> ${escapeHtml(msg.toolCallError)}</div>`;
          } else if (msg.content) {
            contentHtml = renderMarkdown ? renderMarkdownToHtml(msg.content) : escapeHtml(msg.content);
          } else {
            contentHtml = '<span style="color:#888;font-style:italic">(空结果 — 已拒绝)</span>';
          }
        } else if (msg.isSecurityApproval) {
          if (msg.securityApprovalDone && msg.securityApprovalResult) {
            const r = msg.securityApprovalResult;
            const isApproved = r.level !== "deny_round";
            const scopeLabel = r.scope === "session" ? "本次会话" : r.scope === "round" ? "本轮" : "单次";
            contentHtml = `<div style="font-size:11pt;color:${isApproved ? "#22c55e" : "#ef4444"}">` +
              `<strong>${isApproved ? "已批准" : "已拒绝"}</strong> · ${r.level} · 范围：${scopeLabel}` +
              (r.suppressPrompt ? " · 本局不再提示" : "") +
              `</div>`;
          } else {
            contentHtml = escapeHtml(msg.content);
          }
        } else {
          contentHtml = renderMarkdown ? renderMarkdownToHtml(msg.content) : escapeHtml(msg.content);
        }
        let debugHtml = "";
        if (!hideDebugInfo && msg.toolDebugInfo && msg.toolDebugInfo.length > 0) {
          debugHtml = `<div class="print-debug-info"><strong>调试信息：</strong><pre>${escapeHtml(
            msg.toolDebugInfo.map((d) => `第 ${d.round + 1} 轮${d.error ? " 失败" : " 成功"}${d.durationMs !== undefined ? ` (${d.durationMs}ms)` : ""}`).join("\n"),
          )}</pre></div>`;
        }
        // 思考过程
        let reasoningHtml = "";
        if (showReasoning && msg.reasoningContent) {
          const rcHtml = renderMarkdown
            ? renderMarkdownToHtml(msg.reasoningContent)
            : escapeHtml(msg.reasoningContent);
          reasoningHtml = `<div class="print-reasoning">${rcHtml}</div>`;
        }
        const anchorAttr = showAnchors ? ` id="msg-${i}"` : "";
        return `
          <div class="print-message print-message-${msg.role}"${anchorAttr}>
            <div class="print-message-header">
              <span class="print-role-label" style="color: ${roleColors[msg.role] || "#888"}">${escapeHtml(label)}</span>
              <span class="print-timestamp">${ts}</span>
            </div>
            ${tagsHtml}
            ${reasoningHtml}
            <div class="print-content">${contentHtml}</div>
            ${debugHtml}
          </div>`;
      })
      .join("\n");

    // ── 页眉附加信息 ──
    let headerExtra = "";
    if (showModelInfo && modelName) {
      headerExtra += `<div class="print-model-info">模型：${escapeHtml(modelName)}</div>`;
    }
    if (showUnisonInfo) {
      headerExtra += `<div class="print-unison-info">Unicoda v0.1.0</div>`;
    }

    // ── 页脚许可证（固定显示） ──
    const footerHtml = `<div class="print-footer">Unicoda v0.1.0 | Designed by Momster | Apache 2.0 License | ${dateStr}</div>`;

    // ── Token 记录 ──
    let tokenHtml = "";
    if (showTokenUsage) {
      const lastTokenMsg = messages.filter((m) => m.role === "assistant" && m.usage).pop();
      if (lastTokenMsg?.usage) {
        tokenHtml = `<div style="text-align:center;padding:12px 0 4px;font-size:9pt;color:var(--c-t5,#888);font-family:monospace">
          ↑ ${lastTokenMsg.usage.prompt_tokens.toLocaleString()} 输入 · ${lastTokenMsg.usage.completion_tokens.toLocaleString()} 输出 · 共计 ${lastTokenMsg.usage.total_tokens.toLocaleString()} tokens
        </div>`;
      }
    }

    const printCss = getPrintStyles();
    const printHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unicoda 会话结果导出</title><style>${printCss}</style></head>
<body>
  <div class="print-header">
    <h1>Unicoda 会话结果导出</h1>
    <div class="print-meta">共 ${selectedMsgs.length} 条消息 · ${dateStr}</div>
    ${headerExtra}
  </div>
  ${tocHtml}
  ${messageHtml}
  ${tokenHtml}
  ${footerHtml}
</body></html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);
      const iframeDoc = iframe.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(printHtml);
        iframeDoc.close();
        setTimeout(() => {
          iframe.contentWindow?.print();
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 250);
      }
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  }, [messages, selectedIds, modelName, userName, hideToolCalls, hideDebugInfo, renderMarkdown, getPrintStyles, showReasoning, showModelInfo, showUnisonInfo, showAnchors, showTokenUsage, showSecurityApproval]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .print-checkbox {
          appearance: none;
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border: 2px solid var(--c-t4);
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .print-checkbox:checked {
          background: #3b82f6;
          border-color: #3b82f6;
        }
        .print-checkbox:checked::after {
          content: "✓";
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
        }
        .print-checkbox:hover {
          border-color: var(--c-t5);
        }
        .print-message-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid var(--c-bd);
          cursor: pointer;
          transition: background 0.1s;
          border-radius: 4px;
          margin: 0 -8px;
          padding: 10px 8px;
        }
        .print-message-row:hover {
          background: rgba(255,255,255,0.03);
        }
        .print-message-row.selected {
          background: rgba(59,130,246,0.06);
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid var(--c-bd)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--c-t2)",
              cursor: "pointer",
              fontSize: "18px",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              lineHeight: 1,
            }}
            title={t("back") || "返回"}
          >
            ←
          </button>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--c-txt)", margin: 0 }}>
            {t("print") || "打印"}
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative" }}>
          <button
            ref={exportBtnRef}
            onClick={() => setShowExportMenu((v) => !v)}
            disabled={selectedCount === 0}
            style={{
              background: "transparent",
              border: "1px solid var(--c-bd2)",
              color: selectedCount > 0 ? "var(--c-txt)" : "var(--c-t4)",
              padding: "6px 12px",
              borderRadius: "4px",
              fontSize: "13px",
              cursor: selectedCount > 0 ? "pointer" : "default",
              transition: "all 0.15s",
            }}
          >
            以文档导出 📄
          </button>
          {showExportMenu && (
            <div
              ref={exportMenuRef}
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "4px",
                background: "var(--c-bg2)",
                border: "1px solid var(--c-bd)",
                borderRadius: "6px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                zIndex: 300,
                minWidth: "140px",
                overflow: "hidden",
              }}
            >
              <div
                onClick={() => handleExport("txt")}
                style={{
                  padding: "8px 14px",
                  fontSize: "13px",
                  color: "var(--c-txt)",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-bg3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                📝 纯文本 (.txt)
              </div>
              <div
                onClick={() => handleExport("md")}
                style={{
                  padding: "8px 14px",
                  fontSize: "13px",
                  color: "var(--c-txt)",
                  cursor: "pointer",
                  borderTop: "1px solid var(--c-bd)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-bg3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                📄 Markdown (.md)
              </div>
            </div>
          )}
          <button
            onClick={handlePrint}
            disabled={selectedCount === 0}
            style={{
              background: selectedCount > 0 ? "#3b82f6" : "var(--c-bd)",
              border: "none",
              color: selectedCount > 0 ? "#fff" : "var(--c-t4)",
              padding: "6px 16px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: selectedCount > 0 ? "pointer" : "default",
              transition: "all 0.15s",
            }}
          >
            {t("print") || "打印"} 🖨️
          </button>
        </div>
      </div>

      {/* Settings bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "7px 20px",
          borderBottom: "1px solid var(--c-bd)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <PrintSettingToggle checked={!hideToolCalls} onChange={() => setHideToolCalls((v) => !v)} label="工具调用" />
        <PrintSettingToggle checked={!hideDebugInfo} onChange={() => setHideDebugInfo((v) => !v)} label="调试信息" />
        <PrintSettingToggle checked={renderMarkdown} onChange={() => setRenderMarkdown((v) => !v)} label="Markdown" />

        <span style={{ width: "1px", height: "18px", background: "var(--c-bd)", margin: "0 4px" }} />

        <PrintSettingToggle checked={showReasoning} onChange={() => setShowReasoning((v) => !v)} label={t("showReasoning")} />
        <PrintSettingToggle checked={showModelInfo} onChange={() => setShowModelInfo((v) => !v)} label={t("showModelInfo")} />
        <PrintSettingToggle checked={showUnisonInfo} onChange={() => setShowUnisonInfo((v) => !v)} label={t("showUnisonInfo")} />
        <PrintSettingToggle checked={showAnchors} onChange={() => setShowAnchors((v) => !v)} label={t("showAnchors")} />

        <span style={{ width: "1px", height: "18px", background: "var(--c-bd)", margin: "0 4px" }} />

        <PrintSettingToggle checked={showSecurityApproval} onChange={() => setShowSecurityApproval((v) => !v)} label="安全审批" />
        <PrintSettingToggle checked={showTokenUsage} onChange={() => setShowTokenUsage((v) => !v)} label="Token 记录" />

        <span style={{ flex: 1 }} />

        <span style={{ fontSize: "12px", color: "var(--c-t5)", marginRight: "2px" }}>配色：</span>
        <SchemeButton scheme="white" current={colorScheme} onChange={setColorScheme} />
        <SchemeButton scheme="black" current={colorScheme} onChange={setColorScheme} />
        <SchemeButton scheme="yolo" current={colorScheme} onChange={setColorScheme} />

        <span style={{ flex: 1 }} />

        <span style={{ fontSize: "12px", color: "var(--c-t5)" }}>
          {selectedCount} / {displayMessages.length} {t("selected") || "已选"}
        </span>
        <button
          onClick={toggleAll}
          style={{
            background: "transparent",
            border: "1px solid var(--c-bd2)",
            color: "var(--c-txt)",
            padding: "3px 10px",
            borderRadius: "4px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          {allSelected ? (t("deselectAll") || "取消全选") : (t("selectAll") || "全选")}
        </button>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 20px 20px",
        }}
      >
        <div style={{ maxWidth: "640px", margin: "0 auto" }}>
          {displayMessages.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "var(--c-t5)",
                fontSize: "14px",
              }}
            >
              {(t("noMessages") || "暂无消息")}
            </div>
          )}
          {displayMessages.map((msg, index) => {
            const isSelected = selectedIds.has(msg.id);
            const label = msg.role === "user" ? (userName || "你") : (msg.role === "assistant" ? (modelName || "Unicoda") : (roleLabels[msg.role] || msg.role));
            return (
              <div
                key={msg.id}
                className={`print-message-row ${isSelected ? "selected" : ""}`}
                onClick={(e) => handleClick(msg.id, index, e.shiftKey)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}} // 由 div 的 onClick 处理
                  onClick={(e) => e.stopPropagation()}
                  className="print-checkbox"
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: roleColors[msg.role] || "#888",
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--c-t4)" }}>
                      {new Date(msg.timestamp).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {msg.toolCallError && (
                      <span style={{ fontSize: "10px", color: "#ef4444" }}>错误</span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      lineHeight: 1.6,
                      color: isSelected ? "var(--c-txt)" : "var(--c-t4)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {getMessagePreview(msg)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 简单的 HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 将 Markdown 渲染为简单的 HTML（用于打印模板） */
function renderMarkdownToHtml(md: string): string {
  let html = md;

  // 代码块（必须提前处理，避免被其他规则干扰）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.trim());
    return lang
      ? `<pre><code class="language-${escapeHtml(lang)}">${escaped}</code></pre>`
      : `<pre><code>${escaped}</code></pre>`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 加粗 + 斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 删除线
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // 标题
  html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // 引用
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // 无序列表
  html = html.replace(/^[-*+] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // 合并连续的有序列表项
  html = html.replace(/(?:^<li>.*<\/li>$\n?)+/gm, (match) => {
    // 只包裹还没有被 ul 包裹的连续 li
    if (!match.includes("<ul>")) {
      return `<ol>${match}</ol>`;
    }
    return match;
  });

  // 水平线
  html = html.replace(/^---$/gm, "<hr />");

  // 段落（双换行 → <p>）
  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";

  // 清理空段落和嵌套问题
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p><li>/g, "<li>");
  html = html.replace(/<\/li><\/p>/g, "</li>");

  // 清理行内 HTML 中的换行
  html = html.replace(/\n/g, "<br />");

  return html;
}
