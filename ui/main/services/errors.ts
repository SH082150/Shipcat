import type { AppError, AppResult } from "../../shared/ipc.ts";

export class ServiceError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function ok<T>(value: T): AppResult<T> {
  return { ok: true, value };
}

export function fail(error: unknown): AppResult<never> {
  if (error instanceof ServiceError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    };
  }
  const shaped = error as { code?: unknown; message?: unknown; referencedBy?: unknown; diffs?: unknown };
  const code = typeof shaped?.code === "string" ? shaped.code : "UNKNOWN";
  const message =
    error instanceof Error ? error.message : typeof shaped?.message === "string" ? shaped.message : String(error);
  const details = shaped?.referencedBy ?? shaped?.diffs;
  const result: AppResult<never> = {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return result;
}

export async function run<T>(fn: () => T | Promise<T>): Promise<AppResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

export function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ServiceError("VALIDATION", `${field} 必须是字符串`);
  }
  return value;
}

export function asAppError(error: unknown): AppError {
  const result = fail(error);
  return result.ok ? { code: "UNKNOWN", message: "未知错误" } : result.error;
}
