import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { claudePaths } from "../core/archive/paths/index.ts";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "../scripts/claudeharbor.ts");

/** 手工造的 Claude 外来 profile（含 CLI 管理键——import 必须排除它们）。 */
const FOREIGN_UUID = "b3f1c2d4-90ab-4def-8a7b-cdef01234567";
const FOREIGN_PROFILE = {
  inferenceGatewayBaseUrl: "https://example.com/anthropic",
  inferenceGatewayApiKey: "__sealed__:v1: ciphertext",
  inferenceStreamIdleTimeoutSec: 900,
  disableDeploymentModeChooser: true,
  inferenceModels: [
    { name: "claude-sonnet-4-5", labelOverride: "主力", anthropicFamilyTier: "sonnet" },
    { name: "claude-opus-4-1" },
  ],
};

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 子进程跑 CLI 入口；input 经 stdin 喂入；非零退出码统一成结果对象。 */
async function cli(
  args: readonly string[],
  options: {
    readonly input?: string;
    readonly home?: string;
  } = {},
): Promise<CliResult> {
  const argv = options.home === undefined ? args : ["--home", options.home, ...args];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...argv], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

/**
 * Claude 侧 configLibrary 目录。
 * 一律经 claudePaths 计算（macOS 为 Application Support，Windows 为
 * AppData；相对注入的临时 home 派生），夹具不自行拼平台路径。
 */
function claudeConfigLibrary(home: string): string {
  return claudePaths(home).configLibrary;
}

/** 造 Claude 侧结构：configLibrary/<UUID>.json + _meta.json（含该 UUID 的 name）。 */
function makeClaudeSide(home: string, uuid: string, profile: unknown, name?: string): void {
  const dir = claudeConfigLibrary(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${uuid}.json`), JSON.stringify(profile, null, 2));
  writeFileSync(
    join(dir, "_meta.json"),
    JSON.stringify({
      appliedId: null,
      entries: [{ id: uuid, name: name ?? "外来配置" }],
    }),
  );
}

/** core/index 的导出探测（扁平或 archive.<ns> 命名空间均可）。 */
async function coreNamespace(name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const mod = (await import("../core/index.ts")) as Record<string, unknown>;
    const archive = mod.archive as Record<string, unknown> | undefined;
    const ns = (mod[name] ?? archive?.[name]) as Record<string, unknown> | undefined;
    return typeof ns === "object" && ns !== null ? ns : undefined;
  } catch {
    return undefined;
  }
}

async function profilesReady(): Promise<boolean> {
  const profiles = await coreNamespace("profiles");
  return typeof profiles?.importFromClaude === "function";
}

async function activateChainReady(): Promise<boolean> {
  const profiles = await coreNamespace("profiles");
  if (profiles === undefined || typeof profiles.get !== "function") return false;
  const check = await coreNamespace("check");
  const generate = await coreNamespace("generate");
  const claudeMeta = await coreNamespace("claudeMeta");
  const fsNs = await coreNamespace("fs");
  const pathsNs = await coreNamespace("paths");
  return (
    typeof check?.gate === "function" &&
    typeof generate?.generateDesktopProfile === "function" &&
    typeof claudeMeta?.upsertEntry === "function" &&
    typeof claudeMeta?.apply === "function" &&
    typeof fsNs?.atomicWriteJson === "function" &&
    typeof pathsNs?.claudePaths === "function" &&
    typeof pathsNs?.harborPaths === "function"
  );
}

// ---------- import：单元层（进程内直调，不依赖兄弟模块） ----------

test("importFromClaude：生成 readOnly sidecar + 诊断报告 + _meta 对齐", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：profiles.importFromClaude 未加载");
    return;
  }
  const { importFromClaude } = await import("../core/archive/profiles/index.ts");
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    makeClaudeSide(home, FOREIGN_UUID, FOREIGN_PROFILE, "外来配置");

    const report = importFromClaude(FOREIGN_UUID, { home });
    assert.equal(report.id, FOREIGN_UUID);
    assert.equal(report.name, "外来配置");
    assert.equal(report.entryCount, 2);
    // 透传键 = 非 CLI 管理顶层键：inferenceStreamIdleTimeoutSec + disableDeploymentModeChooser。
    assert.equal(report.passthroughKeyCount, 2);

    const sidecar = JSON.parse(
      readFileSync(join(home, ".claudeharbor", "profiles", `${FOREIGN_UUID}.json`), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(sidecar.mode, "readOnly");
    assert.equal(sidecar.version, 1);
    if (process.platform !== "win32") {
      const file = join(home, ".claudeharbor", "profiles", `${FOREIGN_UUID}.json`);
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
    assert.deepEqual(sidecar.inferenceModels, FOREIGN_PROFILE.inferenceModels);
    const claude = sidecar.claude as Record<string, unknown>;
    assert.equal(claude.inferenceStreamIdleTimeoutSec, 900);
    assert.equal(claude.disableDeploymentModeChooser, true);
    assert.equal(claude.inferenceGatewayBaseUrl, undefined, "CLI 管理键不得进透传块");
    assert.equal(claude.inferenceGatewayApiKey, undefined, "sealed key 不得进透传块");

    const meta = JSON.parse(
      readFileSync(join(home, ".claudeharbor", "profiles", "_meta.json"), "utf8"),
    ) as { appliedId: string | null; entries: { id: string; name: string }[] };
    assert.equal(meta.appliedId, null, "import 不碰激活");
    assert.deepEqual(meta.entries, [{ id: FOREIGN_UUID, name: "外来配置" }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("importFromClaude：sidecar 已存在 → CONFLICT；Claude 侧缺失 → NOT_FOUND", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：profiles.importFromClaude 未加载");
    return;
  }
  const { importFromClaude, ProfilesError } = await import("../core/archive/profiles/index.ts");
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    makeClaudeSide(home, FOREIGN_UUID, FOREIGN_PROFILE);
    importFromClaude(FOREIGN_UUID, { home });
    assert.throws(
      () => importFromClaude(FOREIGN_UUID, { home }),
      (err: unknown) => err instanceof ProfilesError && err.code === "CONFLICT",
    );
    assert.throws(
      () => importFromClaude("c4a1b2c3-90ab-4def-8a7b-cdef01234567", { home }),
      (err: unknown) => err instanceof ProfilesError && err.code === "NOT_FOUND",
    );
    assert.throws(
      () => importFromClaude("not-a-uuid", { home }),
      (err: unknown) => err instanceof ProfilesError && err.code === "VALIDATION",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("importFromClaude：Claude _meta 缺失时 name 以 UUID 占位", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：profiles.importFromClaude 未加载");
    return;
  }
  const { importFromClaude } = await import("../core/archive/profiles/index.ts");
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    const dir = claudeConfigLibrary(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${FOREIGN_UUID}.json`), JSON.stringify(FOREIGN_PROFILE));
    // 不写 _meta.json。
    const report = importFromClaude(FOREIGN_UUID, { home });
    assert.equal(report.name, FOREIGN_UUID);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- import：CLI 层（子进程，--home 注入） ----------

test("profile import CLI：诊断报告（条目数/透传键数/只读提示）", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：profiles.importFromClaude 未加载");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    makeClaudeSide(home, FOREIGN_UUID, FOREIGN_PROFILE, "外来配置");
    const r = await cli(["profile", "import", FOREIGN_UUID], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /已导入只读镜像「外来配置」/);
    assert.match(r.stdout, /模型条目数：2；透传键数：2/);
    assert.match(r.stdout, /只读，接管需删除重建/);

    const again = await cli(["profile", "import", FOREIGN_UUID], { home });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /CONFLICT|已有本地 sidecar/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("activate：readOnly 镜像拒绝激活（不依赖兄弟模块）", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：core/index 未导出 profiles 命名空间");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    makeClaudeSide(home, FOREIGN_UUID, FOREIGN_PROFILE, "外来配置");
    const r = await cli(["profile", "import", FOREIGN_UUID], { home });
    assert.equal(r.code, 0, r.stderr);
    const act = await cli(["activate", FOREIGN_UUID], { home });
    assert.equal(act.code, 1);
    assert.match(act.stderr, /readOnly/);
    assert.match(act.stderr, /不可激活/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- check / activate 全链 ----------

test("check：Claude 侧缺失时报差异，退出 1", async (t) => {
  if (!(await activateChainReady())) {
    t.skip("内核不可用：check/generate/claude-meta 命名空间未全部导出");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    const create = await cli(
      ["profile", "create", "网关", "--mode", "advanced", "--port", "8787", "--token", "tok-123", "--auth-scheme", "bearer"],
      { home },
    );
    assert.equal(create.code, 0, create.stderr);
    const id = /（([0-9a-f-]{36})）/.exec(create.stdout)?.[1];
    assert.ok(id, "create 输出应包含 UUID");
    // 创建即同步已写 Claude 侧；删掉该文件造「(file) 缺失」差异。
    rmSync(join(claudeConfigLibrary(home), `${id}.json`), { force: true });
    const check = await cli(["profile", "check", "网关"], { home });
    assert.equal(check.code, 1);
    assert.match(check.stderr, /差异|缺失/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("activate 全链：advanced 创建即同步 → 纯调度激活 → appliedId 双侧镜像", async (t) => {
  if (!(await activateChainReady())) {
    t.skip("内核不可用：check/generate/claude-meta 命名空间未全部导出");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    // 备两个 profile：验证激活后 _meta entries 全保留。
    const main = await cli(
      ["profile", "create", "主力", "--mode", "advanced", "--port", "8787", "--token", "mytoken123", "--auth-scheme", "bearer"],
      { home },
    );
    assert.equal(main.code, 0, main.stderr);
    const id = /（([0-9a-f-]{36})）/.exec(main.stdout)?.[1];
    assert.ok(id, "create 输出应包含 UUID");
    const other = await cli(
      ["profile", "create", "备用", "--mode", "advanced", "--port", "8790", "--token", "tok2", "--auth-scheme", "x-api-key"],
      { home },
    );
    assert.equal(other.code, 0, other.stderr);

    const checkAligned = await cli(["profile", "check", "主力"], { home });
    assert.equal(checkAligned.code, 0, `${checkAligned.stderr}\n${checkAligned.stdout}`);
    assert.match(checkAligned.stdout, /一致 ✓/);

    const act = await cli(["activate", "主力"], { home });
    assert.equal(act.code, 0, `${act.stderr}\n${act.stdout}`);
    assert.match(act.stdout, /① 已读取 profile「主力」/);
    assert.match(act.stdout, /③ 一致性检查通过/);
    assert.match(act.stdout, /⑤ 已同步本地 appliedId 镜像/);
    assert.match(act.stdout, /已激活 主力。启动网关：claudeharbor gateway-run 主力（advanced）/);
    assert.doesNotMatch(act.stdout, /网关监听/, "activate 不再启动网关");

    const libDir = claudeConfigLibrary(home);
    const written = JSON.parse(readFileSync(join(libDir, `${id}.json`), "utf8")) as Record<string, unknown>;
    assert.equal(written.inferenceProvider, "gateway");
    assert.equal(written.inferenceCredentialKind, "static");
    assert.equal(written.inferenceGatewayBaseUrl, "http://127.0.0.1:8787");
    assert.equal(written.inferenceGatewayApiKey, "mytoken123");
    assert.equal(written.inferenceGatewayAuthScheme, undefined, "bearer 时按 Desktop 惯例省略 scheme 键");
    assert.ok(Array.isArray(written.inferenceModels));

    const claudeMeta = JSON.parse(readFileSync(join(libDir, "_meta.json"), "utf8")) as {
      appliedId: string;
      entries: { id: string; name: string }[];
    };
    assert.equal(claudeMeta.appliedId, id);
    assert.ok(claudeMeta.entries.some((e) => e.id === id && e.name === "主力"));

    const harborMeta = JSON.parse(
      readFileSync(join(home, ".claudeharbor", "profiles", "_meta.json"), "utf8"),
    ) as { appliedId: string; entries: { id: string; name: string }[] };
    assert.equal(harborMeta.appliedId, id);
    assert.equal(harborMeta.entries.length, 2);
    assert.ok(harborMeta.entries.some((e) => e.name === "主力"));
    assert.ok(harborMeta.entries.some((e) => e.name === "备用"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("activate：standard 直连激活成功，不写网关段", async (t) => {
  if (!(await activateChainReady())) {
    t.skip("内核不可用：check/generate/claude-meta 命名空间未全部导出");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-activate-test-"));
  try {
    // standard 需要供应商：先加一家，再手工把供应商三件套写进 Claude 侧
    // 对齐（standard 的 generate 从供应商文件取值，期望物以兄弟模块生成为准）。
    const add = await cli(["provider", "add", "deepseek", "https://api.deepseek.com/anthropic", "sk-testsecret"], { home });
    assert.equal(add.code, 0, add.stderr);
    const create = await cli(["profile", "create", "直连", "--mode", "standard"], { home });
    assert.equal(create.code, 0, create.stderr);
    const id = /（([0-9a-f-]{36})）/.exec(create.stdout)?.[1];
    assert.ok(id);

    const mod = (await import("../core/index.ts")) as Record<string, unknown>;
    const archive = mod.archive as Record<string, unknown> | undefined;
    const profilesNs = (mod.profiles ?? archive?.profiles) as {
      get(idOrName: string, opts?: { home?: string }): unknown;
      addEntry(idOrName: string, entry: unknown, opts?: { home?: string }): void;
    };
    const providersNs = (mod.providers ?? archive?.providers) as {
      list(opts?: { home?: string }): readonly { id: string; name: string }[];
    };
    const generateNs = (mod.generate ?? archive?.generate) as {
      generateDesktopProfile(profile: unknown, provider?: unknown): unknown;
    };
    const fsNs = (mod.fs ?? archive?.fs) as { atomicWriteJson(p: string, o: unknown, m: number): void };
    // Provider 对象不含 UUID（文件名即 ID）——经 list() 索引取 id 与三件套。
    const provEntry = providersNs.list({ home }).find((e) => e.name === "deepseek");
    assert.ok(provEntry, "供应商 deepseek 应已添加");
    const provider = (mod.providers ?? archive?.providers) as {
      getById(id: string, opts?: { home?: string }): unknown;
    };
    const providerData = provider.getById(provEntry.id, { home });
    profilesNs.addEntry("直连", { name: "claude-sonnet-4-5", provider: provEntry.id }, { home });
    const generated = generateNs.generateDesktopProfile(profilesNs.get("直连", { home }), providerData) as Record<string, unknown>;
    const libDir = claudeConfigLibrary(home);
    mkdirSync(libDir, { recursive: true });
    fsNs.atomicWriteJson(join(libDir, `${id}.json`), generated, 0o644);
    // 纯调度激活只 apply 不登记：手工对齐需同时登记 Claude _meta 条目。
    const claudeMetaNs = (mod.claudeMeta ?? archive?.claudeMeta) as {
      upsertEntry(e: { id: string; name: string }, o?: { home?: string }): unknown;
    };
    claudeMetaNs.upsertEntry({ id, name: "直连" }, { home });

    const act = await cli(["activate", "直连"], { home });
    assert.equal(act.code, 0, `${act.stderr}\n${act.stdout}`);
    assert.match(act.stdout, /已激活 直连。（standard 直连供应商/);

    const written = JSON.parse(readFileSync(join(libDir, `${id}.json`), "utf8")) as Record<string, unknown>;
    assert.equal(written.inferenceGatewayBaseUrl, "https://api.deepseek.com/anthropic");
    const claudeMeta = JSON.parse(readFileSync(join(libDir, "_meta.json"), "utf8")) as { appliedId: string };
    assert.equal(claudeMeta.appliedId, id);
    assert.ok(existsSync(join(home, ".claudeharbor", "profiles", "_meta.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
