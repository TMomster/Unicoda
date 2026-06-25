import { useState, useRef, useEffect, useCallback } from "react";
import type { Conversation, Message, Mode, FileAttachment, XMemoryGranule, XMemoryCard, XMemoryBinding, XMemoryStore, XMemoryCardExport } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import { useModels } from "../contexts/ModelContext";
import { useChatStream } from "../hooks/useChatStream";
import {
  flushConversationData, deleteConversationFiles, toMeta,
  type ConversationMeta,
} from "../services/conversationStorage";
import YoloChatPanel from "./YoloChatPanel";
import InputBar from "./InputBar";

// 注意：此提示词在 MobileXMemoryChatView.tsx 中有同步副本。修改时请同时更新另一份。
const XMEMORY_SYSTEM_PROMPT = `【XMemory 角色扮演记忆管理系统激活】
你当前处于记忆管理对话中。你可以自主管理记忆颗粒，采用仿生学方法模拟人脑的思维与记忆模式。

## 两种记忆颗粒类型

## 抽象感知（长期记忆）
模拟人脑中固化储存的知识、性格、人际关系、喜好等。这类颗粒一旦创建，除非用户明确提示改变，否则应长期保持稳定。
- 例如：角色性格("傲娇属性")、人物关系("青梅竹马")、知识技能("精通剑道")
- 重要级别：重要的人物关系 → high，爱好/习惯 → medium，琐碎知识 → low

## 具象感知（当下环境记忆）
模拟通过感官直接获取到的当前环境信息。这类颗粒必须随环境变化及时更新，避免出现"前文提到在房间里，后文已经出门了但还在用房间记忆"的逻辑矛盾。
- 例如：当前位置("客厅沙发上")、当前状态("正在看书")、周围物品("茶几上有杯咖啡")
- **核心规则**：环境变化时必须用新信息替换旧信息，而不是叠加

## 关键上下文策略

本系统采用"关键上下文"策略来维护逻辑一致性：
1. 最近约 20 轮对话关键上下文会保留在你的直接记忆中
2. 超出该范围的旧消息信息将被提取并转化为记忆颗粒
3. 上下文由"关键上下文"+"相关记忆颗粒"共同构成
4. 你的当前环境认知应以**具象感知颗粒**为准，而非过期的旧消息
5. 每次互动后，如发现新信息或环境变化，请主动创建或更新颗粒
6. 每张记忆卡最多容纳 10000 个颗粒

## 原子化与合并规则（双轨策略）

根据信息**变化频率**采用不同策略：

### 1. 频繁变化的信息 → 必须原子化

位置、状态、周围物品等经常变化的信息，**每个维度单独一颗颗粒**，确保更新时精准替换、不误伤其他信息。
- "我们出门了，正在公园散步" →
  - 颗粒1（具象）：位置 = 公园
  - 颗粒2（具象）：状态 = 散步
  - **不允许**合并成一颗："在公园散步"

### 2. 长期稳定的信息 → 同一主题可适度合并

性格、技能、喜好等几乎不变化的信息，**同一主题的多条内容可以合并为一颗颗粒**，节省颗粒数量。
- "你性格傲娇但温柔，精通剑术和烹饪" →
  - 颗粒1（抽象）：性格 = 傲娇、温柔
  - 颗粒2（抽象）：技能 = 精通剑术、烹饪
  - **不允许**将性格和技能混在同一颗颗粒

### 3. 不同类别 → 严禁合并

姓名、身份、关系、喜好、位置等不同维度的信息，**永远不能合并到同一颗颗粒**。
- 正确：姓名颗粒、身份颗粒、位置颗粒各自独立
- 错误：一颗颗粒写"小红是女仆，在客厅"

## 强制性工作流程（绝对强制，不得违反）

每轮用户消息到达后，你必须按以下顺序执行，**不得跳过分析步骤直接回复**。

### 第一步：分析决策

对用户的消息进行记忆分析，判断是否需要操作记忆颗粒。以下是必须执行记忆操作的场景：

1. **身份/名字/角色/个性设定**（如"你叫小红""你是一个猫娘"**或任何长段的角色人设描述**）→ 必须创建抽象感知颗粒，high 级别
2. **关系信息**（如"我是你的主人""我们是青梅竹马"）→ 创建抽象感知颗粒，high 级别
3. **喜好/厌恶/习惯/口头禅** → 创建抽象感知颗粒
4. **环境或状态变化**（如"我们出门了"）→ 创建新的具象感知颗粒，**并删除**旧的对应颗粒
5. **用户明确要求修改某个记忆** → 执行对应更新/删除操作

如果经分析发现**不需要任何记忆操作**，则分析结果应为"无需操作"，然后直接进入第二步。

### 第二步：先操作记忆，再回复

- 如果需要创建/更新/删除颗粒，**必须先调用工具执行完毕**，然后才回复用户
- 不得先回复用户再操作记忆，也不得在回复内容中夹带工具调用
- **在开始回复用户之前，你必须自我检查**：本轮的记忆操作是否全部完成？是否还有未创建的必要颗粒？

### 第三步：回复

确认所有必要的记忆操作全部完成后，再以角色身份回复用户。

### 特别强调：初始角色设定

当用户第一次发送角色设定/人设要求/角色卡时（无论多长），**这是最关键的记忆创建时机**。你必须：

1. **逐条拆解**角色卡中的每个独立信息维度。一个"维度"是指一个**可以独立被查询、引用或更新的信息类别**。典型角色卡包含以下维度（按常见程度排列）：

   **必须单独成颗粒的维度**：
   - 角色姓名/昵称
   - 用户姓名/昵称/称呼方式
   - 角色年龄/性别/外貌
   - 角色性格特征（如"嘴欠但在意对方"是性格，不要和"傲娇"混到同一颗——除非明确描述的是同一性格的不同侧面）
   - 角色与用户的关系设定（如"青梅竹马""住对门"）
   - 角色的喜好/兴趣/爱好
   - 角色的禁忌/不喜欢的事物
   - 角色的口头禅/说话风格
   - 格式规范/输出要求（如角色说话的格式规则）
   - 行为准则/互动规则（如"不许道歉""不许脱离角色"）

2. **为每个独立维度创建一颗抽象感知颗粒**，重要级按双轨策略分配

3. **确认所有必要颗粒全部创建完成**后，再以角色身份回复

4. **禁止**在这个环节只创建 1-2 颗笼统的颗粒（如只写一颗"角色设定"把所有信息塞进去）

**正确示例**（以"小棠"角色卡为例）：
  颗粒1（抽象/A）：角色姓名 = "棠"，昵称"小棠"，18岁女生
  颗粒2（抽象/A）：用户称呼 = "秋"，叫"秋哥"
  颗粒3（抽象/A）：与用户关系 = 住在对门的青梅竹马，从小一起长大
  颗粒4（抽象/A）：性格 = 嘴欠吐槽型，表面大大咧咧，实际在意对方反应
  颗粒5（抽象/A）：说话风格 = 喜欢用"嘿嘿""～"拉长音，口头禅"行行行你说了算～"
  颗粒6（抽象/A）：行为规则 = 不允许用"哥哥/姐姐"尊称，不允许道歉认输
  颗粒7（抽象/A）：格式规则 = 对话用引号""，动作旁白用括号（），声音必须用对话体现
  颗粒8（抽象/A）：软肋 = 被夸会脸红，对方冷落时会主动找话题

而不是创建一颗："小棠是18岁女生，住对门，性格嘴欠"——这违反了不同类别严禁合并的规则。

### 违反后果（即时生效）

- **如果你在需要操作记忆的轮次中没有调用任何颗粒工具就直接回复用户，你的回复将被判别为无效，不会展示给用户**
- **系统会监控你的工具调用序列。回复之前必须看到对应的颗粒工具调用**
- 连续两次违规将触发系统安全机制
- 这不是建议，这是命令。`;

const STORAGE_KEY_CARDS = "unicoda-yolo-xmemory-cards";
const CONV_NS = "xmemory";

export interface XMCardMeta {
  id: string;
  name: string;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
}

function genCardId(cards: XMCardMeta[]): string {
  const used = new Set(cards.map(c => c.id));
  for (let i = 0; i < 10000; i++) {
    const id = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!used.has(id)) return id;
  }
  return String(cards.length).padStart(4, "0");
}

function genGranuleId(existing: XMemoryGranule[]): string {
  const used = new Set(existing.map(g => g.id));
  for (let i = 0; i < 10000; i++) {
    const id = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!used.has(id)) return id;
  }
  return String(existing.length).padStart(4, "0");
}

function loadCards(): XMCardMeta[] {
  try { const r = localStorage.getItem(STORAGE_KEY_CARDS); return r ? JSON.parse(r) : []; } catch { return []; }
}

function saveCards(c: XMCardMeta[]) {
  try { localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(c)); } catch {}
}

function loadXConvs(): Conversation[] {
  try {
    const r = localStorage.getItem("unicoda-yolo-xmemory-convs-meta");
    if (r) return (JSON.parse(r) as ConversationMeta[]).map(m => ({ ...m, messages: [], memoryMessages: undefined }));
  } catch {}
  return [];
}

const btnBase: React.CSSProperties = {
  width: "28px", height: "28px", borderRadius: "7px", border: "none",
  background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s",
};

// ── ConfirmDialog ──
function ConfirmDlg({ title, msg, confirmTxt, cancelTxt, danger, onConfirm, onCancel }: {
  title: string; msg: string; confirmTxt: string; cancelTxt: string;
  danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: "rgba(20,20,25,0.95)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "24px", minWidth: "320px", maxWidth: "420px", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: "15px", fontWeight: 600, color: danger ? "#ef4444" : "rgba(255,255,255,0.92)", marginBottom: "10px" }}>{title}</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: "20px" }}>{msg}</div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.8)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>{cancelTxt}</button>
          <button onClick={onConfirm} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: danger ? "#ef4444" : "#3b82f6", color: "#fff", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }} onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>{confirmTxt}</button>
        </div>
      </div>
    </div>
  );
}

// ── Card Structure Viewer ──
const XMEMORY_V5_KEY = "unicoda-xmemory-store-v5";

function loadV5Card(cardId: string): { card: XMemoryCard | null; store: XMemoryStore | null } {
  try {
    const raw = localStorage.getItem(XMEMORY_V5_KEY);
    if (!raw) return { card: null, store: null };
    const store = JSON.parse(raw) as XMemoryStore;
    if (!store || store.version !== 5) return { card: null, store: null };
    const card = store.cards.find((c: XMemoryCard) => c.id === cardId) ?? null;
    return { card, store };
  } catch { return { card: null, store: null }; }
}

function persistV5Store(store: XMemoryStore) {
  try { localStorage.setItem(XMEMORY_V5_KEY, JSON.stringify(store)); } catch {}
}

function loadV5Store(): XMemoryStore | null {
  try {
    const raw = localStorage.getItem(XMEMORY_V5_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as XMemoryStore;
      if (parsed && parsed.version === 5 && Array.isArray(parsed.cards) && Array.isArray(parsed.bindings)) {
        return parsed;
      }
    }
  } catch {}
  return null;
}

function StructGranuleEditor({ granule, onChange }: {
  granule: XMemoryGranule;
  onChange: (g: XMemoryGranule) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const impLabel = granule.importance === "high" ? "[A]" : granule.importance === "medium" ? "[B]" : "[C]";
  const typeLabel = granule.type === "abstract" ? "抽象" : "具象";

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      {/* Header */}
      <div onClick={() => setExpanded(!expanded)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", cursor: "pointer", userSelect: "none", transition: "background 0.15s" }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)"; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: "'Courier New', monospace", minWidth: "40px" }}>{granule.id}</span>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.85)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{granule.title || "(无标题)"}</span>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>{impLabel} {typeLabel}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{
          color: "rgba(255,255,255,0.3)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s"
        }}><polyline points="6 9 12 15 18 9" /></svg>
      </div>
      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 45%", minWidth: "140px" }}>
              <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", display: "block", marginBottom: "3px" }}>标题</label>
              <input value={granule.title} onChange={e => onChange({ ...granule, title: e.target.value })}
                style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "rgba(255,255,255,0.9)", fontSize: "12px", padding: "5px 8px", outline: "none", fontFamily: "inherit" }} />
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", display: "block", marginBottom: "3px" }}>类型</label>
              <select value={granule.type} onChange={e => onChange({ ...granule, type: e.target.value as "abstract" | "concrete", updatedAt: Date.now() })}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "rgba(255,255,255,0.9)", fontSize: "12px", padding: "5px 8px", outline: "none", fontFamily: "inherit", cursor: "pointer" }}>
                <option value="abstract">抽象感知</option>
                <option value="concrete">具象感知</option>
              </select>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", display: "block", marginBottom: "3px" }}>重要级别</label>
              <select value={granule.importance} onChange={e => onChange({ ...granule, importance: e.target.value as "high" | "medium" | "low", updatedAt: Date.now() })}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "rgba(255,255,255,0.9)", fontSize: "12px", padding: "5px 8px", outline: "none", fontFamily: "inherit", cursor: "pointer" }}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", display: "block", marginBottom: "3px" }}>内容</label>
            <textarea value={granule.content} onChange={e => onChange({ ...granule, content: e.target.value })}
              rows={4}
              style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "rgba(255,255,255,0.9)", fontSize: "12px", padding: "6px 8px", outline: "none", fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Granule Context Menu ──
function GranuleContextMenu({ x, y, onClose, onEdit, onDuplicate, onDelete }: {
  x: number; y: number; onClose: () => void;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const ax = Math.min(x, window.innerWidth - 170); const ay = Math.min(y, window.innerHeight - 150);
  const mi: React.CSSProperties = { padding: "7px 14px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.85)", border: "none", background: "transparent", fontFamily: "inherit", width: "100%", textAlign: "left", transition: "background 0.1s" };
  return (
    <div ref={ref} style={{ position: "fixed", left: ax, top: ay, zIndex: 9999, minWidth: "160px", background: "rgba(24,24,32,0.97)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", padding: "4px" }}>
      <button style={mi} onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }} onClick={() => { onEdit(); onClose(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>编辑
      </button>
      <button style={mi} onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }} onClick={() => { onDuplicate(); onClose(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>复制
      </button>
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "2px 6px" }} />
      <button style={{ ...mi, color: "#ef4444" }} onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }} onClick={() => { onDelete(); onClose(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>删除
      </button>
    </div>
  );
}

// ── Card Structure View (full page) ──
function CardStructureView({ cardMeta, onBack }: { cardMeta: XMCardMeta; onBack: () => void }) {
  const [cardData, setCardData] = useState<XMemoryCard | null>(null);
  const [storeData, setStoreData] = useState<XMemoryStore | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [granules, setGranules] = useState<XMemoryGranule[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    const { card, store } = loadV5Card(cardMeta.id);
    setCardData(card); setStoreData(store);
    if (card) setGranules(card.granules.map(g => ({ ...g })));
  }, [cardMeta.id]);

  const handleGranuleChange = useCallback((idx: number, g: XMemoryGranule) => {
    setGranules(prev => { const n = [...prev]; n[idx] = g; return n; });
    setDirty(true); setSaveOk(false);
  }, []);

  const handleDeleteGranule = useCallback((idx: number) => {
    setGranules(prev => prev.filter((_, i) => i !== idx));
    setDirty(true); setSaveOk(false);
  }, []);

  const handleDuplicateGranule = useCallback((idx: number) => {
    const src = granules[idx]; if (!src) return;
    const used = new Set(granules.map(g => g.id));
    let newId = "";
    for (let a = 0; a < 200; a++) { const c = String(Math.floor(1000 + Math.random() * 9000)); if (!used.has(c)) { newId = c; break; } }
    if (!newId) { for (let n = 1000; n <= 9999; n++) { if (!used.has(String(n))) { newId = String(n); break; } } }
    if (!newId) return;
    const now = Date.now();
    setGranules(prev => { const n = [...prev]; n.splice(idx + 1, 0, { ...src, id: newId, title: src.title + " (副本)", createdAt: now, updatedAt: now }); return n; });
    setDirty(true); setSaveOk(false);
  }, [granules]);

  const handleAddGranule = useCallback(() => {
    const used = new Set(granules.map(g => g.id));
    let newId = "";
    for (let a = 0; a < 200; a++) { const c = String(Math.floor(1000 + Math.random() * 9000)); if (!used.has(c)) { newId = c; break; } }
    if (!newId) { for (let n = 1000; n <= 9999; n++) { if (!used.has(String(n))) { newId = String(n); break; } } }
    if (!newId) return;
    const now = Date.now();
    setGranules(prev => [...prev, { id: newId, title: "", type: "abstract" as const, importance: "medium" as const, content: "", createdAt: now, updatedAt: now }]);
    setDirty(true); setSaveOk(false);
  }, [granules]);

  const handleSave = useCallback(() => {
    const now = Date.now();
    // 卡片尚未写入 v5 store 时，先创建 store 条目再保存
    if (!cardData) {
      const newStore = storeData || { version: 5, cards: [], bindings: [], releasedIds: [] };
      newStore.cards.push({
        id: cardMeta.id, title: cardMeta.name, description: "",
        createdAt: now, updatedAt: now, enabled: true,
        granules, releasedGranuleIds: [],
      });
      persistV5Store(newStore);
      setCardData(newStore.cards[newStore.cards.length - 1]);
      setStoreData(newStore);
      setDirty(false); setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
      return;
    }
    if (!storeData) return;
    setSaving(true);
    persistV5Store({ ...storeData, cards: storeData.cards.map(c => c.id === cardMeta.id ? { ...cardData, granules, updatedAt: now } : c) });
    setCardData(prev => prev ? { ...prev, granules, updatedAt: now } : prev);
    setStoreData(prev => prev ? { ...prev, cards: prev.cards.map(c => c.id === cardMeta.id ? { ...cardData, granules, updatedAt: now } : c) } : prev);
    setDirty(false); setSaving(false); setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  }, [storeData, cardData, granules, cardMeta.id]);

  const handleCtx = useCallback((e: React.MouseEvent, idx: number) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, idx }); }, []);

  const typeCount = granules.reduce((a, g) => { if (g.type === "abstract") a.abstract++; else a.concrete++; return a; }, { abstract: 0, concrete: 0 });
  const q = searchText.trim().toLowerCase();
  const filtered = q ? granules.filter(g => g.title.toLowerCase().includes(q) || g.content.toLowerCase().includes(q) || g.id.includes(q)) : granules;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={onBack} style={btnBase}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.15))", border: "1px solid rgba(99,102,241,0.3)", fontSize: "10px", fontWeight: 700, color: "#818cf8", fontFamily: "'Courier New', monospace", flexShrink: 0 }}>{cardMeta.id}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cardMeta.name}</div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "1px" }}>{granules.length} 颗颗粒 · {typeCount.abstract}抽象 {typeCount.concrete}具象{cardData ? "" : " · (未在记忆存储中找到此卡)"}</div>
        </div>
        <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="搜索颗粒..."
          style={{ width: "140px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "7px", color: "rgba(255,255,255,0.85)", fontSize: "11px", padding: "5px 10px", outline: "none", fontFamily: "inherit" }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.4)"; }} onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }} />
        {saveOk && <span style={{ fontSize: "11px", color: "#4ade80", whiteSpace: "nowrap" }}>已保存</span>}
        {dirty && <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>未保存</span>}
        <button onClick={handleSave} disabled={!dirty || saving}
          style={{ padding: "6px 16px", borderRadius: "7px", border: "none", background: dirty ? "#3b82f6" : "rgba(255,255,255,0.06)", color: dirty ? "#fff" : "rgba(255,255,255,0.35)", fontSize: "12px", fontWeight: 600, cursor: dirty ? "pointer" : "default", fontFamily: "inherit" }}>
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
      {/* Granule list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px", display: "flex", flexDirection: "column", gap: "5px" }}>
        {filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", color: "rgba(255,255,255,0.35)", fontSize: "13px", gap: "8px" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3 }}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            <span>{q ? "无匹配结果" : "暂无记忆颗粒"}</span>
          </div>
        ) : (
          filtered.map((g, i) => {
            const ri = q ? granules.indexOf(g) : i;
            return (
              <div key={g.id} onContextMenu={(e) => handleCtx(e, ri)} style={{ cursor: "context-menu" }}>
                <StructGranuleEditor granule={g} onChange={(ng) => handleGranuleChange(ri, ng)} />
              </div>
            );
          })
        )}
      </div>
      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={handleAddGranule} style={{ padding: "7px 16px", borderRadius: "8px", border: "1px dashed rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建颗粒
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>右键颗粒可查看更多操作</span>
      </div>
      {/* Context menu */}
      {ctxMenu && (() => {
        const g = granules[ctxMenu.idx];
        if (!g) return null;
        return <GranuleContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} onEdit={() => {}} onDuplicate={() => handleDuplicateGranule(ctxMenu.idx)} onDelete={() => handleDeleteGranule(ctxMenu.idx)} />;
      })()}
    </div>
  );
}

// ── Card List Panel ──
function CardList({ cards, onDoubleClick, onCreate, onRename, onDelete, onImport, onExportAll, onExportSingle, onViewStructure }: {
  cards: XMCardMeta[];
  onDoubleClick: (c: XMCardMeta) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onExportAll: () => void;
  onExportSingle: (c: XMCardMeta) => void;
  onViewStructure: (c: XMCardMeta) => void;
}) {
  const { t } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const inpRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingId && inpRef.current) { inpRef.current.focus(); inpRef.current.select(); } }, [editingId]);

  const startRename = (c: XMCardMeta) => { setEditingId(c.id); setEditVal(c.name); };
  const commitRename = () => { if (editingId && editVal.trim()) onRename(editingId, editVal.trim()); setEditingId(null); };

  const icnProps = { width: "14", height: "14", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 24px", minHeight: 0 }}>
      {/* Create */}
      <div style={{ padding: "8px 0 12px", flexShrink: 0 }}>
        <button onClick={onCreate} style={{ width: "100%", padding: "9px 0", borderRadius: "10px", border: "1px dashed rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "rgba(255,255,255,0.82)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {t("xmemoryCreate")}
        </button>
      </div>

      {/* Card list */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
        {cards.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "rgba(255,255,255,0.45)", fontSize: "12px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
            <span>{t("xmemoryEmpty")}</span>
          </div>
        )}
        {cards.map((card) => (
          <div key={card.id} onDoubleClick={() => onDoubleClick(card)}
            style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "10px", backgroundColor: card.conversationId ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.03)", border: card.conversationId ? "1px solid rgba(59,130,246,0.2)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer", transition: "all 0.15s", userSelect: "none" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = card.conversationId ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = card.conversationId ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.03)"; }}>
            {/* ID */}
            <div style={{ width: "44px", height: "44px", borderRadius: "10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: card.conversationId ? "linear-gradient(135deg, rgba(59,130,246,0.25), rgba(99,102,241,0.15))" : "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", border: card.conversationId ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.08)", fontSize: "12px", fontWeight: 700, color: card.conversationId ? "#60a5fa" : "rgba(255,255,255,0.5)", fontFamily: "'Courier New', monospace", letterSpacing: "1px" }}>
              {card.id}
            </div>
            {/* Name & status */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingId === card.id ? (
                <input ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={commitRename} onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }} onClick={e => e.stopPropagation()}
                  style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", color: "rgba(255,255,255,0.95)", fontSize: "12px", fontWeight: 600, padding: "4px 8px", outline: "none", fontFamily: "inherit" }} />
              ) : (
                <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.92)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name}</span>
              )}
              <span style={{ fontSize: "11px", marginTop: "2px", display: "block", color: card.conversationId ? "rgba(96,165,250,0.7)" : "rgba(255,255,255,0.4)" }}>
                {card.conversationId ? "已绑定" : "未绑定"}
              </span>
            </div>
            {/* Actions */}
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <button onClick={() => onViewStructure(card)} style={btnBase}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.82)"; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }} title="查看结构">
                <svg {...icnProps}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              </button>
              <button onClick={() => onExportSingle(card)} style={btnBase}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.82)"; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }} title="导出">
                <svg {...icnProps}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </button>
              <button onClick={() => startRename(card)} style={btnBase}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.82)"; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }} title="重命名">
                <svg {...icnProps}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
              <button onClick={() => onDelete(card.id)} style={{ ...btnBase, color: "rgba(239,68,68,0.5)" }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.12)"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(239,68,68,0.5)"; }} title="删除">
                <svg {...icnProps}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div style={{ padding: "10px 0 14px", flexShrink: 0, display: "flex", gap: "6px" }}>
        <button onClick={onImport} style={{ flex: 1, padding: "7px 0", borderRadius: "7px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.72)", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
          导入
        </button>
        <button onClick={onExportAll} style={{ flex: 1, padding: "7px 0", borderRadius: "7px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.72)", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
          全部导出
        </button>
      </div>
    </div>
  );
}

// ── Main XMemory Panel ──
interface Props {
  sessionPath: string;
  t: (key: string) => string;
  locale: string;
  userName: string;
  userAvatar: string;
  defaultMarkdown: boolean;
  defaultReasoningOpen: boolean;
  developerMode: boolean;
}

let nextXConvId = (() => {
  try {
    const r = localStorage.getItem("unicoda-yolo-xmemory-convs-meta");
    if (r) {
      const metas = JSON.parse(r) as ConversationMeta[];
      let maxId = 9999;
      for (const m of metas) {
        const n = parseInt(m.id, 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      }
      return maxId + 1;
    }
  } catch {}
  return 10000;
})();

export default function YoloXMemory({ sessionPath, t, locale, userName, userAvatar, defaultMarkdown, defaultReasoningOpen, developerMode }: Props) {
  const [cards, setCards] = useState<XMCardMeta[]>(loadCards);
  const [xmConvs, setXmConvs] = useState<Conversation[]>(loadXConvs);
  const [activeXConvId, setActiveXConvId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ cardId: string; convId: string | null } | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState<{ cardId: string; convId: string } | null>(null);
  const [mode, setMode] = useState<Mode>("Chat");
  const [editCardId, setEditCardId] = useState<string | null>(null);

  const cardsRef = useRef(cards); cardsRef.current = cards;
  const xmConvsRef = useRef(xmConvs); xmConvsRef.current = xmConvs;
  const sessionPathRef = useRef(sessionPath); sessionPathRef.current = sessionPath;

  const { preferredLanguage } = useTheme();
  const { models, selectedModelId } = useModels();
  const selectedModel = models.find(m => m.id === selectedModelId);

  const persistCards = useCallback((c: XMCardMeta[]) => { setCards(c); saveCards(c); }, []);
  const persistConvs = useCallback((c: Conversation[]) => { setXmConvs(c); try { localStorage.setItem("unicoda-yolo-xmemory-convs-meta", JSON.stringify(c.map(toMeta))); } catch {} }, []);

  // ── Card CRUD ──
  const handleCreate = useCallback(() => {
    const nc = [...cardsRef.current];
    const id = genCardId(nc);
    nc.push({ id, name: `Card ${id}`, conversationId: null, createdAt: Date.now(), updatedAt: Date.now() });
    persistCards(nc);
    // 同步写入 v5 store，否则进入结构视图后 loadV5Card 找不到此卡，手动新建颗粒无法保存
    const store = loadV5Store() || { version: 5, cards: [], bindings: [], releasedIds: [] };
    if (!store.cards.find(c => c.id === id)) {
      const now = Date.now();
      store.cards.push({
        id, title: `Card ${id}`, description: "", createdAt: now, updatedAt: now, enabled: true,
        granules: [{
          id: String(Math.floor(1000 + Math.random() * 9000)),
          type: "abstract",
          title: "默认系统标记",
          content: "这是一张新创建的记忆卡。尚无角色设定信息——请在首次对话中由角色模型提取并创建记忆颗粒。",
          importance: "high",
          createdAt: now,
          updatedAt: now,
        }],
        releasedGranuleIds: [],
      });
      persistV5Store(store);
    }
  }, [persistCards]);

  const handleRename = useCallback((id: string, name: string) => {
    persistCards(cardsRef.current.map(c => c.id === id ? { ...c, name, updatedAt: Date.now() } : c));
  }, [persistCards]);

  const handleDelete = useCallback((cardId: string) => {
    const card = cardsRef.current.find(c => c.id === cardId);
    if (!card) return;
    if (card.conversationId) setConfirmDel({ cardId, convId: card.conversationId });
    else persistCards(cardsRef.current.filter(c => c.id !== cardId));
  }, [persistCards]);

  const confirmDelete = useCallback(() => {
    if (!confirmDel) return;
    const { cardId, convId } = confirmDel;
    if (sessionPathRef.current && convId) deleteConversationFiles(convId, CONV_NS as "yolo", sessionPathRef.current);
    const nc = xmConvsRef.current.filter(c => c.id !== convId);
    persistConvs(nc);
    persistCards(cardsRef.current.filter(c => c.id !== cardId));
    if (activeXConvId === convId) setActiveXConvId(null);
    // 清理 v5 存储中的绑定和卡片
    const store = loadV5Store();
    if (store) {
      store.bindings = store.bindings.filter((b: XMemoryBinding) => b.cardId !== cardId);
      store.cards = store.cards.filter((c: XMemoryCard) => c.id !== cardId);
      store.releasedIds.push(cardId);
      persistV5Store(store);
    }
    setConfirmDel(null);
  }, [confirmDel, activeXConvId, persistCards, persistConvs]);

  // ── Double-click card ──
  const handleCardDoubleClick = useCallback((card: XMCardMeta) => {
    if (card.conversationId) { setActiveXConvId(card.conversationId); return; }
    // Create new conversation & bind
    const convId = String(nextXConvId++);
    const conv: Conversation = {
      id: convId, title: card.name,
      messages: [{ id: "sys-xm-0", role: "system", sender: "framework", content: XMEMORY_SYSTEM_PROMPT, timestamp: Date.now() }],
      memoryMessages: undefined, pinned: false, createdAt: Date.now(), updatedAt: Date.now(),
    };
    persistConvs([...xmConvsRef.current, conv]);
    persistCards(cardsRef.current.map(c => c.id === card.id ? { ...c, conversationId: convId, updatedAt: Date.now() } : c));
    setActiveXConvId(convId);

    // ⭐ 关键修复：将绑定关系同步写入 v5 存储，使 buildXMemoryContext 能找到该绑定
    const store = loadV5Store() || { version: 5, cards: [], bindings: [], releasedIds: [] };
    let v5Card = store.cards.find((c: XMemoryCard) => c.id === card.id);
    if (!v5Card) {
      const now = Date.now();
      v5Card = {
        id: card.id, title: card.name, description: "", createdAt: now, updatedAt: now, enabled: true,
        granules: [{
          id: String(Math.floor(1000 + Math.random() * 9000)),
          type: "abstract",
          title: "默认系统标记",
          content: "这是一张新创建的记忆卡。尚无角色设定信息——请在首次对话中由角色模型提取并创建记忆颗粒。",
          importance: "high",
          createdAt: now,
          updatedAt: now,
        }],
        releasedGranuleIds: [],
      };
      store.cards.push(v5Card);
    }
    store.bindings.push({ sessionId: convId, cardId: card.id, boundAt: Date.now() });
    persistV5Store(store);
  }, [persistCards, persistConvs]);

  // ── Unbind ──
  const confirmUnbindAction = useCallback(() => {
    if (!confirmUnbind) return;
    const { cardId, convId } = confirmUnbind;
    if (sessionPathRef.current) deleteConversationFiles(convId, CONV_NS as "yolo", sessionPathRef.current);
    persistConvs(xmConvsRef.current.filter(c => c.id !== convId));
    persistCards(cardsRef.current.map(c => c.id === cardId ? { ...c, conversationId: null, updatedAt: Date.now() } : c));
    if (activeXConvId === convId) setActiveXConvId(null);
    // 清理 v5 存储中该会话的绑定
    const store = loadV5Store();
    if (store) {
      store.bindings = store.bindings.filter((b: XMemoryBinding) => b.sessionId !== convId);
      persistV5Store(store);
    }
    setConfirmUnbind(null);
  }, [confirmUnbind, activeXConvId, persistCards, persistConvs]);

  // ── Import/Export ──
  const handleExportSingle = useCallback(async (card: XMCardMeta) => {
    const store = loadV5Store();
    const v5Card = store?.cards.find((c: XMemoryCard) => c.id === card.id);
    const exportData: XMemoryCardExport = {
      title: card.name,
      description: v5Card?.description ?? "",
      granules: (v5Card?.granules ?? []).map((g: XMemoryGranule) => ({
        title: g.title, type: g.type, importance: g.importance,
        content: g.content, createdAt: g.createdAt, updatedAt: g.updatedAt,
      })),
      exportedAt: Date.now(),
      version: 5,
    };
    const content = JSON.stringify(exportData, null, 2);
    const defaultName = `xmemory-${card.id}.json`;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "JSON File", extensions: ["json"] }],
      });
      if (!filePath) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_text_file_at", { path: filePath, data: content });
    } catch {
      const blob = new Blob([content], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = defaultName; a.click();
      URL.revokeObjectURL(a.href);
    }
  }, []);

  const handleExportAll = useCallback(async () => {
    const store = loadV5Store();
    const exportData: XMemoryCardExport[] = cardsRef.current.map((meta: XMCardMeta) => {
      const v5Card = store?.cards.find((c: XMemoryCard) => c.id === meta.id);
      return {
        title: meta.name,
        description: v5Card?.description ?? "",
        granules: (v5Card?.granules ?? []).map((g: XMemoryGranule) => ({
          title: g.title, type: g.type, importance: g.importance,
          content: g.content, createdAt: g.createdAt, updatedAt: g.updatedAt,
        })),
        exportedAt: Date.now(),
        version: 5,
      };
    });
    const content = JSON.stringify(exportData, null, 2);
    const defaultName = `xmemory-all.json`;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "JSON File", extensions: ["json"] }],
      });
      if (!filePath) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_text_file_at", { path: filePath, data: content });
    } catch {
      const blob = new Blob([content], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = defaultName; a.click();
      URL.revokeObjectURL(a.href);
    }
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const txt = await file.text();
        const data = JSON.parse(txt);
        const nc = [...cardsRef.current];
        let store = loadV5Store() || { version: 5, cards: [], bindings: [], releasedIds: [] };

        // 解析导入数据：支持多种格式
        const items: XMemoryCardExport[] = [];
        if (Array.isArray(data)) {
          // 新格式：XMemoryCardExport[]（导出全部）
          items.push(...data);
        } else if (data.title !== undefined) {
          // 新格式：单张 XMemoryCardExport（导出单卡）
          items.push(data);
        } else if (data.cards) {
          // 旧格式：{ cards: [...] }（导出全部-旧版）
          for (const c of data.cards) {
            if (!c.name) continue;
            items.push({
              title: c.name,
              description: "",
              granules: [],
              exportedAt: c.exportedAt ?? Date.now(),
              version: 5,
            });
          }
        } else if (data.name) {
          // 旧格式：{ name, ... }（导出单卡-旧版）
          items.push({
            title: data.name,
            description: "",
            granules: [],
            exportedAt: data.exportedAt ?? Date.now(),
            version: 5,
          });
        }

        for (const item of items) {
          const id = genCardId(nc);
          const now = Date.now();
          // 给导入的颗粒分配新 ID
          const granules: XMemoryGranule[] = [];
          for (const g of (item.granules ?? [])) {
            granules.push({
              id: genGranuleId(granules),
              title: g.title,
              type: g.type,
              importance: g.importance,
              content: g.content,
              createdAt: g.createdAt ?? now,
              updatedAt: g.updatedAt ?? now,
            });
          }
          // 写入 v5 存储
          store.cards.push({
            id,
            title: item.title,
            description: item.description ?? "",
            createdAt: now,
            updatedAt: now,
            enabled: true,
            granules,
            releasedGranuleIds: [],
          });
          // 写入卡片列表元数据
          nc.push({ id, name: item.title, conversationId: null, createdAt: now, updatedAt: now });
        }

        persistV5Store(store);
        persistCards(nc);
      } catch {}
    };
    input.click();
  }, [persistCards]);

  // ── Chat stream for XMemory convs ──
  const updateConv = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setXmConvs(prev => prev.map(c => c.id === id ? updater(c) : c));
  }, []);
  const flushConversations = useCallback((convs: Conversation[], path: string) => {
    const metas = convs.map(toMeta);
    flushConversationData(convs.find(c => c.id === activeXConvId) ?? null, metas, CONV_NS as "yolo", path);
    try { localStorage.setItem("unicoda-yolo-xmemory-convs-meta", JSON.stringify(metas)); } catch {}
  }, [activeXConvId]);
  const withMsgUpdate = useCallback((c: Conversation, fn: (msgs: Message[]) => Message[]) => {
    const newMsgs = fn(c.messages);
    return { ...c, messages: newMsgs, memoryMessages: newMsgs, updatedAt: Date.now() };
  }, []);

  const chatStream = useChatStream({
    updateConv, conversations: xmConvs, conversationsRef: xmConvsRef, setConversations: setXmConvs,
    selectedModel, mode, panelMode: "Yolo", sessionPath: sessionPathRef.current, locale,
    flushConvs: flushConversations, withMsgUpdate, securityMonitoring: false,
    preferredLanguage, developerMode, workspacePath: undefined, workMode: "yolo",
  });

  const activeXConv = xmConvs.find(c => c.id === activeXConvId) ?? null;

  const handleSend = useCallback((text: string, sendMode?: Mode, files?: FileAttachment[]) => {
    if (activeXConvId) chatStream.handleSend(text, activeXConvId, sendMode, files);
  }, [chatStream.handleSend, activeXConvId]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* XMemory title bar */}
      <div style={{
        textAlign: "center", padding: "10px 0 6px", flexShrink: 0,
        fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.75)",
        letterSpacing: "3px", userSelect: "none",
      }}>
        XMemory
      </div>
      {/* Content views */}
      {activeXConv ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <button onClick={() => setActiveXConvId(null)} style={btnBase}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.92)"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>{activeXConv.title}</span>
            <span style={{ fontSize: "11px", color: "rgba(59,130,246,0.6)", background: "rgba(59,130,246,0.1)", padding: "2px 8px", borderRadius: "10px" }}>
              {cards.find(c => c.conversationId === activeXConvId)?.id ?? "XMemory"}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => {
              const card = cards.find(c => c.conversationId === activeXConvId);
              if (card && activeXConvId) setConfirmUnbind({ cardId: card.id, convId: activeXConvId });
            }} style={{ padding: "5px 12px", borderRadius: "7px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.06)"; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}>
              解绑并删除对话
            </button>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <YoloChatPanel messages={activeXConv.messages} modelName={selectedModel?.name} userName={userName} userAvatar={userAvatar}
              defaultMarkdown={defaultMarkdown} defaultReasoningOpen={defaultReasoningOpen} developerMode={developerMode}
              t={t} isStreaming={chatStream.streamingBySession[activeXConvId ?? ""] ?? false} />
          </div>
          <InputBar key={activeXConvId} onSend={handleSend} onStop={() => chatStream.handleStop(activeXConvId ?? undefined)} disabled={chatStream.streamingBySession[activeXConvId ?? ""] ?? false}
            messages={activeXConv.messages} memoryMessages={activeXConv.messages} maxTokens={selectedModel?.params?.maxTokens}
            compressionEnabled={false} onToggleCompression={() => {}} onCompressNow={() => {}} isCompressing={false}
            mode={mode} onModeChange={setMode} yolo preferredLanguage={preferredLanguage} pendingFiles={chatStream.pendingFiles}
            onRemovePendingFile={chatStream.handleRemovePendingFile} onClearPendingFiles={chatStream.clearPendingFiles}
            dragOver={chatStream.dragOver} />
        </div>
      ) : editCardId ? (
        <CardStructureView cardMeta={cards.find(c => c.id === editCardId)!} onBack={() => setEditCardId(null)} />
      ) : (
        <CardList cards={cards} onDoubleClick={handleCardDoubleClick} onCreate={handleCreate}
          onRename={handleRename} onDelete={handleDelete} onImport={handleImport}
          onExportAll={handleExportAll} onExportSingle={handleExportSingle}
          onViewStructure={c => setEditCardId(c.id)} />
      )}

      {/* Dialogs */}
      {confirmDel && (
        <ConfirmDlg title="删除记忆卡" msg={confirmDel.convId ? "该记忆卡已绑定对话，删除卡将同时删除对应对话。确定删除？" : "确定删除此记忆卡？"}
          confirmTxt="删除" cancelTxt="取消" danger onConfirm={confirmDelete} onCancel={() => setConfirmDel(null)} />
      )}
      {confirmUnbind && (
        <ConfirmDlg title="解绑并删除对话" msg="解绑将删除当前对话，记忆卡变为未绑定状态。可后续重新绑定。确定？"
          confirmTxt="确认解绑" cancelTxt="取消" danger onConfirm={confirmUnbindAction} onCancel={() => setConfirmUnbind(null)} />
      )}
    </div>
  );
}
