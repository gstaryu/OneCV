// OneCV — AI 映射结果解析与校验（容错层）
// 模型可能返回：markdown 围栏、前后缀自然语言、单引号 JSON、尾逗号、
// 简写形式 {"f1": "path"} 或 {"mappings": {...}}。这里统一容错并做合法性校验。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVMapParse = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    // ----------------------------------------------------------------------
    // JSON 提取容错
    // ----------------------------------------------------------------------
    function stripMarkdownFences(text) {
      let out = String(text || "").trim();
      const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) out = fence[1].trim();
      return out;
    }

    function extractJsonObject(text) {
      const stripped = stripMarkdownFences(text);
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      return stripped.slice(start, end + 1);
    }

    // 截断修复：模型输出被 max_tokens 截断时，补齐未闭合的字符串/括号再试
    function repairTruncatedJson(text) {
      let out = "";
      let inString = false;
      let escaped = false;
      const stack = [];
      for (const char of String(text || "")) {
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          out += char;
          continue;
        }
        if (char === '"') {
          inString = true;
          out += char;
          continue;
        }
        if (char === "{" || char === "[") stack.push(char);
        if (char === "}" || char === "]") stack.pop();
        out += char;
      }
      if (inString) out += '"';
      // 尾部悬空的逗号/冒号直接去掉，再按开栈顺序闭合
      out = out.replace(/,\s*$/, "").replace(/:\s*$/, "");
      while (stack.length) out += stack.pop() === "{" ? "}" : "]";
      return out;
    }

    function parseJsonLoose(text) {
      // 完全没有闭合括号（典型 max_tokens 截断）：直接对全文尝试截断修复
      const stripped = stripMarkdownFences(text);
      let candidate = extractJsonObject(text);
      if (!candidate && stripped.includes("{")) {
        try {
          return JSON.parse(repairTruncatedJson(stripped));
        } catch (_) {
          /* 继续常规流程 */
        }
      }
      if (!candidate) return null;

      const attempts = [
        candidate,
        candidate.replace(/,\s*([}\]])/g, "$1"), // 尾逗号
        candidate.replace(/'/g, '"'), // 单引号
        candidate.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"'), // 单引号 + 尾逗号
      ];

      for (const attempt of attempts) {
        try {
          return JSON.parse(attempt);
        } catch (_) {
          /* 尝试下一个 */
        }
      }

      // 全部失败：若疑似截断（括号不平衡）再试截断修复
      const repaired = repairTruncatedJson(candidate);
      if (repaired !== candidate) {
        try {
          return JSON.parse(repaired);
        } catch (_) {
          /* 放弃 */
        }
      }
      return null;
    }

    // ----------------------------------------------------------------------
    // 映射归一化与校验
    // ----------------------------------------------------------------------
    function clampConfidence(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.min(1, Math.max(0, Math.round(num * 100) / 100));
    }

    function normalizeResumePath(value) {
      const path = String(value || "").trim();
      if (!path) return "";
      // 允许 personal.email / educations.0.school 形态；去掉可能的 "$." 前缀
      return path.replace(/^\$\.?/, "");
    }

    // 返回 { mappings: [{fieldId, path, confidence, transform}], ignored: [{fieldId, reason}], error }
    function parseMappingResponse(text, options) {
      const opts = options || {};
      const validFieldIds = new Set(Array.isArray(opts.validFieldIds) ? opts.validFieldIds : []);
      const validPaths = new Set(Array.isArray(opts.validPaths) ? opts.validPaths : []);
      const validTransforms = new Set(
        Array.isArray(opts.validTransforms) ? opts.validTransforms : Object.keys(opts.validTransforms || {})
      );

      const parsed = parseJsonLoose(text);
      if (!parsed || typeof parsed !== "object") {
        return { mappings: [], ignored: [], error: "无法从模型输出中解析出 JSON 对象" };
      }

      // 兼容 {"mappings": {...}} / 直接 {"f1": {...}}
      let rawMap = parsed;
      if (
        parsed.mappings &&
        typeof parsed.mappings === "object" &&
        !Array.isArray(parsed.mappings)
      ) {
        rawMap = parsed.mappings;
      }

      const mappings = [];
      const ignored = [];

      for (const [fieldId, rawValue] of Object.entries(rawMap)) {
        if (validFieldIds.size && !validFieldIds.has(fieldId)) {
          ignored.push({ fieldId, reason: "unknown_field_id" });
          continue;
        }

        let path = "";
        let confidence = null;
        let transform = "";

        if (typeof rawValue === "string") {
          path = rawValue;
        } else if (rawValue && typeof rawValue === "object") {
          path = rawValue.path ?? rawValue.resumePath ?? rawValue.target ?? "";
          confidence = clampConfidence(rawValue.confidence ?? rawValue.score);
          transform = String(rawValue.transform || "");
        }

        path = normalizeResumePath(path);
        if (!path) {
          ignored.push({ fieldId, reason: "empty_path" });
          continue;
        }

        if (validPaths.size && !validPaths.has(path)) {
          ignored.push({ fieldId, reason: `invalid_path:${path}` });
          continue;
        }

        if (transform && validTransforms.size && !validTransforms.has(transform)) {
          transform = ""; // 未知 transform 一律丢弃，交给本地默认逻辑
        }

        mappings.push({
          fieldId,
          path,
          confidence: confidence == null ? 0.5 : confidence,
          transform: transform || "",
        });
      }

      return { mappings, ignored: ignored.slice(0, 50), error: null };
    }

    return {
      stripMarkdownFences,
      extractJsonObject,
      repairTruncatedJson,
      parseJsonLoose,
      clampConfidence,
      normalizeResumePath,
      parseMappingResponse,
    };
  }
);
