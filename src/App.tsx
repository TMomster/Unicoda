import { useState, useCallback, useRef, useEffect } from "react";
import type { Conversation, FileAttachment, Message, Mode, PanelMode, ModelConfig } from "./types";
import { useTheme, scaleToTransform } from "./contexts/ThemeContext";
import { useModels } from "./contexts/ModelContext";
import { ModelProvider } from "./contexts/ModelContext";
import { LockProvider } from "./contexts/LockContext";
import { SearchProvider } from "./contexts/SearchContext";
import { useSecurity } from "./contexts/SecurityContext";
import { useChatStream, setNextMsgId, type ChatStreamReturn } from "./hooks/useChatStream";
import { readConfigFile, writeConfigFile } from "./utils/configStorage";
import { initBuiltinModules } from "./modules/registry";
import "./modules/moduleImports";
import { updateUnicodaStatus } from "./modules/builtins/getUnicodaStatus";
import {
  APP_VERSION,
  VERSION_STORAGE_KEY,
  compareVersions,
  UPDATE_CHANGELOG,
  type VersionRecord,
} from "./version";
import {
  loadMetadata,
  loadLiteralMessages,
  loadMemoryMessages,
  flushConversationData,
  toMeta,
  migrateFromOldFormat,
  deleteConversationFiles,
} from "./services/conversationStorage";
import type { ConversationMeta } from "./services/conversationStorage";
import { useLock } from "./contexts/LockContext";
import LockOverlay from "./components/LockOverlay";
import Sidebar from "./components/Sidebar";
import ChatPanel from "./components/ChatPanel";
import InputBar from "./components/InputBar";
import TitleBar from "./components/TitleBar";
import SettingsPanel from "./components/SettingsPanel";
import ComponentsPanel from "./components/ComponentsPanel";
import YoloPanel from "./components/YoloPanel";
import PrintDialog from "./components/PrintDialog";
import FilePreviewPanel from "./components/FilePreviewPanel";

let nextConvId = 1;
let nextMsgId = 1;

const MIN_SIDEBAR = 200;

function makeConvTitle(existing: Conversation[], locale: string): string {
  const prefix = locale === "zh-CN" ? "新会话" : locale === "de-DE" ? "Neue Sitzung" : "New Session";
  const pattern = locale === "zh-CN" ? /^新会话-(\d+)$/ : locale === "de-DE" ? /^Neue Sitzung-(\d+)$/ : /^New Session-(\d+)$/;
  const nums = new Set<number>();
  for (const c of existing) {
    const m = c.title.match(pattern);
    if (m) nums.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}-${n}`;
}

// ─── Inner component that has access to ModelProvider context ──────
function MainContent({ panelMode, setPanelMode }: { panelMode: PanelMode; setPanelMode: React.Dispatch<React.SetStateAction<PanelMode>> }) {
  const { scale, fontFamily, t, locale, preferredLanguage, userName, userAvatar, sessionPath, defaultMarkdown, defaultReasoningOpen, developerMode, theme } = useTheme();
  const { securityEnabled } = useSecurity();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    // 快速初始加载：优先用 localStorage 缓存的元数据
    try {
      const raw = localStorage.getItem("unicoda-conversations-meta");
      if (raw) {
        const metas: ConversationMeta[] = JSON.parse(raw);
        if (metas.length > 0) {
          const loaded: Conversation[] = metas.map((m) => ({
            ...m,
            messages: [],
            memoryMessages: [],
          }));
          for (const c of loaded) {
            const idNum = parseInt(c.id, 10);
            if (idNum >= nextConvId) nextConvId = idNum + 1;
          }
          return loaded;
        }
      }
    } catch { /* ignore */ }
    return [
      {
        id: String(nextConvId++),
        title: makeConvTitle([], locale),
        messages: [],
        memoryMessages: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  });

  const [activeId, setActiveId] = useState<string>("");

  // ── 版本检查对话框 ──
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);

  // 异步初始化：迁移旧格式 + 从文件加载消息体
  const initialLoadDone = useRef(false);
  const loadedConvIds = useRef(new Set<string>());
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    (async () => {
      // 1. 尝试迁移旧格式
      await migrateFromOldFormat("unicoda-conversations", "normal", sessionPath);

      // 2. 加载元数据（覆盖 localStorage 缓存）
      const freshMetas = await loadMetadata("normal", sessionPath);
      if (freshMetas.length > 0) {
        const loaded: Conversation[] = freshMetas.map((m) => ({
          ...m,
          messages: [],
          memoryMessages: [],
        }));
        for (const c of loaded) {
          const idNum = parseInt(c.id, 10);
          if (idNum >= nextConvId) nextConvId = idNum + 1;
        }
        setConversations(loaded);
        // 更新 localStorage 缓存
        try {
          localStorage.setItem("unicoda-conversations-meta", JSON.stringify(freshMetas));
        } catch { /* ignore */ }
        return; // 等待 activeConv 加载
      }
    })();
  }, [sessionPath]);

  // 3. 当前活跃会话的消息体按需加载（每个会话只加载一次）
  useEffect(() => {
    if (!activeId || loadedConvIds.current.has(activeId)) return;
    // 标记该会话已加载避免重入
    const id = activeId;
    loadedConvIds.current.add(activeId);
    (async () => {
      const literalMsgs = await loadLiteralMessages(id, "normal", sessionPath);
      const memoryMsgs = await loadMemoryMessages(id, "normal", sessionPath);
      if (literalMsgs || memoryMsgs) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: literalMsgs ?? c.messages,
                  memoryMessages: memoryMsgs ?? literalMsgs ?? c.messages,
                }
              : c,
          ),
        );
        // 初始化 nextMsgId，避免新消息 ID 与已加载消息冲突
        const msgsToScan = literalMsgs ?? [];
        const memMsgsToScan = memoryMsgs ?? [];
        const allIds = [...msgsToScan, ...memMsgsToScan].map(m => parseInt(m.id, 10));
        const maxId = allIds.length > 0 ? Math.max(...allIds) : 0;
        setNextMsgId(maxId);
      }
    })();
  }, [sessionPath, activeId]);

  // Refs 持有最新值，避免 debounce 和闭包捕获过期值
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sessionPathRef = useRef(sessionPath);
  sessionPathRef.current = sessionPath;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const sidebarWidthRef = useRef(280);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<"blur" | "fade" | "reveal">("blur");
  const [yoloEntryKey, setYoloEntryKey] = useState(0);

  // ref holds chatStream before its hook call, preventing TDZ in handleSelect
  const chatStreamRef = useRef<ChatStreamReturn>(null!);

  const handleTogglePanel = useCallback(() => {
    if (isTransitioning) return;
    const target = panelMode === "Default" ? "Yolo" : "Default";

    // Phase 1: blur covers the screen (300ms CSS transition)
    setIsTransitioning(true);
    setTransitionPhase("blur");

    // Phase 2: old UI fades out behind blur (350ms)
    setTimeout(() => { setTransitionPhase("fade"); }, 350);

    // Phase 3: swap panel + new UI fades in + blur fades out
    setTimeout(() => {
      setPanelMode(target);
      setTransitionPhase("reveal");
      if (target === "Yolo") setYoloEntryKey((k) => k + 1);
    }, 700);

    // Phase 4: transition complete
    setTimeout(() => { setIsTransitioning(false); }, 1100);
  }, [isTransitioning, panelMode]);

  // ── Model ───────────────────────────────────────────────────────
  const { models, selectedModelId } = useModels();
  const selectedModel = models.find((m) => m.id === selectedModelId);

  // Helper to update conversation messages
  const updateConv = useCallback(
    (id: string, updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? updater(c) : c)),
      );
    },
    [],
  );

  const handleCreate = useCallback(() => {
    const newId = String(nextConvId++);
    const pathRef = sessionPathRef.current;
    setConversations((prev) => {
      const conv: Conversation = {
        id: newId,
        title: makeConvTitle(prev, locale),
        messages: [],
        memoryMessages: [],
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = [...prev, conv];
      flushConversations(updated, pathRef);
      return updated;
    });
    setActiveId(newId);
  }, [locale]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    chatStreamRef.current.resetPermissionRefs();
  }, []);

  const handleRename = useCallback(
    (id: string, title: string) => {
      updateConv(id, (c) => ({ ...c, title, updatedAt: Date.now() }));
    },
    [updateConv],
  );

  const handleTogglePin = useCallback(
    (id: string) => {
      updateConv(id, (c) => ({
        ...c,
        pinned: !c.pinned,
        updatedAt: Date.now(),
      }));
    },
    [updateConv],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (sessionPath) {
        deleteConversationFiles(id, "normal", sessionPath).catch(() => {});
      }
      const next = conversations.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(conversations, locale),
          messages: [],
          memoryMessages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPath);
        setConversations(() => [fresh]);
      } else {
        flushConversations(next, sessionPath);
        setConversations(() => next);
      }
      if (activeId === id) {
        setActiveId("");
      }
    },
    [activeId, conversations, locale, sessionPath],
  );

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => {
        if (sessionPath) {
          deleteConversationFiles(id, "normal", sessionPath).catch(() => {});
        }
      });
      const idSet = new Set(ids);
      const next = conversations.filter((c) => !idSet.has(c.id));
      if (next.length === 0) {
        const fresh: Conversation = {
          id: String(nextConvId++),
          title: makeConvTitle(conversations, locale),
          messages: [],
          memoryMessages: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        flushConversations([fresh], sessionPath);
        setConversations(() => [fresh]);
      } else {
        flushConversations(next, sessionPath);
        setConversations(() => next);
      }
      if (ids.includes(activeId)) {
        setActiveId("");
      }
    },
    [activeId, conversations, locale, sessionPath],
  );

  const handleBatchTogglePin = useCallback(
    (ids: string[], pin: boolean) => {
      const idSet = new Set(ids);
      const next = conversations.map((c) =>
        idSet.has(c.id) ? { ...c, pinned: pin, updatedAt: Date.now() } : c,
      );
      flushConversations(next, sessionPath);
      setConversations(() => next);
    },
    [conversations, sessionPath],
  );

  // ── Module system integration ──────────────────────────────
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const [mode, setMode] = useState<Mode>("Chat");

  // 同步工作状态到 getUnicodaStatus 模组
  useEffect(() => {
    updateUnicodaStatus({ panelMode, mode });
  }, [panelMode, mode]);

  // ── Drag-and-drop 已移至 useChatStream hook ───────

  // ── Toast notifications ─────────────────────────────
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, key: Date.now() });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  const { isLocked } = useLock();
  useEffect(() => {
    initBuiltinModules();
    // 版本检查
    performVersionCheck();
  }, []);

  // ── 版本检查逻辑 ─────────────────────────────────
  const performVersionCheck = useCallback(async () => {
    try {
      const record: VersionRecord | null = await readConfigFile<VersionRecord | null>(
        VERSION_STORAGE_KEY,
        null,
      );
      if (!record) {
        // 首次运行：记录当前版本，不弹窗
        await writeConfigFile(VERSION_STORAGE_KEY, {
          version: APP_VERSION,
          downgradeDismissed: false,
        } satisfies VersionRecord);
        return;
      }
      const cmp = compareVersions(APP_VERSION, record.version);
      if (cmp === 0) {
        // 版本一致：无需处理
        return;
      }
      if (cmp === 1) {
        // 当前版本更高 → 升级，存储新版本号并显示更新公告
        await writeConfigFile(VERSION_STORAGE_KEY, {
          version: APP_VERSION,
          downgradeDismissed: false,
        } satisfies VersionRecord);
        setShowUpdateDialog(true);
        return;
      }
      // cmp === -1 → 当前版本低于已记录的版本
      if (record.downgradeDismissed) {
        // 用户已勾选"不再提醒"
        return;
      }
      setShowDowngradeDialog(true);
    } catch {
      // 静默忽略
    }
  }, []);

  /**
   * 消息更新辅助：同时对 messages（字面量）和 memoryMessages（记忆量）应用相同的变换。
   * 在流式生成过程中，两个数组应保持同步；压缩时只修改 memoryMessages。
   */
  const withMsgUpdate = useCallback(
    (conv: Conversation, msgMapper: (msgs: Message[]) => Message[]): Conversation => ({
      ...conv,
      messages: msgMapper(conv.messages),
      memoryMessages: msgMapper(conv.memoryMessages ?? conv.messages),
      updatedAt: Date.now(),
    }),
    [],
  );

  /** 防抖落盘：同时保存元数据和当前活跃会话的消息体 */
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushConversations = useCallback(
    (convs: Conversation[], path: string) => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(async () => {
        flushTimerRef.current = null;
        // 从 ref 读取最新 activeId，避免 debounce 闭包捕获过期值
        const latestActiveId = activeIdRef.current;
        const activeConv = convs.find((c) => c.id === latestActiveId) ?? null;
        const metas = convs.map(toMeta);
        await flushConversationData(activeConv, metas, "normal", path);
        try {
          localStorage.setItem("unicoda-conversations-meta", JSON.stringify(metas));
        } catch { /* ignore */ }
      }, 100);
    },
    [], // 无依赖：所有需要的最新值通过 ref 读取
  );

  // ── Security 审批流程（由 UnicodaSecurity 全权负责） ──
  const securityMonitoring = securityEnabled;

  // ── Chat stream hook ───────────────────────────────────────
  const chatStream = useChatStream({
    updateConv,
    conversations,
    conversationsRef,
    setConversations,
    selectedModel,
    mode,
    preferredLanguage,
    developerMode,
    panelMode,
    workspacePath: undefined,
    workMode: "normal",
    sessionPath: sessionPathRef.current,
    locale,
    flushConvs: flushConversations,
    withMsgUpdate,
    securityMonitoring,
  });
  chatStreamRef.current = chatStream;

  const handleSendWrapper = useCallback(
    (text: string, sendMode?: Mode, files?: FileAttachment[]) => {
      chatStream.handleSend(text, activeId, sendMode, files);
    },
    [chatStream.handleSend, activeId],
  );

  const handleCompressNowWrapper = useCallback(() => {
    chatStream.handleCompressNow(activeId);
  }, [chatStream.handleCompressNow, activeId]);

  /** 用户对模型回复评价（点赞/点踩，null 取消评价） */
  const handleRateMessage = useCallback(
    (messageId: string, rating: "up" | "down" | null) => {
      if (!activeId) return;
      const pathRef = sessionPathRef.current;
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === activeId);
        if (!conv) return prev;

        const msgs = conv.messages;
        const idx = msgs.findIndex((m) => m.id === messageId);
        if (idx === -1) return prev;

        const nextMsg = msgs[idx + 1];
        let updatedConv: Conversation;

        if (rating === null) {
          // 取消评价：清除 userRating，移除后面的评价消息
          const updatedMsg = { ...msgs[idx], userRating: undefined };
          if (nextMsg?.isRatingEval) {
            updatedConv = withMsgUpdate(conv, (all) => {
              const copy = [...all];
              copy[idx] = updatedMsg;
              copy.splice(idx + 1, 1);
              return copy;
            });
          } else {
            updatedConv = withMsgUpdate(conv, (all) => {
              const copy = [...all];
              copy[idx] = updatedMsg;
              return copy;
            });
          }
        } else {
          // 设置评价
          const updatedMsg = { ...msgs[idx], userRating: rating };
          const evalContent = rating === "up"
            ? "【用户评价反馈】用户对上一条回复的评价为：满意。这是系统记录的客观反馈，模型应将其作为调整回复风格的重要依据。"
            : "【用户评价反馈】用户对上一条回复的评价为：不满意。这是系统记录的客观反馈，模型应将其作为调整回复风格的重要依据。";

          if (nextMsg?.isRatingEval) {
            // 已有评价消息 → 更新内容
            const updatedEval = { ...nextMsg, content: evalContent };
            updatedConv = withMsgUpdate(conv, (all) =>
              all.map((m, i) => (i === idx ? updatedMsg : i === idx + 1 ? updatedEval : m)),
            );
          } else {
            // 没有评价消息 → 插入新消息
            const evalMsg: Message = {
              id: `eval-${messageId}-${rating}-${Date.now()}`,
              role: "system",
              sender: "framework",
              content: evalContent,
              timestamp: Date.now(),
              isRatingEval: true,
            };
            updatedConv = withMsgUpdate(conv, (all) => {
              const copy = [...all];
              copy[idx] = updatedMsg;
              copy.splice(idx + 1, 0, evalMsg);
              return copy;
            });
          }
        }

        const updated = prev.map((c) => (c.id === activeId ? updatedConv : c));
        flushConversations(updated, pathRef);
        return updated;
      });
    },
    [activeId, withMsgUpdate, flushConversations],
  );

  /** 撤回本轮消息：从该轮用户消息开始到末尾全部清除 */
  const handleRecallMessage = useCallback(
    (messageId: string) => {
      if (!activeId) return;
      const pathRef = sessionPathRef.current;
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === activeId);
        if (!conv) return prev;
        const msgs = conv.messages;
        const recallIdx = msgs.findIndex((m) => m.id === messageId);
        if (recallIdx === -1) return prev;
        // 向前找本轮用户消息起点
        let removeStartIdx = -1;
        for (let i = recallIdx; i >= 0; i--) {
          if (msgs[i].role === "user") {
            removeStartIdx = i;
            break;
          }
        }
        if (removeStartIdx === -1) return prev;
        // 从用户消息截断到末尾
        const updatedConv = withMsgUpdate(conv, (all) => all.slice(0, removeStartIdx));
        const updated = prev.map((c) => (c.id === activeId ? updatedConv : c));
        flushConversations(updated, pathRef);
        return updated;
      });
    },
    [activeId, withMsgUpdate, flushConversations],
  );

  // Clamp sidebar on window resize
  useEffect(() => {
    const clamp = () => {
      const max = Math.floor(window.innerWidth / 2);
      setSidebarWidth((w) => Math.max(MIN_SIDEBAR, Math.min(w, max)));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const handleResizeSidebar = useCallback((w: number) => {
    const max = Math.floor(window.innerWidth / 2);
    const clamped = Math.max(MIN_SIDEBAR, Math.min(w, max));
    sidebarWidthRef.current = clamped;
    setSidebarWidth(clamped);
  }, []);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  const handlePrint = useCallback(() => {
    if (!activeConv) {
      showToast("请先开始一个会话");
      return;
    }
    setPrintOpen(true);
  }, [activeConv, showToast]);

  // ── Ctrl+P Print Dialog (with context guards + toast) ──
  const printGuardRef = useRef({ isLocked: false, panelMode: "Default" as PanelMode, settingsOpen: false, componentsOpen: false, hasActiveConv: false });
  printGuardRef.current = { isLocked, panelMode, settingsOpen, componentsOpen, hasActiveConv: activeConv !== null };
  const handleCreateRef = useRef(handleCreate);
  handleCreateRef.current = handleCreate;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        handleCreateRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        const g = printGuardRef.current;
        if (g.isLocked) {
          showToast("Unicoda 已锁定，请先解锁");
        } else if (g.settingsOpen) {
          showToast("设置界面不支持打印");
        } else if (g.componentsOpen) {
          showToast("组件管理界面不支持打印");
        } else if (!g.hasActiveConv) {
          showToast("请先开始一个会话");
        } else {
          setPrintOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showToast]);

  // ── 全局拦截浏览器默认按键/右键（捕获阶段） ──
  useEffect(() => {
    // 浏览器快捷键黑名单（Ctrl+key / Cmd+key）
    const blockedCtrl: string[] = ["t", "w", "n", "r", "s", "u", "h", "j", "d", "o", "k", "F5", "F11"];
    // Ctrl+Shift 组合黑名单
    const blockedShiftCtrl: string[] = ["i", "j", "c", "n"];
    // F1-F12 全部拦截（开发工具、帮助等）
    const blockedFKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const handleKeyDown = (e: KeyboardEvent) => {
      // 拦截 F-键
      const fNum = parseInt(e.key.slice(1), 10);
      if (e.key.startsWith("F") && !isNaN(fNum) && blockedFKeys.includes(fNum)) {
        e.preventDefault();
        return;
      }
      // 拦截 Ctrl/Meta 浏览器快捷键
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (blockedCtrl.includes(key)) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && blockedShiftCtrl.includes(key)) {
          e.preventDefault();
          return;
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // 阻止浏览器右键菜单
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("contextmenu", handleContextMenu, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
    };
  }, []);

  const transformScale = scaleToTransform(scale);

  // ── Blur transition derived values ─────────────
  const defaultOpacity = !isTransitioning
    ? (panelMode === "Default" ? 1 : 0)
    : (panelMode === "Default" && transitionPhase !== "fade" ? 1 : 0);
  const yoloOpacity = !isTransitioning
    ? (panelMode === "Yolo" ? 1 : 0)
    : (panelMode === "Yolo" && transitionPhase !== "fade" ? 1 : 0);
  const blurOpacity = isTransitioning && transitionPhase !== "reveal" ? 1 : 0;

  // Inject comprehensive CSS color tokens (dark = default, light overrides via [data-theme="light"])
  const themeStyleTag = (
    <style>{`
      [data-theme] {
        --c-bg: #0f0f11;   --c-bg2: #1a1a1e;   --c-bg3: #1e1e22;
        --c-txt: #e0e0e0;  --c-t2: #a0a0a0;     --c-t3: #7a7a7e;
        --c-t4: #5a5a5e;   --c-t5: #6a6a6e;     --c-t6: #8a8a8e;
        --c-bd: #2a2a2e;   --c-bd2: #3a3a3e;
        --c-ac: #2563eb;   --c-ah: #1d4ed8;     --c-bf: #2563eb;
      }
      [data-theme="light"] {
        --c-bg: #f2f2f5;   --c-bg2: #ffffff;    --c-bg3: #e8e8ec;
        --c-txt: #1a1a1e;  --c-t2: #5a5a5e;     --c-t3: #8a8a8e;
        --c-t4: #9a9a9e;   --c-t5: #7a7a7e;     --c-t6: #a0a0a0;
        --c-bd: #d4d4d8;   --c-bd2: #c8c8cc;
        --c-ac: #2563eb;   --c-ah: #1d4ed8;     --c-bf: #2563eb;
      }
    `}</style>
  );

  // Inject entrance keyframes for YoloPanel staggered animation
  const entranceStyleTag = (
    <style>{`
      @keyframes yolo-entrance-card {
        0%   { opacity: 0; transform: translateY(12px) scale(0.96); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes yolo-entrance-header {
        0%   { opacity: 0; transform: translateY(-8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes yolo-entrance-content {
        0%   { opacity: 0; transform: translateY(8px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes yolo-entrance-input {
        0%   { opacity: 0; transform: translateY(10px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );

  return (
    <div
      data-theme={panelMode === "Yolo" ? "dark" : theme}
      style={{
        width: `${100 / transformScale}vw`,
        height: `${100 / transformScale}vh`,
        transform: `scale(${transformScale})`,
        transformOrigin: "top left",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--c-bg)",
        color: "var(--c-txt)",
        fontFamily,
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {themeStyleTag}
      {entranceStyleTag}
      {/* ── Default UI (opacity controlled for transitions) ── */}
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        opacity: defaultOpacity,
        transition: "opacity 0.4s ease",
        pointerEvents: defaultOpacity > 0.5 ? "auto" : "none",
      }}>
        {/* Custom Title Bar */}
        <TitleBar title={activeConv?.title ?? "Unicoda"} />

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* Sidebar */}
          <Sidebar
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            conversations={conversations}
            activeId={activeId}
            onCreate={handleCreate}
            onSelect={handleSelect}
            onRename={handleRename}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            onBatchDelete={handleBatchDelete}
            onBatchTogglePin={handleBatchTogglePin}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onResize={handleResizeSidebar}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenComponents={() => setComponentsOpen(true)}
            onTogglePanel={handleTogglePanel}
            onPrint={handlePrint}
          />

          {/* Main Area */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div
              key={activeConv ? `chat-${activeId}` : "empty"}
              className="view-transition"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {/* Messages */}
              {activeConv ? (
                <ChatPanel messages={activeConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar} defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode} t={t} onPreviewFile={setPreviewFile} onRate={handleRateMessage} onRecall={handleRecallMessage} isStreaming={chatStream.isStreaming} />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--c-t5)",
                    fontSize: "14px",
                  }}
                >
                  {t("selectOrCreate")}
                </div>
              )}

              {/* Input */}
              {activeConv && (
                <InputBar
                  key={activeId}
                  onSend={handleSendWrapper}
                  onStop={chatStream.handleStop}
                  disabled={chatStream.isStreaming}
                  messages={activeConv.messages}
                  memoryMessages={activeConv.memoryMessages ?? activeConv.messages}
                  maxTokens={selectedModel?.params?.maxTokens}
                  compressionEnabled={chatStream.compressionEnabled}
                  onToggleCompression={chatStream.handleToggleCompression}
                  onCompressNow={handleCompressNowWrapper}
                  isCompressing={chatStream.isCompressing}
                  mode={mode}
                  onModeChange={setMode}
                  preferredLanguage={preferredLanguage}
                  pendingFiles={chatStream.pendingFiles}
                  onRemovePendingFile={chatStream.handleRemovePendingFile}
                  onClearPendingFiles={chatStream.clearPendingFiles}
                  dragOver={chatStream.dragOver}
                />
              )}
            </div>
          </div>

          {settingsOpen && <SettingsPanel onBack={() => setSettingsOpen(false)} />}

          {/* ── Components Overlay ── */}
          {componentsOpen && (
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
              <ComponentsPanel onBack={() => setComponentsOpen(false)} />
            </div>
          )}

          {/* ── Print Dialog Overlay ── */}
          {printOpen && activeConv && (
            <PrintDialog
              messages={activeConv.messages}
              modelName={selectedModel?.name}
              userName={userName}
              t={t}
              onClose={() => setPrintOpen(false)}
            />
          )}

          {/* ── File Preview Panel ── */}
          <FilePreviewPanel file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
      </div>

      {/* ── Yolo Panel (always mounted, opacity controlled) ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1000,
        opacity: yoloOpacity,
        transition: "opacity 0.4s ease 0.05s",
        pointerEvents: yoloOpacity > 0.5 ? "auto" : "none",
      }}>
        <YoloPanel key={panelMode === "Yolo" ? yoloEntryKey : 0} onBack={() => setPanelMode("Default")} />
      </div>

      {/* ── Blur transition overlay ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 999,
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        backgroundColor: "rgba(8, 8, 12, 0.75)",
        opacity: blurOpacity,
        transition: "opacity 0.3s ease",
        pointerEvents: "none",
      }} />

      {/* ── Toast notification ── */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      {toast && (
        <div key={toast.key} style={{
          position: "fixed", bottom: "80px", left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100000,
          backgroundColor: "var(--c-bg2)",
          border: "1px solid var(--c-bd)",
          color: "var(--c-txt)",
          padding: "10px 22px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 500,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          animation: "toast-in 0.2s ease",
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}>
          {toast.message}
        </div>
      )}

      {/* ── Lock overlay (inside data-theme root so --c-bg resolves) ── */}
      <LockOverlay locale={locale} yolo={panelMode === "Yolo"} />

      {/* ── 版本升级公告 ── */}
      {showUpdateDialog && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999998,
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        }} onClick={() => setShowUpdateDialog(false)}>
          <div style={{
            backgroundColor: "var(--c-bg2)", border: "1px solid var(--c-bd)",
            borderRadius: "12px", padding: "28px 32px", maxWidth: "460px",
            width: "90%", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
            userSelect: "text",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--c-txt)", marginBottom: "12px", lineHeight: 1.6 }}>
              🎉 Unicoda 已更新至 {APP_VERSION}
            </div>
            <div style={{ fontSize: "13px", color: "var(--c-t3)", lineHeight: 1.8, whiteSpace: "pre-wrap", marginBottom: "20px" }}>
              {UPDATE_CHANGELOG}
            </div>
            <button onClick={() => setShowUpdateDialog(false)}
              style={{
                width: "100%", padding: "10px 0", borderRadius: "8px",
                border: "1px solid var(--c-bd)", background: "var(--c-bg)",
                color: "var(--c-txt)", fontSize: "13px", fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-t3)"; e.currentTarget.style.background = "var(--c-bg3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-bd)"; e.currentTarget.style.background = "var(--c-bg)"; }}>
              {t("close")}
            </button>
          </div>
        </div>
      )}

      {/* ── 版本降级警告 ── */}
      {showDowngradeDialog && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999998,
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        }} onClick={() => setShowDowngradeDialog(false)}>
          <div style={{
            backgroundColor: "var(--c-bg2)", border: "1px solid var(--c-bd)",
            borderRadius: "12px", padding: "28px 32px", maxWidth: "420px",
            width: "90%", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
            userSelect: "text",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#e8a838", marginBottom: "12px", lineHeight: 1.6 }}>
              ⚠️ 版本回退检测
            </div>
            <div style={{ fontSize: "13px", color: "var(--c-t3)", lineHeight: 1.8, marginBottom: "24px" }}>
              您当前运行的 Unicoda 版本（{APP_VERSION}）低于上次安装的版本。这可能是因为您安装了旧版本。为确保最佳体验，建议升级到最新版本。
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={async () => {
                setShowDowngradeDialog(false);
                // 标记"不再提醒"
                try {
                  await writeConfigFile(VERSION_STORAGE_KEY, {
                    version: APP_VERSION,
                    downgradeDismissed: true,
                  } satisfies VersionRecord);
                } catch { /* ignore */ }
              }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: "8px",
                  border: "1px solid var(--c-bd)", background: "var(--c-bg)",
                  color: "var(--c-txt)", fontSize: "13px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-t3)"; e.currentTarget.style.background = "var(--c-bg3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-bd)"; e.currentTarget.style.background = "var(--c-bg)"; }}>
                不再提醒
              </button>
              <button onClick={() => setShowDowngradeDialog(false)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: "8px",
                  border: "1px solid var(--c-bd)", background: "var(--c-bg)",
                  color: "var(--c-txt)", fontSize: "13px", fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", lineHeight: 1.6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-t3)"; e.currentTarget.style.background = "var(--c-bg3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-bd)"; e.currentTarget.style.background = "var(--c-bg)"; }}>
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Alpha 版本标记（必须内嵌以访问 useTheme） ──
function VersionBadge() {
  const { t } = useTheme();
  return (
    <span
      style={{
        position: "fixed",
        bottom: "10px",
        right: "14px",
        fontSize: "11px",
        color: "#fff",
        mixBlendMode: "difference",
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
        zIndex: 99999,
      }}
    >
      {t("alphaTestBadge")}
    </span>
  );
}

// ─── Root component — providers wrap the inner content ────────────
export default function App() {
  const [panelMode, setPanelMode] = useState<PanelMode>("Default");
  return (
    <LockProvider>
    <ModelProvider>
    <SearchProvider>
      <MainContent panelMode={panelMode} setPanelMode={setPanelMode} />
      <VersionBadge />
    </SearchProvider>
    </ModelProvider>
    </LockProvider>
  );
}
