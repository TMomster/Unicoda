/**
 * open_permission_dialog 模组
 *
 * 由 LLM 调用，重新打开操作审批对话框，让用户可以修改权限设置。
 * 执行后返回一个特殊标记，由 useChatStream 检测并触发 UI 层的审批对话框。
 */

import { registerModule } from "../registry";

registerModule({
  id: "open_permission_dialog",
  name: "打开权限设置对话框",
  description: `当用户要求修改敏感操作的审批设定时，调用此模组重新打开操作确认对话框。`,
  level: "sensitive",
  parameters: [],
  execute: async function* () {
    yield "__OPEN_PERMISSION_DIALOG__";
  },
});
