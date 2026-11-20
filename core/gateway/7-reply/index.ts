/**
 * 7-reply：旅程终点站——把回程的东西交给 Desktop。核心动作是"字节管道"：
 * 上游来一块就转一块，绝不缓冲整个响应（缓冲会让 Desktop 卡死）。对
 * JSON 与 SSE 通用，不判定流式与否、不修改任何字节。
 *
 * Desktop 中途断开（用户按停止）→ 立即 destroy 上游流，避免白烧 token。
 */

import type { ServerResponse } from "node:http";

import type { FilteredResponse } from "../6-route-back/index.ts";

/**
 * 字节管道：写状态码与过滤后的头，上游流逐块 pipe 给 Desktop；
 * Desktop 中途断开 → 掐断上游流；上游流出错 → 响应未发完则断开 Desktop。
 */
export function replyToDesktop(response: FilteredResponse, clientRes: ServerResponse): void {
  clientRes.writeHead(response.status, response.filteredHeaders);
  response.upstreamStream.pipe(clientRes);
  clientRes.on("close", () => {
    // close 在正常发完后也会触发：只有响应未写完（Desktop 中途断开）才掐断。
    if (!clientRes.writableEnded) response.upstreamStream.destroy();
  });
  response.upstreamStream.on("error", () => {
    if (!clientRes.writableEnded) clientRes.destroy();
  });
}
