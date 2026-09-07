// OneCV — 简历编辑页（schema 驱动）
(() => {
  "use strict";

  const SCHEMA = window.OneCVSchema;

  let profile = SCHEMA.createEmptyResumeProfile();
  // 用户自定义字段（按 section）：{ internships: [{key, label, type}] }
  // 运行时动态扩展 schema，使目录/归一化/映射自动感知
  let customItemFields = {};

  function loadCustomFields() {
    return new Promise((resolve) => {
      chrome.storage.local.get("onecv_custom_item_fields", (data) => {
        customItemFields = (data && data.onecv_custom_item_fields) || {};
        SCHEMA.applyCustomFieldDefs(customItemFields);
        resolve();
      });
    });
  }

  function saveCustomFields() {
    SCHEMA.applyCustomFieldDefs(customItemFields);
    chrome.storage.local.set({ onecv_custom_item_fields: customItemFields });
  }
  const collapsedSections = new Set();

  // 语言 → 该语言常见考试（编辑页联动；schema 里的 examType 是全量清单）
  const LANGUAGE_EXAMS = {
    "英语": ["CET-4", "CET-6", "英语专四（TEM-4）", "英语专八（TEM-8）", "TOEFL", "IELTS", "GRE", "GMAT", "BEC", "PTE", "CATTI"],
    "日语": ["JLPT N1", "JLPT N2", "JLPT N3", "JLPT N4", "JLPT N5", "EJU"],
    "韩语": ["TOPIK"],
    "法语": ["DELF", "DALF", "TCF", "TEF"],
    "德语": ["TestDaF", "歌德证书", "DSH"],
    "俄语": ["ТРКИ"],
    "其他语言": ["其他考试"],
  };

  // ---- 存储 ----
  const Store = {
    get() {
      return new Promise((resolve) => {
        chrome.storage.local.get("onecv_resume", (data) => resolve(data.onecv_resume || null));
      });
    },
    save(data) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ onecv_resume: data }, () => resolve());
      });
    },
  };

  // ---- 初始化 ----
  async function init() {
    const stored = await Store.get();
    // 存档统一过归一化：schema 演进（新增字段/选项）后旧数据也能补齐默认结构
    if (stored) profile = SCHEMA.normalizeResumeProfile(stored);
    await loadCustomFields();
    render();
  }

  // ---- 区块统计（移植自参考项目 buildResumeSectionStats 思路） ----
  function isMeaningful(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.some(isMeaningful);
    if (typeof value === "object") return Object.values(value).some(isMeaningful);
    return String(value).trim().length > 0;
  }

  function buildSectionStats(section) {
    if (section.type === "group") {
      const fields = section.fields || [];
      const filled = fields.filter((f) => isMeaningful(profile[section.key] && profile[section.key][f.key])).length;
      return { text: "已填写 " + filled + " / " + fields.length + " 项", hasValue: filled > 0 };
    }
    const items = profile[section.key] || [];
    const filledItems = items.filter((item) => Object.values(item || {}).some(isMeaningful)).length;
    return { text: "已填写 " + filledItems + " / " + items.length + " 条", hasValue: filledItems > 0 };
  }

  function renderNav() {
    const nav = document.getElementById("editor-nav");
    nav.innerHTML = "";
    for (const section of SCHEMA.sections) {
      const stats = buildSectionStats(section);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "editor-nav-btn" + (stats.hasValue ? " has-value" : "");
      btn.dataset.section = section.key;
      const labelEl = document.createElement("span");
      labelEl.className = "editor-nav-label";
      labelEl.textContent = section.label;
      const metaEl = document.createElement("span");
      metaEl.className = "editor-nav-meta";
      metaEl.textContent = stats.text.replace("已填写 ", "");
      btn.appendChild(labelEl);
      btn.appendChild(metaEl);
      btn.addEventListener("click", () => {
        collapsedSections.delete(section.key);
        render();
        const card = document.querySelector('[data-section-card="' + section.key + '"]');
        if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      nav.appendChild(btn);
    }
  }

  // ---- 渲染 ----
  function render() {
    renderNav();
    const root = document.getElementById("editor-root");
    root.innerHTML = "";

    for (const section of SCHEMA.sections) {
      const card = document.createElement("section");
      card.className = "section-card" + (collapsedSections.has(section.key) ? " collapsed" : "");
      card.dataset.sectionCard = section.key;

      const head = document.createElement("div");
      head.className = "section-head";
      const h2 = document.createElement("h2");
      h2.textContent = section.label;
      head.appendChild(h2);
      const toggleMark = document.createElement("span");
      toggleMark.className = "toggle-mark";
      toggleMark.textContent = collapsedSections.has(section.key) ? "展开 ▸" : "收起 ▾";
      head.appendChild(toggleMark);
      if (section.type === "list") head.appendChild(makeAddItemButton(section));
      head.addEventListener("click", (event) => {
        if (event.target.closest("button")) return; // 添加按钮不触发折叠
        if (collapsedSections.has(section.key)) collapsedSections.delete(section.key);
        else collapsedSections.add(section.key);
        render();
      });
      card.appendChild(head);

      const bodyWrap = document.createElement("div");
      if (section.type === "group") {
        bodyWrap.appendChild(renderGroupBody(section));
      } else {
        ensureItems(section);
        profile[section.key].forEach((item, itemIndex) => {
          bodyWrap.appendChild(renderListItem(section, itemIndex));
        });
      }
      card.appendChild(bodyWrap);

      root.appendChild(card);
    }
    updateStatus("已加载", false);
  }

  function ensureItems(section) {
    if (!Array.isArray(profile[section.key]) || profile[section.key].length === 0) {
      profile[section.key] = [SCHEMA.createEmptyListItem(section.key)];
    }
  }

  function makeAddItemButton(section) {
    const button = document.createElement("button");
    button.className = "btn small";
    button.textContent = "+ 添加一条";
    button.addEventListener("click", () => {
      profile[section.key].push(SCHEMA.createEmptyListItem(section.key));
      render();
    });
    return button;
  }

  function renderListItem(section, itemIndex) {
    const card = document.createElement("div");
    card.className = "item-card";

    const head = document.createElement("div");
    head.className = "item-head";
    const title = document.createElement("span");
    title.textContent = section.itemLabel + " " + (itemIndex + 1);
    head.appendChild(title);

    const remove = document.createElement("button");
    remove.className = "btn small danger";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      profile[section.key].splice(itemIndex, 1);
      if (!profile[section.key].length) profile[section.key].push(SCHEMA.createEmptyListItem(section.key));
      render();
    });
    head.appendChild(remove);
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "grid";
    for (const field of section.fields) {
      grid.appendChild(renderField(section.key, itemIndex, field));
    }
    card.appendChild(grid);

    // 自定义字段：用户为该区块新增的字段（所有条目共享定义）
    const addCustomBtn = document.createElement("button");
    addCustomBtn.type = "button";
    addCustomBtn.className = "btn small add-custom";
    addCustomBtn.textContent = "+ 添加自定义字段";
    const customForm = document.createElement("div");
    customForm.hidden = true;
    customForm.className = "custom-field-form";

    addCustomBtn.addEventListener("click", () => {
      customForm.hidden = !customForm.hidden;
      if (!customForm.hidden) {
        customForm.innerHTML = "";
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "字段名称，如：描述（200字版本）";
        const typeSel = document.createElement("select");
        for (const t of [["text", "文本行"], ["textarea", "文本段"], ["date", "日期"]]) {
          const opt = document.createElement("option");
          opt.value = t[0];
          opt.textContent = t[1];
          typeSel.appendChild(opt);
        }
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn small primary";
        ok.textContent = "确定";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn small";
        cancel.textContent = "取消";
        ok.addEventListener("click", () => {
          const label = nameInput.value.trim();
          if (!label) return;
          const sectionKey = section.key;
          if (!customItemFields[sectionKey]) customItemFields[sectionKey] = [];
          customItemFields[sectionKey].push({
            key: "c" + Date.now().toString(36),
            label: label,
            type: typeSel.value,
          });
          saveCustomFields();
          render();
        });
        cancel.addEventListener("click", () => { customForm.hidden = true; });
        customForm.appendChild(nameInput);
        customForm.appendChild(typeSel);
        customForm.appendChild(ok);
        customForm.appendChild(cancel);
      }
    });
    card.appendChild(addCustomBtn);
    card.appendChild(customForm);

    return card;
  }

  function renderGroupBody(section) {
    const body = document.createElement("div");
    body.className = "grid";
    body.style.padding = "14px 16px";
    for (const field of section.fields) {
      body.appendChild(renderField(section.key, null, field));
    }
    return body;
  }

  function renderField(sectionKey, itemIndex, field) {
    const wrapper = document.createElement("div");
    wrapper.className = "field" + (field.input === "textarea" ? " full" : "");

    const labelRow = document.createElement("div");
    labelRow.className = "label-row";
    const label = document.createElement("span");
    label.textContent = field.label;
    if (field.placeholder) label.title = field.placeholder;
    labelRow.appendChild(label);
    if (field.__runtimeCustom) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "custom-del";
      del.textContent = "删除";
      del.title = "删除该自定义字段（所有条目）";
      del.addEventListener("click", () => {
        if (!confirm("删除自定义字段「" + field.label + "」？该字段在所有条目中的值将一并移除。")) return;
        const fields = customItemFields[sectionKey] || [];
        const idx = fields.findIndex((f) => f.key === field.key);
        if (idx >= 0) { fields.splice(idx, 1); saveCustomFields(); }
        (profile[sectionKey] || []).forEach((item) => { delete item[field.key]; });
        render();
      });
      labelRow.appendChild(del);
    }
    wrapper.appendChild(labelRow);

    // 先算 path/value（select 自定义分支需要）
    const path = itemIndex == null
      ? sectionKey + "." + field.key
      : sectionKey + "." + itemIndex + "." + field.key;
    const value = SCHEMA.getValueByPath(profile, path);

    let options = field.options || [];
    if (sectionKey === "languages" && field.key === "examType" && itemIndex != null) {
      const lang = (profile.languages[itemIndex] || {}).name || "";
      if (LANGUAGE_EXAMS[lang]) options = [""].concat(LANGUAGE_EXAMS[lang], ["其他考试"]);
    }

    let input;
    if (field.input === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else if (field.input === "select") {
      // 所有下拉可选内容支持自定义：选项列表 + "自定义…"（切换为文本输入）
      const isCustomValue = Boolean(value) && !options.includes(value);
      input = document.createElement("select");
      for (const option of options) {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option || "（未选择）";
        input.appendChild(opt);
      }
      const customOpt = document.createElement("option");
      customOpt.value = "__onecv_custom__";
      customOpt.textContent = "自定义…";
      input.appendChild(customOpt);

      if (isCustomValue) {
        // 当前值不在枚举内：直接以文本输入呈现
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.value = value || "";
        textInput.addEventListener("change", () => {
          SCHEMA.setValueByPath(profile, path, textInput.value);
        });
        const revert = document.createElement("button");
        revert.className = "btn small";
        revert.textContent = "改为选择";
        revert.addEventListener("click", () => render());
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.gap = "6px";
        wrap.appendChild(textInput);
        wrap.appendChild(revert);
        wrapper.appendChild(wrap);
        return wrapper;
      }

      input.addEventListener("change", () => {
        if (input.value === "__onecv_custom__") {
          const textInput = document.createElement("input");
          textInput.type = "text";
          textInput.placeholder = "输入自定义值";
          textInput.addEventListener("change", () => {
            SCHEMA.setValueByPath(profile, path, textInput.value);
          });
          input.replaceWith(textInput);
          textInput.focus();
          return;
        }
        SCHEMA.setValueByPath(profile, path, input.value);
      });
    } else {
      input = document.createElement("input");
      input.type =
        field.input === "date" ? "date" :
        field.input === "email" ? "email" :
        field.input === "url" ? "url" :
        field.input === "tel" ? "tel" : "text";
    }

    if (value) input.value = value;

    input.addEventListener("change", () => {
      if (input.value === "__onecv_custom__") return; // 自定义分支已单独处理
      SCHEMA.setValueByPath(profile, path, input.value);
      if (sectionKey === "languages" && (field.key === "name" || field.key === "examType")) {
        render(); // 联动：考试类型选项随语言变化
      }
    });

    wrapper.appendChild(input);

    return wrapper;
  }

  function updateStatus(text, isError) {
    const el = document.getElementById("save-status");
    el.textContent = text;
    el.style.color = isError ? "var(--danger)" : "";
  }

  document.getElementById("btn-save").addEventListener("click", async () => {
    await Store.save(profile);
    updateStatus("已保存 " + new Date().toLocaleTimeString(), false);
  });

  // ---- 导出 / 导入 JSON ----
  document.getElementById("btn-export").addEventListener("click", () => {
    const exportData = Object.assign({}, profile, { customItemFields: customItemFields });
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "onecv-resume.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    updateStatus("已导出 JSON", false);
  });

  document.getElementById("btn-import-json").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsedJson = JSON.parse(text);
      if (parsedJson.customItemFields) {
        customItemFields = parsedJson.customItemFields;
        saveCustomFields();
        delete parsedJson.customItemFields;
      }
      profile = SCHEMA.normalizeResumeProfile(parsedJson);
      await Store.save(profile);
      render();
      updateStatus("已导入 JSON 并保存", false);
    } catch (error) {
      updateStatus("导入失败：" + error.message, true);
    }
    event.target.value = "";
  });

  // ---- PDF 导入（仅支持有文字层的 PDF；扫描版请先自行 OCR） ----
  async function extractPdfText(file) {
    if (!window.pdfjsLib) throw new Error("pdf.js 未加载");
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("libs/pdf.worker.min.js");

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    let text = "";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n";
    }

    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length < 30) {
      throw new Error("未提取到足够文本，可能是扫描版 PDF（无文字层），请先自行 OCR");
    }
    return trimmed;
  }

  async function importPdf(file) {
    const rawText = await extractPdfText(file);
    updateStatus("AI 抽取中…（10-30 秒）", false);

    const response = await chrome.runtime.sendMessage({
      action: "onecv:callModel",
      mode: "resume_import",
      system: "你是简历结构化抽取助手。只输出 JSON。",
      user: OneCVImportPrompt.buildResumeImportPrompt(SCHEMA, rawText),
      maxTokens: 8192,
    });
    if (!response || !response.ok) throw new Error((response && response.error) || "模型调用失败");

    const json = OneCVMapParse.parseJsonLoose(response.data.text);
    if (!json) throw new Error("AI 返回内容无法解析为 JSON，请重试");

    const incoming = SCHEMA.normalizeResumeProfile(json);
    SCHEMA.mergeProfileValues(profile, incoming);

    await Store.save(profile);
    render();
    updateStatus("PDF 抽取完成并已保存，请复查", false);
  }

  const pdfInput = document.createElement("input");
  pdfInput.type = "file";
  pdfInput.accept = ".pdf,application/pdf";
  pdfInput.hidden = true;
  document.body.appendChild(pdfInput);

  const pdfButton = document.createElement("button");
  pdfButton.className = "btn";
  pdfButton.textContent = "导入 PDF（AI 抽取）";
  pdfButton.addEventListener("click", () => pdfInput.click());
  document.querySelector(".actions").appendChild(pdfButton);

  pdfInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    updateStatus("PDF 文本提取中…", false);
    try {
      await importPdf(file);
    } catch (error) {
      updateStatus(String(error.message || error), true);
    }
    pdfInput.value = "";
  });

  init();
})();
