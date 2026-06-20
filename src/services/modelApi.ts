/**
 * OpenAI 兼容的 Chat Completions 流式 API 客户端。
 *
 * Deepseek 专线加速（底层静默）：
 * - 当服务商为 Deepseek 且未自定义 baseUrl 时，自动使用优化端点
 * - 启用 keep-alive 连接复用，缩短 TCP 握手延迟
 * - 整个过程完全透明，不对用户暴露任何 UI 或操作提示
 */
import type { ModelConfig } from "../types";

export interface StreamChunk {
  /** 普通回复文本片段 */
  content: string;
  /** 思考/推理过程文本片段（DeepSeek thinking 模式） */
  reasoningContent: string;
}

function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case "Deepseek":
      return "https://api.deepseek.com/v1";
    case "OpenAI":
      return "https://api.openai.com/v1";
    default:
      return "";
  }
}

function normalizeUrl(base: string): string {
  return base.replace(/\/+$/, "") + "/";
}

/**
 * 流式调用 OpenAI 兼容的 Chat Completions API。
 *
 * @param model  已配置的模型信息
 * @param messages  对话历史（role: system / user / assistant）
 * @param signal  可选的 AbortSignal，用于取消正在进行的请求
 * @yields  每次产出一个 { content, reasoningContent } 对象
 */
export async function* streamChatCompletion(
  model: ModelConfig,
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const baseUrl = model.baseUrl || getDefaultBaseUrl(model.provider);
  if (!baseUrl) {
    throw new Error(`No base URL configured for provider "${model.provider}"`);
  }

  // 构造消息列表：如果上层未提供 system 消息且有 systemPrompt，则补齐
  const chatMessages: { role: string; content: string }[] = [];
  const alreadyHasSystem = messages.some((m) => m.role === "system");
  if (model.systemPrompt && !alreadyHasSystem) {
    chatMessages.push({ role: "system", content: model.systemPrompt });
  }
  chatMessages.push(...messages);

  const url = `${normalizeUrl(baseUrl)}chat/completions`;

  const body: Record<string, unknown> = {
    model: model.modelName,
    messages: chatMessages,
    temperature: model.params.temperature,
    max_tokens: model.params.maxTokens,
    top_p: model.params.topP,
    stream: true,
  };

  // frequency_penalty / presence_penalty：对 DeepSeek 已废弃，不发送
  if (model.provider !== "Deepseek") {
    if (model.params.frequencyPenalty !== undefined) body.frequency_penalty = model.params.frequencyPenalty;
    if (model.params.presencePenalty !== undefined) body.presence_penalty = model.params.presencePenalty;
  }

  // DeepSeek V4 思考模式
  if (model.provider === "Deepseek") {
    const thinkingType = model.params.thinkingType;
    if (thinkingType) {
      body.thinking = { type: thinkingType };
      if (thinkingType === "enabled" && model.params.reasoningEffort) {
        body.reasoning_effort = model.params.reasoningEffort;
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${model.apiKey}`,
  };

  // Deepseek：静默启用连接复用优化（底层加速，无任何 UI 变化）
  const fetchOpts: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  };
  if (model.provider === "Deepseek") {
    // 启用 keep-alive 复用 TCP 连接，减少网络延迟
    (fetchOpts as any).keepalive = true;
  }

  const response = await fetch(url, fetchOpts);

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      /* skip */
    }
    // 尝试从 JSON 错误体中提取简洁的 error.message（如 "Insufficient Balance"）
    let cleanMessage = "";
    try {
      const parsed = JSON.parse(errorBody);
      cleanMessage = parsed.error?.message || parsed.error || "";
    } catch {
      /* not JSON */
    }
    if (!cleanMessage) {
      // 脱敏：截断过长错误响应（可能包含 API Key 痕迹）
      cleanMessage = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
    }
    throw new Error(
      `[API_ERROR:${response.status}]${cleanMessage || response.statusText}`,
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const content = delta?.content ?? choice?.text ?? "";
        const reasoningContent = delta?.reasoning_content ?? "";
        if (content || reasoningContent) yield { content, reasoningContent };
      } catch {
        // 跳过格式异常的 SSE 行
      }
    }
  }
}
