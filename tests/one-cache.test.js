const test = require("node:test");
const assert = require("node:assert/strict");
const cache = require("../shared/one-cache.js");
const scanner = require("../shared/one-scanner-core.js");

function makeDescriptors(labels) {
  return scanner.buildFieldDescriptors(
    labels.map((labelText) => ({
      tag: "input",
      inputType: "text",
      labelText,
      name: labelText,
    }))
  );
}

test("cacheStore + cacheLookup: 按指纹复用映射", () => {
  const descriptors = makeDescriptors(["姓名", "邮箱"]);
  const signature = scanner.computeStructureSignature(descriptors);
  const mappings = [
    { pageFieldId: descriptors[0].pageFieldId, path: "personal.fullName", confidence: 0.9 },
    { pageFieldId: descriptors[1].pageFieldId, path: "personal.email", confidence: 0.8 },
  ];

  let store = {};
  store = cache.cacheStore(store, signature, descriptors, mappings, "2026-09-06T00:00:00Z");

  const result = cache.cacheLookup(store, signature, descriptors);
  assert.ok(result.hit);
  assert.equal(result.coverage, 1);
  assert.equal(result.matched.length, 2);
  assert.ok(result.matched.some((m) => m.path === "personal.fullName"));
});

test("cacheLookup: 页面新增字段 → 已有字段仍命中（指纹粒度复用）", () => {
  const before = makeDescriptors(["姓名", "邮箱"]);
  const signature = scanner.computeStructureSignature(before);
  let store = {};
  store = cache.cacheStore(
    store,
    signature,
    before,
    [{ pageFieldId: before[0].pageFieldId, path: "personal.fullName", confidence: 0.9 }],
    "2026-09-06T00:00:00Z"
  );

  // 新签名：多了手机号字段（签名不同，模拟"签名变了但字段特征未变"的局部复用）
  const after = makeDescriptors(["姓名", "邮箱", "手机号"]);
  const newSignature = scanner.computeStructureSignature(after);
  store[newSignature] = {
    version: 1,
    savedAt: "2026-09-06T00:00:00Z",
    lastUsedAt: "2026-09-06T00:00:00Z",
    entries: Object.fromEntries(Object.entries(store[signature].entries)),
  };

  const result = cache.cacheLookup(store, newSignature, after);
  assert.ok(result.hit);
  assert.equal(result.matched.length, 1);
  assert.ok(result.coverage > 0 && result.coverage < 1);
});

test("cacheLookup: 空缓存 / 版本不符 → 未命中", () => {
  const descriptors = makeDescriptors(["姓名"]);
  assert.equal(cache.cacheLookup({}, "sig", descriptors).hit, false);
  assert.equal(
    cache.cacheLookup({ sig: { version: 99, entries: {} } }, "sig", descriptors).hit,
    false
  );
});

test("cacheStore: 同签名重复写入合并（增量学习）", () => {
  const descriptors = makeDescriptors(["姓名", "邮箱"]);
  const signature = scanner.computeStructureSignature(descriptors);
  let store = {};
  store = cache.cacheStore(
    store,
    signature,
    descriptors,
    [{ pageFieldId: descriptors[0].pageFieldId, path: "personal.fullName", confidence: 0.9 }],
    "2026-09-06T00:00:00Z"
  );
  store = cache.cacheStore(
    store,
    signature,
    descriptors,
    [{ pageFieldId: descriptors[1].pageFieldId, path: "personal.email", confidence: 0.8 }],
    "2026-09-06T01:00:00Z"
  );

  assert.equal(Object.keys(store[signature].entries).length, 2);
  assert.equal(store[signature].savedAt, "2026-09-06T01:00:00Z");
});

test("pruneCache: 过期与超量淘汰", () => {
  const old = {
    sig_old: { version: 1, savedAt: "2020-01-01T00:00:00Z", lastUsedAt: "2020-01-01T00:00:00Z", entries: {} },
    sig_new: { version: 1, savedAt: "2026-09-06T00:00:00Z", lastUsedAt: "2026-09-06T00:00:00Z", entries: {} },
    sig_bad: { version: 99, entries: {} },
  };
  const pruned = cache.pruneCache(old, { maxAgeMs: 30 * 24 * 3600 * 1000, maxSignatures: 10 });
  assert.deepEqual(Object.keys(pruned), ["sig_new"]);

  const many = {};
  for (let i = 0; i < 15; i += 1) {
    many[`sig_${i}`] = {
      version: 1,
      savedAt: "2026-09-06T00:00:00Z",
      lastUsedAt: new Date(Date.parse("2026-09-06T00:00:00Z") + i * 1000).toISOString(),
      entries: {},
    };
  }
  const limited = cache.pruneCache(many, { maxSignatures: 10 });
  assert.equal(Object.keys(limited).length, 10);
  assert.ok(!limited.sig_0); // 最旧的被淘汰
  assert.ok(limited.sig_14);
});
