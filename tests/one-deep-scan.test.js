const test = require("node:test");
const assert = require("node:assert/strict");
const deepScan = require("../shared/one-deep-scan.js");

// ---- isDeepScanExpandTrigger（C1：深扫描判定逻辑下沉可测） ----

function fakeEl(attrs, text) {
  const attributes = attrs || {};
  return {
    tagName: attributes.tagName || "BUTTON",
    className: attributes.className || "expand-btn",
    disabled: false,
    textContent: text || "",
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  };
}

const noopVisible = () => true;

test("isDeepScanExpandTrigger: 明确的展开文案命中", () => {
  assert.equal(deepScan.isDeepScanExpandTrigger(fakeEl({}, "展开全部"), noopVisible, fakeDoc()), true);
});

test("isDeepScanExpandTrigger: 提交/添加类排除", () => {
  assert.equal(deepScan.isDeepScanExpandTrigger(fakeEl({}, "提交"), noopVisible, fakeDoc()), false);
  assert.equal(deepScan.hasSectionContentIn({ awards: [{ name: "x" }] }, "awards"), true);
  assert.equal(deepScan.hasSectionContentIn({ awards: [{}, {}] }, "awards"), false);
});

test("isDeepScanExpandTrigger: 非按钮排除", () => {
  const el = fakeEl({ tagName: "DIV" }, "展开");
  assert.equal(deepScan.isDeepScanExpandTrigger(el, noopVisible, fakeDoc()), false);
});

test("isDeepScanExpandTrigger: aria-haspopup / 已展开排除", () => {
  assert.equal(deepScan.isDeepScanExpandTrigger(fakeEl({ "aria-haspopup": "true" }, "查看更多"), noopVisible, fakeDoc()), false);
  assert.equal(deepScan.isDeepScanExpandTrigger(fakeEl({ "aria-expanded": "true" }, "查看更多"), noopVisible, fakeDoc()), false);
});

// 极简 doc stub：getTargetElements 只需要 getElementById 返回 null
function fakeDoc() {
  return { getElementById: () => null };
}
