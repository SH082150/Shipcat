/**
 * Monitor 核心：记录映射、usage 时区分片、游标、watch 循环与手动重建。
 * 全部使用临时目录，不读取真实 Claude 数据。
 */

import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { desktopDataRoot, harborRoot } from "../core/platform/index.ts";
import { groupMonitorModels } from "../core/monitor/profile.ts";
import { MonitorService } from "../core/monitor/service.ts";
import { readMonitorDay, readMonitorMeta } from "../core/monitor/store.ts";
import { localDayStart } from "../core/usage/time.ts";
import type { StandardProfile } from "../core/types.ts";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROVIDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROVIDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TIME_ZONE = "Asia/Shanghai";
const BASE = Date.UTC(2026, 10, 25, 12, 0, 0);
const NOW = BASE + 60_000;

interface Fixture {
  readonly home: string;
  readonly sessions: string;
  readonly monitorRoot: string;
  readonly ledger: string;
  cleanup(): void;
}

function usage(inputTokens: number, outputTokens = 10) {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: inputTokens * 2,
    cacheWriteTokens: 1,
    webSearchRequests: 0,
    cost: { usd: 1.23, basis: "list" },
  };
}

function officialLine(
  ts: number,
  models: Record<string, ReturnType<typeof usage>>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    v: 1,
    ts,
    surface: "code",
    origin: "turn",
    sessionId: "local_test",
    isError: false,
    models,
    ...extra,
  });
}

function fixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "shipcat-monitor-"));
  const sessions = join(home, "sessions");
  const ledger = join(sessions, "account", "sub", "usage-ledger");
  const monitorRoot = join(home, "monitor");
  mkdirSync(ledger, { recursive: true });
  mkdirSync(monitorRoot, { recursive: true });
  const usageDir = join(harborRoot(home), "usage");
  mkdirSync(usageDir, { recursive: true });
  writeFileSync(
    join(usageDir, "config.json"),
    JSON.stringify({ timezone: TIME_ZONE, syncIntervalMinutes: 5 }),
  );

  const profilesDir = join(harborRoot(home), "profiles");
  const configLibrary = join(desktopDataRoot(home), "configLibrary");
  mkdirSync(profilesDir, { recursive: true });
  mkdirSync(configLibrary, { recursive: true });
  const entries = [{ id: PROFILE_ID, name: "测试档案" }];
  writeFileSync(
    join(profilesDir, "_meta.json"),
    JSON.stringify({ version: 1, appliedId: PROFILE_ID, entries }),
  );
  writeFileSync(
    join(profilesDir, `${PROFILE_ID}.json`),
    JSON.stringify({
      version: 1,
      mode: "advanced",
      port: 12345,
      gatewayToken: "test",
      gatewayAuthScheme: "bearer",
      inferenceModels: [
        { name: "alias-a", provider: PROVIDER_A, upstreamModel: "upstream-shared" },
        { name: "alias-b", provider: PROVIDER_A, upstreamModel: "upstream-shared" },
        { name: "alias-c", provider: PROVIDER_B, upstreamModel: "upstream-c" },
      ],
    }),
  );
  writeFileSync(
    join(configLibrary, "_meta.json"),
    JSON.stringify({ appliedId: PROFILE_ID, entries }),
  );

  return {
    home,
    sessions,
    monitorRoot,
    ledger,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function setLedger(fx: Fixture, text: string): void {
  writeFileSync(join(fx.ledger, "2026-11-25.ndjson"), text);
}

function appendLedger(fx: Fixture, line: string): void {
  appendFileSync(join(fx.ledger, "2026-11-25.ndjson"), `${line}\n`);
}

function makeService(
  fx: Fixture,
  options: { watch?: boolean; fallbackMs?: number; clientRunning?: () => boolean } = {},
): MonitorService {
  return new MonitorService({
    monitorRoot: fx.monitorRoot,
    sourceRoot: () => ({ root: fx.sessions }),
    home: fx.home,
    now: () => NOW,
    watch: options.watch ?? false,
    fallbackMs: options.fallbackMs,
    clientRunning: options.clientRunning,
  });
}

function records(fx: Fixture, sourceTs = BASE) {
  return readMonitorDay(fx.monitorRoot, localDayStart(sourceTs, TIME_ZONE));
}

test("Monitor：原始 UTC ts、供应商映射、同上游合并、unknown 与 tools", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    const raw = officialLine(
      BASE,
      {
        "alias-a": usage(10),
        "alias-b": usage(5),
        "not-in-profile": usage(3),
      },
      { tools: { Read: 2, Bash: 1 }, isError: true },
    );
    setLedger(fx, `${raw}\n`);
    const result = await service.start();
    assert.equal(result.recordsProcessed, 1);

    const dayRecords = records(fx);
    assert.equal(dayRecords.length, 1);
    const record = dayRecords[0];
    assert.ok(record);
    assert.equal(record.ts, BASE);
    assert.equal(record.sessionId, "local_test");
    assert.equal(record.isError, true);
    assert.deepEqual(record.tools, { Read: 2, Bash: 1 });

    const shared = record.provider[PROVIDER_A]?.["upstream-shared"];
    assert.ok(shared);
    assert.equal(shared.inputTokens, 15);
    assert.equal(shared.outputTokens, 20);
    assert.equal("cost" in shared, false);
    assert.equal(record.provider.unknown?.unknown?.inputTokens, 3);

    const meta = readMonitorMeta(fx.monitorRoot);
    assert.ok(meta);
    assert.equal(meta.ts, BASE);
    assert.equal(meta.hash.length, 64);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：同 ts 不同 hash 能补读，重复同步不重复写入", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    const first = officialLine(BASE, { "alias-a": usage(10) });
    const second = officialLine(BASE, { "alias-c": usage(7) }, { origin: "title" });
    setLedger(fx, `${first}\n`);
    await service.start();

    appendLedger(fx, second);
    await service.requestSync("manual");
    assert.equal(records(fx).length, 2);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE);

    await service.requestSync("manual");
    assert.equal(records(fx).length, 2);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：尾部半行暂不读，写完整后下一轮补入", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    const first = officialLine(BASE, { "alias-a": usage(10) });
    const second = officialLine(BASE + 1000, { "alias-c": usage(7) });
    setLedger(fx, `${first}\n${second.slice(0, 30)}`);
    const initial = await service.start();
    assert.equal(initial.recordsProcessed, 1);
    assert.equal(initial.partialLines, 1);
    assert.equal(records(fx).length, 1);

    setLedger(fx, `${first}\n${second}\n`);
    await service.requestSync("manual");
    assert.equal(records(fx, BASE).length, 2);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE + 1000);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：用户手动重建后，所有模型汇总进 unknown.unknown", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    setLedger(
      fx,
      `${officialLine(BASE, { "alias-a": usage(10), "alias-c": usage(5) })}\n`,
    );
    await service.start();
    assert.ok(records(fx)[0]?.provider[PROVIDER_A]);

    const rebuilt = await service.rebuild();
    assert.equal(rebuilt.rebuilt, true);
    const unknown = records(fx)[0]?.provider.unknown?.unknown;
    assert.ok(unknown);
    assert.equal(unknown.inputTokens, 15);
    assert.equal(unknown.outputTokens, 20);
    assert.equal(Object.keys(records(fx)[0]?.provider ?? {}).join(","), "unknown");
    assert.equal(service.getLifecycleState(), "IDLE");
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：客户端未运行时，新记录归为 unknown", async () => {
  const fx = fixture();
  const service = makeService(fx, { clientRunning: () => false });
  try {
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(10) })}\n`);
    await service.start();
    assert.equal(records(fx)[0]?.provider.unknown?.unknown?.inputTokens, 10);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：watch 与兜底同时触发仍只有单轮写入", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    await service.start();
    appendLedger(fx, officialLine(BASE, { "alias-a": usage(10) }));
    await Promise.all([
      service.requestSync("manual"),
      service.requestSync("fallback"),
    ]);
    assert.equal(records(fx).length, 1);
    assert.equal(service.getLifecycleState(), "IDLE");
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：watch 运行期间追加文件可自动读取", async () => {
  const fx = fixture();
  const service = makeService(fx, { watch: true, fallbackMs: 50 });
  try {
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(10) })}\n`);
    await service.start();
    appendLedger(fx, officialLine(BASE + 1000, { "alias-c": usage(7) }));

    const deadline = Date.now() + 2000;
    while (records(fx).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(records(fx).length, 2);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE + 1000);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：标准档案上游模型就是 name", () => {
  const profile: StandardProfile = {
    version: 1,
    mode: "standard",
    inferenceModels: [{ name: "alias-a", provider: PROVIDER_A }],
  };
  const grouped = groupMonitorModels({ "alias-a": usage(10) }, profile);
  assert.equal(grouped[PROVIDER_A]?.["alias-a"]?.inputTokens, 10);
});

test("Monitor：日文件按 usage 时区分片，记录保留原始 UTC ts", async () => {
  const fx: Fixture = fixture();
  const service = makeService(fx);
  try {
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(10) })}\n`);
    await service.start();
    const path = join(
      fx.monitorRoot,
      "layer1",
      `${localDayStart(BASE, TIME_ZONE)}.ndjson`,
    );
    const saved = JSON.parse(readFileSync(path, "utf8")) as { ts: number };
    assert.equal(saved.ts, BASE);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.timezone, TIME_ZONE);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：usage 时区变化后整库重建，不重复写入", async () => {
  const fx: Fixture = fixture();
  const service = makeService(fx);
  try {
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(10) })}\n`);
    await service.start();
    assert.equal(records(fx).length, 1);

    writeFileSync(
      join(harborRoot(fx.home), "usage", "config.json"),
      JSON.stringify({ timezone: "UTC", syncIntervalMinutes: 5 }),
    );
    await service.requestSync("manual");

    const dayFiles = readdirSync(join(fx.monitorRoot, "layer1")).filter((name) =>
      name.endsWith(".ndjson"),
    );
    assert.equal(dayFiles.length, 1);
    assert.equal(dayFiles[0], `${localDayStart(BASE, "UTC")}.ndjson`);
    const rebuilt = readMonitorDay(fx.monitorRoot, localDayStart(BASE, "UTC"));
    assert.equal(rebuilt.length, 1);
    assert.equal(rebuilt[0]?.ts, BASE);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：越界 ts 按坏行跳过，不中断同步", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    const bad = JSON.stringify({
      v: 1,
      ts: 1e300,
      surface: "code",
      origin: "turn",
      models: {},
      tools: {},
    });
    setLedger(fx, `${bad}\n${officialLine(BASE, { "alias-a": usage(10) })}\n`);
    const result = await service.start();
    assert.equal(result.badLines, 1);
    assert.equal(result.recordsProcessed, 1);
    assert.equal(records(fx).length, 1);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：多账本目录下，游标取最大 ts，迟到的新记录不漏读", async () => {
  const fx = fixture();
  const service = makeService(fx);
  try {
    const dirB = join(fx.sessions, "account-b", "sub", "usage-ledger");
    mkdirSync(dirB, { recursive: true });
    const fileB = join(dirB, "2026-11-25.ndjson");
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(1) })}\n`);
    writeFileSync(fileB, `${officialLine(BASE + 100, { "alias-a": usage(1) })}\n`);

    const first = await service.start();
    assert.equal(first.recordsProcessed, 2);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE + 100);

    appendFileSync(fileB, `${officialLine(BASE + 200, { "alias-a": usage(1) })}\n`);
    const second = await service.requestSync("manual");
    assert.equal(second.recordsProcessed, 1);
    assert.equal(records(fx).length, 3);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.ts, BASE + 200);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});

test("Monitor：账本来源变化后整库重建", async () => {
  const fx = fixture();
  const otherRoot = join(fx.home, "sessions-2");
  const otherLedger = join(otherRoot, "account", "sub", "usage-ledger");
  mkdirSync(otherLedger, { recursive: true });
  const otherTs = BASE + 500;
  writeFileSync(
    join(otherLedger, "2026-11-25.ndjson"),
    `${officialLine(otherTs, { "alias-a": usage(2) })}\n`,
  );

  let sourceRoot = fx.sessions;
  const service = new MonitorService({
    monitorRoot: fx.monitorRoot,
    sourceRoot: () => ({ root: sourceRoot }),
    home: fx.home,
    now: () => NOW,
    watch: false,
  });
  try {
    setLedger(fx, `${officialLine(BASE, { "alias-a": usage(1) })}\n`);
    await service.start();
    assert.equal(records(fx).length, 1);

    sourceRoot = otherRoot;
    await service.requestSync("manual");

    const dayFiles = readdirSync(join(fx.monitorRoot, "layer1")).filter((name) =>
      name.endsWith(".ndjson"),
    );
    assert.equal(dayFiles.length, 1);
    const rebuilt = readMonitorDay(fx.monitorRoot, localDayStart(otherTs, TIME_ZONE));
    assert.equal(rebuilt.length, 1);
    assert.equal(rebuilt[0]?.ts, otherTs);
    assert.equal(readMonitorMeta(fx.monitorRoot)?.source, otherRoot);
  } finally {
    service.dispose();
    fx.cleanup();
  }
});
