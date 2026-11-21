/**
 * probe — 连接预热探针：HEAD/GET /api/hello 回 200 空体
 * （官方协议允许拒绝；回 200 是零成本的稳妥）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** 应答 /api/hello 探针：200，空体。 */
export function handleHello(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200);
  res.end();
}
