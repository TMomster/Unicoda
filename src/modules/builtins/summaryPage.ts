/**
 * 网页内容摘要模组（summary_page）。
 *
 * 等级：normal（普通模组，所有模式可用）
 * 参数：
 *   url      - 目标网页链接（必填）
 *
 * 作用：获取指定 URL 的网页内容，清洗后交给 LLM 生成多角度摘要。
 * 模型应优先使用 fetch_page 获取完整内容；仅在需要快速了解文章核心观点时
 * 使用 summary_page。此模组内部会调用 LLM，消耗一次 API 调用额度。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

const MAX_INPUT_CHARS = 15000;

/**
 * 简化版 HTML 清洗，提取正文文本。
 */
function htmlToPlainText(html: string): string {
  let text = html.replace(
    /<(script|style|svg|nav|footer|header|noscript|aside)[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<[^>]+>/g, "\n");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(parseInt(n, 10)));
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{3,}/g, " ")
    .trim();
  return text.slice(0, MAX_INPUT_CHARS);
}

/**
 * 调用 LLM API（OpenAI 兼容格式）生成摘要。
 */
async function summarizeWithLLM(
  text: string,
  url: string,
  apiKey: string,
  modelName: string,
  baseUrl: string,
  provider: string,
): Promise<string> {
  const effectiveBaseUrl = baseUrl || (provider === "Deepseek"
    ? "https://api.deepseek.com/v1/"
    : provider === "OpenAI"
    ? "https://api.openai.com/v1/"
    : "");

  if (!effectiveBaseUrl) {
    return `无法确定 API 端点，请检查模型配置。`;
  }

  const apiUrl = `${effectiveBaseUrl.replace(/\/+$/, "")}/chat/completions`;

  const systemPrompt =
    "你是一个专业的网页摘要助手。请严格根据用户提供的网页原文，生成一份结构清晰的多角度摘要。要求：\n"
    + "1. 先用一句话概括核心主旨\n"
    + "2. 用 3～5 个要点列出关键信息（每条不超过 50 字）\n"
    + "3. 如有数据、引用或结论，请标注原文出处\n"
    + "4. 使用中文输出，保持客观中立\n"
    + "5. 不要添加原文中不存在的信息\n"
    + "6. 总长度控制在 300 字以内";

  const body = JSON.stringify({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `请总结以下网页内容（来源：${url}）：\n\n${text}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 1024,
    stream: false,
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    let errText = "";
    try { errText = await response.text(); } catch { /* skip */ }
    throw new Error(`LLM 摘要生成失败 (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || "未能生成摘要。";
}

const mod: Module = {
  id: "summary_page",
  name: "总结网页内容",
  description:
    "获取指定 URL 的网页内容，并使用 AI 自动生成多角度摘要。当你需要快速了解一篇长文章的核心观点、不想阅读全文时使用。注意：此模组会消耗一次 API 调用额度。如果需要获取网页完整原文，请使用 fetch_page。",
  level: "normal",
  parameters: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "目标网页的完整 URL（如 https://example.com/article）",
    },
  ],
  execute: async function* (params, _signal) {
    const url = params.url;
    if (!url) {
      yield "错误：请提供 url 参数。";
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      yield `错误：无效的 URL "${url}"，必须以 http:// 或 https:// 开头。`;
      return;
    }

    // 读取内部注入的模型配置参数
    const apiKey = params._modelApiKey;
    const modelName = params._modelName;
    const baseUrl = params._modelBaseUrl;
    const provider = params._modelProvider;

    if (!apiKey || !modelName) {
      yield "错误：缺少模型配置参数（未注入 API Key 或 Model Name），请确保通过 Agent 引擎调用此模组。";
      return;
    }

    try {
      // 第一步：获取页面
      yield `正在获取页面内容...\n`;
      const html = await invoke<string>("http_fetch", {
        url,
        userAgent: null,
        timeoutMs: 15000,
      });
      const text = htmlToPlainText(html);

      if (!text || text.length < 50) {
        yield "页面内容过少，无法生成有效摘要。";
        return;
      }

      // 第二步：调用 LLM 生成摘要
      yield `正在分析并生成摘要...\n`;
      const summary = await summarizeWithLLM(text, url, apiKey, modelName, baseUrl, provider);

      yield `📝 页面摘要：${url}\n\n${summary}`;
    } catch (err) {
      yield `摘要生成失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
