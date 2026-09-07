// OneCV — Content script（隔离世界，所有 shared 模块已由 manifest 注入为全局变量）
// 编排层：字段注册表 / 扫描入口（含深扫描与同源 iframe 递归）/ 填充执行循环 /
// 选区框选 / 消息协议。DOM 扫描在 one-scanner-dom.js，写值原语在 one-fill-dom.js，
// 深扫描在 one-deep-scan.js，日期面板状态机在 one-date-picker.js。
(() => {
  "use strict";

  if (window.__onecv_content_injected__) return;
  window.__onecv_content_injected__ = true;

  const { OneCVScannerDom, OneCVScannerCore, OneCVFillRuntime, OneCVFillDom,
          OneCVSchema, OneCVDiagnostics, OneCVOptionMatch, OneCVDatePicker,
          OneCVDeepScan } = window;

  const { isVisible } = OneCVScannerDom;

  // 日期面板状态机（依赖本隔离世界的 isVisible）
  const datePickerFiller = OneCVDatePicker.createFiller({
    isVisible,
    log: (runtime, step, detail) => {
      OneCVDiagnostics.log({ level: "debug", event: "date_fill_step", detail: { label: runtime && runtime.label, step, detail } });
    },
  });

  // 深扫描：点击行为与原 date-picker 的 clickLikeUser 一致
  //（原实现调用了一个未定义的 clickLikeUser，异常被 scanPage 的 catch 静默吞掉）
  const deepScanner = OneCVDeepScan.create({
    doc: document,
    isVisible,
    clickLikeUser: (el) => {
      if (!el) return;
      try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
      el.focus?.();
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      if (typeof el.click === "function") el.click();
    },
    log: (options) => OneCVDiagnostics.log(options),
  });

  // pageFieldId → {element(s), descriptor}
  const elementRegistry = new Map();
  // 最近一次填充结果（调用方凭 token 轮询 frame 0；本环境异步 sendResponse 不可靠）
  let lastFillResult = null;
  let fillProgress = "";
  let lastScan = null; // { descriptors, signature, pageMeta }

  // 回调式 background 消息（promise 包装；响应形如 {ok, data|error}）
  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  // ==========================================================================
  // 强力填充：chrome.debugger 真实输入（设置开关开启时才启用）
  // content 算坐标/验证 DOM，background 派发可信点击与滚轮。
  // 针对合成事件搞不定的虚拟滚动年份下拉（Moka 年份菜单 1970-2126 降序，
  // 选项不全量渲染，合成点击也不被组件接受——真实页插桩实锤）。
  // ==========================================================================
  const DBG_SESSION_DEADLINE_MS = 90000;

  function findAnchoredDateMenu(element, wanted) {
    const panels = OneCVFillDom.findOpenPopupPanels(element);
    const er = element.getBoundingClientRect();
    let withOption = null;
    let realMenu = null;
    for (const panel of panels) {
      // 假面板过滤：必须有可见选项行（真实菜单有选项行；导航区 287x40 的
      // sd-Dropdown 容器选项数为 0，曾被当成菜单，滚轮打上去把整页滚得乱跳）。
      // sd-Select 菜单的选项是 div.sd-Menu-content-item（无 li、无 role=option）
      const lis = Array.from(panel.querySelectorAll("li, [role='option'], [class*='menu-content-item' i]"))
        .filter((li) => li.getBoundingClientRect().height > 0);
      if (!lis.length) continue;
      const rect = panel.getBoundingClientRect();
      if (rect.top < er.top - 60) continue; // 菜单在本字段附近（下方），不是页面顶部
      const candidate = { panel, rect, lis };
      if (withOption) continue;
      if (lis.some((li) => (li.textContent || "").trim() === wanted)) {
        withOption = candidate;
      } else if (!realMenu || rect.height > realMenu.rect.height) {
        realMenu = candidate;
      }
    }
    return withOption || realMenu;
  }

  function findExactOptionIn(menuEl, wanted) {
    // sd-Select 的选项是 div.sd-Menu-content-item，class 不含 "option"（真实页踩坑：
    // 强力模式曾因此找不到任何年份选项，点开菜单后原样收起）
    const items = menuEl.querySelectorAll("li, [role='option'], [class*='option' i], [class*='menu-content-item' i]");
    let innermost = null;
    for (const item of items) {
      if ((item.textContent || "").trim() !== wanted) continue;
      const r = item.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      innermost = item; // 同文本嵌套时取最内层
    }
    return innermost;
  }

  async function debuggerSelectYear(target, deadline) {
    const { element, value } = target;
    const boxDeadline = Math.min(deadline, Date.now() + 25000); // 单框预算 25s，防饿死后面的框
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (Date.now() > boxDeadline) return false;
      element.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 350));
      const rect = element.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const opened = await sendToBackground({ action: "onecv:dbgInput", steps: [
        { type: "click", x: cx, y: cy, delayMs: 550 },
      ] });
      if (!opened?.ok) return false;
      // 滚动虚拟列表直到目标年份渲染，然后真实点击
      for (let step = 0; step < 30; step += 1) {
        if (Date.now() > boxDeadline) return false;
        const menu = findAnchoredDateMenu(element, value);
        if (!menu) break; // 菜单没开，重试外层
        const option = findExactOptionIn(menu.panel, value);
        if (option) {
          const or = option.getBoundingClientRect();
          await sendToBackground({ action: "onecv:dbgInput", steps: [
            { type: "click", x: Math.round(or.left + or.width / 2), y: Math.round(or.top + or.height / 2), delayMs: 450 },
          ] });
          await new Promise((r) => setTimeout(r, 300));
          // 提交后组件会清空 input（过滤代理），真实值在显示层 span
          const shown = OneCVFillDom.readDisplayValue(element) || String(element.value || "").trim();
          return shown === value;
        }
        // 真实滚轮 + 直接调 scrollTop 双保险（真实 wheel 会让虚拟列表渲染新选项）
        const mr = menu.rect;
        const scroller = [menu.panel, ...menu.panel.querySelectorAll("*")]
          .find((el) => el.scrollHeight > el.clientHeight + 20);
        if (scroller) scroller.scrollTop += 200;
        await sendToBackground({ action: "onecv:dbgInput", steps: [
          { type: "wheel", x: Math.round(mr.left + mr.width / 2), y: Math.round(mr.top + mr.height / 2), deltaY: 480, delayMs: 220 },
        ] });
      }
    }
    return false;
  }

  async function debuggerFillYearBoxes(yearTargets, results) {
    const attach = await sendToBackground({ action: "onecv:dbgAttach" });
    if (!attach?.ok) {
      OneCVDiagnostics.warn("dbg_skip", String(attach?.error || "attach 失败（未授权或 DevTools 占用）"));
      return { done: 0, failed: yearTargets.length };
    }
    const deadline = Date.now() + DBG_SESSION_DEADLINE_MS;

    // 关键前置：常规填充会留下一批悬浮的月份/学期菜单（z-index 更高，会拦截
    // 对年份框的点击——实测"点年消失/键入落空"的直接原因）。可信 Escape 把
    // 它们全部关掉，再开始逐框选择。
    await sendToBackground({ action: "onecv:dbgInput", steps: [
      { type: "key", key: "Escape", code: "Escape", vk: 27 },
      { type: "key", key: "Escape", code: "Escape", vk: 27, delayMs: 300 },
    ] });

    let done = 0;
    for (const target of yearTargets) {
      if (Date.now() > deadline) break;
      let ok = false;
      try { ok = await debuggerSelectYear(target, deadline); } catch (_) { /* 单框失败不拖垮 */ }
      if (ok) done += 1;
      const resultEntry = results.find((r) => r.fieldId === target.fieldId);
      if (resultEntry) {
        resultEntry.reason = ok
          ? "已通过真实输入选中该年份"
          : "年份已写入显示框；若站点校验报缺，请点开该下拉手动选择一次";
      }
      // 每框收尾：仅在菜单仍悬挂时补发可信 Escape——选中成功会自动收起菜单，
      // 而对已收起的状态发 Escape 会清掉刚提交的显示值（sd 组件 Escape=清除，
      // 真实页"年份填上又消失"的疑似来源之一）
      if (OneCVFillDom.findAnchoredOverlays(target.element).length) {
        await sendToBackground({ action: "onecv:dbgInput", steps: [
          { type: "key", key: "Escape", code: "Escape", vk: 27, delayMs: 200 },
        ] });
      }
    }
    await sendToBackground({ action: "onecv:dbgInput", steps: [
      { type: "key", key: "Escape", code: "Escape", vk: 27, delayMs: 150 },
    ] });
    await sendToBackground({ action: "onecv:dbgDetach" });
    return { done, failed: yearTargets.length - done };
  }

  // ==========================================================================
  // 扫描入口：产出 descriptors + 注册元素
  // ==========================================================================

  function registerElements(rawFields, descriptors) {
    elementRegistry.clear();
    // raw 与 descriptor 按顺序一一对应（buildFieldDescriptors 保序、1:1）
    for (let index = 0; index < descriptors.length; index += 1) {
      const raw = rawFields[index];
      elementRegistry.set(descriptors[index].pageFieldId, {
        element: raw.__element || null,
        radios: raw.__radios || null,
        checkboxes: raw.__checkboxes || null,
        checkbox: raw.__checkbox || null,
        descriptor: descriptors[index],
      });
    }
  }

  // frame 标识：top=0，同源 iframe = 在父文档 iframe 列表中的序号+1
  function getFrameTag() {
    if (window.top === window) return 0;
    try {
      const iframes = window.parent.document.querySelectorAll("iframe");
      const index = Array.from(iframes).findIndex((frame) => frame.contentWindow === window);
      return index >= 0 ? index + 1 : 90;
    } catch (_) {
      return 99; // 跨域父页面
    }
  }

  async function scanPage(providedProfile) {
    if (providedProfile) {
      try { await deepScanner.triggerExpandableSections(providedProfile); } catch (_) { /* 深扫描失败不阻塞 */ }
    }
    const rawFields = [];
    const descriptors = [];
    const seenFingerprints = new Set();

    // 递归扫描自身 + 同源 iframe（跨域 iframe 无法访问 DOM，属已知限制）
    const scanFrame = (win, doc, tag, depth) => {
      const raws = OneCVScannerDom.scanDocument(doc, tag);
      const descs = OneCVScannerCore.buildFieldDescriptors(raws, "f" + tag + "_");
      for (let i = 0; i < raws.length; i += 1) {
        if (!seenFingerprints.has(descs[i].fingerprint)) {
          seenFingerprints.add(descs[i].fingerprint);
          rawFields.push(raws[i]);
          descriptors.push(descs[i]);
        }
      }
      if (depth <= 0) return;
      for (const childWin of Array.from(win.frames)) {
        try {
          if (childWin.document && childWin.document.body) {
            const childTag = Array.from(win.frames).indexOf(childWin) + (win.top === win ? 1 : 10 * (tag + 1));
            scanFrame(childWin, childWin.document, childTag, depth - 1);
          }
        } catch (_) { /* 跨域 iframe：无法访问，跳过 */ }
      }
    };

    const ownTag = getFrameTag();
    scanFrame(window, document, ownTag, 1);
    registerElements(rawFields, descriptors);

    const signature = OneCVScannerCore.computeStructureSignature(descriptors);
    const pageMeta = { url: location.href, title: document.title || "" };
    lastScan = { descriptors, signature, pageMeta };

    OneCVDiagnostics.log({
      level: "info",
      event: "scan_done",
      detail: { fields: descriptors.length, signature, url: location.href },
    });
    OneCVDiagnostics.flushToBackground();

    return lastScan;
  }

  // ==========================================================================
  // 填充执行
  // ==========================================================================

  function resolveRawValue(profile, path) {
    const value = OneCVSchema.getValueByPath(profile, path);
    if (value == null) return "";
    if (Array.isArray(value)) return value.filter(Boolean).join(", ");
    return String(value);
  }

  // 增量模式"已有值"判定按控件类型分派（曾只看 element.value，导致 checkbox 组
  // 恒被跳过、radio 组永不跳过）
  function hasExistingValue(entry) {
    if (entry.radios) return entry.radios.some((r) => r.checked);
    if (entry.checkboxes) return entry.checkboxes.some((c) => c.checked);
    if (entry.checkbox) return entry.checkbox.checked;
    const el = entry.element;
    if (!el) return false;
    if (el.tagName === "SELECT") return Boolean(el.value);
    if (el.isContentEditable) return Boolean(String(el.textContent || "").trim());
    // 自定义下拉的 input 是过滤代理（提交后被组件清空），真实值在显示层 span
    //（曾只读 input.value：已通过菜单选好的字段在增量模式下被误判为空而重填）
    if (OneCVFillDom.readDisplayValue(el)) return true;
    return typeof el.value === "string" ? Boolean(el.value.trim()) : Boolean(el.value);
  }

  async function fillOne(entry, mapping, profile, variantsByPath) {
    const rawValue = resolveRawValue(profile, mapping.path);
    if (!rawValue) return { ok: false, reason: "简历该字段为空", skipped: true };

    const value = OneCVFillRuntime.applyTransform(rawValue, mapping.transform);
    const { element, radios, checkboxes, checkbox } = entry;

    try {
      if (radios) return OneCVFillDom.clickRadioByMatch(radios, value, OneCVScannerDom.findLabelForElement);
      if (checkboxes) return OneCVFillDom.clickCheckboxesByMatch(checkboxes, value, OneCVScannerDom.findLabelForElement);
      if (checkbox) {
        const positive = OneCVOptionMatch.isAffirmative(String(rawValue).trim());
        return OneCVFillDom.setCheckbox(checkbox, positive);
      }
      if (!element) return { ok: false, reason: "元素引用失效（页面可能已刷新），请重新扫描" };

      if (element.tagName === "SELECT") {
        const outcome = OneCVFillDom.selectOptionByMatch(element, value);
        if (outcome.ok) OneCVFillDom.dismissPopupPanels(element);
        return outcome;
      }
      if (element.isContentEditable) {
        OneCVFillDom.writeContentEditable(element, value);
        return { ok: true };
      }

      const kind = entry.descriptor.kind;
      let finalValue = value;

      // 原生日期族输入按类型裁剪格式（type=month 曾被写入完整 YYYY-MM-DD，
      // 浏览器视为非法值直接丢弃——真实表单验证时发现）
      if (kind === "date") {
        const inputType = String(element.getAttribute("type") || "").toLowerCase();
        if (inputType === "month") finalValue = value.slice(0, 7); // YYYY-MM
        else if (inputType === "date") finalValue = value.slice(0, 10); // YYYY-MM-DD
      }

      // 本地护栏：拆分日期控件（标注后缀或 options 判定）写值前截取年份/月份，
      // 模型漏带 transform 时也不会把完整日期写进年下拉。必须在只读日期分支
      // 之前：修正后的"2026"不再像完整日期，自然改走写值+选项点击路径
      //（面板因此能点中选项而收起）
      finalValue = OneCVFillRuntime.adaptSplitDateValue(
        finalValue,
        OneCVFillRuntime.splitDateRoleFromLabel(entry.descriptor.labelText),
        entry.descriptor.options
      );

      // 只读"日历接管"输入 + 日期形态的值：走日期面板状态机。
      // （原实现 /^d{4}-d{1,2}$/ 漏写反斜杠恒为 false，状态机在主填充路径上从不触发；
      //   改用可单测的 OneCVFillRuntime.isDateLikeText）
      if (element.readOnly && element.tagName === "INPUT" && OneCVFillRuntime.isDateLikeText(finalValue)) {
        const runtime = {
          el: element,
          readOnly: true,
          label: entry.descriptor.labelText,
          fieldId: fieldIdForLog(entry),
        };
        const ok = await datePickerFiller.fillReadonlyDateRuntime(runtime, finalValue);
        return ok ? { ok: true } : { ok: false, reason: "日期面板填充失败（见诊断日志）" };
      }

      // 描述变体：站点限制字数时自动选"不超限的最长版本"（确定性本地逻辑）
      if (variantsByPath) {
        const variants = variantsByPath[mapping.path];
        const limit = entry.descriptor.maxLength || Number(element.maxLength) || 0;
        if (limit > 0 && Array.isArray(variants) && variants.length) {
          const picked = OneCVFillRuntime.pickVariantForLimit(variants, limit);
          if (picked) {
            finalValue = picked.value;
          } else if (finalValue.length > limit) {
            return { ok: true, overLimit: true, reason: "值超出站点字数限制(" + limit + "字)且无适配版本，请人工删减" };
          }
        }
      }

      // select 型控件：先把值解析成真实选项文本再写（写进输入框的文本会被过滤型
      // 组件当过滤词，别名值如"大学本科"会滤出空菜单）；聚焦激活过滤模式
      //（未聚焦时写值弹出的菜单显示"暂无选项"，Moka sd-Select 真实页实测）。
      // 无选项清单的动态建议框（学校名等）保持原文写入。
      if (!element.readOnly && OneCVFillDom.hasPanelStructure(element)) {
        const resolved = OneCVFillDom.resolveOptionText(entry.descriptor.options, finalValue);
        if (resolved) finalValue = resolved;
        try { element.focus(); } catch (_) { /* 防御 */ }
      }

      OneCVFillDom.writeTextInput(element, finalValue);
      const openClicked = await OneCVFillDom.clickOpenThenSelect(element, finalValue);
      // 拆分日期"年"框：显示值先写入，是否需要强力模式补点选由 executeFill 统一处理
      //（虚拟滚动菜单无法用合成事件选择，见 debuggerFillYearBoxes）
      const roleHint = OneCVFillRuntime.splitDateRoleFromLabel(entry.descriptor.labelText);
      if (roleHint === "year" && !openClicked) {
        return { ok: true, want: finalValue, openClicked: false };
      }
      return { ok: true, openClicked: openClicked };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error) };
    }
  }

  function fieldIdForLog(entry) {
    return entry.descriptor ? entry.descriptor.pageFieldId : "";
  }

  async function executeFill({ mappings, mode, scopeFieldIds, profile, settings, variants: variantsByPath }) {
    if (!profile) return { error: "尚未保存任何简历数据，请先在「简历」中填写。" };

    const fillMode = mode || "overwrite"; // overwrite | incremental | selection
    const results = [];
    const deferredSelects = []; // 组件异步弹出的建议面板需要延迟处理
    const yearTargets = []; // 常规填充未同步的"年"框（强力模式用真实输入补点选）
    const threshold = Number(settings?.confidenceThreshold) || 0.7;
    const skipLowConfidence = Boolean(settings?.skipLowConfidence);

    // 拆分日期填充顺序：所有"月"框排到最后（稳定排序，其余字段保持原顺序）。
    // 部分组件（Moka sd-Select）提交"年"会把同组"月"自动重置为 1——月先填会被
    // 随后的年提交吞掉（真实页实测：提交 2025 后该组月显示自动变 1）
    const splitRoleOf = (mapping) => {
      const entry = elementRegistry.get(mapping.pageFieldId || mapping.fieldId);
      return entry ? OneCVFillRuntime.splitDateRoleFromLabel(entry.descriptor.labelText) : "";
    };
    const orderedMappings = mappings.slice().sort((a, b) => {
      const monthA = splitRoleOf(a) === "month" ? 1 : 0;
      const monthB = splitRoleOf(b) === "month" ? 1 : 0;
      return monthA - monthB;
    });

    for (const mapping of orderedMappings) {
      const fieldId = mapping.pageFieldId || mapping.fieldId;
      const entry = elementRegistry.get(fieldId);
      if (!entry) {
        results.push({ fieldId, ok: false, reason: "字段不在本次扫描结果中", confidence: mapping.confidence });
        continue;
      }
      if (fillMode === "selection" && Array.isArray(scopeFieldIds) && !scopeFieldIds.includes(fieldId)) {
        continue;
      }

      const element = entry.element;
      if (fillMode === "incremental" && hasExistingValue(entry)) {
        results.push({ fieldId, ok: true, skipped: true, reason: "增量模式：已有值，跳过", confidence: mapping.confidence });
        continue;
      }

      if (Number(mapping.confidence) < threshold && skipLowConfidence) {
        results.push({
          fieldId,
          ok: false,
          skipped: true,
          reason: `低置信度(${mapping.confidence})，保守模式跳过`,
          confidence: mapping.confidence,
        });
        continue;
      }

      // 本地守卫：出生日期映射到起止时间类字段时，是模型的典型误判，直接拒绝
      if (
        mapping.path === "personal.birthDate" &&
        /(起|止|开始|结束|在校|就读|任职)/.test(entry.descriptor.labelText)
      ) {
        results.push({
          fieldId,
          ok: false,
          skipped: true,
          reason: "本地守卫：出生日期不应填入起止时间字段",
          confidence: mapping.confidence,
        });
        continue;
      }

      fillProgress = orderedMappings.indexOf(mapping) + "/" + orderedMappings.length + ":" + (entry.descriptor.labelText || fieldId);
      // 单字段护栏：个别控件的展开点击可能诱发页面异常行为，8 秒未完成即放弃该字段
      const outcome = await Promise.race([
        fillOne(entry, mapping, profile, variantsByPath),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "单字段填充超时(8s)，已跳过", skipped: true }), 8000)),
      ]);
      // 组控件（radio/checkbox）通过 click 已完成填充，entry.element 只是组内首个成员；
      // 若推入延迟二次选择会再点一次 openTarget，把刚勾选的项点掉（真实表单验证发现）。
      // 面板结构准入：出生日期/手机号等无面板的普通输入框绝不进延迟队列
      //（它们的模糊匹配曾在别的卡片开着的菜单里乱点——"1"误选事故）。
      const isGroupEntry = Boolean(entry.radios || entry.checkboxes || entry.checkbox);
      const panelEligible = element && !element.readOnly && OneCVFillDom.hasPanelStructure(element);
      if (
        outcome.ok && !outcome.skipped &&
        element && element.tagName !== "TEXTAREA" && !isGroupEntry && panelEligible &&
        !outcome.openClicked
      ) {
        deferredSelects.push({
          fieldId,
          element,
          openTarget: element.closest("label") || element,
          value: OneCVFillRuntime.applyTransform(resolveRawValue(profile, mapping.path), mapping.transform),
        });
      }
      results.push({
        fieldId,
        label: entry.descriptor.labelText,
        path: mapping.path,
        confidence: mapping.confidence,
        lowConfidence: Number(mapping.confidence) < threshold || Boolean(outcome.overLimit),
        ...outcome,
      });

      OneCVDiagnostics.log({
        level: outcome.ok ? "info" : "warn",
        event: "fill_field",
        detail: {
          fieldId,
          label: entry.descriptor.labelText,
          path: mapping.path,
          confidence: mapping.confidence,
          ok: outcome.ok,
          reason: outcome.reason || "",
        },
      });

      // 强力模式目标收集：年框（显示值已写入、选项未同步）
      if (settings?.debuggerFill && outcome.want && !outcome.skipped) {
        yearTargets.push({ fieldId, element, value: outcome.want });
      }
    }

    // 组件建议面板异步渲染且多面板同屏会互相干扰：
    // 对"当场未点上选项"的字段串行做 收全部面板 → 开 → 点 → 收。
    // clickOpenThenSelect 已含"菜单已开先匹配/toggle 收起/清过滤词回退"全流程
    //（此处 exactOnly：延迟阶段禁模糊，防止"2001-01-28"模糊命中别的菜单里的"1"）
    {
      const deadline = Date.now() + 45000;
      await new Promise((resolve) => setTimeout(resolve, 700));
      for (const item of deferredSelects) {
        if (Date.now() > deadline) break;
        try {
          OneCVFillDom.dismissAllPopupPanels();
          await OneCVFillDom.clickOpenThenSelect(item.element, item.value, { exactOnly: true });
        } catch (_) { /* 防御 */ }

        // 逐字段残留检测：该字段附近仍有展开面板 → 在其结果里标注，
        // 用户在侧边栏结果列表能看到"哪个字段的面板没收起"
        try {
          const stillOpen = await OneCVFillDom.ensurePanelsClosed(item.element);
          if (stillOpen.length) {
            const resultEntry = results.find((r) => r.fieldId === item.fieldId);
            if (resultEntry) {
              resultEntry.reason = [resultEntry.reason, "面板未自动收起，请手动点击页面空白处"].filter(Boolean).join("；");
            }
          }
        } catch (_) { /* 防御 */ }
      }
      OneCVFillDom.dismissAllPopupPanels();
      // 选中操作可能再次触发建议重弹：延迟后再收一次
      await new Promise((resolve) => setTimeout(resolve, 600));
      OneCVFillDom.dismissAllPopupPanels();
    }

    // 年框兜底提示：无论是否强力模式，未同步的年框都提示人工确认
    for (const t of yearTargets) {
      const entry = results.find((r) => r.fieldId === t.fieldId);
      if (entry && !entry.reason) {
        entry.reason = "年份已写入显示框；若站点校验报缺，请点开该下拉手动选择一次";
      }
    }

    // 强力填充：常规手段未同步的"年"框（设置开启 + 已授权时才生效）。
    // 放在延迟二次选择之后：先给普通路径机会，剩下的才动用真实输入。
    if (settings?.debuggerFill && yearTargets.length) {
      fillProgress = "强力模式：真实输入选择年份…";
      try {
        const dbg = await debuggerFillYearBoxes(yearTargets, results);
        OneCVDiagnostics.log({
          level: "info",
          event: "dbg_fill_done",
          detail: { done: dbg.done, failed: dbg.failed },
        });
      } catch (_) { /* 防御：强力模式失败不影响整体结果 */ }
    }

    // 整轮填充结束：外部点击收起面板（含 pointer 序列），再做全局残留检测。
    // 个别组件校验 isTrusted 时合成事件收不起，只能提示用户手动收起。
    try {
      OneCVFillDom.dispatchOutsideClick(document.body);
    } catch (_) { /* 防御 */ }
    let panelsLeftOpen = 0;
    try {
      const remaining = await OneCVFillDom.ensurePanelsClosed(null);
      panelsLeftOpen = remaining.length;
      if (remaining.length) {
        OneCVDiagnostics.log({
          level: "warn",
          event: "panel_left_open",
          detail: { count: remaining.length, panels: remaining.map((p) => String(p.className || "").slice(0, 80)).slice(0, 5) },
        });
      }
    } catch (_) { /* 防御 */ }

    OneCVDiagnostics.flushToBackground();
    return { results, panelsLeftOpen };
  }

  // ==========================================================================
  // 高亮（低置信度提示）
  // ==========================================================================

  function highlightField(fieldId, cssClass) {
    const entry = elementRegistry.get(fieldId);
    const element = entry?.element;
    if (!element) return;
    element.classList.add("onecv-highlight", cssClass || "onecv-highlight-low");
    setTimeout(() => {
      element.classList.remove("onecv-highlight", "onecv-highlight-low", "onecv-highlight-ok");
    }, 8000);
  }

  // ==========================================================================
  // 选区模式：用户在页面上框选区域
  // ==========================================================================

  let selectionState = null;

  function startRegionSelect() {
    if (selectionState) return { ok: true, alreadyActive: true };

    const overlay = document.createElement("div");
    overlay.id = "onecv-region-overlay";
    const box = document.createElement("div");
    box.id = "onecv-region-box";
    const tip = document.createElement("div");
    tip.id = "onecv-region-tip";
    tip.textContent = "OneCV 选区模式：按住鼠标拖拽框选要填写的区域，Esc 取消";
    overlay.appendChild(tip);
    document.documentElement.appendChild(overlay);

    selectionState = { overlay, box, startPoint: null, rect: null };

    function onDown(event) {
      if (event.target === tip) return;
      box.style.display = "block";
      selectionState.startPoint = { x: event.pageX, y: event.pageY };
      event.preventDefault();
    }
    function onMove(event) {
      if (!selectionState.startPoint) return;
      const x = Math.min(selectionState.startPoint.x, event.pageX);
      const y = Math.min(selectionState.startPoint.y, event.pageY);
      const width = Math.abs(event.pageX - selectionState.startPoint.x);
      const height = Math.abs(event.pageY - selectionState.startPoint.y);
      Object.assign(box.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      selectionState.rect = { left: x, top: y, right: x + width, bottom: y + height };
    }
    function onUp() {
      if (selectionState.startPoint && selectionState.rect) {
        // 延迟到本轮事件结束后再拆 overlay
        setTimeout(finishRegionSelect, 0);
      } else {
        selectionState.startPoint = null;
      }
    }
    function onKey(event) {
      if (event.key === "Escape") cancelRegionSelect();
    }

    overlay.addEventListener("mousedown", onDown);
    overlay.addEventListener("mousemove", onMove);
    overlay.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
    selectionState.cleanupKey = () => document.removeEventListener("keydown", onKey);

    return { ok: true };
  }

  function collectRegionFieldIds(rect) {
    const selectedIds = [];
    for (const [fieldId, entry] of elementRegistry) {
      const element = entry.element;
      if (!element) continue;
      const r = element.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const top = r.top + window.scrollY;
      const left = r.left + window.scrollX;
      const intersects =
        left < rect.right && left + r.width > rect.left && top < rect.bottom && top + r.height > rect.top;
      if (intersects) selectedIds.push(fieldId);
    }
    return selectedIds;
  }

  function finishRegionSelect() {
    if (!selectionState) return { ok: true, cancelled: true };
    const rect = selectionState.rect;
    selectionState.overlay.remove();
    selectionState.cleanupKey?.();
    selectionState = null;

    if (!rect) return { ok: true, cancelled: true, selectedIds: [] };
    const selectedIds = collectRegionFieldIds(rect);
    // 通知 sidepanel 选区已完成（sidepanel 据此继续选区填充流程）
    try {
      chrome.runtime.sendMessage({ action: "onecv:regionSelected", selectedIds }).catch(() => {});
    } catch (_) { /* 扩展上下文失效 */ }
    return { ok: true, selectedIds };
  }

  function cancelRegionSelect() {
    if (!selectionState) return { ok: true };
    selectionState.overlay.remove();
    selectionState.cleanupKey?.();
    selectionState = null;
    return { ok: true, cancelled: true };
  }

  // ==========================================================================
  // 消息协议（sidepanel → content，一律定向 frame 0）
  // ==========================================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object" || !String(request.action).startsWith("onecv:")) return;

    switch (request.action) {
      case "onecv:fillProgress":
        sendResponse({ ok: true, progress: fillProgress, hasResult: !!lastFillResult });
        return;
      case "onecv:getFillResult": {
        if (lastFillResult && lastFillResult.token === request.token) {
          sendResponse({ ok: true, result: lastFillResult.result });
          lastFillResult = null;
        } else {
          sendResponse({ ok: false, pending: true });
        }
        return;
      }
      case "onecv:diagDump": {
        const dump = [];
        for (const [fieldId, entry] of elementRegistry) {
          const el = entry.element;
          if (!el) continue;
          const container = el.closest("div, td, li") || el.parentElement;
          const panel = container
            ? container.querySelector('[class*="panel" i], [class*="dropdown" i], [class*="options" i], [class*="menu" i], [class*="popup" i], ul, [role="listbox"]')
            : null;
          dump.push({
            fieldId,
            kind: entry.descriptor.kind,
            label: entry.descriptor.labelText,
            html: el.outerHTML.slice(0, 300),
            panelHtml: panel ? panel.outerHTML.slice(0, 600) : "",
            panelClasses: panel ? panel.className : "",
          });
        }
        sendResponse({ ok: true, dump: dump.slice(0, 40), url: location.href });
        return;
      }
      case "onecv:ping":
        sendResponse({ ok: true });
        return;
      case "onecv:scan": {
        (async () => {
          try {
            const scan = await scanPage(request.profile);
            sendResponse({ ok: true, descriptors: scan.descriptors, signature: scan.signature });
          } catch (error) {
            sendResponse({ ok: false, error: String(error && error.message || error) });
          }
        })();
        return true;
      }
      case "onecv:fill": {
        // 立即应答确认接收；最终结果由调用方凭 token 轮询 frame 0 取回
        //（本环境 content script 的异步 sendResponse 偶发丢失）
        executeFill(request)
          .then((result) => {
            const wrapped = { ok: !result.error, ...result };
            lastFillResult = { token: request.token, result: wrapped, ts: Date.now() };
          })
          .catch((error) => {
            lastFillResult = { token: request.token, result: { ok: false, error: String(error?.message || error) }, ts: Date.now() };
          });
        sendResponse({ ok: true, accepted: true, token: request.token });
        return;
      }
      case "onecv:highlight": {
        for (const fieldId of request.fieldIds || []) highlightField(fieldId, request.cssClass);
        sendResponse({ ok: true });
        return;
      }
      case "onecv:startRegionSelect":
        sendResponse(startRegionSelect());
        return;
      case "onecv:finishRegionSelect":
        sendResponse(finishRegionSelect());
        return;
      case "onecv:cancelRegionSelect":
        sendResponse(cancelRegionSelect());
        return;
      default:
        return;
    }
  });

  // 调试钩子：仅供扩展自身的 devtools/驱动页使用（隔离世界，页面脚本不可见）
  window.__onecvDebug = { scanPage, executeFill, highlightField };
})();
