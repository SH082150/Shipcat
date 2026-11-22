/**
 * 002：用量事件、来源、模型指标与文件游标。
 *
 * 事件按 fingerprint 去重；来源映射保留“哪些文件/来源见过这条事件”，
 * 文件被重写时先删映射再重导，最后清掉没有映射的孤立事件。
 */

import type { Database, Migration } from "../types.ts";

export const migration: Migration = {
  version: 2,
  name: "usage",
  up(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        root TEXT,
        enabled INTEGER NOT NULL,
        last_scan_at TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_files (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        day TEXT NOT NULL,
        byte_offset INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        tail_hash TEXT,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, source_path),
        FOREIGN KEY(source_id) REFERENCES usage_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        day TEXT NOT NULL,
        ts INTEGER NOT NULL,
        surface TEXT NOT NULL,
        origin TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_event_sources (
        event_id INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY(event_id, source_id, source_path),
        FOREIGN KEY(event_id) REFERENCES usage_events(id) ON DELETE CASCADE,
        FOREIGN KEY(source_id) REFERENCES usage_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS usage_model_metrics (
        event_id INTEGER NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        web_search_requests INTEGER NOT NULL,
        PRIMARY KEY(event_id, model),
        FOREIGN KEY(event_id) REFERENCES usage_events(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS usage_events_ts_idx ON usage_events(ts);
      CREATE INDEX IF NOT EXISTS usage_events_day_surface_idx ON usage_events(day, surface);
      CREATE INDEX IF NOT EXISTS usage_events_session_idx ON usage_events(session_id);
      CREATE INDEX IF NOT EXISTS usage_model_metrics_model_idx ON usage_model_metrics(model);
      CREATE INDEX IF NOT EXISTS usage_event_sources_source_idx
        ON usage_event_sources(source_id, source_path);
    `);
  },
};
