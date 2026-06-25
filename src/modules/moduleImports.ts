/**
 * 内置模组静态导入索引。
 *
 * 各模组文件在顶层调用 registerModule() 自注册，静态导入确保：
 * 1. 打破循环依赖（registry.ts 不再导入 builtins）
 * 2. 生产构建时 Rollup 不会 tree-shake 掉这些模块
 *
 * 必须在 registry.ts 初始化之后被导入（在 App.tsx 中通过 initBuiltinModules() 触发）。
 * 此文件仅作导入用途，无导出。
 */
import "./builtins/getCurrentTime";
import "./builtins/webSearch";
import "./builtins/fetchPage";
import "./builtins/summaryPage";
import "./builtins/readFromFiles";
import "./builtins/writeToFile";
import "./builtins/executeCommand";
import "./builtins/runCodeSandbox";
import "./builtins/searchInProject";
import "./builtins/searchFile";
import "./builtins/getProjectReview";
import "./builtins/checkApiBalance";
import "./builtins/lintCode";
import "./builtins/getUnicodaStatus";
import "./builtins/getWorkspaceInfo";
import "./builtins/editFile";
import "./builtins/openPermissionDialog";
import "./builtins/virtualParameterCalibration";
import "./builtins/systemMessageFlow";
import "./builtins/getPlusStatus";
import "./builtins/xmemoryGranule";
