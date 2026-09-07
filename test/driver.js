// OneCV — E2E 驱动页（开发用，不进产物）
// 用法：driver.html?model=X&base=Y&key=Z&fixture=<resume json url>
// 流程：写设置 → 开/等 test-form 标签页 → scan → 真实 AI 映射 → 填充 → 读回页面值
(() => {
  "use strict";

  const out = document.getElementById("out");
  const log = (msg) => { out.textContent += "\n" + msg; };

  function params() {
    return new URLSearchParams(location.search);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function sendTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  }

  async function ensureTestFormTab() {
    const form = params().get("form") || "test-form.html";
    const url = "http://localhost:8123/" + form;
    let tabs = await chrome.tabs.query({ url: url + "*" });
    if (!tabs.length) {
      const tab = await chrome.tabs.create({ url, active: false });
      await sleep(1500);
      tabs = [tab];
    }
    const tab = tabs[0];
    // ping content script
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const pong = await sendTab(tab.id, { action: "onecv:ping" });
        if (pong && pong.ok) return tab.id;
      } catch (_) { /* retry */ }
      await sleep(600);
      chrome.tabs.reload(tab.id);
      await sleep(1200);
      tabs = await chrome.tabs.query({ url: url + "*" });
      if (tabs.length && tabs[0].id !== tab.id) return tabs[0].id;
    }
    throw new Error("content script 无法连接（test-form 页面）");
  }

  const EXPECT = {
    "姓名": null, "手机号码": null, "邮箱": null, "最高学历": null,
    "性别": null, "政治面貌": null, "现居城市": null,
    "学校名称": null, "专业": null, "入学时间": null, "毕业时间": null,
    "公司名称": null, "职位名称": null, "工作职责": null,
    "自我评价": null, "是否接受调剂": null, "可接受工作地点": null, "期望薪资": null,
  };

  async function readBack() {
    const results = await chrome.scripting.executeScript({
      target: { tabId: testFormTabId, allFrames: true },
      func: () => {
        const out = {};
        for (const el of document.querySelectorAll("input, select, textarea")) {
          const key = el.name || el.id || el.dataset.automationId || el.dataset.cy;
          if (!key || ["hidden", "file", "submit", "button"].includes(el.type)) continue;
          if (el.type === "checkbox") {
            out[key] = el.checked ? (el.dataset.label || el.value) : (out[key] || false);
          } else if (el.type === "radio") {
            if (el.checked) out[key] = el.dataset.label || el.value;
          } else {
            out[key] = el.value;
          }
        }
        out.__eventLog = window.__onecvEventLog || undefined;
        return out;
      },
    }).then((r) => r.map((x) => x.result).filter(Boolean));
    return Object.assign({}, ...results);
  }

  let testFormTabId = null;

  async function run() {
    out.textContent = "starting...";
    const p = params();
    const model = p.get("model") || "";
    const base = p.get("base") || "";
    const key = p.get("key") || "";
    const mode = p.get("mode") || "full";

    try {
      // 1. 设置：参数非空才覆盖（key 可经 CDP 预注入 storage，避免 URL 传递）
      const stored = await chrome.storage.local.get("onecv_settings");
      const saved = stored.onecv_settings || {};
      const textModel = {
        ...saved.textModel,
        ...(base ? { baseUrl: base } : {}),
        ...(key ? { apiKey: key } : {}),
        ...(model ? { model } : {}),
        provider: "openai-compatible",
      };
      const settings = {
        ...saved,
        textModel,
        visionModel: { ...textModel },
        confidenceThreshold: 0.6,
        skipLowConfidence: false,
        visionEnabled: false,
      };
      await chrome.storage.local.set({ onecv_settings: settings });

      // 2. 简历 fixture
      const fixtureUrl = p.get("fixture") || chrome.runtime.getURL("test/resume-fixture.json");
      const resume = await fetch(fixtureUrl).then((r) => r.json());
      await chrome.storage.local.set({ onecv_resume: resume });

      // 3. test-form 标签页
      testFormTabId = await ensureTestFormTab();

      // 4. scan（带 requestId，聚合所有 frame 的结果）
      const requestId = "scan_" + Date.now();
      const topScan = await sendTab(testFormTabId, { action: "onecv:scan", requestId, profile: resume });
      if (!topScan.ok) throw new Error("scan failed: " + topScan.error);
      // 轮询直到 frame 上报数量稳定（最长 3s）
      let framesResp = null;
      let stable = 0;
      for (let i = 0; i < 10; i += 1) {
        await sleep(300);
        framesResp = await chrome.runtime.sendMessage({ action: "onecv:getFrameScans", requestId });
        const count = framesResp && framesResp.ok ? framesResp.frames.length : 0;
        if (count === stable && count > 0) { stable = count; break; }
        stable = count;
      }
      const seenFingerprints = new Set();
      let descriptors = [];
      for (const frame of framesResp && framesResp.ok ? framesResp.frames : [{ descriptors: topScan.descriptors }]) {
        for (const d of frame.descriptors || []) {
          if (seenFingerprints.has(d.fingerprint)) continue;
          seenFingerprints.add(d.fingerprint);
          descriptors.push(d);
        }
      }
      const scan = { ok: true, descriptors, signature: topScan.signature };
      log(`scan: ${descriptors.length} fields from ${(framesResp && framesResp.frames ? framesResp.frames.length : 1)} frame(s), sig=${scan.signature}`);

      // 打印扫描特征（供检查 label/option 提取质量）
      for (const d of scan.descriptors) {
        log(`  [${d.kind}] label="${d.labelText}" name=${d.name} opts=${d.options.length} section=${d.sectionTexts.join("/")}`);
      }

      if (mode === "scan") { log("MODE=scan, done."); return; }

      // 5. AI 映射
      const profile = resume;
      const cfStored = await chrome.storage.local.get("onecv_custom_item_fields");
      OneCVSchema.applyCustomFieldDefs(cfStored.onecv_custom_item_fields || {});
      const catalog = OneCVSchema.getCatalogWithValues(profile);
      const payload = OneCVScannerCore.buildMappingPayload(scan.descriptors, catalog, {
        url: "http://localhost:8123/test-form.html",
        title: "OneCV E2E",
      });

      const t0 = Date.now();
      const response = await chrome.runtime.sendMessage({
        action: "onecv:callModel",
        mode: "field_mapping",
        system: OneCVMapPrompt.SYSTEM_PROMPT,
        user: OneCVMapPrompt.buildUserPrompt(payload),
      });
      if (!response.ok) throw new Error("model call failed: " + response.error);
      log(`model call: ${Date.now() - t0}ms, response chars=${response.data.text.length}`);
      log("RAW RESPONSE:\n" + response.data.text.slice(0, 800));

      const parsed = OneCVMapParse.parseMappingResponse(response.data.text, {
        validFieldIds: scan.descriptors.map((d) => d.pageFieldId),
        validPaths: catalog.map((c) => c.path),
        validTransforms: OneCVScannerCore.TRANSFORM_RULES,
      });
      if (parsed.error) throw new Error("parse failed: " + parsed.error);
      log(`parsed mappings: ${parsed.mappings.length}, ignored: ${JSON.stringify(parsed.ignored)}`);

      // 6. fill：ack + 经 background 轮询结果（Edge 异步 sendResponse 不可靠）
      const fillToken = "fill_" + Date.now();
      const varStored = await chrome.storage.local.get("onecv_desc_variants");
      const ack = await sendTab(testFormTabId, {
        action: "onecv:fill",
        token: fillToken,
        mappings: parsed.mappings,
        mode: "overwrite",
        profile: resume,
        settings: settings,
        variants: varStored.onecv_desc_variants || {},
      });
      if (!ack || !ack.ok) throw new Error("fill not accepted: " + (ack && ack.error));
      let fill = null;
      for (let i = 0; i < 30; i += 1) {
        await sleep(1000);
        const r = await chrome.tabs.sendMessage(testFormTabId, { action: "onecv:getFillResult", token: fillToken }, { frameId: 0 });
        if (r && r.ok) { fill = r.result; break; }
      }
      if (!fill) throw new Error("fill result timeout");
      if (!fill.ok) throw new Error("fill failed: " + fill.error);
      for (const r of fill.results) {
        log(`fill [${r.ok ? (r.skipped ? "SKIP" : "OK") : "FAIL"}] ${r.label || r.fieldId} <- ${r.path || ""} ${r.reason || ""} conf=${r.confidence ?? ""}`);
      }

      // 7. 读回页面值
      await sleep(300);
      const values = await readBack();
      log("PAGE VALUES: " + JSON.stringify(values, null, 1));
      log("DONE mode=" + mode);
    } catch (error) {
      log("ERROR: " + (error && error.message));
    }
  }

  let testFormTabIdGlobal = null;

  document.getElementById("run").addEventListener("click", run);

  // URL 带 autorun=1 时自动执行（便于 CDP 驱动）
  if (params().get("autorun") === "1") run();
})();
