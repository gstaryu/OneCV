const test = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../shared/one-provider.js");

// ---- validateBaseUrl（A3：强制 HTTPS，仅本机地址允许 HTTP） ----

test("validateBaseUrl: https 通过", () => {
  assert.doesNotThrow(() => provider.validateBaseUrl("https://ark.cn-beijing.volces.com/api/v3"));
});

test("validateBaseUrl: 非本机 http 抛错", () => {
  assert.throws(() => provider.validateBaseUrl("http://ark.example.com/v1"), /HTTPS/);
});

test("validateBaseUrl: 本机 http 允许", () => {
  assert.doesNotThrow(() => provider.validateBaseUrl("http://localhost:8000/v1"));
  assert.doesNotThrow(() => provider.validateBaseUrl("http://127.0.0.1:3000"));
});

test("validateBaseUrl: 非法地址抛错", () => {
  assert.throws(() => provider.validateBaseUrl("not a url"), /有效地址/);
});
