import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { add as addProvider } from "../core/archive/providers/index.ts";
import { create as createProfile, meta as profilesMeta } from "../core/archive/profiles/index.ts";
import { harborPaths, claudePaths } from "../core/archive/paths/index.ts";
import { upsertEntry as upsertClaudeEntry } from "../core/archive/claude-meta/index.ts";
import { buildSyncPlan, applySyncPlan } from "../core/sync/index.ts";

const PROVIDER = {
  name: "deepseek",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-sync-test",
  inferenceGatewayAuthScheme: "x-api-key" as const,
};

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-sync-"));
  mkdirSync(claudePaths(home).configLibrary, { recursive: true });
  return home;
}

function claudeFile(home: string, id: string): string {
  return join(claudePaths(home).configLibrary, `${id}.json`);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function seedAdvanced(home: string) {
  const provider = addProvider(PROVIDER, { home });
  const profile = createProfile(
    {
      name: "同步测试",
      mode: "advanced",
      port: 9200,
      gatewayToken: "old-token",
      gatewayAuthScheme: "bearer",
      claude: { modelCatalogUrl: "https://catalog.local/v1", oldFlag: "x" },
      inferenceModels: [
        { name: "claude-m1", provider: provider.id, upstreamModel: "up-1", maxEffort: "high" },
        { name: "claude-m2", provider: provider.id, upstreamModel: "up-2" },
      ],
    },
    { home },
  );
  return { profile, provider };
}

test("plan：三项分类、四列数据与 importable 规则", () => {
  const home = makeHome();
  try {
    const { profile } = seedAdvanced(home);
    const raw = readJson(claudeFile(home, profile.id));
    raw.inferenceGatewayBaseUrl = "http://127.0.0.1:9201";
    raw.inferenceGatewayAuthScheme = "x-api-key";
    raw.inferenceGatewayApiKey = "claude-token";
    raw.modelCatalogUrl = "https://claude.local/v1";
    raw.addedFlag = "true";
    delete raw.oldFlag;
    const models = raw.inferenceModels as Record<string, unknown>[];
    models[0]!.maxEffort = "low";
    models.push({ name: "claude-added", labelOverride: "新增" });
    writeFileSync(claudeFile(home, profile.id), JSON.stringify(raw));
    upsertClaudeEntry({ id: profile.id, name: "Claude 改名" }, { home });

    const plan = buildSyncPlan(profile.id, { home });
    assert.equal(plan.fileMissing, false);

    const basicPaths = plan.basic.map((field) => field.path);
    assert.ok(basicPaths.includes("name"));
    assert.ok(basicPaths.includes("port"));
    assert.ok(basicPaths.includes("authScheme"));
    assert.ok(basicPaths.includes("gatewayToken"));
    assert.equal(plan.basic.find((field) => field.path === "port")?.importable, true);
    assert.equal(plan.basic.find((field) => field.path === "gatewayToken")?.kind, "secret");

    assert.deepEqual(
      plan.passthrough.map((field) => field.path),
      ["addedFlag", "modelCatalogUrl", "oldFlag"],
    );
    assert.equal(plan.passthrough.find((field) => field.path === "oldFlag")?.claude.present, false);
    assert.equal(plan.passthrough.find((field) => field.path === "addedFlag")?.local.present, false);

    assert.equal(plan.models.length, 2);
    assert.equal(plan.models[0]?.status, "changed");
    assert.deepEqual(
      plan.models[0]?.fields.map((field) => field.field),
      ["maxEffort"],
    );
    assert.equal(plan.models[1]?.status, "claude-only");
    assert.equal(plan.models[1]?.needsProvider, true);
    assert.equal(plan.models[1]?.needsUpstream, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("plan：standard 的 URL / 密钥只能 Shipcat 覆盖", () => {
  const home = makeHome();
  try {
    const provider = addProvider(PROVIDER, { home });
    const profile = createProfile(
      {
        name: "标准同步",
        mode: "standard",
        inferenceModels: [{ name: "claude-s1", provider: provider.id }],
      },
      { home },
    );
    const raw = readJson(claudeFile(home, profile.id));
    raw.inferenceGatewayBaseUrl = "https://changed.example/anthropic";
    raw.inferenceGatewayApiKey = "__sealed__:abc";
    writeFileSync(claudeFile(home, profile.id), JSON.stringify(raw));

    const plan = buildSyncPlan(profile.id, { home });
    const url = plan.basic.find((field) => field.path === "baseUrl");
    assert.ok(url);
    assert.equal(url.importable, false);
    assert.equal(plan.basic.find((field) => field.path === "apiKey"), undefined, "sealed 密钥不产生可比较行");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("apply：按最终值落 sidecar 并强同步 Claude 文件", () => {
  const home = makeHome();
  try {
    const { profile } = seedAdvanced(home);
    const raw = readJson(claudeFile(home, profile.id));
    raw.inferenceGatewayBaseUrl = "http://127.0.0.1:9201";
    raw.inferenceGatewayAuthScheme = "x-api-key";
    raw.inferenceGatewayApiKey = "claude-token";
    raw.modelCatalogUrl = "https://claude.local/v1";
    raw.addedFlag = "true";
    delete raw.oldFlag;
    const models = raw.inferenceModels as Record<string, unknown>[];
    models[0]!.maxEffort = "low";
    models.pop();
    writeFileSync(claudeFile(home, profile.id), JSON.stringify(raw));
    upsertClaudeEntry({ id: profile.id, name: "Claude 改名" }, { home });

    applySyncPlan(
      profile.id,
      {
        name: "Claude 改名",
        port: "9201",
        authScheme: "x-api-key",
        gatewayToken: "claude-token",
        passthrough: {
          modelCatalogUrl: "https://claude.local/v1",
          addedFlag: "true",
          oldFlag: null,
        },
        models: {
          0: { values: { maxEffort: "low" } },
          1: { delete: true },
        },
      },
      { home },
    );

    assert.equal(profilesMeta({ home }).entries.find((entry) => entry.id === profile.id)?.name, "Claude 改名");
    const sidecar = readJson(join(harborPaths(home).profilesDir, `${profile.id}.json`));
    assert.equal(sidecar.port, 9201);
    assert.equal(sidecar.gatewayToken, "claude-token");
    assert.equal(sidecar.gatewayAuthScheme, "x-api-key");
    assert.deepEqual(sidecar.claude, {
      modelCatalogUrl: "https://claude.local/v1",
      addedFlag: true,
    });
    assert.equal((sidecar.inferenceModels as unknown[]).length, 1);

    const claude = readJson(claudeFile(home, profile.id));
    assert.equal(claude.inferenceGatewayBaseUrl, "http://127.0.0.1:9201");
    assert.equal(claude.modelCatalogUrl, "https://claude.local/v1");
    assert.equal(claude.addedFlag, true);
    assert.equal((claude.inferenceModels as unknown[]).length, 1);

    assert.deepEqual(buildSyncPlan(profile.id, { home }).basic, []);
    assert.deepEqual(buildSyncPlan(profile.id, { home }).models, []);
    assert.deepEqual(buildSyncPlan(profile.id, { home }).passthrough, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("apply：Claude 新增模型按用户补充的供应商/上游模型入库", () => {
  const home = makeHome();
  try {
    const { profile, provider } = seedAdvanced(home);
    const raw = readJson(claudeFile(home, profile.id));
    (raw.inferenceModels as Record<string, unknown>[]).push({
      name: "claude-added",
      labelOverride: "新增",
      anthropicFamilyTier: "sonnet",
    });
    writeFileSync(claudeFile(home, profile.id), JSON.stringify(raw));

    applySyncPlan(
      profile.id,
      {
        models: {
          2: {
            values: {
              name: "claude-added",
              labelOverride: "新增",
              anthropicFamilyTier: "sonnet",
              provider: provider.id,
              upstreamModel: "up-added",
            },
          },
        },
      },
      { home },
    );

    const sidecar = readJson(join(harborPaths(home).profilesDir, `${profile.id}.json`));
    const models = sidecar.inferenceModels as Record<string, unknown>[];
    assert.equal(models.length, 3);
    assert.equal(models[2]?.name, "claude-added");
    assert.equal(models[2]?.provider, provider.id);
    assert.equal(models[2]?.upstreamModel, "up-added");
    assert.deepEqual(buildSyncPlan(profile.id, { home }).models, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
