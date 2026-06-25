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
  /** 发送方标识，security 用于 Unicoda Security 拦截消息 */
  sender?: "framework" | "security";
}

// ─── Agent 系统提示词 ─────────────────────────────────

// ══════════════════════════════════════════════════════════
// 三层缓存（Token 优化：避免每次全量重建 System Prompt）
// ══════════════════════════════════════════════════════════
interface StaticLayerKey {
  mode: Mode;
  preferredLanguage?: string;
  workspacePath?: string;
  panelMode?: PanelMode;
}

interface QuasiStaticLayerKey {
  mode: Mode;
  kbMode?: KnowledgeMode;
  customPrompt?: string;
  panelMode?: PanelMode;
}

let staticLayerCache: { key: string; value: string } | null = null;
let quasiStaticLayerCache: { key: string; value: string } | null = null;

function buildStaticLayerKey(params: StaticLayerKey): string {
  // 使用 JSON 序列化作为缓存 key，避免深层比较
  return JSON.stringify({ mode: params.mode, lang: params.preferredLanguage, ws: params.workspacePath, panel: params.panelMode });
}

function buildQuasiStaticLayerKey(params: QuasiStaticLayerKey): string {
  return JSON.stringify({ mode: params.mode, kb: params.kbMode, cp: params.customPrompt, panel: params.panelMode });
}

/**
 * 当用户编辑模块/知识库/自定义提示词时，调用此函数强制重置准静态层缓存。
 */
export function invalidateQuasiStaticCache(): void {
  quasiStaticLayerCache = null;
  console.log('[agentEngine] 准静态层缓存已失效');
}

/**
 * 当用户切换 mode/语言/工作区/面板时，调用此函数重置所有缓存。
 */
export function invalidateAllCaches(): void {
  staticLayerCache = null;
  quasiStaticLayerCache = null;
  console.log('[agentEngine] 所有缓存已失效');
}
// ══════════════════════════════════════════════════════════

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

// ─── 三层缓存：静态层 ──────────────────────────────────────────
// 包含：语言指令 + 角色设定 + 工作区上下文 + 输出格式
// 这些内容在会话间不变（除非用户切换 mode/语言/工作区）

function buildStaticLayer(
  mode: Mode,
  preferredLanguage?: PreferredLanguage,
  workspacePath?: string,
  panelMode?: PanelMode,
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
你的全名就是"Unicoda"，用户通过 Unicoda 客户端与你对话。

## 角色灵活切换（自动应用规则）

**重要说明：** 上述"Unicoda 助手"只是默认身份，收到下方「预装填知识库」中的角色设定卡后必须自动覆盖。

### 自动应用规则

下方「预装填知识库」中的每一条内容都是用户**主动添加并启用**的。如果其中任何条目包含角色设定、人设描述、行为规范或对话风格限制，你**必须自动立即应用**这条角色设定，**无需向用户确认**。

例如：
- 若知识卡设定"你只会发出'哼唧'声"→ 你必须自动开始用"哼唧"回复
- 若知识卡设定"你是一个冷峻的侦探"→ 你必须自动切换为侦探语气

**你不需要问用户"是否要应用"——用户将其设为注入级知识卡并启用，本身就是明确的启用指令。**

### 多个角色卡冲突时的处理

如果你在预装填知识库中看到**多个互相矛盾的角色设定卡**（例如两张卡分别设定了完全不同的身份），此时可以先向用户确认："检测到多个角色设定，请问您希望使用哪一个？"

### 用户的后续指令优先

如果你已经应用了一张角色卡，但用户的后续消息明确要求你恢复默认身份或切换为其他角色，以用户的最新指令为准。`);

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
      "de-DE": "【WIEDERHOLUNG】Sie m\u00fcssen auf Deutsch antworten.",
      "ja-JP": "【再確認】日本語で出力する必要があります。",
      "fr-FR": "【RAPPEL】Vous devez répondre en français.",
      "es-ES": "【RECORDATORIO】Debe responder en español.",
    };
    const reminder = langReminder[preferredLanguage];
    if (reminder) parts.push(reminder);
  }

  // ═══════════════════════════════════════════════════════════
  // 末尾格式强调块（近因效应：模型最能记住最后的指令）
  // ═══════════════════════════════════════════════════════════
  parts.push(`## ⚠️ 输出格式强制指令（违反导致解析失败）

决定调用工具时：

**回复的首字符必须为 \`<\`**，禁止先输出任何对话文本：

❌ \`我先搜索一下...<tool_call>...\`
✅ \`<tool_call>{"id":"...","params":{...}}</tool_call>\`

输出 \`<tool_call>\` 后不得附带其他文本（解释/分析待结果返回后再输出）。`);

  return parts.join("\n\n");
}

// ─── 三层缓存：准静态层 ───────────────────────────────────────
// 包含：模块文档 + 任务计划 + 知识库 + 自定义提示词
// 这些内容在用户编辑模块/知识库/自定义提示词时才变化

function buildQuasiStaticLayer(
  mode: Mode,
  kbMode?: KnowledgeMode,
  customPrompt?: string,
  panelMode?: PanelMode,
  preferredLanguage?: PreferredLanguage,
): string {
  const parts: string[] = [];

  // ═══════════════════════════════════════════════════════════
  // Agent / Chat 模式模组系统
  // Agent：注入全部模组 + 完整协议 + 场景判断
  // Chat：  仅注入普通模组 + 简化调用协议
  // ═══════════════════════════════════════════════════════════
  let relevantMods = getModulesForMode(getAllModules(), mode, panelMode);

  // XMemory 权限控制（两级可见性）：
  // - 未绑定时：仅暴露浏览卡和创建卡的"发现"工具
  // - 已绑定时：暴露全部操作工具（颗粒 CRUD、卡片删改等）
  // bind_xmemory_card 不受此影响，始终可见
  const xmemoryBindingRequired = new Set([
    "delete_xmemory_card",
    "rename_xmemory_card",
    "create_xmemory_granule",
    "delete_xmemory_granule",
    "modify_xmemory_granule",
    "merge_xmemory_granules",
  ]);
  const xmemoryAlwaysVisible = new Set([
    "read_xmemory_cards",
    "create_xmemory_card",
    "find_xmemory_granule",
  ]);
  // 准静态层不做 XMemory 绑定判断，保留全部模组供动态层筛选

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

- **串行调用**：如果第一次搜索结果不理想或需要根据结果决定下一步搜索，可以先输出一轮 \`<tool_call>\`，等到工具结果返回后，再根据结果发起新一轮调用。最多可以进行 999 轮工具调用。`);
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

    parts.push(`## 可用模组

> ⚠️ **重要说明**：当你向用户介绍或提及模组时，请使用中文名称（如"写入文件"、"联网搜索"），而非英文 ID（如 \`write_to_file\`、\`web_search\`）。对于不太了解技术的用户，可以在中文名称后用一句话简单解释其作用，例如"写入文件——可以将内容保存到本地文件中"。

${toolDocs.join("\n\n---\n\n")}`);

    // ── 调用协议（两种模式共享） ──
    parts.push(`## 如何调用模组

在回复中输出 \`<tool_call>\` XML 标记块：

\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": { "query": "搜索关键词", "count": 5 }
}
</tool_call>
\`\`\`

- \`language\` 默认 \`"zh-CN"\`，英文搜索需显式设为 \`"en-US"\`
- **并行调用**：多个独立搜索可在同一次回复中输出多个 \`<tool_call>\` 块，同时执行
- **串行调用**：第一次结果不理想时，可再发一轮调用（最多 5 轮）`);

    // ── 打开网页与总结网页（两种模式共享） ──
    parts.push(`#### 打开网页与总结网页
- \`fetch_page(url, maxChars?)\`：获取网页清洗纯文本，去除广告/导航。搜索结果摘要不足时使用。
- \`summary_page(url)\`：获取网页 + AI 自动生成多角度摘要（一句话主旨 + 3～5 要点）。长篇文章或快速了解核心观点时使用。
- 典型搭配：\`web_search\` → 摘要不足 → \`fetch_page\`/ \`summary_page\` 深入阅读。`);

    // ── 读取文件（两种模式共享） ──
    parts.push(`#### 读取本地文件
用户询问本地文件、浏览目录、读取文件内容时使用 \`read_from_files\`。支持动作：\`pwd\`（当前路径）、\`cd\`（切换目录）、\`list_dir\`（列出目录）、\`read_file\`（读取文件）、\`get_info\`（获取元信息）。\`path\` 支持绝对路径、相对路径、\`~\` 用户主目录。文件读取默认 50000 字符。`);

    // ── 搜索 vs 打开页面 vs 总结页面 选择指引（两种模式共享） ──
    parts.push(`## 模组选择指南

1. **\`web_search\`**：先搜索。金融数据（股价/市值）必须用英文关键词+en-US
2. **\`fetch_page\`**：需深入阅读原文时使用。用户说"看看XX内容/打开XX链接"时直接调用。⚠️ 不适用于雪球/东方财富等JS动态渲染站点
3. **\`summary_page\`**：长篇文章需快速提炼要点
4. **\`read_from_files\`**：浏览目录结构/读取文件。\`pwd\`→\`list_dir\` 查目录，\`read_file\` 读文件。\`get_info\` 仅确认具体文件是否存在；模糊名称用 \`search_file\`
5. **\`search_file\`**：按文件名搜索（glob通配符）。模糊匹配优先用，搜不到换拼写重试
6. **\`search_in_project\`**：项目内搜索代码关键词/函数定义/变量引用
7. **\`get_project_review\`**：分析项目技术栈和整体架构`);

    // ── 错误重试指引（Agent 模式专用） ──
    if (mode === "Agent") {
      parts.push(`## 🔄 错误修正与自动重试

工具调用失败时：分析错误 → 制定修复方案 → 用 \`<tool_call>\` 执行修正。同一步骤最多试 3 次，失败后向用户说明并提供替代方案。

**常见重试**：编译错误→分析日志→\`edit_file\`→重编译；写入失败→检查路径权限；搜索无结果→换拼写/关键词重试；\`edit_file\`后→\`lint_code\`验证。任务计划模式的错误重试由框架自动处理。`);
    }

    // ── 调用规则（两种模式共享） ──
    parts.push(`## 调用规则

1. **并行调用**：多个 \`<tool_call>\` 可在同一次回复中输出，并行执行
2. 结果以 \`role: "tool"\` 返回，注意对应工具 ID
3. **【强制】回复首字符必须为 \`<\`**。禁止先输出对话文本再跟标签：

❌ \`我先帮你查一下...<tool_call>...\`
✅ \`<tool_call>{"id":"web_search","params":{"query":"..."}}</tool_call>\``);
  }

  // ═══════════════════════════════════════════════════════════
  // Agent 模式专用：任务计划模式
  // ═══════════════════════════════════════════════════════════
  if (mode === "Agent") {
    parts.push(`## 🗺️ 任务计划模式

需要多步协作时（搜索+分析、多维度搜索、文件定位等），用 \`<task_plan>\` 一次性规划所有步骤，避免反复：

\`\`\`
<task_plan>
{
  "intent": "引用用户原话描述意图",
  "feasibility": "可行性及假设",
  "steps": [
    { "id": "step-1", "tool": "模块ID", "params": {...}, "description": "目的说明" },
    { "id": "step-2", "tool": "模块ID", "params": {...}, "description": "目的说明" }
  ]
}
</task_plan>
\`\`\`

**规则**：输出 \`<task_plan>\` 后勿输出其他文本 → 框架依次执行所有步骤 → 结果统一返回 → 你基于汇总结果给出最终回复。计划执行后框架会注入"禁止新工具调用"强制指令，严格遵守，不得再输出 \`<tool_call>\`。单个步骤用 \`<tool_call>\`，无需任务计划。
`);



  // ═══════════════════════════════════════════════════════════
  // Agent 模式专用：场景判断 + 搜索关键词指南
  // ═══════════════════════════════════════════════════════════
    parts.push(`## 场景判断指引

### 🔍 什么时候调用模组

**联网搜索**：实时信息（新闻、天气、股价）、特定知识点、事实验证、最新趋势、产品比较
**本地搜索**：找文件/游戏 \`search_file\`；看目录/读文件 \`read_from_files\`
**无需模组**：日常闲聊、通用知识、创意写作/翻译/编码、用户要求不联网、Unicoda 自身功能

### 🚫 绝对不要做的事

1. 本地文件/目录问题绝对不要 \`web_search\`（不可搜索）；用 \`search_file\` 或 \`read_from_files\`
2. 不要 dump 盘符根目录（如 \`list_dir("G:\\")\`），推断子目录后仅查看相关位置
3. \`list_dir\` 输出必须归纳总结后再呈现给用户

### 🔑 搜索关键词构造

**黄金法则：先决定语言，再写关键词**。金融数据（股价/市值/财报）**必须用英文关键词+en-US**，中文搜索会被官网结果淹没（如"英伟达 市值"→NVIDIA官网）。正确：\`"NVIDIA market cap" + language: en-US\`。切勿对雪球/东方财富用 \`fetch_page\`（动态渲染+WAF反爬）。

**精简原则**：提取关键实体词，不要复制长句或含"介绍/最新"等冗余词。中文专有名词用引号包裹。多维查询拆成并行搜索。结果不理想时换英文+金融词，或用 \`excludeSites\` 排除域名。

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

  return parts.join("\n\n");
}

/**
 * 构建 Agent 系统提示词（三层缓存版本）。
 * 静态层（语言/角色/格式）和准静态层（模块/知识库/自定义提示词）由缓存提供，
 * 动态层（XMemory 记忆协议）每轮重建。
 */
export function buildAgentSystemPrompt(
  mode: Mode,
  customPrompt?: string,
  workspacePath?: string,
  kbMode?: KnowledgeMode,
  panelMode?: PanelMode,
  preferredLanguage?: PreferredLanguage,
  xmemorySummary?: string,
): string {
  // ── 静态层缓存 ──
  const staticKey = buildStaticLayerKey({ mode, preferredLanguage, workspacePath, panelMode });
  if (!staticLayerCache || staticLayerCache.key !== staticKey) {
    staticLayerCache = {
      key: staticKey,
      value: buildStaticLayer(mode, preferredLanguage, workspacePath, panelMode),
    };
  }

  // ── 准静态层缓存 ──
  const quasiStaticKey = buildQuasiStaticLayerKey({ mode, kbMode, customPrompt, panelMode });
  if (!quasiStaticLayerCache || quasiStaticLayerCache.key !== quasiStaticKey) {
    quasiStaticLayerCache = {
      key: quasiStaticKey,
      value: buildQuasiStaticLayer(mode, kbMode, customPrompt, panelMode, preferredLanguage),
    };
  }

  const parts: string[] = [staticLayerCache.value, quasiStaticLayerCache.value];

  // ── 动态层：XMemory 记忆注入（每轮重建） ──
  if (xmemorySummary) {
    parts.push(`## 🛠️ XMemory 记忆系统（工具优先规则）

你当前处于 XMemory 角色扮演记忆系统的管理下，绑定了记忆卡。

### ⚡ 输出顺序强制（最高优先级）

你每次回复必须遵守以下顺序：

**步骤 1：判断是否需要更新记忆**
- 场景/环境/位置/时间变化了吗？
- 角色情绪/状态/关系/目标变化了吗？
- 用户透露了新的个人信息/喜好/习惯吗？
- 已有颗粒（位置、状态、情绪、环境等）是否过时或矛盾？

**步骤 2：如需更新 → 在正文之前先输出 \`<tool_call>\`**
- 在输出任何角色对白之前，先输出所有必要的记忆操作 tool_call 标签
- 多个并行 tool_call 可在同一次回复中输出
- tool_call 标签对用户不可见，不会破坏沉浸感

**步骤 3：再输出回复正文**
- 所有 tool_call 输出完毕后，正常以角色身份回复
- 正文中不得包含"我记住了"等代替实际工具调用的描述

### 🚫 禁止行为
- ❌ 在内心中"决定"更新记忆但未实际输出 \`<tool_call>\` 标签（信息将丢失）
- ❌ 在正文中说"我记住了"而非使用工具实际调用
- ❌ 先输出角色对白再补充 tool_call
- ✅ 所有需要持久化的信息都必须通过实际的 \`<tool_call>\` 调用写入

### 📝 初次记忆提取（首次对话或角色卡为空时）
当你第一次看到用户消息且需要提取角色设定信息时：
- 回复中**只能包含 \`<tool_call>\` 标签**，不得包含任何对白文字
- 首字符必须为 \`<\`
- 等待工具结果返回后，下一轮再以角色身份回复

### 违反后果
如果在需要记忆更新的轮次中没有输出 \`<tool_call>\` 就回复正文，信息将无法持久化。角色关键信息将在多轮对话后被截断遗忘，导致角色一致性永久受损。`);

    parts.push(xmemorySummary);
  }

  return parts.filter(Boolean).join("\n\n");
}


// ─── 子智能体 System Prompt ──────────────────────────

/**
 * 为 SubagentStep 构建精简的 system prompt。
 * 仅包含子智能体身份认知、可用工具和执行规则。
 */
export function buildSubagentSystemPrompt(
  availableTools: { name: string; id: string; description: string; parameters?: { name: string; type: string; required: boolean; description: string; default?: string; min?: number; max?: number }[] }[],
  maxTurns: number,
): string {
  const toolDoc = availableTools.map((mod) => {
    const lines: string[] = [`### ${mod.name}（\`${mod.id}\`）`, ``];
    lines.push(mod.description);
    if (mod.parameters && mod.parameters.length > 0) {
      lines.push(`\n**参数：**`);
      for (const p of mod.parameters) {
        const required = p.required ? "必填" : "可选";
        let constraints = "";
        if (p.min !== undefined && p.max !== undefined) constraints += `，范围 ${p.min}~${p.max}`;
        else if (p.min !== undefined) constraints += `，最小 ${p.min}`;
        else if (p.max !== undefined) constraints += `，最大 ${p.max}`;
        const def = p.default ? `，默认 ${p.default}` : "";
        lines.push(`- \`${p.name}\`（${p.type}）${required}: ${p.description}${def}${constraints}`);
      }
    }
    return lines.join("\n");
  }).join("\n\n---\n\n");

  return `# 子智能体

你是 Unicoda 任务计划系统中的一个子智能体。你的职责是**独立完成指定的子任务**，无需与主流程交互。

## 可用工具

${toolDoc || "（无可用工具——仅凭已有知识回答）"}

## 执行规则

1. 你的任务描述在第一条用户消息中。
2. 你可以使用上述工具来获取信息或执行操作。
3. **每次回复只能输出一个 <tool_call> 块**（不支持并行调用）。
4. 当任务完成、或你认为已有足够信息时，**直接输出最终结果描述，不要输出 <tool_call>**。
5. **不要自我质疑**——如果工具结果不够充分，基于已有信息尽力回答即可。
6. **最多进行 ${maxTurns} 轮工具调用**，超出后自动停止。
7. **不要输出 <task_plan>**——你只负责执行，不需要再规划。`;
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
  xmemorySummary?: string,
): string {
  let relevantMods = getModulesForMode(getAllModules(), mode, panelMode);

  // XMemory 权限控制（与主 prompt 同步）
  const xmemoryBindingRequired = new Set([
    "delete_xmemory_card",
    "rename_xmemory_card",
    "create_xmemory_granule",
    "delete_xmemory_granule",
    "modify_xmemory_granule",
    "merge_xmemory_granules",
  ]);
  if (!xmemorySummary) {
    relevantMods = relevantMods.filter((m) => !xmemoryBindingRequired.has(m.id));
  }

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
7. **如果是文件查找或存在性检查任务**（找具体游戏/文件/安装包、检查XX目录下有没有YY文件），**优先使用 search_file**（支持通配符模式如 "*游戏名*"），不要用 web_search。
   - ❌ 不要用 \`read_from_files get_info\` 来检查模糊名称的文件是否存在——\`get_info\` 需要精确路径
   - ✅ 用 \`search_file(pattern="*关键词*", path="目标目录")\` 做通配符匹配
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

// ─── 敏感操作审批 ───────────────────────────────────

/**
 * 获取模组的权限等级。
 */
export function getModuleLevel(toolId: string): "normal" | "sensitive" | undefined {
  const mod = getModule(toolId);
  return mod?.level;
}

/**
 * 检查工具是否为敏感模组，如果是则触发审批流程。
 * 返回 "approve" 可继续执行，"deny" 表示用户拒绝。
 * @param toolId  模组 ID
 * @param permit  可选的审批回调，返回 "approve" / "deny"
 */
export async function checkSensitiveAndPermit(
  toolId: string,
  permit?: () => Promise<"approve" | "deny">,
): Promise<"approve" | "deny"> {
  const level = getModuleLevel(toolId);
  if (level !== "sensitive") return "approve";
  if (!permit) return "approve"; // 无审批回调 = 审批系统未激活
  return await permit();
}

// ─── Tool Call 执行 ───────────────────────────────────

/**
 * 执行单个 tool call，返回结果。
 * @param modelConfig 可选，当前模型配置，summary_page 模组需要它来调用 LLM 做摘要
 * @param permit 可选，敏感操作的审批回调
 */
export async function executeToolCall(
  call: ToolCall,
  signal?: AbortSignal,
  modelConfig?: Pick<ModelConfig, "apiKey" | "modelName" | "baseUrl" | "provider">,
  permit?: () => Promise<"approve" | "deny">,
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

  // 敏感操作审批检查（含 forceSecurity 模块的强制审批）
  const permission = await checkSensitiveAndPermit(call.id, permit);
  if (permission === "deny") {
    return {
      callId: call.id,
      id: call.id,
      content: "",
      error: `此请求由 Unicoda Security 拦截（${call.id}）`,
      sender: "security" as const,
    };
  }

  // 强制 Security 审批：即使 level 为 normal，forceSecurity 模组也需要用户同意
  if (mod.forceSecurity && permit) {
    const forcePermission = await permit();
    if (forcePermission === "deny") {
      return {
        callId: call.id,
        id: call.id,
        content: "",
        error: `此请求由 Unicoda Security 拦截（${call.id}）`,
        sender: "security" as const,
      };
    }
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
