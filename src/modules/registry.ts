import type { Module } from "./types";

const modules: Module[] = [];

/** 注册一个内置模组。重复 id 会被忽略并给出警告。 */
export function registerModule(mod: Module): void {
  if (modules.some((c) => c.id === mod.id)) {
    console.warn(`[Modules] 模组 "${mod.id}" 已注册，跳过`);
    return;
  }
  modules.push(mod);
}

/** 按 id 查找模组 */
export function getModule(id: string): Module | undefined {
  return modules.find((c) => c.id === id);
}

/** 获取所有已注册的模组 */
export function getAllModules(): Module[] {
  return [...modules];
}

/** 初始化所有内置模组 */
export function initBuiltinModules(): void {
  // 各模组的注册函数会在模块顶层调用 registerModule
  import("./builtins/getCurrentTime");
  import("./builtins/webSearch");
  import("./builtins/fetchPage");
  import("./builtins/summaryPage");
  import("./builtins/readFromFiles");
  import("./builtins/writeToFile");
}
