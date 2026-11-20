/**
 * 纪律：
 * - 测试夹具不写死 macOS 的 `Library/Application Support`；需要 Claude 侧
 *   目录时优先经 claudePaths(home, opts).configLibrary 取得。
 * - 官方账本根一律经 officialLedgerRoot(home, opts) 取得。
 * - 平台上下文的 env 传空表：平台层据此把 AppData 路径全部按临时 home
 *   推导，绝不读取真实 %LOCALAPPDATA%/%APPDATA%，测试完全隔离。
 * - 只操作 mkdtempSync 临时目录，结束后清理，不碰真实用户目录。
 *
 * 断言里的 Windows 目录（AppData/Local、Packages/<包名>/LocalCache）是
 * 被测契约本身，不是通用夹具；包名后缀故意用任意值，验证平台层是扫描
 * 而非硬编码。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claudePaths, harborPaths } from "../core/archive/paths/index.ts";
import { officialLedgerRoot } from "../core/usage/paths/index.ts";

/** 每个用例独立临时目录，结束后清理。 */
function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "harbor-paths-test-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** macOS 上下文；env 为空表，平台层不读取真实环境变量。 */
const DARWIN = { platform: "darwin", env: {} } as const;

/**
 * Windows 上下文；env 为空表 → 注入的临时 home 不是真实主目录，
 * %LOCALAPPDATA% / %APPDATA% 一律按 `<home>/AppData/{Local,Roaming}` 推导。
 */
const WIN32 = { platform: "win32", env: {} } as const;

/** Windows 安装版数据根：`%LOCALAPPDATA%\Claude-3p`（注入 home 时由平台层推导）。 */
function localClaudeRoot(home: string): string {
  return join(home, "AppData", "Local", "Claude-3p");
}

/** Windows Roaming 壳目录：`%APPDATA%\Claude-3p`，实测可能只有 config.json。 */
function roamingClaudeRoot(home: string): string {
  return join(home, "AppData", "Roaming", "Claude-3p");
}

/** 商店版 MSIX 数据根：`%LOCALAPPDATA%\Packages\<Claude 包名>\LocalCache\Roaming\Claude-3p`。 */
function msixClaudeRoot(home: string, packageName: string): string {
  return join(
    home,
    "AppData",
    "Local",
    "Packages",
    packageName,
    "LocalCache",
    "Roaming",
    "Claude-3p",
  );
}

test("harborPaths：注入 home 后拼出 ~/.claudeharbor 全部路径", () => {
  withTempHome((home) => {
    const p = harborPaths(home);
    assert.equal(p.harborHome, join(home, ".claudeharbor"));
    assert.equal(p.providersDir, join(home, ".claudeharbor", "providers"));
    assert.equal(p.profilesDir, join(home, ".claudeharbor", "profiles"));
    assert.equal(
      p.providersMeta,
      join(home, ".claudeharbor", "providers", "_meta.json"),
    );
    assert.equal(
      p.profilesMeta,
      join(home, ".claudeharbor", "profiles", "_meta.json"),
    );
  });
});

test("claudePaths：darwin 固定 ~/Library/Application Support/Claude-3p", () => {
  withTempHome((home) => {
    const c = claudePaths(home, DARWIN);
    assert.equal(
      c.configLibrary,
      join(home, "Library", "Application Support", "Claude-3p", "configLibrary"),
    );
    assert.equal(c.meta, join(c.configLibrary, "_meta.json"));
  });
});

test("claudePaths：win32 候选都不存在时回退首选 %LOCALAPPDATA%\\Claude-3p", () => {
  withTempHome((home) => {
    const c = claudePaths(home, WIN32);
    assert.equal(c.configLibrary, join(localClaudeRoot(home), "configLibrary"));
    assert.equal(c.meta, join(localClaudeRoot(home), "configLibrary", "_meta.json"));
    // 官方账本根与 configLibrary 同根，同样回退到首选候选。
    assert.equal(
      officialLedgerRoot(home, WIN32),
      join(localClaudeRoot(home), "local-agent-mode-sessions"),
    );
  });
});

test("claudePaths：win32 优先 %LOCALAPPDATA%\\Claude-3p，跳过仅含壳的 %APPDATA%", () => {
  withTempHome((home) => {
    // 壳：Roaming 侧只有 config.json，没有 configLibrary。
    mkdirSync(roamingClaudeRoot(home), { recursive: true });
    writeFileSync(join(roamingClaudeRoot(home), "config.json"), "{}");
    // 真实数据：安装版 Local 侧有 configLibrary。
    const localLib = join(localClaudeRoot(home), "configLibrary");
    mkdirSync(localLib, { recursive: true });

    const c = claudePaths(home, WIN32);
    assert.equal(c.configLibrary, localLib);
    assert.equal(c.meta, join(localLib, "_meta.json"));
    assert.equal(
      officialLedgerRoot(home, WIN32),
      join(localClaudeRoot(home), "local-agent-mode-sessions"),
    );
  });
});

test("claudePaths：win32 跳过 Roaming 壳并发现 MSIX 包内数据根", () => {
  withTempHome((home) => {
    // 壳先建：若平台层按"先到先得"会误选它。
    mkdirSync(roamingClaudeRoot(home), { recursive: true });
    writeFileSync(join(roamingClaudeRoot(home), "config.json"), "{}");
    // 商店版：包名带随机后缀，平台层扫描 Packages 下 Claude* 目录。
    const msixRoot = msixClaudeRoot(home, "Claude_abcdef12345");
    mkdirSync(join(msixRoot, "configLibrary"), { recursive: true });
    mkdirSync(join(msixRoot, "local-agent-mode-sessions"), { recursive: true });

    const c = claudePaths(home, WIN32);
    assert.equal(c.configLibrary, join(msixRoot, "configLibrary"));
    assert.equal(c.meta, join(msixRoot, "configLibrary", "_meta.json"));
    assert.equal(
      officialLedgerRoot(home, WIN32),
      join(msixRoot, "local-agent-mode-sessions"),
    );
  });
});

test("claudePaths：注入 home 时忽略 env 中的 LOCALAPPDATA/APPDATA", () => {
  withTempHome((home) => {
    const other = join(home, "别的用户", "AppData");
    const c = claudePaths(home, {
      platform: "win32",
      env: {
        LOCALAPPDATA: join(other, "Local"),
        APPDATA: join(other, "Roaming"),
      },
    });
    // 注入 home 不是真实主目录，平台层必须按 home 推导而不是采信 env。
    assert.equal(c.configLibrary, join(localClaudeRoot(home), "configLibrary"));
    assert.equal(c.meta, join(localClaudeRoot(home), "configLibrary", "_meta.json"));
  });
});

test("缺省 home 使用 os.homedir()，与注入 home 一致", () => {
  assert.deepEqual(harborPaths(), harborPaths(homedir()));
  assert.deepEqual(claudePaths(), claudePaths(homedir()));
});
