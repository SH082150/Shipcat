/**
 * 迁移运行器：按 version 升序执行未应用的迁移，每个迁移独立事务。
 */

import { withTransaction } from "../transaction.ts";
import type { Database, Migration } from "../types.ts";
import { migration as initial } from "./001-initial.ts";
import { migration as usage } from "./002-usage.ts";

const MIGRATIONS: readonly Migration[] = [initial, usage].sort(
  (a, b) => a.version - b.version,
);

/** 执行全部未应用迁移，返回当前 schema 版本。 */
export function runMigrations(db: Database, now: Date = new Date()): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version))
      .filter((version) => Number.isInteger(version)),
  );

  let current = applied.size === 0 ? 0 : Math.max(...applied);
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    withTransaction(db, () => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
        migration.version,
        now.toISOString(),
      );
    });
    current = migration.version;
  }
  return current;
}
