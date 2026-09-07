const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../shared/one-schema.js");

// ---- mergeProfileValues（C2：导入合并策略单一实现） ----

test("mergeProfileValues: group 字段非空才覆盖，list 整组替换", () => {
  const target = schema.createEmptyResumeProfile();
  schema.mergeProfileValues(target, {
    personal: { fullName: "张三", email: "z@e.com" },
    educations: [{ school: "清华大学" }],
  });

  assert.equal(target.personal.fullName, "张三");
  assert.equal(target.personal.email, "z@e.com");
  assert.equal(target.personal.phoneCountryCode, "");
  assert.equal(target.educations[0].school, "清华大学");
});

// ---- getSectionSlotGaps（Phase 2：段落数缺口提醒） ----

test("getSectionSlotGaps: 页面段数少于简历条数时返回缺口", () => {
  const profile = {
    educations: [{ school: "硕士学校" }, { school: "本科学校" }],
    internships: [{ company: "A" }],
    workExperiences: [{}, {}],
  };
  const gaps = schema.getSectionSlotGaps(
    ["educations.0.school", "educations.0.major", "internships.0.company"],
    profile
  );

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].sectionKey, "educations");
  assert.equal(gaps[0].resumeCount, 2);
  assert.equal(gaps[0].pageCount, 1);
});

test("getSectionSlotGaps: 页面未出现该区块时不提示", () => {
  const profile = { educations: [{ school: "A" }, { school: "B" }] };
  const gaps = schema.getSectionSlotGaps(["personal.fullName"], profile);
  assert.equal(gaps.length, 0);
});

test("getSectionSlotGaps: 空条目不计入简历条数", () => {
  const profile = { internships: [{ company: "A" }, {}, { company: "" }] };
  const gaps = schema.getSectionSlotGaps(["internships.0.company"], profile);
  assert.equal(gaps.length, 0);
});
