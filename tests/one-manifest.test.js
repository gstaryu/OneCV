const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ---- manifest 注入清单一致性（B2 回归防护） ----
// 曾因 sidepanel 手工维护第二份注入清单（漏 option-match/date-picker）导致
// 重注入后 content script 崩溃。sidepanel 现在读 getManifest()；此处守护
// manifest 自身的依赖顺序。

test("manifest: content_scripts 必需模块齐全", () => {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const js = manifest.content_scripts[0].js;

  const required = [
    "shared/one-alias-groups.js",
    "shared/one-schema.js",
    "shared/one-field-text.js",
    "shared/one-fill-runtime.js",
    "shared/one-option-match.js",
    "shared/one-scanner-dom.js",
    "shared/one-fill-dom.js",
    "shared/one-scanner-core.js",
    "shared/one-date-picker.js",
    "shared/one-deep-scan.js",
    "shared/one-map-parse.js",
    "shared/one-cache.js",
    "shared/one-diagnostics.js",
    "shared/one-storage.js",
    "content.js",
  ];

  for (const item of required) {
    assert.ok(js.includes(item), "缺少模块: " + item);
  }

  assert.ok(!js.includes("shared/one-field-semantics.js"), "死模块 one-field-semantics 应已移除");
});

test("manifest: 模块加载顺序满足依赖", () => {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const js = manifest.content_scripts[0].js;

  const orderOk = (first, second) => {
    const firstIdx = js.indexOf(first);
    const secondIdx = js.indexOf(second);
    assert.ok(firstIdx !== -1 && secondIdx !== -1, "模块缺失: " + first + " / " + second);
    assert.ok(firstIdx < secondIdx, "加载顺序错误: " + first + " 应先于 " + second);
  };

  orderOk("shared/one-alias-groups.js", "shared/one-schema.js");
  orderOk("shared/one-alias-groups.js", "shared/one-option-match.js");
  orderOk("shared/one-fill-runtime.js", "shared/one-scanner-dom.js");
  orderOk("shared/one-option-match.js", "shared/one-fill-dom.js");
  orderOk("shared/one-scanner-core.js", "content.js");
});
