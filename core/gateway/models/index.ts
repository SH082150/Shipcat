/**
 * models — /v1/models 本地响应：直接用激活 profile 的模型清单包装
 * Anthropic 风格发现信封，不请求任何上游（客户端 3 秒超时，零延迟）。
 */

import type { ModelEntry } from "../../types.ts";

/** 模型发现条目的输入：core/types.ts 的 ModelEntry（假名清单）。 */
export type ModelEntryLike = ModelEntry;

/** description 过长时截断到该长度（字符），防止发现列表臃肿。 */
const DESCRIPTION_MAX_CHARS = 100;

/** 按 sidecar inferenceModels 顺序把假名清单包装成 /v1/models 响应。 */
export function modelsResponse(entries: readonly ModelEntryLike[]): object {
  const data = entries.map((entry) => {
    const label = entry.labelOverride ?? entry.name;
    // description 缺省用假名，不用 labelOverride。
    const description =
      entry.name.length > DESCRIPTION_MAX_CHARS
        ? `${entry.name.slice(0, DESCRIPTION_MAX_CHARS)}…`
        : entry.name;
    const item: Record<string, unknown> = {
      type: "model",
      id: entry.name,
      display_name: label,
      description,
      created_at: "2024-01-01T00:00:00Z",
    };
    if (entry.supports1m === true) item.supports1m = true;
    return item;
  });

  return {
    data,
    has_more: false,
    first_id: entries[0]?.name ?? null,
    last_id: entries[entries.length - 1]?.name ?? null,
  };
}
