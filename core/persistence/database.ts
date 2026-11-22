/**
 * SQLite 开库：定位 ~/.claudeharbor/database/claudeharbor.db，创建目录与文件，
 * 设置 WAL / 外键 / busy_timeout，然后跑迁移。
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyFileMode } from "../archive/fs/index.ts";
import { resolveHome } from "../platform/index.ts";
import type { PlatformOptions } from "../platform/index.ts";
import { databaseFile } from "../settings/paths.ts";
import { runMigrations } from "./migrations/index.ts";
import type { Database } from "./types.ts";

export interface OpenDatabaseOptions {
  /** 用户主目录；缺省 resolveHome()。 */
  readonly home?: string;
  readonly platform?: PlatformOptions;
  /** 直接指定数据库文件（测试用；':' 开头视为内存库）。 */
  readonly file?: string;
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function secureDatabaseFiles(file: string): void {
  if (file === ":memory:" || file.startsWith("file::memory:")) return;
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (existsSync(target)) applyFileMode(target, FILE_MODE);
  }
}

/** 打开（必要时创建）数据库并执行迁移。 */
export function openDatabase(options: OpenDatabaseOptions = {}): Database {
  const file = options.file ?? databaseFile(options.home ?? resolveHome(), options.platform);
  const directory = dirname(file);
  if (file !== ":memory:" && !file.startsWith("file::memory:")) {
    mkdirSync(directory, { recursive: true, mode: DIR_MODE });
    applyFileMode(dirname(directory), DIR_MODE);
    applyFileMode(directory, DIR_MODE);
  }

  const raw = new DatabaseSync(file);
  const db = raw as unknown as Database;
  try {
    raw.exec("PRAGMA foreign_keys = ON;");
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA busy_timeout = 5000;");
    raw.exec("PRAGMA synchronous = NORMAL;");
    runMigrations(db);
    secureDatabaseFiles(file);
  } catch (error) {
    try {
      raw.close();
    } catch {
      // 开库失败时 close 也可能失败，保留原始异常。
    }
    throw error;
  }
  return db;
}
