/**
 * Usage 路径定位：全模块唯一出处，纯计算，无副作用。
 *
 * 只支持 3p 客户端（Claude-3p），不扫描经典版 Claude 目录。官方账本根与
 * Harbor 镜像根都经 ../platform 计算；所有函数允许注入 home，便于测试。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { harborRoot, localAgentSessionsRoot, resolveHome } from "../../platform/index.ts";
import type { PlatformOptions } from "../../platform/index.ts";

/** 官方 usage-ledger 账本根：`<Claude-3p>/local-agent-mode-sessions`。 */
export function officialLedgerRoot(home: string = resolveHome(), opts?: PlatformOptions): string {
  return localAgentSessionsRoot(home, opts);
}

/** ClaudeHarbor Usage 镜像根：~/.claudeharbor/usage。 */
export function usageRoot(home: string = resolveHome(), opts?: PlatformOptions): string {
  return join(harborRoot(home, opts), "usage");
}

/** 镜像账本目录：usageRoot/ledger（按天平铺，与官方同构）。 */
export function ledgerDir(home: string = resolveHome(), opts?: PlatformOptions): string {
  return join(usageRoot(home, opts), "ledger");
}

/** 镜像目录的 _meta.json。 */
export function metaFile(home: string = resolveHome(), opts?: PlatformOptions): string {
  return join(usageRoot(home, opts), "_meta.json");
}

export interface OfficialLedgerFile {
  /** 日期 = 文件名去掉 .ndjson（YYYY-MM-DD）。 */
  readonly day: string;
  readonly absPath: string;
  /** 相对官方账本根的路径（<账号>/<子层>/usage-ledger/<day>.ndjson）。 */
  readonly sourceRel: string;
}

/**
 * 枚举官方账本文件：根目录下两层固定结构（账号目录 / 子层目录）
 * 里的 usage-ledger 目录中的 .ndjson 文件。
 * 目录不存在返回 []；只认两层固定结构下的 usage-ledger 目录。
 */
export function listOfficialLedgerFiles(root: string): OfficialLedgerFile[] {
  if (!existsSync(root)) return [];
  const result: OfficialLedgerFile[] = [];
  for (const account of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!account.isDirectory() || account.isSymbolicLink()) continue;
    const accountDir = join(root, account.name);
    for (const sub of readdirSync(accountDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!sub.isDirectory() || sub.isSymbolicLink()) continue;
      const ledger = join(accountDir, sub.name, "usage-ledger");
      if (!existsSync(ledger)) continue;
      for (const file of readdirSync(ledger, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!file.isFile() || !file.name.endsWith(".ndjson")) continue;
        const absPath = join(ledger, file.name);
        if (!statSync(absPath).isFile()) continue;
        result.push({
          day: file.name.slice(0, -".ndjson".length),
          absPath,
          // sourceRel 统一用正斜杠：它是跨平台元数据（Windows 分隔符不泄漏）。
          sourceRel: relative(root, absPath).split("\\").join("/"),
        });
      }
    }
  }
  return result;
}
