// OneCV — 映射缓存
// 键：页面结构签名（字段种类+label+placeholder+section 语义组合哈希）。
// 值：字段特征指纹 → {path, confidence, transform}。
// 复用粒度是"特征指纹"而不是 pageFieldId：即使字段顺序/数量变化，
// 只要某字段的特征仍然匹配，就能复用它的映射。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVCache = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const CACHE_SCHEMA_VERSION = 1;
    const MAX_SIGNATURES = 300;
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

    function makeEntry(path, confidence, transform) {
      return { path, confidence, transform: transform || "" };
    }

    // 返回 {hit, matched:[{pageFieldId, path, confidence, transform}], coverage}
    function cacheLookup(cache, signature, descriptors) {
      const list = Array.isArray(descriptors) ? descriptors : [];
      const bucket = cache?.[signature];

      if (
        !bucket ||
        bucket.version !== CACHE_SCHEMA_VERSION ||
        !bucket.entries ||
        typeof bucket.entries !== "object"
      ) {
        return { hit: false, matched: [], coverage: 0 };
      }

      const fingerprintSet = new Set(list.map((descriptor) => descriptor.fingerprint));
      const byFingerprint = new Map();
      for (const [fingerprint, entry] of Object.entries(bucket.entries)) {
        if (!fingerprintSet.has(fingerprint)) continue;
        if (!entry || typeof entry !== "object" || !entry.path) continue;
        byFingerprint.set(fingerprint, entry);
      }

      const matched = [];
      for (const descriptor of list) {
        const entry = byFingerprint.get(descriptor.fingerprint);
        if (!entry) continue;
        matched.push({
          pageFieldId: descriptor.pageFieldId,
          path: entry.path,
          confidence: Number(entry.confidence) || 0.5,
          transform: entry.transform || "",
        });
      }

      const coverage = list.length ? matched.length / list.length : 0;
      // 覆盖率过低时仍返回 matched，调用方决定是否补 AI 调用
      return {
        hit: matched.length > 0,
        matched,
        coverage: Math.round(coverage * 100) / 100,
      };
    }

    // mappings: [{pageFieldId, path, confidence, transform}]
    function cacheStore(cache, signature, descriptors, mappings, now) {
      const base = cache && typeof cache === "object" ? cache : {};
      const timestamp = now || new Date().toISOString();
      const descriptorById = new Map(
        (Array.isArray(descriptors) ? descriptors : []).map((descriptor) => [descriptor.pageFieldId, descriptor])
      );

      const entries = {};
      for (const mapping of Array.isArray(mappings) ? mappings : []) {
        const descriptor = descriptorById.get(mapping.pageFieldId);
        if (!descriptor) continue;
        if (!mapping.path) continue;
        entries[descriptor.fingerprint] = makeEntry(mapping.path, mapping.confidence, mapping.transform);
      }

      // 同一签名再次写入时合并旧 entries（增量学习：AI 新映射 + 旧缓存共存）
      const existing = base[signature];
      const mergedEntries =
        existing &&
        existing.version === CACHE_SCHEMA_VERSION &&
        existing.entries &&
        typeof existing.entries === "object"
          ? { ...existing.entries, ...entries }
          : entries;

      base[signature] = {
        version: CACHE_SCHEMA_VERSION,
        savedAt: timestamp,
        lastUsedAt: timestamp,
        entries: mergedEntries,
      };

      return base;
    }

    function touchSignature(cache, signature, now) {
      if (cache?.[signature]) {
        cache[signature].lastUsedAt = now || new Date().toISOString();
      }
    }

    // 超量 + 过期清理：按 lastUsedAt 从旧到新淘汰
    function pruneCache(cache, options) {
      const base = cache && typeof cache === "object" ? { ...cache } : {};
      const maxSignatures = Number(options?.maxSignatures) || MAX_SIGNATURES;
      const maxAgeMs = Number(options?.maxAgeMs) || MAX_AGE_MS;
      const now = Date.now();

      for (const [signature, bucket] of Object.entries(base)) {
        const lastUsed = Date.parse(bucket?.lastUsedAt || bucket?.savedAt || "") || 0;
        if (now - lastUsed > maxAgeMs || bucket?.version !== CACHE_SCHEMA_VERSION) {
          delete base[signature];
        }
      }

      const keys = Object.keys(base);
      if (keys.length <= maxSignatures) return base;

      keys
        .sort(
          (a, b) =>
            (Date.parse(base[a]?.lastUsedAt || base[a]?.savedAt || "") || 0) -
            (Date.parse(base[b]?.lastUsedAt || base[b]?.savedAt || "") || 0)
        )
        .slice(0, keys.length - maxSignatures)
        .forEach((key) => delete base[key]);

      return base;
    }

    return {
      CACHE_SCHEMA_VERSION,
      MAX_SIGNATURES,
      MAX_AGE_MS,
      makeEntry,
      cacheLookup,
      cacheStore,
      touchSignature,
      pruneCache,
    };
  }
);
