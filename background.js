// OneCV — Background service worker
// 职责：统一代理模型 API 调用 + 汇聚日志 + storage 枢纽。
// 说明：MV3 service worker 会在空闲后被回收，跨生命周期状态一律走 chrome.storage，
// 不在内存里保存请求级状态（曾因内存态 frameScanStore/fillResult 中转导致
// "结果超时但实际已填入"，该路径已废弃移除；现行结果回传由 sidepanel 直连 frame 0 轮询）。
importScripts(
  "shared/one-provider.js",
  "shared/one-diagnostics.js",
  "shared/one-storage.js"
);

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.sidePanel.open({ tabId: tab.id });
});

// ---------------------------------------------------------------------------
// 消息路由（单一监听器）
// ---------------------------------------------------------------------------
const LOG_RING_LIMIT = 2000;
let logBuffer = [];
let logFlushTimer = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== "object") return;
  if (sender?.id && sender.id !== chrome.runtime.id) return;

  switch (request.action) {
    case "onecv:log":
      appendLogEntries(request.entries, sender);
      sendResponse({ ok: true });
      return;
    case "onecv:getLogs":
      getLogBuffer()
        .then((entries) => sendResponse({ ok: true, entries }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    case "onecv:clearLogs":
      logBuffer = [];
      chrome.storage.local.set({ onecv_logs: [] });
      sendResponse({ ok: true });
      return;
    case "onecv:getProfile":
    case "onecv:getSettings":
      chrome.storage.local
        .get(request.action === "onecv:getProfile" ? "onecv_resume" : "onecv_settings")
        .then((stored) => {
          const key = request.action === "onecv:getProfile" ? "onecv_resume" : "onecv_settings";
          sendResponse({ ok: true, data: stored[key] });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    case "onecv:callModel":
      handleCallModel(request)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    case "onecv:dbgAttach":
      handleDbgAttach(sender)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    case "onecv:dbgInput":
      handleDbgInput(request, sender)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    case "onecv:dbgDetach":
      handleDbgDetach(sender)
        .then((data) => sendResponse({ ok: true, data }))
        .catch(() => sendResponse({ ok: true }));
      return true;
    default:
      return;
  }
});

function appendLogEntries(entries, sender) {
  if (!Array.isArray(entries)) return;
  const scope = sender?.url || "background";
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    logBuffer.push({
      ts: entry.ts || new Date().toISOString(),
      level: entry.level || "info",
      scope: entry.scope || scope,
      event: String(entry.event || ""),
      detail: entry.detail == null ? null : entry.detail,
    });
  }
  if (logBuffer.length > LOG_RING_LIMIT) {
    logBuffer = logBuffer.slice(-LOG_RING_LIMIT);
  }
  scheduleLogFlush();
}

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    chrome.storage.local.set({ onecv_logs: logBuffer.slice(-LOG_RING_LIMIT) });
  }, 800);
}

async function getLogBuffer() {
  if (logBuffer.length) return logBuffer;
  const stored = await chrome.storage.local.get("onecv_logs");
  logBuffer = Array.isArray(stored.onecv_logs) ? stored.onecv_logs : [];
  return logBuffer;
}

// ---------------------------------------------------------------------------
// 模型调用代理
// mode: "field_mapping" | "resume_import" | "vision_mapping"（视觉走 visionModel 配置）
// ---------------------------------------------------------------------------
async function handleCallModel(request) {
  const settings = await OneCVStorage.getSettings();
  const mode = request.mode || "field_mapping";
  const useVision = mode === "vision_mapping";
  const modelConfig = useVision
    ? { ...(settings.visionModel || settings.textModel || {}) }
    : { ...(settings.textModel || {}) };

  if (!modelConfig.apiKey) {
    throw new Error("未配置模型 API Key，请先在侧边栏「模型设置」中填写。");
  }

  const modelOpts = {
    system: request.system || "",
    user: request.user || "",
    images: useVision ? request.images || [] : [],
    maxTokens: request.maxTokens,
  };
  let responseText;
  try {
    responseText = await OneCVProvider.sendChat(modelConfig, modelOpts);
  } catch (error) {
    // 思考型模型推理长度随采样波动：空 content 是随机的，自动重采样一次
    const msg = String(error?.message || error);
    if (/没有文本内容|输出额度/.test(msg)) {
      OneCVDiagnostics.log({ level: "warn", event: "model_empty_retry", detail: { mode } });
      responseText = await OneCVProvider.sendChat(modelConfig, modelOpts);
    } else {
      throw error;
    }
  }

  OneCVDiagnostics.log({
    level: "info",
    event: "model_call_completed",
    detail: {
      mode,
      provider: modelConfig.provider,
      model: modelConfig.model,
      chars: responseText.length,
    },
  });
  scheduleLogFlush();

  return { text: responseText };
}

// ---------------------------------------------------------------------------
// 强力填充：chrome.debugger 真实输入（设置开关 + optional permission "debugger"）。
// content 负责算坐标与验证 DOM，background 只派发可信输入事件。
// ---------------------------------------------------------------------------
const dbgAttached = new Set();

async function handleDbgAttach(sender) {
  const tabId = sender.tab?.id;
  if (!tabId) throw new Error("强力填充仅在网页标签页中可用");
  if (!chrome.debugger) throw new Error("debugger 权限未授予：请到设置开启「强力填充」开关并允许授权");
  await chrome.debugger.attach({ tabId }, "1.3");
  dbgAttached.add(tabId);
  OneCVDiagnostics.log({ level: "info", event: "dbg_attached", detail: { tabId } });
  return { ok: true };
}

async function handleDbgInput(request, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) throw new Error("强力填充仅在网页标签页中可用");
  if (!dbgAttached.has(tabId)) throw new Error("调试会话未建立");
  const steps = Array.isArray(request.steps) ? request.steps : [];
  try {
    for (const step of steps) {
      if (step.type === "click") {
        // 真实移动→按下→释放：比直接按下更接近真实用户输入
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseMoved", x: step.x, y: step.y, button: "left",
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mousePressed", x: step.x, y: step.y, button: "left", clickCount: 1,
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseReleased", x: step.x, y: step.y, button: "left", clickCount: 1,
        });
      } else if (step.type === "wheel") {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type: "mouseWheel", x: step.x, y: step.y, button: "none",
          deltaX: 0, deltaY: Number(step.deltaY) || 480,
        });
      } else if (step.type === "key") {
        // 可信键盘事件：type-to-filter + Enter（搜索型下拉的通用选中方式）
        const key = String(step.key || "");
        const base = { key, code: step.code || key, windowsVirtualKeyCode: Number(step.vk) || 0 };
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown", ...base,
          ...(step.text !== undefined ? { text: step.text, unmodifiedText: step.text } : {}),
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp", ...base,
        });
      }
      if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    return { ok: true };
  } catch (error) {
    // 会话失效（如用户打开了 DevTools）：断开并要求重新 attach
    try { await chrome.debugger.detach({ tabId }); } catch (_) { /* 忽略 */ }
    dbgAttached.delete(tabId);
    throw error;
  }
}

async function handleDbgDetach(sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { ok: true };
  try { await chrome.debugger.detach({ tabId }); } catch (_) { /* 未附加时忽略 */ }
  dbgAttached.delete(tabId);
  OneCVDiagnostics.log({ level: "info", event: "dbg_detached", detail: { tabId } });
  return { ok: true };
}
