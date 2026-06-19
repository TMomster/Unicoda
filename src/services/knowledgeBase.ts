/**
 * 知识库服务
 *
 * 提供预设的知识条目 + 用户自定义知识卡管理。
 * 内置条目只读（仅展示标题），用户知识卡支持 CRUD。
 * 在 Agent 模式下知识库会注入到系统提示词中。
 */

import { writeConfigFile } from "../utils/configStorage";

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  /** 标签分类 */
  category: "platform" | "reference";
  /** 是否为内置条目（内置不可编辑/删除） */
  builtin: boolean;
}

const USER_CARDS_KEY = "unison-user-knowledge-cards";

const builtinEntries: KnowledgeEntry[] = [
  {
    id: "kb-unison-intro",
    title: "Unison 平台简介",
    category: "platform",
    enabled: true,
    builtin: true,
    content: `Unison 是一个模块化 AI 助手桌面应用，基于 Tauri v2 + React 构建。
核心能力包括：
- 文件读写：支持在项目目录中读取和写入文件
- 命令执行：支持在终端中运行命令并获取输出
- 代码生成与修改：可以创建、修改和重构代码
- 项目分析：能够分析项目结构、读取源代码
- 联网搜索（web_search 模组）：通过 Bing 搜索获取实时信息`,
  },
  {
    id: "kb-current-time",
    title: "当前时区与日期",
    category: "reference",
    enabled: true,
    builtin: true,
    content: `当前北京时间 (CST, UTC+8)：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
当前 UTC 时间：${new Date().toUTCString()}
今天的日期：${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}`,
  },
  {
    id: "kb-common-tech",
    title: "常用技术参考",
    category: "reference",
    enabled: true,
    builtin: true,
    content: `- TypeScript 版本：5.x
- React 版本：18.x
- Node.js 版本：22.x
- Rust 版本：1.85+
- Tauri 版本：2.x
- 包管理器：npm`,
  },
  {
    id: "kb-modules",
    title: "模组系统概览",
    category: "platform",
    enabled: true,
    builtin: true,
    content: `Unison 的模组（Module）系统提供了 4 个预置功能扩展，可通过 <tool_call> 标记调用：

1. get_current_time（获取当前时间）
   - 参数：format（可选，full/date/time）
   - 获取系统日期、时间、星期和时区

2. web_search（联网搜索）
   - 参数：query（必填）、count（可选，默认5）、language（可选，zh-CN/en-US）、excludeSites（可选）
   - 基于 Bing 搜索引擎，支持中文分词保护、域名排除

3. fetch_page（打开网页）
   - 参数：url（必填）、maxChars（可选，默认8000）
   - 获取网页清洗后的纯文本，去除广告/导航/脚本
   - ⚠️ 不适用于金融/股票实时数据网站（雪球、东方财富等），这些站点的股价/市值通过JS动态渲染且有WAF反爬保护

4. summary_page（总结网页内容）
   - 参数：url（必填）
   - 获取网页 + AI 自动生成多角度摘要（消耗一次 API 调用）

所有模组等级均为 normal（普通模式 Chat 和 Agent 均可用）。
跨轮次对话中，工具执行结果会以 [工具执行结果] 前缀注入给模型。

### 📌 web_search 搜索要点

**⚠️ 中文人名/地名搜索引擎可能拆成单字，导致搜到完全不相关的内容（如"特朗普" → 三个独立单字 → 汉字字典页）。**

系统**自动做了两重保护**：
- **自动加引号**：每段中文词都会被双引号包裹（如搜索 query 中写「"特朗普" "房产"」），告诉搜索引擎"这是一个完整词组"
- **自动排除汉字字典站点**：baike.baidu.com、hanyuguoxue.com 等常见汉字词典会被自动排除，即使分词失败也不会展示字典结果

建议模型端仍保持为中文专有名词加双引号的习惯：例如「"特朗普" 房产」「"北京市" 天气」「"马斯克" 最新」

### 📌 金融数据查询策略
当用户查询股价、市值、财报等金融数据时：

1. **不要用 fetch_page 打开金融数据网站**（雪球、东方财富等）—— 这些站点的实时数据通过 JS 动态渲染，且有 WAF 反爬保护，fetch_page 的 raw HTTP 请求无法拿到有效数据
2. **正确的做法**：使用 web_search + **英文关键词** 搜索财经新闻报道（Yahoo Finance、MarketWatch、Reuters 等），从新闻文章摘要中提取市值/股价数据
3. **如果 web_search 的结果已经包含了市值信息，直接使用**，不需要再额外尝试打开任何页面`,
  },
];

/** 获取所有知识条目（内置 + 用户自定义） */
export function getAllKnowledgeEntries(): KnowledgeEntry[] {
  const userCards = getUserCards();
  return [...builtinEntries, ...userCards];
}

/** 获取所有已启用的知识条目 */
export function getEnabledKnowledgeEntries(): KnowledgeEntry[] {
  return getAllKnowledgeEntries().filter((e) => e.enabled);
}

/** 切换知识条目的启用状态 */
export function toggleKnowledgeEntry(id: string): void {
  const entry = [...builtinEntries, ...getUserCards()].find((e) => e.id === id);
  if (entry && !entry.builtin) {
    // 用户卡片切换后持久化
    const cards = getUserCards();
    const idx = cards.findIndex((c) => c.id === id);
    if (idx !== -1) {
      cards[idx].enabled = !cards[idx].enabled;
      saveUserCards(cards);
    }
  }
}

/** 添加用户知识卡 */
export function addUserKnowledgeCard(title: string, content: string): KnowledgeEntry {
  const cards = getUserCards();
  const newCard: KnowledgeEntry = {
    id: `usr-kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    content,
    enabled: true,
    category: "reference",
    builtin: false,
  };
  cards.push(newCard);
  saveUserCards(cards);
  return newCard;
}

/** 更新用户知识卡 */
export function updateUserKnowledgeCard(id: string, title: string, content: string): boolean {
  const cards = getUserCards();
  const idx = cards.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  cards[idx].title = title;
  cards[idx].content = content;
  saveUserCards(cards);
  return true;
}

/** 删除用户知识卡 */
export function deleteUserKnowledgeCard(id: string): boolean {
  const cards = getUserCards();
  const filtered = cards.filter((c) => c.id !== id);
  if (filtered.length === cards.length) return false;
  saveUserCards(filtered);
  return true;
}

/** 将知识库格式化为系统提示词片段 */
export function formatKnowledgeForPrompt(): string {
  const entries = getEnabledKnowledgeEntries();
  if (entries.length === 0) return "";
  return (
    `## 📚 预装填知识库\n\n` +
    `以下是预载入的参考信息，请在回答中参考这些内容：\n\n` +
    entries
      .map(
        (e, i) =>
          `### ${i + 1}. ${e.title}\n\n${e.content}`,
      )
      .join("\n\n")
  );
}

// ── 用户卡片持久化 ──

function getUserCards(): KnowledgeEntry[] {
  try {
    const raw = localStorage.getItem(USER_CARDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: Record<string, unknown>) => ({
          id: String(c.id ?? ""),
          title: String(c.title ?? ""),
          content: String(c.content ?? ""),
          enabled: Boolean(c.enabled ?? true),
          category: (c.category === "platform" ? "platform" : "reference") as "platform" | "reference",
          builtin: false,
        }));
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveUserCards(cards: KnowledgeEntry[]): void {
  try {
    localStorage.setItem(USER_CARDS_KEY, JSON.stringify(cards));
  } catch { /* ignore */ }
  writeConfigFile(USER_CARDS_KEY, cards);
}
