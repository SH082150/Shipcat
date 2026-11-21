import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeClaudeBlock,
  parseClaudeValue,
  readCustomHeaders,
} from "../core/archive/claude-block/index.ts";

test("parseClaudeValue：JSON 优先，解析失败保留原字符串", () => {
  assert.equal(parseClaudeValue("true"), true);
  assert.equal(parseClaudeValue("false"), false);
  assert.equal(parseClaudeValue("42"), 42);
  assert.deepEqual(parseClaudeValue('{"a":1}'), { a: 1 });
  assert.deepEqual(parseClaudeValue("[1,2]"), [1, 2]);
  assert.equal(parseClaudeValue("https://example.com/a"), "https://example.com/a");
  assert.equal(parseClaudeValue("  hello  "), "  hello  ");
  assert.equal(parseClaudeValue(""), "");
});

test("normalizeClaudeBlock：任意键名通过，键去空白，危险键拒绝", () => {
  const result = normalizeClaudeBlock({ "  customKey  ": "value", retry: "3" });
  assert.deepEqual(result, { ok: true, value: { customKey: "value", retry: 3 } });

  const empty = normalizeClaudeBlock({ "   ": "x" });
  assert.equal(empty.ok, false);

  const proto = normalizeClaudeBlock({ ["__proto__"]: "x" });
  assert.equal(proto.ok, false);
});

test("readCustomHeaders：只收字符串值，空结果返回 undefined", () => {
  assert.deepEqual(readCustomHeaders({ inferenceCustomHeaders: { a: "1", b: 2 } }), { a: "1" });
  assert.equal(readCustomHeaders({ inferenceCustomHeaders: {} }), undefined);
  assert.equal(readCustomHeaders({ inferenceCustomHeaders: ["x"] }), undefined);
  assert.equal(readCustomHeaders(undefined), undefined);
});
