import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "../scripts/claudeharbor.ts");

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 子进程跑 CLI 入口；非零退出码统一成结果对象。 */
async function cli(
  args: readonly string[],
  options: { readonly home?: string } = {},
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
    child.stdin.end();
  });
}

/** 备一家供应商 + 一个 advanced profile（标志全给，不触发交互）。 */
async function seed(home: string): Promise<void> {
  const add = await cli(
    ["provider", "add", "deepseek", "https://api.deepseek.com/anthropic", "sk-testsecret"],
    { home },
  );
  assert.equal(add.code, 0, add.stderr);
  const adv = await cli(
    [
      "profile", "create", "网关", "--mode", "advanced",
      "--port", "48787", "--token", "tok", "--auth-scheme", "bearer",
    ],
    { home },
  );
  assert.equal(adv.code, 0, adv.stderr);
}

/** 把本地 profiles/_meta.json 的 appliedId 指向指定 profile 名。 */
async function markActivated(home: string, profileName: string): Promise<void> {
  const metaPath = join(home, ".claudeharbor", "profiles", "_meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    appliedId: string | null;
    entries: { id: string; name: string }[];
  };
  const id = meta.entries.find((e) => e.name === profileName)?.id;
  assert.ok(id, `应有名为「${profileName}」的 profile`);
  writeFileSync(metaPath, JSON.stringify({ ...meta, appliedId: id }, null, 2));
}

test("route-add 全流程：advanced 带全标志 → show 可见；standard 不带 --upstream", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-route-test-"));
  try {
    await seed(home);

    const add = await cli(
      [
        "profile", "route-add", "网关",
        "--name", "claude-sonnet-main",
        "--provider", "deepseek",
        "--upstream", "deepseek-chat",
        "--label", "主力",
        "--tier", "sonnet",
        "--behaves-as", "claude-sonnet-4-5",
      ],
      { home },
    );
    assert.equal(add.code, 0, add.stderr);
    assert.match(add.stdout, /添加路由条目「claude-sonnet-main」/);
    assert.match(add.stdout, /deepseek/);

    const show = await cli(["profile", "show", "网关"], { home });
    assert.equal(show.code, 0, show.stderr);
    assert.match(show.stdout, /claude-sonnet-main/);
    assert.match(show.stdout, /deepseek-chat/);
    assert.match(show.stdout, /主力/);
    assert.match(show.stdout, /"anthropicFamilyTier": "sonnet"/);

    // standard：不带 --upstream 成功，sidecar 不写入 upstreamModel。
    const std = await cli(["profile", "create", "直连", "--mode", "standard"], { home });
    assert.equal(std.code, 0, std.stderr);
    const stdAdd = await cli(
      ["profile", "route-add", "直连", "--name", "claude-sonnet-std", "--provider", "deepseek"],
      { home },
    );
    assert.equal(stdAdd.code, 0, stdAdd.stderr);
    const stdShow = await cli(["profile", "show", "直连"], { home });
    assert.match(stdShow.stdout, /claude-sonnet-std/);
    assert.doesNotMatch(stdShow.stdout, /upstreamModel/);

    const noProfile = await cli(
      ["profile", "route-add", "不存在", "--name", "claude-x", "--provider", "deepseek"],
      { home },
    );
    assert.equal(noProfile.code, 1);
    assert.match(noProfile.stderr, /不存在/);
    const noProvider = await cli(
      ["profile", "route-add", "网关", "--name", "claude-x2", "--provider", "ghost"],
      { home },
    );
    assert.equal(noProvider.code, 1);
    assert.match(noProvider.stderr, /供应商「ghost」不存在/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("standard 拒 --upstream；坏假名（含厂商名）拒", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-route-test-"));
  try {
    await seed(home);
    const std = await cli(["profile", "create", "直连", "--mode", "standard"], { home });
    assert.equal(std.code, 0, std.stderr);

    // standard 带 --upstream：拒绝（CLI 参数校验，core 只强制 advanced 必填）。
    const stdUp = await cli(
      [
        "profile", "route-add", "直连",
        "--name", "claude-sonnet-x", "--provider", "deepseek", "--upstream", "deepseek-chat",
      ],
      { home },
    );
    assert.equal(stdUp.code, 1);
    assert.match(stdUp.stderr, /不能传 --upstream/);

    // 坏假名：含厂商名（routeId 黑名单），core 拒绝。
    const bad = await cli(
      [
        "profile", "route-add", "网关",
        "--name", "claude-kimi-alias", "--provider", "deepseek", "--upstream", "kimi-k2",
      ],
      { home },
    );
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /厂商名/);

    // 坏假名：不含 claude/anthropic，core 拒绝。
    const bad2 = await cli(
      ["profile", "route-add", "网关", "--name", "my-model", "--provider", "deepseek", "--upstream", "x"],
      { home },
    );
    assert.equal(bad2.code, 1);
    assert.match(bad2.stderr, /claude/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("route-remove：删除后 show 不再有；重复删除报错", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-route-test-"));
  try {
    await seed(home);
    const add = await cli(
      [
        "profile", "route-add", "网关",
        "--name", "claude-sonnet-main", "--provider", "deepseek", "--upstream", "deepseek-chat",
      ],
      { home },
    );
    assert.equal(add.code, 0, add.stderr);

    const remove = await cli(["profile", "route-remove", "网关", "claude-sonnet-main"], { home });
    assert.equal(remove.code, 0, remove.stderr);
    assert.match(remove.stdout, /删除路由条目「claude-sonnet-main」/);
    const show = await cli(["profile", "show", "网关"], { home });
    assert.doesNotMatch(show.stdout, /claude-sonnet-main/);

    const again = await cli(["profile", "route-remove", "网关", "claude-sonnet-main"], { home });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /没有模型条目/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("route-update：改 label 保留 upstream；无标志/假名不存在/供应商不存在报错", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-route-test-"));
  try {
    await seed(home);
    const add = await cli(
      [
        "profile", "route-add", "网关",
        "--name", "claude-sonnet-main", "--provider", "deepseek", "--upstream", "deepseek-chat",
      ],
      { home },
    );
    assert.equal(add.code, 0, add.stderr);

    const upd = await cli(
      ["profile", "route-update", "网关", "claude-sonnet-main", "--label", "新标签"],
      { home },
    );
    assert.equal(upd.code, 0, upd.stderr);
    const show = await cli(["profile", "show", "网关"], { home });
    assert.match(show.stdout, /新标签/);
    assert.match(show.stdout, /deepseek-chat/, "route-update 未给 --upstream 时应保留旧值");

    const noFlags = await cli(["profile", "route-update", "网关", "claude-sonnet-main"], { home });
    assert.equal(noFlags.code, 2);
    assert.match(noFlags.stderr, /至少需要一个标志/);

    const noAlias = await cli(
      ["profile", "route-update", "网关", "claude-ghost", "--label", "x"],
      { home },
    );
    assert.equal(noAlias.code, 1);
    assert.match(noAlias.stderr, /没有模型条目/);

    const noProvider = await cli(
      ["profile", "route-update", "网关", "claude-sonnet-main", "--provider", "ghost"],
      { home },
    );
    assert.equal(noProvider.code, 1);
    assert.match(noProvider.stderr, /供应商「ghost」不存在/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("status 关键行：无激活空库 → 当前激活：无 / 空库提示 / 无需网关", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-status-test-"));
  try {
    const r = await cli(["status"], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /当前激活：无/);
    assert.match(r.stdout, /profile 库为空/);
    assert.match(r.stdout, /供应商库为空/);
    assert.match(r.stdout, /无需网关/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("status 关键行：advanced 激活 → ★；本地与 Claude 激活不一致标 ⚠；网关未运行", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-status-test-"));
  try {
    await seed(home);
    // 第二个 profile：创建即同步会让 Claude _meta 仍指向第一个（网关），
    // 本地单独改激活到第二个，两侧不一致 → ⚠。
    const second = await cli(["profile", "create", "另一项", "--mode", "standard"], { home });
    assert.equal(second.code, 0, second.stderr);
    await markActivated(home, "另一项");

    const r = await cli(["status"], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /当前激活：另一项（[0-9a-f-]{36}）/);
    assert.match(r.stdout, /⚠ 与 Claude 侧激活不一致/);
    assert.match(r.stdout, /Profiles：/);
    assert.match(r.stdout, /另一项\s+[0-9a-f-]{36}\s+standard\s+0\s+★/);
    assert.match(r.stdout, /供应商：/);
    assert.match(r.stdout, /deepseek/);
    assert.match(r.stdout, /无需网关（标准配置直连供应商/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("status 关键行：standard 激活 → 无需网关；探活通 → 运行中", async () => {
  const home = mkdtempSync(join(tmpdir(), "harbor-status-test-"));
  let server: Server | undefined;
  try {
    await seed(home);
    const std = await cli(["profile", "create", "直连", "--mode", "standard"], { home });
    assert.equal(std.code, 0, std.stderr);
    await markActivated(home, "直连");
    const r = await cli(["status"], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /当前激活：直连/);
    assert.match(r.stdout, /standard/);
    assert.match(r.stdout, /无需网关（标准配置直连供应商/);

    // 探活通：起一个临时 HTTP 服务，把 advanced profile 指向它的端口。
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const adv = await cli(
      [
        "profile", "create", "活网关", "--mode", "advanced",
        "--port", String(address.port), "--token", "tok", "--auth-scheme", "bearer",
      ],
      { home },
    );
    assert.equal(adv.code, 0, adv.stderr);
    await markActivated(home, "活网关");
    const r2 = await cli(["status"], { home });
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stdout, /当前激活：活网关/);
    assert.match(r2.stdout, new RegExp(`网关：运行中（http://127\\.0\\.0\\.1:${address.port}/health）`));
    assert.doesNotMatch(r2.stdout, /未运行/);
  } finally {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    rmSync(home, { recursive: true, force: true });
  }
});
