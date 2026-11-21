/**
 * 页面只返回字符串，因此这里不引入 DOM 桩，只锁住可观察的结构、文案、
 * 可扩展接口与样式契约。关闭通知依赖原生 <details>/<summary>，不需要 JS。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTranslator } from "../ui/renderer/components/i18n.ts";
import type { ClientInfo } from "../ui/renderer/components/events.ts";
import { OVERVIEW_COPY, formatGreeting, render } from "../ui/renderer/pages/overview.ts";
import type { OverviewContent } from "../ui/renderer/pages/types.ts";

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const clientInfo: ClientInfo = {
  username: "alice",
  hostname: "studio-mac",
};

function draw(
  options: { content?: OverviewContent; language?: "zh" | "en"; info?: ClientInfo } = {},
): string {
  const language = options.language ?? "en";
  return render({
    t: createTranslator(language),
    language,
    clientInfo: options.info ?? clientInfo,
    ...(options.content ? { overview: options.content } : {}),
  });
}

function occurrences(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** 截取一个 CSS 规则块，选择器必须带 `{` 之前的前缀。 */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `样式缺少 ${selector}`);
  const open = css.indexOf("{", start);
  assert.ok(open >= 0, `${selector} 缺少规则体`);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  assert.fail(`${selector} 规则体未闭合`);
}

/** 从声明中取第一个 px 数值。 */
function px(block: string, property: string): number {
  const match = block.match(new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  assert.ok(match, `样式缺少 ${property}: Npx`);
  return Number(match[1]);
}

/** 读取 padding 的某一侧：优先长写，其次解析 padding 简写。 */
function paddingPx(block: string, side: "top" | "right" | "bottom" | "left"): number {
  const longhand = block.match(
    new RegExp(`padding-${side}:\\s*(-?\\d+(?:\\.\\d+)?)px`),
  );
  if (longhand) return Number(longhand[1]);

  const shorthand = block.match(/padding:\s*([^;]+);/);
  assert.ok(shorthand, "样式缺少 padding");
  const parts = (shorthand[1] ?? "").trim().split(/\s+/);
  assert.ok(parts.every((part) => part.endsWith("px")), "padding 简写必须都是 px");
  const values = parts.map((part) => Number.parseFloat(part));
  const top = values[0] ?? 0;
  const right = values[1] ?? top;
  const bottom = values[2] ?? top;
  const left = values[3] ?? right;
  return { top, right, bottom, left }[side];
}

const at = (hour: number): Date => new Date(2026, 10, 20, hour, 0, 0);

test("overview: 欢迎语按时间生成并支持 username，logo 与标题同一行", () => {
  assert.equal(formatGreeting({ username: "alice", now: at(23) }), "Good night, alice");
  assert.equal(formatGreeting({ username: "alice", now: at(4) }), "Good night, alice");
  assert.equal(formatGreeting({ username: "alice", now: at(8) }), "Good morning, alice");
  assert.equal(formatGreeting({ username: "alice", now: at(14) }), "Good afternoon, alice");
  assert.equal(formatGreeting({ username: "alice", now: at(19) }), "Good evening, alice");
  assert.equal(formatGreeting({ now: at(19) }), "Good evening");
  assert.equal(
    formatGreeting({ username: "小明", language: "zh", now: at(19) }),
    "晚上好，小明",
  );
  assert.equal(formatGreeting({ username: "小明", language: "zh", now: at(8) }), "早上好，小明");

  const html = draw();
  assert.match(html, /data-role="page-overview"/);
  assert.match(
    html,
    /<header class="ov-welcome">\s*<button type="button" class="ov-mascot" data-role="overview-mascot-button"[^>]*><img class="ov-mascot-img" data-role="overview-mascot"/,
    "小猫是可点击按钮，与欢迎语在同一 header 内",
  );
  assert.match(
    html,
    /<header class="ov-welcome">[\s\S]*?<h1[^>]*data-role="overview-greeting"[^>]*>Good (?:morning|afternoon|evening|night), alice<\/h1>/,
    "默认欢迎语带用户名并随时间段变化",
  );
  assert.match(
    html,
    /data-clip="cat-\d-still"\s+src="\.\/assets\/mascots\/cat-\d\.png"/,
    "首帧渲染静止的小猫，动图由脚本在点击后播放",
  );
  assert.equal(occurrences(html, /<h1\b/g), 1, "欢迎语是页面唯一 h1");
  assert.doesNotMatch(html, /ov-subtitle/, "欢迎区不再放多余说明文字");
  for (const tag of html.match(/<svg\b[^>]*>/g) ?? []) {
    assert.match(tag, /aria-hidden="true"/, "图标 SVG 不应被读屏重复朗读");
  }
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /style=/i, "样式必须集中在 overview.css");
});

test("overview: greeting 支持 {username} 模板与完整自定义，文本全部转义", () => {
  const templated = draw({ content: { greeting: "Good night, {username}" } });
  assert.match(
    templated,
    /data-role="overview-greeting"[^>]*>Good night, alice<\/h1>/,
  );

  const html = draw({
    content: {
      greeting: "Hola, <Sam>",
      activeProfile: 'Studio "Pro" <script>alert(1)</script>',
      mode: "advanced",
    },
  });

  assert.match(html, /data-role="overview-greeting"[^>]*>Hola, &lt;Sam&gt;<\/h1>/);
  assert.doesNotMatch(html, /<script/i, "注入的脚本标签必须被转义");
  assert.doesNotMatch(html, /<Sam>/);
  assert.match(html, /data-mode="advanced"/);
  assert.doesNotMatch(html, /data-source="overview-profile-switch"/);

  const noName = render({
    t: createTranslator("en"),
    language: "en",
    clientInfo: {},
    overview: { greeting: "Good night, {username}" },
  });
  assert.match(noName, /data-role="overview-greeting"[^>]*>Good night<\/h1>/);
});

test("overview: 当前配置卡已移除，仅保留切换档案入口", () => {
  for (const mode of ["standard", "advanced"] as const) {
    const html = draw({ content: { activeProfile: "Daily driver", mode } });
    assert.doesNotMatch(html, /data-role="gateway-bar"/);
    assert.doesNotMatch(html, /data-role="gateway-switch"/);
    assert.doesNotMatch(html, /data-role="active-profile"/);
    assert.doesNotMatch(html, /data-role="profile-box"/);
    assert.doesNotMatch(html, /data-source="overview-profile-switch"/);
    assert.match(html, />Switch profile</);
  }
});

test("overview: 没有激活档案时也只保留切换档案入口", () => {
  for (const activeProfile of [undefined, null, "", "   "]) {
    const html = draw({ content: { activeProfile, mode: "advanced" } });
    assert.doesNotMatch(html, /data-role="active-profile"/);
    assert.doesNotMatch(html, /data-role="gateway-bar"/);
    assert.doesNotMatch(html, /data-source="overview-profile-switch"/);
  }
});

test("overview: 错误通知条默认展开，含详情、两个次要按钮与关闭/重新预览", () => {
  const html = draw({ content: { gatewayError: "offline" } });

  assert.match(html, /<details[^>]*data-role="error-notification"[^>]*\bopen\b/);
  assert.ok(
    html.indexOf('data-role="error-notification"') < html.indexOf('data-role="overview-greeting"'),
    "通知条位于顶部欢迎区之前",
  );
  assert.match(html, />Gateway connection failed</);
  assert.match(
    html,
    />Claude Desktop could not reach the local gateway\. Check the configuration and try again\.</,
  );
  assert.match(
    html,
    /<button[^>]*class="ov-notice-link"[^>]*data-action="learn-more"[^>]*data-section="client-info"[^>]*>View details<\/button>/,
  );
  assert.equal(
    occurrences(html, /class="ov-notice-button"/g),
    2,
    "通知条只提供两个次要按钮",
  );
  assert.match(html, /data-action="gateway-start" data-source="overview-error-retry"/);
  assert.match(
    html,
    /data-action="settings"[^>]*data-source="overview-error-settings"/,
  );

  assert.match(
    html,
    /<details[^>]*>\s*<summary[^>]*data-action="notice-toggle"[^>]*data-role="error-notification-toggle"/,
    "shell 的 data-page 委托会重渲染 workspace，summary 必须显式声明 action",
  );
  assert.match(html, />Close</);
  assert.match(html, />Show notification</);
  assert.match(html, /class="icon-placeholder ov-notice-restore-icon"/);
  assert.doesNotMatch(html, /data-action="dismiss-notification"/, "关闭由原生 details 完成");
});

test("overview: 中英文案键一致，中文默认文案与按钮完整", () => {
  assert.deepEqual(
    Object.keys(OVERVIEW_COPY.zh).sort(),
    Object.keys(OVERVIEW_COPY.en).sort(),
    "中英文案必须一一对应",
  );

  const zh = draw({
    language: "zh",
    info: { username: "小明", hostname: "studio-mac" },
    content: { activeProfile: "工作配置", mode: "advanced", gatewayError: "offline" },
  });
  assert.match(
    zh,
    /data-role="overview-greeting"[^>]*>(?:早上好|下午好|晚上好)，小明<\/h1>/,
  );
  assert.match(zh, />切换档案</);
  assert.match(zh, />建议</);
  assert.match(zh, />查看用量</);
  assert.match(zh, />关闭</);
  assert.match(zh, />显示通知</);

  const zhEmpty = draw({ language: "zh", info: {} });
  assert.match(zhEmpty, /data-role="overview-greeting"[^>]*>(?:早上好|下午好|晚上好)</);
  assert.match(zhEmpty, />切换档案</);
});

test("overview: 不伪造实时数据，主按钮不用品牌橙色", () => {
  const html = draw({ content: { activeProfile: "Daily driver", mode: "advanced" } });

  assert.doesNotMatch(html, /\b\d{1,3}(?:,\d{3})+\b/);
  assert.doesNotMatch(html, /\b\d+(?:\.\d+)?\s*(?:ms|s|%)\b/i);
  assert.doesNotMatch(html, /button--primary/, "主按钮由 overview.css 提供黑白配色");
  assert.doesNotMatch(html, /data-summary-card=/, "概览不再使用四张摘要卡");
});

test("overview.css: 约 672px 居中内容列，serif 欢迎语与更小的控件", () => {
  const css = read("ui/renderer/pages/overview.css");

  const page = cssBlock(css, ".page--overview {");
  const maxWidth = px(page, "max-width");
  const contentWidth = maxWidth - px(page, "padding-left") - px(page, "padding-right");
  assert.ok(
    contentWidth >= 640 && contentWidth <= 700,
    `内容列应在 640-700px，实际 ${contentWidth}px`,
  );
  assert.match(page, /margin:\s*0 auto/, "内容列在工作区居中");
  assert.match(css, /--ov-font-serif:\s*var\(--harbor-font-display\)/, "欢迎语使用 serif 字体栈");

  const welcome = cssBlock(css, ".ov-welcome {");
  assert.match(welcome, /display:\s*flex/);
  assert.match(welcome, /align-items:\s*center/);
  assert.doesNotMatch(welcome, /flex-direction:\s*column/, "logo 与标题保持同一行");

  const mascot = cssBlock(css, ".ov-mascot {");
  assert.ok(px(mascot, "width") <= 60, "画布带留白，盒子比猫本体略大");
  assert.ok(px(mascot, "height") <= 60);

  const mascotImg = cssBlock(css, ".ov-mascot-img {");
  assert.match(mascotImg, /image-rendering:\s*pixelated/, "像素画放大保持硬边");

  const greeting = cssBlock(css, ".ov-greeting {");
  const size = greeting.match(/font-size:\s*clamp\(\s*(\d+)px[^;]*?(\d+)px\s*\)/);
  assert.ok(size, "欢迎语字号使用 clamp 收敛");
  const minSize = Number(size[1]);
  const maxSize = Number(size[2]);
  assert.ok(minSize >= 30 && maxSize <= 42, `欢迎语字号应在 32-42px，实际 ${minSize}-${maxSize}px`);
  assert.match(greeting, /font-weight:\s*(?:400|normal|3\d\d|4\d\d)/, "不要粗黑大标题");
  assert.match(greeting, /font-family:\s*var\(--ov-font-serif\)/);

  const noticeBody = cssBlock(css, ".ov-notice-body {");
  assert.ok(paddingPx(noticeBody, "top") <= 14, "通知条高度降低");
  assert.ok(paddingPx(noticeBody, "bottom") <= 14);
  const noticeButton = cssBlock(css, ".ov-notice-button {");
  assert.ok(px(noticeButton, "height") <= 26, "通知按钮更小");
  const noticeTitle = cssBlock(css, ".ov-notice-title {");
  assert.ok(px(noticeTitle, "font-size") <= 13);

  const hint = cssBlock(css, ".ov-hint-button {");
  assert.ok(paddingPx(hint, "top") <= 12, "建议列表更紧凑");

  assert.doesNotMatch(css, /\.ov-subtitle/, "多余说明文字样式应移除");
  assert.doesNotMatch(css, /hero-card|summary-card/, "旧卡片样式不得残留");
});

test("overview.css: 复用 shell 反色 token 与通知条样式", () => {
  const css = read("ui/renderer/pages/overview.css");
  const shell = read("ui/renderer/styles.css");

  assert.match(shell, /--harbor-inverse:\s*#0b0b0b/i);
  assert.match(
    shell,
    /html\[data-theme="dark"\]\s*\{[\s\S]*?--harbor-inverse:\s*#ffffff/i,
    "深色模式主按钮必须白底",
  );
  assert.match(
    shell,
    /html\[data-theme="dark"\]\s*\{[\s\S]*?--harbor-inverse-text:\s*#0b0b0b/i,
    "深色模式主按钮必须黑字",
  );
  assert.match(shell, /--harbor-switch-on:\s*#[0-9a-f]{6}/i);
  assert.match(css, /\.ov-notice-toggle::-webkit-details-marker/);
});
