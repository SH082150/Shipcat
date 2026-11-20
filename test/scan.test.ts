import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { add as addProvider } from "../core/archive/providers/index.ts";
import {
  create as createProfile,
  get as getProfile,
  meta as localMeta,
  setAppliedIdMirror,
} from "../core/archive/profiles/index.ts";
import {
  read as readClaudeMeta,
  removeEntry as removeClaudeEntry,
} from "../core/archive/claude-meta/index.ts";
import { generateDesktopProfile } from "../core/archive/generate/index.ts";
import { claudePaths, harborPaths } from "../core/archive/paths/index.ts";
import { scan } from "../core/check/index.ts";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "harbor-scan-test-"));
}
function claudeDir(home: string): string {
  return claudePaths(home).configLibrary;
}

const PROVIDER = {
  name: "deepseek",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-scan-test",
  inferenceGatewayAuthScheme: "x-api-key" as const,
};

test("情形①：Claude 条目消失 → 自动删本地 sidecar（含清悬空 appliedId 镜像）", () => {
  const home = makeHome();
  try {
    addProvider(PROVIDER, { home });
    const created = createProfile({ name: "将被删", mode: "advanced", port: 9001, gatewayToken: "t", gatewayAuthScheme: "bearer" }, { home });
    // 模拟用户把本地 appliedId 镜像指向它，然后 Desktop 删了该 profile（条目+文件）
    setAppliedIdMirror(created.id, { home });
    removeClaudeEntry(created.id, { home });
    rmSync(join(claudeDir(home), `${created.id}.json`), { force: true });

    const result = scan({ home });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]?.kind, "removed");
    assert.match(result.actions[0]?.message ?? "", /将被删/);
    assert.equal(existsSync(join(harborPaths(home).profilesDir, `${created.id}.json`)), false);
    assert.equal(localMeta({ home }).entries.length, 0);
    assert.equal(localMeta({ home }).appliedId, null, "悬空镜像应被清除");
    assert.equal(existsSync(join(claudeDir(home), `${created.id}.json`)), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("情形②：Claude 多出条目（无 sidecar）→ 自动建只读 sidecar", () => {
  const home = makeHome();
  try {
    // 手工造一个"外部 profile"：Claude 文件 + Claude _meta 条目，无本地 sidecar
    const foreignId = "b3f1c2d4-90ab-4def-8a7b-cdef01234567";
    const dir = claudeDir(home);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync_helper(dir);
    writeJson_helper(join(dir, `${foreignId}.json`), {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "http://127.0.0.1:15721",
      inferenceModels: [{ name: "claude-sonnet-5-5" }],
    });
    const cm = readClaudeMeta({ home });
    writeJson_helper(claudePaths(home).meta, {
      appliedId: cm.appliedId,
      entries: [...cm.entries, { id: foreignId, name: "外部配置" }],
    });

    const result = scan({ home });
    assert.ok(result.actions.some((a) => a.kind === "imported" && a.name === "外部配置"));
    const sidecar = getProfile(foreignId, { home });
    assert.equal(sidecar.mode, "readOnly");
    assert.deepEqual(
      (sidecar.inferenceModels as { name: string }[]).map((e) => e.name),
      ["claude-sonnet-5-5"],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("E5 异常态：条目在两侧但 Claude 文件缺失 → 自动重建文件", () => {
  const home = makeHome();
  try {
    addProvider(PROVIDER, { home });
    const created = createProfile({ name: "文件会丢", mode: "advanced", port: 9002, gatewayToken: "t", gatewayAuthScheme: "bearer" }, { home });
    const file = join(claudeDir(home), `${created.id}.json`);
    assert.ok(existsSync(file), "create 应已同步");
    rmSync(file);

    const result = scan({ home });
    assert.ok(result.actions.some((a) => a.kind === "file-rebuilt" && a.name === "文件会丢"));
    assert.ok(existsSync(file), "scan 应重建文件");
    const expected = generateDesktopProfile(getProfile(created.id, { home }));
    const actual = JSON.parse(readFile_helper(file));
    assert.deepEqual(actual, expected);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("干净状态：scan 无动作，connected 列出已连接条目", () => {
  const home = makeHome();
  try {
    addProvider(PROVIDER, { home });
    const a = createProfile({ name: "甲", mode: "advanced", port: 9003, gatewayToken: "t", gatewayAuthScheme: "bearer" }, { home });
    const b = createProfile({ name: "乙", mode: "advanced", port: 9004, gatewayToken: "t", gatewayAuthScheme: "bearer" }, { home });
    const result = scan({ home });
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.connected.map((e) => e.id).sort(), [a.id, b.id].sort());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// —— 测试内小工具 ——
function mkdirSync_helper(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
function writeJson_helper(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}
function readFile_helper(path: string): string {
  return readFileSync(path, "utf8");
}
