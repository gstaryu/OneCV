// OneCV — 侧边栏主逻辑
// 全链路：扫描（content）→ 缓存命中 → AI 映射（background 代理）→ 解析校验 → 填充（content）→ 结果渲染
(() => {
  "use strict";

  // ---- tab 切换 ----
  document.getElementById("tabs").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    for (const tab of document.querySelectorAll(".tab")) {
      tab.classList.toggle("active", tab === button);
    }
    for (const panel of document.querySelectorAll(".panel")) {
      panel.classList.toggle("active", panel.id === `panel-${button.dataset.tab}`);
    }
    if (button.dataset.tab === "logs") refreshLogs();
    if (button.dataset.tab === "resume") refreshResumeSummary();
  });

  function setStatus(id, text, cls = "") {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `status ${cls}`;
  }

  // ---- 与 content script 通信 ----
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // 注入清单单一来源：直接读 manifest 的 content_scripts[0].js。
  // （曾因手工维护第二份清单漏掉 one-option-match/one-date-picker，
  //  扩展重载后兜底注入的 content script 会因缺模块直接崩溃。）
  const CONTENT_SCRIPT_FILES = chrome.runtime.getManifest().content_scripts[0].js;

  // 消息一律定向 frame 0：top frame 递归扫描同源 iframe 并持有全部字段注册表，
  // 广播会让每个 frame 都跑一遍扫描/填充（结果错乱且浪费）。
  async function sendToTab(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch (error) {
      // content script 未注入（扩展刚重载、页面未刷新）：programmatic 注入后重试一次
      if (!/Receiving end does not exist|Could not establish/i.test(String(error?.message))) throw error;
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: CONTENT_SCRIPT_FILES,
      });
      return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    }
  }

  // ---- 扫描 ----
  let scanned = null; // { tabId, descriptors, signature }

  document.getElementById("btn-scan").addEventListener("click", async () => {
    setStatus("scan-status", "扫描中…");
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
        throw new Error("请在普通网页（http/https）上使用 OneCV");
      }
      const profile = await OneCVStorage.getResumeProfile();
      const response = await sendToTab(tab.id, { action: "onecv:scan", profile });
      if (!response?.ok) throw new Error(response?.error || "扫描失败");

      scanned = { tabId: tab.id, descriptors: response.descriptors, signature: response.signature };
      document.getElementById("btn-fill").disabled = response.descriptors.length === 0;
      setStatus("scan-status", `发现 ${response.descriptors.length} 个字段`, "ok");
      OneCVDiagnostics.log({ event: "panel_scan", detail: { fields: response.descriptors.length } });
    } catch (error) {
      scanned = null;
      document.getElementById("btn-fill").disabled = true;
      setStatus("scan-status", String(error.message || error), "warn");
    }
  });

  // ---- 填充主流程 ----
  document.getElementById("btn-fill").addEventListener("click", runFill);

  async function runFill() {
    if (!scanned) return;
    const fillMode = document.querySelector('input[name="fill-mode"]:checked')?.value || "overwrite";
    setStatus("fill-status", "处理中…");

    try {
      // 1. 选区模式：先让用户框选
      let scopeFieldIds = null;
      if (fillMode === "selection") {
        setStatus("fill-status", "请在页面上拖拽框选区域…");
        await sendToTab(scanned.tabId, { action: "onecv:startRegionSelect" });
        scopeFieldIds = await waitRegionSelection();
        if (!scopeFieldIds?.length) {
          setStatus("fill-status", "选区为空或已取消", "warn");
          return;
        }
      }

      // 2. 简历目录（先应用用户自定义字段定义，使自定义字段可被 AI 映射）
      const profile = await OneCVStorage.getResumeProfile();
      if (!profile) throw new Error("尚未保存任何简历数据，请先在「简历」中填写");
      const cfStored = await chrome.storage.local.get("onecv_custom_item_fields");
      OneCVSchema.applyCustomFieldDefs(cfStored.onecv_custom_item_fields || {});
      const catalog = OneCVSchema.getCatalogWithValues(profile);
      const validPaths = catalog.map((entry) => entry.path);

      // 3. 缓存命中（命中路径同样要过 validPaths 白名单：schema 演进后旧缓存
      //    可能指向已不存在的路径，不校验会静默填空）
      const validPathSet = new Set(validPaths);
      const cache = await OneCVStorage.getMappingCache();
      const lookup = OneCVCache.cacheLookup(cache, scanned.signature, scanned.descriptors);
      const matchedValid = lookup.matched.filter((m) => validPathSet.has(m.path));
      if (matchedValid.length !== lookup.matched.length) {
        OneCVDiagnostics.warn("cache_stale_paths_dropped", {
          dropped: lookup.matched.length - matchedValid.length,
        });
      }
      const matchedById = new Map(matchedValid.map((m) => [m.pageFieldId, m]));

      const mappable = scanned.descriptors.filter((d) => d.kind !== "unknown");
      const missingFields = mappable.filter((d) => !matchedById.has(d.pageFieldId));

      let mappings = [...matchedValid];
      let aiMappings = [];

      // 4. 缓存未覆盖的字段 → AI 映射
      if (missingFields.length) {
        setStatus("fill-status", `AI 映射中（${missingFields.length} 个字段未命中缓存）…`);
        const payload = OneCVScannerCore.buildMappingPayload(missingFields, catalog, {
          url: "（见日志）",
          title: "",
        });

        const response = await chrome.runtime.sendMessage({
          action: "onecv:callModel",
          mode: "field_mapping",
          system: OneCVMapPrompt.SYSTEM_PROMPT,
          user: OneCVMapPrompt.buildUserPrompt(payload),
        });
        if (!response?.ok) throw new Error(response?.error || "模型调用失败");

        const parsed = OneCVMapParse.parseMappingResponse(response.data.text, {
          validFieldIds: missingFields.map((d) => d.pageFieldId),
          validPaths,
          validTransforms: OneCVScannerCore.TRANSFORM_RULES,
        });
        if (parsed.error) throw new Error(parsed.error);

        aiMappings = parsed.mappings;
        mappings = mappings.concat(aiMappings);

        // 映射管线诊断：缓存命中/AI 映射/模型响应头部——
        // "两个经历卡都没填"这类问题靠它一眼定位（模型漏映射 vs 缓存回放 vs 解析丢弃）
        OneCVDiagnostics.log({
          level: "info",
          event: "mapping_pipeline",
          detail: {
            cacheHit: matchedValid.length,
            aiMapped: aiMappings.length,
            aiIgnored: (parsed.ignored || []).length,
            missingToModel: missingFields.length,
            modelHead: String(response.data.text || "").slice(0, 300),
          },
        });

        // 5. 写缓存（只缓存 AI 产出的映射）+ 淘汰
        let updatedCache = OneCVCache.cacheStore(cache, scanned.signature, scanned.descriptors, aiMappings);
        OneCVCache.touchSignature(updatedCache, scanned.signature);
        updatedCache = OneCVCache.pruneCache(updatedCache);
        await OneCVStorage.saveMappingCache(updatedCache);
      } else {
        OneCVCache.touchSignature(cache, scanned.signature);
      }

      // 6. 执行填充：ack + 经 background 轮询结果（Edge 异步 sendResponse 不可靠）
      setStatus("fill-status", "写入表单中…");
      const settings = await OneCVStorage.getSettings();
      const variantsStored = await chrome.storage.local.get("onecv_desc_variants");
      const variants = variantsStored.onecv_desc_variants || {};
      const fillToken = "fill_" + Date.now();
      const ack = await sendToTab(scanned.tabId, {
        action: "onecv:fill",
        token: fillToken,
        mappings,
        mode: fillMode,
        scopeFieldIds,
        profile,
        settings,
        variants,
      });
      if (!ack?.ok) throw new Error(ack?.error || "填充请求未被接受");
      let fillResponse = null;
      for (let i = 0; i < 150; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const r = await chrome.tabs.sendMessage(scanned.tabId, { action: "onecv:getFillResult", token: fillToken }, { frameId: 0 });
        if (r?.ok) { fillResponse = r.result; break; }
      }
      if (!fillResponse) throw new Error("填充结果超时");
      if (!fillResponse.ok) throw new Error(fillResponse.error || "填充失败");

      // 7. 低置信度高亮
      const lowIds = fillResponse.results.filter((r) => r.lowConfidence).map((r) => r.fieldId);
      if (lowIds.length) {
        await sendToTab(scanned.tabId, { action: "onecv:highlight", fieldIds: lowIds });
      }

      // 8. 视觉兜底（默认关闭）：低置信度字段 → 截图 → 视觉模型重映射 → 补填。
      //    结果并入最终列表统一渲染（曾因后续 setStatus/renderResults 覆盖，兜底成果不可见）
      const currentSettings = settings;
      let visionRedoResults = null;
      if (currentSettings.visionEnabled && lowIds.length) {
        setStatus("fill-status", "视觉兜底：截图并调用视觉模型…");
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(scanned.tabId, { format: "png" });
          const lowDescriptors = scanned.descriptors.filter((d) => lowIds.includes(d.pageFieldId));
          const visionPayload = OneCVScannerCore.buildMappingPayload(
            lowDescriptors,
            catalog,
            { url: "（截图见消息）", title: "vision fallback" }
          );
          const visionResponse = await chrome.runtime.sendMessage({
            action: "onecv:callModel",
            mode: "vision_mapping",
            system: OneCVMapPrompt.SYSTEM_PROMPT,
            user:
              OneCVMapPrompt.buildUserPrompt(visionPayload) +
              " 附加说明：以下是页面截图。请结合截图中字段的视觉位置与语义，对上述低置信度字段重新判断映射。",
            images: [{ base64: dataUrl.split(",")[1], mediaType: "image/png" }],
          });
          if (visionResponse?.ok) {
            const visionParsed = OneCVMapParse.parseMappingResponse(visionResponse.data.text, {
              validFieldIds: lowIds,
              validPaths,
              validTransforms: OneCVScannerCore.TRANSFORM_RULES,
            });
            if (!visionParsed.error && visionParsed.mappings.length) {
              const redo = await sendToTab(scanned.tabId, {
                action: "onecv:fill",
                mappings: visionParsed.mappings,
                mode: "overwrite",
                profile,
                settings: currentSettings,
              });
              if (redo?.ok) visionRedoResults = redo.results;
            }
          }
        } catch (visionError) {
          OneCVDiagnostics.warn("vision_fallback_failed", String(visionError?.message || visionError));
        }
      }

      // 9. 最终结果：主填充结果为基础，视觉兜底重判过的字段用新结果覆盖
      const finalResults = visionRedoResults
        ? fillResponse.results.map((r) => {
            const redone = visionRedoResults.find((v) => v.fieldId === r.fieldId);
            return redone || r;
          })
        : fillResponse.results;
      renderResults(finalResults);

      // 段落数缺口提醒（Phase 2）：简历条数 > 页面已填段数 →
      // 建议手动点「添加」后用增量填入补齐（用户确认的交互）
      const gaps = OneCVSchema.getSectionSlotGaps(
        finalResults.map((r) => r.path).filter(Boolean),
        profile
      );
      const warnings = gaps.map((gap) => ({
        text: `${gap.sectionLabel}：简历有 ${gap.resumeCount} 条，页面可能只填了 ${gap.pageCount} 段。可在页面手动点击「添加」新增段落后，选择「增量填入」再点一次「AI 映射并填充」补齐。`,
      }));
      if (Number(fillResponse.panelsLeftOpen) > 0) {
        warnings.push({
          text: `检测到 ${fillResponse.panelsLeftOpen} 个下拉/日历面板未自动收起，请在页面上手动点击空白处收起。`,
        });
      }
      renderWarnings(warnings);
      const filled = finalResults.filter((r) => r.ok && !r.skipped).length;
      const failed = finalResults.filter((r) => !r.ok && !r.skipped).length;
      const fromCache = matchedValid.length;
      const visionNote = visionRedoResults ? `，视觉兜底重判 ${visionRedoResults.length} 个字段` : "";
      setStatus(
        "fill-status",
        `完成：成功 ${filled}，失败 ${failed}${lowIds.length ? `，低置信度 ${lowIds.length}（已高亮）` : ""}${visionNote}（缓存命中 ${fromCache}）`,
        failed ? "warn" : "ok"
      );
    } catch (error) {
      setStatus("fill-status", String(error.message || error), "warn");
    }
  }

  function waitRegionSelection() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 120000);
      function cleanup() {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
      }
      function listener(message) {
        if (message?.action === "onecv:regionSelected") {
          cleanup();
          resolve(message.selectedIds || []);
          return true;
        }
        return false;
      }
      chrome.runtime.onMessage.addListener(listener);
    });
  }

  // 结果区顶部提示条（段落数缺口 / 面板残留）
  function renderWarnings(items) {
    const container = document.getElementById("fill-warnings");
    container.innerHTML = "";
    container.hidden = items.length === 0;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = "warning-item";
      div.textContent = item.text;
      container.appendChild(div);
    }
  }

  function renderResults(results) {
    const container = document.getElementById("fill-results");
    container.innerHTML = "";
    for (const result of results.slice(0, 80)) {
      const item = document.createElement("div");
      item.className = `result-item${result.lowConfidence ? " low" : ""}${!result.ok && !result.skipped ? " fail" : ""}`;

      const badge = document.createElement("span");
      badge.className = `badge${result.lowConfidence ? " low" : ""}`;
      badge.textContent = result.skipped ? "跳过" : result.ok ? `${Math.round((result.confidence || 0) * 100)}%` : "失败";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = ` ${result.label || result.fieldId} `;

      const path = document.createElement("span");
      path.className = "path";
      path.textContent = `← ${result.path || ""}`;

      item.appendChild(badge);
      item.appendChild(label);
      item.appendChild(path);
      if (result.reason) {
        const reason = document.createElement("div");
        reason.textContent = result.reason;
        reason.className = "path";
        item.appendChild(reason);
      }
      container.appendChild(item);
    }
  }

  // ---- 简历摘要 + 编辑页 ----
  async function refreshResumeSummary() {
    const profile = await OneCVStorage.getResumeProfile();
    const el = document.getElementById("resume-summary");
    if (!profile) {
      el.textContent = "尚未填写简历。点击下方按钮打开编辑页，或粘贴简历原文让 AI 抽取。";
      return;
    }
    const catalog = OneCVSchema.getCatalogWithValues(profile);
    const filled = catalog.filter((entry) => entry.hasValue).length;
    el.textContent = `已填写 ${filled} / ${catalog.length} 个字段。`;
  }

  document.getElementById("btn-open-editor").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("resume-editor/editor.html") });
  });

  // ---- 简历 AI 导入 ----
  document.getElementById("btn-import").addEventListener("click", async () => {
    const rawText = document.getElementById("import-text").value.trim();
    if (!rawText) {
      setStatus("import-status", "请先粘贴简历原文", "warn");
      return;
    }
    setStatus("import-status", "AI 抽取中…（可能需要 10-30 秒）");
    try {
      const prompt = OneCVImportPrompt.buildResumeImportPrompt(OneCVSchema, rawText);
      const response = await chrome.runtime.sendMessage({
        action: "onecv:callModel",
        mode: "resume_import",
        system: "你是简历结构化抽取助手。只输出 JSON。",
        user: prompt,
        maxTokens: 8192,
      });
      if (!response?.ok) throw new Error(response?.error || "模型调用失败");

      const parsed = OneCVMapParse.parseJsonLoose(response.data.text);
      if (!parsed) throw new Error("AI 返回内容无法解析为 JSON，请重试");

      const existing = (await OneCVStorage.getResumeProfile()) || OneCVSchema.createEmptyResumeProfile();
      const incoming = OneCVSchema.normalizeResumeProfile(parsed);
      const merged = OneCVSchema.mergeProfileValues(OneCVSchema.clone(existing), incoming);

      await OneCVStorage.saveResumeProfile(OneCVSchema.normalizeResumeProfile(merged));
      setStatus("import-status", "抽取完成并已保存，请在编辑页复查", "ok");
      refreshResumeSummary();
    } catch (error) {
      setStatus("import-status", String(error.message || error), "warn");
    }
  });

  // ---- 设置 ----
  async function loadSettings() {
    const settings = await OneCVStorage.getSettings();
    document.getElementById("text-provider").value = settings.textModel.provider;
    document.getElementById("text-baseurl").value = settings.textModel.baseUrl;
    document.getElementById("text-model").value = settings.textModel.model;
    document.getElementById("text-apikey").value = settings.textModel.apiKey;
    document.getElementById("vision-enabled").checked = Boolean(settings.visionEnabled);
    document.getElementById("vision-model").value = settings.visionModel.model || "";
    document.getElementById("confidence-threshold").value = settings.confidenceThreshold;
    document.getElementById("threshold-value").textContent = settings.confidenceThreshold;
    document.getElementById("skip-low-confidence").checked = Boolean(settings.skipLowConfidence);
    document.getElementById("debugger-enabled").checked = Boolean(settings.debuggerFill);
  }

  document.getElementById("confidence-threshold").addEventListener("input", (event) => {
    document.getElementById("threshold-value").textContent = event.target.value;
  });

  // 强力填充开关：debugger 权限在 manifest 必需权限里声明（Chromium 不允许
  // 它作为 optional——会提示"cannot be listed as optional"并被忽略），
  // 因此开关只负责切换模式本身，无授权弹窗
  document.getElementById("debugger-enabled").addEventListener("change", async (event) => {
    const checkbox = event.target;
    try {
      const settings = await OneCVStorage.getSettings();
      settings.debuggerFill = checkbox.checked;
      await OneCVStorage.saveSettings(settings);
      setStatus("settings-status", checkbox.checked ? "强力填充已开启" : "强力填充已关闭", "ok");
    } catch (error) {
      checkbox.checked = false;
      setStatus("settings-status", String(error?.message || error), "warn");
    }
  });

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const settings = await OneCVStorage.getSettings();
    settings.textModel.provider = document.getElementById("text-provider").value;
    settings.textModel.baseUrl = document.getElementById("text-baseurl").value.trim();
    settings.textModel.model = document.getElementById("text-model").value.trim();
    settings.textModel.apiKey = document.getElementById("text-apikey").value.trim();
    settings.visionEnabled = document.getElementById("vision-enabled").checked;
    settings.visionModel.model = document.getElementById("vision-model").value.trim();
    // 视觉模型未单独填 baseURL/key 时沿用文本模型
    settings.visionModel.baseUrl = settings.textModel.baseUrl;
    settings.visionModel.apiKey = settings.textModel.apiKey;
    settings.confidenceThreshold = Number(document.getElementById("confidence-threshold").value);
    settings.skipLowConfidence = document.getElementById("skip-low-confidence").checked;
    settings.debuggerFill = document.getElementById("debugger-enabled").checked;

    await OneCVStorage.saveSettings(settings);
    setStatus("settings-status", "已保存", "ok");
  });

  // ---- 日志 ----
  async function refreshLogs() {
    const response = await chrome.runtime.sendMessage({ action: "onecv:getLogs" });
    const entries = response?.ok ? response.entries : [];
    const list = document.getElementById("log-list");
    list.innerHTML = "";
    for (const entry of entries.slice(-300).reverse()) {
      const line = document.createElement("div");
      line.className = `log-line ${entry.level}`;
      const detail =
        entry.detail == null ? "" : typeof entry.detail === "string" ? entry.detail : JSON.stringify(entry.detail);
      line.textContent = `${entry.ts.slice(11, 19)} [${entry.level}] ${entry.event} ${detail}`.slice(0, 400);
      list.appendChild(line);
    }
    if (!entries.length) list.textContent = "暂无日志";
  }

  document.getElementById("btn-refresh-logs").addEventListener("click", refreshLogs);
  document.getElementById("btn-clear-logs").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "onecv:clearLogs" });
    refreshLogs();
  });
  document.getElementById("btn-export-logs").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ action: "onecv:getLogs" });
    const entries = response?.ok ? response.entries : [];
    const text = OneCVDiagnostics.exportAsText(entries);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `onecv-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // ---- 初始化 ----
  loadSettings();
  refreshResumeSummary();

  // 简历数据在任何上下文变化（编辑页保存 / AI 导入 / 文件导入）都即时刷新摘要
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.onecv_resume) {
      refreshResumeSummary();
    }
  });
})();
