/**
 * 内核统一出口：汇总导出各子模块公共 API。CLI（scripts/）与 Electron UI
 * 只从这里取货，不允许越过它 import 深层文件。
 */

export * from "./types.ts";
export * as platform from "./platform/index.ts";
export * as validate from "./validate/index.ts";
export * as providers from "./archive/providers/index.ts";
export * as profiles from "./archive/profiles/index.ts";
export * as generate from "./archive/generate/index.ts";
export * as claudeMeta from "./archive/claude-meta/index.ts";
export * as claudeBlock from "./archive/claude-block/index.ts";
export * as check from "./check/index.ts";
export * as fs from "./archive/fs/index.ts";
export * as paths from "./archive/paths/index.ts";
export * as gateway from "./gateway/0-server/index.ts";
export * as usage from "./usage/index.ts";
export * as lifecycle from "./lifecycle/index.ts";
export * as sync from "./sync/index.ts";
