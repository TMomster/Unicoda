import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { XMemoryCard, XMemoryBinding, XMemoryStore, XMemoryCardExport, XMemoryGranule } from "../types";

const STORAGE_KEY = "unicoda-xmemory-store-v5";

/** 从 localStorage 读取完整 store，失败时返回默认空 store */
function loadStore(): XMemoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as XMemoryStore;
      if (parsed && parsed.version === 5 && Array.isArray(parsed.cards) && Array.isArray(parsed.bindings)) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return { version: 5, cards: [], bindings: [], releasedIds: [] };
}

/** 持久化 store */
function saveStore(store: XMemoryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* quota exceeded etc */ }
}

/** 生成一个 4 位不重复数字 ID */
function generateId(releasedIds: string[], existingIds: Set<string>): string {
  // 优先从回收池取
  if (releasedIds.length > 0) {
    const id = releasedIds.shift()!;
    existingIds.add(id);
    return id;
  }
  // 随机生成 0000-9999，与桌面端 genCardId 保持一致
  for (let attempt = 0; attempt < 200; attempt++) {
    const id = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!existingIds.has(id)) {
      existingIds.add(id);
      return id;
    }
  }
  // 极端情况：遍历所有可能
  for (let n = 0; n <= 9999; n++) {
    const id = String(n).padStart(4, "0");
    if (!existingIds.has(id)) {
      existingIds.add(id);
      return id;
    }
  }
  throw new Error("无法生成不重复的 4 位数字 ID");
}

/** 计算卡片统计 */
function computeStats(cards: XMemoryCard[]) {
  let enabled = 0, totalGranules = 0, abstractCnt = 0, concreteCnt = 0;
  for (const c of cards) {
    if (c.enabled) enabled++;
    totalGranules += c.granules.length;
    for (const g of c.granules) {
      if (g.type === "abstract") abstractCnt++;
      else concreteCnt++;
    }
  }
  return { total: cards.length, enabled, totalGranules, abstractCnt, concreteCnt };
}

// ── Context ────────────────────────────────────────────────────────

interface XMemoryContextValue {
  cards: XMemoryCard[];
  bindings: XMemoryBinding[];
  loading: boolean;
  stats: ReturnType<typeof computeStats>;
  createCard: (params: { title: string }) => Promise<XMemoryCard>;
  deleteCard: (id: string) => Promise<boolean>;
  renameCard: (id: string, title: string) => Promise<{ ok: boolean; reason?: string }>;
  exportCard: (card: XMemoryCard) => XMemoryCardExport;
  importFromJson: (jsonStr: string) => Promise<XMemoryCard[]>;
  refresh: () => Promise<void>;
}

const XMemoryCtx = createContext<XMemoryContextValue | null>(null);

export function useXMemory(): XMemoryContextValue {
  const ctx = useContext(XMemoryCtx);
  if (!ctx) throw new Error("useXMemory must be used within XMemoryProvider");
  return ctx;
}

export function XMemoryProvider({ children, sessionPath: _sessionPath }: { children: React.ReactNode; sessionPath: string }) {
  const [store, setStore] = useState<XMemoryStore>(loadStore);
  const initialized = useRef(false);

  // 初始化 + 监听其它标签页的存储变更
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setStore(loadStore());
    }
    const handler = () => setStore(loadStore());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const persist = useCallback((s: XMemoryStore) => {
    saveStore(s);
    setStore(s);
  }, []);

  const refresh = useCallback(async () => {
    setStore(loadStore());
  }, []);

  const createCard = useCallback(async ({ title }: { title: string }): Promise<XMemoryCard> => {
    const existing = new Set<string>();
    for (const c of store.cards) existing.add(c.id);
    const released = [...store.releasedIds];
    const id = generateId(released, existing);
    const now = Date.now();
    // 生成一个不会和卡片 ID 冲突的默认颗粒 ID
    const cardIdSet = new Set(store.cards.map((c) => c.id));
    const releasedCopy = [...store.releasedIds];
    const defaultGranuleId = generateId(releasedCopy, cardIdSet);
    const card: XMemoryCard = {
      id,
      title: title.trim() || `记忆卡 #${id}`,
      description: "",
      createdAt: now,
      updatedAt: now,
      enabled: true,
      granules: [{
        id: defaultGranuleId,
        type: "abstract",
        title: "默认系统标记",
        content: "这是一张新创建的记忆卡。尚无角色设定信息——请在首次对话中由角色模型提取并创建记忆颗粒。",
        importance: "high",
        createdAt: now,
        updatedAt: now,
      }],
      releasedGranuleIds: [],
    };
    const newStore: XMemoryStore = {
      ...store,
      cards: [...store.cards, card],
      releasedIds: released,
    };
    persist(newStore);
    return card;
  }, [store, persist]);

  const deleteCard = useCallback(async (id: string): Promise<boolean> => {
    const idx = store.cards.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    const card = store.cards[idx];
    const newCards = store.cards.filter((c) => c.id !== id);
    const newBindings = store.bindings.filter((b) => b.cardId !== id);
    const newReleased = [...store.releasedIds, card.id, ...(card.releasedGranuleIds || [])];
    const newStore: XMemoryStore = { ...store, cards: newCards, bindings: newBindings, releasedIds: newReleased };
    persist(newStore);
    return true;
  }, [store, persist]);

  const renameCard = useCallback(async (id: string, title: string): Promise<{ ok: boolean; reason?: string }> => {
    const idx = store.cards.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, reason: "卡片不存在" };
    const newCards = store.cards.map((c) =>
      c.id === id ? { ...c, title: title.trim() || c.title, updatedAt: Date.now() } : c
    );
    persist({ ...store, cards: newCards });
    return { ok: true };
  }, [store, persist]);

  const exportCardFn = useCallback((card: XMemoryCard): XMemoryCardExport => {
    return {
      title: card.title,
      description: card.description,
      granules: card.granules.map((g) => ({
        title: g.title,
        type: g.type,
        importance: g.importance,
        content: g.content,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      })),
      exportedAt: Date.now(),
      version: 5,
    };
  }, []);

  const importFromJson = useCallback(async (jsonStr: string): Promise<XMemoryCard[]> => {
    let data: XMemoryCardExport | XMemoryCardExport[];
    try {
      data = JSON.parse(jsonStr);
    } catch {
      throw new Error("JSON 解析失败");
    }
    const arr = Array.isArray(data) ? data : [data];
    const existing = new Set(store.cards.map((c) => c.id));
    const released = [...store.releasedIds];
    const imported: XMemoryCard[] = [];
    for (const item of arr) {
      if (!item || !item.title) continue;
      const now = Date.now();
      const id = generateId(released, existing);
      const card: XMemoryCard = {
        id,
        title: item.title,
        description: item.description || "",
        createdAt: now,
        updatedAt: now,
        enabled: true,
        granules: (item.granules || []).map((g: XMemoryCardExport["granules"][number]) => {
          const gid = generateId(released, existing);
          return {
            id: gid,
            title: g.title || "未命名颗粒",
            type: (g.type === "abstract" || g.type === "concrete") ? g.type : "abstract",
            importance: (g.importance === "high" || g.importance === "medium" || g.importance === "low") ? g.importance : "medium",
            content: g.content || "",
            createdAt: g.createdAt || now,
            updatedAt: g.updatedAt || now,
          } as XMemoryGranule;
        }),
        releasedGranuleIds: [],
      };
      imported.push(card);
    }
    const newStore: XMemoryStore = {
      ...store,
      cards: [...store.cards, ...imported],
      releasedIds: released,
    };
    persist(newStore);
    return imported;
  }, [store, persist]);

  const value: XMemoryContextValue = {
    cards: store.cards,
    bindings: store.bindings,
    loading: false,
    stats: computeStats(store.cards),
    createCard,
    deleteCard,
    renameCard,
    exportCard: exportCardFn,
    importFromJson,
    refresh,
  };

  return <XMemoryCtx.Provider value={value}>{children}</XMemoryCtx.Provider>;
}
