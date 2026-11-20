import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apply,
  ClaudeMetaError,
  read,
  removeEntry,
  syncNames,
  upsertEntry,
} from "../core/archive/claude-meta/index.ts";
import { claudePaths } from "../core/archive/paths/index.ts";
import type { MetaEntry } from "../core/types.ts";

/** Claude 侧目录布局由平台层决定（macOS 在 Library/Application Support，
 * Windows 在 AppData\Local\Claude-3p），夹具不得硬编码平台路径。 */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-claude-meta-"));
  mkdirSync(claudePaths(home).configLibrary, { recursive: true });
  return home;
}

function metaFile(home: string): string {
  return claudePaths(home).meta;
}

const A: MetaEntry = { id: "a1c9f2e3-8b7a-4c5d-9e0f-1234567890ab", name: "多供应商主力" };
const B: MetaEntry = { id: "b3f1c2d4-90ab-4def-8a7b-cdef01234567", name: "DeepSeek 直连" };

test("read：文件不存在按空结构处理（容错重建，不落盘）", () => {
  const home = makeHome();
  try {
    assert.deepEqual(read({ home }), { appliedId: null, entries: [] });
    assert.ok(!existsSync(metaFile(home)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("read：_meta 损坏按空结构处理", () => {
  const home = makeHome();
  try {
    writeFileSync(metaFile(home), "{ 不是 JSON", "utf8");
    assert.deepEqual(read({ home }), { appliedId: null, entries: [] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("upsertEntry：新 id 追加末尾，首个条目后 appliedId 自动有指向", () => {
  const home = makeHome();
  try {
    const afterA = upsertEntry(A, { home });
    assert.equal(afterA.appliedId, A.id);
    assert.deepEqual(afterA.entries, [A]);

    const afterB = upsertEntry(B, { home });
    assert.equal(afterB.appliedId, A.id);
    assert.deepEqual(afterB.entries, [A, B]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("upsertEntry：同 id 更新 name、位置不动", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });
    const renamed = { id: A.id, name: "改名后" };
    const after = upsertEntry(renamed, { home });
    assert.deepEqual(after.entries, [renamed, B]);
    assert.equal(after.appliedId, A.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("写盘形状 = { appliedId, entries }（§4.3 实测结构，无 version 键）", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    const onDisk = JSON.parse(readFileSync(metaFile(home), "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(onDisk).sort(), ["appliedId", "entries"]);
    assert.equal(onDisk.appliedId, A.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("写盘规范化：appliedId 指向缺失条目时回指第一条", () => {
  const home = makeHome();
  try {
    // 手工造一份 appliedId 悬空（指向已删条目）的 _meta。
    writeFileSync(
      metaFile(home),
      JSON.stringify({ appliedId: "00000000-0000-4000-8000-000000000000", entries: [A, B] }),
    );
    const after = upsertEntry({ id: B.id, name: B.name }, { home });
    assert.equal(after.appliedId, A.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("apply：切换激活指针；未知 id 抛 NOT_FOUND", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });
    const after = apply(B.id, { home });
    assert.equal(after.appliedId, B.id);
    assert.equal(read({ home }).appliedId, B.id);

    assert.throws(
      () => apply("00000000-0000-4000-8000-000000000000", { home }),
      (err: unknown) => err instanceof ClaudeMetaError && err.code === "NOT_FOUND",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncNames：Claude 侧改名 → 返回以 Claude 为准的差异；一致则无差异", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });
    // 模拟用户在 Claude UI 改了 A 的名字。
    upsertEntry({ id: A.id, name: "UI 改名" }, { home });

    const ours: MetaEntry[] = [A, B];
    const diffs = syncNames(ours, { home });
    assert.deepEqual(diffs, [{ id: A.id, name: "UI 改名" }]);

    const aligned: MetaEntry[] = [
      { id: A.id, name: "UI 改名" },
      B,
    ];
    assert.deepEqual(syncNames(aligned, { home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("syncNames：Claude 独有的 id 不产出差异（归 §3.8 探测流程）", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });
    assert.deepEqual(syncNames([A], { home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeEntry：移除条目，其余条目位置与激活指针不动", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });
    apply(B.id, { home });

    const after = removeEntry(A.id, { home });
    assert.deepEqual(after.entries, [B]);
    assert.equal(after.appliedId, B.id, "激活指针指向 B，移除 A 后不动");

    const onDisk = JSON.parse(readFileSync(metaFile(home), "utf8")) as {
      appliedId: string;
      entries: MetaEntry[];
    };
    assert.deepEqual(onDisk.entries, [B]);
    assert.equal(onDisk.appliedId, B.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeEntry：恰好移除激活项（防御路径）→ 清 null 后规范化回指第一条", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    upsertEntry(B, { home });

    const after = removeEntry(A.id, { home });
    assert.deepEqual(after.entries, [B]);
    assert.equal(after.appliedId, B.id, "appliedId 键必须始终有指向（模块铁律）");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeEntry：移除最后一条 → appliedId 记 null", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    const after = removeEntry(A.id, { home });
    assert.deepEqual(after, { appliedId: null, entries: [] });

    const onDisk = JSON.parse(readFileSync(metaFile(home), "utf8")) as {
      appliedId: null;
      entries: unknown[];
    };
    assert.equal(onDisk.appliedId, null);
    assert.deepEqual(onDisk.entries, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeEntry：条目不存在时幂等——原样返回、不写盘", () => {
  const home = makeHome();
  try {
    upsertEntry(A, { home });
    const before = readFileSync(metaFile(home), "utf8");

    const after = removeEntry(B.id, { home });
    assert.deepEqual(after.entries, [A]);
    assert.equal(after.appliedId, A.id);
    assert.equal(readFileSync(metaFile(home), "utf8"), before, "不应发生写盘");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
