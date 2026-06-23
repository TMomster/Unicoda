/**
 * 虚拟参数校准（VPC）模组。
 *
 * 等级：normal（普通模组，所有模式可用）
 *
 * 作用：用户在聊天中输入 /vpc <数值> 即可对模型的回复进行奖励或惩罚校准。
 * 此模组仅用于在模组列表中展示 VPC 功能的存在，不涉及模型自动调用。
 */
import type { Module } from "../types";
import { registerModule } from "../registry";

const mod: Module = {
  id: "virtual_parameter_calibration",
  name: "虚拟参数校准（VPC）",
  description:
    "用户可以通过 /vpc <数值> 命令（-10 ~ +10，正数奖励、负数惩罚）对模型的回复进行情感反馈校准，直接作用于模型的情感中枢。此功能由用户主动触发，无需模型自动调用。",
  userDescription: "通过 /vpc 命令对模型进行奖励/惩罚反馈校准",
  level: "normal",
  execute: async function* (_params, _signal) {
    yield "虚拟参数校准（VPC）为命令触发功能，请在聊天输入框中使用 /vpc <数值> 命令。";
  },
};

registerModule(mod);
