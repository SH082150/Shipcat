# Usage Layer 2 数据库结构（讨论稿）

> 记录日期：2026-11-24  
> 状态：结构稿，未实现、未落盘。  
> 本文按你确认的“单库 336 槽位 + 三个平行数组”来写；不额外加卡片数据。

## 1. `usage-root` 布局

```text
<usage-root>/
├── config.json                  ← 全局配置（时区等）
├── layer1/
│   ├── 30m/
│   │   ├── _meta_.json
│   │   ├── <bucketStartMs>.ndjson
│   │   └── ... 共 336 个 cell 文件
│   ├── 1h/
│   │   ├── _meta_.json
│   │   └── ... 共 336 个 cell 文件
│   ├── 1d/
│   │   ├── _meta_.json
│   │   └── ... 共 336 个 cell 文件
│   ├── tp7d/             ← UI 按天统计（7 天，按 surface 分面），结构见 layer1 §3.5
│   ├── tp30d/            ← UI 按天统计（30 天，按 surface 分面），结构见 layer1 §3.5
│   └── tp90d/            ← UI 按天统计（90 天，按 surface 分面），结构见 layer1 §3.5
└── layer2/
    ├── 30m/
    │   └── cells.json
    ├── 1h/
    │   └── cells.json
    └── 1d/
        └── cells.json
```

- `layer2` 镜像 `30m` / `1h` / `1d` 三个文件夹。
- 每个粒度一个 `cells.json`，不是 336 个文件。
- Layer 2 的数据来源是 Layer 1 的查询接口。

## 2. `usage-root/config.json`

```json
{
  "timezone": "Asia/Shanghai"
}
```

- 全局配置，Layer 1 和 Layer 2 都读它。
- `timezone` 用 IANA 时区名。
- Layer 1 用它切 30m / 1h / 1d 的本地桶；Layer 2 用它生成 `display` / `lastSyncDisplay`。
- 时区变化时，**所有 Layer 1 库和 Layer 2 都重建**，不是只改显示。

## 3. `layer2/<粒度>/cells.json`

每个粒度一个文件，336 个槽位：

```json
{
  "lastSyncAt": 1795517232000,
  "lastSyncDisplay": "2026-11-24 18:47:12",
  "total": {
    "inputTokens": 0,
    "outputTokens": 0,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0,
    "toolCalls": 0,
    "webSearchRequests": 0
  },
  "ts": ["336 个数字"],
  "display": ["336 个字符串"],
  "level": ["336 个数字"]
}
```

数组顺序：

```text
index 0   = 最新，左上角
index 335 = 最老，右下角
```

三个数组必须等长、同索引：

- `ts[i]`：第 i 个格子的桶起点 `ts`，和 Layer 1 的 cell 文件名一致。
- `display[i]`：第 i 个格子的显示时间，由 `config.timezone` 转换。
- `level[i]`：第 i 个格子的颜色等级。

## 4. 字段对应

| Layer 2 字段 | UI 里对应什么 |
|---|---|
| `lastSyncAt` | 最后同步时间的原始 `ts` |
| `lastSyncDisplay` | 页面右上角的最后同步时间，程序已格式化 |
| `total` | 鼠标不在格子上时，右侧卡片的总使用量 |
| `display[i]` | 悬停第 i 个格子时，卡片右上角显示的时间 |
| `ts[i]` | 悬停第 i 个格子时，去 Layer 1 找这个 cell |
| `level[i]` | 第 i 个格子的颜色 |

`total` 的子字段：

| `total` 子字段 | 卡片行 |
|---|---|
| `inputTokens` | 输入（未缓存） |
| `outputTokens` | 输出 |
| `cacheReadTokens` | 缓存读 |
| `cacheWriteTokens` | 只参与“实际消耗 Token”合计，不单独显示 |
| `toolCalls` | 工具调用次数 |
| `webSearchRequests` | 网页搜索次数 |

UI 自己算：

```text
实际消耗 = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
缓存命中率 = cacheReadTokens / (cacheReadTokens + inputTokens)
```

## 5. 悬停单个格子

鼠标停在第 i 个格子：

```text
ts[i] → Layer 1 查询接口按 ts 取单个 cell
       → 接口内部读 layer1/<粒度>/<ts[i]>.ndjson
```

读取该 cell，得到这个格子的用量详情，显示到右侧卡片；同时用 `display[i]` 替换卡片右上角的范围文字。

这是“指针”方案：每个格子都有自己的卡片内容，但 Layer 2 不存副本；`ts[i]` 就是这张卡片的指针，悬停时去 Layer 1 取一个文件。30m / 1h / 1d 都适用，因为 Layer 1 的桶全部按本地时区切。

如果某个 `ts[i]` 在 Layer 1 没有对应文件：

- `level[i]` 按空数据处理；
- 悬停时详情按 0 显示；
- 不伪造数据。

## 6. 各字段的生成规则

### `lastSyncAt`

Layer 2 本次构建完成时的系统 `ts`，也就是页面上的最后同步时间：

```text
Date.now()  // UTC epoch 毫秒
```

不用 Layer 1 的 `_meta_.ts`；那个是最后事件时间，长时间不用不会前进。

### `lastSyncDisplay`

由程序在写 `cells.json` 时生成，UI 不再自己转换：

```text
lastSyncDisplay = format(lastSyncAt, config.timezone)  // YYYY-MM-DD HH:mm:ss
```

- 页面右上角目前只显示日期部分（`YYYY-MM-DD`）；需要完整时间时直接用这个字段。
- 时区变化时，所有 Layer 1 库和 Layer 2 全部重建；`lastSyncAt`、`lastSyncDisplay`、`display` 都重新生成。

### `ts`

全部按 `config.timezone` 的本地时区计算：

- 30m / 1h：本地桶起点，按本地时区逐桶递减；`interval` 分别是 `1_800_000` / `3_600_000`。
- 1d：本地日零点，按日历日递减；不能固定减 `86_400_000`，因为 DST 日可能是 23/25 小时。
- `ts[i]` 和 Layer 1 对应粒度的 cell 文件名一致。

### `display`

由 `config.timezone` 生成：

- 30m / 1h：本地时间 `YYYY-MM-DD HH:mm`。
- 1d：本地日期 `YYYY-MM-DD`。

### `level`

沿用当前 UI 的 0–4：

```text
value = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
max = 336 个 cell 的 value 最大值
level = 0，如果 value 为 0 或没有数据
level = min(4, max(1, ceil(value / max * 4)))，否则
```

### `total`

当前粒度 336 个 cell 的合计。Layer 2 构建时顺便算出，UI 默认卡片直接读，不重新扫 336 个文件。

## 7. 构建顺序

```text
ClockService 发指令
→ Layer 1 完成数据记录
→ Layer 2 开始
→ 通过 Layer 1 查询接口读取 336 个 cell
→ 计算 total / level
→ 按 config.timezone 生成 display
→ 生成 lastSyncDisplay
→ 写 layer2/<粒度>/cells.json
```

- 每次 Layer 1 完成后都构建 Layer 2；即使没有新事件，也要更新 `lastSyncAt` 和窗口。
- `cells.json` 用临时文件 + rename 原子替换。

## 8. 1d 按本地日（已定）

Layer 1 和 Layer 2 的 1d 都按 `config.timezone` 的本地日切：

- `ts[i]` = 本地日零点的 epoch 毫秒，按日历日递减。
- `display[i]` = 本地日期 `YYYY-MM-DD`。
- Layer 1 的 `layer1/1d/<ts>.ndjson` 就是本地日文件，Layer 2 的 `ts[i]` 可以直接对应。
- 不能固定减 `86_400_000`，因为 DST 日可能是 23/25 小时。
- 时区变化时，Layer 1 和 Layer 2 的 1d 全部重建。

## 9. `layer1/tp7d`、`tp30d`、`tp90d`

1d 热力图现在直接使用 `layer1/1d` 的本地日文件；`layer1/tpd` 是 UI 下面的按天统计（tokens per day），结构已定在 Layer 1 文档 §3.5：

- 三个范围文件夹：`tp7d` / `tp30d` / `tp90d`。
- 一个本地日一个文件，文件名是 `<localDayStartTs>.ndjson`。
- 每个日文件只有 `chat` / `cowork` / `code` 三个数，值是输入 + 输出 Token，不含缓存读写。
- 每个范围文件夹各一个 `_meta_.json`。
- 数据来源是官方日志，因为 30m/1h/1d 的 cell 没有 `surface`。

还剩一个 Layer 2 问题：Layer 2 是否也镜像 `tpd`，还是 UI 直接读 `layer1/tp7d` / `tp30d` / `tp90d`。
