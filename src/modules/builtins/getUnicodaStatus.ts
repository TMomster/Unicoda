/**
 * 获取 Unicoda 工作状态模组。
 *
 * 等级：normal（所有模式可用）
 * 无参数。
 *
 * 作用：让模型了解当前的 Unicoda 工作模式（普通/Yolo）和对话模式（Chat/Agent），
 * 避免模型对自身运行状态做出错误判断。
 */
import type { Module } from "../types";
import type { PanelMode, Mode } from "../../types";
import { registerModule } from "../registry";

// ─── 全局共享状态 ───────────────────────────────────

interface UnicodaStatus {
  panelMode: PanelMode;
  mode: Mode;
}

let currentStatus: UnicodaStatus = {
  panelMode: "Default",
  mode: "Chat",
};

/**
 * 更新 Unicoda 工作状态（供 App.tsx / YoloPanel.tsx 调用）。
 */
export function updateUnicodaStatus(status: UnicodaStatus): void {
  currentStatus = { ...status };
}

// ─── 模组定义 ────────────────────────────────────────

const mod: Module = {
  id: "get_unicoda_status",
  name: "获取 Unicoda 工作状态",
  description:
    "获取当前 Unicoda 的运行状态，包括工作模式（普通模式 Default / Yolo 模式）和对话模式（Chat / Agent）。" +
    "当你需要了解当前自己在什么模式下运行、或者判断用户所说的'模式'具体是指哪种模式时使用。" +
    "工作模式决定了 UI 布局：普通模式是全功能桌面窗口，Yolo 模式是轻量独立窗口。" +
    "对话模式决定了你能调用的模组范围：Chat 模式下只能调用普通(normal)模组，Agent 模式下可调用所有模组。" +
    "调用后直接返回当前工作状态的文字描述，你可以直接引用或转述。",
  userDescription: "获取当前 Unicoda 的工作模式（普通/Yolo）和对话模式（Chat/Agent）信息",
  level: "normal",
  parameters: [],
  execute: async function* (_params, _signal) {
    const panelText = currentStatus.panelMode === "Yolo" ? "Yolo 模式" : "普通模式（Default）";
    const modeText = currentStatus.mode === "Agent" ? "Agent（完整模式，可调用全部模组）" : "Chat（轻量模式，仅调用 normal 级模组）";
    const note =
      currentStatus.panelMode === "Yolo" && currentStatus.mode === "Chat"
        ? "Yolo 模式带有工作区概念，适合项目开发，推荐切换为 Agent 模式以使用完整模组能力。"
        : "";
    const lines = [
      `当前工作模式：${panelText}`,
      `当前对话模式：${modeText}`,
    ];
    if (note) lines.push(`提示：${note}`);
    yield lines.join("\n");
  },
};

registerModule(mod);
