// OneCV — 深扫描（移植自参考项目）：有限点击"展开/更多"类按钮发现折叠字段。
// DOM 依赖经 deps 注入（doc/isVisible/clickLikeUser/sleep/log），便于测试与多 frame 复用。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVDeepScan = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const MAX_ROUNDS = 5;
    const POLL_TIMEOUT = 1200;
    const MAX_CLICKS = 20;
    const EXPAND_KEYWORDS = ["展开", "展开全部", "查看更多", "查看全部", "showmore", "viewmore", "expand"];
    const MORE_KEYWORDS = ["更多", "more"];
    const EXCLUDE_KEYWORDS = ["添加", "新增", "增加", "新建", "删除", "提交", "保存", "返回", "取消", "关闭", "add", "new", "plus", "delete", "submit", "save", "back", "cancel", "close"];
    // 简历里没有对应内容的区块不点展开，避免无意义点击
    const SECTION_MAP = [
      { patterns: ["教育", "学校", "专业", "学历", "学位", "毕业"], sectionKey: "educations" },
      { patterns: ["实习"], sectionKey: "internships" },
      { patterns: ["工作", "公司", "职位", "任职", "职业"], sectionKey: "workExperiences" },
      { patterns: ["项目", "产品"], sectionKey: "projects" },
      { patterns: ["证书", "认证", "资格", "等级"], sectionKey: "certificates" },
      { patterns: ["语言", "外语", "雅思", "托福", "cet"], sectionKey: "languages" },
      { patterns: ["校园", "学生", "社团", "社会", "志愿", "科研", "组织"], sectionKey: "campusExperiences" },
      { patterns: ["技能", "特长", "编程", "工具"], sectionKey: "skills" },
      { patterns: ["偏好", "期望", "求职", "目标", "薪资"], sectionKey: "jobPreferences" },
      { patterns: ["联系方式", "地址", "电话"], sectionKey: "contactAndLocation" },
      { patterns: ["证件", "身份", "护照", "户口"], sectionKey: "identityAndAuthorization" },
      { patterns: ["补充", "其他", "备注", "说明"], sectionKey: "additional" },
      { patterns: ["奖项", "获奖", "奖学金", "荣誉"], sectionKey: "awards" },
      { patterns: ["竞赛", "比赛"], sectionKey: "competitions" },
      { patterns: ["论文", "发表", "期刊", "出版物"], sectionKey: "publications" },
    ];

    function normalizeText(text) {
      return String(text || "").replace(/\s+/g, "").toLowerCase();
    }

    function getTriggerText(el) {
      const aria = el.getAttribute && el.getAttribute("aria-label");
      if (aria && aria.trim()) return normalizeText(aria);
      return normalizeText(el.textContent || "").slice(0, 30);
    }

    function getTargetElements(doc, el) {
      const targets = [];
      for (const attr of ["aria-controls", "data-target", "data-bs-target"]) {
        const value = el.getAttribute && el.getAttribute(attr);
        if (value && value.indexOf("#") === 0) {
          const target = doc.getElementById(value.slice(1));
          if (target) targets.push(target);
        }
      }
      const href = el.getAttribute && el.getAttribute("href");
      if (href && href.indexOf("#") === 0 && href.length > 1) {
        const target = doc.getElementById(href.slice(1));
        if (target) targets.push(target);
      }
      return targets;
    }

    // 纯判定逻辑（可单测）：元素是否为"展开更多"类触发器
    function isDeepScanExpandTrigger(el, isVisible, doc) {
      if (!el) return false;
      const tagName = String(el.tagName || "").toLowerCase();
      const role = String((el.getAttribute && el.getAttribute("role")) || "").toLowerCase();
      if (tagName !== "button" && tagName !== "a" && role !== "button") return false;
      if (el.disabled || (el.getAttribute && el.getAttribute("aria-disabled") === "true")) return false;
      if (String((el.getAttribute && el.getAttribute("type")) || "").toLowerCase() === "submit") return false;
      if (el.getAttribute && el.getAttribute("aria-haspopup")) return false;
      if (el.getAttribute && el.getAttribute("aria-expanded") === "true") return false;

      const text = getTriggerText(el);
      if (!text || EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword))) return false;

      const className = normalizeText(el.className || "");
      const hasExplicitExpandText = EXPAND_KEYWORDS.some((keyword) => text.includes(keyword));
      const hasHiddenTarget = getTargetElements(doc, el).some((target) => {
        if (target.hidden || (target.getAttribute && target.getAttribute("aria-hidden") === "true")) return true;
        return !isVisible(target);
      });
      const hasCollapsedState =
        (el.getAttribute && el.getAttribute("aria-expanded") === "false") ||
        (el.getAttribute && el.getAttribute("data-expanded") === "false") ||
        hasHiddenTarget;
      const hasExpandClass = /(^|[-_])expand(?:ed|able)?([_-]|$)/.test(className);
      const hasMoreText = MORE_KEYWORDS.some((keyword) => text.includes(keyword));

      if (hasExplicitExpandText) return true;
      if (hasExpandClass && hasCollapsedState) return true;
      return hasMoreText && hasCollapsedState;
    }

    function hasSectionContentIn(profile, sectionKey) {
      const section = profile ? profile[sectionKey] : null;
      if (!section) return false;
      if (Array.isArray(section)) {
        return section.some((item) =>
          item && typeof item === "object"
            ? Object.values(item).some((value) => String(value || "").trim())
            : Boolean(String(item || "").trim())
        );
      }
      if (typeof section === "object") {
        return Object.values(section).some((value) => String(value || "").trim());
      }
      return Boolean(String(section).trim());
    }

    function buttonMatchesProfile(el, resumeProfile) {
      if (!resumeProfile) return true;
      const text = getTriggerText(el);
      const matchedSections = SECTION_MAP.filter((entry) =>
        entry.patterns.some((pattern) => text.includes(normalizeText(pattern)))
      );
      if (!matchedSections.length) return true;
      return matchedSections.some((entry) => hasSectionContentIn(resumeProfile, entry.sectionKey));
    }

    function countControls(doc) {
      return doc.querySelectorAll("input, textarea, select, [contenteditable='true'], [contenteditable='']").length;
    }

    function waitForNewFields(doc, startCount, sleep) {
      if (countControls(doc) > startCount) return Promise.resolve(true);

      return new Promise((resolve) => {
        let settled = false;
        let initialTimer = null;
        let timeoutTimer = null;
        const observer = typeof MutationObserver === "function" ? new MutationObserver(check) : null;

        function finish(found) {
          if (settled) return;
          settled = true;
          if (initialTimer) clearTimeout(initialTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (observer) observer.disconnect();
          resolve(found);
        }

        function check() {
          if (countControls(doc) > startCount) finish(true);
        }

        if (observer) {
          observer.observe(doc.body || doc.documentElement || doc, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "hidden", "style", "aria-hidden"],
          });
        }
        initialTimer = setTimeout(check, 250);
        timeoutTimer = setTimeout(() => finish(false), POLL_TIMEOUT);
      });
    }

    function create(deps) {
      const doc = deps.doc;
      const isVisible = deps.isVisible;
      const clickLikeUser = deps.clickLikeUser;
      const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      const log = deps.log || (() => {});

      function findButtons(clickedElements, resumeProfile) {
        const selectors = [
          'button:not([type="submit"])',
          '[role="button"]',
          'a[class*="expand"], a[class*="Expand"]',
          'a[class*="more"], a[class*="More"]',
        ];
        return Array.from(doc.querySelectorAll(selectors.join(","))).filter((el) => {
          if (!isVisible(el) || clickedElements.has(el)) return false;
          return (
            isDeepScanExpandTrigger(el, isVisible, doc) &&
            buttonMatchesProfile(el, resumeProfile)
          );
        });
      }

      async function triggerExpandableSections(resumeProfile) {
        const clickedElements = new WeakSet();
        let totalClicked = 0;

        for (let round = 0; round < MAX_ROUNDS && totalClicked < MAX_CLICKS; round += 1) {
          const buttons = findButtons(clickedElements, resumeProfile);
          if (!buttons.length) break;

          log({ level: "info", event: "deep_scan_round", detail: { round: round + 1, buttons: buttons.length } });

          for (const button of buttons.slice(0, MAX_CLICKS - totalClicked)) {
            const startCount = countControls(doc);
            clickLikeUser(button);
            clickedElements.add(button);
            totalClicked += 1;
            await waitForNewFields(doc, startCount, sleep);
          }
        }

        if (totalClicked > 0) {
          log({ level: "info", event: "deep_scan_done", detail: { clicked: totalClicked } });
        }
        return totalClicked;
      }

      return { findButtons, triggerExpandableSections };
    }

    return {
      create,
      isDeepScanExpandTrigger,
      hasSectionContentIn,
      MAX_CLICKS,
      MAX_ROUNDS,
    };
  }
);
