import { registerModule } from "../registry";
import type { XMemoryStore, XMemoryGranule, XMemoryCard } from "../../types";

const STORAGE_KEY_XM = "unicoda-xmemory-store-v5";

function loadStore(): XMemoryStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_XM);
    if (raw) {
      const parsed = JSON.parse(raw) as XMemoryStore;
      if (parsed && parsed.version && Array.isArray(parsed.cards)) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveStore(store: XMemoryStore): void {
  try { localStorage.setItem(STORAGE_KEY_XM, JSON.stringify(store)); } catch { /* quota */ }
}

/** 在卡片内生成不重复的 4 位颗粒 ID */
function genGranuleId(card: XMemoryCard): string {
  const used = new Set(card.granules.map(g => g.id));
  const released = new Set(card.releasedGranuleIds || []);
  // 优先从回收池取
  for (const rid of released) {
    if (!used.has(rid)) return rid;
  }
  for (let n = 1000; n <= 9999; n++) {
    const id = String(n);
    if (!used.has(id)) return id;
  }
  return String(Date.now()).slice(-4);
}

// ── xmemory_list_granules ──
registerModule({
  id: "xmemory_list_granules",
  name: "列出记忆颗粒",
  description: `列出指定记忆卡中所有的记忆颗粒，包括编号、标题、类型（抽象/具象）、重要级别、创建时间和内容摘要。你需要同时提供 card_id 参数。`,
  level: "normal",
  scope: "yolo",
  parameters: [
    { name: "card_id", type: "string", required: true, description: "目标记忆卡的 4 位编号" },
  ],
  execute: async function* (params) {
    const store = loadStore();
    if (!store) { yield "❌ 无法读取 XMemory 存储"; return; }
    const card = store.cards.find(c => c.id === params.card_id);
    if (!card) { yield `❌ 未找到编号为 ${params.card_id} 的记忆卡`; return; }
    if (card.granules.length === 0) { yield `📭 记忆卡 [${card.id}] ${card.title} 中暂无记忆颗粒。`; return; }
    const lines: string[] = [`📋 记忆卡 [${card.id}] ${card.title} 的颗粒列表：`];
    const typeLabel = (t: string) => t === "abstract" ? "🔮抽象" : "👁️具象";
    for (const g of card.granules) {
      const impIcon = g.importance === "high" ? "🔴" : g.importance === "medium" ? "🟡" : "⚪";
      const preview = g.content.length > 60 ? g.content.slice(0, 60) + "…" : g.content;
      lines.push(`  ${impIcon} [${g.id}] ${typeLabel(g.type)} | ${g.title} — ${preview}`);
    }
    const absCnt = card.granules.filter(g => g.type === "abstract").length;
    const concCnt = card.granules.length - absCnt;
    lines.push(`共 ${card.granules.length} 个颗粒（🔮抽象×${absCnt} 👁️具象×${concCnt}）。`);
    yield lines.join("\n");
  },
});

// ── xmemory_create_granule ──
registerModule({
  id: "xmemory_create_granule",
  name: "创建记忆颗粒",
  description: `在指定的记忆卡中创建一个新的记忆颗粒。参数：card_id（目标卡编号）、title（颗粒标题）、granule_type（类型：abstract=抽象感知/长期记忆，concrete=具象感知/环境记忆）、importance（重要级别：high/medium/low）、content（颗粒内容，结构化 Markdown）。注意：具象感知颗粒应随环境变化及时更新替换，抽象感知颗粒保持长期稳定。`,
  level: "normal",
  scope: "yolo",
  parameters: [
    { name: "card_id", type: "string", required: true, description: "目标记忆卡的 4 位编号" },
    { name: "title", type: "string", required: true, description: "颗粒标题（简短概括）" },
    { name: "granule_type", type: "string", required: true, description: "颗粒类型：abstract（抽象感知/长期记忆）或 concrete（具象感知/当前环境记忆）" },
    { name: "importance", type: "string", required: true, description: "重要级别：high（高）、medium（中）、low（低）" },
    { name: "content", type: "string", required: true, description: "颗粒内容（结构化 Markdown）" },
  ],
  execute: async function* (params) {
    const imp = params.importance as "high" | "medium" | "low";
    if (!["high", "medium", "low"].includes(imp)) { yield "❌ importance 必须为 high、medium 或 low。"; return; }
    const gtype = params.granule_type as "abstract" | "concrete";
    if (!["abstract", "concrete"].includes(gtype)) { yield "❌ granule_type 必须为 abstract 或 concrete。"; return; }
    const store = loadStore();
    if (!store) { yield "❌ 无法读取 XMemory 存储"; return; }
    const cardIdx = store.cards.findIndex(c => c.id === params.card_id);
    if (cardIdx === -1) { yield `❌ 未找到编号为 ${params.card_id} 的记忆卡`; return; }
    const card = store.cards[cardIdx];
    if (card.granules.length >= 10000) { yield "⚠️ 该卡颗粒数已达上限（10000），无法创建新颗粒。请先删除部分颗粒。"; return; }
    const gid = genGranuleId(card);
    const now = Date.now();
    const granule: XMemoryGranule = {
      id: gid,
      title: params.title || "未命名颗粒",
      type: gtype,
      importance: imp,
      content: params.content || "",
      createdAt: now,
      updatedAt: now,
    };
    const released = (card.releasedGranuleIds || []).filter(rid => rid !== gid);
    store.cards[cardIdx] = { ...card, granules: [...card.granules, granule], releasedGranuleIds: released, updatedAt: now };
    saveStore(store);
    const typeLabel = gtype === "abstract" ? "🔮抽象感知" : "👁️具象感知";
    yield `✅ 已创建${typeLabel}记忆颗粒 [${gid}] "${params.title}"（${imp === "high" ? "高" : imp === "medium" ? "中" : "低"}重要级）。`;
  },
});

// ── xmemory_update_granule ──
registerModule({
  id: "xmemory_update_granule",
  name: "更新记忆颗粒",
  description: `更新指定的记忆颗粒。可修改 title、granule_type、importance、content 中的一个或多个字段。至少提供一个要修改的字段。参数：card_id（目标卡编号）、granule_id（目标颗粒编号）、title（新标题）、granule_type（新类型：abstract/concrete）、importance（新重要级别：high/medium/low）、content（新内容）。`,
  level: "normal",
  scope: "yolo",
  parameters: [
    { name: "card_id", type: "string", required: true, description: "目标记忆卡的 4 位编号" },
    { name: "granule_id", type: "string", required: true, description: "目标记忆颗粒的 4 位编号" },
    { name: "title", type: "string", required: false, description: "新标题" },
    { name: "granule_type", type: "string", required: false, description: "新类型：abstract（抽象感知）或 concrete（具象感知）" },
    { name: "importance", type: "string", required: false, description: "新重要级别：high/medium/low" },
    { name: "content", type: "string", required: false, description: "新内容（结构化 Markdown）" },
  ],
  execute: async function* (params) {
    const store = loadStore();
    if (!store) { yield "❌ 无法读取 XMemory 存储"; return; }
    const cardIdx = store.cards.findIndex(c => c.id === params.card_id);
    if (cardIdx === -1) { yield `❌ 未找到编号为 ${params.card_id} 的记忆卡`; return; }
    const card = store.cards[cardIdx];
    const gIdx = card.granules.findIndex(g => g.id === params.granule_id);
    if (gIdx === -1) { yield `❌ 未找到编号为 ${params.granule_id} 的记忆颗粒`; return; }
    const old = card.granules[gIdx];
    if (!params.title && !params.granule_type && !params.importance && !params.content) { yield "⚠️ 未提供任何要修改的字段（title/granule_type/importance/content）。"; return; }
    const imp = params.importance ? (params.importance as "high" | "medium" | "low") : old.importance;
    if (params.importance && !["high", "medium", "low"].includes(imp as string)) { yield "❌ importance 必须为 high、medium 或 low。"; return; }
    const gtype = params.granule_type ? (params.granule_type as "abstract" | "concrete") : old.type;
    if (params.granule_type && !["abstract", "concrete"].includes(gtype)) { yield "❌ granule_type 必须为 abstract 或 concrete。"; return; }
    const updated: XMemoryGranule = {
      ...old,
      title: params.title ?? old.title,
      type: gtype,
      importance: imp,
      content: params.content ?? old.content,
      updatedAt: Date.now(),
    };
    const newGranules = [...card.granules];
    newGranules[gIdx] = updated;
    store.cards[cardIdx] = { ...card, granules: newGranules, updatedAt: Date.now() };
    saveStore(store);
    yield `✅ 已更新记忆颗粒 [${params.granule_id}]。`;
  },
});

// ── xmemory_delete_granule ──
registerModule({
  id: "xmemory_delete_granule",
  name: "删除记忆颗粒",
  description: `删除指定的记忆颗粒，将其 ID 放入回收池供后续复用。参数：card_id（目标卡编号）、granule_id（目标颗粒编号）。`,
  level: "normal",
  scope: "yolo",
  parameters: [
    { name: "card_id", type: "string", required: true, description: "目标记忆卡的 4 位编号" },
    { name: "granule_id", type: "string", required: true, description: "要删除的记忆颗粒编号" },
  ],
  execute: async function* (params) {
    const store = loadStore();
    if (!store) { yield "❌ 无法读取 XMemory 存储"; return; }
    const cardIdx = store.cards.findIndex(c => c.id === params.card_id);
    if (cardIdx === -1) { yield `❌ 未找到编号为 ${params.card_id} 的记忆卡`; return; }
    const card = store.cards[cardIdx];
    const gIdx = card.granules.findIndex(g => g.id === params.granule_id);
    if (gIdx === -1) { yield `❌ 未找到编号为 ${params.granule_id} 的记忆颗粒`; return; }
    const deleted = card.granules[gIdx];
    const newGranules = card.granules.filter(g => g.id !== params.granule_id);
    const released = [...(card.releasedGranuleIds || []), params.granule_id];
    store.cards[cardIdx] = { ...card, granules: newGranules, releasedGranuleIds: released, updatedAt: Date.now() };
    saveStore(store);
    yield `✅ 已删除记忆颗粒 [${deleted.id}] "${deleted.title}"。`;
  },
});
