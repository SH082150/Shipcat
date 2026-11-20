import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingHttpHeaders } from "node:http";

import { extractToken, authenticate } from "../core/gateway/2-auth/index.ts";

test("extractToken：Authorization Bearer 前缀", () => {
  const headers: IncomingHttpHeaders = { authorization: "Bearer claudeharbor-local" };
  assert.equal(extractToken(headers), "claudeharbor-local");
});

test("extractToken：小写 bearer 前缀", () => {
  const headers: IncomingHttpHeaders = { authorization: "bearer claudeharbor-local" };
  assert.equal(extractToken(headers), "claudeharbor-local");
});

test("extractToken：无前缀裸 token", () => {
  const headers: IncomingHttpHeaders = { authorization: "claudeharbor-local" };
  assert.equal(extractToken(headers), "claudeharbor-local");
});

test("extractToken：仅 x-api-key", () => {
  const headers: IncomingHttpHeaders = { "x-api-key": "claudeharbor-local" };
  assert.equal(extractToken(headers), "claudeharbor-local");
});

test("extractToken：两个头都带时 Authorization 赢", () => {
  const headers: IncomingHttpHeaders = {
    authorization: "Bearer from-auth-header",
    "x-api-key": "from-api-key-header",
  };
  assert.equal(extractToken(headers), "from-auth-header");
});

test("extractToken：空白 trim，空值视为未带", () => {
  assert.equal(
    extractToken({ authorization: "  Bearer   spaced-token  " }),
    "spaced-token",
  );
  assert.equal(extractToken({ authorization: "   " }), null);
  assert.equal(extractToken({ "x-api-key": "   " }), null);
  assert.equal(extractToken({}), null);
});

test("authenticate：token 正确通过", () => {
  const headers: IncomingHttpHeaders = { authorization: "Bearer claudeharbor-local" };
  assert.equal(authenticate(headers, "claudeharbor-local"), true);
});

test("authenticate：token 错误拒绝", () => {
  const headers: IncomingHttpHeaders = { authorization: "Bearer wrong-token" };
  assert.equal(authenticate(headers, "claudeharbor-local"), false);
});

test("authenticate：长度不同直接失败（防时序侧信道）", () => {
  const headers: IncomingHttpHeaders = { authorization: "Bearer short" };
  assert.equal(authenticate(headers, "claudeharbor-local"), false);
});

test("authenticate：无凭证拒绝", () => {
  assert.equal(authenticate({}, "claudeharbor-local"), false);
});

test("authenticate：x-api-key 通路同样生效", () => {
  const headers: IncomingHttpHeaders = { "x-api-key": "claudeharbor-local" };
  assert.equal(authenticate(headers, "claudeharbor-local"), true);
});
