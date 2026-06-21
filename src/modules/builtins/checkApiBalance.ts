/**
 * API 余额与用量查询模组（check_api_balance）。
 *
 * 等级：normal（普通模组，所有模式可用）
 * 参数：
 *   provider - 模型提供商名称（可选，自动从模型配置注入）
 *   baseUrl  - API 基础地址（可选，自动从模型配置注入）
 *   apiKey   - API 密钥（可选，自动从模型配置注入，敏感参数）
 *
 * 支持的提供商：
 *   - DeepSeek:    GET /user/balance
 *   - OpenRouter:  GET /api/v1/auth/key
 *   - SiliconFlow: GET /v1/user/balance
 *   - OpenAI:      GET /v1/dashboard/billing/credit_grants
 *   其他提供商尝试通用模式 GET {baseUrl}/user/balance
 */
import type { Module } from "../types";
import { registerModule } from "../registry";

/** 常见提供商余额查询端点配置 */
interface BalanceEndpoint {
  /** URL 路径（相对于 baseUrl 或绝对 URL） */
  path: string;
  /** 是否需要额外的请求头 */
  extraHeaders?: Record<string, string>;
  /** 解析响应的函数，返回人类可读的余额文本 */
  parse: (data: unknown) => string | null;
}

const KNOWN_PROVIDERS: Record<string, BalanceEndpoint> = {
  Deepseek: {
    path: "https://api.deepseek.com/user/balance",
    parse: (data: any) => {
      if (!data?.balance_infos?.length) return null;
      const b = data.balance_infos[0];
      const lines: string[] = [
        `💰 DeepSeek 余额信息`,
        `━━━━━━━━━━━━━━━━━━`,
        `总余额：${b.total_balance} ${b.currency || "CNY"}`,
      ];
      if (b.topped_up_balance) lines.push(`已充值：${b.topped_up_balance} ${b.currency || "CNY"}`);
      if (b.granted_balance) lines.push(`已赠送：${b.granted_balance} ${b.currency || "CNY"}`);
      lines.push(`可用状态：${data.is_available ? "✅ 可用" : "❌ 不可用"}`);
      return lines.join("\n");
    },
  },
  OpenRouter: {
    path: "https://openrouter.ai/api/v1/auth/key",
    parse: (data: any) => {
      const d = data?.data;
      if (!d) return null;
      const lines: string[] = [
        `🔑 OpenRouter 密钥信息`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `标签：${d.label || "未命名"}`,
        `剩余限额：${d.limit_remaining ?? "未知"}`,
        `已用量：${d.usage ?? "未知"}`,
      ];
      if (d.is_free) lines.push(`类型：免费密钥 🆓`);
      if (d.credits) lines.push(`剩余积分：${d.credits}`);
      return lines.join("\n");
    },
  },
  SiliconFlow: {
    path: "https://api.siliconflow.cn/v1/user/balance",
    parse: (data: any) => {
      const balance = data?.balance;
      if (balance === undefined || balance === null) return null;
      return [
        `💰 SiliconFlow 余额信息`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `余额：${balance} 元`,
      ].join("\n");
    },
  },
  OpenAI: {
    path: "https://api.openai.com/v1/dashboard/billing/credit_grants",
    parse: (data: any) => {
      if (!data) return null;
      const lines: string[] = [
        `💰 OpenAI 额度信息`,
        `━━━━━━━━━━━━━━━━━━`,
      ];
      if (data.total_granted !== undefined) lines.push(`总额度：$${data.total_granted.toFixed(2)}`);
      if (data.total_used !== undefined) lines.push(`已使用：$${data.total_used.toFixed(2)}`);
      if (data.total_remaining !== undefined) lines.push(`剩余：$${data.total_remaining.toFixed(2)}`);
      if (data.access_until) {
        const until = new Date(data.access_until * 1000);
        lines.push(`有效至：${until.toLocaleDateString()}`);
      }
      return lines.join("\n");
    },
  },
};

/** 根据 baseUrl 猜测提供商 */
function guessProvider(baseUrl: string): string | null {
  const url = baseUrl.toLowerCase();
  if (url.includes("deepseek")) return "Deepseek";
  if (url.includes("openrouter")) return "OpenRouter";
  if (url.includes("siliconflow")) return "SiliconFlow";
  if (url.includes("openai")) return "OpenAI";
  return null;
}

const mod: Module = {
  id: "check_api_balance",
  name: "查询 API 余额",
  description:
    `查询当前 AI 模型的 API 余额和用量信息。支持 DeepSeek、OpenRouter、SiliconFlow、OpenAI 等主流提供商。当用户询问"还有多少额度"、"余额还剩多少"、"API 还能用多久"时调用此模组。注意：余额信息需联网查询，部分提供商可能不提供余额 API。`,
  userDescription: "查询 API 余额和用量信息",
  level: "normal",
  parameters: [
    {
      name: "provider",
      type: "string",
      required: false,
      description: "模型提供商名称（如 Deepseek、OpenAI），通常无需手动提供，系统自动注入",
    },
    {
      name: "baseUrl",
      type: "string",
      required: false,
      description: "API 基础地址，通常无需手动提供，系统自动注入",
    },
    {
      name: "apiKey",
      type: "string",
      required: false,
      description: "API 密钥（敏感参数），通常无需手动提供，系统自动注入",
    },
  ],
  execute: async function* (params, signal) {
    // 优先使用系统注入的模型配置（带 _ 前缀的隐藏参数，由 agentEngine 注入）
    const provider = params._modelProvider || params.provider;
    const baseUrl = params._modelBaseUrl || params.baseUrl || "";
    const apiKey = params._modelApiKey || params.apiKey;

    if (!apiKey) {
      yield "错误：缺少 API 密钥。请先在设置中配置模型 API Key 后重试。";
      return;
    }

    // 1. 尝试按提供商名称匹配已知端点
    if (provider && KNOWN_PROVIDERS[provider]) {
      const endpoint = KNOWN_PROVIDERS[provider];
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
          ...endpoint.extraHeaders,
        };
        const resp = await fetch(endpoint.path, { headers, signal });
        if (resp.ok) {
          const data = await resp.json();
          const result = endpoint.parse(data);
          if (result) {
            yield result;
            return;
          }
        }
      } catch {
        // 已知端点失败，fallthrough 到通用尝试
      }
    }

    // 2. 尝试根据 baseUrl 猜测提供商
    if (baseUrl && !provider) {
      const guessed = guessProvider(baseUrl);
      if (guessed && KNOWN_PROVIDERS[guessed]) {
        const endpoint = KNOWN_PROVIDERS[guessed];
        try {
          const resp = await fetch(endpoint.path, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
          });
          if (resp.ok) {
            const data = await resp.json();
            const result = endpoint.parse(data);
            if (result) {
              yield result;
              return;
            }
          }
        } catch {
          // 静默失败，继续
        }
      }
    }

    // 3. 通用尝试：GET {baseUrl}/user/balance（常见于类 OpenAI 兼容服务）
    if (baseUrl) {
      try {
        const balanceUrl = `${baseUrl.replace(/\/+$/, "")}/user/balance`;
        const resp = await fetch(balanceUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          const balance = data.balance ?? data.data?.balance ?? data.total_balance;
          if (balance !== undefined) {
            yield [
              `💰 ${provider || "当前服务"} 余额信息`,
              `━━━━━━━━━━━━━━━━━━`,
              `余额：${balance}`,
            ].join("\n");
            return;
          }
        }
      } catch {
        // 通用尝试失败
      }
    }

    // 4. 所有尝试均失败
    const providerName = provider || (baseUrl ? baseUrl.replace(/https?:\/\//, "").split("/")[0] : "当前服务");
    yield [
      `⚠️ 无法查询 "${providerName}" 的余额信息。`,
      ``,
      `可能的原因：`,
      `• 该服务商未提供公开的余额查询 API`,
      `• 网络连接异常`,
      `• API Key 无权访问余额接口`,
      `• 本地模型（如 Ollama/LM Studio）无需查询余额`,
    ].join("\n");
  },
};

registerModule(mod);
