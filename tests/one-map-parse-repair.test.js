const test = require("node:test");
const assert = require("node:assert/strict");
const mp = require("../shared/one-map-parse.js");

// ---- 截断修复（C3：模型输出被 max_tokens 截断时补齐括号） ----

test("repairTruncatedJson: 补齐被截断的对象与数组", () => {
  assert.equal(
    mp.repairTruncatedJson('{"mappings":{"f1":{"path":"personal.email"'),
    '{"mappings":{"f1":{"path":"personal.email"}}}'
  );
  assert.equal(mp.repairTruncatedJson('{"a":[1,2'), '{"a":[1,2]}');
  assert.equal(mp.repairTruncatedJson('{"a":"未闭合'), '{"a":"未闭合"}');
  assert.equal(mp.repairTruncatedJson('{"a":{"b":'), '{"a":{"b"}}');
});

test("repairTruncatedJson: 完整 JSON 原样返回", () => {
  const good = '{"mappings":{"f1":{"path":"personal.email","confidence":0.9}}}';
  assert.equal(mp.repairTruncatedJson(good), good);
});

test("parseJsonLoose: 截断的映射输出也能解析", () => {
  const parsed = mp.parseJsonLoose('{"mappings":{"f1":{"path":"personal.email","confidence":0.9');
  assert.ok(parsed && parsed.mappings && parsed.mappings.f1);
  assert.equal(parsed.mappings.f1.path, "personal.email");
  assert.equal(parsed.mappings.f1.confidence, 0.9);
});
