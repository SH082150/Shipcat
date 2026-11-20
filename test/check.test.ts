import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { add as addProvider } from "../core/archive/providers/index.ts";
import { create as createProfile, addEntry } from "../core/archive/profiles/index.ts";
import { claudePaths } from "../core/archive/paths/index.ts";
import { gate, CheckError } from "../core/check/index.ts";
import type { Diff, GateResult } from "../core/check/index.ts";

/** 临时 home + Claude 侧 configLibrary；具体位置由平台层决定（macOS 在
 * Library/Application Support，Windows 在 AppData\Local\Claude-3p）。 */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-check-"));
  mkdirSync(claudePaths(home).configLibrary, { recursive: true });
  return home;
}

function claudeDir(home: string): string {
  return claudePaths(home).configLibrary;
}

function profilesDir(home: string): string {
  return join(home, ".claudeharbor", "profiles");
}

/** 造一份 standard 双侧场景：返回 { home, profileId }，Claude 文件由用例自己写。 */
function makeStandardHome(): { home: string; profileId: string } {
  const home = makeHome();
  const prov = addProvider(
    {
      name: "deepseek",
      inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
      inferenceGatewayApiKey: "sk-test-key",
      inferenceGatewayAuthScheme: "x-api-key",
    },
    { home },
  );
  const entry = createProfile(
    { name: "DeepSeek 直连", mode: "standard", claude: { inferenceStreamIdleTimeoutSec: 600 } },
    { home },
  );
  addEntry(
    entry.id,
    {
      name: "claude-sonnet-4-5",
      labelOverride: "DeepSeek 主力",
      anthropicFamilyTier: "sonnet",
      behavesAs: "claude-sonnet-4-5",
      provider: prov.id,
    },
    { home },
  );
  return { home, profileId: entry.id };
}

/** §4.2 手工字面量（独立于 generate 的实现，真比对）。 */
const STANDARD_CLAUDE_FILE = {
  inferenceStreamIdleTimeoutSec: 600,
  inferenceProvider: "gateway",
  inferenceCredentialKind: "static",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-test-key",
  inferenceGatewayAuthScheme: "x-api-key",
  inferenceModels: [
    {
      name: "claude-sonnet-4-5",
      labelOverride: "DeepSeek 主力",
      anthropicFamilyTier: "sonnet",
      behavesAs: "claude-sonnet-4-5",
    },
  ],
};

function writeClaudeProfile(home: string, id: string, obj: unknown): void {
  writeFileSync(join(claudeDir(home), `${id}.json`), JSON.stringify(obj, null, 2), "utf8");
}

function diffKeys(result: GateResult): string[] {
  assert.equal(result.ok, false);
  return result.ok ? [] : result.diffs.map((d: Diff) => d.key);
}

test("双侧一致 → ok:true（standard，明文 key 逐值比对）", () => {
  const { home, profileId } = makeStandardHome();
  try {
    writeClaudeProfile(home, profileId, STANDARD_CLAUDE_FILE);
    assert.deepEqual(gate(profileId, { home }), { ok: true });
    assert.deepEqual(gate("DeepSeek 直连", { home }), { ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("对象键序不敏感：Claude 文件键乱序仍通过", () => {
  const { home, profileId } = makeStandardHome();
  try {
    const shuffled = {
      inferenceModels: [
        {
          behavesAs: "claude-sonnet-4-5",
          anthropicFamilyTier: "sonnet",
          labelOverride: "DeepSeek 主力",
          name: "claude-sonnet-4-5",
        },
      ],
      inferenceGatewayAuthScheme: "x-api-key",
      inferenceGatewayApiKey: "sk-test-key",
      inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
      inferenceCredentialKind: "static",
      inferenceProvider: "gateway",
      inferenceStreamIdleTimeoutSec: 600,
    };
    writeClaudeProfile(home, profileId, shuffled);
    assert.deepEqual(gate(profileId, { home }), { ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Claude 侧值漂移 → ok:false 且差异键定位到字段", () => {
  const { home, profileId } = makeStandardHome();
  try {
    const drifted = {
      ...STANDARD_CLAUDE_FILE,
      inferenceGatewayBaseUrl: "https://changed.example.com/anthropic",
    };
    writeClaudeProfile(home, profileId, drifted);
    const result = gate(profileId, { home });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.diffs, [
        {
          key: "inferenceGatewayBaseUrl",
          local: "https://api.deepseek.com/anthropic",
          claude: "https://changed.example.com/anthropic",
        },
      ]);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("sealed：Claude 侧 key 为 __sealed__: 密文只查存在性（不比值，无假冲突）", () => {
  const { home, profileId } = makeStandardHome();
  try {
    const sealed = {
      ...STANDARD_CLAUDE_FILE,
      inferenceGatewayApiKey: "__sealed__:ZW5jcnlwdGVkLWJsb2I=",
    };
    writeClaudeProfile(home, profileId, sealed);
    assert.deepEqual(gate(profileId, { home }), { ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("sealed 键在 Claude 侧缺失 → 差异项（存在性检查失败）", () => {
  const { home, profileId } = makeStandardHome();
  try {
    const { inferenceGatewayApiKey: _drop, ...withoutKey } = STANDARD_CLAUDE_FILE;
    writeClaudeProfile(home, profileId, withoutKey);
    const result = gate(profileId, { home });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.diffs, [
        { key: "inferenceGatewayApiKey", local: "sk-test-key", claude: "（缺失）" },
      ]);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inferenceModels 数组顺序敏感：调换顺序出差异（第一条是默认模型）", () => {
  const home = makeHome();
  try {
    const prov = addProvider(
      {
        name: "deepseek",
        inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
        inferenceGatewayApiKey: "sk-test-key",
        inferenceGatewayAuthScheme: "bearer",
      },
      { home },
    );
    const entry = createProfile({ name: "双模型", mode: "standard" }, { home });
    const m1 = { name: "claude-sonnet-main", provider: prov.id };
    const m2 = { name: "claude-opus-main", provider: prov.id, labelOverride: "Opus" };
    addEntry(entry.id, m1, { home });
    addEntry(entry.id, m2, { home });

    const swapped = {
      inferenceProvider: "gateway",
      inferenceCredentialKind: "static",
      inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
      inferenceGatewayApiKey: "sk-test-key",
      inferenceModels: [
        { name: "claude-opus-main", labelOverride: "Opus" },
        { name: "claude-sonnet-main" },
      ],
    };
    writeClaudeProfile(home, entry.id, swapped);
    const result = gate(entry.id, { home });
    const keys = diffKeys(result);
    assert.ok(keys.includes("inferenceModels[0].name"));
    assert.ok(keys.includes("inferenceModels[1].name"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inferenceModels 条数不同 → 数组级差异", () => {
  const { home, profileId } = makeStandardHome();
  try {
    const extra = {
      ...STANDARD_CLAUDE_FILE,
      inferenceModels: [
        ...(STANDARD_CLAUDE_FILE.inferenceModels as unknown[]),
        { name: "claude-opus-extra" },
      ],
    };
    writeClaudeProfile(home, profileId, extra);
    const result = gate(profileId, { home });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.diffs, [
        { key: "inferenceModels", local: "1 条", claude: "2 条" },
      ]);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Claude 侧文件缺失 → 差异项 (file)（创建即同步后：手工删文件造差异）", () => {
  const { home, profileId } = makeStandardHome();
  try {
    // create 后 Claude 文件已存在，须手工删除造差异。
    assert.ok(existsSync(join(claudeDir(home), `${profileId}.json`)), "create 应已同步 Claude 文件");
    rmSync(join(claudeDir(home), `${profileId}.json`));
    const result = gate(profileId, { home });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.diffs, [{ key: "(file)", local: "<存在>", claude: "缺失" }]);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readOnly profile 拒绝 check（CONFLICT）", () => {
  const home = makeHome();
  try {
    const id = "c4d5e6f7-90ab-4def-8a7b-111122223333";
    mkdirSync(profilesDir(home), { recursive: true });
    writeFileSync(
      join(profilesDir(home), `${id}.json`),
      JSON.stringify({ version: 1, mode: "readOnly", inferenceModels: [] }),
    );
    writeFileSync(
      join(profilesDir(home), "_meta.json"),
      JSON.stringify({ version: 1, appliedId: null, entries: [{ id, name: "外来镜像" }] }),
    );
    assert.throws(
      () => gate(id, { home }),
      (err: unknown) => err instanceof CheckError && err.code === "CONFLICT",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Desktop 多出的键容忍不报（不在期望里的自由字段）", () => {
  const { home, profileId } = makeStandardHome();
  try {
    writeClaudeProfile(home, profileId, {
      ...STANDARD_CLAUDE_FILE,
      someDesktopInternalField: { nested: true },
    });
    assert.deepEqual(gate(profileId, { home }), { ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("高级配置：双侧一致 → ok:true（baseUrl 指向本地网关）", () => {
  const home = makeHome();
  try {
    const prov = addProvider(
      {
        name: "deepseek",
        inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
        inferenceGatewayApiKey: "sk-test-key",
        inferenceGatewayAuthScheme: "bearer",
      },
      { home },
    );
    const entry = createProfile(
      {
        name: "网关路由",
        mode: "advanced",
        port: 8787,
        gatewayToken: "claudeharbor-local",
        gatewayAuthScheme: "bearer",
      },
      { home },
    );
    addEntry(
      entry.id,
      { name: "claude-sonnet-main", provider: prov.id, upstreamModel: "deepseek-chat" },
      { home },
    );
    writeClaudeProfile(home, entry.id, {
      inferenceProvider: "gateway",
      inferenceCredentialKind: "static",
      inferenceGatewayBaseUrl: "http://127.0.0.1:8787",
      inferenceGatewayApiKey: "claudeharbor-local",
      inferenceModels: [{ name: "claude-sonnet-main" }],
    });
    assert.deepEqual(gate(entry.id, { home }), { ok: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("未知 profileId 抛 CheckError（VALIDATION）", () => {
  const home = makeHome();
  try {
    assert.throws(
      () => gate("00000000-0000-4000-8000-000000000000", { home }),
      (err: unknown) => err instanceof CheckError && err.code === "VALIDATION",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
