import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/services/agentEngine.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_start = '    parts.push(`## 模组选择指南'
new_start = '    parts.push(`## 模组选择指南\n\n1. **\\`web_search\\`**：先搜索。金融数据（股价/市值）必须用英文关键词+en-US\n2. **\\`fetch_page\\`**：需深入阅读原文时使用。用户说"看看XX内容/打开XX链接"时直接调用。⚠️ 不适用于雪球/东方财富等JS动态渲染站点\n3. **\\`summary_page\\`**：长篇文章需快速提炼要点\n4. **\\`read_from_files\\`**：浏览目录结构/读取文件。\\`pwd\\`→\\`list_dir\\` 查目录，\\`read_file\\` 读文件。\\`get_info\\` 仅确认具体文件是否存在；模糊名称用 \\`search_file\\`\n5. **\\`search_file\\`**：按文件名搜索（glob通配符）。模糊匹配优先用，搜不到换拼写重试\n6. **\\`search_in_project\\`**：项目内搜索代码关键词/函数定义/变量引用\n7. **\\`get_project_review\\`**：分析项目技术栈和整体架构`);'

old_end = '会读取关键配置文件（package.json、Cargo.toml 等）并展示目录树`);'

# Find start and end
start_idx = content.find(old_start)
end_idx = content.find(old_end, start_idx)

if start_idx >= 0 and end_idx >= 0:
    end_idx += len(old_end)
    print(f'Found module selection guide at {start_idx}-{end_idx}')
    old_text = content[start_idx:end_idx]
    print(f'Old length: {len(old_text)} chars')
    print(f'New length: {len(new_start)} chars')
    content = content[:start_idx] + new_start + content[end_idx:]
    with open('src/services/agentEngine.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'SUCCESS: Saved {len(old_text) - len(new_start)} chars')
else:
    print(f'ERROR: start_idx={start_idx}, end_idx={end_idx}')
