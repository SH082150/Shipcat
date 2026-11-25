# Monitor Layer 1 格式（讨论稿）

> 记录日期：2026-11-26  
> 状态：Layer 1、IPC 与 Monitor 页已实现；Layer 2 未实现。  
> 原则：一套简单、可手动重建的逻辑，优先于大量状态判断和补丁。  
> 边界：usage / usage Layer 1 / usage Layer 2 完全不动；Monitor 使用同一个官方 `usage-ledger`，独立游标、独立数据库、独立查询。

## 1. 模块职责

Monitor 当前阶段只做：

1. 通过 fs.watch 实时唤醒，并以 30 秒兜底检查增量读取官方 `usage-ledger`；
2. 把每条官方记录转换为更详细的记录级数据；
3. 写入 Monitor Layer 1；
4. 直接供 UI 做记录、会话、供应商、模型、工具和异常查询。

后续 Layer 2 再从 Layer 1 构建 5h / 7d / 30d 及自定义时段的聚合结果。Layer 2 的窗口、时区和 config 数值语义不在本文定稿。

Monitor 不读取 cowork audit 或 code transcript，因此不获得消息正文、工具参数、具体错误原因、effort、thinking 或进行中的生成状态。

## 2. 官方数据源

唯一来源：

```text
<Claude-3p>/local-agent-mode-sessions/<账号>/<子层>/usage-ledger/<本地日期>.ndjson
```

- 一行官方 NDJSON 是一条用量记录，不等于一次 API 请求。
- 当前为单账号；不合并多账号。
- 只读取 `v === 1` 的记录；其他版本跳过并告警。
- 空行和坏行跳过并告警；尾部半行暂不处理。
- 所有 surface 都进入同一个库：`code` / `cowork` / `chat`。
- 所有 origin 都保留：`turn` / `title` / `connection_probe` / `preview_agent_detection` 及未来新值。
- 官方文件名只用于定位源文件；输出归日只看行内 `ts`。

## 3. 文件结构

```text
<monitor-root>/
├── layer1/
│   ├── _meta_.json              # 唯一游标：{ v, ts, hash, timezone }
│   ├── <localDayStartTs>.ndjson # 一个本地日历日一个文件
│   └── ...
└── layer2/                      # 后续实现
```

Monitor 不再保存自己的时区配置；统一读取 usage 根下的 `config.json`
（`~/.claudeharbor/usage/config.json`）中的 `timezone`。

### 3.1 单库

Layer 1 不按 surface、sessionId、供应商或模型分库。所有记录共用一套读取、写入和查询逻辑，差异通过记录字段表达。

### 3.2 usage 时区与日分片

Monitor 与 usage 共用同一个时区配置（IANA 名称，例如 `Asia/Shanghai`），
不保存固定 UTC 偏移：

```text
timezone = usage config.timezone
record.ts = sourceTs            # 原始 UTC epoch 毫秒
localDayStartTs = localDayStart(sourceTs, timezone)
文件名 = <localDayStartTs>.ndjson
```

- 记录内的 `ts` 始终是官方原始 UTC 时刻；UI/Monitor 查询按 `timezone`
  格式化和分桶。
- 日文件名是本地日历日零点对应的 UTC epoch，因此 UTC+8 的某天文件会是
  前一日 16:00Z（例如 `2026-11-24T16:00:00Z`），这是正常现象。
- 1d 分片与 DST 由 `core/usage/time.ts` 的 `localDayStart` 负责，DST 日
  长度可以是 23 或 25 小时。
- 读取游标时比较官方 `sourceTs` 与 `meta.ts`，两者都是原始 UTC。

时区改变后，既有日文件名失去意义：若 `meta.timezone` 与当前 usage
配置不一致，Monitor 自动清空 Layer 1 并从账本重建（仍按当前档案归类）。
旧格式（v1，`ts` 带固定偏移）也会按同样方式自动重建。

时区改变后由 Monitor 自动重建，不需要用户手动操作。

自定义时间范围查询时，先按同一 offset 计算查询边界和覆盖的日文件，再逐行过滤：

```text
fromTs <= record.ts < toTs
```

没有记录的 config 偏移日不创建文件；缺少某天文件就表示当天没有记录。Monitor Layer 1 不是固定数量的热力图窗口，不补空日文件，也不设置单文件固定行数或字节上限。

### 3.3 游标

`layer1/_meta_.json`：

```json
{
  "v": 2,
  "ts": 1795611377888,
  "hash": "最后处理官方原始行的 sha256",
  "timezone": "Asia/Shanghai",
  "source": "/Users/me/Library/Application Support/Claude-3p/local-agent-mode-sessions"
}
```

- `v` 是 Monitor 自建文件格式版本，当前为 2（ts 为原始 UTC）。
- `ts` 是最后处理官方记录的 UTC 时间，不是输出日文件名。
- `hash = sha256(utf8(rawLine.trim()))`，用于处理同 ts 的边界记录。
- `timezone` 是写入时的 usage 时区；与当前配置不一致时整库重建。
- `source` 是写入时的账本根；来源切换后整库重建，避免沿用旧游标漏读。
- `ts` 取本轮处理过的最大 ts，不是扫描到的第一条。
- Monitor 与 usage 不共用游标。
- 不再保存按源文件拆分的 offset 映射。

## 4. Layer 1 记录格式

一行一个 JSON 对象，NDJSON，UTF-8，行尾换行。

正常可解析档案时：

```json
{
  "v": 2,
  "ts": 1795639377888,
  "surface": "code",
  "origin": "turn",
  "sessionId": "local_a3eade7f-4ea7-4b66-8662-b939f9a64148",
  "isError": false,
  "provider": {
    "<providerUuid>": {
      "<upstreamModel>": {
        "inputTokens": 3502,
        "outputTokens": 1275,
        "cacheReadTokens": 962048,
        "cacheWriteTokens": 0,
        "webSearchRequests": 0
      }
    }
  },
  "tools": {
    "mcp__ccd_turn__update_plan": 1,
    "WebSearch": 4
  }
}
```

### 4.1 根字段

| 字段 | 规则 |
|---|---|
| `v` | Monitor 记录格式版本，当前为 2 |
| `ts` | 官方原始 UTC ts；展示时按 usage 配置的时区格式化 |
| `surface` | 官方 surface，原样保留 |
| `origin` | 官方 origin，原样保留，不做固定枚举 |
| `sessionId` | 官方会话 ID；缺失为 `null` |
| `isError` | 官方最终异常/中断标记；错误记录仍计入用量 |
| `provider` | 按供应商 UUID → 上游模型组织的 token 用量 |
| `tools` | 完整工具名 → 调用次数；没有工具时为空对象 |

### 4.2 Token 字段

每个上游模型保留：

```text
inputTokens
outputTokens
cacheReadTokens
cacheWriteTokens
webSearchRequests
```

不保存：

- 官方 `cost.usd` / `cost.basis`；
- `cacheWrite5mTokens` / `cacheWrite1hTokens`。

总处理 Token 的派生公式：

```text
inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
```

后续费用由用户按档案和模型配置单价，不由官方 cost 得出。没有配置单价的模型显示“未配置”，不按免费处理。

### 4.3 供应商与上游模型映射

处理正常新记录时：

1. 确认 Claude 客户端当前状态和 `appliedId`；
2. 用相同 UUID 找到 Shipcat sidecar：`profiles/<appliedId>.json`；
3. 遍历官方 `models`；
4. 用官方模型键匹配 `inferenceModels[].name`；
5. 读取该条目的 `provider` 和 `upstreamModel`；
6. 把该模型的 token 写到 `provider.<providerUuid>.<upstreamModel>`。

档案规则：

- 当前 Claude 客户端进程内使用的档案固定，下一次客户端启动才可能更换；
- 客户端是否运行由 Monitor 调用方注入；核心不自行猜测进程状态；
- 每轮同步只读取一次当前 appliedId 和 sidecar，本批次共用该映射；
- 高级档案：使用条目中的 `provider + upstreamModel`；
- 标准档案：使用 `provider`，上游模型为 `name`；
- 只读镜像或缺字段：无法解析，走 unknown。

如果同一记录中的多个官方模型映射到同一个 `providerUuid + upstreamModel`，对应 token 应相加，不能后写覆盖先写。

### 4.4 unknown

以下情况统一写入：

```text
provider.unknown.unknown
```

- 手动重建覆盖的历史记录；
- 客户端未运行，无法确认当时档案；
- appliedId 或 sidecar 不存在；
- 官方模型在档案中找不到；
- 档案为只读或缺少映射字段。

写入 unknown 前，将该记录内所有官方模型的各项 token 分别相加。例如：

```json
"provider": {
  "unknown": {
    "unknown": {
      "inputTokens": 5488,
      "outputTokens": 1537,
      "cacheReadTokens": 1275904,
      "cacheWriteTokens": 0,
      "webSearchRequests": 0
    }
  }
}
```

unknown 不保留官方模型名，不猜测供应商或上游模型。用量必须保留，不能因为无法归属而删除记录。

### 4.5 工具

`tools` 始终留在记录根部：

```json
"tools": {
  "Bash": 14,
  "Read": 5,
  "Edit": 5
}
```

官方账本没有提供“工具调用属于哪个模型/供应商”的关系，因此多模型记录不能把工具次数强行拆到 provider 下。

`toolCalls` 总数可按 `tools` 各值求和得到；Layer 1 明细仍保留完整工具分布。

## 5. origin 与 isError

### 5.1 origin 中文含义

| 值 | 中文 |
|---|---|
| `turn` | 对话回合 |
| `title` | 标题生成 |
| `connection_probe` | 连接探测 |
| `preview_agent_detection` | 预览代理检测 |

未来出现新 origin 时原样保存，不默认当成 turn。UI 可以按 origin 筛选；总量统计是否包含某类 origin 由查询条件决定。

### 5.2 isError

- `false`：官方最终没有把该记录标为异常；
- `true`：官方最终把该 turn 标为异常或中断；
- 官方未公开完整判定规则，账本不包含错误码或原因；
- 可恢复的 429、单次工具失败或 WebFetch 失败不一定让最终记录为 true；
- true 记录仍可能有大量 token 和工具调用，必须计入用量。

不读完整日志时，UI 只能显示“官方标记异常/中断”，不能进一步断言为 429、499、工具错误或手动中断。

## 6. 日常同步

### 6.1 唤醒与循环

Monitor 循环状态只有：

```text
IDLE        空闲，可以开始同步
SYNCING     正在执行一轮同步
REBUILDING  正在执行用户手动重建
STOPPED     已停止，不再接受唤醒
```

watch 在 Monitor 运行期间持续开启，不在每轮同步前后关闭。所有 watch、30 秒兜底和手动刷新都调用同一个 `requestSync()`；该入口必须在第一次异步等待前完成状态切换。

1. Monitor 主进程监听官方 `usage-ledger` 目录，而不是只监听当前日文件；现有文件 change、新文件 rename/create 都使用同一个唤醒入口。
2. Monitor 启动时直接执行一次普通读取；这只是正常循环的第一轮，不增加数据库初始化流程。
3. fs.watch 只负责通知“可能有变化”，不解析记录、不计算新增数量，也不直接启动并发同步。
4. 当前正在读取时又收到通知，只记录 `pending = true`；本轮结束后发现 pending，就立即再读一轮。
5. 一轮结束且没有 pending 时，循环等待下一次通知，不空转。
6. 每 30 秒额外唤醒同一个循环一次，作为极端漏通知的兜底；它不是第二套同步逻辑。
7. Monitor 停止时关闭 watcher 并结束循环。

### 6.2 读取与写盘

1. 被唤醒后，从最新官方文件、最新记录开始，按官方 ts 从新到旧读取。
2. 跳过尾部半行、空行和坏行；只处理 `v === 1` 的完整记录。
3. 先比较官方原始 `sourceTs` 与 `meta.ts`：
   - `sourceTs > meta.ts`：新记录，直接处理；
   - `sourceTs < meta.ts`：已处理过，跳过但不停止本轮读取（多账本目录或旧日文件的迟到追加可能出现在更旧的 ts 之后）；
   - `sourceTs === meta.ts`：才计算当前原始行 hash；相同则找到游标并停止，不同则处理后继续。
4. 只有同 ts 的游标边界记录，以及本轮第一条成功处理、即将成为新游标的记录需要计算 hash；其余记录不做无意义的 hash 计算。
5. 按当前 appliedId 和 sidecar 做供应商/上游模型映射；无法确认时走 unknown。
6. 记录 `ts` 保留官方原始 UTC；按 usage 时区的 `localDayStart(sourceTs)` 写入对应本地日文件。
7. 文件写入顺序沿用 usage：有更新的日文件使用同目录临时文件 + rename；新记录写在已有内容前面，保持日文件内新到旧；全部日文件成功后才最后更新 `_meta_.ts/hash`。
8. 新游标是本轮第一条成功处理的完整 v=1 官方记录的原始 ts + hash；没有新记录时游标不变。
9. 坏行、尾部半行或暂时读取失败只告警并等待下一次唤醒，不自动重建。

如果在记录文件写入后、游标推进前发生崩溃，下一轮可能再次处理相同官方记录。当前方案不增加记录级 hash、自动去重或自动恢复；用户发现异常后手动全量重建。

watch 和 30 秒兜底只降低 Monitor 的发现延迟。官方 turn 写入账本之前，Monitor 不会提前获得该记录。

## 7. 手动全量重建

### 7.1 触发

- 只由用户手动触发；程序不主动判断数据库状态，也不因错误自动重建。
- 重建期间禁止正常同步；同一进程内用互斥状态保证这一点。
- UI 必须提示：重建范围内的历史供应商和模型分类将归为 unknown。

### 7.2 流程

1. 用户确认重建。
2. 暂停并禁止新的正常同步。
3. 取本轮重建边界的官方 `ts + hash`。
4. 删除并重新生成 Monitor Layer 1。
5. 全量扫描重建边界内的官方记录。
6. 保留 ts、surface、origin、sessionId、isError 和 tools。
7. 每条记录的所有模型 token 合计后写入 `provider.unknown.unknown`；记录 ts 保持官方原始 UTC，日文件按当前 usage 时区重新分片。
8. 完整写入日文件和 `_meta_.ts/hash`。
9. 重建完成后恢复正常同步；边界之后的新记录按当前档案正常映射。

### 7.3 中断

不做自动崩溃检测和半成品恢复。如果重建中途退出，程序不保证自动识别；用户需要再次手动重建。官方源文件始终不被修改。

## 8. Layer 2 预留

Layer 2 后续直接基于 Layer 1 的原始 UTC `ts + provider + upstreamModel + tools` 构建：

- 5h / 7d / 30d 用量；
- 自定义时间范围；
- 按供应商、上游模型、surface、origin、sessionId 和 isError 汇总；
- 工具次数与模型分布；
- 用户单价配置后的费用。

Layer 1 已完成供应商映射，Layer 2 不再用当前配置改写历史归属。手动重建后，Layer 2 必须基于新的 Layer 1 重新生成，不能继续保留旧的供应商聚合结果。

以下事项留待 Layer 2 设计：

- 固定窗口还是滚动窗口；
- 窗口起点与 reset 语义；
- 5h / 7d / 30d 与 usage 时区本地日的边界关系；
- 是否还需要 Monitor 自己的时间参数；
- 记录保留周期与清理策略。

## 9. 不变量

1. usage 及其 Layer 1/2 不被 Monitor 修改。
2. Monitor 只读官方 usage-ledger，不读完整对话日志。
3. 所有合法 v=1、所有 surface、所有 origin 都有记录出口。
4. 每条记录都有 `provider`，无法归属时固定为 `provider.unknown.unknown`。
5. 模型映射失败不丢 token；同一路径的多个模型合并且不覆盖。
6. tools 只保存在记录根部，不虚构模型/供应商工具归属。
7. 游标只属于 Monitor，且统一为 `{ v, ts, hash, timezone, source }`。
8. 同一时间只有一轮同步；手动重建期间完全禁止同步和 watch 唤醒后的读取。
9. watch 通知和 30 秒兜底只负责唤醒；正确性始终由实际文件内容与 ts+hash 游标决定。
10. 任何数据库写入都不修改官方源文件。
11. `_meta_.ts` 与记录 `ts` 始终是官方原始 UTC 时间；日文件与展示按 usage 配置的时区计算。

## 10. 实现与验证

- 核心实现：`core/monitor/`；公共出口为 `core/monitor/index.ts`，并在 `core/index.ts` 汇总导出。
- 核心测试：`test/monitor.test.ts`，全部使用临时目录和虚拟档案。
- 验证覆盖：UTC ts、usage 时区分片、时区变化重建、供应商/上游模型、同上游合并、unknown、同 ts 不同 hash、尾部半行、手动重建、watch/兜底重叠和 watch 自动追加。
- IPC 与 Monitor 页已接入；Layer 2 尚未实现。
