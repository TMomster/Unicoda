import type { Mode, PanelMode } from "../types";

/**
 * 模组的权限等级。
 * - "normal": 普通模组，所有模式（Chat, Agent）均可用
 * - "sensitive": 敏感模组，仅 Agent 可用，Chat 无权调用（当前尚未实现）
 */
export type ModuleLevel = "normal" | "sensitive";

/**
 * 模组的适用范围。
 * - "universal": 通用模组，所有工作模式（普通/Yolo）均可用
 * - "yolo": Yolo 特化模组，仅在 Yolo 工作模式下可用
 */
export type ModuleScope = "universal" | "yolo";

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
  /** 给模型看的详细描述（注入到 system prompt） */
  description: string;
  /** 给用户看的简要能力说明（在组件界面展示） */
  userDescription?: string;
  level: ModuleLevel;
  /** 模组适用范围：universal（通用）| yolo（Yolo 特化），默认为 universal */
  scope?: ModuleScope;
  /** 是否强制 Security 审批（即使 level 为 normal 也会触发 Security 守护） */
  forceSecurity?: boolean;
  /** 参数定义（用于自动生成文档） */
  parameters?: ModuleParameter[];
  /** 执行模组，产出文本流 */
  execute: (
    params: Record<string, string>,
    signal?: AbortSignal,
  ) => AsyncGenerator<string>;
}

/**
 * 根据对话模式和工作模式筛选可见的模组列表。
 * @param mode    对话模式（Chat / Agent），控制 level 过滤
 * @param panelMode 工作模式（Default / Yolo），控制 scope 过滤
 */
export function getModulesForMode(
  all: Module[],
  mode: Mode,
  panelMode?: PanelMode,
): Module[] {
  const effectivePanel = panelMode ?? "Default";
  let filtered = all;
  // level 过滤：Chat 模式仅 normal 级可见
  if (mode === "Chat") {
    filtered = filtered.filter((c) => c.level === "normal");
  }
  // scope 过滤：非 Yolo 模式隐藏 yolo 特化模组
  if (effectivePanel !== "Yolo") {
    filtered = filtered.filter((c) => (c.scope ?? "universal") !== "yolo");
  }
  return filtered;
}
