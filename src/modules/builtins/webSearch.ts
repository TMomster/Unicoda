/**
 * 网络搜索模组（Bing HTML 爬虫）。
 *
 * 等级：low（所有模式可用）
 * 参数：
 *   query  - 搜索关键词（必填）
 *   count  - 返回结果数量（可选，默认 5，最大 10）
 *
 * 作用：通过 Bing 搜索引擎获取网页搜索结果。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchBing(
  query: string,
  count: number,
): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}&mkt=zh-CN`;

  const html = await invoke<string>("http_fetch", {
    url,
    userAgent: null,
    timeoutMs: 15000,
  });

  return parseBingHtml(html, count);
}

function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // 匹配 Bing 搜索结果条目
  // 尝试多种结构
  const patterns = [
    // 新版 Bing 结构
    /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
    // 通用结构
    /<li[^>]*>[\s\S]*?<h2><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<p[^>]*>([\s\S]*?)<\/p>/gi,
  ];

  // 使用第一个模式解析
  const algoRegex = patterns[0];
  let match: RegExpExecArray | null;

  while ((match = algoRegex.exec(html)) !== null && results.length < maxResults) {
    const itemHtml = match[1];

    // 提取 URL
    const urlMatch = itemHtml.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    if (seen.has(url)) continue;
    seen.add(url);

    // 提取标题（去除 HTML 标签）；支持带 class 属性的 <h2>
    const titleMatch = itemHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    if (!title) continue;

    // 提取摘要
    let snippet = "";
    const pMatch = itemHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) {
      snippet = pMatch[1].replace(/<[^>]+>/g, "").trim();
    } else {
      // 尝试其他结构
      const descMatch = itemHtml.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (descMatch) {
        snippet = descMatch[1].replace(/<[^>]+>/g, "").trim();
      }
    }

    results.push({ title, url, snippet });
  }

  // 如果第一个模式没结果，尝试第二个
  if (results.length === 0) {
    const altRegex = patterns[1];
    altRegex.lastIndex = 0;
    while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      if (seen.has(url) || !url.startsWith("http")) continue;
      seen.add(url);
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const snippet = (match[4] || "").replace(/<[^>]+>/g, "").trim();
      if (title && url) {
        results.push({ title, url, snippet });
      }
    }
  }

  return results;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "未找到相关搜索结果。";

  const lines: string[] = [`搜索到 ${results.length} 条结果：\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(
      `### ${i + 1}. [${r.title}](${r.url})\n${r.snippet}\n`,
    );
  }
  return lines.join("\n");
}

const mod: Module = {
  id: "web_search",
  name: "联网搜索",
  description:
    "通过搜索引擎获取互联网上的实时信息。当用户询问新闻、天气、股价、最新事件等需要实时数据的场景时使用。支持中文和英文搜索。",
  level: "low",
  parameters: [
    {
      name: "query",
      type: "string",
      required: true,
      description: "搜索关键词，建议简短精炼",
    },
    {
      name: "count",
      type: "number",
      required: false,
      default: "5",
      description: "返回结果数量（1～10）",
      max: 10,
      min: 1,
    },
  ],
  execute: async function* (params, signal) {
    const query = params.query;
    if (!query) {
      yield "错误：搜索关键词不能为空。请提供 query 参数。";
      return;
    }

    const count = Math.min(Math.max(parseInt(params.count) || 5, 1), 10);

    try {
      const results = await searchBing(query, count);
      yield formatResults(results);
    } catch (err) {
      yield `搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
