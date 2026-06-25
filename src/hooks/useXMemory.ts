/**
 * useXMemory — XMemory 特化记忆 Hook 快捷入口
 *
 * 重新导出 useXMemory hook，方便按目录约定 import。
 *
 * 用法：
 *   import { useXMemory } from "../hooks/useXMemory";
 *   const { cards, createCard, deleteCard, ... } = useXMemory();
 */
export { useXMemory } from "../contexts/XMemoryContext";
