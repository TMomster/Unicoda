import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import type { FileAttachment, Message, Mode } from "../types";
import { fileToAttachment } from "../utils/fileParser";
import { hasCompressionSummary, MIN_MESSAGES_FOR_COMPRESSION } from "../services/conversationCompression";

const styles = document.createElement("style");
styles.textContent = `
  @keyframes drop-up {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes drop-up-out {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(6px) scale(0.95);
    }
  }
  /* 标准 scrollbar-color 属性，WebView2 原生支持 */
  .input-area {
    scrollbar-width: thin;
    scrollbar-color: #3a3a3e transparent;
  }
  .input-area::-webkit-scrollbar {
    width: 5px;
  }
  .input-area::-webkit-scrollbar-track {
    background: transparent;
  }
  .input-area::-webkit-scrollbar-thumb {
    background: #3a3a3e;
    border-radius: 3px;
    min-height: 30px;
  }
  .input-area::-webkit-scrollbar-thumb:hover {
    background: #5a5a5e;
  }
  .chat-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .chat-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .chat-scroll::-webkit-scrollbar-thumb {
    background: #3a3a3e;
    border-radius: 3px;
    min-height: 30px;
  }
  .chat-scroll::-webkit-scrollbar-thumb:hover {
    background: #5a5a5e;
  }
  .yolo-input-area::placeholder {
    color: rgba(255,255,255,0.25) !important;
  }
  @keyframes input-glow {
    0%, 100% { box-shadow: 0 0 8px rgba(59,130,246,0.35), 0 0 20px rgba(99,102,241,0.15); }
    25%      { box-shadow: 0 0 8px rgba(168,85,247,0.35), 0 0 20px rgba(168,85,247,0.15); }
    50%      { box-shadow: 0 0 8px rgba(236,72,153,0.35), 0 0 20px rgba(236,72,153,0.15); }
    75%      { box-shadow: 0 0 8px rgba(59,130,246,0.35), 0 0 20px rgba(99,102,241,0.15); }
  }
  @keyframes yolo-input-glow {
    0%, 100% { box-shadow: 0 0 12px rgba(59,130,246,0.25), 0 0 30px rgba(99,102,241,0.10); border-color: rgba(59,130,246,0.25); }
    25%      { box-shadow: 0 0 12px rgba(168,85,247,0.25), 0 0 30px rgba(168,85,247,0.10); border-color: rgba(168,85,247,0.25); }
    50%      { box-shadow: 0 0 12px rgba(236,72,153,0.25), 0 0 30px rgba(236,72,153,0.10); border-color: rgba(236,72,153,0.25); }
    75%      { box-shadow: 0 0 12px rgba(59,130,246,0.25), 0 0 30px rgba(99,102,241,0.10); border-color: rgba(59,130,246,0.25); }
  }
`;
document.head.appendChild(styles);

const MODES = ["Chat", "Agent", "Yolo"] as const;

// ── Mode icons (SVG paths) ──────────────────────────
const ModeIcon = ({ mode, size = 14 }: { mode: string; size?: number }) => {
  const s = size;
  if (mode === "Chat") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
  if (mode === "Agent") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="14" rx="3" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /><path d="M9 15c0.5 1 1.5 1.5 3 1.5s2.5-0.5 3-1.5" /></svg>;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>;
};

/** 压缩图标：两侧箭头向中心聚拢 */
const CompressIcon = ({ size = 14, active = false }: { size?: number; active?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 8 21 12 17 16" />
    <polyline points="7 8 3 12 7 16" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

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

interface Props {
  onSend: (text: string, mode?: Mode, files?: FileAttachment[]) => void | Promise<void>;
  onStop: () => void;
  disabled: boolean;
  /** 上下文容量 + 压缩控制 */
  messages?: Message[];
  maxTokens?: number;
  compressionEnabled?: boolean;
  onToggleCompression?: () => void;
  onCompressNow?: () => void;
  isCompressing?: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Yolo 玻璃模式样式 */
  yolo?: boolean;
  /** Tauri 原生拖拽传入的待发送文件（框架级别） */
  pendingFiles?: FileAttachment[];
  onRemovePendingFile?: (id: string) => void;
  onClearPendingFiles?: () => void;
  /**
   * 拖拽覆盖层显示状态（来自父组件的 Tauri 原生 onDragDropEvent，
   * 因为 HTML5 拖拽事件在 Tauri v2 WebView2 上会被抑制，
   * 所以由父组件传入此状态来控制输入框遮罩层）
   */
  dragOver?: boolean;
}

const LINE_HEIGHT_PX = 21; // 14px font * 1.5 line-height
const MAX_NORMAL_LINES = 5;
const MAX_NORMAL_HEIGHT = MAX_NORMAL_LINES * LINE_HEIGHT_PX + 8;  // +8 for vertical padding

/** 文件标签（候选区中的单个文件 chip） */
function FileChip({ file, yolo, onRemove }: { file: FileAttachment; yolo?: boolean; onRemove: (id: string) => void }) {
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        padding: "4px 8px", borderRadius: "6px",
        backgroundColor: yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)",
        border: yolo ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--c-bd2)",
        fontSize: "12px", color: "var(--c-t2)", maxWidth: "200px",
      }}
      title={file.name}
    >
      {file.isImage ? (
        <img src={file.data} alt="" style={{ width: "16px", height: "16px", borderRadius: "2px", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, color: "#60a5fa" }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
        {file.name}
      </span>
      <button
        onClick={() => onRemove(file.id)}
        title="移除"
        style={{
          width: "16px", height: "16px", borderRadius: "3px",
          border: "none", background: "transparent",
          color: "var(--c-t5)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, flexShrink: 0,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--c-t5)"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function InputBar({ onSend, onStop, disabled, messages, maxTokens, compressionEnabled, onToggleCompression, onCompressNow, isCompressing, mode, onModeChange, yolo, pendingFiles, onRemovePendingFile, onClearPendingFiles, dragOver: dragOverProp }: Props) {
  const { t } = useTheme();
  const { models, selectedModelId, setSelectedModelId } = useModels();
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeClosing, setModeClosing] = useState(false);
  const [modelClosing, setModelClosing] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < 300);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 流式生成完成后自动聚焦输入框
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current === true && disabled === false) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [candidateFiles, setCandidateFiles] = useState<FileAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const startClose = () => {
    if (!modeOpen && !modelOpen) return;
    if (modeOpen) {
      setModeClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setModeOpen(false);
        setModeClosing(false);
      }, 180);
    }
    if (modelOpen) {
      setModelClosing(true);
      modelCloseTimerRef.current = setTimeout(() => {
        setModelOpen(false);
        setModelClosing(false);
      }, 180);
    }
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (modelCloseTimerRef.current) clearTimeout(modelCloseTimerRef.current);
    };
  }, []);

  // Auto-resize textarea with smooth expand/collapse animation
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Temporarily remove transition to snap to content height as baseline
    const prevTransition = el.style.transition;
    el.style.transition = "none";
    const prevHeight = el.offsetHeight; // must read before setting "auto"
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;

    const targetHeight = expanded
      ? Math.max(contentHeight, Math.floor(window.innerHeight / 2))
      : Math.min(contentHeight, MAX_NORMAL_HEIGHT);

    // If height hasn't changed, nothing to animate
    if (Math.abs(prevHeight - targetHeight) < 1) {
      el.style.height = targetHeight + "px";
      el.style.transition = prevTransition;
      return;
    }

    // Snap back to previous height (transition off), then animate to target
    el.style.height = prevHeight + "px";
    el.offsetHeight; // force reflow
    el.style.transition = prevTransition || "";
    el.style.height = targetHeight + "px";
  }, [text, expanded]);

  const handleSend = () => {
    const trimmed = text.trim();
    // 合并时按文件名+大小去重，避免同一文件通过不同路径同时出现在两个数组中
    const seen = new Set<string>();
    const allFiles: FileAttachment[] = [];
    for (const file of candidateFiles) {
      const key = file.name + '_' + file.size;
      if (!seen.has(key)) { seen.add(key); allFiles.push(file); }
    }
    for (const file of pendingFiles || []) {
      const key = file.name + '_' + file.size;
      if (!seen.has(key)) { seen.add(key); allFiles.push(file); }
    }
    if ((!trimmed && allFiles.length === 0) || disabled) return;
    onSend(trimmed, mode, allFiles.length > 0 ? allFiles : undefined);
    setText("");
    setExpanded(false);
    setCandidateFiles([]);
    onClearPendingFiles?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Plain Enter → send
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      // Ctrl+Enter / Shift+Enter → insert newline at cursor
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newText = text.slice(0, start) + "\n" + text.slice(end);
      setText(newText);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
    }
  };

  // ── 文件读取与上传（框架级别，不限模型配置） ──
  const addFilesToCandidates = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const allowed: FileAttachment[] = [];
    for (const file of fileArray) {
      // 跳过图片文件
      if (file.type.startsWith("image/")) continue;
      // 限制 10MB 大小
      if (file.size > 10 * 1024 * 1024) continue;
      try {
        const attachment = await fileToAttachment(file);
        allowed.push(attachment);
      } catch { /* skip failed reads */ }
    }
    if (allowed.length > 0) {
      setCandidateFiles((prev) => [...prev, ...allowed]);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    dragCounterRef.current = 0;
    // 注意：文件处理由 Tauri 原生 onDragDropEvent 在顶层完成
    // 此处不再处理 HTML5 拖放的文件，避免与 pendingFiles 重复
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToCandidates(e.target.files);
      e.target.value = ""; // 允许重复选择相同文件
    }
  };

  /** 按文件名+大小从两个数组（candidateFiles + pendingFiles）中同时删除所有匹配项 */
  const removeFileByKey = useCallback((name: string, size: number) => {
    const key = name + '_' + size;
    setCandidateFiles((prev) => prev.filter((f) => f.name + '_' + f.size !== key));
    if (pendingFiles && onRemovePendingFile) {
      pendingFiles
        .filter((f) => f.name + '_' + f.size === key)
        .forEach((f) => onRemovePendingFile(f.id));
    }
  }, [pendingFiles, onRemovePendingFile]);

  const closeAll = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (modelCloseTimerRef.current) clearTimeout(modelCloseTimerRef.current);
    setModeOpen(false);
    setModelOpen(false);
    setModeClosing(false);
    setModelClosing(false);
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);

  // 计算上下文用量
  const { usedTokens, pct } = useMemo(() => {
    if (!maxTokens || maxTokens <= 0 || !messages) return { usedTokens: 0, pct: 0 };
    const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    return {
      usedTokens: total,
      pct: Math.min(100, Math.round((total / maxTokens) * 100)),
    };
  }, [messages, maxTokens]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        backgroundColor: yolo ? "transparent" : "var(--c-bg)",
        padding: "0 16px 5px",
        position: "relative",
      }}
    >
      {/* 隐藏的文件输入 */}
      <input ref={fileInputRef} type="file" multiple
        onChange={handleFileInputChange}
        style={{ display: "none" }}
        accept="*/*" />
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          position: "relative",
        }}
      >
        {/* 文件候选区（合并 InputBar 自有候选 + Tauri 拖拽候选，按文件名+大小去重） */}
        {(candidateFiles.length > 0 || (pendingFiles && pendingFiles.length > 0)) && (
          <div
            style={{
              display: "flex", flexWrap: "wrap", gap: "6px",
              marginBottom: "8px", padding: "4px 0",
            }}
          >
            {(() => {
              const seen = new Set<string>();
              const chips: FileAttachment[] = [];
              for (const file of candidateFiles) {
                const key = file.name + '_' + file.size;
                if (!seen.has(key)) { seen.add(key); chips.push(file); }
              }
              for (const file of pendingFiles || []) {
                const key = file.name + '_' + file.size;
                if (!seen.has(key)) { seen.add(key); chips.push(file); }
              }
              return chips;
            })().map((file) => (
              <FileChip key={file.id} file={file} yolo={yolo} onRemove={() => removeFileByKey(file.name, file.size)} />
            ))}
          </div>
        )}

        {/* Input container */}
        <div
          style={{
            padding: "6px 8px 8px",
            borderRadius: "14px",
            border: yolo ? "1px solid rgba(255,255,255,0.15)" : "1px solid var(--c-bd2)",
            backgroundColor: yolo ? "rgba(8,8,16,0.12)" : "var(--c-bg2)",
            transition: "border-color 0.15s, box-shadow 0.6s ease",
            position: "relative",
            ...(disabled
              ? { animation: yolo ? "yolo-input-glow 3s ease-in-out infinite" : "input-glow 3s ease-in-out infinite" }
              : { boxShadow: "none" }),
          }}
        >
          {/* 拖拽覆盖层（位于输入框容器上层） */}
          {(dragOver || dragOverProp) && (
            <div
              style={{
                position: "absolute", inset: 0, zIndex: 50,
                borderRadius: "14px",
                border: "2px dashed #3b82f6",
                backgroundColor: yolo ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", color: "#60a5fa", fontWeight: 600,
                backdropFilter: yolo ? "blur(4px)" : undefined,
                WebkitBackdropFilter: yolo ? "blur(4px)" : undefined,
                pointerEvents: "none",
              }}
            >
              {"仅支持上传文本文件"}
            </div>
          )}

          {/* Expand / Collapse button */}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "收起输入框" : "展开输入框到半屏高度"}
            style={{
              position: "absolute",
              top: "6px",
              right: "8px",
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              borderRadius: "4px",
              backgroundColor: "transparent",
              color: "var(--c-t5)",
              cursor: "pointer",
              transition: "all 0.15s",
              zIndex: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bd)"; e.currentTarget.style.color = "var(--c-t2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t5)"; }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? t("generating") : t("inputPlaceholder")}
            rows={1}
            className={`input-area${yolo ? " yolo-input-area" : ""}`}
            disabled={disabled}
            style={{
              width: "100%",
              resize: "none",
              border: "none",
              backgroundColor: "transparent",
              color: "var(--c-txt)",
              fontSize: "14px",
              lineHeight: 1.5,
              outline: "none",
              fontFamily: "inherit",
              padding: "4px 28px 4px 8px",
              maxHeight: expanded ? "none" : `${MAX_NORMAL_HEIGHT}px`,
              boxSizing: "border-box",
              opacity: disabled ? 0.4 : 1,
              overflowY: "auto",
              overflowX: "hidden",
              transition: "height 0.2s ease",
            }}
          />

          {/* Bottom bar: selectors + send */}
          <div
            ref={toolbarRef}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 4px",
              marginTop: "4px",
            }}
          >
            {/* Left: selectors */}
            <div style={{ display: "flex", gap: "6px" }}>
              {/* Mode selector */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => {
                    closeAll();
                    setModeOpen(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: narrow ? "3px 8px" : "3px 10px",
                    borderRadius: "6px",
                    border: yolo ? "1px solid rgba(255,255,255,0.15)" : "1px solid var(--c-bd2)",
                    backgroundColor: modeOpen ? (yolo ? "rgba(255,255,255,0.08)" : "var(--c-bg3)") : (yolo ? "rgba(255,255,255,0.04)" : "transparent"),
                    color: yolo ? "#d0d0d8" : "var(--c-t2)",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: "inherit",
                    height: "32px",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)"; if (!yolo) e.currentTarget.style.borderColor = "var(--c-t4)"; }}
                  onMouseLeave={(e) => {
                    if (!modeOpen && !modeClosing) {
                      e.currentTarget.style.backgroundColor = "transparent";
                      if (!yolo) e.currentTarget.style.borderColor = "var(--c-bd2)";
                    }
                  }}
                >
                  <ModeIcon mode={mode} size={14} />
                  {!narrow && <span style={{ lineHeight: 1 }}>{mode}</span>}
                  {!narrow && (
                    <svg
                      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: modeOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", flexShrink: 0 }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </button>

                {(modeOpen || modeClosing) && (
                  <>
                    <div onClick={startClose} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 4px)",
                        left: "4px",
                        zIndex: 100,
                        backgroundColor: yolo ? "rgba(15,15,20,0.55)" : "var(--c-bg3)",
                        border: yolo ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--c-bd2)",
                        borderRadius: "8px",
                        padding: "4px",
                        boxShadow: yolo ? "0 -4px 32px rgba(0,0,0,0.6)" : "0 -4px 24px rgba(0,0,0,0.5)",
                        minWidth: "200px",
                        animation: `${modeClosing ? "drop-up-out" : "drop-up"} 0.18s ease-out both`,
                        transformOrigin: "bottom left",
                        ...(yolo ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } : {}),
                      }}
                    >
                      {MODES.filter(m => yolo || m !== "Yolo").map((m) => {
                        const isSelected = m === mode;
                        const disabled = false;
                        return (
                          <button
                            key={m}
                            onClick={() => {
                              if (disabled) return;
                              onModeChange(m as Mode);
                              startClose();
                            }}
                            onMouseEnter={(e) => { if (!isSelected && !disabled) e.currentTarget.style.backgroundColor = "var(--c-bd)"; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              width: "100%",
                              padding: "7px 12px",
                              borderRadius: "6px",
                              border: "none",
                              fontSize: "13px",
                              fontWeight: isSelected ? 600 : 400,
                              textAlign: "left",
                              cursor: disabled ? "default" : "pointer",
                              backgroundColor: isSelected ? "rgba(37,99,235,0.15)" : "transparent",
                              color: isSelected ? "var(--c-txt)" : disabled ? "var(--c-t5)" : "var(--c-t6)",
                              transition: "all 0.15s",
                              fontFamily: "inherit",
                              opacity: disabled && !isSelected ? 0.6 : 1,
                            }}
                          >
                            <ModeIcon mode={m} size={16} />
                            <span style={{ flex: 1 }}>{m}</span>
                            {disabled && (
                              <span style={{ fontSize: "11px", color: "var(--c-t4)" }}>
                                [不可用]
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Model selector */}
              {models.length > 0 && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => {
                      closeAll();
                      setModelOpen(true);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: narrow ? "0" : "4px",
                      padding: narrow ? "3px 8px" : "3px 10px 3px 8px",
                      borderRadius: "6px",
                    border: yolo ? "1px solid rgba(255,255,255,0.15)" : "1px solid var(--c-bd2)",
                    backgroundColor: modelOpen ? (yolo ? "rgba(255,255,255,0.08)" : "var(--c-bg3)") : (yolo ? "rgba(255,255,255,0.04)" : "transparent"),
                    color: yolo ? "#d0d0d8" : "var(--c-t2)",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontFamily: "inherit",
                      maxWidth: narrow ? "32px" : "160px",
                      height: "32px",
                      boxSizing: "border-box",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(255,255,255,0.06)" : "var(--c-bg3)"; if (!yolo) e.currentTarget.style.borderColor = "var(--c-t4)"; }}
                    onMouseLeave={(e) => {
                      if (!modelOpen && !modelClosing) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        if (!yolo) e.currentTarget.style.borderColor = "var(--c-bd2)";
                      }
                    }}
                  >
                    {/* Status dot */}
                    <span
                      style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        backgroundColor: selectedModel?.apiKey ? "#22c55e" : "var(--c-t4)",
                        flexShrink: 0,
                      }}
                    />
                    {!narrow && (
                      <>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedModel?.name ?? "Select model"}
                        </span>
                        <svg
                          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: modelOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", flexShrink: 0 }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </>
                    )}
                  </button>

                  {(modelOpen || modelClosing) && (
                    <>
                      <div onClick={startClose} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 4px)",
                          left: "4px",
                          zIndex: 100,
                          backgroundColor: yolo ? "rgba(15,15,20,0.55)" : "var(--c-bg3)",
                          border: yolo ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--c-bd2)",
                          borderRadius: "8px",
                          padding: "4px",
                          boxShadow: yolo ? "0 -4px 32px rgba(0,0,0,0.6)" : "0 -4px 24px rgba(0,0,0,0.5)",
                          minWidth: "260px",
                          animation: `${modelClosing ? "drop-up-out" : "drop-up"} 0.18s ease-out both`,
                          transformOrigin: "bottom left",
                          ...(yolo ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } : {}),
                        }}
                      >
                        {models.map((m) => {
                          const isSelected = m.id === selectedModelId;
                          const hasKey = m.apiKey.length > 0;
                          return (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedModelId(m.id);
                                startClose();
                              }}
                              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "var(--c-bd)"; }}
                              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                width: "100%",
                                padding: "7px 12px",
                                borderRadius: "6px",
                                border: "none",
                                fontSize: "13px",
                                fontWeight: isSelected ? 600 : 400,
                                textAlign: "left",
                                cursor: "pointer",
                                backgroundColor: isSelected ? "rgba(37,99,235,0.15)" : "transparent",
                                color: isSelected ? "var(--c-txt)" : "var(--c-t6)",
                                transition: "all 0.15s",
                                fontFamily: "inherit",
                              }}
                            >
                              <span
                                style={{
                                  width: "6px",
                                  height: "6px",
                                  borderRadius: "50%",
                                  backgroundColor: hasKey ? "#22c55e" : "var(--c-t4)",
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ flex: 1 }}>{m.name}</span>
                              <span style={{ fontSize: "11px", color: "var(--c-t4)" }}>{m.provider}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

            {/* 上下文容量 + 压缩开关 */}
            {maxTokens && maxTokens > 0 && (narrow ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  height: "32px",
                  padding: "0 6px",
                  borderRadius: "6px",
                  border: yolo ? "1px solid rgba(255,255,255,0.07)" : "1px solid var(--c-bd2)",
                  fontSize: "11px",
                  boxSizing: "border-box",
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
                {/* Z 图标作为压缩开关 */}
                <button
                  onClick={onToggleCompression}
                  title={compressionEnabled ? "压缩已开启" : "开启压缩"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2px",
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    color: compressionEnabled ? "#60a5fa" : (yolo ? "rgba(255,255,255,0.4)" : "var(--c-t5)"),
                    lineHeight: 1,
                    transition: "all 0.2s",
                    fontFamily: "inherit",
                  }}
                >
                  <CompressIcon size={13} active={compressionEnabled} />
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "32px",
                  padding: "0 8px",
                  borderRadius: "6px",
                  border: yolo ? "1px solid rgba(255,255,255,0.07)" : "1px solid var(--c-bd2)",
                  fontSize: "11px",
                  color: yolo ? "rgba(255,255,255,0.85)" : "var(--c-t6)",
                  userSelect: "none",
                  boxSizing: "border-box",
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
                <span style={{ color: yolo ? "rgba(255,255,255,0.5)" : "var(--c-t4)" }}>
                  {usedTokens.toLocaleString()}/{maxTokens.toLocaleString()}
                </span>

                {/* 分隔线 */}
                <span
                  style={{
                    width: "1px",
                    height: "14px",
                    backgroundColor: "rgba(255,255,255,0.08)",
                  }}
                />

                {/* 压缩开关 */}
                <button
                  onClick={onToggleCompression}
                  title={
                    compressionEnabled
                      ? `对话压缩已开启，点击关闭`
                      : `点击开启对话压缩 — 将早期对话压缩为摘要，保留最近对话完整内容`
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: 0,
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    color: compressionEnabled ? "#60a5fa" : (yolo ? "rgba(255,255,255,0.6)" : "var(--c-t5)"),
                    fontSize: "11px",
                    lineHeight: 1,
                    transition: "all 0.2s",
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  {/* 圆圈外观 */}
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      border: `2px solid ${compressionEnabled ? "#60a5fa" : "var(--c-t4)"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "border-color 0.2s",
                    }}
                  >
                    {compressionEnabled && (
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: "#60a5fa",
                          transition: "background-color 0.2s",
                        }}
                      />
                    )}
                  </span>
                  <span>压缩上下文</span>
                </button>
              </div>
            ))}
            </div>

            {/* Right: Send / Stop button */}
            {disabled ? (
              <button
                onClick={onStop}
                title={t("stopGeneration")}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  border: yolo ? "1px solid rgba(239,68,68,0.4)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  backgroundColor: yolo ? "rgba(239,68,68,0.15)" : "#ef4444",
                  color: yolo ? "rgba(255,255,255,0.8)" : "#fff",
                  fontSize: "16px",
                  flexShrink: 0,
                  transition: "all 0.15s",
                  ...(yolo ? { backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" } : {}),
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(239,68,68,0.25)" : "#dc2626"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = yolo ? "rgba(239,68,68,0.15)" : "#ef4444"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!text.trim()}
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  border: yolo ? (text.trim() ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.12)") : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: text.trim() ? "pointer" : "default",
                  backgroundColor: yolo
                    ? (text.trim() ? "rgba(37,99,235,0.35)" : "rgba(255,255,255,0.05)")
                    : (text.trim() ? "var(--c-ac)" : "var(--c-bd)"),
                  color: yolo
                    ? (text.trim() ? "#ffffff" : "rgba(255,255,255,0.25)")
                    : (text.trim() ? "#fff" : "var(--c-t5)"),
                  fontSize: "16px",
                  flexShrink: 0,
                  transition: "all 0.15s",
                  ...(yolo ? { backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" } : {}),
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 压缩操作按钮（手动压缩/压缩中/已压缩） */}
        {messages && messages.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "6px",
              marginTop: "0",
              minHeight: "0",
            }}
          >
            {/* 手动压缩按钮（开启 + 使用率高 + 消息数足够时显示） */}
            {compressionEnabled && pct > 50 && !isCompressing && messages && messages.length >= MIN_MESSAGES_FOR_COMPRESSION && (
              <button
                onClick={onCompressNow}
                title={`将旧对话压缩为摘要，保留最近 ${8} 轮完整消息以节省 token`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(251,191,36,0.3)",
                  fontSize: "11px",
                  cursor: "pointer",
                  backgroundColor: "rgba(251,191,36,0.1)",
                  color: "#fbbf24",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                <span>📦</span>
                <span>压缩旧对话</span>
              </button>
            )}

            {/* 压缩中动画 */}
            {isCompressing && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(59,130,246,0.15)",
                  color: "#60a5fa",
                  fontSize: "11px",
                }}
              >
                <span className="compression-spinner" style={{ fontSize: "12px" }}>
                  ⟳
                </span>
                <span>压缩中...</span>
                <style>{`
                  @keyframes compressionSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  .compression-spinner {
                    display: inline-block;
                    animation: compressionSpin 1s linear infinite;
                  }
                `}</style>
              </div>
            )}

            {/* 已有摘要标识 */}
            {!isCompressing && hasCompressionSummary(messages) && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "rgba(52,211,153,0.1)",
                  color: "#34d399",
                  fontSize: "11px",
                }}
              >
                <span>📋</span>
                <span>已压缩</span>
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        <p
          style={{
            fontSize: "11px",
            color: yolo ? "rgba(255,255,255,0.15)" : "var(--c-t4)",
            textAlign: "center",
            marginTop: "0",
            marginBottom: "2px",
            userSelect: "none",
            lineHeight: 1.4,
          }}
        >
          {t("aiDisclaimer")}
          <br />
          Unicoda · designed by Momster
        </p>
      </div>
    </div>
  );
}
