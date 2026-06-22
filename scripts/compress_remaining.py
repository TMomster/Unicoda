import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/services/agentEngine.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# === Optimization: Error retry guide (lines ~352-370) ===
old_retry = '''    if (mode === "Agent") {
      parts.push(\`## 🔄 错误修正与自动重试

当工具调用执行**失败**时（如编译错误、运行错误、文件写入失败、搜索超时等），你应该主动分析错误并尝试修复：

1. **分析错误**：仔细阅读工具返回的错误信息，定位问题原因（是代码 bug、路径错误、网络问题还是参数问题？）
2. **制定修复方案**：确定需要修改哪些文件、调整哪些参数、更换哪些搜索策略
3. **发起修复调用**：使用 \`<tool_call>\` 执行修正操作（如 \`edit_file\` 修改代码、\`execute_command\` 重新编译、更换搜索词重新搜索）
4. **最多可以对同一个步骤进行 3 次修复尝试**。如果 3 次后仍失败，向用户如实说明并提供替代建议。

**常见重试场景：**
- \`execute_command\` 返回编译/运行错误 → 分析错误日志 → \`edit_file\` 修改 → 重新 \`execute_command\`
- \`write_to_file\` 失败 → 检查路径权限 → 调整路径重试
- \`search_file\` 无结果 → 换用不同拼写/通配符重试（如 \`*Sanoba*\` → \`*Witch*\`）
- \`web_search\` 结果不理想 → 换用不同搜索词或语言重试
- **修改代码后验证**：\`edit_file\` 修改代码 → \`lint_code\` 检查语法/类型错误 → 如有报错再 \`edit_file\` 修正 → 重新 \`lint_code\` 确认

> 注意：如果使用任务计划模式（\`<task_plan>\`），计划完成后框架会自动启动错误重试阶段，无需你在计划中手动安排重试步骤。\`);'''

new_retry = '''    if (mode === "Agent") {
      parts.push(\`## 🔄 错误修正与自动重试

工具调用失败时：分析错误 → 制定修复方案 → 用 \`<tool_call>\` 执行修正。同一步骤最多试 3 次，失败后向用户说明并提供替代方案。

**常见重试**：编译错误→分析日志→\`edit_file\`→重编译；写入失败→检查路径权限；搜索无结果→换拼写/关键词重试；\`edit_file\`后→\`lint_code\`验证。任务计划模式的错误重试由框架自动处理。\`);'''

if old_retry in content:
    content = content.replace(old_retry, new_retry)
    print(f'Error retry guide: {len(old_retry)} -> {len(new_retry)} chars (saved {len(old_retry)-len(new_retry)})')
else:
    print('ERROR: Error retry guide not found')

# === Optimization: Call rules (lines ~372-412) ===
old_rules = '''    // ── 调用规则（两种模式共享） ──
    parts.push(\`## 调用规则

1. **并行调用**：多个 \`<tool_call>\` 块可以在同一次回复中输出，它们会被**并行执行**。
2. 模组执行结果会以 \`role: "tool"\` 的消息形式返回，注意识别每个结果对应的工具 ID。

### 🚨 关键规则：如果决定调用工具，回复必须以 \`<tool_call>\` 开头

当你判断需要调用工具时，你的回复**必须以 \`<tool_call>\` 标签开头**，不允许在调用工具之前先输出任何对话文本。

**正确做法：**
\`\`\`
<tool_call>
{
  "id": "web_search",
  "params": { "query": "今天 科技 新闻", "count": "5" }
}
</tool_call>
\`\`\`
→ 等待工具结果返回后，再基于结果生成完整的面向用户的回复。

**❌ 错误做法（千万避免）：**
\`\`\`
好的，我来搜索一下今天的科技新闻！
<tool_call>
{
  "id": "web_search",
  "params": { "query": "今天 科技 新闻", "count": "5" }
}
</tool_call>
\`\`\`
→ 这种格式中先输出了对话文本，\`<tool_call>\` 标签虽然也在回复中，但混在文本中容易被模型遗漏或忘记输出。**如果你先输出了一句话，模型的惯性会让你继续输出更多文本而不是转到 \`<tool_call>\`。记住：只要你在心中决定了要调用工具，你的第一个输出字符就应该是 \`<\`。**

**❌ 另一个常见错误：**
\`\`\`
好的，让我来看看这个目录里有什么！
\`\`\`
→ 这种回复中完全没有 \`<tool_call>\` 标签，工具永远不会被调用，用户会看到你在"口头答应"但什么都没做。

**如何判断你已经在回复中包含了 \`<tool_call>\`？**
如果你在思考过程中已经决定"我需要调用XX模组"、"我需要搜索"、"我需要查看目录"，**那么你的回复必须包含 \`<tool_call>\` 标签。** 检查一下：你的回复中是否有 \`<tool_call>\` 开头？如果没有，说明你正在输出"空头支票"——用户只会看到承诺，看不到实际行动。\`);'''

new_rules = '''    // ── 调用规则（两种模式共享） ──
    parts.push(\`## 调用规则

1. **并行调用**：多个 \`<tool_call>\` 可在同一次回复中输出，并行执行
2. 结果以 \`role: "tool"\` 返回，注意对应工具 ID
3. **关键规则：决定调用工具时，回复必须以 \`<tool_call>\` 开头**。不允许先输出对话文本再跟标签——这会让模型惯性继续输出而不是执行调用。如果不确定，检查回复首字符是否是 \`<\`。\`);'''

if old_rules in content:
    content = content.replace(old_rules, new_rules)
    print(f'Call rules: {len(old_rules)} -> {len(new_rules)} chars (saved {len(old_rules)-len(new_rules)})')
else:
    print('ERROR: Call rules not found')
    # Debug: find partial match
    idx = content.find('调用规则')
    if idx > 0:
        print(f'Found "调用规则" at {idx}')
        print(f'Context: {repr(content[idx-20:idx+50])}')

with open('src/services/agentEngine.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('\nDone')
