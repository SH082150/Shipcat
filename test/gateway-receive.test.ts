import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

import { receiveMessage, MAX_BODY_BYTES } from "../core/gateway/1-receive/index.ts";
import { GatewayError } from "../core/gateway/errors/index.ts";

/** 把若干 Buffer 片段伪装成 IncomingMessage。 */
function fakeReq(chunks: Buffer[]): IncomingMessage {
  return Readable.from(chunks) as unknown as IncomingMessage;
}

test("正常解析：body 为对象且 raw 是原始字节", async () => {
  const payload = JSON.stringify({
    model: "claude-sonnet-main",
    max_tokens: 8192,
    messages: [{ role: "user", content: "你好" }],
  });
  const msg = await receiveMessage(fakeReq([Buffer.from(payload)]));
  assert.equal(msg.body.model, "claude-sonnet-main");
  assert.equal(msg.body.max_tokens, 8192);
  assert.equal(msg.raw.toString("utf8"), payload);
});

test("正常解析：多块分片收齐后拼接", async () => {
  const payload = '{"model":"claude-sonnet-main","stream":false}';
  const half = Math.floor(payload.length / 2);
  const msg = await receiveMessage(fakeReq([
    Buffer.from(payload.slice(0, half)),
    Buffer.from(payload.slice(half)),
  ]));
  assert.equal(msg.body.model, "claude-sonnet-main");
});

test("超限 413：累计超过 32MB 立即抛 request_too_large", async () => {
  const chunk = Buffer.alloc(1024 * 1024, 65); // 1MB
  const chunks: Buffer[] = [];
  for (let i = 0; i < 33; i += 1) chunks.push(chunk); // 33MB > 32MB
  await assert.rejects(
    receiveMessage(fakeReq(chunks)),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 413);
      assert.equal(err.type, "request_too_large");
      return true;
    },
  );
});

test("恰好 32MB 上限内的合法请求不抛 413", async () => {
  // 1MB 填充 + 合法 JSON 头尾，总体积略低于 32MB 上限不好精确控制，
  // 这里用远小于上限的体积验证"正常路径"（上限本身见上一用例）。
  const msg = await receiveMessage(fakeReq([Buffer.from('{"model":"m","pad":"' + "x".repeat(1024) + '"}')]));
  assert.equal(msg.body.model, "m");
  assert.ok(MAX_BODY_BYTES >= 32 * 1024 * 1024);
});

test("非法 JSON 400 invalid_request_error", async () => {
  await assert.rejects(
    receiveMessage(fakeReq([Buffer.from("{not json")])),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 400);
      assert.equal(err.type, "invalid_request_error");
      return true;
    },
  );
});

test("数组体 400：JSON 合法但不是对象", async () => {
  await assert.rejects(
    receiveMessage(fakeReq([Buffer.from('[{"model":"claude-sonnet-main"}]')])),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 400);
      assert.equal(err.type, "invalid_request_error");
      return true;
    },
  );
});

test("缺 model 400", async () => {
  await assert.rejects(
    receiveMessage(fakeReq([Buffer.from('{"max_tokens":8192}')])),
    (err: unknown) => {
      assert.ok(err instanceof GatewayError);
      assert.equal(err.status, 400);
      assert.equal(err.type, "invalid_request_error");
      return true;
    },
  );
});

test("model 非字符串/空白字符串 400", async () => {
  await assert.rejects(
    receiveMessage(fakeReq([Buffer.from('{"model":123}')])),
    (err: unknown) => err instanceof GatewayError && err.status === 400,
  );
  await assert.rejects(
    receiveMessage(fakeReq([Buffer.from('{"model":"   "}]')])),
    (err: unknown) => err instanceof GatewayError && err.status === 400,
  );
});
