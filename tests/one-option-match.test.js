const test = require("node:test");
const assert = require("node:assert/strict");
const om = require("../shared/one-option-match.js");

test("getMatchScore: 精确 100 / 包含 75 / 别名 100", () => {
  assert.equal(om.getMatchScore("本科", "本科"), 100);
  assert.equal(om.getMatchScore("大学本科", "本科"), 100); // 别名组
  assert.equal(om.getMatchScore("硕士研究生", "硕士"), 100);
  assert.equal(om.getMatchScore("计算机科学与技术", "计算机"), 75);
  assert.equal(om.getMatchScore("博士", "本科"), 0);
});

test("pickBestOption: 精确优先于模糊", () => {
  const options = [
    { label: "大专", el: 1 },
    { label: "本科", el: 2 },
    { label: "硕士研究生", el: 3 },
  ];
  assert.equal(om.pickBestOption(options, "硕士").el, 3);
  assert.equal(om.pickBestOption(options, "大学本科").el, 2); // 别名命中本科
  assert.equal(om.pickBestOption(options, "博士后"), null); // 无 ≥60 分
});

test("pickBestOption: 多候选（多选）", () => {
  const options = [{ label: "北京" }, { label: "上海" }, { label: "杭州" }];
  const picked = [options[0], options[1]].filter((o) => om.pickBestOption(options, [o.label, "广州"]));
  assert.equal(picked.length, 2);
});

test("isAffirmative: 是/yes/有 同组", () => {
  assert.ok(om.isAffirmative("是"));
  assert.ok(om.isAffirmative("yes"));
  assert.ok(om.isAffirmative("有"));
  assert.ok(!om.isAffirmative("否"));
});

test("date-picker parseDateParts: 年月 / 年月日 / 非法", () => {
  const dp = require("../shared/one-date-picker.js");
  assert.deepEqual(dp.parseDateParts("2024-09"), { year: 2024, month: 9, day: 0 });
  assert.deepEqual(dp.parseDateParts("2024-09-17"), { year: 2024, month: 9, day: 17 });
  assert.deepEqual(dp.parseDateParts("2002-06"), { year: 2002, month: 6, day: 0 });
  assert.deepEqual(dp.parseDateParts("abc"), { year: 0, month: 0, day: 0 });
});
