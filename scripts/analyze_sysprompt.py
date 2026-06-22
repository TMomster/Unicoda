"""Count template literal content in buildAgentSystemPrompt properly."""
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/services/agentEngine.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# Find the function
start = text.index('function buildAgentSystemPrompt(')

# Find function end: count braces OUTSIDE template literals
brace_count = 0
in_template = False
in_str = False
str_char = None
end = start

i = start
while i < len(text):
    c = text[i]

    # Handle backslash escapes
    if c == '\\':
        i += 2
        continue

    # Toggle template literal
    if c == '`' and not in_str:
        in_template = not in_template
        i += 1
        continue

    if in_template:
        i += 1
        continue

    # Toggle regular string
    if c in '"\'' and not in_str:
        in_str = True
        str_char = c
        i += 1
        continue
    elif in_str and c == str_char:
        in_str = False
        str_char = None
        i += 1
        continue

    if not in_str:
        if c == '{':
            brace_count += 1
        elif c == '}':
            brace_count -= 1
            if brace_count == 0:
                end = i + 1
                break

    i += 1

func_text = text[start:end]
lines = func_text.count('\n') + 1
print(f'Function: {len(func_text)} chars, {lines} lines')
print(f'Estimated raw tokens (chars//3): ~{len(func_text)//3}')

# Now extract all template literal content within the function
in_template = False
in_str = False
str_char = None
template_contents = []
current_template = []

i = 0
while i < len(func_text):
    c = func_text[i]

    # Handle backslash escapes
    if c == '\\':
        if in_template:
            current_template.append(c)
        if i + 1 < len(func_text):
            i += 1
            if in_template:
                current_template.append(func_text[i])
        i += 1
        continue

    # Toggle template literal
    if c == '`' and not in_str:
        if not in_template:
            in_template = True
            current_template = []
        else:
            in_template = False
            template_contents.append(''.join(current_template))
            current_template = []
        i += 1
        continue

    if in_template:
        current_template.append(c)
        i += 1
        continue

    # Toggle regular string
    if c in '"\'' and not in_str:
        in_str = True
        str_char = c
        i += 1
        continue
    elif in_str and c == str_char:
        in_str = False
        str_char = None
        i += 1
        continue

    i += 1

total_template_chars = sum(len(t) for t in template_contents)
print(f'\nTotal template content: {total_template_chars} chars across {len(template_contents)} sections')
print(f'Estimated tokens (chars//3 for mixed CN/EN): ~{total_template_chars // 3}')
print(f'Estimated tokens (chars//4 for EN-heavy): ~{total_template_chars // 4}')

# Show largest sections
sections = [(len(t), t[:100].replace('\n', ' ')) for t in template_contents]
sections.sort(reverse=True)
print(f'\nTop 15 largest template sections:')
for sz, preview in sections[:15]:
    safe_preview = preview.encode('ascii', 'ignore').decode('ascii')
    print(f'  {sz:5d} chars (~{sz//3}-{sz//4} tok): {safe_preview}')
