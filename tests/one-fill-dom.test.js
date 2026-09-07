const test = require("node:test");
const assert = require("node:assert/strict");
// one-fill-dom 是 DOM 模块，但 resolveOptionText 等纯函数不触 DOM，Node 可直接
// 覆盖（模块加载本身不访问 document——所有 DOM 引用都在函数体内）
const fd = require("../shared/one-fill-dom.js");

test("模块导出齐全（content.js 依赖的 API 面）", () => {
  for (const name of [
    "simulateMouseClick", "clickOpenThenSelect", "clickMatchingOpenOption",
    "hasPanelStructure", "resolveOptionText", "readDisplayValue",
    "findOpenPopupPanels", "findAnchoredOverlays",
  ]) {
    assert.equal(typeof fd[name], "function", name);
  }
});

test("resolveOptionText: 精确命中原样返回", () => {
  const options = [{ value: "1", text: "男" }, { value: "2", text: "女" }];
  assert.equal(fd.resolveOptionText(options, "男"), "男");
  // {text,value} 与裸字符串两种形态都支持
  assert.equal(fd.resolveOptionText(["男", "女"], "女"), "女");
});

test("resolveOptionText: 别名值解析成真实选项文本（过滤型下拉的过滤词）", () => {
  const options = [
    { value: "大专", text: "大专" },
    { value: "本科", text: "本科" },
    { value: "硕士", text: "硕士研究生" },
  ];
  // 简历值是选项的别名写法，写进过滤框会滤出空菜单，必须换成选项原文
  assert.equal(fd.resolveOptionText(options, "大学本科"), "本科");
  assert.equal(fd.resolveOptionText(options, "硕士"), "硕士研究生");
});

test("resolveOptionText: 无匹配/选项不足/空值返回空串（调用方按原文写入）", () => {
  assert.equal(fd.resolveOptionText([{ text: "本科" }], "大学本科"), ""); // 单选项不解析
  assert.equal(fd.resolveOptionText([], "男"), "");
  assert.equal(fd.resolveOptionText(null, "男"), "");
  assert.equal(fd.resolveOptionText([{ text: "男" }, { text: "女" }], ""), "");
  assert.equal(fd.resolveOptionText([{ text: "男" }, { text: "女" }], "博士"), ""); // 无 ≥60 分
});

test("resolveOptionText: 年/月值不受影响（拆分日期的值本就是选项原文）", () => {
  const years = [{ text: "2024" }, { text: "2025" }, { text: "2026" }];
  assert.equal(fd.resolveOptionText(years, "2025"), "2025");
  const months = Array.from({ length: 12 }, (_, i) => ({ text: String(i + 1) }));
  assert.equal(fd.resolveOptionText(months, "4"), "4");
});
