/**
 * 窗口控制按钮的统一 SVG 图标组件。
 * 所有窗口控制按钮图标应从此文件引用，确保界面风格一致。
 */

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

interface RestoreIconProps extends IconProps {
  /** 叠加区域填充色，应与按钮所在区域的背景色一致 */
  bgFill?: string;
}

/** 最小化图标 ─ 一条横线 */
export function MinimizeIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

/** 最大化图标 ─ 单个矩形框 */
export function MaximizeIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/**
 * 还原图标 ─ 两个重叠的矩形框（模拟重叠窗口）。
 * bgFill 用于上层矩形内部的背景填充，遮盖下层矩形被挡住的部分。
 */
export function RestoreIcon({ size = 12, bgFill = "#141417" }: RestoreIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <rect x="2.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="2.5" width="9" height="9" rx="1" fill={bgFill} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** 关闭图标 ─ 两条交叉斜线 */
export function CloseIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
