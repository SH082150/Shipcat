# ClaudeHarbor Usage 账本镜像与聚合查询（v0.1.2）

## 数据源：官方 usage-ledger

数据源是 Claude-3p Desktop 的官方用量账本（Settings → Usage 页面的数据源），
不是会话 jsonl。

```text
# macOS
~/Library/Application Support/Claude-3p/local-agent-mode-sessions/
# Windows（安装版）
%LOCALAPPDATA%\Claude-3p\local-agent-mode-sessions\
# Windows（商店版 MSIX）
%LOCALAPPDATA%\Packages\Claude<随机后缀>\LocalCache\Roaming\Claude-3p\local-agent-mode-sessions\
└── <account-dir>/            ← 可能多个（多账号 = 多来源）
    └── 00000000/
        └── usage-ledger/
            ├── 2026-10-03.ndjson   ← 一天一个文件，平铺，文件名 = 本地日期
            └── 2026-11-18.ndjson   ← 当天文件持续追加（append-only）
```

Windows 的账本根与实际 Claude-3p 数据根一起探测，规则见
[windows-port.md](windows-port.md)。若自动探测失败，可用
`claudeharbor --claude-root <Claude-3p 目录> usage sync` 指定数据根；`--claude-root`
必须指向 `Claude-3p` 目录本身，而不是 `local-agent-mode-sessions`。

- 只支持 3p 客户端，不扫描经典版 `Claude/` 目录；
- 一行 = 一次 API 调用，含 `v / ts / surface / origin / isError / models / tools`；
- `models` 键 = Desktop 内部模型命名（如 `claude-sonnet-9-9`），一行可有多个模型键；
- 记录字段名与官方 1:1，镜像与聚合都不做映射，未知字段忽略。

## 本地布局

```text
<home>/.claudeharbor/usage/
├── _meta.json        ← 同步状态（游标、版本统计、告警）
└── ledger/           ← 镜像账本，按天平铺，与官方同构
    ├── 2026-10-03.ndjson
    └── 2026-11-18.ndjson
```

镜像按字节复制账本内容（不修改、不补全），文件权限 0600，目录 0700。Windows 没有
POSIX 权限位，写入层跳过 `chmod`，实际访问控制由用户目录继承的 NTFS ACL 负责
（见 [windows-port.md](windows-port.md)）。

## `_meta.json`

```json
{
  "schemaVersion": 1,
  "lastSyncAt": "2026-11-18T10:00:00.000Z",
  "sourceRoot": "/Users/<user>/Library/Application Support/Claude-3p/local-agent-mode-sessions",
  "files": {
    "2026-11-18.ndjson": {
      "byteOffset": 183422,
      "size": 183500,
      "mtimeMs": 1763428800000,
      "lastSyncedAt": "2026-11-18T10:00:00.000Z",
      "rewriteCount": 0,
      "source": "a1b2c3d4/00000000/usage-ledger/2026-11-18.ndjson",
      "tailHash": "sha256:..."
    }
  },
  "ledgerVersionsSeen": { "1": 1664 },
  "warnings": []
}
```

`sourceRoot` 记录同步时实际采用的绝对路径：macOS 为
`/Users/<user>/Library/Application Support/Claude-3p/local-agent-mode-sessions`，Windows
安装版为 `C:\Users\<user>\AppData\Local\Claude-3p\local-agent-mode-sessions`，商店版则
位于对应 MSIX 包的 `LocalCache\Roaming` 下。`files[].source` 中的相对路径统一使用正斜杠。

同步语义：

- 无游标 → 整文件复制（只到最后一个完整行，尾部半行不拷）；
- 尾部指纹（游标边界前 4096 字节的 sha256）一致 → 从 `byteOffset` 追加新增字节；
- `size < byteOffset` 或尾部指纹不匹配 → 判定非追加改写，截断镜像整文件重拷，
  `rewriteCount + 1`；
- 同一 day 出现在多个账号来源 → 告警并跳过该天，不覆盖已镜像文件；
- 解析失败的行照样镜像，只告警不中断；
- 含未知 `v`（≠ 1）的行照样镜像，按版本号去重告警一次；
- `_meta.json` 原子写（同目录临时文件 + rename），目标路径不会出现半份内容。

## 聚合查询

```text
aggregateUsage(filter?, { home? }): DayAggregate[]
```

过滤条件（全部可选）：`day`（精确日期）、`from` / `to`（含端点，按记录 `ts` 转
本地日期 YYYY-MM-DD 比较）、`surface`、`origin`（精确匹配）、`model`
（只保留 `models` 含该键的行，且聚合只算该模型）。

聚合维度 = (天 × surface)：

- 一行多模型键全量累加到 `totals`，并分别累加进 `models[模型名]`；
- `calls`：`totals` 计行数，per model 计含该模型的行数；
- `costUsd` 累加 `cost?.usd ?? 0`（Desktop 不认识的模型无 cost 字段，贡献 0）；
- 返回按 day、surface 升序排序。

## 模块

```text
core/usage/
├── types/index.ts    ← 全部类型 + 常量（字段名与官方账本 1:1）
├── paths/index.ts    ← 路径解析 + 官方账本文件枚举
├── sync/index.ts     ← 镜像同步（syncLedger）
├── query/index.ts    ← 聚合查询（aggregateUsage）
└── index.ts          ← 门面：export * as 各子模块
```

CLI：

```text
claudeharbor usage sync
claudeharbor usage query [--day <YYYY-MM-DD>] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
                         [--surface <界面>] [--origin <原因>] [--model <模型名>]
```

两个子命令都把结果以 JSON 打到 stdout。`usage sync` 输出 `SyncResult` 摘要：

```json
{
  "filesScanned": 3,
  "filesNew": 1,
  "filesAppended": 0,
  "filesRewritten": 0,
  "filesSkipped": 2,
  "linesAdded": 42,
  "warnings": ["day 2026-11-18 存在多个来源，已跳过"],
  "unknownVersionsSeen": { "2": 5 },
  "lastSyncAt": "2026-11-18T10:00:00.000Z"
}
```

计数口径：`filesNew` 整文件新拷贝、`filesAppended` 源有新字节的增量追加
（无变化不计）、`filesRewritten` 改写检测触发重拷、`filesSkipped` 多来源
冲突等跳过、`linesAdded` 镜像新增的完整行数、`unknownVersionsSeen` 本轮
未知 v → 行数（按版本去重告警）。

## 边界

- 只覆盖 Claude Desktop（chat / code / cowork），不含 Claude Code CLI；
- 云端 Cowork 任务的用量不写本地账本，镜像同样拿不到；
- 多账号同一天的账本冲突时不猜归属，整天跳过并告警。
