// OneCV — 结构化诊断日志
// 任何自动化行为都要有对应日志（字段扫描、AI 映射、实际写入、失败原因）。
// 本模块只负责"条目构造 + 本地缓冲 + 可选转发到 background 汇聚"。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVDiagnostics = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const LEVELS = ["debug", "info", "warn", "error"];
    const LOCAL_LIMIT = 500;
    const localBuffer = [];

    function makeEntry(level, event, detail) {
      const safeLevel = LEVELS.includes(level) ? level : "info";
      const entry = {
        ts: new Date().toISOString(),
        level: safeLevel,
        event: String(event || ""),
        detail: sanitizeDetail(detail),
      };
      localBuffer.push(entry);
      if (localBuffer.length > LOCAL_LIMIT) localBuffer.shift();
      return entry;
    }

    function sanitizeDetail(detail) {
      if (detail == null) return null;
      if (typeof detail === "string") return detail.slice(0, 2000);
      if (typeof detail === "number" || typeof detail === "boolean") return detail;
      if (typeof detail === "object") {
        try {
          return JSON.parse(JSON.stringify(detail));
        } catch (_) {
          return String(detail);
        }
      }
      return String(detail);
    }

    function log(options) {
      const entry = makeEntry(
        options?.level || "info",
        options?.event,
        options?.detail
      );
      if (typeof console !== "undefined") {
        const line = `[OneCV][${entry.level}] ${entry.event}`;
        // 对象 detail 字符串化后再交给 console：chrome://extensions 的错误页
        // 只做文本拼接，直接传对象会显示成 [object Object]（用户报错截图实证）
        const printed =
          entry.detail == null
            ? ""
            : typeof entry.detail === "string"
              ? entry.detail
              : JSON.stringify(entry.detail);
        if (entry.level === "error") console.error(line, printed);
        else if (entry.level === "warn") console.warn(line, printed);
        else console.log(line, printed);
      }
      return entry;
    }

    function getLocalBuffer() {
      return localBuffer.slice();
    }

    // content script / sidepanel 把日志转发给 background 汇聚（fire-and-forget）
    function flushToBackground() {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
      const entries = localBuffer.slice();
      if (!entries.length) return;
      try {
        chrome.runtime.sendMessage({ action: "onecv:log", entries }).catch(() => {});
      } catch (_) {
        /* 扩展上下文失效时忽略 */
      }
    }

    function exportAsText(entries) {
      const list = Array.isArray(entries) ? entries : localBuffer;
      return list
        .map((entry) => {
          const detail =
            entry.detail == null
              ? ""
              : typeof entry.detail === "string"
                ? entry.detail
                : JSON.stringify(entry.detail);
          return `${entry.ts}\t${entry.level.toUpperCase()}\t${entry.event}\t${detail}`;
        })
        .join("\n");
    }

    return {
      LEVELS,
      log,
      debug: (event, detail) => log({ level: "debug", event, detail }),
      warn: (event, detail) => log({ level: "warn", event, detail }),
      error: (event, detail) => log({ level: "error", event, detail }),
      getLocalBuffer,
      flushToBackground,
      exportAsText,
    };
  }
);
