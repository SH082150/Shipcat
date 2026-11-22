/**
 * 001：迁移版本表与应用元数据。
 */

import type { Database, Migration } from "../types.ts";

export const migration: Migration = {
  version: 1,
  name: "initial",
  up(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO app_meta(key, value) VALUES ('usage_revision', '0');
    `);
  },
};
