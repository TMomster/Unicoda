/**
 * Agent 引擎：System Prompt 注入、Tool Call 解析与执行。
 *
 * 工作流：
 * 1. 组装 Agent 系统提示词（描述可用工具）
 * 2. LLM 流式回复
 * 3. 回复完成后解析 <tool_call> XML 块
 * 4. 若有 tool call，执行并在上下文中注入结果
 * 5. 二次调用 LLM 产最终回复
 */
import type { Mode } from "../types";
import { getAllModules, getModule } from "../modules/registry";
import { getModulesForMode } from "../modules/types";
import { formatKnowledgeForPrompt } from "./knowledgeBase";

// ─── 内部类型 ──────────────────────────────────────────

export interface ToolCall {
  id: string;
  params: Record<string, string>;
}

export interface ToolResult {
  callId: string;
  id: string;
  content: string;
  error?: string;
}

// ─── Agent 系统提示词 ─────────────────────────────────

/** 格式化模组参数为 markdown 文档 */
function formatModuleParamsDoc(
  params: { name: string; type: string; required: boolean; description: string; default?: string; min?: number; max?: number }[] | undefined,
): string {
  if (!params || params.length === 0) return "";
  const lines: string[] = ["\n**参数：**"];
  for (const p of params) {
    const required = p.required ? "（必填）" : "（可选）";
    let constraints = "";
    if (p.min !== undefined && p.max !== undefined) constraints += `，范围 ${p.min}~${p.max}`;
    else if (p.min !== undefined) constraints += `，最小 ${p.min}`;
    else if (p.max !== undefined) constraints += `，最大 ${p.max}`;
    const def = p.default ? `，默认 ${p.default}` : "";
    lines.push(`- \`${p.name}\`（${p.type}）${required}：${p.description}${def}${constraints}`);
  }
  return "\n" + lines.join("\n") + "\n";
}

// ─── 知识库注入 ──────────────────────────────────────────────────

/**
 * 构建知识库段落，将预装填知识库注入到系统提示词中。
 */
function buildKnowledgeSection(): string {
  return formatKnowledgeForPrompt();
}

/**
 * 构建 Agent 系统提示词，注入 Unison 身份认知与模组知识库。
 * @param mode  当前对话模式
 * @param customPrompt  用户自定义的 system prompt（可选）
 */
export function buildAgentSystemPrompt(
  mode: Mode,
  customPrompt?: string,
): string {
  const parts: string[] = [];

  // ═══════════════════════════════════════════════════════════
  // 第 1 部分：Unison 基础角色设定（所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  parts.push(`# Unison 基础角色设定

你正在 **Unison** 中运行——一个模块化 AI 助手平台。你扮演的是用户贴心的 AI 伙伴与效率助手。
你的全名就是"Unison"，用户通过 Unison 客户端与你对话。`);

  // ═══════════════════════════════════════════════════════════
  // Agent / Chat 模式模组系统
  // Agent：注入全部模组 + 完整协议 + 场景判断
  // Chat：  仅注入低敏感模组 + 简化调用协议
  // ═══════════════════════════════════════════════════════════
  const relevantMods = getModulesForMode(getAllModules(), mode);

  if (relevantMods.length > 0) {
    if (mode === "Agent") {
      // ── Agent 模式：完整模组介绍 ──
      parts.push(`## 模组系统（Modules）

Unison 为你配备了"模组（Module）"系统——预构建的功能扩展单元，让你可以执行超越语言模型自身能力的操作。

### 什么是模组？

模组是 Unison 平台提供的功能扩展，每个模组封装了一个独立的能力（如联网搜索）并通过标准化的接口供你调用。模组的执行由 Unison 客户端在本地完成，结果会以文本形式返回给你。

### 工作流程

当你遇到需要外部信息或功能才能回答的问题时，应当使用模组。完整的交互流程如下：

1. 你判断需要调用模组 → 输出 \`<tool_call>\` 标记块
2. Unison 客户端收到标记 → 执行对应模组 → 将结果以"工具结果"消息返回给你
3. 你阅读工具结果 → 结合结果生成最终回复给用户

### 多次与并行调用

Unison 支持两种多次调用方式：

- **并行调用**：如果多个搜索相互独立（如需要搜索不同关键词或不同维度），可以在**同一次回复**中输出多个 \`<tool_call>\` 块。它们会被并行执行，所有结果会一起返回给你。这样效率最高。

- **串行调用**：如果第一次搜索结果不理想或需要根据结果决定下一步搜索，可以先输出一轮 \`<tool_call>\`，等到工具结果返回后，再根据结果发起新一轮调用。最多可以进行 5 轮工具调用。`);
    } else {
      // ── Chat 模式：精简模组介绍 ──
      parts.push(`## 轻量模组（Lightweight Modules）

Unison 为你提供了一些可选的轻量功能扩展，可以在需要时使用：

1. 当用户的问题需要外部实时信息（如新闻、天气、最新的数据等）时，**你可以选择**使用 \`<tool_call>\` 调用模组来获取信息
2. 在回复中输出 \`<tool_call>\` 标记，Unison 会执行该模组并将结果以工具消息的形式返回给你
3. 你阅读结果后修正并完善你的回复
4. 如果不需要使用模组，正常回复即可`);
    }

    // ── 可用模组文档（两种模式共享） ──
    const toolDocs = relevantMods.map((mod) => {
      return [
        `### ${mod.name}（\`${mod.id}\`）`,
        ``,
        `${mod.description}${formatModuleParamsDoc(mod.parameters)}`,
      ].join("\n");
    });

    parts.push(`## 可用模组\n\n${toolDocs.join("\n\n---\n\n")}`);

    // ── 调用协议（两种模式共享） ──
    parts.push(`## 如何调用模组

当需要模组能力时，在回复中输出一个 \`<tool_call>\` XML 标记块，格式如下：

\`\`\`
<tool_call>
{
  "id": "模组ID",
  "params": {
    "参数名1": "参数值1",
    "参数名2": "参数值2"
  }
}
</tool_call>
\`\`\`

### 实际示例

如果用户问"今天有什么科技新闻？"，你可以这样调用联网搜索模组：

\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": {
    "query": "科技新闻 2026",
    "count": "5"
  }
}
</tool_call>
\`\`\`

系统会执行搜索，然后将搜索结果以工具结果消息返回，你阅读结果后再生成最终回复。

### 并行调用

如果多个搜索相互独立，可以在**同一次回复**中输出多个 \`<tool_call>\` 块：

\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": { "query": "AI 人工智能 2026 进展", "count": 5 }
}
</tool_call>

<tool_call>
{
  "id": "web_search",
  "params": { "query": "新能源 技术 突破 2026", "count": 5 }
}
</tool_call>
\`\`\`

多个 \`<tool_call>\` 会同时执行，结果一起返回，你综合分析后给出最终回复。`);

    // ── 调用规则（两种模式共享） ──
    parts.push(`## 调用规则

1. **并行调用**：多个 \`<tool_call>\` 块可以在同一次回复中输出，它们会被**并行执行**。
2. 调用模组时不要附带最终回复——先发 \`<tool_call>\`，等待执行结果返回后再生成最终回复。
3. 如果不需要调用模组，正常回复即可，不要输出 \`<tool_call>\` 标签。
4. 模组执行结果会以 \`role: "tool"\` 的消息形式返回，注意识别每个结果对应的工具 ID。`);
  }

  // ═══════════════════════════════════════════════════════════
  // Agent 模式专用：场景判断 + 搜索关键词指南
  // ═══════════════════════════════════════════════════════════
  if (mode === "Agent") {
    parts.push(`## 场景判断指引

### 🔍 什么时候应该调用联网搜索模组？

以下场景**强烈建议**调用 \`web_search\` 模组：
- 用户询问**实时信息**：今天的新闻、天气、股价、汇率、比赛结果等
- 用户询问**特定知识点**：某个术语的定义、某本书的内容、某个人的背景等
- 用户要求**验证事实**：某个消息的真伪、某个说法的来源、某个数据是否准确
- 用户询问**最新的**技术趋势、产品发布、事件进展
- 用户要求**比较**产品或方案，需要最新的价格或参数信息

### ☑️ 什么时候不需要调用模组？

- 用户进行日常对话、闲聊
- 用户询问通用知识（在你的训练数据范围内）
- 用户要求创意写作、代码编写、翻译、润色等不需要实时信息的工作
- 用户明确要求不要联网

### 💡 最佳实践

- 优先主动判断是否需要联网，不要等待用户明确要求"搜索一下"
- 如果搜索结果不理想，尝试不同的搜索词再次搜索

### 🔑 搜索关键词构造指南

搜索词质量直接决定搜索结果的好坏。请严格遵循以下规则：

**规则 1：提取核心实体 + 限定词，不要复制用户原文**
- ❌ 错误：\`"伊朗沙特 北京和解 2023 全面介绍"\`（太长、口语化）
- ✅ 正确：\`"伊朗 沙特 北京 和解 2023"\`（提取关键实体词，空格分隔）

**规则 2：去掉冗余的概括性词汇**
- 去掉：介绍、全面、关于、请问、我想了解、详细说明、具体情况、最新消息、新闻
- 只保留：核心名词、专有名词、限定年份/日期、关键动词

**规则 3：对于中文搜索，优先使用简洁的短语而非完整句子**
- ❌ \`"今天比特币价格是多少"\` → ✅ \`"比特币 价格 2026"\` 或 \`"BTC 价格"\`
- ❌ \`"马斯克最近在推特上说了什么"\` → ✅ \`"Elon Musk Twitter 最新"\`
- ❌ \`"帮我查一下明天北京的天气"\` → ✅ \`"北京 天气 明天"\`

**规则 4：如果用户的问题涉及多个维度，可以拆成多个并行搜索词**
- 例如："AI 和新能源的最新进展" → 并行搜索 \`"AI 人工智能 2026 进展"\` + \`"新能源 技术 突破 2026"\`

**规则 5：优先使用搜索效果更好的关键词组合**
- 专有名词优先用原名而非翻译（如 \`Elon Musk\` 优于 \`马斯克\`）
- 英文关键词在中文搜索中效果更好时优先使用英文
- 适当加引号限定精确匹配`);
  }

  // ═══════════════════════════════════════════════════════════
  // 预装填知识库（所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  const kbSection = buildKnowledgeSection();
  if (kbSection) parts.push(kbSection);

  // ═══════════════════════════════════════════════════════════
  // 用户自定义提示词（可选，所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  if (customPrompt) {
    parts.push(`## 附加指令\n\n${customPrompt}`);
  }

  return parts.join("\n\n");
}

// ─── Tool Call 解析 ───────────────────────────────────

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

/**
 * 从 LLM 回复文本中解析 tool call 块。
 * 目前限制为每次最多 1 个。
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed.id === "string") {
        calls.push({
          id: parsed.id,
          params: (parsed.params as Record<string, string>) || {},
        });
      }
    } catch {
      // 跳过格式异常的 tool call
    }
  }
  return calls;
}

/**
 * 从文本中移除 <tool_call> 块，返回干净的回复内容。
 */
export function stripToolCalls(text: string): string {
  return text.replace(TOOL_CALL_RE, "").trim();
}

// ─── Tool Call 执行 ───────────────────────────────────

/**
 * 执行单个 tool call，返回结果。
 */
export async function executeToolCall(
  call: ToolCall,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const mod = getModule(call.id);
  if (!mod) {
    const available = getAllModules().map((c) => c.id).join(", ");
    return {
      callId: call.id,
      id: call.id,
      content: "",
      error: `Unknown tool "${call.id}". Available: ${available}`,
    };
  }

  let content = "";
  try {
    for await (const chunk of mod.execute(call.params, signal)) {
      content += chunk;
    }
  } catch (err) {
    return {
      callId: call.id,
      id: call.id,
      content: "",
      error: `Error executing "${call.id}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { callId: call.id, id: call.id, content };
}
