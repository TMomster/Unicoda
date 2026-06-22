import os, sys

# Set stdout to UTF-8
sys.stdout.reconfigure(encoding='utf-8')

script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)

# Replacements for knowledgeBase.ts
kb_replacements = [
    ("`read_from_files list_dir`", "\\`read_from_files list_dir\\`"),
    ("`search_file` **递归遍历所有子目录**", "\\`search_file\\` **递归遍历所有子目录**"),
    ("必须用 `search_file`，用 `list_dir`", "必须用 \\`search_file\\`，用 \\`list_dir\\`"),
    ("调用 **`search_file`**", "调用 **\\`search_file\\`**"),
    ("`search_file` 从指定", "\\`search_file\\` 从指定"),
    ("`read_from_files list_dir` 的区别", "\\`read_from_files list_dir\\` 的区别"),
    ("`list_dir` 只能看到", "\\`list_dir\\` 只能看到"),
    ("`dirA/subdirB/fileC`", "\\`dirA/subdirB/fileC\\`"),
    ("`search_file` 一次调用就能", "\\`search_file\\` 一次调用就能"),
    ("`search_file(pattern=", "\\`search_file(pattern="),
    ("`list_dir` 逐层查看", "\\`list_dir\\` 逐层查看"),
    ("`list_dir` 需要 cd 三次才能看到", "\\`list_dir\\` 需要 cd 三次才能看到"),
    ("`list_dir` 只能看当前目录的一级", "\\`list_dir\\` 只能看当前目录的一级"),
    ("`SteamLibrary/steamapps/common/Riddle Joker/`", "\\`SteamLibrary/steamapps/common/Riddle Joker/\\`"),
    ("`search_file` 更高效", "\\`search_file\\` 更高效"),
    ("用 `search_file`", "用 \\`search_file\\`"),
    ("`list_dir` 的核心区别", "\\`list_dir\\` 的核心区别"),
    ("`dirA/subdirB/fileC` 里", "\\`dirA/subdirB/fileC\\` 里"),
    ("`list_dir` 根本看不到它", "\\`list_dir\\` 根本看不到它"),
    ("`cd` 进去再 `list_dir`", "\\`cd\\` 进去再 \\`list_dir\\`"),
    ("`list_dir` 来做深层文件查找", "\\`list_dir\\` 来做深层文件查找"),
    ("文件名搜索的优先级：`search_file` > 逐级 `list_dir`", "文件名搜索的优先级：\\`search_file\\` > 逐级 \\`list_dir\\`"),
    ("`search_file(pattern=\"", "\\`search_file(pattern=\""),
    ("  `search_file(pattern=", "  \\`search_file(pattern="),
    ("  `list_dir(", "  \\`list_dir("),
    ("`search_file`（通配符模糊匹配）", "\\`search_file\\`（通配符模糊匹配）"),
    ("`search_in_project`", "\\`search_in_project\\`"),
    ("`search_file`（递归搜索所有子目录）", "\\`search_file\\`（递归搜索所有子目录）"),
    ("`search_file` 优先于逐级 `list_dir`", "\\`search_file\\` 优先于逐级 \\`list_dir\\`"),
    ("`search_file` 或 `read_from_files` 逐级查看", "\\`search_file\\` 或 \\`read_from_files\\` 逐级查看"),
    ("`list_dir` 至少要 cd 4 次", "\\`list_dir\\` 至少要 cd 4 次"),
    ("`search_file` 一次调用就能穿透", "\\`search_file\\` 一次调用就能穿透"),
]

agent_replacements = [
    ("不要用 `read_from_files get_info`", "不要用 \\`read_from_files get_info\\`"),
    ("`get_info` 需要一个", "\\`get_info\\` 需要一个"),
    ("而不是 `read_from_files get_info`", "而不是 \\`read_from_files get_info\\`"),
    ("`read_from_files get_info(", "\\`read_from_files get_info("),
    ("`search_file(pattern=", "\\`search_file(pattern="),
    ("`get_info` 仅适用于", "\\`get_info\\` 仅适用于"),
    ("`read_from_files get_info` 来检查模糊名称的文件是否存在", "\\`read_from_files get_info\\` 来检查模糊名称的文件是否存在"),
    ("`get_info` 需要精确路径", "\\`get_info\\` 需要精确路径"),
]

for file_rel, replacements in [("src/services/knowledgeBase.ts", kb_replacements), 
                                 ("src/services/agentEngine.ts", agent_replacements)]:
    filepath = os.path.join(project_root, file_rel)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
        else:
            print("MISS: " + old[:40])
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("OK: " + os.path.basename(file_rel))
