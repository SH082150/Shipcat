# Windows 移植说明（v0.1.2）

本文说明 ClaudeHarborCLI 在 Windows 上的路径发现、数据根判定、写入降级与测试约定。
平台差异全部收敛在 `core/platform/index.ts`，其余模块只使用"根"或"路径表"，
不再自行出现 `process.platform` 判断或 `Library/Application Support` 之类的字面量。

- 适用范围：Claude Desktop 第三方 inference profile（Claude-3p）的 profile 管理与
  Usage 账本镜像；不含 Claude Code CLI 的数据迁移。
- 不适用范围：凭证存储方式（仍通过命令行参数输入）、Windows 服务化、ACL 精细化加固。
- 真机验收状态：路径层与写入层已按下列规则实现并由隔离测试覆盖；真机链路验收项见
  [第 11 节](#11-待真机验证清单)，未逐条打勾前不应宣称 Windows 端到端已验证。

## 1. 路径总表

| 路径 | macOS | Windows |
|---|---|---|
| Harbor 数据根 | `~/.claudeharbor` | `%USERPROFILE%\.claudeharbor` |
| Claude-3p 数据根 | `~/Library/Application Support/Claude-3p` | 安装版 `%LOCALAPPDATA%\Claude-3p`；商店版见第 4 节 |
| Claude `configLibrary` | `<3p根>/configLibrary` | `<3p根>\configLibrary` |
| 官方 usage-ledger 根 | `<3p根>/local-agent-mode-sessions` | `<3p根>\local-agent-mode-sessions` |
| Claude Code 配置根 | `~/.claude` | `%USERPROFILE%\.claude` |

`~` 在 Windows 上由平台层解析为 `USERPROFILE`，不是 Git Bash 的 `HOME`。Harbor 自身的
目录名与层级在两个平台保持一致（`~/.claudeharbor`），便于文档、备份与迁移共用一套说明。

## 2. home 与 AppData 的推导

`resolveHome()` 的优先级：

1. `CLAUDEHARBOR_HOME`（CLI `--home` 会写入该变量）；
2. Windows 取 `USERPROFILE`，macOS / Linux 取 `HOME`；
3. 另一侧环境变量兜底；
4. `os.homedir()`。

Windows 优先 `USERPROFILE` 的原因：Git Bash 常把 `HOME` 改写成 `/c/Users/<name>` 这种
POSIX 写法，直接拼 Windows 路径会得到错误结果。

AppData 的推导分两种情况：

- **注入 home**（CLI `--home`、测试临时目录、将来的 Electron 隔离环境）：
  一律按 `<home>\AppData\Local` 与 `<home>\AppData\Roaming` 推导，**不读真实**
  `LOCALAPPDATA` / `APPDATA`。这是测试隔离的基础。
- **真实主目录**：仅当传入的 home 与 `USERPROFILE` 指向同一目录时，才采用系统的
  `LOCALAPPDATA` / `APPDATA`，因为组策略可能把它们重定向到其它盘。

因此测试若要模拟"系统环境变量重定向"，必须显式注入 `PlatformOptions.env`，而不是
依赖当前进程的真实环境；也不要同时把 `USERPROFILE` 设成临时 home、又留下真实的
`LOCALAPPDATA`，那会让平台层把临时 home 误认为真实主目录。

## 3. Claude-3p 数据根发现顺序

Windows 的候选按以下顺序生成（去重、大小写不敏感）：

| 优先级 | 候选 | 说明 |
|---|---|---|
| 1 | `%LOCALAPPDATA%\Claude-3p` | 安装版（Squirrel/NSIS）的主数据根，真机实测位置 |
| 2 | `%APPDATA%\Claude-3p` | 通常只是壳，见第 5 节 |
| 3 | `%LOCALAPPDATA%\Packages\Claude<...>\LocalCache\Roaming\Claude-3p` | 商店版（MSIX），包名后缀随机 |
| 4 | `%LOCALAPPDATA%\Claude*-3p` | 同级的测试版/重命名安装（如 `Claude-3p-beta`） |

生成候选之后，`desktopDataRoot()` 按"标记目录"择优，而不是先到先得：

1. 若设置了 `CLAUDEHARBOR_CLAUDE_ROOT`，直接返回该值，**不做探测**；
2. 返回第一个含 `configLibrary` 的候选；
3. 否则返回第一个含 `local-agent-mode-sessions` 的候选；
4. 否则返回第一个存在的候选；
5. 都不存在时返回第一个候选，让上层保持"目录不存在"的既有行为。

`localAgentSessionsRoot()`（官方 usage-ledger 根）使用同一组候选，但标记顺序相反：
先找含 `local-agent-mode-sessions` 的候选，再退回 `configLibrary`。这样当引擎数据与
profile 数据落在不同候选（例如安装版与商店版并存）时，两边仍能各自找到真实数据。

诊断命令会列出全部候选、存在状态、关键子目录与最终采用值：

```powershell
node bin/claudeharbor.ts paths
```

输出示例（Windows，含商店版候选时）：

```text
平台：win32
用户主目录：C:\Users\<user>
Claude-3p 数据根候选：
  → C:\Users\<user>\AppData\Local\Claude-3p  [存在（configLibrary、local-agent-mode-sessions）]
    C:\Users\<user>\AppData\Roaming\Claude-3p  [存在（无关键目录）]
    C:\Users\<user>\AppData\Local\Packages\Claude_<包名>\LocalCache\Roaming\Claude-3p  [不存在]
采用：C:\Users\<user>\AppData\Local\Claude-3p
```

`paths` 是只读命令：不创建目录、不改任何档案。

## 4. 安装版与商店版（MSIX）规则

**安装版**：数据根为 `%LOCALAPPDATA%\Claude-3p`。这是本项目在 Windows 上的主位置，
`configLibrary`、`local-agent-mode-sessions` 与 `claude_desktop_config.json` 都在这里。
程序安装目录（如 `%LOCALAPPDATA%\Programs\Claude`）与数据目录是两回事，不要混淆。

**商店版（MSIX）**：数据根位于包的本地缓存内：

```text
%LOCALAPPDATA%\Packages\Claude<随机后缀>\LocalCache\Roaming\Claude-3p
```

包名后缀随版本、重装和不同机器变化（真机示例为 `Claude_<包名>`），**禁止硬编码**。
平台层扫描 `Packages` 下所有 `Claude*` 目录并逐个拼接 `LocalCache\Roaming\Claude-3p`；
不存在的候选自然落选。若机器上同时存在安装版与商店版，按第 3 节的标记择优决定采用值。

注意：MSIX 路径属于包容器的一部分，卸载/重置应用可能清空该目录；升级后若包名变化，
旧候选会消失，新候选会被重新扫描到，不需要改代码。

## 5. `%APPDATA%\Claude-3p` 壳的判定

Windows 上 `%APPDATA%\Claude-3p` 经常被创建，但实测可能只有 `config.json`（语言等壳数据），
没有 `configLibrary`，也没有 `local-agent-mode-sessions`。判定规则：

- 把它作为候选 2 参与打分，但**只有它含真实数据目录时才会赢**；
- 只要安装版候选含 `configLibrary`，壳目录就不会被采用；
- 若两个关键目录都不存在，`paths` 会显示 `[存在（无关键目录）]`，这就是壳的特征。

需要警惕的边界：如果真实数据根完全不存在（例如 Desktop 从未启动过），而壳目录存在，
按"第一个存在的候选"规则仍可能选中壳目录。此时不要直接在其下创建 `configLibrary`，
应先用 `claudeharbor paths` 确认，再用 `--claude-root` 指向正确位置，或先启动一次
Desktop 让真实数据落盘。平台层不会删除、合并或迁移任何目录。

## 6. 手工覆盖：`--claude-root`

自动探测失败、数据根在非默认位置、或需要并行使用多份数据时，用全局选项手工指定：

```powershell
node bin/claudeharbor.ts --claude-root "D:\ClaudeData\Claude-3p" paths
node bin/claudeharbor.ts --claude-root "D:\ClaudeData\Claude-3p" activate MyGateway
```

- 选项只接受在子命令之前，支持 `--claude-root <目录>` 与 `--claude-root=<目录>`；
- 也可以设置环境变量 `CLAUDEHARBOR_CLAUDE_ROOT`，优先级高于所有自动候选；
- 传入值必须是 **`Claude-3p` 目录本身**（其下应有 `configLibrary`），不是
  `...\configLibrary`，也不是 `%LOCALAPPDATA%` 或 `Packages` 的父目录；
- 设置后候选列表只剩这一项，平台层不检查存在性，也不回退到自动探测；
- 它只改变 Harbor 读写的位置，不会移动 Claude Desktop 的数据。Desktop 必须读取同一
  目录，profile 才会真正生效。

`--home` / `CLAUDEHARBOR_HOME` 与它相互独立：前者决定 `~/.claudeharbor` 的位置，后者
决定 Claude 侧数据根。测试可以两者同时注入，指向两个临时目录。

## 7. 权限降级

POSIX 平台把权限位当作安全边界的一部分：供应商文件、所有 sidecar 与生成的
Claude profile 使用 `0600`，普通索引使用 `0644`，Usage 镜像目录
请求 `0700`。Windows 没有与 `0600` 等价的 `mode` 语义：

- `applyFileMode()` 在 Windows 上**静默跳过** `chmod`，不抛错；
- `writeFileSync` 的 `mode` 选项在 Windows 上最多影响只读位，不能表达"仅本人可读"；
- 实际访问控制由文件所在目录继承的 NTFS ACL 负责。默认用户目录的 ACL 已限定为
  当前用户与系统账户，因此把数据放在 `%USERPROFILE%` 下仍是推荐做法；
- 如果 `%LOCALAPPDATA%` 被重定向到共享盘或权限宽松的目录，继承 ACL 可能不符合预期，
  需要管理员另行加固；本版本不自动调用 `icacls`，也不声称已实现 `0600` 等价保护。

因此安全模型在 Windows 上的表述应为"依赖用户目录继承 ACL + CLI 打码 + 回环监听"，
而不是"文件权限位 0600"。磁盘上的档案仍是明文 JSON，这一点两个平台相同。

## 8. 原子写与 rename 重试

所有 JSON 档案仍走 `core/archive/fs` 的原子写：

1. 在目标文件**同目录**生成 `.name.<pid>.<随机>.tmp`；
2. 写入完整 JSON 并请求权限；
3. `rename` 覆盖目标；
4. 任一步失败时尽力删除临时文件。

Windows 适配有两点：

- 临时文件名用 `dirname` / `basename` 拼接，不再假设 `/` 分隔符；
- 杀毒软件、搜索索引或同步客户端可能短暂占用目标文件，使 `rename` 返回
  `EPERM` / `EACCES` / `EBUSY`。写入层在 Windows 上最多尝试 5 次（首次 + 4 次重试），
  退避 10 / 20 / 30 / 40 ms（`Atomics.wait` 同步睡眠，不忙等）；其它错误立即上抛；
  最后一次仍失败时抛原始错误，临时文件会尽力清理；清理失败时给出人工检查警告，
  不输出档案内容。

重试只覆盖"短暂占用"，不是无限等待。若目标被长期锁定，命令会失败并给出路径，
用户应关闭占用程序后重试。原子性仍只在同一卷内成立，因此临时文件绝不跨目录创建。

## 9. 测试夹具跨平台约定

测试一律使用注入 home + 临时目录，禁止把真实用户目录写进用例。关键规则：

- **禁止**硬编码 `Library/Application Support`、`AppData`、`C:\Users\...` 等路径；
- 需要 Claude 侧 `configLibrary` 时，用 `claudePaths(home).configLibrary`；
- 需要官方账本根时，用 `officialLedgerRoot(home)`；
- 需要 Harbor 路径时，用 `harborPaths(home)` 或 `join(home, ".claudeharbor", ...)`；
- 临时目录用 `mkdtempSync(join(tmpdir(), "harbor-<模块>-"))`，在 `finally` 或
  `afterEach` 中 `rmSync(..., { recursive: true, force: true })`；
- 路径一律用 `node:path` 的 `join` 拼接与比较，不手写分隔符；`sourceRel` 等跨平台
  元数据固定使用正斜杠；
- POSIX 权限位在 Windows 无对等物，相关断言显式跳过并写明原因：

```ts
import { test } from "node:test";

test(
  "atomicWriteJson：SECRET_MODE 权限位为 600",
  { skip: process.platform === "win32" ? "Windows 无 POSIX 权限位" : false },
  () => {
    // 仅在 POSIX 上断言 statSync(path).mode & 0o777 === 0o600
  },
);
```

典型夹具：

```ts
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claudePaths } from "../core/archive/paths/index.ts";
import { officialLedgerRoot } from "../core/usage/paths/index.ts";

const home = mkdtempSync(join(tmpdir(), "harbor-check-"));
try {
  const configLibrary = claudePaths(home).configLibrary;
  mkdirSync(configLibrary, { recursive: true });
  // 需要账本时：
  const ledgerRoot = officialLedgerRoot(home);
  // ...
} finally {
  rmSync(home, { recursive: true, force: true });
}
```

需要参数化验证平台差异时，直接向平台层传 `PlatformOptions`：

```ts
import { inspectDesktopRoots } from "../core/platform/index.ts";

const roots = inspectDesktopRoots("C:\\tmp\\home", {
  platform: "win32",
  env: {}, // 空环境：AppData 从注入 home 推导，不读真实变量
});
```

不要用真实 `process.env` 构造"重定向"场景；测试 env 必须是自造的字面量对象。

## 10. 已知限制

- Windows 上仍无法通过 `mode` 保证密钥文件"仅本人可读"，见第 7 节；
- 未实现 Windows 服务/后台常驻，`gateway-run` 仍随终端运行；
- 未在 Windows 上验证 Claude Desktop 对生成 profile 的完整消费链路（见第 11 节）；
- 路径长度、非 ASCII 用户名、OneDrive 重定向等环境差异尚未纳入自动化测试。

## 11. 待真机验证清单

以下项目需在 Windows 真机上逐条确认，结果应记录到发布说明：

- [ ] `node bin/claudeharbor.ts paths` 在安装版机器上把 `%LOCALAPPDATA%\Claude-3p` 标为采用值，
      且 `configLibrary`、`local-agent-mode-sessions` 均被识别；
- [ ] 商店版（MSIX）机器上能扫描到 `Packages\Claude*\LocalCache\Roaming\Claude-3p`，
      包名变化/重装后无需改代码即可重新发现；
- [ ] 只有 `%APPDATA%\Claude-3p\config.json` 的壳目录不会被误选为数据根；
- [ ] `--claude-root` 指向非默认目录时，创建、激活、检查、网关启动全部读写该目录；
- [ ] `profile create` / `activate` 写入的 `configLibrary` 能被 Claude Desktop 读取并显示；
- [ ] `gateway-run` 在 `127.0.0.1` 上可被 Desktop 正常调用，JSON 与 SSE 均能透传；
- [ ] `usage sync` 能从 `local-agent-mode-sessions` 增量镜像账本，`_meta.json` 的
      `sourceRel` 使用正斜杠，跨天追加与改写检测正常；
- [ ] 原子写在杀毒软件/索引服务运行时不产生残留 `.tmp`，`rename` 重试足以覆盖偶发占用；
- [ ] 密钥文件的 NTFS ACL 继承符合预期（`icacls <文件>` 仅当前用户与系统可读）；
- [ ] 含空格、中文、非 ASCII 字符的用户名与数据根路径可正常工作；
- [ ] PowerShell 与 Git Bash 下 `node bin/claudeharbor.ts` 的行为一致；
- [ ] 安装版与商店版并存时，`paths` 的候选排序与采用值符合预期；
- [ ] `%LOCALAPPDATA%` 被组策略重定向到其它盘时，真实主目录仍使用系统变量，
      注入 home 的测试环境不受影响；
- [ ] 卸载/重装 Desktop 后，旧数据根与新数据根的迁移路径明确（本版本不自动迁移）。

## 12. 相关文件

```text
core/platform/index.ts          ← 平台差异唯一出处：home、数据根候选、探测
core/archive/paths/index.ts     ← claudePaths() / harborPaths()
core/archive/fs/index.ts        ← 原子写、applyFileMode()、rename 重试
core/usage/paths/index.ts       ← officialLedgerRoot() / 镜像路径
scripts/paths.ts                ← claudeharbor paths 诊断命令
scripts/claudeharbor.ts         ← --home / --claude-root / --version 全局选项
```

