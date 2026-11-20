/**
 * 纪律：全部用 mkdtempSync 临时 home + 注入假 env，不读真实环境变量，
 * 也不写真实用户目录（Claude 侧目录一律经 claudePaths / officialLedgerRoot
 * 计算，不硬编码 `Library/Application Support`）。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { claudePaths } from "../core/archive/paths/index.ts";
import {
  CLAUDE_ROOT_ENV,
  HOME_ENV,
  claudeCodeRoot,
  desktopDataRoot,
  desktopDataRootCandidates,
  harborRoot,
  inspectDesktopRoots,
  localAgentSessionsRoot,
  resolveHome,
} from "../core/platform/index.ts";
import { syncLedger } from "../core/usage/index.ts";
import { ledgerDir, metaFile, officialLedgerRoot } from "../core/usage/paths/index.ts";

/** 每个用例独立临时目录，结束后清理。 */
function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "harbor-platform-test-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Windows 假 env：把注入的 home 当作"真实主目录"，
 * 因此本地/漫游 AppData 指向 home 之下（不读真实环境变量）。
 */
function winEnv(home: string): Record<string, string> {
  return {
    USERPROFILE: home,
    LOCALAPPDATA: join(home, "AppData", "Local"),
    APPDATA: join(home, "AppData", "Roaming"),
  };
}

/** 建目录并返回其路径（多级自动创建）。 */
function touchDir(...parts: string[]): string {
  const path = join(...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

const NOW = new Date("2026-11-18T10:00:00.000Z");

/** 造一行官方账本记录。 */
function ledgerLine(day: string): string {
  return JSON.stringify({
    v: 1,
    ts: new Date(`${day}T12:00:00`).getTime(),
    surface: "chat",
    origin: "turn",
    isError: false,
    models: {
      "claude-sonnet-9-9": {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
        webSearchRequests: 0,
      },
    },
  });
}

test("darwin：Claude-3p 数据根固定在 ~/Library/Application Support", () => {
  withTempHome((home) => {
    // 假 env 里故意放 Windows 与 Linux 的变量，验证 darwin 完全不看它们。
    const env = {
      HOME: home,
      USERPROFILE: "C:\\Users\\someone-else",
      LOCALAPPDATA: "C:\\Users\\someone-else\\AppData\\Local",
      XDG_CONFIG_HOME: join(home, "xdg-config"),
    };
    const opts = { platform: "darwin", env };
    const root = join(home, "Library", "Application Support", "Claude-3p");

    assert.deepEqual(desktopDataRootCandidates(home, opts), [root]);
    assert.equal(desktopDataRoot(home, opts), root);
    assert.equal(localAgentSessionsRoot(home, opts), join(root, "local-agent-mode-sessions"));
    assert.equal(claudePaths(home, opts).configLibrary, join(root, "configLibrary"));
  });
});

test("linux：XDG_CONFIG_HOME 绝对路径生效，相对或缺失回退 ~/.config", () => {
  withTempHome((home) => {
    const xdg = join(home, "xdg-config");
    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "linux", env: { HOME: home, XDG_CONFIG_HOME: xdg } }),
      [join(xdg, "Claude-3p")],
    );

    // XDG 必须是绝对路径，相对路径按未设置处理。
    assert.deepEqual(
      desktopDataRootCandidates(home, {
        platform: "linux",
        env: { HOME: home, XDG_CONFIG_HOME: join("relative", "config") },
      }),
      [join(home, ".config", "Claude-3p")],
    );

    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "linux", env: { HOME: home } }),
      [join(home, ".config", "Claude-3p")],
    );
    assert.equal(
      officialLedgerRoot(home, { platform: "linux", env: { HOME: home } }),
      join(home, ".config", "Claude-3p", "local-agent-mode-sessions"),
    );
  });
});

test("未知平台：沿用历史 macOS 布局，不做多候选探测", () => {
  withTempHome((home) => {
    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "freebsd", env: { HOME: home } }),
      [join(home, "Library", "Application Support", "Claude-3p")],
    );
  });
});

test("harborRoot / claudeCodeRoot：两个平台都保持点目录命名", () => {
  withTempHome((home) => {
    for (const platform of ["darwin", "win32", "linux"]) {
      assert.equal(harborRoot(home, { platform }), join(home, ".claudeharbor"));
      assert.equal(claudeCodeRoot(home, { platform }), join(home, ".claude"));
    }
  });
});

test("win32：候选顺序 = 安装版本地 → Roaming → MSIX 包 → 同级变体", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const roaming = join(home, "AppData", "Roaming");

    // 商店版包名带随机后缀，只能靠扫描发现；无关包与非 Claude 目录必须排除。
    const msixRoot = touchDir(local, "Packages", "Claude_ab12cd34ef56", "LocalCache", "Roaming", "Claude-3p");
    touchDir(local, "Packages", "OtherApp_aaaaaaaaaaa", "LocalCache", "Roaming", "Claude-3p");
    const betaRoot = touchDir(local, "Claude-3p-beta");
    touchDir(local, "Unrelated");

    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "win32", env: winEnv(home) }),
      [join(local, "Claude-3p"), join(roaming, "Claude-3p"), msixRoot, betaRoot],
    );
  });
});

test("win32：LOCALAPPDATA 与 APPDATA 指向同一目录时候选去重", () => {
  withTempHome((home) => {
    const shared = join(home, "AppData", "Local");
    const candidates = desktopDataRootCandidates(home, {
      platform: "win32",
      env: { USERPROFILE: home, LOCALAPPDATA: shared, APPDATA: shared },
    });
    assert.deepEqual(candidates, [join(shared, "Claude-3p")]);
  });
});

test("win32：按存在性打分，跳过只有壳文件的本地目录", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const roaming = join(home, "AppData", "Roaming");
    // 安装版位置可能只留一个 config.json（语言等壳数据）。
    touchDir(local, "Claude-3p");
    writeFileSync(join(local, "Claude-3p", "config.json"), "{}\n");
    // 真实数据在 Roaming。
    touchDir(roaming, "Claude-3p", "configLibrary");

    const opts = { platform: "win32", env: winEnv(home) };
    assert.equal(desktopDataRoot(home, opts), join(roaming, "Claude-3p"));
    assert.equal(
      localAgentSessionsRoot(home, opts),
      join(roaming, "Claude-3p", "local-agent-mode-sessions"),
    );
  });
});

test("win32：configLibrary 与 local-agent-mode-sessions 分居两个候选时各取所需", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const roaming = join(home, "AppData", "Roaming");
    touchDir(local, "Claude-3p", "configLibrary");
    touchDir(roaming, "Claude-3p", "local-agent-mode-sessions");

    // 写 profile 用 configLibrary 所在根；读账本用引擎会话所在根。
    const opts = { platform: "win32", env: winEnv(home) };
    assert.equal(desktopDataRoot(home, opts), join(local, "Claude-3p"));
    assert.equal(
      localAgentSessionsRoot(home, opts),
      join(roaming, "Claude-3p", "local-agent-mode-sessions"),
    );
    assert.equal(
      officialLedgerRoot(home, opts),
      join(roaming, "Claude-3p", "local-agent-mode-sessions"),
    );
  });
});

test("win32：都不含标记目录时退回首个存在的候选，全不存在时退回首个候选", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const opts = { platform: "win32", env: winEnv(home) };

    // 全不存在：仍给首个候选，让上层保持"目录不存在"的既有行为。
    assert.equal(desktopDataRoot(home, opts), join(local, "Claude-3p"));

    // 只有本地目录存在（空壳）→ 退回它。
    touchDir(local, "Claude-3p");
    assert.equal(desktopDataRoot(home, opts), join(local, "Claude-3p"));
  });
});

test("win32：仅商店版（MSIX）存在时数据根落在包内 LocalCache", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const msixRoot = join(local, "Packages", "Claude_ab12cd34ef56", "LocalCache", "Roaming", "Claude-3p");
    touchDir(msixRoot, "configLibrary");
    touchDir(msixRoot, "local-agent-mode-sessions");

    const opts = { platform: "win32", env: winEnv(home) };
    assert.equal(desktopDataRoot(home, opts), msixRoot);
    assert.equal(claudePaths(home, opts).configLibrary, join(msixRoot, "configLibrary"));
  });
});

test("inspectDesktopRoots：逐候选给出存在性与两个标记目录", () => {
  withTempHome((home) => {
    const local = join(home, "AppData", "Local");
    const msixRoot = join(local, "Packages", "Claude_ab12cd34ef56", "LocalCache", "Roaming", "Claude-3p");
    touchDir(local, "Claude-3p", "configLibrary");
    touchDir(msixRoot, "local-agent-mode-sessions");

    const opts = { platform: "win32", env: winEnv(home) };
    const rows = inspectDesktopRoots(home, opts);

    // 诊断列表的顺序必须与自动探测的候选顺序一致（用户照此填 --claude-root）。
    assert.deepEqual(
      rows.map((row) => row.path),
      desktopDataRootCandidates(home, opts),
    );
    assert.deepEqual(rows, [
      {
        path: join(local, "Claude-3p"),
        exists: true,
        hasConfigLibrary: true,
        hasLocalAgentSessions: false,
      },
      {
        path: join(home, "AppData", "Roaming", "Claude-3p"),
        exists: false,
        hasConfigLibrary: false,
        hasLocalAgentSessions: false,
      },
      {
        path: msixRoot,
        exists: true,
        hasConfigLibrary: false,
        hasLocalAgentSessions: true,
      },
    ]);
  });
});

test("CLAUDE_ROOT_ENV：手工指定数据根时只返回该唯一候选（空值视为未设置）", () => {
  withTempHome((home) => {
    const explicit = join(home, "custom-claude-root");
    const opts = { platform: "win32", env: { ...winEnv(home), [CLAUDE_ROOT_ENV]: explicit } };

    assert.deepEqual(desktopDataRootCandidates(home, opts), [explicit]);
    // 不探测、不要求存在：指定即用。
    assert.equal(desktopDataRoot(home, opts), explicit);
    assert.equal(localAgentSessionsRoot(home, opts), join(explicit, "local-agent-mode-sessions"));
    assert.equal(claudePaths(home, opts).configLibrary, join(explicit, "configLibrary"));

    // 覆盖与平台无关：darwin 同样只认这一个候选。
    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "darwin", env: { [CLAUDE_ROOT_ENV]: explicit } }),
      [explicit],
    );

    // 空串视为未设置，回退平台推导。
    assert.deepEqual(
      desktopDataRootCandidates(home, { platform: "darwin", env: { [CLAUDE_ROOT_ENV]: "" } }),
      [join(home, "Library", "Application Support", "Claude-3p")],
    );
  });
});

test("resolveHome：CLAUDEHARBOR_HOME 优先，其次按平台取主目录", () => {
  withTempHome((home) => {
    // 显式注入压过一切平台变量。
    const injected = resolveHome({
      platform: "win32",
      env: { [HOME_ENV]: home, USERPROFILE: "C:\\Users\\real", HOME: "/c/Users/real" },
    });
    assert.equal(injected, home);
    assert.equal(harborRoot(injected, { platform: "win32" }), join(home, ".claudeharbor"));

    // win32 取 USERPROFILE：Git Bash 的 HOME 是 POSIX 写法，不能直接拼 Windows 路径。
    assert.equal(
      resolveHome({ platform: "win32", env: { USERPROFILE: "C:\\Users\\real", HOME: "/c/Users/real" } }),
      "C:\\Users\\real",
    );

    // win32 缺 USERPROFILE 时回退 HOME。
    assert.equal(
      resolveHome({ platform: "win32", env: { HOME: "/c/Users/real" } }),
      "/c/Users/real",
    );

    // darwin / linux 取 HOME。
    assert.equal(
      resolveHome({ platform: "darwin", env: { HOME: "/Users/real", USERPROFILE: "C:\\Users\\real" } }),
      "/Users/real",
    );
    assert.equal(
      resolveHome({ platform: "linux", env: { HOME: "/home/real", USERPROFILE: "C:\\Users\\real" } }),
      "/home/real",
    );

    // 空的 CLAUDEHARBOR_HOME 不算注入。
    assert.equal(
      resolveHome({ platform: "darwin", env: { [HOME_ENV]: "", HOME: "/Users/real" } }),
      "/Users/real",
    );

    // 全缺失时回退 os.homedir()（只读，不写任何文件）。
    assert.equal(resolveHome({ platform: "linux", env: {} }), homedir());
  });
});

test("注入 home：AppData 从 home 推导，不读 env 里的真实 LOCALAPPDATA", () => {
  withTempHome((home) => {
    const fakeRealLocal = join(tmpdir(), "harbor-fake-localappdata");
    const fakeRealRoaming = join(tmpdir(), "harbor-fake-roaming");
    const env = {
      USERPROFILE: join(tmpdir(), "harbor-other-user"),
      LOCALAPPDATA: fakeRealLocal,
      APPDATA: fakeRealRoaming,
    };

    const candidates = desktopDataRootCandidates(home, { platform: "win32", env });
    for (const candidate of candidates) {
      assert.ok(candidate.startsWith(home), `候选越出注入 home：${candidate}`);
      assert.ok(!candidate.includes(fakeRealLocal), `候选读了真实 LOCALAPPDATA：${candidate}`);
      assert.ok(!candidate.includes(fakeRealRoaming), `候选读了真实 APPDATA：${candidate}`);
    }
    assert.deepEqual(candidates.slice(0, 2), [
      join(home, "AppData", "Local", "Claude-3p"),
      join(home, "AppData", "Roaming", "Claude-3p"),
    ]);

    // 连 USERPROFILE 都没有时同样从 home 推导（不落到 process.env）。
    const noProfile = desktopDataRootCandidates(home, {
      platform: "win32",
      env: { LOCALAPPDATA: fakeRealLocal, APPDATA: fakeRealRoaming },
    });
    assert.deepEqual(noProfile.slice(0, 2), [
      join(home, "AppData", "Local", "Claude-3p"),
      join(home, "AppData", "Roaming", "Claude-3p"),
    ]);
  });
});

test("真实主目录：env 里的 LOCALAPPDATA / APPDATA 生效（组策略重定向）", () => {
  withTempHome((home) => {
    // home 与 USERPROFILE 一致才算真实主目录，此时才允许采用系统重定向路径。
    const redirectedLocal = join(home, "redirected", "Local");
    const redirectedRoaming = join(home, "redirected", "Roaming");
    const candidates = desktopDataRootCandidates(home, {
      platform: "win32",
      env: { USERPROFILE: home, LOCALAPPDATA: redirectedLocal, APPDATA: redirectedRoaming },
    });
    assert.deepEqual(candidates.slice(0, 2), [
      join(redirectedLocal, "Claude-3p"),
      join(redirectedRoaming, "Claude-3p"),
    ]);
  });
});

test("win32 端到端：临时 home 下假官方账本经 syncLedger 成功镜像", () => {
  withTempHome((home) => {
    // syncLedger 只接受 home、平台/env 走进程环境：临时屏蔽外部覆盖，
    // 保证本用例走真实的平台推导，同时结束后原样恢复。
    const savedRootEnv = process.env[CLAUDE_ROOT_ENV];
    delete process.env[CLAUDE_ROOT_ENV];
    try {
      runEndToEndSync(home);
    } finally {
      if (savedRootEnv !== undefined) process.env[CLAUDE_ROOT_ENV] = savedRootEnv;
    }
  });
});

/** win32 端到端主体：造假官方账本 → syncLedger → 校验镜像与 _meta。 */
function runEndToEndSync(home: string): void {
  const root = officialLedgerRoot(home);
  // 安全护栏：账本根必须落在注入的临时 home 内，绝不写真实用户目录。
  assert.ok(root.startsWith(home), `官方账本根越界：${root}`);
  // Windows 真机上默认布局：%LOCALAPPDATA%\Claude-3p\local-agent-mode-sessions。
  if (process.platform === "win32") {
    assert.equal(root, join(home, "AppData", "Local", "Claude-3p", "local-agent-mode-sessions"));
  }

  const day = "2026-11-18";
  const source = join(root, "a1b2c3d4", "00000000", "usage-ledger", `${day}.ndjson`);
  mkdirSync(dirname(source), { recursive: true });
  const line = ledgerLine(day);
  writeFileSync(source, `${line}\n`);

  const result = syncLedger({ home, now: NOW });

  assert.equal(result.filesScanned, 1);
  assert.equal(result.filesNew, 1);
  assert.equal(result.filesAppended, 0);
  assert.equal(result.filesRewritten, 0);
  assert.equal(result.filesSkipped, 0);
  assert.equal(result.linesAdded, 1);

  const mirror = join(ledgerDir(home), `${day}.ndjson`);
  assert.equal(existsSync(mirror), true);
  assert.equal(readFileSync(mirror, "utf8"), `${line}\n`);

  const meta = JSON.parse(readFileSync(metaFile(home), "utf8")) as {
    sourceRoot: string;
    files: Record<string, { source: string; byteOffset: number }>;
  };
  assert.equal(meta.sourceRoot, root);
  assert.match(meta.sourceRoot, /Claude-3p[\\/]local-agent-mode-sessions$/);
  const cursor = meta.files[`${day}.ndjson`];
  assert.ok(cursor);
  assert.equal(cursor.source, "a1b2c3d4/00000000/usage-ledger/2026-11-18.ndjson");
  assert.equal(cursor.byteOffset, Buffer.byteLength(`${line}\n`, "utf8"));

  // 第二轮无新增：不重复镜像、不重复计数。
  const second = syncLedger({ home, now: NOW });
  assert.equal(second.filesNew, 0);
  assert.equal(second.filesAppended, 0);
  assert.equal(second.linesAdded, 0);
  assert.equal(readFileSync(mirror, "utf8"), `${line}\n`);
}
