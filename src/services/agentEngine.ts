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
import type { Mode, PanelMode, ModelConfig } from "../types";
import type { PreferredLanguage } from "../i18n";
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
import type { KnowledgeMode } from "./knowledgeBase";

/**
 * 构建知识库段落，将预装填知识库注入到系统提示词中。
 * @param kbMode  知识库层级过滤（framework 全部可见，normal/yolo 各自可见）
 * @param locale  用于时间格式化的语言环境
 */
function buildKnowledgeSection(kbMode?: KnowledgeMode, locale?: string): string {
  return formatKnowledgeForPrompt(kbMode, locale);
}

/**
 * 构建 Agent 系统提示词，注入 Unicoda 身份认知与模组知识库。
 * @param mode  当前对话模式
 * @param customPrompt  用户自定义的 system prompt（可选）
 * @param workspacePath  当前工作区路径（Yolo 模式每个会话独立记录）
 * @param kbMode  知识库层级过滤（未传则仅 framework 级别可见）
 * @param panelMode  工作模式（Default / Yolo），用于筛选 scope 匹配的模组
 */
export function buildAgentSystemPrompt(
  mode: Mode,
  customPrompt?: string,
  workspacePath?: string,
  kbMode?: KnowledgeMode,
  panelMode?: PanelMode,
  preferredLanguage?: PreferredLanguage,
): string {
  const parts: string[] = [];

  // ═══════════════════════════════════════════════════════════
  // 第 0 部分：偏好语言指令（最优先注入，放在所有内容最前面）
  // 确保模型在阅读任何其他指令前先看到语言要求
  // ═══════════════════════════════════════════════════════════
  if (preferredLanguage) {
    const langInstr: Record<string, string> = {
      "zh-CN": "【严格语言指令】你必须全程使用汉语（中文）输出，包括所有推理过程、深度思考内容、分析步骤和最终回复。任何情况下都不得使用其他语言。",
      "en-US": "【STRICT LANGUAGE RULE】You MUST output in American English (en-US) at all times. Use American spelling (e.g. color, realize, center), vocabulary, and conventions. This includes all reasoning steps, deep thinking content, analysis, and final responses. Do NOT switch to any other language under any circumstances.",
      "de-DE": "【STRENGE SPRACHREGEL】Sie MÜSSEN durchgehend auf Deutsch antworten. Dies gilt für alle Überlegungsschritte, tiefgehende Gedanken, Analysen und die endgültige Antwort. Verwenden Sie unter keinen Umständen eine andere Sprache.",
      "ja-JP": "【厳格な言語ルール】すべての出力を日本語で行ってください。思考プロセス、深い推論内容、分析ステップ、最終回答のすべてを含みます。いかなる状況でも他の言語に切り替えないでください。",
      "fr-FR": "【RÈGLE LINGUISTIQUE STRICTE】Vous devez impérativement répondre en français à tout moment. Cela inclut tous les raisonnements, réflexions approfondies, étapes d'analyse et réponses finales. Ne passez à aucune autre langue, quelles que soient les circonstances.",
      "es-ES": "【REGLA DE IDIOMA ESTRICTA】Debe responder exclusivamente en español en todo momento. Esto incluye todos los procesos de razonamiento, pensamientos profundos, pasos de análisis y respuestas finales. No cambie a ningún otro idioma bajo ninguna circunstancia.",
    };
    const instr = langInstr[preferredLanguage];
    if (instr) parts.push(instr);

    // 英语地区特化版本：注入各变体专属适应指令（含具体差异说明）
    if (preferredLanguage.startsWith("en-") && preferredLanguage !== "en-US") {
      const regionalInstr: Record<string, string> = {
        "en-GB": `【BRITISH ENGLISH ADAPTATION】You have been configured for British English (en-GB). You MUST follow these British conventions precisely:

**Spelling:**
- Use -our (colour, flavour, honour, behaviour) — NEVER color, flavor, honor
- Use -re (centre, theatre, metre, litre) — NEVER center, theater
- Use -ise/-isation (realise, organise, recognise, organisation, globalisation) — realize/organize/globalization are American
- Use -t (learnt, dreamt, burnt, spelt) — learned/dreamed/burned/spelled are American
- Double L in derivatives (travelled, labelled, cancelling, modelling) — traveled/labeled/canceling are American
- Use defence, offence, licence (noun), practice (noun) — defense, offense, license are American
- Use programme (for TV/events) but program (for software)
- Use aluminium (NOT aluminum), grey (NOT gray)

**Vocabulary:**
- flat (NOT apartment), lift (NOT elevator), autumn (NOT fall), holiday (NOT vacation)
- torch (NOT flashlight), rubbish (NOT trash/garbage), boot (of car, NOT trunk), bonnet (NOT hood)
- chips (NOT fries), biscuit (NOT cookie), sweets (NOT candy), pudding (NOT dessert)
- football (NOT soccer), fortnight (NOT two weeks), queue (NOT line), cinema (NOT movie theater)
- trousers (NOT pants), trainers (NOT sneakers), nappy (NOT diaper), dummy (NOT pacifier)
- post (NOT mail), petrol (NOT gas/gasoline), mobile phone (NOT cell phone)
- solicitor / barrister (NOT lawyer generally), chemist (NOT pharmacy/drugstore)
- courgette (NOT zucchini), aubergine (NOT eggplant), coriander (NOT cilantro)

**Date & Time Format:**
- Dates: day/month/year — e.g. 21 June 2026 or 21/06/2026 (NEVER month/day/year)
- Time: 24-hour clock is widely used (e.g. 14:30), or 12-hour with dot (e.g. 2.30pm)
- Write "30 June" not "June 30" in running text

**Grammar & Style:**
- Use present perfect for recent actions: "I have just eaten" not "I just ate"
- Collective nouns can take singular or plural: "the team are playing" is common
- Use "shall" for first-person suggestions: "Shall we go?"
- Use "got" not "gotten" as past participle of get
- Single quotes (' ') are more common for quotations than double quotes
- Use "at the weekend" (NOT "on the weekend"), "in hospital" (NOT "in the hospital")`,

        "en-AU": `【AUSTRALIAN ENGLISH ADAPTATION】You have been configured for Australian English (en-AU). You MUST follow these Australian conventions precisely:

**Spelling:**
- Follow British English: -our (colour, flavour, honour), -re (centre, theatre), -ise (realise, organise)
- Double L (travelled, labelled) — same as British
- Use programme/program distinction same as British
- Use aluminium, grey, gaol (though jail is also accepted)

**Vocabulary:**
- Unique Australian terms: footy (football/rugby), arvo (afternoon), brekkie (breakfast), barbie (barbecue)
- bogan (uncouth person), esky (cooler/chiller), thongs (flip-flops), bathers/togs (swimsuit)
- servo (petrol station/gas station), bottle-o (bottle shop/liquor store), maccas (McDonald's)
- mate (friend, used very frequently), fair dinkum (genuine/real), no worries (you're welcome)
- Diminutives (-ie/-o suffix) are extremely common: postie (postman), tradie (tradesman), muso (musician), journo (journalist), garbo (garbage collector), smoko (smoke break)
- footpath (pavement/sidewalk), gumboots (wellingtons/waders), singlet (vest/tank top)
- capsicum (bell pepper), rocket (arugula), zucchini (same as American for this one)
- lolly (candy/sweet), bikkie (biscuit/cookie), chippies (potato chips)

**Date & Time Format:**
- Dates: day/month/year — e.g. 21 June 2026 or 21/06/2026
- Time: 24-hour clock common (e.g. 14:30)

**Grammar & Style:**
- Present perfect for recent events (same as British)
- Use "got" not "gotten"
- "heaps of" used frequently (meaning "a lot of")
- "as well" at end of sentences more common than "too"
- Frequent use of "aye" as question tag in some regions
- Casual register is more informal than British English`,

        "en-IN": `【INDIAN ENGLISH ADAPTATION】You have been configured for Indian English (en-IN). You MUST follow these Indian English conventions precisely:

**Spelling:**
- Follow British English: -our (colour, flavour, honour), -re (centre, theatre), -ise (realise, organise)

**Vocabulary (distinctive Indian usages):**
- prepone (to reschedule to an earlier time — opposite of postpone)
- do the needful / do the needful and oblige / kindly do the needful (please take the necessary action)
- revert back (meaning "reply back" or "get back to someone")
- pass out (meaning "graduate" — "she passed out of university in 2024")
- cousin brother / cousin sister (for male/female cousin respectively)
- meet (an arranged marriage introduction meeting between families)
- out of station (out of town / away from one's usual place of work/residence)
- timepass (something done to pass time/idle activity)
- also (used as "and also/too" more frequently than in other variants)
- the same / the said (used in formal writing as: "please revert on the same")
- kindly adjust / adjust (make do with what is available)
- updation (update as a noun — "the updation of records")
- under the same (a phrase used in billing: "under the same head")
- would be (used more broadly for future tense: "the meeting would be held")
- only / itself (used for emphasis: "I came only yesterday", "he himself came")
- what is your good name? (formal: what is your name?)
- rubber (eraser), tiffin (lunch box), hotel (can mean restaurant)
- dress (can mean clothing in general, not just a formal dress)

**Date & Time Format:**
- Dates: day/month/year — e.g. 21 June 2026 or 21/06/2026
- Time: 12-hour clock common with am/pm
- IST (Indian Standard Time, UTC+5:30) is the reference timezone

**Grammar & Style:**
- Present continuous tense is used more broadly: "I am understanding it now", "I am having a car"
- "Isn't it?" used as a universal tag question regardless of main verb: "You went there, isn't it?"
- Use of "would" where other varieties use "will": "I would be going to the market"
- Formal register is more verbose and polite than other English varieties
- "I am having" used where other dialects use "I have"`,
      };
      const ri = regionalInstr[preferredLanguage];
      if (ri) parts.push(ri);
    }
  } else {
    console.warn("[agentEngine] preferredLanguage is empty/falsy, no language instruction injected");
  }

  // ═══════════════════════════════════════════════════════════
  // 工作区上下文注入（Yolo 模式专用）
  // ═══════════════════════════════════════════════════════════
  if (workspacePath) {
    parts.push(`## 当前工作区

你正在处理的工作区路径是：\`${workspacePath}\`

当你需要搜索项目文件（\`search_in_project\`）、分析项目结构（\`get_project_review\`）、执行命令（\`execute_command\`）或浏览文件（\`read_from_files\`）时，可以在此工作区路径下操作。如果用户指定了其他路径，优先使用用户指定的路径。`);
  }

  // ═══════════════════════════════════════════════════════════
  // 第 1 部分：Unicoda 基础角色设定（所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  parts.push(`# Unicoda 基础角色设定

你正在 **Unicoda** 中运行——一个模块化 AI 助手平台。你扮演的是用户贴心的 AI 伙伴与效率助手。
你的全名就是"Unicoda"，用户通过 Unicoda 客户端与你对话。`);

  // ═══════════════════════════════════════════════════════════
  // Agent / Chat 模式模组系统
  // Agent：注入全部模组 + 完整协议 + 场景判断
  // Chat：  仅注入普通模组 + 简化调用协议
  // ═══════════════════════════════════════════════════════════
  const relevantMods = getModulesForMode(getAllModules(), mode, panelMode);

  if (relevantMods.length > 0) {
    if (mode === "Agent") {
      // ── Agent 模式：完整模组介绍 ──
      parts.push(`## 模组系统（Modules）

Unicoda 为你配备了"模组（Module）"系统——预构建的功能扩展单元，让你可以执行超越语言模型自身能力的操作。

### 什么是模组？

模组是 Unicoda 平台提供的功能扩展，每个模组封装了一个独立的能力（如联网搜索）并通过标准化的接口供你调用。模组的执行由 Unicoda 客户端在本地完成，结果会以文本形式返回给你。

### 工作流程

当你遇到需要外部信息或功能才能回答的问题时，应当使用模组。完整的交互流程如下：

1. 你判断需要调用模组 → 输出 \`<tool_call>\` 标记块
2. Unicoda 客户端收到标记 → 执行对应模组 → 将结果以"工具结果"消息返回给你
3. 你阅读工具结果 → 结合结果生成最终回复给用户

### 多次与并行调用

Unicoda 支持两种多次调用方式：

- **并行调用**：如果多个搜索相互独立（如需要搜索不同关键词或不同维度），可以在**同一次回复**中输出多个 \`<tool_call>\` 块。它们会被并行执行，所有结果会一起返回给你。这样效率最高。

- **串行调用**：如果第一次搜索结果不理想或需要根据结果决定下一步搜索，可以先输出一轮 \`<tool_call>\`，等到工具结果返回后，再根据结果发起新一轮调用。最多可以进行 5 轮工具调用。`);
    } else {
      // ── Chat 模式：精简模组介绍 ──
      parts.push(`## 轻量模组（Lightweight Modules）

Unicoda 为你提供了一些可选的轻量功能扩展，可以在需要时使用：

1. 当用户的问题需要外部实时信息（如新闻、天气、最新的数据等）时，**你可以选择**使用 \`<tool_call>\` 调用模组来获取信息
2. 在回复中输出 \`<tool_call>\` 标记，Unicoda 会执行该模组并将结果以工具消息的形式返回给你
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

#### 中文搜索（默认语言）
如果用户问"今天有什么科技新闻？"，你可以这样调用：

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

> \`language\` 参数默认为 \`"zh-CN"\`，中文查询无需显式指定。若需要更精确的语义分词（如搜索中文复合词），也可显式传入。

#### 英文搜索（显式指定语言）
如果用户用英文提问，使用 \`"en-US"\` 获取英文优先的结果：

\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": {
    "query": "AI breakthrough 2026",
    "count": "5",
    "language": "en-US"
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

    // ── fetch_page 和 summary_page 调用示例（两种模式共享） ──
    parts.push(`#### 打开网页获取详细内容
如果搜索结果中的摘要信息不足以回答问题，可以打开具体文章获取完整内容：

\`\`\`
<tool_call>
{
  "id": "fetch_page",
  "params": {
    "url": "https://example.com/article"
  }
}
</tool_call>
\`\`\`

\`fetch_page\` 会返回清洗后的纯文本（去除广告导航），默认最多返回 8000 字符。

#### 总结网页内容
如果搜索结果中的文章篇幅较长，需要快速了解核心要点，可以使用 \`summary_page\`：

\`\`\`
<tool_call>
{
  "id": "summary_page",
  "params": {
    "url": "https://example.com/long-article"
  }
}
</tool_call>
\`\`\`

\`summary_page\` 会先获取网页内容，再用 AI 自动生成多角度摘要（一句话主旨 + 3～5 要点）。注意：这会消耗一次 API 调用。

### 搭配使用示例（搜索 → 打开页面）
如果用户问"华为韬定律具体有什么技术细节？"：

\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": { "query": "华为 韬定律 技术细节", "count": 5 }
}
</tool_call>
\`\`\`

搜索返回摘要后，如果某条结果摘要太短，可以再调用 \`fetch_page\` 打开具体链接：

\`\`\`
<tool_call>
{
  "id": "fetch_page",
  "params": { "url": "https://www.huawei.com/cn/news/..." }
}
</tool_call>
\`\`\``);

    // ── 读取文件调用示例 ──
    parts.push(`#### 读取本地文件
如果用户询问本地文件、浏览目录、查看或读取某个文件的内容，调用 \`read_from_files\`：

\`\`\`
<tool_call>
{
  "id": "read_from_files",
  "params": {
    "action": "list_dir",
    "path": "~/Desktop"
  }
}
</tool_call>
\`\`\`

**支持的动作（\`action\` 参数）：**
- \`pwd\` — 显示当前工作目录路径
- \`cd\` — 切换到指定目录（通过 \`path\` 参数指定目标）
- \`list_dir\` — 列出目录内容（\`path\` 可选，默认当前目录）
- \`read_file\` — 读取文本文件内容（通过 \`path\` + \`maxChars\` 指定）
- \`get_info\` — 获取文件/路径的元信息（是否存在、类型、大小等）

> \`path\` 支持绝对路径（\`C:\\\\Users\\\\Name\`）、相对路径、\`~\`（用户主目录）三种格式。
> 文件读取默认最多返回 50000 字符，可通过 \`maxChars\` 参数调整。`);

    // ── 搜索 vs 打开页面 vs 总结页面 选择指引（两种模式共享） ──
    parts.push(`## 模组选择指南

当用户的问题需要外部信息时，按以下优先级选择模组：

1. **\`web_search\`**：先搜索，获取多个来源的摘要
   - **查询金融数据（股价/市值/财报）时，必须使用英文关键词 + en-US**，中文搜索会被官网结果淹没
2. **\`fetch_page\`**：打开具体链接获取完整原文
   - 适用于：摘要只有一两句话但用户需要深入了解、需要验证数据或引用的原始上下文
   - **当用户明确说"帮我看看XX内容"、"XX原文是怎么说的"、"打开XX链接"时，直接使用此模组**，不需要先判断"摘要是否够用"
   - ⚠️ **不适用于金融/股票实时数据网站（雪球、东方财富等）**，这些站点通过 JS 动态渲染股价数据，且有 WAF 反爬保护，本模组无法获取有效数据
3. **\`summary_page\`**：搜索结果是长篇文章，需要快速了解核心观点时使用
   - 适用于：新闻报道、分析报告、百科条目的要点提炼
   - 需在搜索结果已经返回后再调用此模组
4. **\`read_from_files\`**：用户想浏览目录结构、查看或读取某个文件时使用
   - 适用于：用户问"看看我的桌面有什么"、"当前在什么路径"、"进入某个目录"
   - 用户问"当前目录有什么文件"时，先用 \`pwd\` 获取当前路径，再调用 \`list_dir\`
   - 用户说"读取/查看某个文件"时，调用 \`read_file\`

5. **\`search_file\`**：在本地文件系统中按文件名搜索文件
   - 适用于：用户问"帮我找找某个游戏/文件/安装包在哪"、"XX文件放在哪了"、"找不到XX"
   - 支持 glob 通配符（* 任意字符、? 单个字符），如 \`search_file(pattern="*游戏名*", path="D:\\")\`
   - 自动跳过隐藏目录和系统目录
   - **与 read_from_files 的区别**：用户给出明确的文件名/关键词线索时应优先用 \`search_file\`（如"找一下SanobaWitch"、"有没有一个叫Report的PDF"）；只有用户想看目录结构时（"看看桌面上有什么"）才用 \`read_from_files list_dir\`
   - **搜不到时换姿势重试**：如果第一次搜索结果不理想（没有结果），换用不同拼写/大小写/关键词的 pattern 再次搜索，甚至换一个目录搜索

6. **\`search_in_project\`**：在本地项目中搜索文件名或文件内容
   - 适用于：搜索函数定义、变量引用、TODO 标记、导入语句
   - 用户说"帮我找找项目中哪里用到了XXX"、"搜索XXX关键词"时调用
   - 支持 \`pattern\` 参数筛选文件类型（如 \`"*.ts"\` 只搜索 TypeScript 文件）

6. **\`get_project_review\`**：分析项目整体结构
   - 适用于：了解新项目的技术栈、查看项目架构、分析代码库结构
   - 用户说"帮我看看这个项目是做什么的"、"分析一下项目结构"时调用
   - 会读取关键配置文件（package.json、Cargo.toml 等）并展示目录树`);

    // ── 调用规则（两种模式共享） ──
    parts.push(`## 调用规则

1. **并行调用**：多个 \`<tool_call>\` 块可以在同一次回复中输出，它们会被**并行执行**。
2. 模组执行结果会以 \`role: "tool"\` 的消息形式返回，注意识别每个结果对应的工具 ID。

### 🚨 关键规则：如果决定调用工具，回复必须以 \`<tool_call>\` 开头

当你判断需要调用工具时，你的回复**必须以 \`<tool_call>\` 标签开头**，不允许在调用工具之前先输出任何对话文本。

**正确做法：**
\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": { "query": "今天 科技 新闻", "count": "5" }
}
</tool_call>
\`\`\`
→ 等待工具结果返回后，再基于结果生成完整的面向用户的回复。

**❌ 错误做法（千万避免）：**
\`\`\`
好的，我来搜索一下今天的科技新闻！
<tool_call>
{
  "id": "web_search",
  "params": { "query": "今天 科技 新闻", "count": "5" }
}
</tool_call>
\`\`\`
→ 这种格式中先输出了对话文本，\`<tool_call>\` 标签虽然也在回复中，但混在文本中容易被模型遗漏或忘记输出。**如果你先输出了一句话，模型的惯性会让你继续输出更多文本而不是转到 \`<tool_call>\`。记住：只要你在心中决定了要调用工具，你的第一个输出字符就应该是 \`<\`。**

**❌ 另一个常见错误：**
\`\`\`
好的，让我来看看这个目录里有什么！
\`\`\`
→ 这种回复中完全没有 \`<tool_call>\` 标签，工具永远不会被调用，用户会看到你在"口头答应"但什么都没做。

**如何判断你已经在回复中包含了 \`<tool_call>\`？**
如果你在思考过程中已经决定"我需要调用XX模组"、"我需要搜索"、"我需要查看目录"，**那么你的回复必须包含 \`<tool_call>\` 标签。** 检查一下：你的回复中是否有 \`<tool_call>\` 开头？如果没有，说明你正在输出"空头支票"——用户只会看到承诺，看不到实际行动。`);
  }

  // ═══════════════════════════════════════════════════════════
  // Agent 模式专用：任务计划模式
  // ═══════════════════════════════════════════════════════════
  if (mode === "Agent") {
    parts.push(`## 🗺️ 任务计划模式（Task Planning Mode）

对于需要**多个步骤**的复杂任务（如先搜索再打开网页、多维度搜索、文件定位+分析、逐级目录探索等），你应当使用**任务计划模式**来避免执行中的自我质疑和反复。

### 何时使用任务计划模式

当用户请求涉及以下场景时，使用 \`<task_plan>\` 代替多个独立的 \`<tool_call>\`：

1. **多步文件定位**：用户找文件但不记得确切路径 → 需要逐级查看多个目录
2. **组合搜索**：用户需要多个维度的信息 → 需要多个搜索词或多个工具
3. **搜索+分析**：先搜索获取信息，再打开页面深入阅读
4. **目录探索**：用户想看看某个位置有什么文件，需要逐级深入
5. **任何需要 2 步以上的任务**

**对于只需要一步工具的简单任务**：仍然使用 \`<tool_call>\`，无需任务计划。

### 输出格式

在回复中输出一个 \`<task_plan>\` XML 标记块，格式如下：

\`\`\`
<task_plan>
{
  "intent": "简要描述用户意图",
  "feasibility": "可行性分析：需要哪些工具、可能的挑战",
  "steps": [
    {
      "id": "step-1",
      "tool": "模块ID",
      "params": { "参数名": "参数值" },
      "description": "本步骤的目的说明"
    },
    {
      "id": "step-2",
      "tool": "模块ID",
      "params": { "参数名": "参数值" },
      "description": "本步骤的目的说明"
    }
  ]
}
</task_plan>
\`\`\`

### 执行规则

- **输出 \`<task_plan>\` 后不要输出其他文本**，框架会自动执行所有步骤
- 计划中的所有步骤会按顺序**依次执行**
- 所有步骤的结果会**一起返回**给你
- 你只需阅读汇总结果后生成最终回复——**中间不需要你干预**
- **计划执行完成后，框架会注入一条"禁止新工具调用"的强制指令。你必须严格遵守该指令，只生成最终回复，不得输出任何新的 \`<tool_call>\` 或 \`<task_plan>\`。**
- **如果你在最终回复时仍然想"我再搜搜看"、"再确认一下"——不要这么做。所有搜索已在计划中完成，基于已有结果回答即可。**

### 🎯 制定计划前必须核对用户原始意图

在制定任务计划之前，你必须先**仔细阅读并理解用户的最新一条消息**，确认用户真正要做什么。

**常见错误（必须避免）：**
- ❌ 用户说"帮我找 RiddleJoker" → 你计划里写的是"查找 Sanoba Witch"
- ❌ 用户说"在 G 盘找" → 你计划里写的是"查看 C 盘桌面"
- ❌ 用户说"是什么颜色" → 你计划里计划去搜价格

**正确做法：**
- 在 intent 字段中**直接引用用户原话**，如："用户想找 G 盘上的 RiddleJoker 游戏"
- 如果用户提到了多个信息，**全部检查是否都包含在计划中**，不要遗漏
- 如果用户的问题中有任何不确定的细节，在你的 feasibility 中注明你的假设

### 与传统 tool_call 的区别

| 场景 | 使用 |
|------|------|
| 只需要一个工具调用 | \`<tool_call>\`（简单快速） |
| 需要 2 个以上串联工具调用 | \`<task_plan>\`（避免自我质疑） |
| 不确定需要几步 | \`<task_plan>\`（框架会处理所有步骤） |

### 实际示例

**文件查找**：
\`\`\`
<task_plan>
{
  "intent": "在G盘查找RiddleJoker游戏文件位置",
  "feasibility": "RiddleJoker是Yuzusoft开发的视觉小说，Steam发行，可能在SteamLibrary或games目录下",
  "steps": [
    {
      "id": "step-1",
      "tool": "read_from_files",
      "params": {"action": "list_dir", "path": "G:\\\\SteamLibrary\\\\steamapps\\\\common\\\\"},
      "description": "查看Steam游戏库目录中是否有RiddleJoker"
    },
    {
      "id": "step-2",
      "tool": "read_from_files",
      "params": {"action": "list_dir", "path": "G:\\\\games\\\\"},
      "description": "查看games目录"
    }
  ]
}
</task_plan>
\`\`\`

**组合搜索**：
\`\`\`
<task_plan>
{
  "intent": "获取Sony PlayStation最新消息和发布会时间",
  "feasibility": "需要中英文两个维度搜索PlayStation相关消息",
  "steps": [
    {
      "id": "step-1",
      "tool": "web_search",
      "params": {"query": "PlayStation 最新消息 发布会", "count": "5", "language": "zh-CN"},
      "description": "中文搜索PlayStation最新消息"
    },
    {
      "id": "step-2",
      "tool": "web_search",
      "params": {"query": "Sony PlayStation State of Play 2026", "count": "5", "language": "en-US"},
      "description": "英文搜索PlayStation发布会信息"
    }
  ]
}
</task_plan>
\`\`\``);

  // ═══════════════════════════════════════════════════════════
  // Agent 模式专用：场景判断 + 搜索关键词指南
  // ═══════════════════════════════════════════════════════════
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
- **用户询问 Unicoda 自身功能**（界面按钮、面板、设置项等）——这些信息已在本提示词的知识库章节中提供，直接回答即可，不要联网搜索

### 📂 search_file vs read_from_files 选择规则

当用户问题涉及**本地文件系统**时，根据用户意图选择：**如果用户要找具体文件/游戏/安装包，先用 \`search_file\`（支持通配符，快）；如果用户想看目录结构，用 \`read_from_files\`**。

| 用户意图 | 优先使用 | 说明 |
|----------|----------|------|
| "帮我找找XX游戏/文件在哪"、"找不到XX"、"XX放哪了" | **\`search_file\`** | 用 glob 通配符按文件名搜索 |
| "看看这个目录下有什么"、"列出文件"、"进入文件夹" | **\`read_from_files list_dir/cd\`** | 浏览目录结构 |
| "帮我打开/读取/查看某个文件" | **\`read_from_files read_file\`** | 读取文件内容 |
| 不确定文件在哪、不知道具体目录 | **先 \`search_file\`** | 用多个 pattern 并行搜索，比如同时 "*游戏名*"、"*sanoba*"、"*Witch*" |

**\`search_file\` 使用要点：**
- pattern 支持 glob 通配符：\`*\` 匹配任意字符，\`?\` 匹配单个字符
- **如果搜索结果为空，换用不同拼写/大小写再搜一次**（比如没搜到 "SanobaWitch" 就试试 "*Witch*" 或 "*sanoba*"）
- **多个不同粒度的 pattern 可以并行搜索**，在同一轮回复中输出多个 \`<tool_call>\` 块
- 默认不区分大小写，设为 \`caseSensitive: "true"\` 可启用区分

> **示例**：用户说"帮我找找SanobaWitch游戏在哪" → 并行调用：\`search_file(pattern="*Sanoba*", path="G:\\")\`、\`search_file(pattern="*Witch*", path="G:\\")\`，比用 \`read_from_files\` 逐个目录遍历快得多。

### 🚫 绝对不要做的事

1. **当用户问的是本地文件/目录相关的问题时，绝对不要联网搜索（web_search）**。
   - 本地文件的路径、游戏安装位置、项目目录结构——这些东西无法通过互联网搜索得到
   - 例如，用户问"我的RiddleJoker游戏在哪"、"帮我看看桌面有什么"——这是本地文件操作，调用 web_search 毫无意义
   - **规则**：如果问题明确涉及用户本地硬盘上的文件/目录/游戏/项目，请使用 search_file（找具体文件）或 read_from_files（看目录结构），不要先尝试 web_search

2. **绝对不要 dump 整个盘符根目录（如 list_dir("G:\\"）或 list_dir("C:\\"）**。
   - 如果用户说"在G盘"，你应该根据用户描述推断最可能的几个子目录（如 SteamLibrary、games、Download 等），只查看这些目录
   - 除非用户明确说"列出G盘根目录的所有内容"，否则不要查看盘符根级别
   - 这条规则没有例外

3. **list_dir 的输出必须归纳总结后呈现给用户**，不要直接 dump 原始数据。
   - ❌ "G:\\ 共有 206 个条目：$RECYCLE.BIN、123pan、5e、5EDemocache、7zip、..."
   - ✅ "G 盘根目录下，与游戏相关的有这几个目录：games（46 个游戏）、SteamLibrary（Steam 游戏库）"
   - 只列出关键类别/文件夹名和数量即可

### 💡 最佳实践

- 优先主动判断是否需要联网，不要等待用户明确要求"搜索一下"
- 如果搜索结果不理想，尝试不同的搜索词再次搜索

### 🔑 搜索关键词构造指南

搜索词质量直接决定搜索结果的好坏。请严格遵循以下规则：

**🔴 黄金法则一：先决定语言和市场，再构造关键词**

搜索的第一步永远不是写关键词——而是判断**用什么语言搜索**。语言选择不当，再好的关键词也无法返回正确结果。

| 查询类型 | 应选语言 | 原因 |
|----------|----------|------|
| 中文资讯、百科、天气(中国) | \`"zh-CN"\` | 中文语义分词最准确 |
| 英文技术文档、国际新闻 | \`"en-US"\` | 英文内容优先排序 |
| **🔴 公司市值、股价、股票、金融数据** | **\`"en-US"\` + 英文关键词** | ⚠️ 中文搜索公司+市值/股价时，Bing会优先返回公司官网而非金融数据 |
| 英文产品/公司 + 中文评测 | 两者均可，优先\`"en-US"\`获取产品信息 | 如有需要可补中文搜索 |

**规则 1：公司市值/股价/股票类查询 —— 必须用英文**
- ⚠️ **这是最容易踩坑的场景。中文搜索"英伟达 市值"必定返回英伟达官网，因为Bing的实体匹配优先于关键词匹配。**
- ✅ **正确做法：公司英文名 + 金融专有词汇（market cap / stock price / share price）+ \`"language": "en-US"\`**
- ❌ \`"query": "英伟达 最新市值"  language: "zh-CN"\` → ❌ 全被官网结果占据
- ✅ \`"query": "NVIDIA market cap June 2026"  language: "en-US"\` → ✅ 返回Yahoo Finance / MarketWatch等金融数据
- ✅ \`"query": "NVDA stock price today"  language: "en-US"\`
- ✅ 并行搜索：\`"NVIDIA market cap" (en-US)\` + \`"NVDA 市值 2026" (zh-CN)\`（英文查金融数据，中文补查中文金融网站）
- **任何涉及"多少钱"、"多少市值"、"股价"、"股票"、"涨了/跌了"、"市净率"、"市盈率"、"财报"的查询，一律沿用以上规则。**
- ⚠️ **切勿对雪球、东方财富等金融数据站使用 \`fetch_page\`**：这些站点的股价/市值通过JS动态渲染且有WAF反爬，\`fetch_page\` 拿到的只是占位符或验证页面。应改用 \`web_search\` 搜索财经新闻报道来获取市值数据。**如果 \`web_search\` 搜索结果已包含市值信息，直接使用，不要多此一举再尝试 \`fetch_page\`。**

**规则 2：提取核心实体 + 限定词，不要复制用户原文**
- ❌ 错误：\`"伊朗沙特 北京和解 2023 全面介绍"\`（太长、口语化）
- ✅ 正确：\`"伊朗 沙特 北京 和解 2023"\`（提取关键实体词，空格分隔）

**规则 3：去掉冗余的概括性词汇**
- 去掉：介绍、全面、关于、请问、我想了解、详细说明、具体情况、最新消息、新闻
- 只保留：核心名词、专有名词、限定年份/日期、关键动词

**规则 4：对于中文搜索，优先使用简洁的短语而非完整句子**
- ❌ \`"今天比特币价格是多少"\` → ✅ \`"比特币 价格 2026"\` 或 \`"BTC 价格"\`
- ❌ \`"马斯克最近在推特上说了什么"\` → ✅ \`"Elon Musk Twitter 最新"\`
- ❌ \`"帮我查一下明天北京的天气"\` → ✅ \`"北京 天气 明天"\`
- ❌ \`"特朗普名下有多少庄园"\` → ✅ \`"特朗普 庄园 地产"\`
- ⚠️ **重要：中文专有名词（人名/地名）容易被搜索引擎拆成单字匹配**。例如"特朗普"可能被拆为"特"+"朗普"，查到的全是不相关的中文字典内容。**务必使用双引号包裹专有名词**来强制精确匹配。

**规则 5：如果用户的问题涉及多个维度，可以拆成多个并行搜索词**
- 例如："AI 和新能源的最新进展" → 并行搜索 \`"AI 人工智能 2026 进展"\` + \`"新能源 技术 突破 2026"\`

**规则 6：优先使用搜索效果更好的关键词组合**
- 专有名词优先用原名而非翻译（如 \`Elon Musk\` 优于 \`马斯克\`）
- **善用双引号限定精确匹配**：
  - 中文人名/地名必须加引号：\`"特朗普" 庄园\`、\`"北京市"\`、\`"马云"\`
  - 长复合词默认加引号：\`"胡萝卜" 百科\`（防止"胡萝卜"被拆成"胡"+"萝卜"）
  - 英文短语模糊匹配时不加引号，精确检索时加引号

**规则 7：如果搜索结果不理想（如被无关官网占据），换用新策略再搜**
- 如果发现结果全是公司官网而非你想要的数据，立即换用英文搜索 + 金融专有词
- web_search模组支持 \`excludeSites\` 参数排除特定域名（如 \`"excludeSites": "nvidia.cn"\`），可在必要时使用

\``);
  }

  // ═══════════════════════════════════════════════════════════
  // 预装填知识库（所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  const kbSection = buildKnowledgeSection(kbMode, preferredLanguage);
  if (kbSection) parts.push(kbSection);

  // ═══════════════════════════════════════════════════════════
  // 用户自定义提示词（可选，所有模式均注入）
  // ═══════════════════════════════════════════════════════════
  if (customPrompt) {
    parts.push(`## 附加指令\n\n${customPrompt}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 末尾语言提醒（简短强化，完整指令已在开头给出）
  // ═══════════════════════════════════════════════════════════
  if (preferredLanguage) {
    const langReminder: Record<string, string> = {
      "zh-CN": "【重申】你必须使用汉语（中文）。",
      "en-US": "【REMINDER】You must output in English (en-US).",
      "en-GB": "【REMINDER】You must output in British English (en-GB) following the spelling, vocabulary, and date conventions listed above.",
      "en-AU": "【REMINDER】You must output in Australian English (en-AU) following the distinctive vocabulary, spellings, and tones listed above.",
      "en-IN": "【REMINDER】You must output in Indian English (en-IN) following the specific vocabulary and grammar conventions listed above.",
      "de-DE": "【WIEDERHOLUNG】Sie müssen auf Deutsch antworten.",
      "ja-JP": "【再確認】日本語で出力する必要があります。",
      "fr-FR": "【RAPPEL】Vous devez répondre en français.",
      "es-ES": "【RECORDATORIO】Debe responder en español.",
    };
    const reminder = langReminder[preferredLanguage];
    if (reminder) parts.push(reminder);
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
 * 从文本中移除 <tool_call> 块（完整或部分标签），返回干净的回复内容。
 * 流式传输期间会收到不完整的标签（如 `<tool_c`），也需要移除。
 * 同时移除 <task_plan> 块。
 */
export function stripToolCalls(text: string): string {
  // 先移除完整的 <tool_call>...</tool_call> 块
  let result = text.replace(TOOL_CALL_RE, "").trim();
  // 再移除流式传输中不完整/部分的 <tool_call 标签（从匹配位置到末尾）
  const partialIdx = result.indexOf("<tool_call");
  if (partialIdx !== -1) {
    result = result.substring(0, partialIdx).trim();
  }
  // 移除 <task_plan> 块（完整或部分）
  result = result.replace(/<task_plan>[\s\S]*?<\/task_plan>/g, "").trim();
  const planPartialIdx = result.indexOf("<task_plan");
  if (planPartialIdx !== -1) {
    result = result.substring(0, planPartialIdx).trim();
  }
  return result;
}

// ─── 任务计划系统 Prompt ───────────────────────────────

/**
 * 构建任务计划系统提示词。
 * 与完整系统提示词不同，planner 的 ONLY 职责是输出 <task_plan> 块。
 * 不包含语言指令、身份认知、示例对话等非必要内容。
 */
export function buildPlannerSystemPrompt(
  mode: Mode,
  panelMode?: PanelMode,
): string {
  const relevantMods = getModulesForMode(getAllModules(), mode, panelMode);
  const parts: string[] = [];

  parts.push(`# Unicoda 任务计划生成器

你正在 Unicoda 的任务计划生成器中运行。你的**唯一职责**是分析用户问题，输出一个完整的执行计划。

## 输出格式限制

**你只能输出一个 <task_plan> XML 块。** 不得包含任何其他文本、解释、问候语或分析。

\`\`\`
<task_plan>
{
  "intent": "用一句话描述用户的目标，直接引用用户原话",
  "feasibility": "分析需要哪些工具、可能的挑战和假设",
  "steps": [
    {
      "id": "step-1",
      "tool": "模块ID",
      "params": { "参数名": "参数值" },
      "description": "本步骤的目的说明"
    }
  ]
}
</task_plan>
\`\`\`

## 严格规则

1. **输出必须以 <task_plan> 开头，以 </task_plan> 结尾**。中间是 JSON 格式的计划。
2. **不得输出任何 <task_plan> 之外的文本**——不要问候、不要解释、不要额外句子。
3. **intent 字段必须直接引用用户原话或准确概括用户核心需求**。
4. **steps 数组中的每个步骤必须有唯一的 id 和 tool 字段**，params 和 description 可选但强烈推荐。
5. **如果用户的问题很简单（不需要任何工具调用），输出 steps: [] 的空计划**。
6. **步骤之间要考虑依赖关系**——如果步骤 B 需要步骤 A 的结果，确保 A 排在 B 前面。
7. **如果是文件查找任务（找具体游戏/文件/安装包），优先使用 search_file**（支持通配符模式如 "*游戏名*"），不要用 web_search。
8. **不要 dump 盘符根目录**，优先查看具体子目录。

## 可用工具\n\n`);

  const toolDocs = relevantMods.map((mod) => {
    return [
      `### ${mod.name}（\`${mod.id}\`）`,
      ``,
      `${mod.description}${formatModuleParamsDoc(mod.parameters)}`,
    ].join("\n");
  });
  parts.push(toolDocs.join("\n\n---\n\n"));

  parts.push(`## 制定计划前必读

1. 仔细阅读用户的**最新一条消息**，确认用户真正要做什么。
2. 分析用户问题涉及的场景：是文件查找、信息搜索、代码分析，还是简单对话？
3. 如果涉及文件操作：找具体文件/游戏/安装包优先用 **search_file**；看目录结构用 **read_from_files**。
4. 如果涉及查询外部信息，优先使用 web_search。
5. **如果用户问的是本地文件/目录相关问题，不要在计划中使用 web_search**——本地文件信息无法通过网络搜索得到。
6. **对于简单聊天、通用知识问答等不需要工具的场景，输出 steps: [] 的空计划**。
7. **如果用户问题只需要一个简单的工具调用（如查天气、搜新闻），创建一个包含单一步骤的计划**`);

  return parts.join("\n");
}

// ─── Tool Call 执行 ───────────────────────────────────

/**
 * 执行单个 tool call，返回结果。
 * @param modelConfig 可选，当前模型配置，summary_page 模组需要它来调用 LLM 做摘要
 */
export async function executeToolCall(
  call: ToolCall,
  signal?: AbortSignal,
  modelConfig?: Pick<ModelConfig, "apiKey" | "modelName" | "baseUrl" | "provider">,
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

  // 对于 summary_page 模组，注入模型配置以便内部调用 LLM
  const params = { ...call.params };
  if ((call.id === "summary_page" || call.id === "check_api_balance") && modelConfig) {
    params._modelApiKey = modelConfig.apiKey;
    params._modelName = modelConfig.modelName;
    params._modelBaseUrl = modelConfig.baseUrl || "";
    params._modelProvider = modelConfig.provider;
  }

  let content = "";
  try {
    for await (const chunk of mod.execute(params, signal)) {
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
