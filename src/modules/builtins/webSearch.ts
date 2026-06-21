/**
 * 网络搜索模组（Bing HTML 爬虫）。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 功能特点：
 *   - 查询改写（Query Rewriting）：自动识别中文专有名词（人名/地名/组织名），
 *     只对专有名词加引号保护，对搜索停用词自动过滤，避免过度分词导致召回不足。
 *   - 并行搜索（Parallel Search）：检测到专有名词时，自动并行搜索中文和英文，
 *     合并结果获得更全面的召回（尤其改善中文人名搜索效果）。
 *   - 中文人名智能检测：支持已知专名映射表（如 特朗普→Donald Trump）+ 百家姓模式检测。
 *
 * 参数：
 *   query    - 搜索关键词（必填）
 *   count    - 返回结果数量（可选，默认 5，最大 10）
 *   language - 搜索语言/市场（可选，默认 zh-CN）
 *              中文搜索请使用 "zh-CN"，英文搜索请使用 "en-US"。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";
import { invoke } from "@tauri-apps/api/core";
import { readConfigFile } from "../../utils/configStorage";
import type { SearxngConfig } from "../../contexts/SearchContext";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: "zh" | "en";
}

interface RewriteResult {
  /** 改写后的中文搜索查询（含引号保护） */
  chineseQuery: string;
  /** 英文搜索关键词列表（用于并行搜索） */
  englishTerms: string[];
  /** 是否检测到专有名词 */
  hasNamedEntity: boolean;
}

/* ================================================================
 * 查询改写模块（Query Rewriting）
 * ================================================================
 * 核心思路：不再对所有中文词加引号，而是智能识别专有名词
 * （人名/地名/组织名等），只对这些词加引号保护。
 * 同时自动剔除搜索停用词，并为专有名词补充英文搜索词。
 */

/**
 * 已知专有名词映射表：中文名 → 英文名
 * 用于查询改写阶段的专名检测和双语扩展。可随项目持续扩充。
 */
const KNOWN_ENTITIES: Record<string, string> = {
  "特朗普": "Donald Trump",
  "川普": "Donald Trump",
  "拜登": "Joe Biden",
  "习近平": "Xi Jinping",
  "普京": "Vladimir Putin",
  "马斯克": "Elon Musk",
  "黄仁勋": "Jensen Huang",
  "扎克伯格": "Mark Zuckerberg",
  "贝索斯": "Jeff Bezos",
  "英伟达": "NVIDIA",
  "特斯拉": "Tesla",
  "谷歌": "Google",
  "微软": "Microsoft",
  "苹果": "Apple Inc.",
  "阿里巴巴": "Alibaba",
  "腾讯": "Tencent",
  "百度": "Baidu",
  "亚马逊": "Amazon",
  "台积电": "TSMC",
  "AMD": "AMD",
  "英特尔": "Intel",
  "比特币": "Bitcoin",
  "以太坊": "Ethereum",
  "OpenAI": "OpenAI",
  "ChatGPT": "ChatGPT",
  "Claude": "Claude",
  "Gemini": "Gemini",
};

/**
 * 搜索停用词：对搜索召回没有帮助的泛用词，在改写阶段自动剔除。
 */
const SEARCH_STOP_WORDS = new Set([
  "什么", "如何", "怎么", "怎样", "为什么", "是否", "哪些", "哪个", "谁", "哪",
  "请问", "介绍", "了解", "说说", "告诉", "解释", "描述", "说明", "列举",
  "最新", "详细", "消息", "新闻", "情况", "信息", "资料", "数据", "动态",
  "多少", "几个", "名下", "关于", "属于", "相关", "有关", "涉及",
  "各种", "所有", "全部", "总共", "方面", "领域", "位置", "内容", "事情",
]);

/**
 * 常见百家姓（用于模式检测未注册的中文人名）。
 * 涵盖单姓和常见复姓。
 */
const SURNAMES = new Set([
  "赵","钱","孙","李","周","吴","郑","王","冯","陈","褚","卫","蒋","沈","韩","杨",
  "朱","秦","尤","许","何","吕","施","张","孔","曹","严","华","金","魏","陶","姜",
  "戚","谢","邹","喻","柏","水","窦","章","云","苏","潘","葛","奚","范","彭","郎",
  "鲁","韦","昌","马","苗","凤","花","方","俞","任","袁","柳","鲍","史","唐","费",
  "廉","岑","薛","雷","贺","倪","汤","滕","殷","罗","毕","郝","邬","安","常","乐",
  "于","时","傅","皮","卞","齐","康","伍","余","元","卜","顾","孟","平","黄","和",
  "穆","萧","尹","姚","邵","汪","祁","毛","禹","狄","米","贝","明","臧","计","伏",
  "成","戴","谈","宋","茅","庞","熊","纪","舒","屈","项","祝","董","梁","杜","阮",
  "蓝","闵","席","季","麻","强","贾","路","娄","危","江","童","颜","郭","梅","盛",
  "林","刁","钟","徐","邱","骆","高","夏","蔡","田","樊","胡","凌","霍","虞","万",
  "支","柯","昝","管","卢","莫","经","房","裘","缪","干","解","应","宗","丁","宣",
  "邓","郁","包","诸","左","石","崔","吉","钮","龚","程","嵇","邢","滑","裴","陆",
  "荣","翁","荀","羊","惠","甄","曲","家","封","芮","羿","储","靳","汲","邴","糜",
  "松","井","段","富","巫","乌","焦","巴","弓","牧","隗","山","谷","车","侯","宓",
  "全","郗","班","仰","秋","仲","伊","宫","宁","仇","栾","暴","甘","厉","戎","祖",
  "武","符","刘","景","詹","束","龙","叶","幸","司","韶","郜","黎","薄","印","宿",
  "白","怀","蒲","邰","从","鄂","索","咸","籍","赖","卓","蔺","屠","蒙","池","乔",
  "阴","郁","胥","能","苍","双","闻","莘","党","翟","谭","贡","劳","姬","申","扶",
  "冉","宰","雍","郤","璩","桑","桂","濮","牛","寿","通","边","扈","燕","冀","浦",
  "尚","农","温","别","庄","晏","柴","瞿","阎","充","慕","连","茹","习","宦","艾",
  "鱼","容","向","古","易","慎","戈","廖","庾","终","暨","居","衡","步","都","耿",
  "满","弘","匡","国","文","寇","广","禄","阙","东","欧","殳","沃","利","蔚","越",
  "隆","师","巩","聂","晁","勾","敖","融","冷","訾","辛","阚","那","简","饶","空",
  "曾","毋","沙","养","鞠","须","丰","巢","关","蒯","相","查","后","荆","红","游",
  "竺","权","逯","盖","桓","公",
  // 常见复姓
  "万俟","司马","上官","欧阳","夏侯","诸葛","闻人","东方","赫连","皇甫",
  "尉迟","公羊","澹台","公冶","宗政","濮阳","淳于","单于","太叔","申屠",
  "公孙","仲孙","轩辕","令狐","钟离","宇文","长孙","慕容","司徒","司空",
  "司徒","司空","完颜",
]);

/**
 * 中文搜索时排除的汉字词典站点。
 * 注意：百度百科（百科全书）不属于字典站，不在此排除。
 */
const CJK_DICT_SITES = [
  "hanyuguoxue.com",
  "zdic.net",
  "xh.5156edu.com",
  "gushici.net",
];

/**
 * 检测字符串是否包含 CJK 统一汉字
 */
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * 检测字符串是否以百家姓开头（2-4 个汉字，含复姓）。
 */
function isLikelyChineseName(term: string): boolean {
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(term)) return false;
  // 先检查前2字是否为复姓
  if (term.length >= 3 && SURNAMES.has(term.slice(0, 2))) return true;
  // 再检查首字是否为单姓
  return SURNAMES.has(term[0]);
}

/**
 * 查询改写（Query Rewriting）
 *
 * 对用户输入的搜索词进行预处理：
 * 1. 按空格分词，剔除搜索停用词
 * 2. 识别专有名词（已知映射表 → 百家姓模式检测）
 * 3. 仅对专有名词加引号保护，普通中文词不加引号
 * 4. 为专有名词补充英文搜索词（便于并行搜索）
 *
 * 示例：
 *   "特朗普 名下 房产 数量" →
 *     { chineseQuery: '"特朗普" 房产', englishTerms: ['Donald Trump'], hasNamedEntity: true }
 *   "胡萝卜 营养价值" →
 *     { chineseQuery: '胡萝卜 营养价值', englishTerms: [], hasNamedEntity: false }
 */
function rewriteQuery(query: string): RewriteResult {
  if (!hasCJK(query)) {
    return { chineseQuery: query, englishTerms: [], hasNamedEntity: false };
  }

  const segments = query.split(/\s+/).filter(Boolean);
  const filtered: string[] = [];
  const englishTerms = new Set<string>();
  let hasNamedEntity = false;

  for (const seg of segments) {
    if (SEARCH_STOP_WORDS.has(seg)) continue;

    const englishName = KNOWN_ENTITIES[seg];
    if (englishName) {
      filtered.push(`"${seg}"`);
      englishTerms.add(englishName);
      hasNamedEntity = true;
      continue;
    }

    if (isLikelyChineseName(seg)) {
      filtered.push(`"${seg}"`);
      hasNamedEntity = true;
      continue;
    }

    // 非 CJK 词（数字/英文）或普通中文词 → 不加引号
    filtered.push(seg);
  }

  return {
    chineseQuery: filtered.join(" "),
    englishTerms: Array.from(englishTerms),
    hasNamedEntity,
  };
}

/**
 * 英文 → 中文专名反向映射表（从 KNOWN_ENTITIES 自动构建）。
 * 用于英文查询中检测已知专名并补充中文搜索。
 */
function buildEnToCn(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [cn, en] of Object.entries(KNOWN_ENTITIES)) {
    if (!map[en]) map[en] = [];
    map[en].push(cn);
  }
  return map;
}
const EN_TO_CN = buildEnToCn();

/**
 * 检测英文查询中是否包含已知专名，若有则生成对应的中文查询词。
 * 例如：query="NVIDIA 2026 news" → { chineseQuery: '"英伟达" 2026 news', found: true }
 */
function extractChineseTerms(query: string): { chineseQuery: string; found: boolean } {
  let modified = query;
  let found = false;
  // 按英文名长度降序匹配，优先匹配较长的专名
  const sorted = Object.entries(EN_TO_CN).sort((a, b) => b[0].length - a[0].length);
  for (const [en, cnList] of sorted) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    if (regex.test(query)) {
      found = true;
      modified = modified.replace(regex, `"${cnList[0]}"`);
    }
  }
  return { chineseQuery: modified, found };
}

/** 检查域名是否属于已知字典站点 */
function isDictDomain(domain: string): boolean {
  const host = domain.replace(/^www\./, "");
  return CJK_DICT_SITES.some((s) => host === s || host.endsWith("." + s));
}

/**
 * 单次 Bing 搜索（底层调用）
 * 支持中文查询自动追加字典站点排除。
 */
async function searchSingle(
  query: string,
  count: number,
  language: string,
  excludeSites?: string[],
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const excludeStr = excludeSites && excludeSites.length > 0
    ? " " + excludeSites.map((s) => `-site:${s.trim()}`).join(" ")
    : "";

  const autoExclude = hasCJK(query)
    ? " " + CJK_DICT_SITES.map((s) => `-site:${s}`).join(" ")
    : "";

  const url = `https://www.bing.com/search?q=${encodeURIComponent(query + excludeStr + autoExclude)}&count=${count}&mkt=${language}`;

  const html = await invoke<string>("http_fetch", {
    url,
    userAgent: null,
    timeoutMs: 15000,
  });

  if (signal?.aborted) return [];

  const results = parseBingHtml(html, count);
  return results.filter((r) => {
    try {
      return !isDictDomain(new URL(r.url).hostname);
    } catch {
      return true;
    }
  });
}

/**
 * 合并两组搜索结果（zh-CN 优先 + en-US 去重补充）。
 * 每条结果标注来源语言。
 */
function mergeResults(
  zhResults: SearchResult[],
  enResults: SearchResult[],
  maxCount: number,
): SearchResult[] {
  const merged: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const r of zhResults) {
    r.source = "zh";
    merged.push(r);
    seenUrls.add(r.url);
    if (merged.length >= maxCount) return merged;
  }

  for (const r of enResults) {
    if (seenUrls.has(r.url)) continue;
    r.source = "en";
    merged.push(r);
    seenUrls.add(r.url);
    if (merged.length >= maxCount) break;
  }

  return merged;
}

/**
 * 带查询改写和并行搜索的 Bing 搜索
 *
 * 执行流程：
 * 1. 查询改写 → rewriteQuery()
 * 2. 中文主搜索（zh-CN）
 * 3. 若检测到专名 → 并行英文搜索（en-US）
 * 4. 结果合并去重
 */
async function searchBing(
  query: string,
  count: number,
  language: string,
  excludeSites?: string[],
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  // 纯英文查询：检测是否有已知专名，有则补充中文并行搜索
  if (!hasCJK(query)) {
    const { chineseQuery, found } = extractChineseTerms(query);
    if (found) {
      const mainResults = await searchSingle(
        query, count, language, excludeSites, signal,
      );
      const zhResults = await searchSingle(
        chineseQuery, count, "zh-CN", undefined, signal,
      ).catch(() => [] as SearchResult[]);
      return mergeResults(mainResults, zhResults, count);
    }
    return searchSingle(query, count, language, excludeSites, signal);
  }

  // 1. 查询改写
  const rewrite = rewriteQuery(query);
  if (!rewrite.chineseQuery.trim()) {
    return searchSingle(query, count, language, excludeSites, signal);
  }

  // 2. 主搜索（中文）
  const mainLang = language.startsWith("zh") ? language : "zh-CN";
  const mainResults = await searchSingle(
    rewrite.chineseQuery,
    count,
    mainLang,
    excludeSites,
    signal,
  );

  // 3. 检测到专名 → 并行英文搜索
  if (rewrite.hasNamedEntity && rewrite.englishTerms.length > 0) {
    const enResultsArrays = await Promise.all(
      rewrite.englishTerms.map((eq) =>
        searchSingle(eq, count, "en-US", undefined, signal).catch(() => [] as SearchResult[]),
      ),
    );
    return mergeResults(mainResults, enResultsArrays.flat(), count);
  }

  return mainResults;
}

function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();

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
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    // 域名级去重：同一域名只保留第一个结果
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
    if (domain && seenDomains.has(domain)) continue;
    if (domain) seenDomains.add(domain);

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
      if (seenUrls.has(url) || !url.startsWith("http")) continue;
      seenUrls.add(url);

      // 域名级去重
      let domain = "";
      try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
      if (domain && seenDomains.has(domain)) continue;
      if (domain) seenDomains.add(domain);

      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const snippet = (match[4] || "").replace(/<[^>]+>/g, "").trim();
      if (title && url) {
        results.push({ title, url, snippet });
      }
    }
  }

  return results;
}

/* ================================================================
 * SearXNG 搜索后端
 * ================================================================
 */

/** 加载 SearXNG 配置（模块直接读取存储，无需 React Context） */
async function loadSearxngConfig(): Promise<SearxngConfig | null> {
  try {
    const config = await readConfigFile<SearxngConfig>(
      "unicoda-searxng",
      { enabled: false, baseUrl: "", categories: "general", language: "zh-CN", safeSearch: 0 },
    );
    return config.enabled && config.baseUrl ? config : null;
  } catch {
    return null;
  }
}

/**
 * 通过 SearXNG JSON API 搜索
 */
async function searchSearxng(
  query: string,
  count: number,
  language: string,
  config: SearxngConfig,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const categories = config.categories || "general,news";
  const lang = language || config.language || "all";

  const apiUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=${encodeURIComponent(categories)}&language=${encodeURIComponent(lang)}&safesearch=${config.safeSearch}&pageno=1`;

  const json = await invoke<string>("http_fetch", {
    url: apiUrl,
    userAgent: "Unicoda/1.0",
    timeoutMs: 15000,
    noProxy: true,
    acceptHeader: "application/json",
  });

  if (signal?.aborted) return [];

  const parsed = parseSearxngJson(json, count);
  return parsed;
}

/**
 * 解析 SearXNG JSON 搜索结果
 * SearXNG 返回格式：
 * {
 *   "results": [{ "url": "...", "title": "...", "content": "..." }],
 *   "answers": [],
 *   "infoboxes": []
 * }
 */
function parseSearxngJson(json: string, maxResults: number): SearchResult[] {
  try {
    const data = JSON.parse(json);
    if (!data.results || !Array.isArray(data.results)) return [];

    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const item of data.results) {
      if (!item.url || !item.title) continue;
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);

      results.push({
        title: item.title.replace(/<[^>]+>/g, "").trim(),
        url: item.url,
        snippet: (item.content || "").replace(/<[^>]+>/g, "").trim(),
        source: undefined,
      });

      if (results.length >= maxResults) break;
    }

    return results;
  } catch {
    // 解析失败的路径
    return [];
  }
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "未找到相关搜索结果。";

  const lines: string[] = [`搜索到 ${results.length} 条结果：\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sourceTag = r.source === "en" ? " [来源：英文搜索]" : "";
    lines.push(
      `### ${i + 1}. [${r.title}](${r.url})${sourceTag}\n${r.snippet}\n`,
    );
  }
  return lines.join("\n");
}

const mod: Module = {
  id: "web_search",
  name: "联网搜索",
  description:
    "通过搜索引擎获取互联网上的实时信息。当用户询问新闻、天气、股价、最新事件等需要实时数据的场景时使用。支持中文和英文搜索。\n\n内置查询改写功能：自动识别中文专有名词（人名/地名/组织名）并加引号保护，剔除搜索停用词；检测到专有名词时自动并行搜索中英文并合并结果，提高搜索召回率。",
  userDescription: "通过必应搜索引擎检索网络上的实时信息",
  level: "normal",
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
    {
      name: "language",
      type: "string",
      required: false,
      default: "zh-CN",
      description:
        "搜索语言/市场，可选 zh-CN（中文）、en-US（英文）等。中文查询请用 zh-CN 以获得准确的语义分词；英文查询请用 en-US 以获取英文优先的结果",
    },
    {
      name: "excludeSites",
      type: "string",
      required: false,
      default: "",
      description:
        "排除的域名列表，多个域名用逗号分隔。例如：\"nvidia.cn,nvidia.com\" 可排除英伟达官网结果。当搜索结果被公司官网占据时使用",
    },
  ],
  execute: async function* (params, signal) {
    const query = params.query;
    if (!query) {
      yield "错误：搜索关键词不能为空。请提供 query 参数。";
      return;
    }

    const count = Math.min(Math.max(parseInt(params.count) || 5, 1), 10);
    const language = (params.language === "" ? "zh-CN" : (params.language || "zh-CN")).trim();
    const excludeSites = params.excludeSites
      ? params.excludeSites.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    // 检查 SearXNG 配置，启用时优先使用
    const searxngConfig = await loadSearxngConfig();

    try {
      if (searxngConfig) {
        yield `[搜索引擎：SearXNG - ${searxngConfig.baseUrl}]\n`;
        const queryString = hasCJK(query)
          ? rewriteQuery(query).chineseQuery
          : query;
        const results = await searchSearxng(queryString, count, language, searxngConfig, signal);
        yield formatResults(results);
      } else {
        const results = await searchBing(query, count, language, excludeSites, signal);
        yield formatResults(results);
      }
    } catch (err) {
      yield `搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerModule(mod);
