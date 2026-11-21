import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyFileMode,
  atomicWriteJson,
  NORMAL_MODE,
  readJson,
  SECRET_MODE,
} from "../core/archive/fs/index.ts";

/** Windows 上 POSIX 权限位没有对等物，涉及 mode 的用例统一跳过。 */
const WINDOWS_MODE_SKIP =
  process.platform === "win32" ? "Windows 无 POSIX 权限位" : false;

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ch-fs-test-"));
});

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("atomicWriteJson：写入内容与序列化格式正确", () => {
  const p = join(dir, "a.json");
  atomicWriteJson(p, { name: "x", list: [1, 2] }, NORMAL_MODE);
  assert.equal(readFileSync(p, "utf8"), JSON.stringify({ name: "x", list: [1, 2] }, null, 2) + "\n");
  assert.deepEqual(readJson(p), { name: "x", list: [1, 2] });
});

test("atomicWriteJson：SECRET_MODE 权限位为 600", { skip: WINDOWS_MODE_SKIP }, () => {
  const p = join(dir, "secret.json");
  atomicWriteJson(p, { key: "sk-1" }, SECRET_MODE);
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test("atomicWriteJson：NORMAL_MODE 权限位为 644", { skip: WINDOWS_MODE_SKIP }, () => {
  const p = join(dir, "normal.json");
  atomicWriteJson(p, { key: "sk-2" }, NORMAL_MODE);
  assert.equal(statSync(p).mode & 0o777, 0o644);
});

test("atomicWriteJson：覆盖已有文件且不留临时文件", () => {
  const p = join(dir, "b.json");
  writeFileSync(p, "旧内容");
  atomicWriteJson(p, { v: 2 }, NORMAL_MODE);
  assert.deepEqual(readJson(p), { v: 2 });
  assert.equal(readFileSync(p, "utf8").includes("旧内容"), false);
  assert.equal(readdirSync(dir).filter((n) => n.includes(".tmp")).length, 0);
});

test("atomicWriteJson：连续覆盖后读者仍看到整份新值", () => {
  const p = join(dir, "c.json");
  atomicWriteJson(p, { v: 1 }, NORMAL_MODE);
  for (let i = 0; i < 20; i++) atomicWriteJson(p, { v: i }, NORMAL_MODE);
  const seen = readJson(p) as { v: number };
  assert.ok(seen.v >= 0 && seen.v < 20);
});

test("readJson：不存在返回 null", () => {
  assert.equal(readJson(join(dir, "nope.json")), null);
});

test("readJson：损坏 JSON 抛面向用户的中文错误", () => {
  const p = join(dir, "bad.json");
  writeFileSync(p, "{ not json");
  assert.throws(
    () => readJson(p),
    (err: unknown) => {
      const e = err as Error;
      return e.message.includes("配置文件已损坏") && !e.message.includes(p);
    },
  );
});

test("readJson：chmod 600 后本人仍能读到", { skip: WINDOWS_MODE_SKIP }, () => {
  const p = join(dir, "d.json");
  writeFileSync(p, "{\"x\":1}");
  chmodSync(p, 0o600);
  assert.deepEqual(readJson(p), { x: 1 });
});

test("atomicWriteJson：umask 不影响最终权限位（chmod 兜底）", { skip: WINDOWS_MODE_SKIP }, () => {
  const p = join(dir, "e.json");
  atomicWriteJson(p, { k: 1 }, SECRET_MODE);
  // writeFileSync 的 mode 会被 umask 削减，chmod 必须兜底补回。
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test(
  "applyFileMode：Windows 下静默跳过，不抛错",
  { skip: process.platform !== "win32" ? "仅在 Windows 验证无 POSIX 权限位时的行为" : false },
  () => {
    const p = join(dir, "mode.json");
    writeFileSync(p, "{}");
    assert.doesNotThrow(() => applyFileMode(p, SECRET_MODE));
  },
);

test(
  "atomicWriteJson：Windows 下多层目录原子写后不留 .tmp",
  { skip: process.platform !== "win32" ? "仅在 Windows 验证 rename 原子替换语义" : false },
  () => {
    const nested = join(dir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    const p = join(nested, "deep.json");
    writeFileSync(p, "旧内容");

    // 多次覆盖：每次都要在同目录建临时文件再 rename，结束后不得残留。
    for (let i = 0; i < 10; i++) atomicWriteJson(p, { v: i }, NORMAL_MODE);

    assert.deepEqual(readJson(p), { v: 9 });
    assert.equal(readFileSync(p, "utf8").includes("旧内容"), false);
    assert.deepEqual(readdirSync(nested), ["deep.json"]);
  },
);
