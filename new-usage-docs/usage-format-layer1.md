# Usage Layer 1 格式（v1 讨论稿）

> 记录日期：2026-11-24  
> 状态：讨论稿，未实现。  
> 范围：只读 Claude-3p 官方 `usage-ledger`；日志模块独立。  
> 已定架构：3 个数据库（30m / 1h / 1d），每个库 336 个文件，一个小格一个文件，只存总和，每个库一个 `{ v, ts }` 指针，时间戳用 UTC epoch，桶边界按 `config.timezone` 本地时区，单账号。

## 1. 术语

### 1.1 事件与 `ts`

官方 NDJSON 的一行是一个**事件**（通常是一个 turn 的汇总，不是一次 API 调用）。

- `ts`：该事件的结束时间，UTC epoch 毫秒。
- `ts` 是事件的真实时间，不是文件名，也不是桶的起点。
- 一行里可以有多个模型；本模块把所有模型加在一起。

### 1.2 桶与小格（cell）

- **桶（bucket）**：30m / 1h 是固定长度；1d 是本地日历日，DST 可能是 23/25 小时。
- **桶起点**：按根目录 `config.timezone` 的本地时区计算；不是 UTC floor。
- **小格（cell）**：一个桶对应一个文件。文件里是该桶内所有事件的合计。
- **文件名**：桶起点的 epoch 毫秒（`<bucketStart>.ndjson`），不是事件 `ts`。

例子（`config.timezone = Asia/Shanghai`）：一个事件的 `ts` 是 `1795517232000`（`2026-11-24T18:47:12+08:00`）。

| 概念 | 值 |
|---|---|
| 事件 `ts` | `1795517232000`（`2026-11-24T18:47:12+08:00`） |
| 30m 桶起点 | `1795516200000`（`2026-11-24T18:30:00+08:00`） |
| 30m 文件名 | `1795516200000.ndjson` |
| 1h 桶起点 | `1795514400000`（`2026-11-24T18:00:00+08:00`） |
| 1h 文件名 | `1795514400000.ndjson` |
| 1d 桶起点 | `1795449600000`（`2026-11-24T00:00:00+08:00`） |
| 1d 文件名 | `1795449600000.ndjson` |

所以：

- 事件 `1795517232000`（`2026-11-24T18:47:12+08:00`）属于 30m 的 `1795516200000`（`2026-11-24T18:30:00+08:00`）小格；文件名不是事件 `ts` 本身。
- `cell` 不是一条日志，是一个时间桶里的总和。
- UI 的一个格子 = 一个文件 = 一个 cell。

### 1.3 `_meta_`

```json
{
  "v": 1,
  "ts": 1795517232000,
  "hash": "9f2c..."
}
```

- `v`：官方 `usage-ledger` 格式版本，和官方同步；当前是 `1`。
- `ts`：最后一次读取到的事件 `ts`，UTC epoch 毫秒，原样存数字。
- `hash`：最后处理行的 `sha256(utf8(rawLine.trim()))` 十六进制串（64 位）；没有事件时为 `""`。
- `ts` 不是桶起点，也不是文件名；它是最后处理过的最新一条事件的真实时间。
- meta 只做指针，不存 token / cost / toolCalls。
- `v` 只跟官方走；`hash` / `toolCalls` 是数据库字段，不用 `v` 表示它们的版本。数据库自身格式如何版本化见 §7.11（当前不加 `schema`）。

## 2. 官方数据源

### 2.1 路径

```text
<Claude-3p>/local-agent-mode-sessions/<账号>/<子层>/usage-ledger/<本地日期>.ndjson
```

- 单账号场景：只读取存在 `usage-ledger` 的那个 `<账号>/<子层>`。
- 不把账号作为统计维度，不合并多账号。
- `plugin-cache`、`skills-plugin` 不是账号目录。
- 当前机器上 `54cd5b41/00000000` 有账本；`54cd5b41-d8aa-.../00000000-...001` 没有账本。

### 2.2 文件名与时间

官方文件名是**写入时本机时区的本地日**，不是 UTC 日。

本模块**不看官方文件名**，只用每行的 `ts`：

- 读取文件时可以按文件名找候选文件，但归桶只按 `ts`。
- 一个本地桶可能来自两个官方本地日文件。
- `meta.ts` 是 UTC epoch；桶边界按根目录 `config.timezone` 的本地时区；cell 文件名是本地桶起点的 epoch 毫秒。

### 2.3 一行是什么

每行一个 JSON 对象，UTF-8，`\n` 分隔；没有数组括号、逗号、表头。

一行是一个事件 / 一个 turn 的汇总，`models` 可以包含多个模型。读取时：

- 跳过空行；
- 逐行检查 `v === 1`；不是 `1` 的行跳过并记录告警，不按未知版本猜字段；
- 跳过解析失败的行；
- 文件正在追加时，最后一行可能是半行：跳过，不推进 meta。

### 2.4 本模块使用的字段

| 字段 | 用途 |
|---|---|
| `v` | 官方格式版本；读取时要求 `v === 1`，不是 1 的行跳过并告警 |
| `ts` | 事件时间；决定桶和 meta |
| `surface` | 读取时可见，但**不记录**、不分类 |
| `origin` | 读取时可见，但**不记录**、不分类 |
| `models.<id>.inputTokens` | 累加 |
| `models.<id>.outputTokens` | 累加 |
| `models.<id>.cacheReadTokens` | 累加 |
| `models.<id>.cacheWriteTokens` | 累加（只存总量） |
| `models.<id>.webSearchRequests` | 累加 |
| `models.<id>.cost.usd` | 累加；缺失按 0 |
| `tools` | 只累加所有工具计数；不保留工具名 |

不使用的字段：

- `sessionId`：不记录。
- `isError`：不记录；错误行仍然计入总量。
- `models.<id>.cacheWrite5mTokens` / `cacheWrite1hTokens`：不记录，只存 `cacheWriteTokens` 总量。
- `cost.basis`：不记录；只加 `cost.usd`。

### 2.5 源数据特征

- `origin` 不只有 `turn`：还有 `connection_probe`、`title`、`preview_agent_detection`。本模块全部计入，不按 origin 过滤。
- `surface` 有 `code` / `cowork` / `chat`。本模块全部合并，不按 surface 分类。
- 模型名不是固定枚举，包含别名/变体；按字符串处理，不做白名单。
- `cost` 是可选的；缺失按 0。
- `tools` 是行级字段，不是模型级；只累加次数，不保留工具名。
- 当前约 1,900 行里 `ts` 没有重复，文件内 `ts` 递增；这是当前观察，不是永久保证。
- 官方文件是活的；最后一行可能半行。

## 3. 数据库布局

### 3.1 三个库

```text
<usage-root>/
├── config.json              ← 全局配置（时区等）
├── layer1/
│   ├── 30m/
│   │   ├── _meta_.json
│   │   ├── 1795516200000.ndjson
│   │   └── ... 共 336 个 cell 文件
│   ├── 1h/
│   │   ├── _meta_.json
│   │   ├── 1795514400000.ndjson
│   │   └── ... 共 336 个 cell 文件
│   ├── 1d/
│   │   ├── _meta_.json
│   │   ├── 1795449600000.ndjson
│   │   └── ... 共 336 个 cell 文件
│   ├── tp7d/         ← UI 按天统计（7 天，按 surface 分面），结构见 §3.5
│   ├── tp30d/        ← UI 按天统计（30 天，按 surface 分面），结构见 §3.5
│   └── tp90d/        ← UI 按天统计（90 天，按 surface 分面），结构见 §3.5
└── layer2/
    ├── 30m/                 ← 镜像 layer1/30m
    ├── 1h/                  ← 镜像 layer1/1h
    └── 1d/                  ← 镜像 layer1/1d
```

- `30m` / `1h` / `1d` 都按根目录 `config.json` 的 `timezone` 本地时区切桶。
- 每个库固定 336 个 cell 文件（不含 `_meta_` / `_syncing_`），但时间跨度不同：

| 库 | 336 个 cell 覆盖 |
|---|---|
| 30m | 336 × 30m = 7 天 |
| 1h | 336 × 1h = 14 天 |
| 1d | 336 × 1d = 336 天 |

`tpd` 是 tokens per day，负责 UI 下面的按天统计，按 `chat` / `cowork` / `code` 分面。它分成三个范围文件夹：`tp7d` / `tp30d` / `tp90d`，结构见 §3.5。

注意：30m / 1h / 1d 的 cell 没有 `surface` 字段，`tpd` 不能直接从这些 cell 得出；需要从官方日志聚合，或在 Layer 1 另存 surface 子总计。

同步/重建期间还会出现 `_syncing_` 标记；它不是 cell，也不参与 UI 统计。

UI 的“近七天”对应 30m 热力图；1h / 1d 的标签按各自跨度显示。如果 UI 要求三个库都只覆盖七天，文件数要分别改成 336 / 168 / 7，而不是都叫 336。

### 3.2 文件名

| 库 | 格式 | 例子 |
|---|---|---|
| 30m | `<bucketStartMs>.ndjson` | `1795516200000.ndjson` |
| 1h | `<bucketStartMs>.ndjson` | `1795514400000.ndjson` |
| 1d | `<bucketStartMs>.ndjson` | `1795449600000.ndjson` |

- 文件名只由事件 `ts` 推导：`bucketStart = localBucketStart(ts, interval, config.timezone)`，文件名就是 `bucketStart` 的十进制 epoch 毫秒。
- 不格式化成日期字符串；示例里的数字对应 `config.timezone` 的本地桶起点。
- 按数值排序，不要按日期字符串解析。
- 文件名是**桶起点**，不是事件 `ts` 本身。
- 当前桶（30m/1h/1d）都是部分数据，后续同步会继续加。

### 3.3 一个小格文件的字段

```json
{
  "inputTokens": 0,
  "outputTokens": 0,
  "cacheReadTokens": 0,
  "cacheWriteTokens": 0,
  "webSearchRequests": 0,
  "cost": 0,
  "toolCalls": 0
}
```

- `cost`：官方 `cost.usd` 的合计，数值；缺失按 0。建议用整数微美元（`1e-6 USD`）累加，输出时再转小数。
- `toolCalls`：所有 `tools` 值的总和（工具调用次数），不是使用工具的行数；缺失按 0。
- 不保存 `v`、`ts`：时间由文件名表达。
- 不保存 `sessionId`、`isError`。
- 不保存 `surface`、`origin`、`models`：三端、所有 origin、所有模型合并成一个总和。
- 不保存具体工具名，只保存 `toolCalls` 总数。
- 文件格式：NDJSON，一行一个 JSON 对象，UTF-8，行尾换行，不 pretty-print。

> 这是“只存总和”的口径。`models.<id>`、`surface`、`origin` 只在读取时使用，不进入 cell。

### 3.4 `_meta_`

- 文件名：`_meta_.json`（单对象 JSON）。
- 内容：`{ "v": 1, "ts": <lastEventTs>, "hash": <lastLineHash> }`。
- 只做指针；不存 token / cost / toolCalls。
- `v` 是官方 `usage-ledger` 格式版本，和官方同步；当前是 `1`。
- `ts` 是最后读取到的事件 `ts`，原样存 epoch 毫秒。
- `hash` 是最后处理行的 `sha256(utf8(rawLine.trim()))` 十六进制串（64 位）；没有事件时为 `""`。

### 3.5 `tpd` 结构

```text
layer1/
├── tp7d/
│   ├── _meta_.json
│   ├── <localDayStartTs>.ndjson   × 7
├── tp30d/
│   ├── _meta_.json
│   ├── <localDayStartTs>.ndjson   × 30
└── tp90d/
    ├── _meta_.json
    ├── <localDayStartTs>.ndjson   × 90
```

每个日文件：

```json
{
  "chat": 0,
  "cowork": 0,
  "code": 0
}
```

- 三个值都是**输入 + 输出 Token** 的合计，按 surface 分开；不含缓存读写。
- 不保存 `v`、`ts`：时间由文件名表达。
- 文件名是本地日零点的 `ts`，例如 `1795449600000.ndjson`。
- 每个范围文件夹各有一个 `_meta_.json`，内容和 §3.4 相同：`{ v, ts, hash }`。
- 读取官方日志时检查 `v === 1`。
- 数据来源是官方日志；30m/1h/1d 的 cell 没有 `surface`，不能直接从这些 cell 得出。
- 没有数据的日子写零值文件，保证 7 / 30 / 90 个点完整。
- 只保留对应范围的最近 7 / 30 / 90 天。
- 当前本地日文件是部分数据，后续同步继续加。
- `config.timezone` 变化时，`tp7d` / `tp30d` / `tp90d` 全部重建。
- 同步/重建期间同样使用 `_syncing_` 标记。

## 4. 初始化 / 重建

### 4.1 原则

- 初始化 = 用户不要旧数据；直接删除该库目录内所有文件（包括 `_meta_`）。
- 不做补丁、不做差量、不读旧 meta。
- 重建流程不参与 meta，最后才写 meta。
- 重建固定 336 个桶。
- 初始化期间 UI 应暂停读取该库或显示加载；重建不是原子切换。
- `config.timezone` 变化时，`30m` / `1h` / `1d` / `tp7d` / `tp30d` / `tp90d` 全部重建。

### 4.2 步骤

以 30m、当前 `1795517280000`（`2026-11-24T18:48:00+08:00`）为例：

1. 删除该库目录内所有文件（包括 `_meta_` 和旧 `_syncing_`）。
2. 写 `_syncing_` 标记。
3. 读取根目录 `config.timezone`，取系统当前时间，按本地时区计算。
4. 当前桶起点 = `localBucketStart(now, 30m, config.timezone)` = `1795516200000`（`2026-11-24T18:30:00+08:00`）。
5. 循环 `i = 0..335`：
   - 桶起点 = `1795516200000 - i × 1_800_000`（即本地 18:30 往前 i × 30m）；
   - 创建该桶的零值 cell 文件；
   - 文件名用桶起点的 epoch 毫秒：`${bucketStart}.ndjson`。
6. 从最新官方日志开始，按 `ts` 从新到旧读：
   - 只处理 `v === 1` 的行；不是 `1` 的行跳过并告警；
   - 按本地时区计算事件所属桶；
   - 如果桶早于最老的 336 桶：停止；
   - 如果桶晚于最新的 336 桶（未来时间）：跳过；
   - 否则把事件加进对应 cell。
7. 全部读完后，写 `_meta_`：
   - `v = 1`；
   - `ts = 本轮读到的第一个事件 ts`（倒序读取的第一条，即最新事件）；
   - `hash = sha256(utf8(rawLine.trim()))` 的十六进制串；
   - 如果没有事件，`ts = 0`、`hash = ""`。
8. 删除 `_syncing_`。
9. 初始化完成。中途崩溃时 `_meta_` 不存在或 `_syncing_` 仍在，下次启动视为未完成，删除该库并重新重建。

关键点：

- 桶按**时间轴**创建，不按“读到某条日志”创建；没有事件的桶也有零值文件。
- 文件名用桶起点的 epoch 毫秒，不用事件 `ts` 本身。
- 读日志只用来填桶，不用来决定建哪些桶。
- 官方历史不足 336 个桶时，剩余桶保持零值。
- 如果第一个事件在窗口外（未来），跳过，继续找窗口内最新的；`meta.ts` 记录窗口内最新事件。

## 5. 增量同步

### 5.1 读取

1. 从最新官方文件开始，按 `ts` 从新到旧读；文件内部 `ts` 递增，可以从底部往上读，或全读后按 `ts` 降序排。
2. 跳过最后一行半行；不要推进 meta 到它。
3. 停止条件：
   - `ts < meta.ts`：停止。
   - `ts == meta.ts`：比较该行 raw-line sha256 与 `meta.hash`；相同则停止，不同则处理（同 ts 的迟到行）。
   - `ts < 当前窗口最老桶起点`：应用关闭很久时，不处理窗口外的旧日志。
4. 只处理 `v === 1`、`ts > meta.ts`，或 `ts == meta.ts && hash != meta.hash`，且在 336 窗口内的行。
5. 如果 `meta.ts` 在更早的官方文件里，继续读前一个官方文件，直到遇到停止条件。
6. 如果整轮没有 `v === 1` 的行，同步结果带告警，不能静默为空。

### 5.2 写入

对每条要处理的事件：

1. 计算桶起点：`localBucketStart(ts, interval, config.timezone)`。
2. 计算文件名：`${bucketStart}.ndjson`。
3. 如果文件不存在，先创建零值文件。
4. 把该行的所有模型相加到 cell：
   - `inputTokens += ...`
   - `outputTokens += ...`
   - `cacheReadTokens += ...`
   - `cacheWriteTokens += ...`
   - `webSearchRequests += ...`
   - `cost += (cost.usd ?? 0)`
   - `toolCalls += sum(Object.values(tools ?? {}))`
5. 同一桶的多条新行可以批量相加，最后只写一次文件。
6. 如果 `meta.ts` 和新数据之间跨过空桶，补零值文件，保持 336 格连续。
7. 全部写完后，`meta.ts = 本轮处理过的最新一条事件 ts`，`meta.hash = sha256(utf8(rawLine.trim()))`（倒序读取的第一条，不是同 ts 的最后一条）。
8. 没有新事件时，不改 meta。

### 5.3 同 `ts` 的处理

- 读取从新到旧：`ts > meta.ts` 的行处理；`ts < meta.ts` 停止。
- `ts == meta.ts` 时比较 raw-line hash：相同就停，不同就处理。这样同 ts 的迟到行也能补上。
- 一个 `ts` 的所有行处理完后，`meta.ts` 记这个 ts，`meta.hash` 记**倒序读取的第一条**（最新那条）的 hash，不是同 ts 的最后一条；否则下一轮会把同 ts 的新行重复加。
- 如果官方改写/重排了同一行，hash 会变，可能重复计数；这种情况走整库重建。

### 5.4 保留与裁剪

- 每次初始化/同步后，只保留最近 336 个桶的 cell 文件。
- 更老的 cell 删除。
- 不删 `_meta_`；`_syncing_` 由同步/重建流程管理，不要当 cell 删除。
- 应用关闭很久后补读时，只处理当前 336 窗口内的日志；窗口外的旧数据不补。

### 5.5 写入方式

- 同步开始先写 `_syncing_` 标记（同目录，临时文件 + rename）。
- 每个 cell 用同目录临时文件 + rename，保证 UI 不会读到半份。
- 全部 cell 写完后写 `_meta_`。
- 最后删除 `_syncing_`。
- `_syncing_` 内容示例：`{ "startedAt": <UTC ms>, "phase": "sync" | "rebuild" }`。
- 启动/同步前看到 `_syncing_` 或没有 `_meta_`：删除该库全部文件，按 §4 整库重建 336。
- `_meta_` 缺 `hash`，或 `v` 不是当前支持的官方版本（当前 `1`）：同样视为未完成，整库重建。
- 同一库同时只允许一个同步；单进程启动时看到 `_syncing_` 视为上次残留，直接重建。
- 同步期间 UI 可能读到部分新/旧 cell；需要一致结果时以 meta 完成为准。
- 不要让 UI 直接读 renderer 文件系统；由主进程读、IPC 返回。

## 6. 已定口径

- 时间：`ts` 仍是 UTC epoch；桶边界按根目录 `config.timezone` 的本地时区；UI 不再转换桶。
- 时区变化：`layer1` 的 `30m` / `1h` / `1d` / `tp7d` / `tp30d` / `tp90d` 全部重建，Layer 2 全部重建。
- 桶数量：每个库固定 336 个 cell 文件（不含 `_meta_` / `_syncing_`）。
- 官方版本：只处理 `v === 1` 的行；不是 1 的行跳过并告警。
- 统计范围：所有 `origin`、所有 `surface`、所有模型全部相加。
- 不记录：`sessionId`、`isError`、`surface`、`origin`、`models`、具体工具名、`cost.basis`、`cacheWrite5mTokens`、`cacheWrite1hTokens`。
- 账号：单账号；不合并多账号。
- 缓存：只存 `cacheWriteTokens` 总量；TTL / 5m / 1h 不影响统计。
- cost：保留，按 `cost.usd` 合计；缺失按 0。
- tools：只存 `toolCalls` 总数，不存工具名。
- meta：只存 `{ "v": 1, "ts": ..., "hash": ... }`；`v` 是官方版本。
- 文件名：桶起点的 epoch 毫秒（`<bucketStart>.ndjson`），不是事件 `ts`。
- 同步崩溃：整库重建（`_syncing_` 标记 + 删除全部文件 + 336 重建）。

## 7. 审计点与默认值

第 1、11 条已定；其余按下面的默认值写。

1. **同步中途崩溃 → 整库重建（已定）**  
   `cell` 和 `meta` 不是一次原子写。为避免重复计数，采用整库重建：
   - 同步开始写 `_syncing_` 标记；全部 cell 和 meta 写完后删除。
   - 启动或下次同步前，如果 `_syncing_` 仍在，或 `_meta_` 不存在、缺 `hash`、`v` 不是当前支持的官方版本：删除该库全部文件，按 §4 重建 336。
   - 不尝试只重算受影响桶，也不接受重复计数。
   - 代价：崩溃后该库全量重建；个人使用数据量下可接受。

2. **初始化没有事件时 meta 的值**  
   默认 `ts = 0`、`hash = ""`。下一轮同步会从所有日志里读，并按 336 窗口截断。

3. **未来时间 / 时钟回拨**  
   事件 `ts` 晚于当前窗口时默认跳过，不推进 meta；等系统时间追上后再处理。

4. **同步空桶**  
   默认补零值文件，保持 336 格连续；如果 UI 允许缺文件当 0，也可以不补，但文件数会不齐。

5. **同步裁剪**  
   默认每次同步后删除窗口外旧 cell，保持 336 个文件。

6. **本地时区与 DST**  
   `30m` / `1h` / `1d` 全部按根目录 `config.timezone` 的本地时区切桶；`ts` 仍是 UTC epoch，文件名是本地桶起点的 epoch 毫秒。  
   1d 的本地日可能因 DST 是 23/25 小时，不能固定减 `86_400_000`。  
   `config.timezone` 变化时，`30m` / `1h` / `1d` / `tp7d` / `tp30d` / `tp90d` 全部重建。

7. **单账号的多个账本目录**  
   当前假设只有一个 `usage-ledger`。如果出现多个，本方案未定义；需要时再决定取哪一个或报错。

8. **迟到同 `ts`**  
   已由 `ts + hash` 游标处理：同 ts 但 hash 不同的行会被补上；只有官方改写/重排导致 hash 变化时才可能重复，走整库重建。

9. **文件扩展名 / meta 格式**  
   默认 cell 用 `.ndjson`（一行一个对象），meta 用 `_meta_.json`（单对象）。如果要统一 NDJSON，可改 `_meta_.ndjson`。

10. **官方文件改写**  
    当前假设官方文件只追加。若官方改写历史文件，增量读会漏数据；需要全量重建。

11. **数据库自身格式版本（已定：不加 schema）**  
    - `v` 只跟官方走，不表示 `hash` / `toolCalls` 这类数据库字段的变化。
    - 不添加 `schema` 字段。
    - 数据库字段变化继续用“`_meta_` 缺 `hash` / 缺字段就整库重建”兜底；未来如果还要改 cell 字段，用目录/文件名带版本，或直接整库重建。
    - 当前一次重建/同步只面对一个官方 `v`；版本切换时整库重建，混合版本未定义。

## 8. 缓存说明

官方 API 有 5 分钟和 1 小时两种 prompt cache TTL，响应会拆成 `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`；官方用量里对应 `cacheWrite5mTokens` / `cacheWrite1hTokens`，两者之和是 `cacheWriteTokens`。

本模块只存 `cacheWriteTokens`：

- TTL 只影响缓存写成本和缓存存活时间，不影响总 token 统计；
- 成本已经有 `cost.usd`，不需要按 TTL 重算；
- 不存 5m/1h 拆分。

参考：

- <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- <https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md>

## 9. 旧文档

旧 `docs/usage-format.md` 是“镜像 + SQLite”的旧方案，其中“一行 = 一次 API 调用”也不准确（实际是一行一个事件/turn 汇总）。第一层以本文为准。
