/**
 * 文件原语：所有档案写的唯一底层。
 *
 * 原子写：完整序列化 → 同目录临时文件 → chmod → rename，目标路径不会
 * 出现半份内容；rename 在 Windows 上遇占用会短暂重试。含密钥文件用
 * SECRET_MODE（600）；Windows 没有 POSIX 权限位，该步骤静默跳过。
 * 本层不认业务，只负责安全地写 JSON。
 */

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { platformOf } from "../../platform/index.ts";

/** 含密钥或透传凭证文件的权限：仅本人可读。 */
export const SECRET_MODE = 0o600;

/** 无密钥文件的权限：所有人可读。 */
export const NORMAL_MODE = 0o644;

/** 是否是 Windows：POSIX 权限与 rename 语义都需要区别对待。 */
function isWindows(): boolean {
  return platformOf() === "win32";
}

/**
 * 设置文件权限。
 * - POSIX：chmod 精确设定位（writeFileSync 的 mode 会被 umask 削减，需兜底）。
 * - Windows：mode 只映射读写位、无 600/644 语义，静默跳过（不抛错）。
 */
export function applyFileMode(path: string, mode: number): void {
  if (isWindows()) return;
  chmodSync(path, mode);
}

/** rename 在 Windows 上可能被安全软件/索引服务短暂占用，做有限重试。 */
function renameWithRetry(from: string, to: string): void {
  const attempts = isWindows() ? 5 : 1;
  for (let i = 0; i < attempts; i += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!retryable || i === attempts - 1) throw err;
      // 同步退避：Windows 上占用通常只有几毫秒；本层对外是同步 API，
      // 用 Atomics.wait 真正睡住线程而不是忙等。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (i + 1));
    }
  }
}

/**
 * 原子写 JSON：序列化 → 同目录临时文件 → chmod(mode) → rename 覆盖目标。
 * 不创建目录结构（调用方保证父目录存在）。
 * 成功返回 void，任何异常上抛（临时文件尽力清理后）。
 */
export function atomicWriteJson(path: string, obj: unknown, mode: number): void {
  const json = JSON.stringify(obj, null, 2) + "\n";
  // 同目录临时文件：rename 原子性只在同一文件系统内成立，绝不能跨目录。
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    writeFileSync(tmp, json, { encoding: "utf8", mode });
    applyFileMode(tmp, mode);
    renameWithRetry(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch (cleanupErr) {
      if ((cleanupErr as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`临时档案清理失败，可能残留敏感数据，请手动检查：${tmp}`);
      }
    }
    throw err;
  }
}

/**
 * 容错读 JSON：文件不存在返回 null；JSON 损坏抛带路径的中文错误，
 * 由调用方决定语义；其余读异常同样上抛。
 */
export function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`档案文件损坏，无法解析 JSON：${path}（${(err as Error).message}）`, {
      cause: err,
    });
  }
}
