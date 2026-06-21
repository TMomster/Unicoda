/**
 * 获取 Yolo 工作区信息模组。
 *
 * 范围：yolo（仅在 Yolo 模式下可用）
 * 无参数。
 *
 * 作用：让模型了解当前 Yolo 工作区的路径和状态，
 * 便于在工作区内进行文件浏览、搜索等项目操作。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";

// ─── 全局共享状态 ───────────────────────────────────

let currentWorkspacePath = "";

/**
 * 更新当前工作区路径（供 YoloPanel.tsx 调用）。
 */
export function updateWorkspacePath(path: string): void {
  currentWorkspacePath = path;
}

// ─── 模组定义 ────────────────────────────────────────

const mod: Module = {
  id: "get_workspace_info",
  name: "获取工作区信息",
  description:
    "获取当前 Yolo 工作区的路径信息。" +
    "当你需要了解当前正在操作的项目目录时使用。" +
    "调用后返回工作区路径，你可以据此使用其他模组（如 read_from_files、search_in_project）在工作区内浏览和操作文件。" +
    "注意：此模组仅在 Yolo 模式下可用。",
  userDescription: "获取当前 Yolo 工作区的路径信息",
  level: "normal",
  scope: "yolo",
  parameters: [],
  execute: async function* (_params, _signal) {
    if (!currentWorkspacePath) {
      yield (
        "当前未设置工作区。\n\n" +
        "Yolo 模式下的工作区是一个项目目录，设置后你可以在此目录内进行文件浏览、内容搜索、项目分析等操作。\n\n" +
        "请用户通过以下方式设置工作区：\n" +
        "1. 点击聊天窗口顶部的工作区图标（文件夹形状）\n" +
        "2. 在弹出的对话框中选择一个项目文件夹\n" +
        "3. 设置完成后，你就可以使用 read_from_files、search_in_project、get_project_review 等模组在此目录内操作\n\n" +
        "注意：工作区路径需要用户在界面中手动选择，你无法通过任何模组（包括 execute_command）来设定或修改工作区路径。"
      );
      return;
    }
    const lines = [
      `当前工作区路径：${currentWorkspacePath}`,
      "",
      `该目录已设置完成，你可以使用以下模组在工作区内操作：`,
      `- read_from_files：浏览目录内容、读取文件`,
      `- search_in_project：搜索文件名或文件内容`,
      `- get_project_review：分析项目整体结构`,
      `- execute_command：在终端中执行命令（如 git status、npm test 等）`,
      `- write_to_file：创建或修改文件`,
      `- lint_code：对代码文件进行语法和风格检查`,
      "",
      "提示：如果用户提及的文件路径在当前工作区内，可以直接使用；" +
      "如果提及的路径在工作区之外，需要用户指定绝对路径，且部分模组可能无法访问工作区外的路径。",
    ];
    yield lines.join("\n");
  },
};

registerModule(mod);
