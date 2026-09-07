// OneCV — 只读日期控件填充状态机（移植自参考项目 content.js fillReadonlyDateRuntime 等）
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVDatePicker = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    function parseDateParts(value) {
      const text = String(value || "").trim();
      const match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
      if (!match) return { year: 0, month: 0, day: 0 };
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3] || 0),
      };
    }

    function createFiller(deps) {
      const isVisible = deps.isVisible;
      const normalizeText = deps.normalizeText || ((t) => String(t || "").replace(/\s+/g, " ").trim());
      const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      const log = deps.log || (() => {});

      function scrollIntoView(el) {
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (_) {}
      }

      function clickLikeUser(el) {
        if (!el) return;
        scrollIntoView(el);
        el.focus?.();
        // pointer 前置：只认 pointer 事件的组件（Moka sd-Select 等）对纯 mouse
        // 合成序列无响应，日历/日期下拉打不开（真实页实测）
        try {
          const pointerInit = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
          el.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
          el.dispatchEvent(new PointerEvent("pointerup", pointerInit));
        } catch (_) { /* PointerEvent 不可用时忽略 */ }
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (typeof el.click === "function") el.click();
      }

      function findVisibleDatePanel(anchorEl) {
        const candidates = Array.from(
          document.querySelectorAll('[class*="picker"],[class*="Picker"],[class*="calendar"],[class*="Calendar"],[role="dialog"]')
        ).filter((node) => {
          if (node.contains && node.contains(anchorEl)) return false;
          if (!isVisible(node)) return false;
          const text = normalizeText(node.textContent || "");
          return /\d{4}\u5e74|1\u6708|2\u6708|3\u6708|4\u6708|5\u6708|6\u6708|7\u6708|8\u6708|9\u6708|10\u6708|11\u6708|12\u6708/.test(text);
        });

        if (!candidates.length) return null;
        if (!anchorEl) return candidates[0];

        const anchorRect = anchorEl.getBoundingClientRect();
        return candidates
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { node: node, distance: Math.abs(rect.left - anchorRect.left) + Math.abs(rect.top - anchorRect.bottom) };
          })
          .sort(function (a, b) { return a.distance - b.distance; })[0].node || candidates[0];
      }

      function getVisiblePickerYear(panel) {
        for (const node of panel.querySelectorAll("*")) {
          const match = normalizeText(node.textContent || "").match(/^(\d{4})\u5e74$/);
          if (match) return Number(match[1]);
        }
        return 0;
      }

      function findYearNavigationControl(panel, currentYear, targetYear) {
        const buttons = Array.from(
          panel.querySelectorAll('button,[role="button"],[tabindex],[class*="prev"],[class*="next"],[class*="arrow"],[class*="Arrow"]')
        ).filter((node) => isVisible(node));
        if (!buttons.length) return null;

        const yearNode = Array.from(panel.querySelectorAll("*")).find((node) =>
          /^(\d{4})\u5e74$/.test(normalizeText(node.textContent || ""))
        );
        if (!yearNode) {
          return targetYear < currentYear ? buttons[0] : buttons[buttons.length - 1];
        }

        const yearRect = yearNode.getBoundingClientRect();
        const leftButtons = [];
        const rightButtons = [];

        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          if (rect.right <= yearRect.left) leftButtons.push({ button: button, rect: rect });
          else if (rect.left >= yearRect.right) rightButtons.push({ button: button, rect: rect });
        }

        if (targetYear < currentYear) {
          return leftButtons.sort(function (a, b) { return b.rect.right - a.rect.right; })[0].button || buttons[0];
        }
        return rightButtons.sort(function (a, b) { return a.rect.left - b.rect.left; })[0].button || buttons[buttons.length - 1];
      }

      async function movePickerToYear(panel, targetYear) {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const currentYear = getVisiblePickerYear(panel);
          if (!currentYear || currentYear === targetYear) return true;
          const control = findYearNavigationControl(panel, currentYear, targetYear);
          if (!control) return false;
          clickLikeUser(control);
          await sleep(120);
        }
        return false;
      }

      async function clickPanelCell(panel, text) {
        const normalizedTarget = normalizeText(text);
        const candidates = Array.from(panel.querySelectorAll("button,[role='button'],td,li,div,span")).filter((node) => {
          if (!isVisible(node)) return false;
          if (node.getAttribute && node.getAttribute("aria-disabled") === "true") return false;
          if (/disabled/i.test(String(node.className || ""))) return false;
          return normalizeText(node.textContent || "") === normalizedTarget;
        });

        if (!candidates.length) return false;

        const target = candidates.sort(function (left, right) {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return a.width * a.height - b.width * b.height;
        })[0];

        clickLikeUser(target);
        await sleep(80);
        return true;
      }

      async function setValueWithEvents(el, value, runtime) {
        if (!el) return false;
        scrollIntoView(el);
        const restoreReadonly =
          runtime && runtime.readOnly ? { property: Boolean(el.readOnly), attribute: el.hasAttribute("readonly") } : null;

        try {
          el.focus && el.focus();
          if (restoreReadonly) {
            el.readOnly = false;
            el.removeAttribute("readonly");
          }
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
          if (setter) setter.call(el, value); else el.value = value;
          el.setAttribute("value", value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur && el.blur();
          await sleep(60);
          const actual = String(el.value || "").trim();
          if (actual === value) return true;
          if (value.length >= 7 && actual.startsWith(value.slice(0, 7))) return true;
          return false;
        } catch (_) {
          return false;
        } finally {
          if (restoreReadonly) {
            el.readOnly = restoreReadonly.property;
            if (restoreReadonly.attribute) el.setAttribute("readonly", "");
            else el.removeAttribute("readonly");
          }
        }
      }

      async function fillReadonlyDateRuntime(runtime, desired) {
        log(runtime, "开始", "目标值=" + desired);

        const directWriteOk = await setValueWithEvents(runtime.el, desired, runtime);
        if (directWriteOk) {
          log(runtime, "直接写入成功");
          return true;
        }

        log(runtime, "直接写入失败", "尝试打开日期面板");

        const trigger = (runtime.el.closest && runtime.el.closest('[class*="affix-wrapper" i]')) || runtime.el;
        clickLikeUser(trigger);
        await sleep(120);

        let panel = findVisibleDatePanel(runtime.el);
        if (!panel) {
          clickLikeUser(runtime.el);
          await sleep(120);
          panel = findVisibleDatePanel(runtime.el);
        }

        if (!panel) {
          log(runtime, "打开面板失败");
          return false;
        }

        const parsed = parseDateParts(desired);
        if (!parsed.year || !parsed.month) {
          log(runtime, "解析目标日期失败", desired);
          return false;
        }

        log(runtime, "面板已打开", "year=" + parsed.year + " month=" + parsed.month + " day=" + (parsed.day || 0));

        const yearReady = await movePickerToYear(panel, parsed.year);
        if (!yearReady) {
          log(runtime, "年份切换失败", String(parsed.year));
          return false;
        }

        panel = findVisibleDatePanel(runtime.el) || panel;
        const monthLabel = Number(parsed.month) + "月";
        if (!(await clickPanelCell(panel, monthLabel))) {
          log(runtime, "月份点击失败", monthLabel);
          return false;
        }
        log(runtime, "月份点击成功", monthLabel);
        await sleep(120);

        if (parsed.day) {
          panel = findVisibleDatePanel(runtime.el) || panel;
          const dayOk = await clickPanelCell(panel, String(Number(parsed.day)));
          if (!dayOk) {
            log(runtime, "日期点击失败", String(Number(parsed.day)));
            return false;
          }
          log(runtime, "日期点击成功", String(Number(parsed.day)));
          await sleep(120);
        }

        const current = String(runtime.el.value || "").trim();
        const matched = current === desired || (desired.length >= 7 && current.startsWith(desired.slice(0, 7)));
        log(runtime, matched ? "最终校验成功" : "最终校验失败", "当前值=" + (current || "(empty)"));
        return matched;
      }

      return { fillReadonlyDateRuntime: fillReadonlyDateRuntime, clickLikeUser: clickLikeUser, findVisibleDatePanel: findVisibleDatePanel, clickPanelCell: clickPanelCell, setValueWithEvents: setValueWithEvents };
    }

    return { parseDateParts: parseDateParts, createFiller: createFiller };
  }
);
