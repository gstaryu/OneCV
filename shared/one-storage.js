// OneCV — chrome.storage 封装
// API Key / 模型配置 / 简历数据都只存 chrome.storage.local，不经过任何后端。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVStorage = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const KEYS = {
      settings: "onecv_settings",
      resume: "onecv_resume",
      cache: "onecv_mapping_cache",
      logs: "onecv_logs",
    };

    const DEFAULT_SETTINGS = {
      textModel: {
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        model: "",
      },
      visionModel: {
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        model: "",
      },
      // 低于该置信度的映射：默认仍填，但 UI 高亮要求人工复查（详见 fill 执行器）
      confidenceThreshold: 0.7,
      // 低置信度字段：默认仍填，但 UI 高亮；保守模式直接跳过
      skipLowConfidence: false,
      visionEnabled: false,
      // 强力填充模式：chrome.debugger 派发真实输入（设置里开启 + 授权后生效），
      // 用于合成事件搞不定的虚拟滚动年份下拉；填充时页面顶部会出现调试横幅
      debuggerFill: false,
    };

    function getChromeStorage() {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return chrome.storage.local;
      }
      // Node 测试环境：内存实现
      const mem = new Map();
      return {
        async get(keys) {
          const out = {};
          const list = Array.isArray(keys) ? keys : keys != null ? [keys] : [];
          for (const key of list) {
            if (mem.has(key)) out[key] = mem.get(key);
          }
          return out;
        },
        async set(obj) {
          for (const [key, value] of Object.entries(obj || {})) {
            mem.set(key, value);
          }
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) mem.delete(key);
        },
        __mem: mem,
      };
    }

    async function getSettings() {
      const storage = getChromeStorage();
      const stored = await storage.get(KEYS.settings);
      const saved = stored[KEYS.settings] || {};
      const merged = {
        ...DEFAULT_SETTINGS,
        ...saved,
        textModel: { ...DEFAULT_SETTINGS.textModel, ...(saved.textModel || {}) },
        visionModel: { ...DEFAULT_SETTINGS.visionModel, ...(saved.visionModel || {}) },
      };
      return merged;
    }

    async function saveSettings(settings) {
      const storage = getChromeStorage();
      await storage.set({ [KEYS.settings]: settings });
    }

    async function getResumeProfile() {
      const storage = getChromeStorage();
      const stored = await storage.get(KEYS.resume);
      return stored[KEYS.resume] || null;
    }

    async function saveResumeProfile(profile) {
      const storage = getChromeStorage();
      await storage.set({ [KEYS.resume]: profile });
    }

    async function getMappingCache() {
      const storage = getChromeStorage();
      const stored = await storage.get(KEYS.cache);
      return stored[KEYS.cache] || {};
    }

    async function saveMappingCache(cache) {
      const storage = getChromeStorage();
      await storage.set({ [KEYS.cache]: cache });
    }

    return {
      KEYS,
      DEFAULT_SETTINGS,
      getSettings,
      saveSettings,
      getResumeProfile,
      saveResumeProfile,
      getMappingCache,
      saveMappingCache,
    };
  }
);
