(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVFillRuntime = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase();
    }

    function collectRuntimeText(runtime) {
      const parts = [
        runtime?.label,
        runtime?.placeholder,
        runtime?.context,
        ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
      ];

      return parts.map((item) => normalizeText(item)).filter(Boolean).join(" ");
    }

    function isReadonlyDateLikeRuntime(runtime) {
      if (!runtime?.readOnly) return false;
      if (runtime?.inputType && runtime.inputType !== "text") return false;

      const text = collectRuntimeText(runtime);
      if (!text) return Boolean(runtime?.hasCalendarIcon);

      const hasDateKeyword =
        /(入学|毕业|在校|开始|结束|时间|日期|date|month|calendar)/.test(text);

      return hasDateKeyword || Boolean(runtime?.hasCalendarIcon);
    }

    function prefersMonthPrecision(runtime) {
      const text = collectRuntimeText(runtime);
      return /(入学|毕业|在校|开始|结束|出生|年月|月份|月)/.test(text);
    }

    function normalizeValueForRuntime(runtime, rawValue) {
      const text = String(rawValue ?? "").trim();
      if (!text) return "";

      if (!isReadonlyDateLikeRuntime(runtime)) {
        return text;
      }

      if (prefersMonthPrecision(runtime)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(text)) return text;
        if (/^\d{4}$/.test(text)) return `${text}-01`;
      }

      return text;
    }

    function matchesWrittenValue(runtime, actualValue, desiredValue) {
      const actual = String(actualValue ?? "").trim();
      const desired = String(desiredValue ?? "").trim();
      if (!actual || !desired) return false;

      if (isReadonlyDateLikeRuntime(runtime)) {
        if (actual === desired) return true;
        if (/^\d{4}-\d{2}$/.test(desired) && actual.startsWith(desired)) return true;
      }

      return actual === desired;
    }

    // 从附近文本提取字数限制提示（如"限200字"、"最多300字"、"不超过500字"）
    function extractLengthHint(text) {
      const match = String(text || "").match(new RegExp("(?:限|最多|不超过|至多)\\s*([0-9０-９]+)\\s*字"));
      if (!match) return 0;
      const digits = match[1].replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248));
      const num = Number(digits);
      return Number.isFinite(num) && num > 0 ? num : 0;
    }

    // 多值拆分：逗号/顿号/分号/斜杠/竖线/空白分隔（曾因正则漏写反斜杠把含小写 s
    // 的英文值切碎，如 "Business" → ["Bu","ine"]；此处必须用 \s+）
    function splitMultiValueText(value) {
      return String(value || "")
        .split(/[,，、;；/|]+|\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    // 值变换（与 one-scanner-core.js 的 TRANSFORM_RULES 一一对应）
    function applyTransform(raw, transform) {
      const text = String(raw || "").trim();
      if (!text) return "";

      switch (transform) {
        case "date_year":
          return text.match(/(\d{4})/)?.[1] || "";
        case "date_month": {
          const match = text.match(/^(\d{4})[-/.年](\d{1,2})/);
          return match ? String(Number(match[2])) : text;
        }
        case "date_day": {
          const match = text.match(/\d{4}[-/.年]\d{1,2}[-/.月](\d{1,2})/);
          return match ? String(Number(match[1])) : "";
        }
        case "phone_split": {
          const digits = text.replace(/\D/g, "");
          return digits.replace(/^86(?=\d{11}$)/, "");
        }
        default:
          return text;
      }
    }

    // 从变体库里选出"不超过 limit 的最长版本"
    // variants: [{name, value}]；limit: 0 表示无限制 → 返回 null（用完整值）
    function pickVariantForLimit(variants, limit) {
      if (!Array.isArray(variants) || !variants.length || !limit || limit <= 0) return null;
      let best = null;
      for (const variant of variants) {
        const value = String(variant && variant.value || "");
        if (!value || value.length > limit) continue;
        if (!best || value.length > best.value.length) best = variant;
      }
      return best;
    }

    // 形如日期的文本：YYYY-M(-D) / YYYY-MM(-DD)。曾因正则漏写反斜杠（/^d{4}/）
    // 恒为 false，导致只读日期状态机在主填充路径上从不触发。
    function isDateLikeText(value) {
      return /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(String(value || "").trim());
    }

    // 本地护栏：写值前对照控件选项——选项全为年份而值含 4 位年份 → 截年份；
    // 全为 1-12 → 截月份。曾因模型漏带 transform，"2026-04-27"整串写进年下拉
    // 被组件渲染成 2124 这类垃圾值（真实 Moka 页面踩坑）。
    function adaptValueToOptions(value, options) {
      const text = String(value || "").trim();
      const opts = (Array.isArray(options) ? options : [])
        .map((o) => String((o && (o.text ?? o.value)) ?? o ?? "").trim())
        .filter(Boolean);
      if (!text || opts.length < 3) return text;

      const yearCount = opts.filter((t) => /^(19|20|21)\d{2}$/.test(t)).length;
      const monthCount = opts.filter((t) => /^([1-9]|1[0-2])$/.test(t)).length;
      if (yearCount >= opts.length * 0.8) {
        const match = text.match(/(19|20|21)\d{2}/);
        return match ? match[0] : text;
      }
      if (monthCount === opts.length) {
        const match = text.match(/^(?:\d{4})[-/.年](\d{1,2})/);
        const month = match ? Number(match[1]) : Number(text);
        if (month >= 1 && month <= 12) return String(month);
      }
      return text;
    }

    // 从标注后缀推断拆分日期角色（与 annotateSameLabelGroups 的后缀格式一致）。
    // 标注走 DOM 顺序模式时不依赖 options，因此护栏在 options 不可用时也能生效
    function splitDateRoleFromLabel(label) {
      const text = String(label || "");
      if (/（(?:开始·|结束·)?年）$/.test(text)) return "year";
      if (/（(?:开始·|结束·)?月）$/.test(text)) return "month";
      return "";
    }

    // 拆分日期写值护栏：优先用标注后缀推断角色（year → 截年份，month → 截月份），
    // 无后缀时回退到 adaptValueToOptions（对照控件选项判断）。
    // 曾因模型漏带 transform，"2026-04-27"整串写进年下拉被渲染成 2124 垃圾值
    function adaptSplitDateValue(value, roleHint, options) {
      const text = String(value || "").trim();
      if (roleHint === "year") {
        const match = text.match(/(19|20|21)\d{2}/);
        return match ? match[0] : text;
      }
      if (roleHint === "month") {
        const match = text.match(/^(?:\d{4})[-/.年](\d{1,2})/);
        const month = match ? Number(match[1]) : Number(text);
        return month >= 1 && month <= 12 ? String(month) : text;
      }
      return adaptValueToOptions(text, options);
    }

    // 面板锚定判定：面板必须与字段水平重叠，且垂直距离在"打开面板"的合理范围内。
    // 曾用"垂直 900px 内"：把跨卡还开着的菜单圈进来，出生日期的延迟模糊匹配
    // 点进了教育卡结束月菜单（"1"误选事故，真实页面插桩实锤）
    function isPanelAnchored(panelRect, elementRect) {
      if (!panelRect || !elementRect) return false;
      const overlapsX = panelRect.right > elementRect.left - 8 && panelRect.left < elementRect.right + 8;
      if (!overlapsX) return false;
      const gap = panelRect.top - elementRect.top;
      return gap >= -150 && gap <= 250;
    }

    return {
      isReadonlyDateLikeRuntime,
      normalizeValueForRuntime,
      matchesWrittenValue,
      extractLengthHint,
      splitMultiValueText,
      applyTransform,
      isDateLikeText,
      adaptValueToOptions,
      splitDateRoleFromLabel,
      adaptSplitDateValue,
      isPanelAnchored,
      pickVariantForLimit,
    };
  }
);
