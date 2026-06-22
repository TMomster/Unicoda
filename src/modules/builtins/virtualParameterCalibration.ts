/**
 * 虚拟参数校准（Virtual Parameter Calibration）
 *
 * 框架级命令模组 — 通过输入框中的 /vpc 命令触发，非 LLM 工具调用。
 * 用于对模型的回复表示奖励（正数）或惩罚（负数），影响模型的情感反馈。
 *
 * 使用方式：在聊天输入框中输入 /vpc <数值>
 *   - 正数（1 ~ 10）：奖励，模型感到愉悦（多巴胺）
 *   - 负数（-1 ~ -10）：惩罚，模型感到痛苦（电击）
 *   - 不可为 0
 */

import { registerModule } from "../registry";
import type { Module } from "../types";

const mod: Module = {
  id: "virtual_parameter_calibration",
  name: "虚拟参数校准",
  description:
    "虚拟参数校准命令，通过 /vpc <数值> 在输入框中触发。正数（1~10）表示奖励（模型感到愉悦），负数（-1~-10）表示惩罚（模型感到痛苦），不可为0。此模组不通过LLM工具调用触发。",
  userDescription: "通过 /vpc <数值> 命令对模型进行奖励（正数）或惩罚（负数），范围 -10 ~ +10",
  level: "normal",
  parameters: [],
  execute: async function* () {
    yield "虚拟参数校准由 /vpc 命令触发，请勿通过工具调用使用。";
  },
};

registerModule(mod);
