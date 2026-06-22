/**
 * 任务计划系统
 *
 * 允许模型为复杂任务制定完整执行计划，框架自动执行所有步骤。
 * 消除逐步执行中模型反复自我质疑的问题。
 *
 * 步骤类型：
 * - ModuleStep（默认）：直接调用单个模组
 * - SubagentStep（type: "subagent"）：启动一个内部 agent 循环，
 *   可以自主进行多轮 tool call 和推理，类似子智能体模式
 */
import { getModule, getAllModules } from "../modules/registry";
import { getModulesForMode } from "../modules/types";
import { executeToolCall, parseToolCalls, stripToolCalls, buildSubagentSystemPrompt, checkSensitiveAndPermit } from "./agentEngine";
import type { ToolCall, ToolResult } from "./agentEngine";
import { streamChatCompletion } from "./modelApi";
import type { ModelConfig, Mode, PanelMode } from "../types";

// ─── 类型定义 ──────────────────────────────────────────

/** 传统单步模组调用步骤（保持向后兼容） */
export interface ModuleStep {
  id: string;
  /** 可为 undefined 或 "module"——不指定时默认视为 ModuleStep */
  type?: "module";
  tool: string;
  params: Record<string, string>;
  description: string;
}

/** 子智能体步骤：启动内部 agent 循环自主完成任务 */
export interface SubagentStep {
  id: string;
  type: "subagent";
  /** 子智能体的任务描述 */
  prompt: string;
  /** 可选限制工具列表（如不指定则使用当前模式所有可见工具） */
  toolIds?: string[];
  /** 内部最大推理轮次（默认 5） */
  maxTurns?: number;
  description: string;
}

export type TaskStep = ModuleStep | SubagentStep;

export interface TaskPlan {
  intent: string;
  feasibility: string;
  steps: TaskStep[];
}

export interface StepResult {
  step: TaskStep;
  result: ToolResult;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 子智能体步骤的内部工具调用链（仅在 SubagentStep 中填充） */
  internalTrace?: { call: ToolCall; content: string; error?: string }[];
}

/** 判断步骤是否为子智能体步骤 */
function isSubagentStep(step: TaskStep): step is SubagentStep {
  return (step as SubagentStep).type === "subagent";
}

// ─── 正则匹配 ──────────────────────────────────────────

const TASK_PLAN_RE = /<task_plan>([\s\S]*?)<\/task_plan>/;

// ─── 解析 ──────────────────────────────────────────────

/**
 * 从 LLM 回复文本中解析 <task_plan> 块。
 * 返回 null 表示未找到或格式错误。
 */
export function parseTaskPlan(text: string): TaskPlan | null {
  const match = TASK_PLAN_RE.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (
      parsed &&
      typeof parsed.intent === "string" &&
      typeof parsed.feasibility === "string" &&
      Array.isArray(parsed.steps)
    ) {
      // 验证每个 step 的合法性
      for (const s of parsed.steps) {
        if (!s.id) {
          console.warn("[taskPlanner] 计划中某步骤缺少 id 字段:", s);
          return null;
        }
        if (s.type === "subagent") {
          // SubagentStep 需要 prompt 字段
          if (!s.prompt) {
            console.warn("[taskPlanner] SubagentStep 缺少 prompt 字段:", s);
            return null;
          }
        } else {
          // ModuleStep 需要 tool 字段
          if (!s.tool) {
            console.warn("[taskPlanner] 计划中某步骤缺少 tool 字段:", s);
            return null;
          }
        }
      }
      return parsed as TaskPlan;
    }
  } catch (err) {
    console.warn("[taskPlanner] 解析 task_plan 失败:", err);
  }
  return null;
}

/**
 * 从文本中移除 <task_plan> 块，返回干净的回复内容。
 */
export function stripTaskPlan(text: string): string {
  return text.replace(TASK_PLAN_RE, "").trim();
}

// ─── 子智能体步骤执行 ──────────────────────────────────

/**
 * 执行子智能体步骤：内部 agent 循环。
 * 子智能体有自己的上下文，可进行多轮 tool call 和推理。
 */
async function executeSubagentStep(
  step: SubagentStep,
  signal: AbortSignal,
  modelConfig: ModelConfig,
  mode: Mode,
  panelMode?: PanelMode,
  permit?: () => Promise<"approve" | "deny">,
): Promise<StepResult> {
  const startTime = performance.now();
  const maxTurns = step.maxTurns || 5;
  // 构建可用工具列表
  const allModules = getAllModules();
  const visibleModules = getModulesForMode(allModules, mode, panelMode);
  const availableTools = step.toolIds
    ? visibleModules.filter((m) => step.toolIds!.includes(m.id))
    : visibleModules;
  const sysPrompt = buildSubagentSystemPrompt(availableTools, maxTurns);
  const internalTrace: { call: ToolCall; content: string; error?: string }[] = [];

  // 子智能体的消息上下文
  const messages: { role: string; content: string }[] = [
    { role: "system", content: sysPrompt },
    { role: "user", content: step.prompt },
  ];

  let finalContent = "";
  let turnCount = 0;

  while (turnCount < maxTurns && !signal.aborted) {
    turnCount++;
    let fullResponse = "";
    let fullReasoning = "";

    try {
      for await (const chunk of streamChatCompletion(modelConfig, messages, signal)) {
        fullResponse += chunk.content;
        fullReasoning += chunk.reasoningContent || "";
      }
    } catch (err) {
      // LLM 调用失败，返回已有结果
      const durationMs = Math.round(performance.now() - startTime);
      return {
        step,
        result: {
          callId: step.id,
          id: "subagent",
          content: finalContent || "",
          error: `子智能体内部 LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`,
        },
        durationMs,
        internalTrace,
      };
    }

    const toolCalls = parseToolCalls(fullResponse);
    const cleanResponse = stripToolCalls(fullResponse);

    if (toolCalls.length === 0) {
      // 子智能体已完成——没有更多 tool call
      finalContent = cleanResponse || fullResponse;
      // 保留最后的推理内容
      if (fullReasoning) {
        finalContent = `${fullReasoning}\n\n${finalContent}`;
      }
      break;
    }

    // 记录内部调用上下文
    const assistantMsg = fullResponse + (fullReasoning ? `\n\n[思考过程]\n${fullReasoning}` : "");
    messages.push({ role: "assistant", content: assistantMsg });

    // 执行所有 tool call
    for (const call of toolCalls) {
      if (signal.aborted) break;
      const result = await executeToolCall(call, signal, modelConfig, permit);

      internalTrace.push({
        call,
        content: result.error ? "" : result.content,
        error: result.error,
      });

      messages.push({
        role: "user" as const,
        content: `[工具执行结果 - ${call.id}]\n${result.error ? `执行错误：${result.error}` : result.content}`,
      });
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  // 如果达到最大轮次但子智能体还在输出 tool call，强制终止
  if (turnCount >= maxTurns && !finalContent) {
    finalContent = `（子智能体达到最大轮次 ${maxTurns}，未输出最终结果）`;
  }

  // 构建包含内部 trace 的完整结果
  let combinedContent = "";
  if (internalTrace.length > 0) {
    combinedContent += `[子智能体内部执行记录]\n`;
    for (let i = 0; i < internalTrace.length; i++) {
      const t = internalTrace[i];
      combinedContent += `\n--- 内部调用 ${i + 1}: ${t.call.id} ---\n`;
      combinedContent += t.error
        ? `执行错误：${t.error}\n`
        : `${(t.content || "").slice(0, 3000)}${(t.content || "").length > 3000 ? "\n...（结果过长已截断）" : ""}\n`;
    }
    combinedContent += `\n[子智能体最终输出]\n`;
  }
  combinedContent += finalContent;

  return {
    step,
    result: {
      callId: step.id,
      id: "subagent",
      content: combinedContent,
    },
    durationMs,
    internalTrace,
  };
}

/**
 * 执行单个模块步骤（传统方式）。
 */
async function executeModuleStep(
  step: ModuleStep,
  signal: AbortSignal,
  modelConfig?: Pick<ModelConfig, "apiKey" | "modelName" | "baseUrl" | "provider">,
  permit?: () => Promise<"approve" | "deny">,
): Promise<StepResult> {
  // 敏感操作权限检查
  const permission = await checkSensitiveAndPermit(step.tool, permit);
  if (permission === "deny") {
    return {
      step,
      result: {
        callId: step.id,
        id: step.tool,
        content: "",
        error: "敏感操作已被用户拒绝。",
      },
      durationMs: 0,
    };
  }

  const mod = getModule(step.tool);
  if (!mod) {
    return {
      step,
      result: {
        callId: step.id,
        id: step.tool,
        content: "",
        error: `未知工具 "${step.tool}"。可用工具列表已包含在系统提示词中。`,
      },
      durationMs: 0,
    };
  }

  const startTime = performance.now();
  try {
    const params = { ...step.params };
    if ((step.tool === "summary_page" || step.tool === "check_api_balance") && modelConfig) {
      params._modelApiKey = modelConfig.apiKey;
      params._modelName = modelConfig.modelName;
      params._modelBaseUrl = modelConfig.baseUrl || "";
      params._modelProvider = modelConfig.provider;
    }

    let content = "";
    for await (const chunk of mod.execute(params, signal)) {
      content += chunk;
      if (signal.aborted) break;
    }

    const durationMs = Math.round(performance.now() - startTime);
    return {
      step,
      result: { callId: step.id, id: step.tool, content },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    return {
      step,
      result: {
        callId: step.id,
        id: step.tool,
        content: "",
        error: `执行错误：${err instanceof Error ? err.message : String(err)}`,
      },
      durationMs,
    };
  }
}

// ─── 执行 ──────────────────────────────────────────────

/**
 * 执行任务计划中的所有步骤。
 * 按顺序依次执行（串行），根据步骤类型分派：
 * - ModuleStep：直接调用模组
 * - SubagentStep：启动内部 agent 循环
 * 如果某一步出错，记录错误但继续执行后续步骤。
 *
 * 以 AsyncGenerator 形式逐步骤输出结果，方便调用方实时流式更新 UI。
 */
export async function* executeTaskPlan(
  plan: TaskPlan,
  signal: AbortSignal,
  modelConfig?: ModelConfig,
  mode?: Mode,
  panelMode?: PanelMode,
  permit?: () => Promise<"approve" | "deny">,
): AsyncGenerator<StepResult> {
  for (let i = 0; i < plan.steps.length; i++) {
    if (signal.aborted) break;

    const step = plan.steps[i];

    if (isSubagentStep(step)) {
      // ── 子智能体步骤 ──
      if (!modelConfig) {
        yield {
          step,
          result: {
            callId: step.id,
            id: "subagent",
            content: "",
            error: "子智能体步骤需要完整的模型配置（ModelConfig），但未提供",
          },
          durationMs: 0,
        };
        continue;
      }
      yield await executeSubagentStep(step, signal, modelConfig, mode || "Agent", panelMode, permit);
    } else {
      // ── 传统模块步骤 ──
      yield await executeModuleStep(
        step as ModuleStep,
        signal,
        modelConfig ? { apiKey: modelConfig.apiKey, modelName: modelConfig.modelName, baseUrl: modelConfig.baseUrl, provider: modelConfig.provider } : undefined,
        permit,
      );
    }

    // 步骤间留一点间隔，避免资源竞争
    if (i < plan.steps.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// ─── 格式化 ─────────────────────────────────────────────

/**
 * 将 StepResult[] 格式化为注入 prompt 的文本。
 * SubagentStep 的 internalTrace 会被展开呈现。
 */
export function formatPlanResults(results: StepResult[]): string[] {
  return results.map((sr) => {
    const isSubagent = isSubagentStep(sr.step);
    const stepLabel = isSubagent
      ? `[任务步骤: ${sr.step.id} - ${sr.step.description} (子智能体)]`
      : `[任务步骤: ${sr.step.id} - ${sr.step.description} (工具: ${(sr.step as ModuleStep).tool})]`;

    const body = sr.result.error
      ? `执行错误：${sr.result.error}`
      : sr.result.content;

    // 子智能体步骤的结果已经包含了 internalTrace 的格式化内容
    return `${stepLabel}\n${body}`;
  });
}
