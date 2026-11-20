/**
 * 用量配置文件：独立于 Claude 档案（profiles）的数据概念，供用量页展示。
 *
 * 设置 → 用量 的“监控配置文件”选择器与“更改配置文件”弹窗共用这份列表；
 * DEMO_USAGE_PROFILES 是界面占位数据，接入 core 后由主进程数据替换。
 */

export interface UsageProfileEntry {
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
}

export const DEMO_USAGE_PROFILES: readonly UsageProfileEntry[] = [
  { id: "usage-claude", name: "Claude 官方额度", summary: "每 30 分钟 · 脚本待接入" },
  { id: "usage-deepseek", name: "DeepSeek 余额", summary: "每小时 · 脚本待接入" },
];
