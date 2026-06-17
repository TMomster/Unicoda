/**
 * 预装填知识库服务
 *
 * 提供预设的知识条目，在 Agent 模式下注入到系统提示词中，
 * 让模型了解自身平台信息、当前项目上下文等。
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  /** 标签分类 */
  category: "platform" | "reference";
}

const knowledgeStore: KnowledgeEntry[] = [
  {
    id: "kb-unison-intro",
    title: "Unison 平台简介",
    category: "platform",
    enabled: true,
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
    content: `当前北京时间 (CST, UTC+8)：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
当前 UTC 时间：${new Date().toUTCString()}
今天的日期：${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}`,
  },
  {
    id: "kb-common-tech",
    title: "常用技术参考",
    category: "reference",
    enabled: true,
    content: `- TypeScript 版本：5.x
- React 版本：18.x
- Node.js 版本：22.x
- Rust 版本：1.85+
- Tauri 版本：2.x
- 包管理器：npm`,
  },
];

/** 获取所有已启用的知识条目 */
export function getEnabledKnowledgeEntries(): KnowledgeEntry[] {
  return knowledgeStore.filter((e) => e.enabled);
}

/** 获取所有知识条目（含已禁用的） */
export function getAllKnowledgeEntries(): KnowledgeEntry[] {
  return [...knowledgeStore];
}

/** 切换知识条目的启用状态 */
export function toggleKnowledgeEntry(id: string): void {
  const entry = knowledgeStore.find((e) => e.id === id);
  if (entry) entry.enabled = !entry.enabled;
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
