// OneCV — 选项匹配（移植自参考项目 getMatchScore/pickBestOption/MATCH_ALIAS_GROUPS）
// 纯逻辑模块：别名展开 + 打分匹配，Node 测试可直接覆盖。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVOptionMatch = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    // 中英别名组（唯一来源 shared/one-alias-groups.js，与 one-schema.js 共用；
    // Node 单测走 require，浏览器中该模块先于本模块加载）
    const ALIAS_GROUPS_SOURCE =
      typeof module === "object" && module.exports
        ? require("./one-alias-groups.js")
        : typeof globalThis !== "undefined"
          ? globalThis.OneCVAliasGroups
          : null;
    const MATCH_ALIAS_GROUPS = ALIAS_GROUPS_SOURCE?.GROUPS || [];

    function normalizeForMatch(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/['"`’‘”“]/g, "")
        .replace(/[()（）[\]【】{}<>]/g, "")
        .replace(/[.,，/\\-_:：;+]/g, "");
    }

    function expandMatchVariants(value) {
      const text = String(value || "").trim();
      if (!text) return [];

      const normalized = normalizeForMatch(text);
      const variants = new Set([normalized]);

      for (const group of MATCH_ALIAS_GROUPS) {
        if (group.values && group.values.includes(normalized)) {
          group.values.forEach((item) => variants.add(item));
        }
      }

      return Array.from(variants);
    }

    function getMatchScore(optionText, candidateText) {
      const optionVariants = expandMatchVariants(optionText);
      const candidateVariants = expandMatchVariants(candidateText);
      let bestScore = 0;

      for (const optionVariant of optionVariants) {
        for (const candidateVariant of candidateVariants) {
          if (!optionVariant || !candidateVariant) continue;
          if (optionVariant === candidateVariant) return 100;
          if (optionVariant.includes(candidateVariant) || candidateVariant.includes(optionVariant)) {
            bestScore = Math.max(bestScore, 75);
          }
        }
      }

      return bestScore;
    }

    // options: [{label, value, el}]；desired: string | string[]
    function pickBestOption(options, desired) {
      const candidates = Array.isArray(desired) ? desired : [desired];

      let exact = null;
      let fuzzy = null;

      for (const option of options || []) {
        const label = String(option.label || option.value || "").trim();
        if (!label) continue;

        for (const candidate of candidates) {
          const score = getMatchScore(label, candidate);
          if (score >= 100) {
            exact = option;
            break;
          }
          if (!fuzzy || score > fuzzy.score) {
            fuzzy = { option, score };
          }
        }
        if (exact) break;
      }

      return exact || (fuzzy && fuzzy.score >= 60 ? fuzzy.option : null);
    }

    function isAffirmative(value) {
      const normalized = normalizeForMatch(value);
      const yesGroup = MATCH_ALIAS_GROUPS.find((group) => group.key === "yes");
      return Boolean(yesGroup && yesGroup.values.includes(normalized));
    }

    return {
      MATCH_ALIAS_GROUPS,
      normalizeForMatch,
      expandMatchVariants,
      getMatchScore,
      pickBestOption,
      isAffirmative,
    };
  }
);
