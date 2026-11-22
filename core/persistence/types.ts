/**
 * 持久化层公共类型：只用结构化的 Database / Statement 接口，
 * 具体实现是 Node 内置 node:sqlite 的 DatabaseSync。
 */

import type { SQLInputValue, SQLOutputValue } from "node:sqlite";

export interface Statement {
  all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[];
  get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  run(...params: SQLInputValue[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

/** 迁移项：version 单调递增，up 在独立事务内执行。 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Database): void;
}
