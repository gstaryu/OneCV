// OneCV — DOM 写值原语（从 content.js 迁出）
// React/Vue 兼容写值（native setter + input/change）、自定义下拉"开→点→收"、
// 原生 select/radio/checkbox 匹配写入。匹配纯逻辑在 one-option-match.js。
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./one-option-match.js") : root.OneCVOptionMatch,
    typeof module === "object" && module.exports ? require("./one-fill-runtime.js") : root.OneCVFillRuntime
  );

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVFillDom = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (OneCVOptionMatch, OneCVFillRuntime) {
    "use strict";

    function getNativeSetter(element) {
      const proto =
        element.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : element.tagName === "SELECT"
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
      return Object.getOwnPropertyDescriptor(proto, "value")?.set;
    }

    function dispatchEvents(element, types) {
      for (const type of types) {
        element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      }
    }

    function writeTextInput(element, value) {
      const previous = element.value;
      const setter = getNativeSetter(element);

      if (setter) setter.call(element, value);
      else element.value = value;

      if (element.value !== previous || value !== previous) {
        dispatchEvents(element, ["input", "change"]);
      }
    }

    function writeContentEditable(element, value) {
      element.focus();
      element.textContent = value;
      dispatchEvents(element, ["input", "change"]);
      element.blur();
    }

    // 完整鼠标序列：很多组件菜单（如 Moka sd-Select）只监听 mousedown，
    // element.click() 只派发 click 事件是点不动的。
    // pointerdown/pointerup 前置：真实浏览器一次点击本就先派发 pointer 再派发
    // mouse 序列；只认 pointer 事件的组件（Moka sd-Select 的开/关，真实页实测）
    // 对纯 mouse 合成序列完全无响应——既打不开也关不上菜单。
    function simulateMouseClick(element) {
      try {
        const pointerInit = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
        element.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
        element.dispatchEvent(new PointerEvent("pointerup", pointerInit));
      } catch (_) { /* PointerEvent 不可用的环境退化为纯 mouse 序列 */ }
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      element.dispatchEvent(new MouseEvent("mousedown", opts));
      element.dispatchEvent(new MouseEvent("mouseup", opts));
      element.dispatchEvent(new MouseEvent("click", opts));
    }

    function isVisibleForFill(element) {
      if (!element || !element.getClientRects().length) return false;
      const view = (element.ownerDocument && element.ownerDocument.defaultView) || window;
      const style = view.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    }

    // 完整"外部点击"序列：mousedown/mouseup/click 之外补发 pointerdown/pointerup。
    // 现代组件库（Moka atsx 等）常只监听 pointer 事件做"点击外部关闭"，只发 mouse
    // 事件收不起面板（真实 Moka 页面验证发现的面板残留问题）。
    function dispatchOutsideClick(target) {
      try {
        const pointerInit = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
        target.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
        target.dispatchEvent(new PointerEvent("pointerup", pointerInit));
      } catch (_) { /* PointerEvent 不可用时忽略 */ }
      const mouseInit = { bubbles: true, cancelable: true, view: window, button: 0 };
      target.dispatchEvent(new MouseEvent("mousedown", mouseInit));
      target.dispatchEvent(new MouseEvent("mouseup", mouseInit));
      target.dispatchEvent(new MouseEvent("click", mouseInit));
    }

    function dismissAllPopupPanels() {
      try {
        dispatchOutsideClick(document.body);
      } catch (_) { /* 防御 */ }
    }

    function dismissPopupPanels(element) {
      try {
        const opts = { bubbles: true, cancelable: true, key: "Escape", code: "Escape" };
        element.dispatchEvent(new KeyboardEvent("keydown", opts));
        element.dispatchEvent(new KeyboardEvent("keyup", opts));
        // 部分面板把 Escape 监听挂在 document 上
        document.dispatchEvent(new KeyboardEvent("keydown", opts));
        if (typeof element.blur === "function") element.blur();
      } catch (_) { /* 防御 */ }
    }

    const OPEN_PANEL_SELECTOR =
      '[class*="panel" i], [class*="dropdown" i], [class*="menu" i], [class*="popup" i], [role="listbox"], [class*="picker" i], [class*="calendar" i]';

    function looksLikeOpenMenu(panel) {
      return Boolean(
        panel.querySelector(
          '[role="option"], li, [class*="option" i], [class*="month" i], [class*="year" i], [class*="day" i], [class*="item" i]'
        )
      );
    }

    // 检测 anchor 附近仍展开的面板（anchor 为 null 时全页检测）。
    // 需要"看起来像菜单/日历"（含 option/item/年月日结构）以降低把常驻布局
    // 面板误判为残留的概率。
    function findOpenPopupPanels(anchor) {
      const candidates = document.querySelectorAll(OPEN_PANEL_SELECTOR);
      const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      const open = [];
      for (const panel of candidates) {
        if (!isVisibleForFill(panel)) continue;
        // 悬浮弹层必然脱离文档流（absolute/fixed/sticky）；导航栏/表单里的静态
        // "Dropdown/Menu" 容器（如 Moka 顶部语言切换）不是弹层，曾整页误报
        // panel_left_open（真实页插桩实锤）
        const panelStyle = getComputedStyle(panel);
        if (panelStyle.position === "static") continue;
        const rect = panel.getBoundingClientRect();
        if (!(rect.width > 20 && rect.height > 20)) continue;
        if (anchor && panel.contains(anchor)) continue;
        if (anchorRect && Math.abs(rect.top - anchorRect.top) > 1200) continue;
        if (!looksLikeOpenMenu(panel)) continue;
        open.push(panel);
      }
      return open;
    }

    // 宽松版悬浮层检测：不要求"像菜单"（有 option/item 结构），只要可见、
    // 锚定在本字段附近即可。用于开/关菜单的决策——过滤到"暂无选项"的空菜单
    //（如 sd-Empty-empty-wrapper）不含任何 option/item，严格版会漏判，
    // 导致对已开菜单再点触发器（本想打开）反而把它 toggle 关掉（真实页实测）。
    function findAnchoredOverlays(element) {
      if (!element) return [];
      const elementRect = element.getBoundingClientRect();
      const overlays = [];
      for (const panel of document.querySelectorAll(OPEN_PANEL_SELECTOR)) {
        if (!isVisibleForFill(panel)) continue;
        // 与 findOpenPopupPanels 同样的 static 过滤：页面常驻的 Dropdown/Menu
        // 容器不是弹层，误判会让 clickOpenThenSelect 以为菜单已开而空等、
        // 最后把关着的菜单当"悬挂"去 toggle 反而点开
        const panelStyle = getComputedStyle(panel);
        if (panelStyle.position === "static") continue;
        const rect = panel.getBoundingClientRect();
        if (!(rect.width > 20 && rect.height > 20)) continue;
        if (panel.contains(element)) continue;
        // 锚定判定复用 isPanelAnchored 的思路但放宽下边界（长菜单可向下展开较远）
        const overlapsX = rect.right > elementRect.left - 8 && rect.left < elementRect.right + 8;
        const gap = rect.top - elementRect.top;
        if (overlapsX && gap >= -150 && gap <= 500) overlays.push(panel);
      }
      return overlays;
    }

    // 从选项向上解析其所属弹层，取"最外层"的匹配祖先。
    // 曾取最近匹配：Moka sd 菜单的选项 div.sd-Menu-content-item 自身 class 就含
    // "Menu"，closest 返回选项自己，锚定判定用的是选项行自身的 rect——
    // 长列表（年份 1970-2126）里滚出菜单视口的选项全部被误杀，永远点不到。
    // 过滤掉接近视口大小的大块祖先（那是布局容器，不是弹层）。
    const POPUP_STRUCTURE_SELECTOR =
      '[class*="panel" i], [class*="dropdown" i], [class*="menu" i], [class*="popup" i], [class*="list" i], [role="listbox"], ul';

    function resolvePopupOf(option) {
      let popup = null;
      let node = option.parentElement;
      while (node && node !== document.body) {
        if (node.matches && node.matches(POPUP_STRUCTURE_SELECTOR)) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 900 && rect.height > 0 && rect.height < 900) popup = node;
        }
        node = node.parentElement;
      }
      return popup;
    }

    // 尽力收起 anchor 附近的面板：Escape + 外部点击（含 pointer 序列），最多两轮。
    // 返回仍展开的面板数组（空数组 = 已全部收起）；调用方据此提示用户手动收起。
    async function ensurePanelsClosed(anchor) {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let open = findOpenPopupPanels(anchor);
      if (!open.length) return [];

      dismissPopupPanels(anchor || document.body);
      dismissAllPopupPanels();
      await sleep(150);
      open = findOpenPopupPanels(anchor);
      if (!open.length) return [];

      try {
        if (document.activeElement && typeof document.activeElement.blur === "function") {
          document.activeElement.blur();
        }
      } catch (_) { /* 防御 */ }
      dispatchOutsideClick(document.body);
      await sleep(200);
      return findOpenPopupPanels(anchor);
    }

    // 自定义下拉收尾：若输入框附近的"已展开面板"里存在文本精确匹配的选项，点击它
    //（同步组件内部状态）。只在展开面板 + 文本强匹配时点击，不做盲目探索。
    // opts.exactOnly：只接受文本完全一致的选项（延迟二次选择用，禁模糊，
    // 防止"2001-01-28"模糊命中别的菜单里的"1"）
    async function clickMatchingOpenOption(element, value, opts = {}) {
      const wanted = String(value || "").trim();
      if (!wanted) return false;

      const candidates = document.querySelectorAll('[role="option"], li[class*="option" i], div[class*="option" i], [class*="dropdown-item" i], [class*="menu-item" i], [class*="menu-content-item" i]');
      const elementRect = element.getBoundingClientRect();
      const options = [];
      const seenKeys = new Set();

      for (const option of candidates) {
        if (!isVisibleForFill(option)) continue;
        // 必须在展开的弹层内（弹层归属取最外层匹配祖先，见 resolvePopupOf）
        const popup = resolvePopupOf(option);
        if (!popup || !popup.contains(option)) continue;
        const popupRect = popup.getBoundingClientRect();
        if (!(popupRect.width > 0 && popupRect.height > 0)) continue;
        // 面板必须锚定本字段：水平重叠 + 垂直距离收紧。
        // 曾用"垂直 900px 内"，把跨卡还开着的菜单圈进来（"1"误选事故）
        if (!OneCVFillRuntime.isPanelAnchored(popupRect, elementRect)) continue;

        const label = (option.textContent || "").trim();
        if (!label) continue;

        // 嵌套去重：同文本的外层菜单项与内层 option-label，只保留最内层
        let isOuterDuplicate = false;
        for (const other of candidates) {
          if (other === option) continue;
          if (
            other.contains(option) &&
            isVisibleForFill(other) &&
            (other.textContent || "").trim() === label
          ) {
            isOuterDuplicate = true;
            break;
          }
        }
        if (isOuterDuplicate) continue;

        const key = label + "@" + Math.round(popupRect.top);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        options.push({ el: option, label: label });
      }

      let best;
      if (opts.exactOnly) {
        best = options.find((o) => o.label === wanted) || null;
      } else {
        // 别名展开 + 打分（移植自参考项目 pickBestOption）
        best = OneCVOptionMatch.pickBestOption(options, wanted);
      }
      if (!best) return false;

      // 长列表（如年份 1970-2126）：先滚动到目标选项再点，否则 click 落在视口外无效
      try {
        best.el.scrollIntoView({ block: "nearest" });
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (_) { /* 防御 */ }

      simulateMouseClick(best.el);
      return true;
    }

    // 把简历值解析成控件的真实选项文本：过滤型自定义下拉（Moka sd-Select 等）
    // 写进输入框的文本会被组件当过滤词，别名值（如"大学本科"）会滤出空菜单。
    // options 为空/太少（动态建议类控件）时返回空串，调用方按原文写入。
    function resolveOptionText(options, value) {
      const wanted = String(value || "").trim();
      if (!wanted) return "";
      const list = (Array.isArray(options) ? options : [])
        .map((o) => String((o && (o.text ?? o.value)) ?? o ?? "").trim())
        .filter(Boolean);
      if (list.length < 2) return "";
      if (list.includes(wanted)) return wanted;
      const best = OneCVOptionMatch.pickBestOption(list.map((t) => ({ el: null, label: t, value: t })), wanted);
      return best ? String(best.label || best.value || "").trim() : "";
    }

    // 读取自定义下拉的显示层文本：这类组件的 input 只是搜索/过滤代理，
    // 提交选择后 input.value 会被清空、真实值渲染在旁边的 display span 里
    //（Moka sd-Input-display-value / ant selection-item）。增量模式判"已有值"
    // 与填充后校验都必须读这一层，读 input.value 会把已填字段误判为空。
    function readDisplayValue(element) {
      try {
        const widget = element.closest("label, [class*='select' i], [class*='dropdown' i], [class*='picker' i]") || element.parentElement;
        if (!widget || widget === element) return "";
        const span = widget.querySelector("[class*='display-value' i], [class*='displayValue' i], [class*='selection-item' i]");
        return span ? String(span.textContent || "").trim() : "";
      } catch (_) {
        return "";
      }
    }

    // 控件是否 select 型（延迟二次选择与过滤写入的准入条件）。
    // 两轨判定：a) 本体或 3 层内祖先 class 含 select/dropdown/picker/combo——
    // 新组件（Moka sd-Select）的菜单 portal 挂到 body 下，控件子树里根本没有
    // 面板结构，旧探测对它恒为 false（真实页踩坑）；b) 旧的容器内面板结构探测
    //（菜单渲染在控件内部的旧式组件）。
    function hasPanelStructure(element) {
      if (element.tagName === "TEXTAREA") return false;
      let node = element;
      for (let level = 0; level < 4 && node && node !== document.body; level += 1) {
        if (/(select|dropdown|picker|combo)/i.test(String(node.className || ""))) return true;
        node = node.parentElement;
      }
      const container = element.closest("div, td, li, .form-group, [class*='select' i], [class*='picker' i]") || element.parentElement;
      if (!container) return false;
      return Boolean(container.querySelector('[class*="panel" i], [class*="dropdown" i], [class*="options" i], [class*="menu" i], [role="listbox"], ul, [class*="Select-container" i]'));
    }

    // 打开附近的自定义面板并点击精确匹配的选项（开 → 点 → 收）。
    // 流程（每一步都在真实 Moka sd-Select 页面验证过）：
    //   1. 先尝试直接匹配——写值本身可能已自动弹出过滤菜单（聚焦时），
    //      此时菜单里往往只剩目标选项，直接点即可；
    //   2. 菜单已开但没匹配上 → 等待重试（可能是异步渲染），绝不盲点触发器
    //      ——对已开菜单点触发器是 toggle，会把它关掉；
    //   3. 菜单没开 → focus + pointer 序列点触发器打开；
    //   4. 过滤词把菜单滤空（别名值）→ 清空过滤词让菜单回全量列表再匹配；
    //   5. 仍未选中 → 合成 pointer 点击自身触发器 toggle 收起悬挂菜单
    //      （这类组件的 Escape/外部点击只认 isTrusted，合成事件关不上）。
    async function clickOpenThenSelect(element, value, opts = {}) {
      if (element.tagName === "TEXTAREA") return false; // 文本域无下拉面板
      if (!hasPanelStructure(element)) return false;

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // 很多组件（如 Moka sd-Select）把打开事件绑在整个 label 容器上，点 input 无效
      const openTarget = element.closest("label") || element;
      let openedByUs = false;

      for (let round = 0; round < 4; round += 1) {
        if (await clickMatchingOpenOption(element, value, opts)) return true;
        if (findAnchoredOverlays(element).length) {
          await sleep(180); // 写值自动弹出的过滤菜单可能还在渲染选项
          continue;
        }
        if (openedByUs) break;
        // 写值可能正在异步弹出过滤菜单（组件渲染有延迟）：先等一拍再决定是否点
        // 触发器，避免菜单刚渲染出来就被这次点击 toggle 关掉
        await sleep(150);
        if (findAnchoredOverlays(element).length) continue;
        try {
          if (typeof element.focus === "function") element.focus(); // 激活过滤模式
        } catch (_) { /* 防御 */ }
        try { simulateMouseClick(openTarget); } catch (_) { return false; }
        openedByUs = true;
        await sleep(300); // 等面板渲染
      }

      // 过滤菜单被滤成"暂无选项"（别名值/扫描期无选项清单）：清空过滤词让菜单
      // 回到全量列表再匹配一次；失败则把原文本写回（自由文本建议框的输入内容
      // 本身就是字段值，不能被清空逻辑吞掉）
      if (findAnchoredOverlays(element).length) {
        const textBefore = String(element.value || "");
        try {
          const setter = getNativeSetter(element);
          if (setter) setter.call(element, "");
          else element.value = "";
          dispatchEvents(element, ["input", "change"]);
          await sleep(250);
          if (await clickMatchingOpenOption(element, value, opts)) return true;
          if (textBefore) writeTextInput(element, textBefore);
        } catch (_) { /* 防御 */ }
      }

      // 收尾：本字段菜单仍悬挂 → 合成 pointer 点击自身触发器 toggle 收起
      if (findAnchoredOverlays(element).length) {
        try {
          simulateMouseClick(openTarget);
          await sleep(150);
        } catch (_) { /* 防御 */ }
      }
      return false;
    }

    function selectOptionByMatch(selectElement, desiredValue) {
      const options = Array.from(selectElement.options)
        .filter((option) => option.value !== "" || (option.textContent || "").trim())
        .map((option) => ({ el: option, label: (option.textContent || "").trim(), value: option.value }));

      const best = OneCVOptionMatch.pickBestOption(options, desiredValue);
      if (best) {
        if (selectElement.selectedIndex !== best.el.index) {
          selectElement.selectedIndex = best.el.index;
          dispatchEvents(selectElement, ["input", "change"]);
        }
        return { ok: true, matched: best.label };
      }
      return { ok: false, reason: "选项不匹配「" + desiredValue + "」" };
    }

    function clickRadioByMatch(radios, desiredValue, findLabel) {
      const labelOf = findLabel || ((el) => el.value);
      const options = radios.map((radio) => ({
        el: radio,
        label: labelOf(radio) || radio.value,
        value: radio.value,
      }));

      const best = OneCVOptionMatch.pickBestOption(options, desiredValue);
      if (best) {
        if (!best.el.checked) best.el.click(); // click 触发 radio 组 change
        return { ok: true, matched: best.label };
      }
      return { ok: false, reason: "单选项不匹配「" + desiredValue + "」" };
    }

    function setCheckbox(element, shouldCheck) {
      if (element.checked !== shouldCheck) element.click();
      return { ok: true };
    }

    function clickCheckboxesByMatch(checkboxes, desiredValue, findLabel) {
      // 多值拆分收敛到 one-fill-runtime.splitMultiValueText（曾因正则漏 \ 导致
      // 空格分隔值不拆、含小写 s 的英文值被切碎）
      const wantedItems = OneCVFillRuntime.splitMultiValueText(desiredValue);
      const labelOf = findLabel || ((el) => el.value);
      let matched = 0;

      for (const checkbox of checkboxes) {
        const label = labelOf(checkbox) || checkbox.value || "";
        const shouldCheck = wantedItems.some((wanted) => OneCVOptionMatch.getMatchScore(label, wanted) >= 60);
        setCheckbox(checkbox, shouldCheck);
        if (shouldCheck) matched += 1;
      }
      return matched > 0 ? { ok: true, matched: matched } : { ok: false, reason: "多选项无匹配「" + desiredValue + "」" };
    }

    return {
      getNativeSetter,
      dispatchEvents,
      writeTextInput,
      writeContentEditable,
      simulateMouseClick,
      dispatchOutsideClick,
      dismissAllPopupPanels,
      dismissPopupPanels,
      findOpenPopupPanels,
      findAnchoredOverlays,
      ensurePanelsClosed,
      hasPanelStructure,
      clickMatchingOpenOption,
      clickOpenThenSelect,
      resolveOptionText,
      readDisplayValue,
      selectOptionByMatch,
      clickRadioByMatch,
      setCheckbox,
      clickCheckboxesByMatch,
    };
  }
);
