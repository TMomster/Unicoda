/**
 * 获取当前时间模组。
 *
 * 等级：normal（普通模组，所有模式可用）
 * 参数：
 *   format - 输出格式（可选），"full"（完整日期时间，默认）| "date"（仅日期）| "time"（仅时间）
 *
 * 作用：让模型了解当前的确切日期和时间，避免在需要"最新"信息时无法判断时间基准。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";

function getCurrentTimeFormatted(format: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const weekdays = [
    "星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六",
  ];
  const weekday = weekdays[now.getDay()];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  switch (format) {
    case "date":
      return `${year}年${month}月${day}日 ${weekday}`;
    case "time":
      return `${hours}:${minutes}:${seconds} (时区: ${tz})`;
    case "full":
    default:
      return `${year}年${month}月${day}日 ${weekday} ${hours}:${minutes}:${seconds} (时区: ${tz})`;
  }
}

const mod: Module = {
  id: "get_current_time",
  name: "获取当前时间",
  description:
    "获取当前系统日期和时间，包括星期和时区信息。当你需要知道今天的确切日期来搜索最新新闻、或判断时间基准时使用。",
  level: "normal",
  parameters: [
    {
      name: "format",
      type: "string",
      required: false,
      description: "输出格式：full（完整日期时间）、date（仅日期）、time（仅时间）",
      default: "full",
    },
  ],
  execute: async function* (params, _signal) {
    const format = params.format || "full";
    const result = getCurrentTimeFormatted(format);
    yield result;
  },
};

registerModule(mod);
