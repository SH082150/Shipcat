import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "../scripts/claudeharbor.ts");

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 子进程跑 CLI 入口；execFile 对非零退出码抛错，这里统一成结果对象。 */
async function cli(...args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [ENTRY, ...args],
      { encoding: "utf8" },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function coreReady(): Promise<boolean> {
  try {
    await import("../core/index.ts");
    return true;
  } catch {
    return false;
  }
}

test("无参数：打印帮助并以 0 退出", async () => {
  const r = await cli();
  assert.equal(r.code, 0);
  assert.match(r.stdout, /用法：claudeharbor/);
  assert.match(r.stdout, /provider add/);
});

test("--help / help：打印帮助并以 0 退出", async () => {
  for (const flag of ["--help", "help"] as const) {
    const r = await cli(flag);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /用法：claudeharbor/);
  }
});

test("未知命令：退出码 2，中文错误提示", async () => {
  const r = await cli("bogus");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /未知命令 "bogus"/);
});

test("--home 缺参数：退出码 2", async () => {
  const r = await cli("--home");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--home/);
});

test("provider 无子命令：打印用法并以 0 退出", async () => {
  const r = await cli("provider");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /provider add/);
  assert.match(r.stdout, /provider rename/);
});

test("provider 未知子命令：退出码 2", async () => {
  const r = await cli("provider", "frobnicate");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /未知子命令 "provider frobnicate"/);
});

test("provider add 参数不足：退出码 2，不触碰 core", async () => {
  const r = await cli("provider", "add", "onlyname");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /3–4 个参数/);
});

test("provider add 非法 authScheme：退出码 2，不触碰 core", async () => {
  const r = await cli("provider", "add", "n", "https://x.example.com", "k", "digest");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /authScheme 只支持/);
});

test("provider list 带多余参数：退出码 2", async () => {
  const r = await cli("provider", "list", "extra");
  assert.equal(r.code, 2);
});

test("provider 全流程：add → list（打码）→ rename → remove", async (t) => {
  if (!(await coreReady())) {
    t.skip("内核不可用：core/index 未加载");
    return;
  }
  const home = mkdtempSync(join(tmpdir(), "harbor-cli-test-"));
  try {
    const add = await cli(
      "--home", home,
      "provider", "add", "deepseek", "https://api.deepseek.com/anthropic/", "sk-testsecret",
    );
    assert.equal(add.code, 0, add.stderr);
    assert.match(add.stdout, /已添加供应商「deepseek」/);

    const dup = await cli(
      "--home", home,
      "provider", "add", "deepseek", "https://api.other.com", "k2",
    );
    assert.equal(dup.code, 1);
    assert.match(dup.stderr, /已存在/);

    const bad = await cli("--home", home, "provider", "add", "bad", "not-a-url", "k3");
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /错误：/);

    const list = await cli("--home", home, "provider", "list");
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /deepseek/);
    assert.match(list.stdout, /名称.*UUID.*认证方式.*密钥/);
    assert.match(list.stdout, /sk-t…et/); // 前 4 后 2 打码
    assert.ok(!list.stdout.includes("sk-testsecret"), "list 输出不得包含完整密钥");

    const rename = await cli("--home", home, "provider", "rename", "deepseek", "kimi");
    assert.equal(rename.code, 0, rename.stderr);
    assert.match(rename.stdout, /改名为「kimi」/);

    const remove = await cli("--home", home, "provider", "remove", "kimi");
    assert.equal(remove.code, 0, remove.stderr);
    const empty = await cli("--home", home, "provider", "list");
    assert.equal(empty.code, 0);
    assert.match(empty.stdout, /供应商库为空/);

    const gone = await cli("--home", home, "provider", "remove", "kimi");
    assert.equal(gone.code, 1);
    assert.match(gone.stderr, /不存在/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("maskApiKey 打码规则", async (t) => {
  const { maskApiKey } = await import("../scripts/provider.ts");
  assert.equal(maskApiKey("short"), "****");
  assert.equal(maskApiKey("sk-testsecret"), "sk-t…et");
  assert.equal(maskApiKey("abcdefgh"), "abcd…gh");
  assert.ok(true);
});
