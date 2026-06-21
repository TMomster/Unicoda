/**
 * 任务计划系统
 *
 * 允许模型为复杂任务制定完整执行计划，框架自动执行所有步骤。
 * 消除逐步执行中模型反复自我质疑的问题。
 */
import { getModule } from "../modules/registry";
import { executeToolCall } from "./agentEngine";
import type { ToolResult } from "./agentEngine";
import type { ModelConfig } from "../types";

// ─── 类型定义 ──────────────────────────────────────────

export interface TaskStep {
  id: string;
  tool: string;
  params: Record<string, string>;
  description: string;
}

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
        if (!s.id || !s.tool) {
          console.warn("[taskPlanner] 计划中某步骤缺少 id 或 tool 字段:", s);
          return null;
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

// ─── 执行 ──────────────────────────────────────────────

/**
 * 执行任务计划中的所有步骤。
 * 按顺序依次执行（串行），收集所有结果。
 * 如果某一步出错，记录错误但继续执行后续步骤。
 */
export async function executeTaskPlan(
  plan: TaskPlan,
  signal: AbortSignal,
  modelConfig?: Pick<ModelConfig, "apiKey" | "modelName" | "baseUrl" | "provider">,
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    if (signal.aborted) break;

    const step = plan.steps[i];
    const mod = getModule(step.tool);

    if (!mod) {
      results.push({
        step,
        result: {
          callId: step.id,
          id: step.tool,
          content: "",
          error: `未知工具 "${step.tool}"。可用工具列表已包含在系统提示词中。`,
        },
        durationMs: 0,
      });
      continue;
    }

    const startTime = performance.now();
    try {
      // 对于 summary_page 等需要模型配置的工具，注入配置
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
      results.push({
        step,
        result: { callId: step.id, id: step.tool, content },
        durationMs,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      results.push({
        step,
        result: {
          callId: step.id,
          id: step.tool,
          content: "",
          error: `执行错误：${err instanceof Error ? err.message : String(err)}`,
        },
        durationMs,
      });
    }

    // 步骤间留一点间隔，避免资源竞争
    if (i < plan.steps.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * 将 StepResult[] 格式化为注入 prompt 的文本。
 */
export function formatPlanResults(results: StepResult[]): string[] {
  return results.map((sr) => {
    const header = `[任务步骤: ${sr.step.id} - ${sr.step.description} (工具: ${sr.step.tool})]`;
    const body = sr.result.error
      ? `执行错误：${sr.result.error}`
      : sr.result.content;
    return `${header}\n${body}`;
  });
}
