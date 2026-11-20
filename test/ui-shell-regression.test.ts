import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACTION_ATTRIBUTES,
  ACTION_SELECTOR,
  isShellContainer,
} from "../ui/renderer/components/ui-actions.ts";
import { renderSidebar } from "../ui/renderer/components/sidebar.ts";
import { createTranslator } from "../ui/renderer/components/i18n.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 截取一个 CSS 规则块（选择器必须出现在 `{` 之前）。 */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `样式缺少 ${selector}`);
  const open = css.indexOf("{", start);
  assert.ok(open >= 0, `${selector} 缺少规则体`);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  assert.fail(`${selector} 规则体未闭合`);
}

/** 从某个 `<div …>` 开始，返回配对 `</div>` 结束后的下标。 */
function closeOfDiv(html: string, openIndex: number): number {
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = openIndex;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

/** `data-view-page` → `viewPage`，用于把 DOM 属性名还原成 dataset 键。 */
function datasetKey(attribute: string): string {
  return attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

test("action contract: 动作属性集合固定，视图容器状态不得与之重名", () => {
  assert.deepEqual(
    [...ACTION_ATTRIBUTES],
    ["data-action", "data-page", "data-language", "data-route", "data-usage-range"],
  );
  for (const attribute of ACTION_ATTRIBUTES) {
    assert.ok(ACTION_SELECTOR.includes(`[${attribute}]`), `选择器缺少 ${attribute}`);
  }

  const app = read("ui/renderer/app.ts");

  // 容器状态只允许 data-view-*：dataset 键必须能还原出同名 data-view-* 属性。
  const datasetWrites = [
    ...new Set([...app.matchAll(/workspace\.dataset\.([A-Za-z0-9_]+)/g)].map((m) => m[1]!)),
  ].sort();
  assert.ok(datasetWrites.length > 0, "app.ts 应显式写入 workspace 容器状态");
  for (const key of datasetWrites) {
    assert.match(key, /^view[A-Z]/, `workspace 容器状态必须使用 view* 前缀，实际 ${key}`);
    const attribute = `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    assert.ok(
      !(ACTION_ATTRIBUTES as readonly string[]).includes(attribute),
      `容器状态 ${attribute} 与动作属性重名，会被事件委托当成可执行元素`,
    );
  }

  const attributeWrites = [
    ...app.matchAll(/workspace\.setAttribute\(\s*["'`]([^"'`]+)["'`]/g),
  ].map((m) => m[1]!);
  for (const attribute of attributeWrites) {
    assert.match(attribute, /^data-view-/, `容器属性 ${attribute} 必须属于 data-view-*`);
  }
  for (const attribute of [...app.matchAll(/workspace\.removeAttribute\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!)) {
    assert.match(attribute, /^data-view-/, `移除的容器属性 ${attribute} 必须属于 data-view-*`);
  }

  // 容器不得再写导航动作属性。
  assert.doesNotMatch(app, /workspace\.dataset\.page\b/);
  assert.doesNotMatch(app, /workspace\.dataset\.usageRange\b/);
  assert.match(app, /workspace\.dataset\.viewPage\s*=\s*page/);
});

test("action contract: 事件委托使用共享选择器，并忽略 shell 容器", () => {
  const app = read("ui/renderer/app.ts");
  assert.match(app, /import\s*\{[^}]*ACTION_SELECTOR[^}]*\}\s*from\s*"\.\/components\/ui-actions\.ts"/s);
  assert.match(app, /target\.closest<HTMLElement>\(\s*ACTION_SELECTOR,?\s*\)/);
  assert.match(app, /isShellContainer\(/);
  assert.doesNotMatch(app, /target\.closest<HTMLElement>\(\s*"[^"]*data-page/);
});

test("shell containers: 容器自身或包含容器的祖先永远不是动作目标", () => {
  const navButton = { dataset: { page: "providers" } };
  const workspace = {
    dataset: { viewPage: "overview" },
    contains: (node: unknown) => node === navButton,
  };
  assert.equal(isShellContainer(workspace, [workspace]), true);
  assert.equal(isShellContainer(null, [workspace]), false);
  assert.equal(isShellContainer(undefined, [workspace]), false);
  assert.equal(isShellContainer("workspace", [workspace]), false);
  assert.equal(isShellContainer({}, [workspace]), false);
  assert.equal(
    isShellContainer(navButton, [workspace]),
    false,
    "容器内部的导航按钮仍是动作目标，不能因为位于 workspace 里被忽略",
  );

  // 祖先元素（#app / .app-shell）包含 workspace，同样不是动作目标。
  const shell = { contains: (node: unknown) => node === workspace };
  assert.equal(isShellContainer(shell, [workspace]), true);
});

test("sidebar markup: footer 移出 padded inner，作为 aside 直接子元素", () => {
  const html = renderSidebar({
    t: createTranslator("zh"),
    page: "overview",
    language: "zh",
    menuOpen: false,
    clientInfo: { username: "alice" },
  });

  const innerOpen = html.indexOf('class="sidebar-inner"');
  assert.ok(innerOpen >= 0, "侧栏应保留 .sidebar-inner");
  const innerClose = closeOfDiv(html, html.lastIndexOf("<div", innerOpen));
  assert.ok(innerClose > innerOpen, ".sidebar-inner 结构未闭合");

  const footerOpen = html.indexOf('<footer class="sidebar-footer"');
  assert.ok(footerOpen >= 0, "侧栏应保留 .sidebar-footer");
  assert.ok(
    footerOpen > innerClose,
    ".sidebar-footer 必须移出 .sidebar-inner，否则底部横线会被内边距缩进",
  );
  assert.match(
    html.slice(innerClose, footerOpen).trim(),
    /^$/,
    "inner 与 footer 之间不应再包一层容器",
  );

  const footerClose = html.indexOf("</footer>", footerOpen);
  const asideClose = html.indexOf("</aside>", footerClose);
  assert.match(html.slice(footerClose + "</footer>".length, asideClose).trim(), /^$/, "footer 应是 aside 最后一个子元素");
});

test("sidebar styles: 底栏横线由结构撑满，不靠负 margin 补偿", () => {
  const css = read("ui/renderer/styles.css");
  const footer = cssBlock(css, ".sidebar-footer");
  assert.match(footer, /border-top:\s*1px solid var\(--harbor-line\)/);
  assert.doesNotMatch(footer, /margin-left:\s*-/);
  assert.doesNotMatch(footer, /margin-right:\s*-/);

  const inner = cssBlock(css, ".sidebar-inner");
  assert.doesNotMatch(
    inner,
    /padding:[^;]*10px 10px/,
    ".sidebar-inner 的底部内边距不应再为 footer 预留",
  );
  assert.doesNotMatch(css, /\.sidebar-footer[^{]*\{[^}]*margin-inline/);
});

test("density: 标题、控件与页面留白同步收紧且不使用 zoom", () => {
  const css = read("ui/renderer/styles.css");
  assert.doesNotMatch(css, /\bzoom\s*:/);

  assert.match(css, /--harbor-titlebar-height:\s*48px/);
  assert.match(css, /--harbor-sidebar-width:\s*236px/);

  const page = cssBlock(css, "\n.page {");
  assert.match(page, /padding:\s*52px\s+clamp\(/);

  const h1 = cssBlock(css, ".page-header h1");
  assert.match(h1, /font-size:\s*32px/);

  const button = cssBlock(css, "\n.button {");
  assert.match(button, /height:\s*32px/);

  const toolbar = cssBlock(css, ".page-toolbar");
  assert.match(toolbar, /min-height:\s*32px/);
  assert.match(toolbar, /margin:\s*0 0 14px/);

  const navItem = cssBlock(css, ".nav-item");
  assert.match(navItem, /height:\s*36px/);

  const accountButton = cssBlock(css, ".account-button {");
  assert.match(accountButton, /height:\s*40px/);

  const formRow = cssBlock(css, ".form-row");
  assert.match(formRow, /padding:\s*11px 0/);
});

test("事件委托允许 SVG 图标作为点击目标", () => {
  const app = read("ui/renderer/app.ts");
  assert.match(app, /if \(!\(target instanceof Element\)\) return;/, "委托需接受 SVGElement");
  assert.doesNotMatch(
    app,
    /if \(!\(target instanceof HTMLElement\)\) return;/,
    "不能用 HTMLElement 过滤掉图标点击",
  );
});
