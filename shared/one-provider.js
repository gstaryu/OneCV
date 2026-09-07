// OneCV — 模型接入抽象层
// 把"发送 prompt → 拿到文本响应"与具体厂商解耦。
// 支持：openai-compatible（POST {base}/chat/completions）、anthropic（POST {base}/v1/messages）。
// 纯函数 buildChatRequest / parseChatResponse 可被 Node 测试直接覆盖。
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVProvider = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const DEFAULT_MAX_TOKENS = 32768;
    const DEFAULT_TIMEOUT_MS = 600000; // 思考型模型单次可达数分钟，给足 10 分钟

    function normalizeBaseUrl(baseUrl, provider) {
      let url = String(baseUrl || "").trim().replace(/\/+$/, "");
      if (!url) url = "https://api.openai.com/v1";

      if (provider === "anthropic") {
        if (/\/v1\/messages$/.test(url)) return url;
        if (/\/v1$/.test(url)) return `${url}/messages`;
        return `${url}/v1/messages`;
      }

      // openai-compatible：允许用户直接粘贴完整 endpoint
      if (/\/chat\/completions$/.test(url)) return url;
      return `${url}/chat/completions`;
    }

    // Base URL 安全校验：仅允许 HTTPS（本机开发地址允许 HTTP）
    function validateBaseUrl(url) {
      let parsed;
      try {
        parsed = new URL(String(url || ""));
      } catch (_) {
        throw new Error("Base URL 不是有效地址，请检查模型设置");
      }
      const host = parsed.hostname.toLowerCase();
      const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
        throw new Error("Base URL 必须使用 HTTPS（仅本机地址允许 HTTP），请检查模型设置");
      }
      return url;
    }

    function buildChatRequest(config, options) {
      const provider = String(config.provider || "openai-compatible");
      const opts = options || {};
      const maxTokens = Number(opts.maxTokens) > 0 ? Number(opts.maxTokens) : DEFAULT_MAX_TOKENS;
      const images = Array.isArray(opts.images) ? opts.images.filter(Boolean) : [];

      const headers = { "Content-Type": "application/json" };
      let url;
      let body;

      if (provider === "anthropic") {
        url = normalizeBaseUrl(config.baseUrl, "anthropic");
        headers["x-api-key"] = String(config.apiKey || "");
        headers["anthropic-version"] = "2023-06-01";
        headers["anthropic-dangerous-direct-browser-access"] = "true";

        const content = [];
        if (images.length) {
          for (const img of images) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType || "image/png",
                data: img.base64,
              },
            });
          }
        }
        content.push({ type: "text", text: String(opts.user || "") });

        body = {
          model: String(config.model || ""),
          max_tokens: maxTokens,
          system: String(opts.system || ""),
          messages: [{ role: "user", content }],
        };
      } else {
        url = normalizeBaseUrl(config.baseUrl, "openai-compatible");
        headers.Authorization = `Bearer ${String(config.apiKey || "")}`;

        const messages = [];
        if (opts.system) {
          messages.push({ role: "system", content: String(opts.system) });
        }

        if (images.length) {
          const content = [];
          for (const img of images) {
            content.push({
              type: "image_url",
              image_url: { url: `data:${img.mediaType || "image/png"};base64,${img.base64}` },
            });
          }
          content.push({ type: "text", text: String(opts.user || "") });
          messages.push({ role: "user", content });
        } else {
          messages.push({ role: "user", content: String(opts.user || "") });
        }

        body = {
          model: String(config.model || ""),
          messages,
          max_tokens: maxTokens,
          temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0,
        };
      }

      return { url, headers, body };
    }

    function parseChatResponse(provider, data) {
      if (!data || typeof data !== "object") {
        throw new Error("模型响应格式异常：不是 JSON 对象");
      }

      if (provider === "anthropic") {
        if (data.type === "error" || data.error) {
          throw new Error(data.error?.message || "模型返回错误");
        }
        const blocks = Array.isArray(data.content) ? data.content : [];
        const text = blocks
          .filter((block) => block && block.type === "text")
          .map((block) => block.text || "")
          .join("\n")
          .trim();
        if (!text) throw new Error("模型响应中没有文本内容");
        return text;
      }

      if (data.error) {
        const err = data.error;
        throw new Error(
          `模型返回错误 ${err.code || err.type || ""}: ${err.message || JSON.stringify(err).slice(0, 200)}`
        );
      }

      const choices = Array.isArray(data.choices) ? data.choices : [];
      const text = choices
        .map((choice) => choice?.message?.content ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) {
        // 思考型模型（glm/doubao seed 等）推理会占用 max_tokens：推理过长时
        // content 为空、finish_reason=length——正是"choices 为空"报错的根因
        const choice = choices[0] || {};
        const reasoningLen = String(choice?.message?.reasoning_content || "").length;
        if (choice?.finish_reason === "length" || reasoningLen > 0) {
          throw new Error(
            `模型思考耗尽了输出额度（推理 ${reasoningLen} 字，finish=${choice?.finish_reason || "?"}），未产出正文。请重试（会自动重试一次），或在模型设置中换非思考型模型。`
          );
        }
        throw new Error("模型响应中没有文本内容（choices 为空）");
      }
      return text;
    }

    async function sendChat(config, options) {
      const provider = String(config.provider || "openai-compatible");
      const { url, headers, body } = buildChatRequest(config, options);
      validateBaseUrl(url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          let detail = errText.slice(0, 300);
          try {
            const errJson = JSON.parse(errText);
            detail = errJson?.error?.message || errJson?.message || detail;
          } catch (_) {
            /* 保持原始文本 */
          }
          // 思考型模型可能不支持过大的 max_tokens：自动降回 8192 重试一次
          if (response.status === 400 && /max_tokens/i.test(detail) && body.max_tokens === DEFAULT_MAX_TOKENS) {
            const retry = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...body, max_tokens: 8192 }),
              signal: controller.signal,
            });
            if (retry.ok) {
              const retryData = await retry.json();
              return parseChatResponse(provider, retryData);
            }
          }
          // 分级错误文案（移植自参考项目思路）
          let friendly = "";
          if (response.status === 401 || response.status === 403) friendly = "API Key 无效或无权限，请检查模型设置";
          else if (response.status === 429) friendly = "请求过于频繁或额度不足，请稍后重试";
          else if (response.status >= 500) friendly = "模型服务暂时不可用，请稍后重试";
          throw new Error(friendly ? friendly + "（HTTP " + response.status + "）" : "模型 API HTTP " + response.status + ": " + detail);
        }

        const data = await response.json();
        return parseChatResponse(provider, data);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error(`模型请求超时（${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s）`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      normalizeBaseUrl,
      validateBaseUrl,
      buildChatRequest,
      parseChatResponse,
      sendChat,
    };
  }
);
