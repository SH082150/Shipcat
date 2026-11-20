import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  add,
  type AddProviderInput,
} from "../core/archive/providers/index.ts";
import {
  addEntry,
  create,
  detailList,
  get,
  list,
  metaRebuild,
  ProfilesError,
  remove,
  removeEntry,
  rename,
  updateEntry,
  type CreateProfileInput,
  type ProfileEntryInput,
} from "../core/archive/profiles/index.ts";

/** 每个用例独立临时 home；目录布局按 paths 契约：home/.claudeharbor/… */
function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "harbor-profiles-"));
}

function harborDir(home: string): string {
  return join(home, ".claudeharbor");
}
function profilesDir(home: string): string {
  return join(harborDir(home), "profiles");
}

/**
 * POSIX 权限位断言专用 skip：Windows 的 chmod 只切换只读属性，
 * `statSync().mode & 0o777` 恒为 0o666，与 600/644 无对等物。
 * 权限位断言单独成例并在 Windows 跳过，其余业务断言照常执行。
 */
function posixModeSkip(): { skip: string | false } {
  return { skip: process.platform === "win32" ? "Windows 无 POSIX 权限位（chmod 无对等物）" : false };
}

const deepseek: AddProviderInput = {
  name: "deepseek",
  inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic",
  inferenceGatewayApiKey: "sk-test-key",
  inferenceGatewayAuthScheme: "x-api-key",
};

const kimi: AddProviderInput = {
  name: "kimi",
  inferenceGatewayBaseUrl: "https://api.moonshot.cn/anthropic",
  inferenceGatewayApiKey: "sk-kimi-key",
  inferenceGatewayAuthScheme: "bearer",
};

const stdEntry = (provider: string): ProfileEntryInput => ({
  name: "claude-sonnet-main",
  provider,
});

const advEntry = (provider: string): ProfileEntryInput => ({
  name: "claude-sonnet-main",
  provider,
  upstreamModel: "deepseek-chat",
});

test("create/list/get（standard）：_meta 追加、sidecar 不存 ID/名字", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    const entry = create({ name: "DeepSeek 直连", mode: "standard" }, { home });

    assert.match(entry.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(list({ home }), [{ id: entry.id, name: "DeepSeek 直连" }]);

    const file = join(profilesDir(home), `${entry.id}.json`);
    assert.ok(existsSync(file));

    const sidecar = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(sidecar.version, 1);
    assert.equal(sidecar.mode, "standard");
    assert.equal(sidecar.id, undefined);
    assert.equal(sidecar.name, undefined);
    assert.deepEqual(sidecar.inferenceModels, []);

    const profile = get("DeepSeek 直连", { home });
    assert.equal(profile.mode, "standard");
    assert.equal(get(entry.id, { home }).mode, "standard");
    assert.throws(() => get("nope", { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
    assert.equal(prov.name, "deepseek");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（standard）：sidecar 权限为 600（POSIX）", posixModeSkip(), () => {
  const home = makeHome();
  try {
    const entry = create({ name: "DeepSeek 直连", mode: "standard" }, { home });
    const file = join(profilesDir(home), `${entry.id}.json`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（advanced）：三件套写入、scheme 缺省 bearer", () => {
  const home = makeHome();
  try {
    add(deepseek, { home });
    const entry = create(
      { name: "网关主力", mode: "advanced", port: 8787, gatewayToken: "tok" },
      { home },
    );

    const file = join(profilesDir(home), `${entry.id}.json`);
    const sidecar = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(sidecar.mode, "advanced");
    assert.equal(sidecar.port, 8787);
    assert.equal(sidecar.gatewayToken, "tok");
    assert.equal(sidecar.gatewayAuthScheme, "bearer");

    const profile = get("网关主力", { home });
    if (profile.mode !== "advanced") assert.fail("应为 advanced");
    assert.equal(profile.port, 8787);
    assert.equal(profile.gatewayToken, "tok");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（advanced）：sidecar 权限为 600（POSIX）", posixModeSkip(), () => {
  const home = makeHome();
  try {
    const entry = create(
      { name: "网关主力", mode: "advanced", port: 8787, gatewayToken: "tok" },
      { home },
    );
    const file = join(profilesDir(home), `${entry.id}.json`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create（advanced）：缺 port/token、非法 port/scheme 拒绝；standard 带网关字段拒绝", () => {
  const home = makeHome();
  try {
    add(deepseek, { home });
    const cases: CreateProfileInput[] = [
      { name: "a", mode: "advanced", gatewayToken: "tok" },
      { name: "b", mode: "advanced", port: 8787 },
      { name: "c", mode: "advanced", port: 70000, gatewayToken: "tok" },
      { name: "d", mode: "advanced", port: 8787, gatewayToken: "tok", gatewayAuthScheme: "digest" as never },
      { name: "e", mode: "standard", port: 8787 },
    ];
    for (const input of cases) {
      assert.throws(() => create(input, { home }), (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "VALIDATION");
        return true;
      });
    }
    assert.equal(list({ home }).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("create：重名拒绝；rename 只改 _meta；remove 删 sidecar + _meta 条目", () => {
  const home = makeHome();
  try {
    const a = create({ name: "主力", mode: "standard" }, { home });
    assert.throws(() => create({ name: "主力", mode: "standard" }, { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });

    const renamed = rename("主力", "新主力", { home });
    assert.deepEqual(renamed, { id: a.id, name: "新主力" });
    assert.deepEqual(list({ home }), [{ id: a.id, name: "新主力" }]);
    // 改成另一个已占用的名字 → 拒绝（改成自己现名不算冲突）
    create({ name: "占用", mode: "standard" }, { home });
    assert.throws(() => rename("新主力", "占用", { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });

    const sidecarPath = join(profilesDir(home), `${a.id}.json`);
    const before = readFileSync(sidecarPath, "utf8");
    rename(a.id, "按ID改名", { home });
    assert.equal(readFileSync(sidecarPath, "utf8"), before, "改名不应动 sidecar");

    remove("按ID改名", { home });
    remove("占用", { home });
    assert.equal(list({ home }).length, 0);
    assert.ok(!existsSync(sidecarPath));
    assert.throws(() => remove("按ID改名", { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("条目增删改：写 sidecar 并可读回；同 profile 内 name 唯一", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    create({ name: "gw", mode: "advanced", port: 8787, gatewayToken: "tok" }, { home });

    addEntry("gw", advEntry(prov.id), { home });
    let profile = get("gw", { home });
    if (profile.mode !== "advanced") assert.fail("应为 advanced");
    assert.equal(profile.inferenceModels.length, 1);
    assert.equal(profile.inferenceModels[0]?.name, "claude-sonnet-main");

    assert.throws(() => addEntry("gw", advEntry(prov.id), { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });

    updateEntry("gw", { ...advEntry(prov.id), upstreamModel: "deepseek-reasoner" }, { home });
    profile = get("gw", { home });
    if (profile.mode !== "advanced") assert.fail("应为 advanced");
    assert.equal((profile.inferenceModels[0] as { upstreamModel: string }).upstreamModel, "deepseek-reasoner");

    assert.throws(
      () => updateEntry("gw", { ...advEntry(prov.id), name: "claude-不存在的条目" }, { home }),
      (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );

    removeEntry("gw", advEntry(prov.id), { home });
    assert.equal(get("gw", { home }).inferenceModels.length, 0);
    assert.throws(() => removeEntry("gw", advEntry(prov.id), { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("routeId 规则：写条目前校验，违规拒绝", () => {
  const home = makeHome();
  try {
    const prov = add(deepseek, { home });
    create({ name: "gw", mode: "advanced", port: 8787, gatewayToken: "tok" }, { home });

    for (const bad of ["deepseek-main", "claude sonnet", "claude-20260101"]) {
      assert.throws(
        () => addEntry("gw", { name: bad, provider: prov.id, upstreamModel: "x" }, { home }),
        (err: unknown) => {
          assert.ok(err instanceof ProfilesError);
          assert.equal(err.code, "VALIDATION");
          return true;
        },
      );
    }
    assert.equal(get("gw", { home }).inferenceModels.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("provider 引用存在性：引用 suppliers _meta 里不存在的 UUID 拒绝", () => {
  const home = makeHome();
  try {
    create({ name: "gw", mode: "advanced", port: 8787, gatewayToken: "tok" }, { home });
    assert.throws(
      () =>
        addEntry(
          "gw",
          { name: "claude-sonnet-main", provider: "00000000-0000-4000-8000-000000000000", upstreamModel: "x" },
          { home },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
    const prov = add(deepseek, { home });
    assert.throws(
      () => addEntry("gw", { name: "claude-sonnet-main", provider: prov.id }, { home }),
      (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "VALIDATION");
        return true;
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("standard 单供应商规则：条目 provider 必须相同；创建时带条目也校验", () => {
  const home = makeHome();
  try {
    const d = add(deepseek, { home });
    const k = add(kimi, { home });

    create({ name: "std", mode: "standard" }, { home });
    addEntry("std", stdEntry(d.id), { home });
    assert.throws(() => addEntry("std", stdEntry(k.id), { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });

    assert.throws(
      () =>
        create(
          {
            name: "std2",
            mode: "standard",
            inferenceModels: [
              { ...stdEntry(d.id), name: "claude-sonnet-a" },
              { ...stdEntry(k.id), name: "claude-sonnet-b" },
            ],
          },
          { home },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "VALIDATION");
        return true;
      },
    );

    assert.throws(
      () => create({ name: "std3", mode: "standard", inferenceModels: [stdEntry(d.id), stdEntry(d.id)] }, { home }),
      (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "VALIDATION");
        return true;
      },
    );

    // 同名条目但 provider 相同 → 允许（单供应商不变）
    const ok = create(
      { name: "std4", mode: "standard", inferenceModels: [stdEntry(d.id)] },
      { home },
    );
    const profile = get(ok.id, { home });
    if (profile.mode !== "standard") assert.fail("应为 standard");
    assert.equal(profile.inferenceModels.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readOnly：一切写操作拒绝（条目增删改、改名），删除允许", () => {
  const home = makeHome();
  try {
    mkdirSync(profilesDir(home), { recursive: true });
    const id = "11111111-2222-4333-8444-555555555555";
    writeFileSync(
      join(profilesDir(home), `${id}.json`),
      JSON.stringify({
        version: 1,
        mode: "readOnly",
        inferenceModels: [{ name: "claude-sonnet-4-5" }],
      }),
    );
    writeFileSync(
      join(profilesDir(home), "_meta.json"),
      JSON.stringify({ version: 1, appliedId: null, entries: [{ id, name: "外来镜像" }] }),
    );

    const profile = get("外来镜像", { home });
    assert.equal(profile.mode, "readOnly");

    const entry = { name: "claude-sonnet-4-5" };
    for (const fn of [
      () => addEntry(id, { ...entry, provider: "x" }, { home }),
      () => updateEntry(id, entry, { home }),
      () => removeEntry(id, entry, { home }),
      () => rename(id, "新名字", { home }),
    ]) {
      assert.throws(fn, (err: unknown) => {
        assert.ok(err instanceof ProfilesError);
        assert.equal(err.code, "CONFLICT");
        return true;
      });
    }

    remove("外来镜像", { home });
    assert.equal(list({ home }).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("_meta 自愈：_meta 缺失/损坏时从 sidecar 目录重建，name 以 UUID 占位", () => {
  const home = makeHome();
  try {
    const a = create({ name: "甲", mode: "standard" }, { home });
    const b = create({ name: "乙", mode: "standard" }, { home });
    rmSync(join(profilesDir(home), "_meta.json"));

    const rebuilt = list({ home });
    assert.equal(rebuilt.length, 2);
    for (const e of rebuilt) {
      assert.equal(e.name, e.id, "重建时 name 以 UUID 占位");
    }
    assert.ok(rebuilt.some((e) => e.id === a.id));
    assert.ok(rebuilt.some((e) => e.id === b.id));

    // metaRebuild 导出同一语义
    const again = metaRebuild({ home });
    assert.equal(again.length, 2);

    assert.equal(get(a.id, { home }).mode, "standard");

    // 损坏的 JSON 也触发重建
    writeFileSync(join(profilesDir(home), "_meta.json"), "{{{");
    assert.equal(list({ home }).length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("激活保护：appliedId 指向的 profile 拒绝删除，其余可删", () => {
  const home = makeHome();
  try {
    const a = create({ name: "激活中", mode: "standard" }, { home });
    create({ name: "备用", mode: "standard" }, { home });

    const metaPath = join(profilesDir(home), "_meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.appliedId = a.id;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    assert.throws(() => remove("激活中", { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "CONFLICT");
      return true;
    });
    remove("备用", { home });
    assert.equal(list({ home }).length, 1);

    const after = JSON.parse(readFileSync(metaPath, "utf8"));
    assert.equal(after.appliedId, a.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("detailList：索引条目附 mode；重名条目标签在列表层面不感知", () => {
  const home = makeHome();
  try {
    add(deepseek, { home });
    const a = create({ name: "std", mode: "standard" }, { home });
    const b = create({ name: "gw", mode: "advanced", port: 8787, gatewayToken: "tok" }, { home });

    const items = detailList({ home });
    assert.deepEqual(items, [
      { id: a.id, name: "std", mode: "standard" },
      { id: b.id, name: "gw", mode: "advanced" },
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("get：_meta 有条目但 sidecar 文件缺失 → ARCHIVE_CORRUPT", () => {
  const home = makeHome();
  try {
    const a = create({ name: "孤儿", mode: "standard" }, { home });
    rmSync(join(profilesDir(home), `${a.id}.json`));
    assert.throws(() => get("孤儿", { home }), (err: unknown) => {
      assert.ok(err instanceof ProfilesError);
      assert.equal(err.code, "ARCHIVE_CORRUPT");
      return true;
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
