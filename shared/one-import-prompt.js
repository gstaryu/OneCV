// OneCV — 简历文本导入 prompt 构造
// 成本说明：模板用 initial 模式（每个列表区块 1 条样例）；选项规则按
// section.field 去重（原实现按 max 槽位重复展开，token 成本数倍）。
// 归一化侧 OneCVSchema.normalizeResumeProfile 会把多出来的条目裁剪到槽位上限。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVImportPrompt = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    // 按区块聚合枚举字段：group 区块逐字段一次；list 区块所有条目共享同一组字段，
    // 只输出一次（带 .<i> 占位说明）。
    function buildOptionRules(schema) {
      const lines = [];
      for (const section of schema.sections) {
        const prefix = section.type === "list" ? `${section.key}.<i>.` : `${section.key}.`;
        for (const field of section.fields) {
          if (!Array.isArray(field.options) || !field.options.length) continue;
          const options = field.options.filter(Boolean).join(" | ");
          if (options) lines.push(`- ${prefix}${field.key}: ${options}`);
        }
      }
      return lines.join("\n");
    }

    function buildResumeImportPrompt(schema, rawText) {
      const template = schema.createEmptyResumeProfile({ mode: "initial" });
      // 列表区块标注真实槽位上限，让模型知道可输出多条
      const slotNotes = schema.sections
        .filter((section) => section.type === "list")
        .map((section) => `${section.key}（最多 ${schema.getListSectionMaxItems(section)} 条）`)
        .join("、");

      return [
        "请把下面的原始简历内容提取到固定 JSON 模板中。",
        "要求：",
        "1. 只输出 JSON，不要 markdown 代码块，不要解释。",
        "2. 只能使用模板中已有字段，不要新增字段。",
        "3. 没有信息的字段保持空字符串。",
        "4. 列表字段按时间从近到远填写；模板中每个列表仅示意一个条目结构，可按需输出多条，槽位上限：",
        slotNotes + "。",
        "5. 日期尽量输出为 YYYY-MM-DD；若只能确认到月份，可输出 YYYY-MM。",
        "6. 经历描述类字段（description/achievements/highlights）保留原文中的量化结果与关键细节，不要改写扩写。",
        "7. 下列枚举字段只能使用给定选项值：",
        buildOptionRules(schema),
        "",
        "固定 JSON 模板：",
        JSON.stringify(template, null, 2),
        "",
        "原始简历内容：",
        String(rawText || ""),
      ].join("\n");
    }

    return { buildResumeImportPrompt, buildOptionRules };
  }
);
