// OneCV — 中英选项别名词典（唯一来源）
// 消费方：one-schema.js（expandSelectVariants：schema 选项归一化）
//         one-option-match.js（expandMatchVariants / isAffirmative：站点选项匹配）
// values 一律为 normalizeForMatch 归一化后的形式；两组件按需展开，词典只是数据。
// 浏览器中由 manifest/页面先于上述两个模块加载；Node 单测经 require 引用。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVAliasGroups = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const GROUPS = [
      { key: "yes", values: ["yes", "y", "true", "1", "是", "有", "愿意", "可以", "present", "current", "currently"] },
      { key: "no", values: ["no", "n", "false", "0", "否", "无", "不愿意", "不可以", "不需要"] },
      { key: "male", values: ["male", "man", "m", "男", "男性"] },
      { key: "female", values: ["female", "woman", "f", "女", "女性"] },
      { key: "nonbinary", values: ["nonbinary", "non-binary", "非二元"] },
      { key: "prefer-not-say", values: ["prefernottosay", "notspecified", "不方便透露"] },
      { key: "single", values: ["single", "未婚"] },
      { key: "married", values: ["married", "已婚"] },
      { key: "highschool", values: ["highschool", "高中"] },
      { key: "associate", values: ["associate", "大专", "大学专科"] },
      { key: "bachelor", values: ["bachelor", "undergraduate", "本科", "学士", "大学本科"] },
      { key: "master", values: ["master", "masters", "硕士", "硕士研究生"] },
      { key: "mba", values: ["mba"] },
      { key: "phd", values: ["phd", "doctorate", "博士", "博士研究生", "博士后"] },
      { key: "other", values: ["other", "其他"] },
      { key: "fulltime", values: ["fulltime", "full-time", "全职"] },
      { key: "parttime", values: ["parttime", "part-time", "兼职"] },
      { key: "internship", values: ["internship", "intern", "实习"] },
      { key: "contract", values: ["contract", "contractor", "合同"] },
      { key: "freelance", values: ["freelance", "自由职业"] },
      { key: "onsite", values: ["onsite", "on-site", "现场办公", "到岗办公"] },
      { key: "hybrid", values: ["hybrid", "混合办公"] },
      { key: "remote", values: ["remote", "远程办公"] },
      { key: "flexible", values: ["flexible", "灵活"] },
      { key: "graduated", values: ["graduated", "已毕业"] },
      { key: "expected", values: ["expected", "预计毕业"] },
      { key: "enrolled", values: ["enrolled", "在读"] },
      { key: "dropped", values: ["dropped", "肄业"] },
      { key: "idcard", values: ["identitycard", "idcard", "身份证"] },
      { key: "passport", values: ["passport", "护照"] },
      { key: "residencepermit", values: ["residencepermit", "居留许可"] },
      { key: "regularfulltime", values: ["regularfulltime", "fulltimedegree", "统招", "全日制", "统招全日制", "全国普通高等院校全日制"] },
      { key: "parttimedegree", values: ["parttimedegree", "nonfulltime", "非全日制", "非统招", "全国普通高等院校非全日制"] },
      { key: "overseas", values: ["overseasstudy", "studyabroad", "海外留学"] },
      { key: "jointprogram", values: ["jointprogram", "jointtraining", "联合培养"] },
      { key: "commissioned", values: ["commissionedtraining", "委托培养"] },
      { key: "native", values: ["native", "母语"] },
      { key: "fluent", values: ["fluent", "流利"] },
      { key: "professional", values: ["professional", "business", "工作熟练"] },
      { key: "intermediate", values: ["intermediate", "中等"] },
      { key: "basic", values: ["basic", "基础"] },
      { key: "studentorganization", values: ["studentorganization", "学生组织"] },
      { key: "club", values: ["club", "association", "社团"] },
      { key: "volunteer", values: ["volunteer", "志愿服务"] },
      { key: "research", values: ["research", "科研"] },
      { key: "competition", values: ["competition", "contest", "竞赛"] },
    ];

    return { GROUPS };
  }
);
