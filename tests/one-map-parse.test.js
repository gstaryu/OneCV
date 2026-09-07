const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../shared/one-map-parse.js");

test("stripMarkdownFences: 去掉 ```json 围栏", () => {
  const input = '```json\n{"a":1}\n```';
  assert.equal(parser.stripMarkdownFences(input), '{"a":1}');
});

test("parseJsonLoose: 容忍前后缀自然语言", () => {
  const input = '好的，以下是映射结果：\n{"mappings":{"f1":{"path":"personal.email"}}}\n希望有帮助';
  const parsed = parser.parseJsonLoose(input);
  assert.ok(parsed);
  assert.deepEqual(parsed.mappings.f1, { path: "personal.email" });
});

test("parseJsonLoose: 容忍尾逗号与单引号", () => {
  assert.ok(parser.parseJsonLoose("{'a':1,}"));
  assert.ok(parser.parseJsonLoose('{"a":[1,2,],}'));
});

test("parseJsonLoose: 无 JSON 时返回 null", () => {
  assert.equal(parser.parseJsonLoose("抱歉，我无法处理"), null);
});

test("parseMappingResponse: 标准 mappings 对象 + 校验非法路径", () => {
  const text =
    '{"mappings":{"f1":{"path":"personal.fullName","confidence":0.95},"f2":{"path":"made.up.path","confidence":0.9}}}';
  const result = parser.parseMappingResponse(text, {
    validFieldIds: ["f1", "f2"],
    validPaths: ["personal.fullName"],
  });
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].path, "personal.fullName");
  assert.equal(result.mappings[0].confidence, 0.95);
  assert.equal(result.ignored[0].reason, "invalid_path:made.up.path");
});

test("parseMappingResponse: 简写字符串映射 + 默认置信度 0.5", () => {
  const result = parser.parseMappingResponse('{"f1":"personal.email"}', {
    validFieldIds: ["f1"],
    validPaths: ["personal.email"],
  });
  assert.equal(result.mappings[0].confidence, 0.5);
});

test("parseMappingResponse: 未知 transform 丢弃", () => {
  const result = parser.parseMappingResponse(
    '{"f1":{"path":"personal.phoneNumber","transform":"hack_the_planet"}}',
    { validFieldIds: ["f1"], validPaths: ["personal.phoneNumber"], validTransforms: ["phone_split"] }
  );
  assert.equal(result.mappings[0].transform, "");
});

test("parseMappingResponse: confidence 越界截断", () => {
  const result = parser.parseMappingResponse(
    '{"f1":{"path":"personal.email","confidence":2.5},"f2":{"path":"personal.phone","confidence":-1}}',
    { validFieldIds: ["f1", "f2"], validPaths: ["personal.email", "personal.phone"] }
  );
  assert.equal(result.mappings[0].confidence, 1);
  assert.equal(result.mappings[1].confidence, 0);
});

test("parseMappingResponse: $ 前缀路径归一化", () => {
  const result = parser.parseMappingResponse('{"f1":"$.personal.fullName"}', {
    validFieldIds: ["f1"],
    validPaths: ["personal.fullName"],
  });
  assert.equal(result.mappings[0].path, "personal.fullName");
});
