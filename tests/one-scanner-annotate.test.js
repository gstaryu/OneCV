const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared/one-scanner-core.js");

// ---- annotateSameLabelGroups（Moka 分体日期 / 同名 label 信号） ----

test("拆分日期四下拉：DOM 顺序模式标注角色后缀 + order", () => {
  const raws = ["起止时间", "起止时间", "起止时间", "起止时间"].map((label) => ({
    tag: "input",
    inputType: "text",
    labelText: label,
  }));
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.deepEqual(
    descs.map((d) => d.labelText),
    ["起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）"]
  );
  assert.deepEqual(descs.map((d) => d.order), [1, 2, 3, 4]);
  assert.equal(descs[0].sameLabelCount, 4);
});

test("跨卡片同名组：工作经历卡与实习经历卡各自独立标注", () => {
  const makeRaws = (blockTitle) =>
    ["起止时间", "起止时间", "起止时间", "起止时间"].map((label) => ({
      tag: "input",
      inputType: "text",
      labelText: label,
      sectionTexts: [label, blockTitle],
    }));
  const raws = [...makeRaws("工作经历"), ...makeRaws("实习经历")];
  const descs = core.buildFieldDescriptors(raws, "f");

  const work = descs.slice(0, 4).map((d) => d.labelText);
  const intern = descs.slice(4, 8).map((d) => d.labelText);

  assert.deepEqual(work, [
    "起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）",
  ]);
  assert.deepEqual(intern, [
    "起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）",
  ]);
  assert.equal(descs[0].sameLabelCount, 8); // order/sameLabelCount 仍按全页同名组
  assert.equal(descs[4].order, 5);
});

test("双下拉 options 判定：年+月单对 →（年）（月）后缀", () => {
  const raws = [
    { tag: "input", inputType: "text", labelText: "获奖时间", options: [{ text: "2024" }, { text: "2025" }, { text: "2026" }] },
    { tag: "input", inputType: "text", labelText: "获奖时间", options: [{ text: "1" }, { text: "2" }, { text: "12" }] },
  ];
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.equal(descs[0].labelText, "获奖时间（年）");
  assert.equal(descs[1].labelText, "获奖时间（月）");
});

test("回归：公司名称组不因上下文含时间词而误标角色后缀", () => {
  const raws = [
    { tag: "input", inputType: "text", labelText: "公司名称", sectionTexts: ["起止时间", "实习经历"] },
    { tag: "input", inputType: "text", labelText: "公司名称", sectionTexts: ["起止时间", "实习经历"] },
  ];
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.equal(descs[0].labelText, "公司名称");
  assert.equal(descs[1].labelText, "公司名称");
  assert.deepEqual(descs.map((d) => d.order), [1, 2]);
});

test("DOM 行键分卡：三卡 12 个同名起止时间各自独立标注（真实页主路径）", () => {
  const raws = [];
  for (const block of ["工作经历", "实习经历", "项目经验"]) {
    for (const ph of ["年", "月", "年", "月"]) {
      raws.push({ tag: "input", inputType: "text", labelText: "起止时间", placeholder: ph, sectionTexts: [], __rowKey: "rk_" + block });
    }
  }
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.deepEqual(
    descs.map((d) => d.labelText),
    [
      "起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）",
      "起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）",
      "起止时间（开始·年）", "起止时间（开始·月）", "起止时间（结束·年）", "起止时间（结束·月）",
    ]
  );
});

test("无行键时 placeholder 交替切块兜底：每 2 个一卡 →（年）（月）", () => {
  const raws = [];
  for (const block of ["工作经历", "实习经历", "项目经验"]) {
    for (const ph of ["年", "月", "年", "月"]) {
      raws.push({ tag: "input", inputType: "text", labelText: "起止时间", placeholder: ph, sectionTexts: [] });
    }
  }
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.deepEqual(
    descs.map((d) => d.labelText),
    [
      "起止时间（年）", "起止时间（月）", "起止时间（年）", "起止时间（月）",
      "起止时间（年）", "起止时间（月）", "起止时间（年）", "起止时间（月）",
      "起止时间（年）", "起止时间（月）", "起止时间（年）", "起止时间（月）",
    ]
  );
});

test("placeholder 年/月优先判定：获奖时间单对 →（年）（月）", () => {
  const raws = [
    { tag: "input", inputType: "text", labelText: "获奖时间", placeholder: "年" },
    { tag: "input", inputType: "text", labelText: "获奖时间", placeholder: "月" },
  ];
  const descs = core.buildFieldDescriptors(raws, "f");

  assert.equal(descs[0].labelText, "获奖时间（年）");
  assert.equal(descs[1].labelText, "获奖时间（月）");
});

test("descriptorForPrompt: 带选项的 text 字段也下发 options，并带 card/order", () => {
  const descriptor = {
    pageFieldId: "f1",
    kind: "text",
    labelText: "起止时间（开始·年）",
    ariaLabel: "",
    placeholder: "",
    name: "",
    htmlId: "",
    attrTokens: [],
    nearbyText: "",
    sectionTexts: ["实习经历"],
    options: [{ value: "2024", text: "2024" }, { value: "2025", text: "2025" }],
    required: false,
    readOnly: false,
    maxLength: 0,
    blockIndex: 2,
    order: 2,
    sameLabelCount: 4,
    frameIndex: 0,
  };
  const out = core.descriptorForPrompt(descriptor);

  assert.deepEqual(out.options, ["2024", "2025"]);
  assert.equal(out.card, "实习经历 #2");
  assert.equal(out.order, 2);
});
