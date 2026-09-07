// OneCV — DOM 字段扫描层（从 content.js 迁出）
// 职责：label 多轨提取 / 区块语义文本 / 附近文本 / RawFieldInfo 构造 / 文档扫描。
// 纯转换（Raw → Descriptor、结构签名）在 one-scanner-core.js；本模块只碰 DOM。
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./one-field-text.js") : root.OneCVFieldText,
    typeof module === "object" && module.exports ? require("./one-fill-runtime.js") : root.OneCVFillRuntime
  );

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVScannerDom = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (OneCVFieldText, OneCVFillRuntime) {
    "use strict";

    function isVisible(element) {
      if (!element || !element.getClientRects().length) return false;
      const view = (element.ownerDocument && element.ownerDocument.defaultView) || window;
      const style = view.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
      return true;
    }

    function isSkippableInput(element) {
      const type = String(element.getAttribute("type") || "").toLowerCase();
      return ["hidden", "file", "password", "submit", "button", "image", "reset"].includes(type) || element.disabled;
    }

    function textContentOf(element) {
      if (!element) return "";
      return String(element.textContent || "").replace(/\s+/g, " ").trim();
    }

    // ---- 结构化 label 提取（移植自参考项目 collectNearbyLabelCandidates 等） ----
    const LABEL_LIKE_SELECTOR =
      '[class*="label"],[class*="Label"],[class*="title"],[class*="Title"],[class*="name"],[class*="Name"],[class*="caption"],[class*="Caption"],[class*="header"],[class*="Header"],label,legend,dt,th';
    const CONTROL_SELECTOR =
      'input, textarea, select, button, option, svg, path, style, script, noscript, [contenteditable="true"], [contenteditable=""], [aria-hidden="true"]';
    const STRUCTURAL_CONTAINER_SELECTOR =
      '[class*="form"],[class*="Form"],[class*="field"],[class*="Field"],[class*="item"],[class*="Item"],[class*="row"],[class*="Row"],[class*="group"],[class*="Group"],[class*="cell"],[class*="Cell"],fieldset,section,article,tr,li,td,th,dl';

    function cssEscapeValue(value) {
      if (root.CSS && typeof root.CSS.escape === "function") return root.CSS.escape(value);
      return String(value).replace(new RegExp("[" + String.fromCharCode(34, 92) + "]", "g"), String.fromCharCode(92) + String.fromCharCode(36) + "&");
    }

    function pushUniqueMeaningfulText(list, value) {
      const text = OneCVFieldText.normalizeFieldText(value || "");
      if (!OneCVFieldText.isMeaningfulFieldText(text)) return;
      if (!list.includes(text)) list.push(text);
    }

    function getNodeTextWithoutControls(node, skipNode, maxLength) {
      if (!node) return "";
      maxLength = maxLength || 200;
      try {
        const clone = node.cloneNode(true);
        const selectors = [CONTROL_SELECTOR];
        if (skipNode && skipNode.id) selectors.push("#" + cssEscapeValue(skipNode.id));
        for (const child of clone.querySelectorAll(selectors.join(","))) child.remove();
        const text = OneCVFieldText.normalizeFieldText(clone.textContent || "");
        if (!OneCVFieldText.isMeaningfulFieldText(text)) return "";
        return maxLength && text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
      } catch (_) {
        return "";
      }
    }

    function collectRelevantContainers(el) {
      const containers = [];
      let current = el.parentElement;
      while (current && containers.length < 4) {
        if (current.matches && current.matches(STRUCTURAL_CONTAINER_SELECTOR)) containers.push(current);
        current = current.parentElement;
      }
      if (!containers.length && el.parentElement) containers.push(el.parentElement);
      return containers;
    }

    function collectNearbyLabelCandidates(el) {
      const candidates = [];
      const containers = collectRelevantContainers(el);

      for (const container of containers) {
        for (const child of Array.from(container.children || [])) {
          if (child === el || (child.contains && child.contains(el))) continue;
          const text = getNodeTextWithoutControls(child, el, 120);
          pushUniqueMeaningfulText(candidates, text);
          const nested = child.querySelectorAll ? child.querySelectorAll(LABEL_LIKE_SELECTOR) : [];
          for (const node of nested) {
            pushUniqueMeaningfulText(candidates, getNodeTextWithoutControls(node, el, 120));
          }
        }
      }

      let current = el;
      for (let depth = 0; current && depth < 4; depth += 1) {
        pushUniqueMeaningfulText(candidates, getNodeTextWithoutControls(current.previousElementSibling, el, 120));
        pushUniqueMeaningfulText(candidates, getNodeTextWithoutControls(current.nextElementSibling, el, 120));
        current = current.parentElement;
      }

      return candidates;
    }

    // ---- label 提取（多轨启发式，按可靠性排序） ----
    function findLabelForElement(element) {
      // 1. <label for=id>
      const htmlId = element.id;
      if (htmlId) {
        try {
          const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(htmlId)}"]`);
          if (label && isVisible(label)) return textContentOf(label);
        } catch (_) { /* 防御性兜底 */ }
      }

      // 2. 包裹式 <label><input>文本</label>
      //    自定义 select（如 Moka sd-Select）的 wrapping label 里是 display-value（当前值），
      //    不是字段名——此时向外层字段容器找 title 元素。
      const wrappingLabel = element.closest("label");
      if (wrappingLabel) {
        const cloneText = textContentOf(wrappingLabel);
        const ownValue = String(element.value || "").trim();
        if (cloneText && cloneText !== ownValue) return cloneText;

        const fieldBox = element.closest('[class*="field" i], [class*="item" i], [class*="form-group" i], td, li');
        if (fieldBox) {
          const titleEl = fieldBox.querySelector('[class*="title" i]');
          const titleText = textContentOf(titleEl);
          if (titleText && titleText.length <= 20 && titleText !== ownValue && fieldBox.contains(wrappingLabel)) {
            return titleText;
          }
        }
        if (cloneText) return cloneText;
      }

      // 3. aria-labelledby
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map((refId) => {
          const ref = element.ownerDocument.getElementById(refId);
          return ref ? textContentOf(ref) : "";
        }).filter(Boolean);
        if (parts.length) return parts.join(" ");
      }

      // 4. aria-label
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      // 4.5 最近表单项容器内的直接 <label> 子元素（Moka atsx-form-item /
      //     Element el-form-item / Ant ant-form-item 等，site-notes §4 建议的最高优先级）。
      //     曾因只进评分候选池，被"合并邻居文本"（含关键词加分）反超而取错 label。
      const formItem = element.closest('[class*="form-item" i], [class*="form-group" i]');
      if (formItem) {
        for (const child of formItem.children) {
          if (child.tagName === "LABEL" && !child.contains(element)) {
            const text = textContentOf(child);
            if (text && text.length <= 30) return text;
          }
        }
      }

      // 5. 表格布局：同 tr 的第一个 th/td 作为行头
      const row = element.closest("tr");
      if (row) {
        const header = row.querySelector("th, td:first-child");
        if (header && !header.contains(element)) {
          const text = textContentOf(header);
          if (OneCVFieldText.isMeaningfulFieldText(text)) return text;
        }
      }

      // 5.5 字段容器 title 兜底（Moka apply-field 等：标题在控件容器的 .title 元素里）。
      // 字段容器可能多层嵌套（如 Moka: item-CNFmjn2r6y 外面才是 apply-field），逐级向上找。
      {
        const ownValue = String(element.value || "").trim();
        let fieldBox = element.closest('[class*="field" i], [class*="item" i], [class*="form-group" i], td, li');
        for (let hop = 0; hop < 4 && fieldBox; hop += 1) {
          const titleEl = fieldBox.querySelector('[class*="title" i]');
          const titleText = textContentOf(titleEl);
          if (
            titleText &&
            titleText.length <= 20 &&
            titleText !== ownValue &&
            !(element.closest("label") && fieldBox.contains(element.closest("label")) && textContentOf(element.closest("label")) === titleText)
          ) {
            return titleText;
          }
          const parent = fieldBox.parentElement;
          fieldBox = parent ? parent.closest('[class*="field" i], [class*="item" i], [class*="form-group" i]') : null;
        }
      }

      // 6. 前置兄弟节点文本（<p>标签</p><input> / <span>标签</span><input>）
      const candidates = [];
      let sibling = element.previousElementSibling;
      let steps = 0;
      while (sibling && steps < 3) {
        const text = textContentOf(sibling);
        if (text) candidates.push(text);
        if (text && OneCVFieldText.isMeaningfulFieldText(text)) break;
        sibling = sibling.previousElementSibling;
        steps += 1;
      }

      // 7. 父容器的 label 类子元素
      const parent = element.parentElement;
      if (parent) {
        for (const child of parent.children) {
          if (child === element || child.contains(element)) continue;
          const cls = String(child.className || "");
          if (/label|title|name|text/i.test(cls) || /^(LABEL|DT|TH)$/.test(child.tagName)) {
            const text = textContentOf(child);
            if (text) candidates.push(text);
          }
        }
      }

      // 8. 结构化容器内的 label 类节点与附近文本（移植自参考项目）
      for (const text of collectNearbyLabelCandidates(element)) {
        if (!candidates.includes(text)) candidates.push(text);
      }

      // 自定义 select 的 display-value 会污染候选：剔除与当前值相同的候选
      const ownValue = String(element.value || "").trim();
      const filtered = ownValue ? candidates.filter((text) => text !== ownValue) : candidates;

      return OneCVFieldText.selectBestFieldTextCandidate(filtered.length ? filtered : candidates);
    }

    const SECTION_HEADING_SELECTOR = "legend, h1, h2, h3, h4, [class*='title' i], [class*='header' i]";

    // ---- 区块语义：词汇表文本识别。
    //      真实 Moka 页的区块标题是 <span class="text-JHHb1llnzL">实习经历</span>——
    //      class 全是哈希名，legend/h1-h4/[class*=title]/[class*=header] 永远匹配不到。
    //      唯一可靠信号是文本本身：用简历 schema 的区块词汇表（教育/实习/工作/项目/
    //      获奖……来自 schema 区块，不是对特定网站写死）识别标题元素，再取字段上方
    //      最近的一个。词汇表之外的站点退回经典标题元素。
    const BLOCK_HEADING_RE =
      /(基本信息|个人信息|基本情况|求职意向|求职偏好|工作经历|工作经验|实习经历|实习经验|社会实践|教育背景|教育经历|项目经验|项目经历|校园经历|校园实践|在校经历|语言能力|语言水平|自我描述|自我评价|获奖经历|获奖情况|奖项荣誉|荣誉奖项|资格证书|技能特长|专业技能|补充信息|专利|论文|著作|竞赛|比赛|证书|作品|奖励|荣誉|培训|其他经历)/;
    let headingCache = { doc: null, list: null };

    function getBlockHeadings(doc) {
      if (headingCache.doc === doc && headingCache.list) return headingCache.list;
      const list = [];
      for (const el of doc.querySelectorAll("*")) {
        if (!isVisible(el)) continue;
        // 右侧悬浮导航（position:fixed/sticky）会把区块名重复一遍且位置"悬"在
        // 各内容区之间，必须排除（真实 Moka 页右侧有全区块导航）
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") continue;
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const text = textContentOf(el);
        if (!text || text.length > 12 || !BLOCK_HEADING_RE.test(text)) continue;
        // 叶子节点（无子元素）或经典标题标签
        if (el.children.length > 0 && !/^(H[1-6]|LEGEND)$/.test(el.tagName)) continue;
        list.push({ el, text, top: rect.top, left: rect.left });
      }
      list.sort((a, b) => (a.top - b.top) || (a.left - b.left));
      headingCache = { doc, list };
      return list;
    }

    function findSectionTexts(element) {
      const doc = element.ownerDocument || document;
      const fieldTop = element.getBoundingClientRect().top;
      const headings = getBlockHeadings(doc);
      const texts = [];
      for (let index = headings.length - 1; index >= 0; index -= 1) {
        const h = headings[index];
        if (h.top > fieldTop + 4) continue; // 在字段上方（含贴行容差）
        if (texts.length === 0 || texts.length < 3) {
          if (!texts.includes(h.text)) texts.push(h.text);
        }
        if (texts.length >= 3) break;
      }
      return texts;
    }

    // 卡片序号：在包含该标题的最近区块容器里，数前方还有几个同样带该标题的兄弟卡片。
    // 多卡同构区块（两段实习经历）据此得到"实习经历 #2"这类槽位信号。
    // 标题容器找不到或卡片不带各自标题时返回 1（此时靠 order 同名序号区分）。
    function computeBlockIndex(element, sectionText) {
      if (!sectionText) return 1;
      const doc = element.ownerDocument || document;
      const fieldTop = element.getBoundingClientRect().top;
      const same = getBlockHeadings(doc).filter((h) => h.text === sectionText);
      if (!same.length) return 1;
      // 字段上方最近的同文本标题 → 其容器；数前置兄弟里还有几个同文本标题
      let target = null;
      for (let index = same.length - 1; index >= 0; index -= 1) {
        if (same[index].top <= fieldTop + 4) { target = same[index]; break; }
      }
      if (!target) target = same[0];
      const container = target.el.parentElement || doc.body;
      let count = 1;
      for (let sib = container.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const text = textContentOf(sib);
        if (text.includes(sectionText)) count += 1;
      }
      return count;
    }

    // ---- 附近文本（辅助 AI 判断，如"期望薪资（元/月）"） ----
    function findNearbyText(element) {
      const parent =
        element.closest(
          "td, li, .form-group, .field, .form-item, .el-form-item, .ant-form-item, [class*='form-group' i], [class*='form-row' i]"
        ) || element.parentElement;
      if (!parent) return "";
      const text = textContentOf(parent);
      if (!text || text.length > 100) return "";
      const own = OneCVFieldText.normalizeFieldText(findLabelForElement(element));
      const withoutOwn = own ? text.replace(own, "").trim() : text;
      return withoutOwn.length > 3 && withoutOwn.length <= 80 ? withoutOwn : "";
    }

    // 组控件（radio/checkbox 组）的组标签：容器内排除选项自身 label 后的第一个 label 文本
    function findGroupLabel(visibleElements, options) {
      const optionTexts = new Set(options.map((o) => o.text).filter(Boolean));
      const first = visibleElements[0];
      const container = first.closest("div, td, li, fieldset") || first.parentElement;
      if (container) {
        const labels = Array.from(container.querySelectorAll("label"));
        const optionLabelEls = new Set(
          visibleElements
            .map((el) => (el.id ? container.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null))
            .filter(Boolean)
        );
        const memberIds = new Set(visibleElements.map((el) => el.id).filter(Boolean));
        for (const label of labels) {
          if (optionLabelEls.has(label)) continue;
          // 带 for 且指向组外控件的 label 属于其他字段，跳过
          const forId = label.getAttribute("for");
          if (forId && !memberIds.has(forId)) continue;
          const text = textContentOf(label);
          if (text && !optionTexts.has(text) && text.length <= 30) return text;
        }
      }
      return findLabelForElement(first);
    }

    function selectOptionsOf(selectElement) {
      return Array.from(selectElement.options || [])
        .map((option) => ({ value: option.value, text: (option.textContent || "").trim() }))
        .filter((option) => option.value !== "" || option.text);
    }

    // 自定义 select-like 控件（input 在 Select 容器内）：菜单往往预渲染在 DOM 里（即使收起），
    // 提取其选项列表让模型知道"该字段的取值样式"（如纯数字月份）。
    function extractCustomSelectOptions(element) {
      // 菜单可能与 input 的直接容器平级（如 Moka：菜单在 Dropdown-container 下、Select-container 外），
      // 逐级向上找最多 4 层，取第一层能找到菜单项的容器
      let container = element.parentElement;
      let items = [];
      for (let level = 0; level < 4 && container; level += 1) {
        items = container.querySelectorAll('[role="option"], [class*="menu-content-item" i], [class*="option-label" i], li[class*="option" i]');
        if (items.length) break;
        container = container.parentElement;
      }
      if (!items.length) return [];
      const seen = new Set();
      const options = [];
      for (const item of items) {
        if (container.contains(element) && item === element) continue;
        const text = textContentOf(item);
        if (!text || text.length > 40 || seen.has(text)) continue;
        seen.add(text);
        options.push({ value: text, text });
        if (options.length >= 40) break;
      }
      return options;
    }

    // ---- 单个字段 → RawFieldInfo ----
    function makeRawField(element, frameIndex, overrides = {}) {
      const labelText = overrides.labelText ?? findLabelForElement(element);
      const ariaLabel = element.getAttribute("aria-label") || "";
      const semanticAttr =
        element.getAttribute("data-automation-id") ||
        element.getAttribute("data-cy") ||
        element.getAttribute("data-testid") ||
        element.getAttribute("data-test") ||
        "";

      const sectionTexts = findSectionTexts(element);
      const blockIndex = computeBlockIndex(element, sectionTexts[0] || "");

      return {
        tag: element.tagName.toLowerCase(),
        inputType: String(element.getAttribute("type") || element.type || "").toLowerCase(),
        name: element.name || element.getAttribute("name") || "",
        id: element.id || "",
        labelText,
        ariaLabel,
        placeholder: element.getAttribute("placeholder") || element.getAttribute("data-placeholder") || "",
        nearbyText: findNearbyText(element),
        sectionTexts,
        blockIndex,
        options: overrides.options || [],
        kind: overrides.kind || "",
        required:
          element.required ||
          element.getAttribute("aria-required") === "true" ||
          /\*/.test(labelText),
        readOnly: element.readOnly || element.getAttribute("aria-readonly") === "true",
        lengthLimit: (() => {
          // 有效字数限制 = maxlength 属性，其次附近文本的"限X字"提示
          const attrMax = Number(element.maxLength);
          if (Number.isFinite(attrMax) && attrMax > 0) return attrMax;
          const hint = OneCVFillRuntime.extractLengthHint(labelText + " " + (element.getAttribute("placeholder") || "") + " " + findNearbyText(element));
          return hint || 0;
        })(),
        contentEditable: element.isContentEditable && element.tagName !== "INPUT",
        attrSemantic: semanticAttr,
        frameIndex,
        __element: element,
      };
    }

    // ---- 文档扫描（inputs + radio/checkbox 组聚合） ----
    function scanDocument(doc, frameIndex) {
      const rawFields = [];
      const rootEl = doc.body || doc;
      if (!rootEl) return rawFields;

      const radiosByName = new Map();
      const checkboxesByName = new Map();

      const inputs = rootEl.querySelectorAll(
        "input, textarea, select, [contenteditable='true'], [contenteditable='']"
      );
      for (const element of inputs) {
        if (rawFields.length >= 200) break; // MAX_SCAN_FIELDS
        if (!isVisible(element)) continue;

        const tag = element.tagName.toLowerCase();
        if (tag === "input") {
          if (isSkippableInput(element)) continue;
          const type = String(element.getAttribute("type") || "text").toLowerCase();

          if (type === "radio") {
            const groupName = element.name || "";
            if (!radiosByName.has(groupName)) radiosByName.set(groupName, []);
            radiosByName.get(groupName).push(element);
            continue;
          }

          if (type === "checkbox") {
            const groupName = element.name || "";
            const key = groupName || `__anon_${checkboxesByName.size}`;
            if (!checkboxesByName.has(key)) checkboxesByName.set(key, []);
            checkboxesByName.get(key).push(element);
            continue;
          }
        }

        const raw = makeRawField(element, frameIndex);
        if (tag === "select") raw.options = selectOptionsOf(element);
        else if (tag === "input") raw.options = extractCustomSelectOptions(element);
        if (!raw.labelText && !raw.ariaLabel && !raw.placeholder && !raw.name) continue;
        rawFields.push(raw);
      }

      // radio 组 → 单个 radio_group 字段
      for (const [, elements] of radiosByName) {
        const visible = elements.filter(isVisible);
        if (!visible.length) continue;
        const options = visible.map((radio) => ({
          value: radio.value,
          text: findLabelForElement(radio) || radio.value,
        }));
        const raw = makeRawField(visible[0], frameIndex, {
          kind: "radio_group",
          labelText: findGroupLabel(visible, options),
          options,
        });
        raw.__radios = visible;
        if (raw.labelText || options.some((o) => o.text)) rawFields.push(raw);
      }

      // checkbox 组（同名多选）→ checkbox_group；单个 checkbox 保持 checkbox
      for (const [key, elements] of checkboxesByName) {
        const visible = elements.filter(isVisible);
        if (!visible.length) continue;
        if (visible.length === 1 || !key || key.startsWith("__anon_")) {
          for (const checkbox of visible) {
            const raw = makeRawField(checkbox, frameIndex, { kind: "checkbox" });
            raw.__checkbox = checkbox;
            if (raw.labelText || raw.ariaLabel) rawFields.push(raw);
          }
          continue;
        }
        const options = visible.map((checkbox) => ({
          value: checkbox.value,
          text: findLabelForElement(checkbox) || checkbox.value,
        }));
        const raw = makeRawField(visible[0], frameIndex, {
          kind: "checkbox_group",
          labelText: findGroupLabel(visible, options),
          options,
        });
        raw.__checkboxes = visible;
        rawFields.push(raw);
      }

      // 同名组行键：相邻两个控件的"最近公共祖先"不变 → 同一行容器（同一张卡的
      // 起止时间四框）；变化 → 跨卡了。这是分卡标注的 DOM 真相信号，供
      // scanner-core 的角色标注按卡分组（placeholder 交替无法区分 4 框卡与 2+2 卡）。
      const byLabelText = new Map();
      for (const raw of rawFields) {
        const key = raw.labelText || raw.ariaLabel || "";
        if (!key) continue;
        if (!byLabelText.has(key)) byLabelText.set(key, []);
        byLabelText.get(key).push(raw);
      }
      let rowKeySeq = 0;
      for (const [, group] of byLabelText) {
        if (group.length < 2) continue;
        const chainOf = (el) => {
          const chain = [];
          for (let node = el; node; node = node.parentElement) chain.push(node);
          return chain;
        };
        // 行切分规则：同一行内相邻控件的最近公共祖先深度稳定；跨卡时公共祖先
        // 变浅（深度跌落）→ 新行。只在"跌落"时切，避免把下一卡拆散
        let rowId = 0;
        let prevEl = null;
        let prevSharedDepth = -1;
        for (const raw of group) {
          const el = raw.__element;
          if (!el) continue;
          if (prevEl) {
            const elChain = chainOf(el);
            const prevChain = new Set(chainOf(prevEl));
            let sharedDepth = -1;
            for (let index = 0; index < elChain.length; index += 1) {
              if (prevChain.has(elChain[index])) { sharedDepth = elChain.length - 1 - index; break; }
            }
            if (sharedDepth >= 0 && prevSharedDepth >= 0 && sharedDepth < prevSharedDepth - 1) {
              rowId += 1;
            }
            if (sharedDepth >= 0) prevSharedDepth = sharedDepth;
          }
          raw.__rowKey = "rk" + rowKeySeq + "_" + rowId;
          prevEl = el;
        }
        rowKeySeq += 1;
      }

      return rawFields;
    }

    return {
      isVisible,
      textContentOf,
      findLabelForElement,
      findSectionTexts,
      computeBlockIndex,
      findNearbyText,
      findGroupLabel,
      makeRawField,
      extractCustomSelectOptions,
      scanDocument,
      MAX_SCAN_FIELDS: 200,
    };
  }
);
