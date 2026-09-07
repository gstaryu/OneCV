const test = require("node:test");
const assert = require("node:assert/strict");
const rt = require("../shared/one-fill-runtime.js");

test("extractLengthHint: 常见限字提示", () => {
  assert.equal(rt.extractLengthHint("工作描述（限200字）"), 200);
  assert.equal(rt.extractLengthHint("最多300字"), 300);
  assert.equal(rt.extractLengthHint("不超过 500 字"), 500);
  assert.equal(rt.extractLengthHint("限２００字"), 200); // 全角数字
  assert.equal(rt.extractLengthHint("姓名"), 0);
});

test("pickVariantForLimit: 选不超限的最长版本", () => {
  const variants = [
    { name: "100字版", value: "a".repeat(100) },
    { name: "200字版", value: "b".repeat(200) },
    { name: "500字版", value: "c".repeat(500) },
  ];
  assert.equal(rt.pickVariantForLimit(variants, 200).name, "200字版");
  assert.equal(rt.pickVariantForLimit(variants, 300).name, "200字版");
  assert.equal(rt.pickVariantForLimit(variants, 999).name, "500字版");
  assert.equal(rt.pickVariantForLimit(variants, 50), null);
  assert.equal(rt.pickVariantForLimit(variants, 0), null);
  assert.equal(rt.pickVariantForLimit([], 200), null);
});

test("splitMultiValueText: 空格/逗号/顿号/斜杠分隔，且不切碎含小写 s 的英文词", () => {
  assert.deepEqual(rt.splitMultiValueText("Business Analysis"), ["Business", "Analysis"]);
  assert.deepEqual(rt.splitMultiValueText("JavaScript Python"), ["JavaScript", "Python"]);
  assert.deepEqual(rt.splitMultiValueText("Java、Python、Git"), ["Java", "Python", "Git"]);
  assert.deepEqual(rt.splitMultiValueText("a;b/c"), ["a", "b", "c"]);
  assert.deepEqual(rt.splitMultiValueText("  单值  "), ["单值"]);
  assert.deepEqual(rt.splitMultiValueText(""), []);
  assert.deepEqual(rt.splitMultiValueText(null), []);
});

test("applyTransform: 日期拆分与手机号拆分", () => {
  assert.equal(rt.applyTransform("2023-09-17", "date_year"), "2023");
  assert.equal(rt.applyTransform("2023-09-17", "date_month"), "9");
  assert.equal(rt.applyTransform("2023年9月17日", "date_day"), "17");
  assert.equal(rt.applyTransform("+8613800138000", "phone_split"), "13800138000");
  assert.equal(rt.applyTransform("13800138000", "phone_split"), "13800138000");
  assert.equal(rt.applyTransform("原文", ""), "原文");
});

test("isDateLikeText: 日期形态判定（回归：曾因 /^d{4}/ 恒为 false）", () => {
  assert.equal(rt.isDateLikeText("2024-05-01"), true);
  assert.equal(rt.isDateLikeText("2024-5"), true);
  assert.equal(rt.isDateLikeText("2024-05"), true);
  assert.equal(rt.isDateLikeText("20240501"), false);
  assert.equal(rt.isDateLikeText("2024年5月"), false);
  assert.equal(rt.isDateLikeText(""), false);
  assert.equal(rt.isDateLikeText("姓名"), false);
});

test("adaptValueToOptions: 选项全为年份 → 截取年份", () => {
  const years = [{ text: "2024" }, { text: "2025" }, { text: "2026" }];
  assert.equal(rt.adaptValueToOptions("2026-04-27", years), "2026");
  assert.equal(rt.adaptValueToOptions("2026", years), "2026");
  assert.equal(rt.adaptValueToOptions("1999年", years), "1999");
});

test("adaptValueToOptions: 选项全为月份 → 截取月份数字", () => {
  const months = [{ text: "1" }, { text: "2" }, { text: "12" }];
  assert.equal(rt.adaptValueToOptions("2026-04-27", months), "4");
  assert.equal(rt.adaptValueToOptions("2026-12", months), "12");
  assert.equal(rt.adaptValueToOptions("7", months), "7");
  assert.equal(rt.adaptValueToOptions("13", months), "13"); // 越界不改
  assert.equal(rt.adaptValueToOptions("张三", months), "张三"); // 非日期不改
});

test("adaptValueToOptions: 选项过少或混合选项不改写", () => {
  assert.equal(rt.adaptValueToOptions("2026-04-27", [{ text: "2026" }]), "2026-04-27");
  const mixed = [{ text: "2026" }, { text: "1" }, { text: "12" }];
  assert.equal(rt.adaptValueToOptions("2026-04-27", mixed), "2026-04-27");
  assert.equal(rt.adaptValueToOptions("2026-04-27", []), "2026-04-27");
});

test("splitDateRoleFromLabel: 从标注后缀取角色", () => {
  assert.equal(rt.splitDateRoleFromLabel("起止时间（开始·年）"), "year");
  assert.equal(rt.splitDateRoleFromLabel("起止时间（结束·月）"), "month");
  assert.equal(rt.splitDateRoleFromLabel("获奖时间（年）"), "year");
  assert.equal(rt.splitDateRoleFromLabel("获奖时间（月）"), "month");
  assert.equal(rt.splitDateRoleFromLabel("起止时间"), "");
  assert.equal(rt.splitDateRoleFromLabel("公司名称（开始·年）".replace("（开始·年）", "")), "");
});

test("adaptSplitDateValue: 后缀角色优先，options 兜底", () => {
  // 后缀生效时不需要 options（真实 Moka 页 options 常常扫描不到）
  assert.equal(rt.adaptSplitDateValue("2026-04-27", "year", []), "2026");
  assert.equal(rt.adaptSplitDateValue("2026-04-27", "month", []), "4");
  assert.equal(rt.adaptSplitDateValue("12", "month", []), "12");
  assert.equal(rt.adaptSplitDateValue("13", "month", []), "13");
  assert.equal(rt.adaptSplitDateValue("2026-04-27", "", [{ text: "2026" }, { text: "2027" }, { text: "2028" }]), "2026");
  assert.equal(rt.adaptSplitDateValue("张三", "year", []), "张三");
});

test("isPanelAnchored: 水平重叠+垂直窗口内锚定，跨卡菜单排除", () => {
  const elRect = { left: 100, right: 400, top: 500 };
  assert.equal(rt.isPanelAnchored({ left: 100, right: 402, top: 532 }, elRect), true);   // 正下方
  assert.equal(rt.isPanelAnchored({ left: 120, right: 380, top: 700 }, elRect), true);   // 窗口内偏下
  assert.equal(rt.isPanelAnchored({ left: 100, right: 400, top: 860 }, elRect), false);  // 跨卡菜单排除
  assert.equal(rt.isPanelAnchored({ left: 500, right: 800, top: 530 }, elRect), false);  // 不同列排除
});
