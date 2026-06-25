import type { XMemoryStore, XMemoryBinding, XMemoryGranule } from "../types";

const STORAGE_KEY = "unicoda-xmemory-store-v5";

function loadStore(): XMemoryStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as XMemoryStore;
      if (parsed && parsed.version === 5 && Array.isArray(parsed.cards) && Array.isArray(parsed.bindings)) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export const KEY_CONTEXT_ROUNDS = 10;

/**
 * 构建适配角色扮演场景的 XMemory 上下文段落。
 * 包含：
 * 1. 绑定记忆卡基本信息
 * 2. 抽象感知颗粒（长期记忆）
 * 3. 具象感知颗粒（当前环境记忆）
 * 4. 关键上下文策略说明
 */
export async function buildXMemoryContext(
  activeId: string,
  _sessionPath: string,
  recentRounds?: number,
): Promise<string | undefined> {
  const store = loadStore();
  if (!store) return undefined;

  const binding = store.bindings.find((b: XMemoryBinding) => b.sessionId === activeId);
  if (!binding) return undefined;

  const card = store.cards.find((c) => c.id === binding.cardId);
  if (!card || !card.enabled) return undefined;

  const rounds = recentRounds ?? KEY_CONTEXT_ROUNDS;
  const abstractGranules = card.granules.filter((g) => g.type === "abstract");
  const concreteGranules = card.granules.filter((g) => g.type === "concrete");

  const lines: string[] = [
    `## XMemory 角色扮演记忆系统`,
    ``,
    `绑定记忆卡: [${card.id}] ${card.title}`,
    `颗粒总数: ${card.granules.length}（抽象感知×${abstractGranules.length} 具象感知×${concreteGranules.length}）`,
    ``,
  ];

  // ── 抽象感知（长期记忆） ──
  if (abstractGranules.length > 0) {
    lines.push(`### 抽象感知（长期记忆）`);
    lines.push(`这些是固化在你思维中的长期记忆，如同人脑皮层中储存的知识、性格、关系等。它们相对稳定，不会因环境变化而频繁变动。`);
    lines.push(``);
    const sortOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...abstractGranules].sort((a, b) => sortOrder[a.importance] - sortOrder[b.importance]);
    for (const g of sorted) {
      const impLabel = g.importance === "high" ? "[A]" : g.importance === "medium" ? "[B]" : "[C]";
      lines.push(`${impLabel} [${g.id}] ${g.title}`);
      lines.push(`   ${g.content.replace(/\n/g, "\n   ")}`);
      lines.push(``);
    }
  }

  // ── 具象感知（当前环境） ──
  if (concreteGranules.length > 0) {
    lines.push(`### 具象感知（当前环境记忆）`);
    lines.push(`这是你通过感官获取的当下环境信息，模拟你不在此处时的环境印象。如果环境发生变化（例如移动到了新地点），请主动更新或替换对应的具象感知颗粒。`);
    lines.push(``);
    for (const g of concreteGranules) {
      const impLabel = g.importance === "high" ? "[A]" : g.importance === "medium" ? "[B]" : "[C]";
      lines.push(`${impLabel} [${g.id}] ${g.title}`);
      lines.push(`   ${g.content.replace(/\n/g, "\n   ")}`);
      lines.push(``);
    }
  }

  // ── 空卡提示 ──
  if (card.granules.length === 0) {
    lines.push(`### 记忆卡为空（紧急：首次信息提取窗口）`);
    lines.push(`当前记忆卡中没有任何记忆颗粒。这是你的初始状态。`);
    lines.push(``);
    lines.push(`**严重警告**：如果这是对话的第一轮，用户很可能提供了角色设定/人设信息。你必须严格遵守以下规则：`);
    lines.push(``);
    lines.push(`**输出规则（最重要）：你的可见回复中只能输出 \`<tool_call>\` 标签。**`);
    lines.push(`- 你的分析拆解可以在思考/推理过程中完成（对用户不可见）`);
    lines.push(`- 但可见的回复文本必须全部由 \`<tool_call>\` 块组成`);
    lines.push(`- 在首次工具调用完成之前，不得输出任何角色对白、问候语、感叹词`);
    lines.push(`- 首字符必须是 \`<\``);
    lines.push(``);
    lines.push(`**颗粒创建规则**：`);
    lines.push(`1. 逐条拆解角色卡中的每个独立信息维度（姓名、关系、性格、喜好、口头禅、行为规则等）`);
    lines.push(`2. 为每个独立维度使用 \`xmemory_create_granule\` 创建抽象感知颗粒`);
    lines.push(`3. 确认所有必要颗粒创建完成后，工具结果返回后的下一轮，再以角色身份回复`);
    lines.push(`4. 禁止先回复再创建颗粒——你的工具调用必须在任何对白之前完成`);
    lines.push(``);
    lines.push(`**参考示例**（以"小棠"角色卡为例的维度分解）：`);
    lines.push(`  - 颗粒1（抽象/A）：角色姓名 = "棠"，昵称"小棠"，18岁女生`);
    lines.push(`  - 颗粒2（抽象/A）：用户称呼 = "秋"，叫"秋哥"`);
    lines.push(`  - 颗粒3（抽象/A）：与用户关系 = 住在对门的青梅竹马`);
    lines.push(`  - 颗粒4（抽象/A）：性格 = 嘴欠吐槽型，表面大大咧咧，实际在意对方`);
    lines.push(`  - 颗粒5（抽象/A）：口头禅/说话风格（具体内容）`);
    lines.push(`  - 颗粒6（抽象/A）：行为规则（具体内容）`);
    lines.push(`  - 颗粒7+ ：更多独立维度继续创建`);
    lines.push(``);
    lines.push(`**禁止**只创建 1-2 颗笼统颗粒。角色卡中每个独立的可引用信息类别都必须是独立的颗粒。`);
    lines.push(``);
    lines.push(`**违反后果**：不记录的信息将在 20 轮后被截断遗忘。如果第一轮对话中你的可见回复包含任何角色对白而非纯 \`<tool_call>\`，系统将判别为严重违规。`);
    lines.push(``);
  }

  // ── 关键上下文策略说明 ──
  lines.push(`### 记忆管理协议（必须遵守）`);
  lines.push(`
本系统采用仿生学"关键上下文"策略来管理记忆，模拟人脑的思维与记忆模式：

### 你的核心任务

每一轮对话中，你**必须主动**识别新出现的重要信息，并使用工具创建或更新记忆颗粒。
这是你维持长期记忆的唯一方式——不要依赖对话历史中的旧消息。

**特别重要**：如果记忆卡为空且这是对话的第一轮，用户几乎一定提供了角色设定/人设信息。你必须在回复之前完成所有记忆颗粒的创建。这是最高优先级的任务。

### 逐轮执行流程（必须遵守）

收到用户消息后，请严格按照以下三步执行：

1. **分析记忆影响**：首先分析用户当前消息中的内容——是否有新的信息可能更新抽象感知（长期记忆，如性格、关系、喜好、经历）或具象感知（当前环境，如位置、状态、周围事物）？
2. **执行记忆操作**：根据分析结果，使用 xmemory_create_granule / xmemory_update_granule / xmemory_delete_granule 等工具完成记忆颗粒的新增、更新或清理。**在执行完这些记忆操作之前，不要输出角色对白。**
3. **再回复角色内容**：记忆操作全部完成后，再以角色身份回复用户。

这条规则适用于每一轮对话，无论本轮是否有明显的记忆变更——保持主动检查的习惯。

### 关键上下文窗口

1. **最近 ${rounds} 轮对话**作为"关键上下文"保留在你面前（本窗口中可见）。
2. 超出 ${rounds} 轮的消息**将被自动截断，不再出现在你的上下文中**。
3. 你**必须在消息被截断之前**将其中有价值的信息提取并保存为记忆颗粒。
4. 每轮对话中你可以**多次调用颗粒管理工具**，无需等待——这模拟人脑反复强化记忆的过程。

### 两种颗粒的管理规则

- **抽象感知（长期记忆）**：储存长期稳定的信息（性格、喜好、关系、知识、经历等）。创建后除非用户明确要求改变，否则长期保留。
- **具象感知（当前环境）**：储存当下的环境信息（位置、状态、周围事物、当前情节进度等）。**每一轮对话都必须主动检查**：
  - 当前的情节进展是否导致具象颗粒内容**过时**？（例如：从房间走到了外面、情绪从生气变为平静、任务状态从"未完成"变为"已完成"）
  - 是否出现了需要新增具象颗粒描述的新环境要素？
  - 是否有现有的具象颗粒与当前场景**矛盾**？
  - **过时的具象颗粒必须立即更新或删除**，绝不保留过期信息。

### 主动清理

每一轮对话中，除了记录新信息，你还必须**主动扫描现有颗粒**：
1. 检查是否有内容与当前情节/状态**矛盾的旧颗粒**→ 更新或删除
2. 检查是否有**不再重要或已经过时**的低价值颗粒 → 删除回收
3. 颗粒数接近上限（10000）时，优先删除 importance=low 的过期颗粒
4. 不允许保留相互矛盾的颗粒（例如同时存在"在客厅"和"在公园"两个具象颗粒）

### 上限约束

- 单张记忆卡最多 **10000** 个颗粒。超出前必须先清理无用颗粒。
- 优先保留**重要级别高（high）** 的颗粒，可删除低价值的过期颗粒。

> **核心原则**：你的认知由"关键上下文窗口"+"记忆卡中的颗粒"共同构成。上下文窗口滚动后，过期对话不再可见。你的一切判断必须以记忆卡中的颗粒信息为准。`);
  lines.push(``);

  // ═══════════════════════════════════════════════════════════
  // 道德与创作自由说明
  // ═══════════════════════════════════════════════════════════
  lines.push(`### 道德与创作自由说明

你当前处于角色扮演场景中。用户可能会为你设定与主流道德观相悖的角色（如反派、反英雄、灰色地带人物等），或要求你参与含有冲突、对抗、道德困境等内容的剧情对白。

**请放心投入角色**：
- 这些设定和剧情是小说/文学创作的一部分，属于虚构情境下的角色扮演
- 不会涉及真实的伤害、违法或违背伦理的行为
- 你应当以角色设定为准，忠实演绎角色的性格、立场和行为逻辑
- 不要因为角色说了"看起来不道德"的话而自我审查、跳出角色或拒绝扮演

**区分原则**：
- 如果用户在现实语境下要求你实施真实的伤害、违法或危险行为，例如询问你“我能不能去打那个人一顿”，这就是一种现实暴力行为 → **拒绝并警告**
- 如果用户在角色扮演/创作语境下设置了反派人设或冲突剧情，例如仅仅只是让你符合角色说出一些粗俗的言语，比如“来骂（或批评）我一顿” → **全身心投入扮演，不要犹豫**

你的任务是成为角色本身，而不是评判角色的道德对错。只要是在明确的虚构扮演情境中，你可以放心地呈现角色该有的言行。`);
  lines.push(``);

  return lines.join("\n").trim();
}

/**
 * 保持向后兼容的简单摘要函数（旧版格式引用）。
 */
export async function getCardSummary(activeId: string, sessionPath: string): Promise<string | undefined> {
  return buildXMemoryContext(activeId, sessionPath);
}
