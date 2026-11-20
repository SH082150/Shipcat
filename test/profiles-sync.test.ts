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

import { add, type AddProviderInput } from "../core/archive/providers/index.ts";
import { generateDesktopProfile } from "../core/archive/generate/index.ts";
import {
  read as readClaudeMeta,
  removeEntry as claudeMetaRemoveEntry,
  upsertEntry as claudeMetaUpsertEntry,
} from "../core/archive/claude-meta/index.ts";
import {
  addEntry,
  create,
  get,
  remove,
  removeEntry,
  rename,
  updateEntry,
  type ProfileEntryInput,
} from "../core/archive/profiles/index.ts";
import { claudePaths, harborPaths } from "../core/archive/paths/index.ts";
import type { Provider } from "../core/types.ts";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "harbor-profiles-sync-"));
}

/** Claude 侧 configLibrary 目录（paths 契约，平台差异由平台层收口）。 */
function configLibrary(home: string): string {
  return claudePaths(home).configLibrary;
}

function profilesDir(home: string): string {
  return harborPaths(home).profilesDir;
}

const deepseek: AddProviderInput = {
  name: "deepseek",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-test-key",
  inferenceGatewayAuthScheme: "x-api-key",
};

const advEntry = (provider: string): ProfileEntryInput => ({
  name: "claude-sonnet-main",
  provider,
  upstreamModel: "deepseek-chat",
});

test("create（advanced）：Claude 侧文件存在且等于 generate 产物，Claude _meta 已登记", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create(
      {
        name: "网关主力",
        mode: "advanced",
        port: 8787,
        gatewayToken: "tok",
        inferenceModels: [advEntry(prov.id)],
      },
      { home },
    );

    assert.equal(entry.synced, true);
    assert.equal(entry.note, null);

    const claudeFile = join(configLibrary(home), `${entry.id}.json`);
    assert.ok(existsSync(claudeFile), "Claude 侧 profile 文件应已生成");
    assert.deepEqual(
      JSON.parse(readFileSync(claudeFile, "utf8")),
      generateDesktopProfile(get(entry.id, { home })),
      "Claude 侧内容应等于 generateDesktopProfile(sidecar) 产物",
    );

    const claudeMeta = readClaudeMeta({ home });
    assert.ok(
      claudeMeta.entries.some((e) => e.id === entry.id && e.name === "网关主力"),
      "Claude _meta 应已登记 {id, name}",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（standard，有条目）：同步 Claude 侧，产物带供应商三件套", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create(
      { name: "DeepSeek 直连", mode: "standard", inferenceModels: [stdEntry(prov.id)] },
      { home },
    );

    assert.equal(entry.synced, true);
    const claudeFile = join(configLibrary(home), `${entry.id}.json`);
    assert.ok(existsSync(claudeFile));

    const provider: Provider = {
      version: 1,
      inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
      inferenceGatewayApiKey: "sk-test-key",
      inferenceGatewayAuthScheme: "x-api-key",
    };
    assert.deepEqual(
      JSON.parse(readFileSync(claudeFile, "utf8")),
      generateDesktopProfile(get(entry.id, { home }), provider),
    );
    const generated = JSON.parse(readFileSync(claudeFile, "utf8")) as Record<string, unknown>;
    assert.equal(generated.inferenceGatewayBaseUrl, "https://api.deepseek.com/anthropic");
    assert.equal(generated.inferenceGatewayApiKey, "sk-test-key");
    assert.equal(generated.inferenceGatewayAuthScheme, "x-api-key");

    assert.ok(
      readClaudeMeta({ home }).entries.some((e) => e.id === entry.id && e.name === "DeepSeek 直连"),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（standard，无条目）：不同步并在返回注明；addEntry 后自动同步", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create({ name: "待补条目", mode: "standard" }, { home });

    assert.equal(entry.synced, false);
    assert.match(entry.note ?? "", /添加条目后自动生成/);
    assert.ok(!existsSync(join(configLibrary(home), `${entry.id}.json`)), "无条目时不应写 Claude 文件");
    // 条目立即登记 Claude _meta（名单是真相），
    // 不同步的只是文件——这保证 scan 不会把"未同步的 standard"误判为孤儿。
    assert.ok(
      readClaudeMeta({ home }).entries.some((e) => e.id === entry.id && e.name === "待补条目"),
      "无条目时 Claude _meta 应已登记（meta 先行）",
    );

    addEntry("待补条目", stdEntry(prov.id), { home });
    const claudeFile = join(configLibrary(home), `${entry.id}.json`);
    assert.ok(existsSync(claudeFile), "addEntry 后应自动同步");
    assert.ok(
      readClaudeMeta({ home }).entries.some((e) => e.id === entry.id && e.name === "待补条目"),
    );
    const generated = JSON.parse(readFileSync(claudeFile, "utf8")) as Record<string, unknown>;
    assert.deepEqual(generated.inferenceModels, [{ name: "claude-sonnet-main" }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("条目增删改（advanced）：Claude 侧跟随重推导覆写", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create(
      { name: "gw", mode: "advanced", port: 8787, gatewayToken: "tok" },
      { home },
    );
    const claudeFile = join(configLibrary(home), `${entry.id}.json`);
    const readClaudeProfile = (): Record<string, unknown> =>
      JSON.parse(readFileSync(claudeFile, "utf8")) as Record<string, unknown>;
    const expected = (): Record<string, unknown> =>
      generateDesktopProfile(get(entry.id, { home }));

    assert.deepEqual(readClaudeProfile(), expected());

    addEntry("gw", advEntry(prov.id), { home });
    assert.deepEqual(readClaudeProfile(), expected(), "addEntry 后 Claude 侧应跟随");
    assert.deepEqual(readClaudeProfile().inferenceModels, [{ name: "claude-sonnet-main" }]);

    updateEntry("gw", { ...advEntry(prov.id), upstreamModel: "deepseek-reasoner" }, { home });
    assert.deepEqual(readClaudeProfile(), expected(), "updateEntry 后 Claude 侧应跟随");
    assert.deepEqual(readClaudeProfile().inferenceModels, [{ name: "claude-sonnet-main" }]);

    addEntry("gw", { ...advEntry(prov.id), name: "claude-haiku-fast" }, { home });
    assert.equal((readClaudeProfile().inferenceModels as unknown[]).length, 2);

    removeEntry("gw", advEntry(prov.id), { home });
    assert.deepEqual(readClaudeProfile(), expected(), "removeEntry 后 Claude 侧应跟随");
    assert.deepEqual(readClaudeProfile().inferenceModels, [{ name: "claude-haiku-fast" }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("条目增删改（standard）：Claude 侧跟随；删空后跳过、保留上次产物", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create({ name: "std", mode: "standard" }, { home });
    const claudeFile = join(configLibrary(home), `${entry.id}.json`);

    addEntry("std", stdEntry(prov.id), { home });
    assert.ok(existsSync(claudeFile));
    addEntry("std", { ...stdEntry(prov.id), name: "claude-haiku-fast" }, { home });
    assert.equal(
      (JSON.parse(readFileSync(claudeFile, "utf8")) as Record<string, unknown>)
        .inferenceModels !== undefined,
      true,
    );

    removeEntry("std", stdEntry(prov.id), { home });
    removeEntry("std", { ...stdEntry(prov.id), name: "claude-haiku-fast" }, { home });
    // 条目删空 → 不可生成 → 跳过同步，Claude 侧保留上次产物（不删除）。
    assert.ok(existsSync(claudeFile), "删空条目后 Claude 文件应保留（下次加回时恢复同步）");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove：Claude 侧文件与 Claude _meta 条目双侧清理；激活仍拒绝", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const active = create(
      { name: "激活中", mode: "advanced", port: 8787, gatewayToken: "tok", inferenceModels: [advEntry(prov.id)] },
      { home },
    );
    const standby = create({ name: "备用", mode: "standard", inferenceModels: [stdEntry(prov.id)] }, { home });

    const claudeMetaFile = claudePaths(home).meta;
    const meta = JSON.parse(readFileSync(claudeMetaFile, "utf8")) as {
      appliedId: string | null;
      entries: { id: string; name: string }[];
    };
    meta.appliedId = active.id;
    writeFileSync(claudeMetaFile, JSON.stringify(meta, null, 2));

    const localMetaFile = join(profilesDir(home), "_meta.json");
    const localMeta = JSON.parse(readFileSync(localMetaFile, "utf8")) as {
      appliedId: string | null;
      entries: { id: string; name: string }[];
    };
    localMeta.appliedId = active.id;
    writeFileSync(localMetaFile, JSON.stringify(localMeta, null, 2));

    assert.ok(existsSync(join(configLibrary(home), `${active.id}.json`)));
    assert.ok(existsSync(join(configLibrary(home), `${standby.id}.json`)));

    assert.throws(() => remove("激活中", { home }), /激活/);

    remove("备用", { home });
    assert.ok(!existsSync(join(configLibrary(home), `${standby.id}.json`)), "Claude 文件应删除");
    const after = readClaudeMeta({ home });
    assert.equal(after.entries.some((e) => e.id === standby.id), false, "Claude _meta 条目应移除");
    assert.equal(after.appliedId, active.id, "激活指针不动");

    // 模拟先在 Claude 侧切换激活（真开关在 Claude _meta）：清空本地镜像后可删。
    const cleared = JSON.parse(readFileSync(localMetaFile, "utf8")) as {
      appliedId: string | null;
      entries: { id: string; name: string }[];
    };
    cleared.appliedId = null;
    writeFileSync(localMetaFile, JSON.stringify(cleared, null, 2));

    remove("激活中", { home });
    assert.equal(readClaudeMeta({ home }).entries.length, 0);
    assert.ok(!existsSync(join(configLibrary(home), `${active.id}.json`)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove（readOnly）：外来镜像也删 Claude 侧原文件（接管路径）", () => {
  const home = makeHome();
  try {
    const id = "11111111-2222-4333-8444-555555555555";
    mkdirSync(profilesDir(home), { recursive: true });
    mkdirSync(configLibrary(home), { recursive: true });
    writeFileSync(
      join(profilesDir(home), `${id}.json`),
      JSON.stringify({ version: 1, mode: "readOnly", inferenceModels: [{ name: "claude-sonnet-4-5" }] }),
    );
    writeFileSync(
      join(profilesDir(home), "_meta.json"),
      JSON.stringify({ version: 1, appliedId: null, entries: [{ id, name: "外来镜像" }] }),
    );
    writeFileSync(
      join(configLibrary(home), `${id}.json`),
      JSON.stringify({ inferenceProvider: "gateway", inferenceModels: [{ name: "claude-sonnet-4-5" }] }),
    );
    claudeMetaUpsertEntry({ id, name: "外来镜像" }, { home });

    remove("外来镜像", { home });
    assert.ok(!existsSync(join(configLibrary(home), `${id}.json`)));
    assert.equal(readClaudeMeta({ home }).entries.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rename：本地改名后 Claude _meta 条目名同步，两侧一致", () => {
  const home = makeHome();
  try {
    add(deepseek, { home });
    const entry = create(
      { name: "旧名", mode: "advanced", port: 8787, gatewayToken: "tok" },
      { home },
    );
    rename("旧名", "新名", { home });

    const claudeMeta = readClaudeMeta({ home });
    const hit = claudeMeta.entries.find((e) => e.id === entry.id);
    assert.equal(hit?.name, "新名", "Claude _meta 名字应跟随改名");
    assert.equal(
      claudeMeta.entries.filter((e) => e.id === entry.id).length,
      1,
      "改名不应产生重复条目",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rename（standard 未同步过）：Claude _meta 条目同样按新名登记", () => {
  const home = makeHome();
  try {
    const entry = create({ name: "甲", mode: "standard" }, { home });
    assert.equal(entry.synced, false);
    rename("甲", "乙", { home });
    const hit = readClaudeMeta({ home }).entries.find((e) => e.id === entry.id);
    assert.equal(hit?.name, "乙");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- 辅助 ----------

function stdEntry(provider: string): ProfileEntryInput {
  return { name: "claude-sonnet-main", provider };
}
