"""为 knowledgeBase.ts 中所有内置条目添加 retrievalType 字段"""
import re

path = r"g:\CodeBuddySpace\Unison\src\services\knowledgeBase.ts"
with open(path, mode="r", encoding="utf-8") as f:
    content = f.read()

# Define retrievalType for each builtin entry by id
retrieval_map = {
    "kb-unicoda-intro": "inject",
    "kb-emoji-usage": "inject",
    "kb-communication-attitude": "inject",
    "kb-unicoda-ui-features": "inject",
    "kb-current-time": "inject",
    "kb-common-tech": "retrieve",
    "kb-powershell-51": "retrieve",
    "kb-internet-search-permission": "inject",
    "kb-windows-exec": "inject",
    "kb-cmd-vs-powershell": "retrieve",
    "kb-pip-best-practice": "retrieve",
    "kb-exec-fallback": "retrieve",
    "kb-modules": "inject",
    "kb-yolo-project-concept": "inject",
    "kb-yolo-project-modules": "inject",
    "kb-yolo-workspace-not-set": "inject",
    "kb-file-lookup": "retrieve",
    "kb-task-planner": "inject",
    "kb-security": "inject",
}

# Pattern: builtin entry with mode: "framework" or mode: "yolo", already has summary
# We add retrievalType after the mode line
def add_retrieval_type(content):
    result = content
    for entry_id, rt in retrieval_map.items():
        # Search for pattern: id: "entry_id", ... mode: "xxx",
        id_pattern = f'    id: "{entry_id}",'
        idx = result.find(id_pattern)
        if idx == -1:
            print(f"WARNING: could not find entry {entry_id}")
            continue
        
        # Find the mode: line after this id
        after_id = result[idx:]
        mode_match = re.search(r'    mode: "(framework|yolo)",', after_id)
        if not mode_match:
            print(f"WARNING: could not find mode line for {entry_id}")
            continue
        
        mode_line = mode_match.group(0)
        mode_end = idx + mode_match.end()
        
        # Insert retrievalType after mode line
        insert_at = mode_end
        insertion = f"\n    retrievalType: \"{rt}\","
        result = result[:insert_at] + insertion + result[insert_at:]
        print(f"Added retrievalType: \"{rt}\" for {entry_id}")
    
    return result

new_content = add_retrieval_type(content)
with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Done!")
