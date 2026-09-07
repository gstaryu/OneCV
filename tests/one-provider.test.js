const test = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../shared/one-provider.js");

test("normalizeBaseUrl: openai-compatible 自动补 /chat/completions", () => {
  assert.equal(
    provider.normalizeBaseUrl("https://ark.example.com/api/v3", "openai-compatible"),
    "https://ark.example.com/api/v3/chat/completions"
  );
  assert.equal(
    provider.normalizeBaseUrl("https://ark.example.com/api/v3/", "openai-compatible"),
    "https://ark.example.com/api/v3/chat/completions"
  );
  assert.equal(
    provider.normalizeBaseUrl("https://ark.example.com/api/v3/chat/completions", "openai-compatible"),
    "https://ark.example.com/api/v3/chat/completions"
  );
});

test("normalizeBaseUrl: anthropic 补 /v1/messages", () => {
  assert.equal(
    provider.normalizeBaseUrl("https://api.anthropic.com", "anthropic"),
    "https://api.anthropic.com/v1/messages"
  );
  assert.equal(
    provider.normalizeBaseUrl("https://api.anthropic.com/v1", "anthropic"),
    "https://api.anthropic.com/v1/messages"
  );
});

test("buildChatRequest: openai-compatible 文本请求结构", () => {
  const { url, headers, body } = provider.buildChatRequest(
    { provider: "openai-compatible", baseUrl: "https://x.example/v1", apiKey: "sk-test", model: "m1" },
    { system: "sys", user: "usr" }
  );

  assert.equal(url, "https://x.example/v1/chat/completions");
  assert.equal(headers.Authorization, "Bearer sk-test");
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "usr" },
  ]);
  assert.equal(body.temperature, 0);
});

test("buildChatRequest: 视觉请求把图片塞进 content 数组", () => {
  const { body } = provider.buildChatRequest(
    { provider: "openai-compatible", baseUrl: "https://x.example/v1", apiKey: "k", model: "v1" },
    { user: "描述图片", images: [{ base64: "QUJD", mediaType: "image/png" }] }
  );

  const content = body.messages.at(-1).content;
  assert.equal(content[0].type, "image_url");
  assert.match(content[0].image_url.url, /^data:image\/png;base64,QUJD$/);
  assert.equal(content[1].type, "text");
  assert.equal(content[1].text, "描述图片");
});

test("buildChatRequest: anthropic 请求结构（system 顶层、x-api-key 头）", () => {
  const { url, headers, body } = provider.buildChatRequest(
    { provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "ak-test", model: "claude-x" },
    { system: "sys", user: "usr" }
  );

  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "ak-test");
  assert.equal(body.system, "sys");
  assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "usr" }] }]);
});

test("parseChatResponse: openai-compatible 正常与错误分支", () => {
  assert.equal(
    provider.parseChatResponse("openai-compatible", {
      choices: [{ message: { content: "  hello " } }],
    }),
    "hello"
  );
  assert.throws(() => provider.parseChatResponse("openai-compatible", { error: { message: "bad key" } }), /bad key/);
  assert.throws(() => provider.parseChatResponse("openai-compatible", { choices: [] }), /没有文本内容/);
});

test("parseChatResponse: anthropic content 块拼接", () => {
  assert.equal(
    provider.parseChatResponse("anthropic", {
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    }),
    "a\nb"
  );
});
