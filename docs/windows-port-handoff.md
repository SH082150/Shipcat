# Windows 移植任务说明（ClaudeHarbor v0.1.2）

> 技术栈：TypeScript / Node ≥ 22 / node:test。
> 验收命令：`npm run typecheck`（0 错误）+ `npm test`（全部通过）。

## 1. 背景

ClaudeHarbor 管理 Claude Desktop 的 profile 并通过本地网关路由多供应商模型。目标：**在不改变任何行为的前提下，把平台相关路径收敛为平台分发层，使 core 在 Windows（win32）上可用**。macOS 行为必须 100% 回归不变。

## 2. 约束

- **只做路径/平台抽象，不改业务逻辑**。网关、usage 同步、profile 生命周期、校验逻辑一行不动。
- 现有测试在 macOS 语义下（darwin 默认）必须全绿、语义不变。
- 所有平台差异只允许出现在一个位置（见 §4 的平台层），其余代码禁止出现 `process.platform` 判断和硬编码绝对路径。
- 全部新代码与文档使用中文注释/说明，风格对齐 `core/paths`、`core/usage/paths`、`core/archive/fs` 的既有惯例。
- Windows 路径决策统一记录在 `docs/windows-port.md`。

## 3. 涉及的现有路径（全部位于 macOS，移植目标）

| 用途 | 现位置（macOS） | Windows 目标 |
|---|---|---|
| Claude Desktop 3p 数据根 | `~/Library/Application Support/Claude-3p` | 安装版：`%LOCALAPPDATA%\Claude-3p`；商店版（MSIX）：`%LOCALAPPDATA%\Packages\<Claude 包名>\LocalCache\Roaming\Claude-3p`。两个都要支持，按存在性发现 |
| Claude 经典版根 | `~/Library/Application Support/Claude`（usage 模块明确不扫，仅 profile 相关可能引用） | `%APPDATA%\Claude` / MSIX 同理（如代码里有就一并抽象，没有就跳过） |
| Claude Code 配置根 `~/.claude` | `~/.claude` | `%USERPROFILE%\.claude` |
| ClaudeHarbor 自身数据 `~/.claudeharbor` | `~/.claudeharbor` | `%USERPROFILE%\.claudeharbor`（保持点目录命名，跨平台一致） |
| 官方 usage-ledger | `<3p根>/local-agent-mode-sessions/*/*/usage-ledger/*.ndjson` | 相对结构不变，只换根 |

MSIX 包名未知：发现逻辑扫描 `%LOCALAPPDATA%\Packages` 下名称匹配 `Claude*` 的目录再拼接后半段，找不到就跳过该候选。

## 4. 要求的结构

新建 `core/platform/`（独立文件夹 + index.ts，与其他 core 子模块同构）：

```
core/platform/index.ts
```

导出（命名可按现有代码风格微调，但职责必须单一）：

- `desktopDataRoot(home, platform?)`：返回当前平台 Claude Desktop 数据根；`platform` 可注入（测试用），默认 `process.platform`。
- `localAgentSessionsRoot(home, platform?)`：`<3p根>/local-agent-mode-sessions`，win32 下做多候选发现（`%APPDATA%` 候选 + MSIX 候选），返回第一个存在的；都不存在时返回首选候选路径（让上层保持"目录不存在"既有行为）。
- `claudeCodeRoot(home, platform?)`：`~/.claude` / `%USERPROFILE%\.claude`。
- `harborRoot(home, platform?)`：`~/.claudeharbor` / `%USERPROFILE%\.claudeharbor`。

`core/paths`、`core/usage/paths` 及其他任何硬编码了上述路径的模块统一调用 platform 层。Windows 环境变量读取要可注入（禁止在 platform 层深处直接读 `process.env` 导致测试不可控——通过函数参数传入 env，默认 process.env）。

## 5. 平台差异处理

- **路径拼接**：统一 `path.join`（现有代码已如此，保持）。
- **文件权限**：POSIX 的 mode 600/644 语义在 Windows 无对等物，`core/archive/fs` 的权限参数在 win32 下静默跳过即可（不抛错），加注释说明。
- **路径存在性/可读性**：沿用现有 fs.existsSync 模式。

## 6. 测试要求（新增，node:test，风格对齐 test/ 现有用例）

- platform 层单测：注入 `home` + `platform: "win32"` + 注入 env，验证四个根路径的 darwin/win32 输出；MSIX 发现（构造 Packages 下假包名目录）；候选都不存在时的回退行为。
- 回归保障：现有全部测试在默认 darwin 语义下不改动、全绿。
- 至少一个端到端风格用例：win32 + 临时目录构造 `local-agent-mode-sessions/a1b2c3d4/00000000/usage-ledger/<日期>.ndjson` 假账本，跑 `syncLedger` 成功镜像（证明 usage 链路在 win32 路径下通）。

## 7. 已知坑（逐项检查）

1. `core/usage/paths` 的官方账本根必须经 platform 层解析，不得直接拼接 macOS 的 `Library/Application Support`。
2. MSIX 路径里包名带版本号会变，**禁止**硬编码完整包名。
3. Windows 路径分隔符：全部交给 path.join，禁止字符串拼 `\`。
4. `%APPDATA%` 在测试里通过注入 env 提供，禁止测试读真实环境变量。
5. 与移植无关的代码不在改动范围内。

## 8. 交付物

- `core/platform/` 新模块 + 测试。
- 其他模块改为调用 platform 层后的 diff（应只涉及 import 和路径调用点）。
- `docs/windows-port.md`：记录 Windows 路径发现顺序、MSIX 规则、权限降级行为（供真机验证时对照）。
- `package.json` version → 0.1.2；README 头部平台标注改为 `平台：macOS / Windows`（中文区与英文区），更新日志加 v0.1.2 一条。

## 9. 真机验证清单（在 Windows 真机上执行）

- `node scripts/claudeharbor.ts status` 能扫到 Claude Desktop 3p。
- `usage sync` 能镜像真实账本（核对 ledger 文件非空）。
- `profile list` / `provider add` 正常，`activate` 后 Claude Desktop 能识别。
- 网关起得来且 Claude Desktop 能连。
