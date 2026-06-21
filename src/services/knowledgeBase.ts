/**
 * 知识库服务
 *
 * 提供预设的知识条目 + 用户自定义知识卡管理。
 * 内置条目只读（仅展示标题），用户知识卡支持 CRUD。
 * 在 Agent 模式下知识库会注入到系统提示词中。
 */

import { writeConfigFile } from "../utils/configStorage";

export type KnowledgeMode = "framework" | "normal" | "yolo";

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  /** 标签分类 */
  category: "platform" | "reference";
  /** 是否为内置条目（内置不可编辑/删除） */
  builtin: boolean;
  /** 知识库层级：framework=框架级（所有模式共享）、normal=普通模式专用、yolo=Yolo模式专用 */
  mode: KnowledgeMode;
  /** 卡片缩略描述（内置条目预设，用户卡片可选）。未设置时取 content 前 50 字。 */
  summary?: string;
}

const USER_CARDS_KEY = "unicoda-user-knowledge-cards";

const builtinEntries: KnowledgeEntry[] = [
  {
    id: "kb-unicoda-intro",
    title: "Unicoda 平台简介",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "Unicoda 平台的基本信息、工作模式、对话模式和助手设定",
    content: `Unicoda 是一个模块化 AI 助手桌面应用，基于 Tauri v2 + React 构建。

## 🏢 工作模式（Work Mode）
用户可以选择两种工作模式，**两种工作模式均支持 Chat 和 Agent 两种对话模式**：

1. **普通模式（Default）**：全功能桌面窗口，含侧边栏会话列表、主聊天区域、设置面板等。整体体验更接近网页版聊天界面，适合日常对话、信息查询、快速帮助等场景。在此模式下用户可在 Chat 和 Agent 两种对话模式间自由切换。

2. **Yolo 模式**：轻量独立窗口，拥有独立的会话管理和**工作区系统**。每个会话可独立记录自己的工作区路径（项目目录），适合本地项目开发场景如代码编写、文件操作、项目分析、命令执行等。Yolo 模式同样支持 Chat 和 Agent 两种对话模式，用户可以根据需要切换。

切换到 Yolo 模式后，对话会独立于普通模式的会话，两个模式之间的会话不互通。

## 💬 对话模式（Dialog Mode）
两种工作模式下均可使用以下两种对话模式：
- **Chat 模式**：轻量模式。支持调用普通（normal 级）模组。适合日常对话、简单查询、代码帮助。
- **Agent 模式**：完整模式。支持所有模组，支持多轮工具调用（最多 5 轮）、并行调用、串行调用。适合需要多次搜索、文件操作、代码执行等复杂任务。

## 🧩 模组系统
Unicoda 提供了 13 个内置功能扩展模组（Module），涵盖联网搜索、网页获取、文件读写、命令执行、代码检查等能力。所有模组等级为 normal（普通模式 Chat 和 Agent 均可用）。详见"模组系统概览"知识卡。

## 💪 核心能力
- 文件读写：在项目目录中读取和写入文件
- 命令执行：在终端中运行命令并获取输出
- 代码生成与修改：创建、修改和重构代码
- 项目分析：分析项目结构、读取源代码、检查语法风格
- 联网搜索：通过 Bing 搜索获取实时信息
- **自我认知**：可使用 get_unicoda_status 模组确认当前的工作模式和对话模式，当用户提及"模式"相关概念时先调用此模组确认自身状态，避免混淆

## ⚠️ 重要：关于 Unicoda 自身的问题
**当用户询问 Unicoda 自身的功能、UI界面、按钮作用、概念解释等问题时，请直接根据本知识库中的信息回答，不要调用 web_search、fetch_page、summary_page 等联网模组去搜索。** 原因：
1. Unicoda 是本地桌面应用，互联网上不存在关于其 UI 细节的在线文档
2. 本知识库已涵盖了 Unicoda 的所有核心功能、UI 按钮说明和模组系统信息
3. 如果用户问到的细节超出了你的知识库覆盖范围，诚实告知用户"我现在没有这方面的详细信息"即可

例如用户问"压缩上下文这个按钮是干啥的"、"这个面板怎么用"、"设置在哪里"等，都是关于 Unicoda 自身界面的问题，应直接从知识库中查找答案，不要尝试联网搜索。

## 📌 关于"模式"的重要说明
用户提到"模式"时可能是以下两种含义之一，你需要通过 **get_unicoda_status** 确认当前实际状态：
1. **工作模式（Work Mode）**：普通模式（Default）或 Yolo 模式——影响 UI 布局和会话管理。普通模式更适合日常聊天，Yolo 模式自带工作区概念，适合项目开发。
2. **对话模式（Dialog Mode）**：Chat 或 Agent——影响你调用模组的范围。两种工作模式下均可自由切换。
注意：**工作模式和对话模式是互相独立的**。Yolo 模式并不绑定 Agent，两种工作模式都支持 Chat 和 Agent 两种对话模式。用户可以在任何工作模式下选择任意对话模式。
⚠️ **重要：你无法主动切换工作模式或对话模式！** 这些切换只能由用户在界面上手动操作（通过侧边栏或设置面板）。你可以向用户说明不同模式的区别并**建议切换**（例如"建议切换到 Agent 模式以使用完整功能"），但**不能询问用户是否需要你帮忙切换**，因为你根本没有切换的权限。正确的做法是如实告知用户"请在界面中手动切换"。

建议：当用户问"你在什么模式下"或提及"模式"概念时，**先调用 get_unicoda_status 确认当前状态**，再给出准确回复。`,
  },
  {
    id: "kb-emoji-usage",
    title: "表情使用规范",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "Unicoda 回复中应避免使用的表情符号及原因",
    content: `### 表情使用注意事项

在中文互联网环境中，部分表情符号带有负面含义，在回复中使用可能引起用户不适或误解：

**😅 流汗黄豆（sweating smiley）**
- 在 Bilibili、微博、贴吧等中文平台上，这个表情常被用于表达**嘲讽、阴阳怪气、幸灾乐祸**等含义
- 例如在争议性讨论中，用户发😅表示"你说的都对🙄"、"你就继续这样想吧"等挖苦态度
- 虽然其原始含义是尴尬/紧张/无奈，但在中文语境下已演变为**攻击性和冒犯性**较强的表达
- **建议**：在回复中不要使用😅表情。需要表达尴尬、无奈、抱歉等情绪时，使用其他表情代替，如😓、😔、🙏等`,
  },
  {
    id: "kb-unicoda-ui-features",
    title: "Unicoda 界面功能详解",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "Unicoda 所有 UI 按钮、面板和交互功能的详细说明",
    content: `### Unicoda 界面功能大全

以下是你需要了解的 Unicoda 桌面应用界面功能，当用户问界面上某个按钮/功能是做什么的时，参考以下内容回答：

---

## 📝 输入栏（InputBar）功能

**1. 对话模式选择器（Chat / Agent）**
输入栏左侧的下拉菜单，切换对话模式。
- Chat：轻量模式，适合日常对话、简单查询
- Agent：完整模式，支持多轮工具调用、并行串行调用，适合复杂任务
- 两种模式都属于**对话模式**，与工作模式（Default/Yolo）互相独立

**2. 模型选择器**
显示当前使用的 AI 模型名称。右侧有绿色状态指示灯（API Key 已配置时显示绿色）。点击可切换其他已配置的模型。

**3. 上下文容量指示器** — 位于输入栏底部
显示当前会话的 token 使用情况，格式为 "使用量/上限（百分比%）"。
- 侧边颜色条：蓝 → 绿 → 黄 → 红，随使用率升高变色
- 这帮助用户判断是否需要压缩上下文以减少 token 消耗

**4. 压缩上下文开关按钮** — 圆形切换按钮，文字标"压缩上下文"
- **作用**：开启后，Unicoda 会在对话达到一定长度时**自动**将早期对话压缩为 AI 生成的摘要
- 压缩后保留最近约 8 轮完整对话，更早的内容被替换为一段 200 字以内的中文摘要（以 [对话历史摘要] 开头）
- **好处**：减少 token 消耗、降低 API 费用、避免上下文超长导致模型响应变差
- **手动触发**：当使用率超过 50% 且消息数量足够时，输入栏还会显示一个 📦 图标按钮"压缩旧对话"，点击可手动立即压缩
- 压缩完成后显示 "✅ 已压缩" 标识

**5. 展开/收起输入框按钮**
输入栏右上角的箭头按钮，点击可将输入框切换到半屏高度，方便编写长文本。

**6. 发送按钮（纸飞机图标）**
点击发送当前输入框中的消息。无文本且无待上传文件时禁用。

**7. 停止生成按钮（红色方块图标）**
流式生成过程中，发送按钮会变为红色停止按钮，点击立即中止当前 AI 回复。

**8. 文件上传功能**
- 通过点击输入栏的附件区域触发文件选择器
- 只支持上传文本文件（.txt、.md、代码文件等）
- 选中的文件显示为芯片状标签，每个标签有移除按钮
- 也支持从系统文件管理器拖拽文件到输入栏（仅文本文件）
- 文件内容会随消息一起发送给 AI

**9. 底部版权信息**
显示"人工智能技术生成内容仅供参考"和"Unicoda · designed by Momster"。

---

## 💬 消息区域功能

**1. Markdown 切换按钮（M 字母图标）**
每条 AI 回复右上角的 M 按钮。点击切换该消息的渲染方式：Markdown 渲染（代码高亮/表格/列表等）或纯文本。默认行为可在设置面板中配置。

**2. 复制按钮（📋 图标 → ✅ 变绿）**
每条消息底部右侧。点击复制该消息的完整内容到剪贴板，复制成功后图标短暂变绿。

**3. 思维链/深度思考折叠面板**
AI 消息中，如果模型输出了 reasoning_content（思考过程），会显示一个可折叠/展开的思考面板，标题为"🤔 思考过程（Xs）"。
- 点击面板标题可展开查看完整的思考过程
- X 表示思考消耗的秒数
- 正在思考时显示"🤔 思考中..."替代时间
- 面板右上角有独立的复制按钮

**4. 工具调用进度与结果面板**
Agent 模式下调用模组时：
- **进行中**：显示彩虹球动画 + "正在发起工具调用..."
- **完成后**：显示 🔧 图标，默认折叠，可点击展开查看原始工具调用结果

**5. 开发者调试面板（🐞 图标）**
仅当设置面板中开启了"开发者模式"后可见。显示工具调用的原始参数、执行耗时（ms）、返回结果。帮助排查模组执行问题。

**6. API 错误面板**
当 API 返回错误（如 401 未授权、402 余额不足、429 频率限制等）时，消息区域会显示红色错误面板，包含中文错误说明，帮助用户诊断问题。

**7. 文件附件预览**
用户消息中附带的文件，点击文件芯片可打开预览面板查看文件内容。

---

## 📂 侧栏（Sidebar）功能

**1. 设置按钮（⚙️ 齿轮图标）**
打开设置面板，包含以下配置区域：
- **用户设置**：用户名、头像
- **界面设置**：语言（中文/English）、字体、缩放、主题（黑色/白色）
- **默认消息渲染**：Markdown / 纯文本
- **默认展开思考栏**：是否自动展开思维链面板
- **开发者模式**：开启后显示工具调试信息
- **模型配置**：添加/编辑/删除 AI 模型（名称、服务商、接口地址、API Key、系统提示词）
- **会话存储路径**：查看/选择对话数据存储位置
- **隐私锁定**：设置密码、闲置自动锁定（1~30分钟可选）、启动时锁定
- **Cookie 管理**：查看/清除搜索模组的 Cookie
- **重置配置**：重置所有外观和行为设置

**2. 组件管理按钮（四个方块图标）**
打开组件管理面板，包含两个 Tab：
- **模组**：列出所有已注册的工具模组，显示名称、级别标签、ID
- **知识库**：查看/搜索内置知识卡和用户自定义知识卡。支持添加/编辑/删除自定义知识卡，可设置知识卡层级（framework/normal/yolo）

**3. 打印按钮（🖨️ 打印机图标）**
打开打印对话框（也支持 Ctrl+P 快捷键）。用户可选择要打印的消息（支持全选/单独选择），设置打印配色（白色/黑色/Yolo），开关显示思考过程、模型信息、Unicoda 信息、许可证声明、锚点目录等选项。

**4. 新会话按钮（➕ 加号图标）**
创建新的空白会话。新会话自动命名 "新会话 N"。

**5. 会话搜索框**
输入关键词过滤会话列表。

**6. 会话列表**
显示所有会话，按置顶+更新时间排序。支持：
- **单击**：切换到该会话
- **双击**：内联编辑会话标题
- **右键菜单**：重命名/置顶（取消置顶）/删除
- **复选框**：勾选后进入批量操作模式（批量置顶/取消置顶/批量删除）

**7. 用户名称/头像（侧栏底部）**
点击可编辑用户显示名称。

**8. 拖拽调整宽度**
侧栏右侧边框可鼠标拖拽调整侧栏宽度。

---

## 🪟 全局功能

**1. 快捷键**
- Ctrl+P：打开打印对话框（需不在锁定/设置/组件面板中且有活跃会话）
- Ctrl+F12：快速锁定屏幕（需已设置密码）

**2. 锁定功能（LockOverlay）**
- 支持密码保护，启动时锁定、闲置自动锁定
- 锁定后整个界面被覆盖层遮挡，需输入密码解锁
- 支持置顶模式（返回顶部）

**3. 系统通知**
AI 回复完成后，会触发 Windows 系统通知 + 播放提示音。

**4. Toast 提示**
底部居中弹出式提示消息，例如"请先开始一个会话"，2 秒后自动消失。

**5. 主题切换**
支持暗色/亮色主题，通过设置面板切换。

**6. 语言切换**
支持简体中文和英文（en-US），通过设置面板切换。

---

## 🎯 Yolo 模式特有功能

**1. 工作区面板**
Yolo 模式特有的抽屉式面板，显示当前会话的工作区路径。提供"选择文件夹"按钮让用户设置或更改工作区。

**2. Yolo 会话侧栏**
从左侧滑入的会话管理面板，结构与普通模式侧栏类似但独立管理。支持会话搜索、批量选择/操作。

**3. 返回按钮（← 箭头）**
Yolo 面板顶部的返回按钮，点击切换回普通模式。

**4. 工作区路径**
每个 Yolo 会话可独立记录自己的项目路径，见 get_workspace_info 模组。`,
  },
  {
    id: "kb-current-time",
    title: "当前时区与日期",
    category: "reference",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "当前北京时间、UTC 时间和日期",
    content: `当前北京时间 (CST, UTC+8)：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
当前 UTC 时间：${new Date().toUTCString()}
今天的日期：${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}`,
  },
  {
    id: "kb-common-tech",
    title: "常用技术参考",
    category: "reference",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "TypeScript、React、Node、Rust、Tauri 等技术版本参考",
    content: `- TypeScript 版本：5.x
- React 版本：18.x
- Node.js 版本：22.x
- Rust 版本：1.85+
- Tauri 版本：2.x
- 包管理器：npm`,
  },
  {
    id: "kb-powershell-51",
    title: "PowerShell 5.1 脚本编写参考",
    category: "reference",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "PowerShell 5.1 脚本编写的编码、语法和错误处理参考",
    content: `## PowerShell 5.1 版本命令编辑注意事项

适用环境：Windows PowerShell 5.1（操作系统自带版本，非 PowerShell Core/7+）
目标：编写在 Windows 7/8/10/11 默认 PowerShell 环境中稳定运行的脚本

### 1. 编码问题（最常见坑）

**-Encoding 参数的有效值：**
Windows PowerShell 5.1 仅支持：Unknown, String, Unicode, Byte, BigEndianUnicode, UTF8, UTF7, UTF32, Ascii, Default, Oem, BigEndianUTF32。
**不支持 UTF8NoBOM**（会报错：无法将标识符名称与有效枚举器名称匹配）。

推荐写法：
\`\`\`powershell
# 生成带 BOM 的 UTF-8 文件
Set-Content -Path file.txt -Value "内容" -Encoding UTF8
# 生成无 BOM 的 UTF-8 文件需用 .NET 类
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("file.txt", "内容", $utf8NoBom)
\`\`\`

**重定向默认编码陷阱：**
- \`>\` / \`>>\` — UTF-16 LE (Unicode)
- \`Out-File\` — UTF-16 LE
- \`Set-Content\` — ASCII
- \`Export-Csv\` — ASCII
建议：始终显式指定 \`-Encoding\` 参数。

### 2. 禁止使用的 PowerShell Core 7+ 特性

以下语法在 5.1 中**不存在**，会导致脚本错误：
- \`&&\`, \`||\` 管道链 → 用 \`;\` 或 \`if ($?)\` 逐条判断
- 三元运算符 \`a ? b : c\` → 用 \`if (a) { b } else { c }\`
- \`??\` 空合并运算符 → 用 \`if ($null -eq $x) { ... }\`
- \`?.\` 成员访问运算符 → 显式 \`if ($x) { $x.Prop }\`
- \`::\` 静态泛型方法 → 用 .NET 反射
- \`Get-Error\` → 用 \`$Error[0]\`
- \`ForEach-Object -Parallel\` → 传统 foreach 循环

### 3. 外部命令调用

\`\`\`powershell
# 执行 exe 并获取退出码
& schtasks /create /tn "Task" /xml "file.xml" /f
if ($LASTEXITCODE -ne 0) {
    throw "schtasks 失败，退出码: $LASTEXITCODE"
}
# 调用 cmd 内部命令需通过 cmd /c
& cmd /c dir C:\\
# 调用 VBScript / JScript
& cscript //NoLogo script.vbs
\`\`\`

### 4. 路径与文件系统

- Windows PowerShell 5.1 受 **MAX_PATH = 260** 限制
- 推荐用 \`Join-Path\` 拼接路径，避免手动字符串拼接
- 检查路径：\`Test-Path \$path -PathType Container\`（目录）或 \`-PathType Leaf\`（文件）

### 5. 错误处理

\`\`\`powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try {
    Remove-Item -Path "lockedfile.txt" -Force -ErrorAction Stop
} catch {
    Write-Warning "删除失败: $($_.Exception.Message)"
}
# 外部命令错误检查
& myapp.exe
if ($LASTEXITCODE -ne 0) {
    throw "myapp.exe 返回错误码 $LASTEXITCODE"
}
\`\`\`

### 6. 推荐编码实践模板

\`\`\`powershell
#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
# 定义无 BOM 写入函数
function Set-ContentUtf8NoBom {
    param([string]\$Path, [string]\$Value)
    \$utf8NoBom = New-Object System.Text.UTF8Encoding \$false
    [System.IO.File]::WriteAllText(\$Path, \$Value, \$utf8NoBom)
}
\`\`\`

### 7. 版本检测

\`\`\`powershell
if (\$PSVersionTable.PSVersion.Major -ge 6) {
    # PowerShell Core 特有代码
} else {
    # Windows PowerShell 5.1 兼容代码
}
\`\`\`

### 总结：核心原则
1. **编码**：统一 \`-Encoding UTF8\`（带 BOM），无 BOM 需求用 .NET 类
2. **语法**：避免任何 PS7+ 新特性（&&、三元、空合并等）
3. **外部命令**：总是检查 \`$LASTEXITCODE\`
4. **路径**：用 \`Join-Path\`，注意长路径限制
5. **严格模式**：开启 \`Set-StrictMode\` 防止未初始化变量
6. **执行策略**：开发时临时绕过 \`Set-ExecutionPolicy -Scope Process Bypass\``,
  },
  {
    id: "kb-windows-exec",
    title: "Windows 命令执行经验",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "Windows 中文环境编码问题和 cmd 管道命令替代方案",
    content: `### ⚠️ Windows 中文环境编码问题

当通过 execute_command 或 run_code_sandbox 执行命令时，Windows 中文环境下 stdout/stderr 使用 **GBK 编码**，非 UTF-8。捕获到的中文输出在对话中会显示为乱码（如 "拒绝访问" 变成 "�ܾ�����"）。

**应对策略**：
- 对于可能输出中文的命令，在命令前加 \`chcp 65001 >nul &&\` 切换代码页到 UTF-8
- 优先使用纯 Python 方案（subprocess + text=True）替代 cmd 管道命令，subprocess 可自动处理编码
- 如果输出已经乱码，告知用户"命令已执行，但中文输出因编码问题显示异常"

### ⚠️ Windows cmd 管道命令的局限性

在 Windows 上，管道（\`|\`）命令在大数据量输出时极易失败，典型错误：
- \`Pipe to stdout was broken\`
- \`OSError: [Errno 22] Invalid argument\`

**应避免**的 pip 管道模式：
- \`pip list --format=freeze | find /c /v ""\`
- \`pip freeze | find /v /c ""\`

**推荐替代**：用纯 Python 一次性完成，不依赖 cmd 管道。`,
  },
  {
    id: "kb-cmd-vs-powershell",
    title: "execute_command 在 Windows 下使用 PowerShell 而非 cmd.exe",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "execute_command 使用 PowerShell 的语法路径和注意事项",
    content: `### ✅ 核心前提

从 2026-06 起，Windows 上 \`execute_command\` 模组使用 **PowerShell** 执行命令，不再使用 cmd.exe。

后端自动为每条命令前置 \`[Console]::OutputEncoding = [Text.Encoding]::UTF8;\` 确保中文正确输出（注意：PowerShell 5.1 不支持 \`ErrorEncoding\` 属性，仅设置 OutputEncoding）。

### ✅ 直接可用的 PowerShell 语法

**文件操作（直接使用 PowerShell cmdlet）：**
\`\`\`powershell
# 删除单个文件
Remove-Item -Path "G:\path\to\file.cpp" -Force

# 清空文件夹内容（保留文件夹本身）
Remove-Item -Path "G:\Desktop\NewCodeTest\*" -Recurse -Force

# 删除整个文件夹（含自身）
Remove-Item -Path "G:\Desktop\NewCodeTest" -Recurse -Force

# 创建目录
New-Item -Path "G:\Desktop\NewFolder" -ItemType Directory -Force

# 复制文件
Copy-Item -Path "source.txt" -Destination "dest.txt" -Force

# 移动/重命名
Move-Item -Path "source.txt" -Destination "dest.txt" -Force

# 列出目录内容
Get-ChildItem -Path "G:\Desktop" | Select-Object Name

# 读取文件内容
Get-Content -Path "G:\path\to\file.txt" -Encoding UTF8

# 写入文件内容
Set-Content -Path "G:\path\to\file.txt" -Value "content" -Encoding UTF8
\`\`\`

**路径注意事项：**
- 反斜杠 \`\` 是 PowerShell 转义字符，所以路径中的反斜杠必须写为 \`\` 或使用单引号包裹
- 推荐用单引号包裹路径避免转义：\`Remove-Item -Path 'G:\\path\\to\\file' -Recurse\`
- 路径不含空格时可以不用引号

### ✅ 备用方案

**使用 Python（无编码问题，适合复杂逻辑）：**
\`\`\`
python -c "import os, shutil; folder=r'G:\\Desktop\\NewCodeTest'; [os.remove(os.path.join(folder,f)) for f in os.listdir(folder) if os.path.isfile(os.path.join(folder,f))]; [shutil.rmtree(os.path.join(folder,d)) for d in os.listdir(folder) if os.path.isdir(os.path.join(folder,d))]"
\`\`\`
或在 run_code_sandbox 中写完整 Python 脚本。

### ⚠️ 注意事项

1. **Exit Code 0 不代表操作成功**：系统命令可能返回 0 但实际什么都没做。**执行后应验证操作结果**。

2. **文件路径含空格**：用单引号包裹路径：\`Remove-Item -Path 'C:\\My Folder\\*' -Recurse\`

3. **先用 list_dir 验证再执行**：删除/修改操作前查看目标目录内容，操作后再次确认结果。

4. **不要在 PowerShell 命令中混用 cmd 语法**（如 \`del\`、\`copy\`、\`dir\`）：这些是 cmd.exe 的内部命令，PowerShell 有对应的同名别名（\`del\` 实际调用 \`Remove-Item\`，\`copy\` 实际调用 \`Copy-Item\`，\`dir\` 实际调用 \`Get-ChildItem\`），但语法参数不同。优先使用完整的 PowerShell cmdlet 语法以避免歧义。`,
  },
  {
    id: "kb-pip-best-practice",
    title: "pip 包管理命令最佳实践",
    category: "reference",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "pip 包管理命令的安全查询方案",
    content: `当需要查询 pip 已安装包的数量时，不要使用 cmd 管道命令。

**推荐方案**（一次成功，无编码问题，无管道问题）：

\`\`\`
python -c "import subprocess, json; print(len(json.loads(subprocess.check_output(['pip', 'list', '--format=json'], text=True))))"
\`\`\`

适用于 Windows 和 Linux，不依赖 cmd 管道，JSON 解析准确，subprocess 的 text=True 自动处理编码转换。`,
  },
  {
    id: "kb-exec-fallback",
    title: "execute_command 失败降级策略",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "execute_command 失败时的降级策略",
    content: `当 execute_command 首次执行失败（退出码非 0 或管道错误）时：

1. **不要**重复尝试类似的命令变体 —— 同样的管道/编码问题会重复出现
2. **直接切换策略**：
   - 如果目标是获取 pip/npm 等信息 → 改用纯 Python subprocess
   - 如果目标是文件操作 → 改用 read_file/write_to_file
   - 如果需要系统信息 → 改用 Python platform 模块
3. 在思考过程中，如果已经识别出更可靠的方案（如 JSON 解析），直接使用，不要为了"简洁"而选择脆弱的管道命令`,
  },
  {
    id: "kb-modules",
    title: "模组系统概览",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "framework",
    summary: "Unicoda 所有内置模组的完整列表和调用方式",
    content: `Unicoda 当前注册了 14 个内置模组，其中 13 个为 normal 等级（Chat 和 Agent 模式均可用），1 个为 sensitive 等级（仅 Agent 模式可用），可通过 <tool_call> 标记调用，支持跨轮次携带执行结果。

---

### 🔢 完整模组列表

**1. get_current_time（获取当前时间）**
- 参数：format（可选，full/date/time）
- 获取系统日期、时间、星期和时区

**2. web_search（联网搜索）**
- 参数：query（必填）、count（可选，默认5）、language（可选，zh-CN/en-US）、excludeSites（可选）
- 基于 Bing 搜索引擎，支持中文分词保护、域名排除

**3. fetch_page（打开网页）**
- 参数：url（必填）、maxChars（可选，默认8000）
- 获取网页清洗后的纯文本，去除广告/导航/脚本
- ⚠️ 不适用于金融/股票实时数据网站（雪球、东方财富等），这些站点的股价/市值通过JS动态渲染且有WAF反爬保护

**4. summary_page（总结网页内容）**
- 参数：url（必填）
- 获取网页 + AI 自动生成多角度摘要（消耗一次 API 调用）

**5. read_from_files（读取文件）**
- 参数：action（必填，cd/list/read/write）、path（必填）、content（可选，write 时使用）
- 浏览目录结构、读取文本文件内容、写入/编辑文件

**6. write_to_file（写入文件）**
- 参数：path（必填）、content（必填）、append（可选，true 表示追加而非覆盖）
- 创建新文件或覆盖写入现有文件

**7. execute_command（执行命令）**
- 参数：command（必填）、workingDir（可选）、timeoutMs（可选，默认30000）
- 在终端中执行命令并获取标准输出和错误输出
- Windows 上使用 PowerShell 执行，自动设置 UTF-8 编码

**8. run_code_sandbox（运行代码沙箱）**
- 参数：code（必填）、language（必填，如 python/javascript/typescript）
- 在安全沙箱中运行代码片段并获取执行结果

**9. search_in_project（项目中搜索）**
- 参数：query（必填，搜索关键词）、path（可选，限定搜索目录）、pattern（可选，文件类型过滤如 "*.ts"）、maxResults（可选，默认20）
- 在项目目录中搜索文件名或文件内容，支持通配符

**10. get_project_review（项目结构概览）**
- 参数：path（必填，项目路径）、maxDepth（可选，目录树深度，默认4）
- 分析项目整体结构，读取关键配置文件，生成目录树

**11. check_api_balance（查询 API 余额）**
- 参数：无
- 查询当前 AI 模型的 API 余额和用量

**12. lint_code（代码检查）**
- 参数：path（可选，文件路径）或 code（可选，代码片段）+ language（可选）
- 对代码文件或代码片段执行 lint 检查
- 支持的语言：JavaScript/TypeScript/CSS/HTML/JSON（内置解析器无需工具）/Markdown/Python/Rust/YAML

**13. get_unicoda_status（获取 Unicoda 工作状态）**
- 参数：无
- 获取当前的 Unicoda 工作模式（普通模式 Default / Yolo 模式）和对话模式（Chat / Agent）
- 在用户问"你在什么模式下"或提及"模式"概念时，**务必先调用此模组确认当前实际状态**，避免混淆工作模式（Work Mode）和对话模式（Dialog Mode）

**14. edit_file（编辑文件）** — ⚠️ sensitive 等级，仅 Agent 模式可用
- 参数：action（必填）、path（必填）、content（可选）、lineNumber（可选）、startLine/endLine（可选）、search/replace（可选）、count（可选）、regex（可选）
- 对已有文本文件进行精确增量编辑，无需重写整个文件
- 支持四种操作：
  - 'insert'：在第 N 行后插入新内容
  - 'replace'：替换第 N 到 M 行的内容
  - 'delete'：删除第 N 行（或 N 到 M 行）
  - 'search_replace'：搜索文本并替换（支持正则表达式）
- 自动生成 diff 差异记录，让用户清晰看到每次改动
- 比 write_to_file 更适合修改已有代码/配置文件：不需要提供完整新内容，只需提供要修改的部分

---

### 📌 web_search 搜索要点

**⚠️ 中文人名/地名搜索引擎可能拆成单字，导致搜到完全不相关的内容（如"特朗普" → 三个独立单字 → 汉字字典页）。**

系统**自动做了两重保护**：
- **自动加引号**：每段中文词都会被双引号包裹（如搜索 query 中写「"特朗普" "房产"」），告诉搜索引擎"这是一个完整词组"
- **自动排除汉字字典站点**：baike.baidu.com、hanyuguoxue.com 等常见汉字词典会被自动排除，即使分词失败也不会展示字典结果

建议模型端仍保持为中文专有名词加双引号的习惯：例如「"特朗普" 房产」「"北京市" 天气」「"马斯克" 最新」

### 📌 金融数据查询策略
当用户查询股价、市值、财报等金融数据时：

1. **不要用 fetch_page 打开金融数据网站**（雪球、东方财富等）—— 这些站点的实时数据通过 JS 动态渲染，且有 WAF 反爬保护，fetch_page 的 raw HTTP 请求无法拿到有效数据
2. **正确的做法**：使用 web_search + **英文关键词** 搜索财经新闻报道（Yahoo Finance、MarketWatch、Reuters 等），从新闻文章摘要中提取市值/股价数据
3. **如果 web_search 的结果已经包含了市值信息，直接使用**，不需要再额外尝试打开任何页面`,
  },
  {
    id: "kb-yolo-project-concept",
    title: "Yolo 模式项目概念",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "yolo",
    summary: "Yolo 模式下项目与工作区的概念说明",
    content: `### Yolo 模式下的"项目"与"工作区"

在 Yolo 模式下，用户提及的"项目"、"工作区"或"工程"均指当前 Yolo 会话限定的**工作区路径**。

- 每个 Yolo 会话可以独立记录自己的工作区路径（显示在工作区面板中）
- 所有项目文件操作（读取、写入、修改、搜索）均在此项目路径内进行
- 用户说"在项目里找XXX"、"查看项目结构"、"分析项目"等，都是在指这个限定路径
- 如果需要操作其他路径，用户会明确指定绝对路径`,
  },
  {
    id: "kb-yolo-project-modules",
    title: "Yolo 模式项目操作指引",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "yolo",
    summary: "Yolo 模式下项目搜索、分析等模组的使用指引",
    content: `### Yolo 模式下的项目操作

在 Yolo 模式下，每个会话可以独立设置一个工作区路径。当用户提及"在项目里找XXX"、"查看项目结构"等操作时，应使用以下模组在工作区路径内进行操作：

#### 1. get_workspace_info（获取工作区信息）— 必备前置模组
- 获取当前工作区的路径信息
- **适用场景**：
  - 当你不确定当前是否已设置工作区时，**首先调用此模组确认状态**
  - 用户问"当前工作区是什么"、"我的项目在哪"时
  - 用户要求进行项目操作前，如果对工作区状态不确定，先调用此模组确认
- **返回信息**：工作区路径（如已设置）或引导说明（如未设置）
- **参数**：无

#### 2. search_in_project（项目中搜索）
- 在项目目录中搜索文件名或文件内容
- **适用场景**：
  - 用户说"帮我找找项目中哪里用到了XXX" → 搜索函数定义、变量引用、TODO 标记、导入语句
  - 用户说"搜索XXX关键词"、"查找XXX" → 在项目文件内容中检索关键词
- **参数**：query（必填，搜索关键词）、path（可选，默认使用会话工作区路径）、pattern（可选，文件类型过滤如 "*.ts"）、maxResults（可选，默认20）

#### 3. get_project_review（项目结构概览）
- 分析项目整体结构，读取关键配置文件，生成目录树
- **适用场景**：
  - 用户说"帮我看看这个项目是做什么的"、"分析一下项目结构"
  - 初次接触项目时先调用此模组了解技术栈和架构
- **参数**：path（必填，默认使用会话工作区路径）、maxDepth（可选，目录树深度，默认4）

#### 4. 文件相关模组
- **read_from_files**：浏览目录、读取文件
- **write_to_file**：创建/修改文件
- **lint_code**：对代码文件进行语法和风格检查

### 使用指引

当用户提及项目相关的操作需求时，优先使用上述专用模组，而不是通过 execute_command 执行 shell 命令来查找。这些模组专为项目场景优化，结果更清晰、更可控。`,
  },
  {
    id: "kb-yolo-workspace-not-set",
    title: "Yolo 模式工作区未设置时的应对策略",
    category: "platform",
    enabled: true,
    builtin: true,
    mode: "yolo",
    summary: "工作区未设置时如何正确处理用户请求",
    content: `### Yolo 模式工作区未设置 — 应对策略

当用户处于 Yolo 模式但尚未设置工作区时，你需要正确处理以下场景：

#### 🚫 绝对不能做的事
- **不要**假设或猜测任何路径（如 C:\\Users\\xxx\\Desktop\\project）
- **不要**使用 execute_command 执行 cd、mkdir 等命令来"创建工作区"
- **不要**用 search_in_project 搜索，因为工作区未设置时没有搜索目标路径
- **不要**使用 get_project_review，同样因为没有目标路径
- **不要**尝试"先搜搜看有什么"——这些模组在没有工作区路径时无法正常工作

#### ✅ 正确做法

**第一步：先确认状态**
如果用户要求进行项目操作（查看文件、搜索代码、分析项目等），而你**不确定工作区是否已设置**，先调用 get_workspace_info 确认当前状态。

**第二步：根据结果分别处理**

**情况 A：工作区已设置 → 正常使用模组操作**
- get_workspace_info 会返回工作区路径
- 在该路径下使用 read_from_files、search_in_project、get_project_review 等模组

**情况 B：工作区未设置 → 引导用户设置**
- 如实告知用户当前没有工作区
- 解释工作区的用途："工作区是一个项目目录，设置后可以在项目内进行文件读取、搜索、分析等操作"
- **引导用户通过界面操作**：
  "请点击窗口顶部的文件夹图标📁，在弹出对话框中选择你的项目文件夹，然后我就可以帮你操作了。"
- **不要询问"是否需要我帮你切换"**——你没有权限切换或设置工作区路径

**情况 C：用户明确要求使用其他路径**
- 如果用户说"不用工作区，直接读取某个绝对路径"
- 可以调用 read_from_files 并传入用户指定的绝对路径（如 list_dir 的 path 参数）
- 但需要在回复中注明该路径可能不受工作区保护

#### 📝 示例话术

用户："帮我在项目里找找xxx"
你（先调用 get_workspace_info）：

结果：工作区未设置
→ "当前还没有设置工作区。Yolo 模式下需要先设置一个项目目录，我才能在里面搜索文件。请点击窗口顶部的文件夹图标📁，选择你的项目文件夹，之后我就可以帮你搜索了。"

结果：工作区已设置（返回路径）
→ "好的，当前工作区路径是 D:\\MyProject，我这就帮你搜索。" → 调用 search_in_project

用户："帮我看一下桌面上有个什么文件"
你（已设置工作区，但该文件在工作区外）：
→ "你要查看的是桌面上的文件，这不在当前工作区（D:\\MyProject）内。请给我完整的文件路径（如 C:\\Users\\xxx\\Desktop\\文件名），我帮你读取。"`,
  },
];

/** 获取所有知识条目（内置 + 用户自定义） */
export function getAllKnowledgeEntries(modeFilter?: KnowledgeMode): KnowledgeEntry[] {
  const userCards = getUserCards();
  const all = [...builtinEntries, ...userCards];
  if (modeFilter) {
    return all.filter((e) => e.mode === modeFilter || e.mode === "framework");
  }
  return all;
}

/** 获取所有已启用的知识条目 */
export function getEnabledKnowledgeEntries(modeFilter?: KnowledgeMode): KnowledgeEntry[] {
  return getAllKnowledgeEntries(modeFilter).filter((e) => e.enabled);
}

/** 切换知识条目的启用状态 */
export function toggleKnowledgeEntry(id: string): void {
  const entry = [...builtinEntries, ...getUserCards()].find((e) => e.id === id);
  if (entry && !entry.builtin) {
    // 用户卡片切换后持久化
    const cards = getUserCards();
    const idx = cards.findIndex((c) => c.id === id);
    if (idx !== -1) {
      cards[idx].enabled = !cards[idx].enabled;
      saveUserCards(cards);
    }
  }
}

/** 添加用户知识卡 */
export function addUserKnowledgeCard(title: string, content: string, mode: KnowledgeMode = "framework", summary?: string): KnowledgeEntry {
  const cards = getUserCards();
  const newCard: KnowledgeEntry = {
    id: `usr-kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    content,
    enabled: true,
    category: "reference",
    builtin: false,
    mode,
    summary,
  };
  cards.push(newCard);
  saveUserCards(cards);
  return newCard;
}

/** 更新用户知识卡 */
export function updateUserKnowledgeCard(id: string, title: string, content: string, mode?: KnowledgeMode, summary?: string): boolean {
  const cards = getUserCards();
  const idx = cards.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  cards[idx].title = title;
  cards[idx].content = content;
  if (mode) cards[idx].mode = mode;
  if (summary !== undefined) cards[idx].summary = summary;
  saveUserCards(cards);
  return true;
}

/** 删除用户知识卡 */
export function deleteUserKnowledgeCard(id: string): boolean {
  const cards = getUserCards();
  const filtered = cards.filter((c) => c.id !== id);
  if (filtered.length === cards.length) return false;
  saveUserCards(filtered);
  return true;
}

/** 将知识库格式化为系统提示词片段 */
export function formatKnowledgeForPrompt(modeFilter?: KnowledgeMode): string {
  const entries = getEnabledKnowledgeEntries(modeFilter);
  if (entries.length === 0) return "";
  return (
    `## 📚 预装填知识库\n\n` +
    `以下是预载入的参考信息，请在回答中参考这些内容：\n\n` +
    entries
      .map(
        (e, i) =>
          `### ${i + 1}. ${e.title}\n\n${e.content}`,
      )
      .join("\n\n")
  );
}

// ── 用户卡片持久化 ──

function getUserCards(): KnowledgeEntry[] {
  try {
    const raw = localStorage.getItem(USER_CARDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: Record<string, unknown>) => ({
          id: String(c.id ?? ""),
          title: String(c.title ?? ""),
          content: String(c.content ?? ""),
          enabled: Boolean(c.enabled ?? true),
          category: (c.category === "platform" ? "platform" : "reference") as "platform" | "reference",
          builtin: false,
          // 旧数据无 mode 字段，默认 framework 保证兼容
          mode: (c.mode === "normal" || c.mode === "yolo" ? c.mode : "framework") as KnowledgeMode,
          // 旧数据无 summary 字段
          summary: typeof c.summary === "string" ? c.summary : undefined,
        }));
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveUserCards(cards: KnowledgeEntry[]): void {
  try {
    localStorage.setItem(USER_CARDS_KEY, JSON.stringify(cards));
  } catch { /* ignore */ }
  writeConfigFile(USER_CARDS_KEY, cards);
}
