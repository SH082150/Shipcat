import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claudePaths } from "../core/archive/paths/index.ts";
import { watchClaudeChanges } from "../core/check/index.ts";

function makeHome(withLibrary: boolean): string {
  const home = mkdtempSync(join(tmpdir(), "harbor-watch-"));
  if (withLibrary) mkdirSync(claudePaths(home).configLibrary, { recursive: true });
  return home;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await delay(20);
  }
  return cond();
}

test("watch：目录文件变化合并后回调一次，close 后停止", async () => {
  const home = makeHome(true);
  const dir = claudePaths(home).configLibrary;
  let hits = 0;
  const watcher = watchClaudeChanges({ home, debounceMs: 30 }, () => {
    hits += 1;
  });

  try {
    // 等 fs.watch 就绪，避免第一笔写入被漏掉。
    await delay(150);
    writeFileSync(join(dir, "first.json"), "{}");
    assert.equal(await waitFor(() => hits > 0), true, "应收到变化回调");

    await delay(100);
    const beforeClose = hits;
    watcher.close();
    writeFileSync(join(dir, "second.json"), "{}");
    await delay(300);
    assert.equal(hits, beforeClose, "close 后不应再回调");
  } finally {
    watcher.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("watch：目录不存在时静默降级，close 安全", () => {
  const home = makeHome(false);
  try {
    const watcher = watchClaudeChanges({ home, debounceMs: 10 }, () => {
      throw new Error("目录不存在时不应回调");
    });
    watcher.close();
    watcher.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
