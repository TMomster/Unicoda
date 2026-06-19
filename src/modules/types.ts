import type { Mode } from "../types";

/**
 * 模组的权限等级。
 * - "normal": 普通模组，所有模式（Chat, Agent）均可用
 * - "sensitive": 敏感模组，仅 Agent 可用，Chat 无权调用（当前尚未实现）
 */
export type ModuleLevel = "normal" | "sensitive";

/**
 * 模组参数的元数据定义。
 */
export interface ModuleParameter {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
  /** 可选默认值 */
  default?: string;
  /** 可选最大值 / 最小值约束 */
  max?: number;
  min?: number;
}

/**
 * 一个模组的定义。
 */
export interface Module {
  id: string;
  name: string;
  description: string;
  level: ModuleLevel;
  /** 参数定义（用于自动生成文档） */
  parameters?: ModuleParameter[];
  /** 执行模组，产出文本流 */
  execute: (
    params: Record<string, string>,
    signal?: AbortSignal,
  ) => AsyncGenerator<string>;
}

/**
 * 根据模式筛选可见的模组列表。
 */
export function getModulesForMode(
  all: Module[],
  mode: Mode,
): Module[] {
  if (mode === "Chat") return all.filter((c) => c.level === "normal");
  // Agent 模式：所有模组（包括敏感模组）可见
  return [...all];
}
