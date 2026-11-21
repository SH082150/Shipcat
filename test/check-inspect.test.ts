import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { add as addProvider } from "../core/archive/providers/index.ts";
import { create as createProfile } from "../core/archive/profiles/index.ts";
import { claudePaths } from "../core/archive/paths/index.ts";
import { upsertEntry as upsertClaudeEntry } from "../core/archive/claude-meta/index.ts";
import { inspectClaudeChanges } from "../core/check/index.ts";

const PROVIDER = {
  name: "deepseek",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-inspect-test",
  inferenceGatewayAuthScheme: "x-api-key" as const,
};

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-inspect-"));
  mkdirSync(claudePaths(home).configLibrary, { recursive: true });
  return home;
}

function claudeFile(home: string, id: string): string {
  return join(claudePaths(home).configLibrary, `${id}.json`);
}

function readClaude(home: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(claudeFile(home, id), "utf8")) as Record<string, unknown>;
}

function writeClaude(home: string, id: string, value: Record<string, unknown>): void {
  writeFileSync(claudeFile(home, id), JSON.stringify(value));
}

function seedProfile(home: string) {
  const provider = addProvider(PROVIDER, { home });
  const profile = createProfile(
    {
      name: "漂移测试",
      mode: "advanced",
      port: 9101,
      gatewayToken: "token",
      gatewayAuthScheme: "bearer",
      claude: { modelCatalogUrl: "https://catalog.example/v1" },
      inferenceModels: [
        { name: "claude-test-model", provider: provider.id, upstreamModel: "deepseek-chat" },
      ],
    },
    { home },
  );
  return profile;
}

test("inspect：无变化时返回空报告", () => {
  const home = makeHome();
  try {
    seedProfile(home);
    const report = inspectClaudeChanges({ home });
    assert.deepEqual(report.profiles, []);
    assert.deepEqual(report.renames, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inspect：透传值变化与管理键变化都进入 diffs", () => {
  const home = makeHome();
  try {
    const profile = seedProfile(home);
    const raw = readClaude(home, profile.id);
    raw.modelCatalogUrl = "https://catalog.example/v2";
    raw.inferenceGatewayBaseUrl = "http://127.0.0.1:9999";
    writeClaude(home, profile.id, raw);

    const report = inspectClaudeChanges({ home });
    assert.equal(report.profiles.length, 1);
    const [drift] = report.profiles;
    assert.equal(drift?.id, profile.id);
    assert.equal(drift?.error, undefined);
    const keys = drift?.diffs.map((diff) => diff.key) ?? [];
    assert.ok(keys.includes("modelCatalogUrl"), "透传值变化应被列出");
    assert.ok(keys.includes("inferenceGatewayBaseUrl"), "管理键变化应被列出");
    assert.deepEqual(drift?.extraKeys, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inspect：Claude 新增的顶层键进入 extraKeys", () => {
  const home = makeHome();
  try {
    const profile = seedProfile(home);
    const raw = readClaude(home, profile.id);
    raw.customAddedField = { enabled: true };
    writeClaude(home, profile.id, raw);

    const report = inspectClaudeChanges({ home });
    assert.equal(report.profiles.length, 1);
    assert.deepEqual(report.profiles[0]?.extraKeys, ["customAddedField"]);
    assert.deepEqual(report.profiles[0]?.diffs, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inspect：Claude 文件缺失记为 (file) 差异", () => {
  const home = makeHome();
  try {
    const profile = seedProfile(home);
    unlinkSync(claudeFile(home, profile.id));
    const report = inspectClaudeChanges({ home });
    assert.equal(report.profiles.length, 1);
    assert.deepEqual(
      report.profiles[0]?.diffs.map((diff) => diff.key),
      ["(file)"],
    );
    assert.deepEqual(report.profiles[0]?.extraKeys, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inspect：Claude 侧改名进入 renames，不当作字段漂移", () => {
  const home = makeHome();
  try {
    const profile = seedProfile(home);
    upsertClaudeEntry({ id: profile.id, name: "Claude 侧新名字" }, { home });

    const report = inspectClaudeChanges({ home });
    assert.deepEqual(report.renames, [
      { id: profile.id, from: "漂移测试", to: "Claude 侧新名字" },
    ]);
    assert.deepEqual(report.profiles, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("inspect：文件损坏时返回 error 而不是抛错", () => {
  const home = makeHome();
  try {
    const profile = seedProfile(home);
    writeFileSync(claudeFile(home, profile.id), "{ not json");
    const report = inspectClaudeChanges({ home });
    assert.equal(report.profiles.length, 1);
    assert.match(report.profiles[0]?.error ?? "", /损坏|解析/);
    assert.deepEqual(report.profiles[0]?.diffs, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
