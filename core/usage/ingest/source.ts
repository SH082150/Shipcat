/**
 * 官方来源探测与单行解析。
 *
 * 目录结构复用 core/usage/paths 的 listOfficialLedgerFiles：
 * `<sessions根>/<账号>/<子层>/usage-ledger/<YYYY-MM-DD>.ndjson`。
 * 解析函数是纯函数，坏行/未知版本不抛错，由调用方决定是否告警。
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolveHome } from "../../platform/index.ts";
import type { PlatformOptions } from "../../platform/index.ts";
import { resolveUsageSourceRoot } from "../../settings/paths.ts";
import { listOfficialLedgerFiles } from "../paths/index.ts";
import type {
  ParseLineResult,
  ParsedModelMetric,
  SourceConfig,
  SourceFile,
} from "./types.ts";

export interface SourceFiles {
  /** 实际扫描的 sessions 根。 */
  readonly root: string;
  readonly files: readonly SourceFile[];
}

/** 解析来源的 sessions 根：settings.root > 环境变量 > 平台探测。 */
export function sourceRoot(
  source: SourceConfig,
  home: string = resolveHome(),
  opts?: PlatformOptions,
): string {
  return resolveUsageSourceRoot(source.root, home, opts);
}

/** 枚举来源下的全部官方账本文件。 */
export function listSourceFiles(
  source: SourceConfig,
  home: string = resolveHome(),
  opts?: PlatformOptions,
): SourceFiles {
  const root = sourceRoot(source, home, opts);
  const files = listOfficialLedgerFiles(root).map(
    (file): SourceFile => ({
      day: file.day,
      absPath: file.absPath,
      sourcePath: file.absPath,
      sourceRel: file.sourceRel,
    }),
  );
  return { root, files };
}

/**
 * 列出需要 fs.watch 的目录：sessions 根、账号目录、子层目录与 usage-ledger 目录。
 * 只返回存在的目录；根不存在时返回空数组，由 service 改为监听最近的已存在祖先。
 */
export function listWatchDirectories(root: string): string[] {
  if (!existsSync(root)) return [];
  const dirs = [root];
  for (const account of safeSubdirs(root)) {
    const accountDir = join(root, account);
    dirs.push(accountDir);
    for (const sub of safeSubdirs(accountDir)) {
      const workspaceDir = join(accountDir, sub);
      dirs.push(workspaceDir);
      const ledger = join(workspaceDir, "usage-ledger");
      if (existsSync(ledger)) dirs.push(ledger);
    }
  }
  return dirs;
}

function safeSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function localDay(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function parseModels(value: unknown): ParsedModelMetric[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const models = value as Record<string, unknown>;
  const out: ParsedModelMetric[] = [];
  for (const name of Object.keys(models).sort()) {
    const usage = models[name];
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) continue;
    const raw = usage as Record<string, unknown>;
    out.push({
      model: name,
      inputTokens: numeric(raw.inputTokens),
      outputTokens: numeric(raw.outputTokens),
      cacheReadTokens: numeric(raw.cacheReadTokens),
      cacheWriteTokens: numeric(raw.cacheWriteTokens),
      webSearchRequests: numeric(raw.webSearchRequests),
    });
  }
  return out;
}

/**
 * 解析一行官方 NDJSON。空行返回 empty；坏行返回 bad（调用方告警并跳过）；
 * 合法行返回事件，未知版本也照常返回。
 */
export function parseLedgerLine(line: string): ParseLineResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { kind: "empty" };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { kind: "bad", reason: "JSON 解析失败" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "bad", reason: "记录不是对象" };
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.v !== "number" || !Number.isFinite(record.v)) {
    return { kind: "bad", reason: "缺少版本号 v" };
  }
  if (typeof record.ts !== "number" || !Number.isFinite(record.ts)) {
    return { kind: "bad", reason: "缺少时间戳 ts" };
  }
  if (typeof record.surface !== "string") {
    return { kind: "bad", reason: "缺少 surface" };
  }
  if (typeof record.origin !== "string") {
    return { kind: "bad", reason: "缺少 origin" };
  }
  if (record.models === null || typeof record.models !== "object" || Array.isArray(record.models)) {
    return { kind: "bad", reason: "缺少 models" };
  }

  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.length > 0
      ? record.sessionId
      : null;

  return {
    kind: "ok",
    event: {
      fingerprint: createHash("sha256").update(trimmed).digest("hex"),
      day: localDay(record.ts),
      ts: record.ts,
      surface: record.surface,
      origin: record.origin,
      sessionId,
      models: parseModels(record.models),
      version: record.v,
    },
  };
}
