import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  add,
  list,
  getByName,
  getById,
  rename,
  remove,
  metaRebuild,
  ProvidersError,
  type AddProviderInput,
} from "../core/archive/providers/index.ts";

/** 每个用例独立临时 home；目录布局按 paths 契约：home/.claudeharbor/… */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-providers-"));
  return home;
}

function harborDir(home: string): string {
  return join(home, ".claudeharbor");
}
function providersDir(home: string): string {
  return join(harborDir(home), "providers");
}
function profilesDir(home: string): string {
  return join(harborDir(home), "profiles");
}

/**
 * POSIX 权限位断言专用 skip：Windows 的 chmod 只切换只读属性，
 * `statSync().mode & 0o777` 恒为 0o666，与 600 无对等物。
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

test("add + list：文件落盘、_meta 追加、列表按顺序", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    const b = add(kimi, { home });

    assert.match(a.id, /^[0-9a-f-]{36}$/);
    assert.notEqual(a.id, b.id);

    const entries = list({ home });
    assert.deepEqual(entries, [
      { id: a.id, name: "deepseek" },
      { id: b.id, name: "kimi" },
    ]);

    const file = join(providersDir(home), `${a.id}.json`);
    assert.ok(existsSync(file));

    const metaRaw = JSON.parse(readFileSync(join(providersDir(home), "_meta.json"), "utf8"));
    assert.equal(metaRaw.version, 1);
    assert.deepEqual(metaRaw.entries, entries);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("add：供应商文件权限为 600（POSIX）", posixModeSkip(), () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    const file = join(providersDir(home), `${a.id}.json`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("add：尾斜杠被剥掉；重名被拒绝", () => {
  const home = makeHome();
  try {
    add({ ...deepseek, inferenceGatewayBaseUrl: "https://api.deepseek.com/anthropic/" }, { home });
    const got = getByName("deepseek", { home });
    assert.equal(got.inferenceGatewayBaseUrl, "https://api.deepseek.com/anthropic");

    assert.throws(
      () => add(deepseek, { home }),
      (err: unknown) => {
        assert.ok(err instanceof ProvidersError);
        assert.equal(err.code, "VALIDATION");
        return true;
      },
    );
    assert.equal(list({ home }).length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("getByName / getById：返回三件套；不存在抛 NOT_FOUND", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    const byName = getByName("deepseek", { home });
    const byId = getById(a.id, { home });
    assert.equal(byName.inferenceGatewayApiKey, "sk-test-key");
    assert.equal(byName.inferenceGatewayAuthScheme, "x-api-key");
    assert.deepEqual(byName, byId);

    assert.throws(() => getByName("nope", { home }), (err: unknown) => {
      assert.ok(err instanceof ProvidersError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
    assert.throws(() => getById("00000000-0000-4000-8000-000000000000", { home }), ProvidersError);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rename：只动 _meta，文件不动；改成已占用名被拒绝", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    add(kimi, { home });
    const file = join(providersDir(home), `${a.id}.json`);
    const before = readFileSync(file, "utf8");

    const updated = rename("deepseek", "ds", { home });
    assert.deepEqual(updated, { id: a.id, name: "ds" });
    assert.equal(readFileSync(file, "utf8"), before, "改名不得触碰供应商文件");
    assert.deepEqual(
      list({ home }).map((e) => e.name),
      ["ds", "kimi"],
    );
    assert.equal(getByName("ds", { home }).inferenceGatewayApiKey, "sk-test-key");

    assert.throws(() => rename("ds", "kimi", { home }), (err: unknown) => {
      assert.ok(err instanceof ProvidersError);
      assert.equal(err.code, "VALIDATION");
      return true;
    });
    assert.throws(() => rename("ghost", "x", { home }), (err: unknown) => {
      assert.ok(err instanceof ProvidersError);
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove：删文件 + _meta 移除，保留其余条目顺序", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    const b = add(kimi, { home });
    add({ ...deepseek, name: "glm" }, { home });

    remove("kimi", { home });
    assert.equal(existsSync(join(providersDir(home), `${b.id}.json`)), false);
    assert.deepEqual(
      list({ home }).map((e) => e.name),
      ["deepseek", "glm"],
    );
    assert.ok(existsSync(join(providersDir(home), `${a.id}.json`)));

    assert.throws(() => remove("kimi", { home }), ProvidersError);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("remove：被 profile 引用时拒绝并报引用者", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });

    mkdirSync(profilesDir(home), { recursive: true });
    writeFileSync(
      join(profilesDir(home), "_meta.json"),
      JSON.stringify({
        version: 1,
        appliedId: null,
        entries: [{ id: "11111111-1111-4111-8111-111111111111", name: "多供应商主力" }],
      }),
    );
    writeFileSync(
      join(profilesDir(home), "11111111-1111-4111-8111-111111111111.json"),
      JSON.stringify({
        version: 1,
        mode: "advanced",
        port: 8787,
        gatewayToken: "tok",
        gatewayAuthScheme: "bearer",
        inferenceModels: [{ name: "claude-sonnet-main", provider: a.id, upstreamModel: "deepseek-chat" }],
      }),
    );

    assert.throws(
      () => remove("deepseek", { home }),
      (err: unknown) => {
        assert.ok(err instanceof ProvidersError);
        assert.equal(err.code, "REFERENCED");
        assert.deepEqual(err.referencedBy, ["多供应商主力"]);
        assert.match(err.message, /多供应商主力/);
        return true;
      },
    );
    assert.ok(existsSync(join(providersDir(home), `${a.id}.json`)), "拒绝删除时文件必须保留");
    assert.equal(list({ home }).length, 1);

    writeFileSync(
      join(profilesDir(home), "11111111-1111-4111-8111-111111111111.json"),
      JSON.stringify({
        version: 1,
        mode: "advanced",
        port: 8787,
        gatewayToken: "tok",
        gatewayAuthScheme: "bearer",
        inferenceModels: [{ name: "claude-sonnet-main", provider: "99999999-9999-4999-8999-999999999999", upstreamModel: "x" }],
      }),
    );
    remove("deepseek", { home });
    assert.equal(list({ home }).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("_meta 损坏自愈：读时重建，name 以 UUID 占位，之后可改名", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    add(kimi, { home });

    writeFileSync(join(providersDir(home), "_meta.json"), "{not valid json");

    const entries = list({ home });
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.name, e.id, "name 无法恢复时应以 UUID 占位");
    }

    const healed = rename(entries[0]!.id, "deepseek", { home });
    assert.match(healed.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      list({ home }).map((e) => e.name).sort(),
      ["deepseek", entries[1]!.id].sort(),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("metaRebuild：_meta 缺失时从目录重建并落盘", () => {
  const home = makeHome();
  try {
    const a = add(deepseek, { home });
    add(kimi, { home });
    rmSync(join(providersDir(home), "_meta.json"));

    const entries = metaRebuild({ home });
    assert.equal(entries.length, 2);
    assert.ok(entries.some((e) => e.id === a.id));
    assert.ok(existsSync(join(providersDir(home), "_meta.json")), "重建结果应落盘");
    assert.deepEqual(list({ home }), entries);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("空目录：list 返回空数组，不报错", () => {
  const home = makeHome();
  try {
    assert.deepEqual(list({ home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
