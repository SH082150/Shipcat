# Shipcat 用量文件库（自建，无 SQLite）

> 本文件描述当前实现。设计细节见
> [new-usage-docs/usage-format-layer1.md](../new-usage-docs/usage-format-layer1.md)
> 与 [new-usage-docs/usage-format-layer2.md](../new-usage-docs/usage-format-layer2.md)。

## 数据源

只读 Claude-3p Desktop 的官方用量账本：

```text
# macOS
~/Library/Application Support/Claude-3p/local-agent-mode-sessions/<account>/<sub>/usage-ledger/<本地日期>.ndjson
```

- 一行是一个**事件**（通常是一个 turn 的汇总，不是一次 API 调用）；
- 只处理 `v === 1` 的行，其余跳过并告警；
- 只使用 `ts / surface / models.* / tools / cost.usd`；
  `origin`、`sessionId`、`isError`、工具名都不落盘；
- 单账号：取设置里第一个启用的用量来源，不合并多账号；
- 不读会话明细、不读 `audit.jsonl`；日志模块独立。

## 本地布局

```text
~/.claudeharbor/usage/
├── config.json              { timezone, syncIntervalMinutes }
├── layer1/
│   ├── 30m/  _meta_.json + 336 个 <bucketStartMs>.ndjson
│   ├── 1h/   _meta_.json + 336 个
│   ├── 1d/   _meta_.json + 336 个
│   ├── tp7d/  _meta_.json + 7 个日文件
│   ├── tp30d/ _meta_.json + 30 个日文件
│   └── tp90d/ _meta_.json + 90 个日文件
└── layer2/
    ├── 30m/cells.json
    ├── 1h/cells.json
    └── 1d/cells.json
```

- 30m / 1h 覆盖 7 / 14 天，1d 覆盖 336 天；全部按 `config.timezone` 的本地墙钟切桶；
- 文件名是桶起点的 epoch 毫秒；1d 是本地日零点，DST 日可能是 23/25 小时；
- cell 文件只有 7 个汇总字段：input / output / cacheRead / cacheWrite /
  webSearchRequests / cost / toolCalls；
- `_meta_.json` 只做游标：`{ v, ts, hash }`，`hash = sha256(utf8(rawLine.trim()))`；
- `_syncing_` 残留或 meta 不完整 → 整库重建 336 格。

## 同步

- 常驻 `UsageClock` 每秒查询系统时钟；跨过 `syncIntervalMinutes`（1/5/10/15/30）
  的对齐边界时触发一轮，休眠唤醒后只触发一次；
- 同一时刻只跑一轮；时钟触发距上一轮结束不足 15 秒则跳过；
- 不补跑、不重试；手动同步是唯一补救；
- 每轮都按当前时间滚窗口：补零新桶、删除窗口外旧桶；`meta.ts/hash` 只随新事件前进；
- 同 `ts` 的行用行 hash 判断迟到行，避免重复计数。

## Layer 2 与 UI

- 每轮 Layer 1 成功后重建三个 `cells.json`：
  `lastSyncAt / lastSyncDisplay / total / ts[336] / display[336] / level[336]`，
  索引 0 = 最新；
- 悬停卡片不复制数据：`ts[i]` 回 Layer 1 读单个 cell；
- UI 只读结果，不做范围查询或聚合；
- “调用次数”现在显示为**工具调用次数**（账本 `tools` 计数合计）。

## 已退役

- `~/.claudeharbor/usage/ledger` 镜像与 `_meta.json` 不再更新；
- SQLite `usage_events / usage_model_metrics / usage_files` 不再写入，
  旧表留在数据库中不删除；
- 旧 IPC `usage.sync / aggregate / buckets / audit` 已移除。
