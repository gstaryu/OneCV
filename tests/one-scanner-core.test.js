const test = require("node:test");
const assert = require("node:assert/strict");
const scanner = require("../shared/one-scanner-core.js");

function rawField(overrides = {}) {
  return {
    tag: "input",
    inputType: "text",
    name: "",
    id: "",
    labelText: "",
    ariaLabel: "",
    placeholder: "",
    nearbyText: "",
    sectionTexts: [],
    options: [],
    ...overrides,
  };
}

test("inferKind: 常见控件类型判定", () => {
  assert.equal(scanner.inferKind(rawField({ tag: "textarea" })), "textarea");
  assert.equal(scanner.inferKind(rawField({ tag: "select" })), "select");
  assert.equal(scanner.inferKind(rawField({ inputType: "radio" })), "radio_group");
  assert.equal(scanner.inferKind(rawField({ inputType: "checkbox" })), "checkbox");
  assert.equal(scanner.inferKind(rawField({ inputType: "email" })), "email");
  assert.equal(scanner.inferKind(rawField({ inputType: "date" })), "date");
  assert.equal(scanner.inferKind(rawField({ contentEditable: true })), "contenteditable");
  assert.equal(scanner.inferKind(rawField({ tag: "div" })), "unknown");
});

test("buildFieldDescriptors: 同名字段指纹带出现序号且 id 唯一", () => {
  const descriptors = scanner.buildFieldDescriptors([
    rawField({ labelText: "公司名称", name: "company" }),
    rawField({ labelText: "公司名称", name: "company" }),
    rawField({ labelText: "职位名称", name: "title" }),
  ]);

  assert.equal(descriptors.length, 3);
  assert.notEqual(descriptors[0].fingerprint, descriptors[1].fingerprint);
  assert.ok(descriptors[1].fingerprint.endsWith("#1"));
  const ids = new Set(descriptors.map((d) => d.pageFieldId));
  assert.equal(ids.size, 3);
});

test("normalizeLabelText: 去掉必填星号与冒号", () => {
  assert.equal(scanner.normalizeLabelText("姓名 *："), "姓名");
  assert.equal(scanner.normalizeLabelText("  邮箱Email： "), "邮箱Email");
});

test("extractAttrTokens: camelCase / snake / kebab 拆词", () => {
  assert.deepEqual(
    scanner.extractAttrTokens("legalNameSection_firstName"),
    ["legal", "name", "section", "first", "name"]
  );
  assert.deepEqual(scanner.extractAttrTokens("work-experience-company"), [
    "work",
    "experience",
    "company",
  ]);
});

test("computeStructureSignature: 字段集合变化 → 签名变化", () => {
  const a = scanner.buildFieldDescriptors([rawField({ labelText: "姓名" })]);
  const b = scanner.buildFieldDescriptors([rawField({ labelText: "姓名" })]);
  const c = scanner.buildFieldDescriptors([rawField({ labelText: "邮箱" })]);

  assert.equal(scanner.computeStructureSignature(a), scanner.computeStructureSignature(b));
  assert.notEqual(scanner.computeStructureSignature(a), scanner.computeStructureSignature(c));
});

test("computeStructureSignature: 字段数量变化 → 签名变化", () => {
  const one = scanner.buildFieldDescriptors([rawField({ labelText: "姓名" })]);
  const two = scanner.buildFieldDescriptors([
    rawField({ labelText: "姓名" }),
    rawField({ labelText: "姓名" }),
  ]);
  assert.notEqual(scanner.computeStructureSignature(one), scanner.computeStructureSignature(two));
});

test("buildMappingPayload: unknown 字段被剔除、readOnly 保留，选项被摘要", () => {
  const descriptors = scanner.buildFieldDescriptors([
    rawField({ labelText: "姓名", inputType: "text" }),
    rawField({ labelText: "日历接管输入", readOnly: true }),
    rawField({
      tag: "select",
      labelText: "学历",
      options: [
        { value: "1", text: "本科" },
        { value: "2", text: "硕士" },
      ],
    }),
  ]);

  const payload = scanner.buildMappingPayload(
    descriptors,
    [{ path: "personal.fullName", label: "基本信息 / 姓名", value: "张三", hasValue: true, valuePreview: "张三" }],
    { url: "https://example.com/jobs", title: "校招报名" }
  );

  const labels = payload.fields.map((f) => f.label);
  assert.ok(labels.includes("姓名"));
  assert.ok(labels.includes("学历"));
  assert.ok(labels.includes("日历接管输入"));
  assert.equal(payload.fields.length, 3);

  const select = payload.fields.find((f) => f.label === "学历");
  assert.deepEqual(select.options, ["本科(1)", "硕士(2)"]);
  assert.deepEqual(payload.resume, [
    { path: "personal.fullName", label: "基本信息 / 姓名", section: undefined, preview: "张三", options: undefined },
  ]);
});

test("buildMappingPayload: 无值简历字段不进入目录", () => {
  const payload = scanner.buildMappingPayload(
    [],
    [
      { path: "personal.fullName", label: "姓名", value: "张三", hasValue: true, valuePreview: "张三" },
      { path: "personal.englishName", label: "英文名", value: "", hasValue: false, valuePreview: "" },
    ],
    { url: "", title: "" }
  );
  assert.equal(payload.resume.length, 1);
});
