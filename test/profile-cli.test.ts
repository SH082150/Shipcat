import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** 子进程跑 CLI 入口；input 经 stdin 喂入；非零退出码统一成结果对象。 */
async function cli(
  args: readonly string[],
  options: { readonly input?: string; readonly home?: string } = {},
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

async function profilesReady(): Promise<boolean> {
  try {
    const mod = (await import("../core/index.ts")) as Record<string, unknown>;
    const archive = mod.archive as Record<string, unknown> | undefined;
    const profiles = (mod.profiles ?? archive?.profiles) as Record<string, unknown> | undefined;
    return (
      typeof profiles?.create === "function" &&
      typeof profiles?.list === "function" &&
      typeof profiles?.get === "function" &&
      typeof profiles?.remove === "function"
    );
  } catch {
    return false;
  }
}

test("profile 无子命令：打印用法并以 0 退出", async () => {
  const r = await cli(["profile"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /profile create/);
  assert.match(r.stdout, /profile remove/);
});

test("profile 未知子命令：退出码 2", async () => {
  const r = await cli(["profile", "frobnicate"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /未知子命令 "profile frobnicate"/);
});

test("profile create 缺名称：退出码 2", async () => {
  const r = await cli(["profile", "create"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--mode/);
});

test("profile create 缺 --mode：退出码 2", async () => {
  const r = await cli(["profile", "create", "myprofile"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--mode/);
});

test("profile create 非法 --mode：退出码 2", async () => {
  const r = await cli(["profile", "create", "myprofile", "--mode", "hybrid"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /standard 或 advanced/);
});

test("profile create 未知标志：退出码 2", async () => {
  const r = await cli(["profile", "create", "myprofile", "--mode", "advanced", "--bogus", "1"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /错误：/);
});

test("advanced 缺 port 且交互输入为空：退出码 1，提示缺少 port", async () => {
  // stdin 立即 EOF：交互补齐拿不到 port，应报"缺少必填项 port"而不是挂起。
  const r = await cli(["profile", "create", "gw", "--mode", "advanced"], { input: "" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /port/);
});

test("profile import：Claude 侧不存在时报错，退出码 1", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：core/index 未导出 profiles 命名空间");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-profile-test-"));
  try {
    const r = await cli(["profile", "import", "a1c9f2e3-8b7a-4c5d-9e0f-1234567890ab"], { home });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Claude 侧不存在/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("profiles 未集成时 create 全流程：报集成中，退出码 1", async (t) => {
  if (await profilesReady()) {
    t.skip("profiles 已交付：走下方全流程用例");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-profile-test-"));
  try {
    // 标志给全，避免进入交互（execFile 的 stdin 无人写入会挂起）。
    const r = await cli(
      [
        "profile", "create", "gw", "--mode", "advanced",
        "--port", "8787", "--token", "t", "--auth-scheme", "bearer",
      ],
      { home },
    );
    assert.equal(r.code, 1);
    assert.match(r.stderr, /profile 模块集成中/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("全流程：create（交互选供应商 + 交互补 advanced）→ list → show（打码）→ remove", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：core/index 未导出 profiles 命名空间");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-profile-test-"));
  try {
    // 先备一家供应商，供 standard 交互选择。
    const add = await cli(
      ["provider", "add", "deepseek", "https://api.deepseek.com/anthropic", "sk-testsecret"],
      { home },
    );
    assert.equal(add.code, 0, add.stderr);

    // standard：交互选供应商（输入序号 1）。
    const std = await cli(["profile", "create", "直连", "--mode", "standard"], {
      home,
      input: "1\n",
    });
    assert.equal(std.code, 0, std.stderr);
    assert.match(std.stdout, /已创建 profile「直连」/);

    // advanced：标志全给，不触发交互。
    const adv = await cli(
      [
        "profile", "create", "网关", "--mode", "advanced",
        "--port", "8787", "--token", "mytoken123", "--auth-scheme", "bearer",
      ],
      { home },
    );
    assert.equal(adv.code, 0, adv.stderr);
    assert.match(adv.stdout, /已创建 profile「网关」/);

    // advanced：交互补齐（port + 空行采纳 token 默认值 + 空行采纳 scheme 默认 bearer）。
    const advInteractive = await cli(
      ["profile", "create", "交互网关", "--mode", "advanced"],
      { home, input: "8790\n\n\n" },
    );
    assert.equal(advInteractive.code, 0, advInteractive.stderr);
    assert.match(advInteractive.stdout, /已创建 profile「交互网关」/);

    const profileMeta = JSON.parse(
      readFileSync(join(home, ".claudeharbor", "profiles", "_meta.json"), "utf8"),
    ) as { entries: { id: string; name: string }[] };
    const gatewayId = profileMeta.entries.find((entry) => entry.name === "网关")?.id;
    assert.ok(gatewayId);
    const sidecarPath = join(home, ".claudeharbor", "profiles", `${gatewayId}.json`);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
    sidecar.claude = {
      inferenceCustomHeaders: { "x-provider-token": "custom-header-secret" },
    };
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));

    const list = await cli(["profile", "list"], { home });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /名称.*UUID.*MODE.*条目数.*激活/);
    assert.match(list.stdout, /直连/);
    assert.match(list.stdout, /网关/);
    assert.match(list.stdout, /advanced/);
    assert.doesNotMatch(list.stdout, /★/);

    // show（按名）：打码 token 与自定义头值，不泄露原文；供应商 key 不泄露。
    const show = await cli(["profile", "show", "网关"], { home });
    assert.equal(show.code, 0, show.stderr);
    assert.match(show.stdout, /sidecar 全文/);
    assert.match(show.stdout, /myto…23/);
    assert.match(show.stdout, /"x-provider-token": "\*\*\*\*"/);
    assert.ok(!show.stdout.includes("custom-header-secret"), "show 输出不得包含自定义头令牌");
    assert.ok(!show.stdout.includes("mytoken123"), "show 输出不得包含完整 gatewayToken");
    assert.ok(!show.stdout.includes("sk-testsecret"), "show 输出不得包含完整供应商密钥");
    assert.match(show.stdout, /8787/);

    const remove = await cli(["profile", "remove", "网关"], { home });
    assert.equal(remove.code, 0, remove.stderr);
    assert.match(remove.stdout, /已删除 profile/);
    const after = await cli(["profile", "list"], { home });
    assert.match(after.stdout, /交互网关/);
    assert.doesNotMatch(after.stdout, /^网关\s/m);

    const gone = await cli(["profile", "remove", "网关"], { home });
    assert.equal(gone.code, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("当前激活的 profile 拒绝删除；readOnly 可 show", async (t) => {
  if (!(await profilesReady())) {
    t.skip("内核不可用：core/index 未导出 profiles 命名空间");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-profile-test-"));
  try {
    // 造一个 advanced profile，再把 _meta 的 appliedId 镜像指向它。
    const create = await cli(
      [
        "profile", "create", "已激活", "--mode", "advanced",
        "--port", "8800", "--token", "tok-act-1", "--auth-scheme", "bearer",
      ],
      { home },
    );
    assert.equal(create.code, 0, create.stderr);
    const id = /（([0-9a-f-]{36})）/.exec(create.stdout)?.[1];
    assert.ok(id, "create 输出应包含 UUID");

    const metaPath = join(home, ".claudeharbor", "profiles", "_meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      appliedId: string | null;
      entries: { id: string; name: string }[];
    };
    writeFileSync(metaPath, JSON.stringify({ ...meta, appliedId: id }, null, 2));

    // remove 被拒（core 对当前激活的 profile 抛 CONFLICT）。
    const remove = await cli(["profile", "remove", "已激活"], { home });
    assert.equal(remove.code, 1);
    assert.match(remove.stderr, /激活/);

    // readOnly（外来 profile 镜像）：show 可用且不报错。
    const foreignId = "b3f1c2d4-90ab-4def-8a7b-cdef01234567";
    const profilesDir = join(home, ".claudeharbor", "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, `${foreignId}.json`),
      JSON.stringify({
        version: 1,
        mode: "readOnly",
        inferenceModels: [{ name: "claude-sonnet-4-5" }],
      }),
    );
    writeFileSync(
      metaPath,
      JSON.stringify({
        ...meta,
        appliedId: id,
        entries: [...meta.entries, { id: foreignId, name: "外来配置" }],
      }),
    );
    const show = await cli(["profile", "show", "外来配置"], { home });
    assert.equal(show.code, 0, show.stderr);
    assert.match(show.stdout, /readOnly/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
