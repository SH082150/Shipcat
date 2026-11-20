#!/usr/bin/env node
/**
 * 可执行入口（bin/claudeharbor，经 package.json 的 bin 字段安装为
 * `claudeharbor` 命令）。薄接线：把参数转交给 scripts/claudeharbor.ts
 * 的 main，并透传其返回的退出码。业务逻辑全在 scripts/ 与 core/。
 */

import { main } from "../scripts/claudeharbor.ts";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
