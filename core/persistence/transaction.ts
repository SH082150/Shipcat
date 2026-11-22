/**
 * 事务与保存点：node:sqlite 是同步 API，这里只包一层可读的错误处理。
 */

import type { Database } from "./types.ts";

/** 在 BEGIN IMMEDIATE 事务内执行；异常时回滚并原样抛出。 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 连接已不可用时回滚也会失败，保留原始异常。
    }
    throw error;
  }
}

const SAVEPOINT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 在命名保存点内执行；名称只允许标识符字符，避免拼接注入。 */
export function withSavepoint<T>(db: Database, name: string, fn: () => T): T {
  if (!SAVEPOINT_NAME.test(name)) {
    throw new TypeError(`Invalid savepoint name: ${name}`);
  }
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
    } catch {
      // 保留原始异常。
    }
    throw error;
  }
}
