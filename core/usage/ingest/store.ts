/**
 * 用量入库的全部 SQL：游标读取、批量插入、来源标记与 revision。
 *
 * 所有函数都不开事务，由 ingest/sync.ts 用 withTransaction 包住一个文件的
 * 提交；调用方保证同一批写入在同一事务内。
 */

import type { Database } from "../../persistence/types.ts";
import type { ParsedLedgerEvent, SourceConfig } from "./types.ts";

export interface FileCursor {
  readonly byteOffset: number;
  readonly fileSize: number;
  readonly tailHash: string | null;
  readonly revision: number;
  readonly day: string;
}

export interface FileState {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly day: string;
  readonly byteOffset: number;
  readonly fileSize: number;
  readonly tailHash: string | null;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface BatchInput {
  readonly sourceId: string;
  readonly sourcePath: string;
  /** 本批对应的文件 revision，写入 usage_event_sources。 */
  readonly revision: number;
  /** 新事件的 created_at（由调用方注入，便于测试固定时间）。 */
  readonly createdAt: string;
  readonly events: readonly ParsedLedgerEvent[];
}

export interface BatchStats {
  readonly eventsAdded: number;
  readonly eventsReused: number;
  readonly mappingsAdded: number;
  readonly metricsWritten: number;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 读取某来源某文件的游标；没有则返回 null。 */
export function getFileCursor(
  db: Database,
  sourceId: string,
  sourcePath: string,
): FileCursor | null {
  const row = db
    .prepare(
      `SELECT byte_offset, file_size, tail_hash, revision, day
       FROM usage_files WHERE source_id = ? AND source_path = ?`,
    )
    .get(sourceId, sourcePath);
  if (row === undefined) return null;
  return {
    byteOffset: numberValue(row.byte_offset),
    fileSize: numberValue(row.file_size),
    tailHash: typeof row.tail_hash === "string" ? row.tail_hash : null,
    revision: numberValue(row.revision),
    day: typeof row.day === "string" ? row.day : "",
  };
}

/**
 * 插入一批事件：事件按 fingerprint 去重，映射与指标按主键幂等。
 * 调用方负责事务；返回本批新增/复用统计。
 */
export function appendBatch(db: Database, input: BatchInput): BatchStats {
  const selectEvent = db.prepare("SELECT id FROM usage_events WHERE fingerprint = ?");
  const insertEvent = db.prepare(
    `INSERT INTO usage_events(fingerprint, day, ts, surface, origin, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMapping = db.prepare(
    `INSERT OR IGNORE INTO usage_event_sources(event_id, source_id, source_path, revision)
     VALUES (?, ?, ?, ?)`,
  );
  const upsertMetric = db.prepare(
    `INSERT INTO usage_model_metrics(
       event_id, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, web_search_requests
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, model) DO UPDATE SET
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       web_search_requests = excluded.web_search_requests`,
  );

  let eventsAdded = 0;
  let eventsReused = 0;
  let mappingsAdded = 0;
  let metricsWritten = 0;

  for (const event of input.events) {
    const existing = selectEvent.get(event.fingerprint);
    let eventId: number;
    if (existing !== undefined) {
      eventId = numberValue(existing.id);
      eventsReused += 1;
    } else {
      const result = insertEvent.run(
        event.fingerprint,
        event.day,
        event.ts,
        event.surface,
        event.origin,
        event.sessionId,
        input.createdAt,
      );
      eventId = numberValue(result.lastInsertRowid);
      eventsAdded += 1;
    }

    const mapping = insertMapping.run(
      eventId,
      input.sourceId,
      input.sourcePath,
      input.revision,
    );
    if (numberValue(mapping.changes) > 0) mappingsAdded += 1;

    for (const metric of event.models) {
      upsertMetric.run(
        eventId,
        metric.model,
        metric.inputTokens,
        metric.outputTokens,
        metric.cacheReadTokens,
        metric.cacheWriteTokens,
        metric.webSearchRequests,
      );
      metricsWritten += 1;
    }
  }

  return { eventsAdded, eventsReused, mappingsAdded, metricsWritten };
}

/** 删除某来源某文件的全部来源映射（文件重写时先调用）。 */
export function deleteSourceMappings(
  db: Database,
  sourceId: string,
  sourcePath: string,
): number {
  const result = db
    .prepare("DELETE FROM usage_event_sources WHERE source_id = ? AND source_path = ?")
    .run(sourceId, sourcePath);
  return numberValue(result.changes);
}

/** 删除没有任何来源映射的孤立事件；指标随外键级联删除。 */
export function deleteOrphanEvents(db: Database): number {
  const result = db
    .prepare(
      `DELETE FROM usage_events
       WHERE NOT EXISTS (
         SELECT 1 FROM usage_event_sources s WHERE s.event_id = usage_events.id
       )`,
    )
    .run();
  return numberValue(result.changes);
}

/** 写入/更新文件游标。 */
export function saveFileState(db: Database, state: FileState): void {
  db.prepare(
    `INSERT INTO usage_files(
       source_id, source_path, day, byte_offset, file_size, tail_hash, revision, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, source_path) DO UPDATE SET
       day = excluded.day,
       byte_offset = excluded.byte_offset,
       file_size = excluded.file_size,
       tail_hash = excluded.tail_hash,
       revision = excluded.revision,
       updated_at = excluded.updated_at`,
  ).run(
    state.sourceId,
    state.sourcePath,
    state.day,
    state.byteOffset,
    state.fileSize,
    state.tailHash,
    state.revision,
    state.updatedAt,
  );
}

/** 读取 app_meta.usage_revision；缺失视为 0。 */
export function getRevision(db: Database): number {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = 'usage_revision'")
    .get();
  return row === undefined ? 0 : numberValue(row.value);
}

/** usage_revision +1 并返回新值。 */
export function bumpRevision(db: Database): number {
  const next = getRevision(db) + 1;
  db.prepare(
    `INSERT INTO app_meta(key, value) VALUES ('usage_revision', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(next));
  return next;
}

/** 写入来源元数据（每次同步刷新 kind/root/enabled）。 */
export function upsertSource(
  db: Database,
  source: SourceConfig,
  resolvedRoot: string,
): void {
  db.prepare(
    `INSERT INTO usage_sources(id, kind, root, enabled, last_scan_at, last_error)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       root = excluded.root,
       enabled = excluded.enabled`,
  ).run(source.id, source.kind, resolvedRoot, source.enabled ? 1 : 0);
}

/** 记录来源最近一次扫描时间与错误。 */
export function markSource(
  db: Database,
  sourceId: string,
  lastScanAt: string,
  lastError: string | null,
): void {
  db.prepare(
    "UPDATE usage_sources SET last_scan_at = ?, last_error = ? WHERE id = ?",
  ).run(lastScanAt, lastError, sourceId);
}
