/**
 * 网页内容获取模组（fetch_page）。
 *
 * 等级：normal（普通模组，所有模式可用）
 * 参数：
 *   url      - 目标网页链接（必填）
 *   maxChars - 最大返回字符数（可选，默认 8000）
 *
 * 作用：获取指定 URL 的网页内容，去除 HTML 标签和脚本，返回清洗后的纯文本。
 * 当搜索结果摘要不足以提供足够信息时，模型可调用此模组打开具体页面获取详细内容。
 *
 * ⚠️ 限制说明：
 * - 本模组通过后端 HTTP 请求获取原始 HTML，不执行 JavaScript。
 * - 金融/股票数据网站（雪球、东方财富、同花顺等）的股价、市值等实时数据均
 *   通过 JS 动态渲染，原始 HTML 中只包含占位符（如 "-"）或 WAF 验证页面，
 *   无法获取有效数据。
 * - 如需查询股价、市值等金融数据，应优先通过 web_search 搜索新闻报道或
 *   财经资讯，而非直接打开金融网站页面。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_MAX_CHARS = 8000;

/**
 * 将 HTML 清洗为纯文本，去除脚本、样式、导航等噪音。
 */
function htmlToText(html: string, maxChars: number): string {
  // 移除 <script>、<style>、<svg>、<nav>、<footer>、<header>、<noscript> 块
  let text = html.replace(
    /<(script|style|svg|nav|footer|header|noscript)[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );

  // 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 移除所有 HTML 标签，保留换行
  text = text.replace(/<[^>]+>/g, "\n");

  // 解码 HTML 实体
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)));

  // 合并多余空白行和空格
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{3,}/g, " ")
    .trim();

  // 截取前 maxChars 字符（尽量在段落边界截断）
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastBreak = truncated.lastIndexOf("\n\n");
  if (lastBreak > maxChars * 0.7) return truncated.slice(0, lastBreak).trim() + "\n\n... [内容过长，已截断]";
  return truncated.trim() + "\n\n... [内容过长，已截断]";
}

const mod: Module = {
  id: "fetch_page",
  name: "打开网页",
  description:
    "获取指定 URL 网页的详细内容，去除广告和导航等干扰信息，返回清洗后的纯文本。当搜索结果中的摘要信息不足以回答用户问题时使用，可打开具体文章获取完整细节。注意：单次调用最多返回 8000 字符。⚠️ 不适用于金融/股票实时数据网站（雪球、东方财富等），这些站点的数据通过 JS 动态渲染，无法获取有效内容。",
  userDescription: "获取指定网页的文本内容，去除广告和导航等干扰元素",
  level: "normal",
  parameters: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "目标网页的完整 URL（如 https://example.com/article）",
    },
    {
      name: "maxChars",
      type: "number",
      required: false,
      default: "8000",
      description: "最大返回字符数（500～20000）",
      min: 500,
      max: 20000,
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

    const maxChars = Math.min(Math.max(parseInt(params.maxChars) || DEFAULT_MAX_CHARS, 500), 20000);

    try {
      const html = await invoke<string>("http_fetch", {
        url,
        userAgent: null,
        timeoutMs: 15000,
      });
      const text = htmlToText(html, maxChars);
      yield `📄 页面内容：${url}\n\n${text}`;
    } catch (err) {
      yield `获取页面失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
