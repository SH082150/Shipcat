import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateDesktopProfile,
  GenerateError,
} from "../core/archive/generate/index.ts";
import type { AdvancedProfile, Provider, ReadOnlyProfile, StandardProfile } from "../core/types.ts";

const deepseekProvider: Provider = {
  version: 1,
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-test-key",
  inferenceGatewayAuthScheme: "x-api-key",
};

test("高级配置（§4.1 快照）：透传块展开 + 管理键 + 条目删 provider/upstreamModel", () => {
  const sidecar: AdvancedProfile = {
    version: 1,
    mode: "advanced",
    port: 8787,
    gatewayToken: "claudeharbor-local",
    gatewayAuthScheme: "bearer", // bearer：省略 inferenceGatewayAuthScheme
    claude: { inferenceStreamIdleTimeoutSec: 600 },
    inferenceModels: [
      {
        name: "claude-sonnet-main",
        labelOverride: "DeepSeek 主力",
        anthropicFamilyTier: "sonnet",
        behavesAs: "claude-sonnet-5-5",
        provider: "7c1ee8a2-3f4b-4c5d-9e0f-1234567890ab",
        upstreamModel: "deepseek-chat",
      },
    ],
  };

  const out = generateDesktopProfile(sidecar);

  assert.equal(out.inferenceStreamIdleTimeoutSec, 600); // ① 透传块
  assert.equal(out.inferenceProvider, "gateway"); // ② 管理键
  assert.equal(out.inferenceCredentialKind, "static");
  assert.equal(out.inferenceGatewayBaseUrl, "http://127.0.0.1:8787");
  assert.equal(out.inferenceGatewayApiKey, "claudeharbor-local");
  assert.ok(!("inferenceGatewayAuthScheme" in out)); // bearer 省略
  assert.deepEqual(out.inferenceModels, [
    {
      name: "claude-sonnet-main",
      labelOverride: "DeepSeek 主力",
      anthropicFamilyTier: "sonnet",
      behavesAs: "claude-sonnet-5-5",
    },
  ]); // ③ 条目：provider / upstreamModel 已删，其余原样
  assert.ok(!("version" in out));
  assert.ok(!("mode" in out));
  assert.ok(!("port" in out));
  assert.ok(!("gatewayToken" in out));
});

test("高级配置 x-api-key：写 inferenceGatewayAuthScheme", () => {
  const sidecar: AdvancedProfile = {
    version: 1,
    mode: "advanced",
    port: 8787,
    gatewayToken: "tok",
    gatewayAuthScheme: "x-api-key",
    inferenceModels: [],
  };
  const out = generateDesktopProfile(sidecar);
  assert.equal(out.inferenceGatewayAuthScheme, "x-api-key");
});

test("标准配置（§4.2 快照）：三件套同键复制自供应商、bearer 省略 scheme、条目删 provider", () => {
  const bearerProvider: Provider = {
    version: 1,
    inferenceGatewayBaseUrl: "https://api.moonshot.cn/anthropic",
    inferenceGatewayApiKey: "sk-kimi-key",
    inferenceGatewayAuthScheme: "bearer",
  };
  const sidecar: StandardProfile = {
    version: 1,
    mode: "standard",
    claude: { inferenceStreamIdleTimeoutSec: 600 },
    inferenceModels: [
      {
        name: "claude-sonnet-4-5",
        labelOverride: "Kimi 主力",
        anthropicFamilyTier: "sonnet",
        behavesAs: "claude-sonnet-4-5",
        provider: "8d2ee8a2-3f4b-4c5d-9e0f-1234567890cd",
      },
    ],
  };

  const out = generateDesktopProfile(sidecar, bearerProvider);

  assert.equal(out.inferenceProvider, "gateway");
  assert.equal(out.inferenceCredentialKind, "static");
  assert.equal(out.inferenceGatewayBaseUrl, "https://api.moonshot.cn/anthropic");
  assert.equal(out.inferenceGatewayApiKey, "sk-kimi-key");
  assert.ok(!("inferenceGatewayAuthScheme" in out)); // bearer 省略
  assert.equal(out.inferenceStreamIdleTimeoutSec, 600);
  assert.deepEqual(out.inferenceModels, [
    {
      name: "claude-sonnet-4-5",
      labelOverride: "Kimi 主力",
      anthropicFamilyTier: "sonnet",
      behavesAs: "claude-sonnet-4-5",
    },
  ]);
});

test("标准配置 x-api-key 供应商：scheme 复制", () => {
  const sidecar: StandardProfile = {
    version: 1,
    mode: "standard",
    inferenceModels: [
      { name: "claude-sonnet-4-5", provider: "7c1ee8a2-3f4b-4c5d-9e0f-1234567890ab" },
    ],
  };
  const out = generateDesktopProfile(sidecar, deepseekProvider);
  assert.equal(out.inferenceGatewayAuthScheme, "x-api-key");
});

test("管理键覆盖透传块同名键（合并顺序 ② 覆盖 ①）", () => {
  const sidecar = {
    version: 1,
    mode: "standard",
    claude: {
      inferenceProvider: "user-typed-value",
      disableDeploymentModeChooser: true,
    },
    inferenceModels: [],
  } as unknown as StandardProfile;
  const out = generateDesktopProfile(sidecar, deepseekProvider);
  assert.equal(out.inferenceProvider, "gateway"); // CLI 管理键赢
  assert.equal(out.disableDeploymentModeChooser, true); // 透传键保留
});

test("readOnly 拒绝生成（CONFLICT）", () => {
  const mirror: ReadOnlyProfile = { version: 1, mode: "readOnly", inferenceModels: [] };
  assert.throws(
    () => generateDesktopProfile(mirror),
    (err: unknown) => err instanceof GenerateError && err.code === "CONFLICT",
  );
});

test("standard 缺供应商拒绝（VALIDATION）", () => {
  const sidecar: StandardProfile = { version: 1, mode: "standard", inferenceModels: [] };
  assert.throws(
    () => generateDesktopProfile(sidecar),
    (err: unknown) => err instanceof GenerateError && err.code === "VALIDATION",
  );
});
