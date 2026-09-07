// OneCV — 字段扫描纯逻辑层
// content.js 负责 DOM 遍历产出 RawFieldInfo；本模块负责所有可独立测试的转换：
//   RawFieldInfo → FieldDescriptor（含稳定 pageFieldId / 特征指纹）
//   FieldDescriptor[] → 页面结构签名
//   FieldDescriptor[] + 简历目录 → 发给模型的映射 payload
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.OneCVScannerCore = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    // 允许发给模型的 transform 规则（与填充执行器一一对应）
    const TRANSFORM_RULES = {
      none: "直接填入完整值",
      date_split_ymd: "日期拆分：把 YYYY-MM / YYYY-MM-DD 拆成年、月、日分别填入关联控件",
      date_year: "只取年份部分（YYYY）",
      date_month: "只取月份数字（如 6，不要加'月'字）",
      date_day: "只取日数字（如 17）",
      phone_split: "手机号拆分：区号（+86）与号码分开填入",
    };

    const KINDS = [
      "text",
      "textarea",
      "email",
      "tel",
      "url",
      "number",
      "date",
      "select",
      "radio_group",
      "checkbox",
      "checkbox_group",
      "contenteditable",
      "unknown",
    ];

    function normalizeLabelText(text) {
      let out = String(text || "").replace(/\s+/g, " ");
      // 循环剥离：星号/冒号可能交替出现（如 "姓名 *："）
      let previous = "";
      while (out !== previous) {
        previous = out;
        out = out.replace(/\s*[*＊]\s*$/, "").replace(/\s*[：:]\s*$/, "").trimEnd();
      }
      return out.trim();
    }

    function normalizeForSignature(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()（）[\]【】{}<>，。,.、;；:：'’‘"“”!！?？*＊]/g, "")
        .slice(0, 64);
    }

    // 把 name/id/data-* 属性拆成语义 token（camelCase / kebab / snake / 中英混合），
    // 供模型获得"属性名暗示"，如 data-automation-id="legalNameSection_firstName" → [legal,name,section,first,name]
    function extractAttrTokens(value) {
      return String(value || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]+/g, " ")
        .replace(/\d+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length >= 2 && token.length <= 20)
        .slice(0, 12);
    }

    // ----------------------------------------------------------------------
    // RawFieldInfo → Descriptor
    // raw: { tag, inputType, name, id, ariaLabel, placeholder, labelText,
    //        nearbyText, sectionTexts[], options[{value,text}], kind, required,
    //        readOnly, frameIndex, attrSemantic }
    // ----------------------------------------------------------------------
    function inferKind(raw) {
      if (raw.kind) return raw.kind;
      const tag = String(raw.tag || "").toLowerCase();
      const type = String(raw.inputType || "").toLowerCase();

      if (tag === "textarea") return "textarea";
      if (tag === "select") return "select";
      if (raw.contentEditable) return "contenteditable";
      if (tag === "input") {
        if (type === "radio") return "radio_group";
        if (type === "checkbox") return "checkbox";
        if (["email", "tel", "url", "number", "date"].includes(type)) return type;
        if (type === "text" || type === "search" || type === "") return "text";
        if (["datetime-local", "month", "time", "week"].includes(type)) return "date";
        return "text";
      }
      return "unknown";
    }

    function optionSignature(raw) {
      const options = Array.isArray(raw.options) ? raw.options : [];
      if (!options.length) return "";
      return options
        .slice(0, 12)
        .map((option) => normalizeForSignature(option.text ?? option.value ?? ""))
        .filter(Boolean)
        .join("|");
    }

    function baseFingerprint(raw, kind) {
      const parts = [
        kind,
        normalizeForSignature(raw.labelText || raw.ariaLabel || ""),
        normalizeForSignature(raw.placeholder || ""),
        normalizeForSignature(raw.name || ""),
        optionSignature(raw),
      ];
      return parts.filter((part, index) => index === 0 || part).join("#");
    }

    // 生成描述符列表：为相同 baseFingerprint 的字段追加出现序号，保证 id 唯一且稳定
    function buildFieldDescriptors(rawFields, idPrefix) {
      const prefix = String(idPrefix || "f");
      const list = Array.isArray(rawFields) ? rawFields : [];
      const seen = new Map();
      const descriptors = [];

      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const kind = inferKind(raw);
        const base = baseFingerprint(raw, kind);
        const occurrence = seen.get(base) || 0;
        seen.set(base, occurrence + 1);

        const fingerprint = occurrence === 0 ? base : `${base}#${occurrence}`;
        // 短序号 id：模型必须原样复制它，长 id 容易被缩写；前缀用于区分 frame
        const pageFieldId = `${prefix}${descriptors.length}`;

        descriptors.push({
          pageFieldId,
          fingerprint,
          kind,
          labelText: normalizeLabelText(raw.labelText || ""),
          ariaLabel: normalizeLabelText(raw.ariaLabel || ""),
          placeholder: String(raw.placeholder || "").trim(),
          name: String(raw.name || ""),
          htmlId: String(raw.id || ""),
          attrTokens: extractAttrTokens(
            [raw.name, raw.id, raw.attrSemantic].filter(Boolean).join("_")
          ),
          nearbyText: String(raw.nearbyText || "").slice(0, 120),
          sectionTexts: (Array.isArray(raw.sectionTexts) ? raw.sectionTexts : [])
            .map((item) => String(item || "").slice(0, 60))
            .filter(Boolean)
            .slice(0, 4),
          options: (Array.isArray(raw.options) ? raw.options : []).slice(0, 40),
          required: Boolean(raw.required),
          readOnly: Boolean(raw.readOnly),
          maxLength: Number(raw.lengthLimit) > 0 ? Number(raw.lengthLimit) : 0,
          rowKey: String(raw.__rowKey || ""),
          blockIndex: Number(raw.blockIndex) || 1,
          frameIndex: Number.isInteger(raw.frameIndex) ? raw.frameIndex : 0,
        });
      }

      annotateSameLabelGroups(descriptors);
      return descriptors;
    }

    // 同名 label 组后处理：
    // 1) order/sameLabelCount —— 模型据此把"第几张卡/第几个同名框"对应到简历槽位；
    // 2) 拆分日期角色后缀 —— Moka 起止时间是 4 个同 label 下拉（起年/起月/止年/止月），
    //    曾因无角色信号被两两映射到 startDate/endDate 且不带 transform，完整日期写进
    //    年下拉变成垃圾值。角色判定优先用 options（年份列表→年、1-12→月），
    //    options 不可用时按 DOM 顺序模式（2 个=年年，4 个=年月年月）。
    function annotateSameLabelGroups(descriptors) {
      const groups = new Map();
      for (const descriptor of descriptors) {
        const key = descriptor.labelText || descriptor.ariaLabel;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(descriptor);
      }

      const YEAR_RE = /^(19|20|21)\d{2}$/;
      const MONTH_RE = /^([1-9]|1[0-2])$/;

      for (const [key, members] of groups) {
        if (members.length < 2) continue;

        members.forEach((descriptor, index) => {
          descriptor.sameLabelCount = members.length;
          descriptor.order = index + 1;
        });

        // 保守激活：只认 label 自带时间语义的组。曾用 section/nearby 文本判断，
        // "公司名称"因上下文含"起止时间"被误标（开始·年）——真实页面踩坑
        const inputLike = members.every((d) => d.kind === "text" || d.kind === "select");
        const timeish = /(起止|开始|结束|时间|日期|就读|期间)/.test(key);
        if (!inputLike || !timeish) continue;

        // 分卡分组优先级：DOM 行键（scanDocument 用相邻公共祖先深度跌落计算，
        // 最可靠）→ 区块标题 → placeholder 年/月交替切块（无法区分 4 框卡与 2+2 卡，
        // 仅作兜底）。三种路径都产出"组的数组"。
        const rowKeys = members.map((d) => d.rowKey || "");
        const withRow = rowKeys.filter(Boolean).length;
        let subgroups;
        if (withRow === members.length) {
          const byRow = new Map();
          members.forEach((descriptor) => {
            if (!byRow.has(descriptor.rowKey)) byRow.set(descriptor.rowKey, []);
            byRow.get(descriptor.rowKey).push(descriptor);
          });
          const rowGroups = Array.from(byRow.values());
          subgroups = rowGroups.every((g) => g.length === 2 || g.length === 4) ? rowGroups : null;
        }
        if (!subgroups) {
          const phChunks = [];
          let phCurrent = [];
          for (const descriptor of members) {
            const ph = String(descriptor.placeholder || "").trim();
            const prevPh = phCurrent.length ? String(phCurrent[phCurrent.length - 1].placeholder || "").trim() : "";
            if (phCurrent.length && ph === "年" && prevPh === "月") {
              phChunks.push(phCurrent);
              phCurrent = [];
            }
            phCurrent.push(descriptor);
          }
          if (phCurrent.length) phChunks.push(phCurrent);
          const chunksOk =
            phChunks.length > 0 && phChunks.every((g) => g.length === 2 || g.length === 4);

          if (chunksOk) {
            subgroups = phChunks;
          } else {
            const byBlock = new Map();
            for (const descriptor of members) {
              const sectionList = descriptor.sectionTexts || [];
              const blockTitle = sectionList[sectionList.length - 1] || "";
              if (!byBlock.has(blockTitle)) byBlock.set(blockTitle, []);
              byBlock.get(blockTitle).push(descriptor);
            }
            subgroups = Array.from(byBlock.values());
          }
        }

        for (const group of subgroups) {
          if (group.length !== 2 && group.length !== 4) continue;

          const roleOf = (descriptor) => {
            // placeholder 年/月是最直接的判别信号（真实 Moka 页起止/获奖时间
            // 分体框 placeholder 就是"年"/"月"，且菜单未渲染时 options 为空）
            const ph = String(descriptor.placeholder || "").trim();
            if (ph === "年") return "year";
            if (ph === "月") return "month";
            const opts = (descriptor.options || [])
              .map((o) => String(o.text ?? o.value ?? "").trim())
              .filter(Boolean);
            if (opts.length >= 3) {
              const yearCount = opts.filter((t) => YEAR_RE.test(t)).length;
              const monthCount = opts.filter((t) => MONTH_RE.test(t)).length;
              if (yearCount >= opts.length * 0.8) return "year";
              if (monthCount === opts.length) return "month";
            }
            return "";
          };

          const roles = group.map(roleOf);
          const knownCount = roles.filter(Boolean).length;
          let resolved;
          if (knownCount === group.length) {
            resolved = roles; // options 全部可判
          } else if (!knownCount) {
            // options 不可用：按 DOM 顺序模式（2 个=年年，4 个=年月年月）
            resolved = { 2: ["year", "year"], 4: ["year", "month", "year", "month"] }[group.length];
          }
          if (!resolved || resolved.some((r) => !r)) continue;

          const yearTotal = resolved.filter((r) => r === "year").length;
          const monthTotal = resolved.filter((r) => r === "month").length;
          // 年+月各一个 = 单日期字段的分体（获奖时间等），后缀用（年）（月）
          const singlePair = yearTotal === 1 && monthTotal === 1;

          let yearSeq = 0;
          let monthSeq = 0;
          for (let i = 0; i < group.length; i += 1) {
            const role = resolved[i];
            let tag = "";
            if (role === "year") {
              yearSeq += 1;
              if (yearSeq > 2) continue;
              tag = singlePair ? "年" : yearSeq === 1 ? "开始·年" : "结束·年";
            } else {
              monthSeq += 1;
              if (monthSeq > 2) continue;
              tag = singlePair ? "月" : monthSeq === 1 ? "开始·月" : "结束·月";
            }
            group[i].labelText = group[i].labelText + "（" + tag + "）";
          }
        }
      }
    }

    // ----------------------------------------------------------------------
    // 页面结构签名：字段指纹序列的哈希。字段集合变化 → 签名变化 → 缓存失效。
    // ----------------------------------------------------------------------
    function fnv1aHash(text) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = (hash * 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    }

    function computeStructureSignature(descriptors) {
      const list = Array.isArray(descriptors) ? descriptors : [];
      const material = list
        .map((descriptor) => descriptor.fingerprint)
        .join("\n");
      return `v1_${fnv1aHash(material)}_${list.length}`;
    }

    // ----------------------------------------------------------------------
    // 映射 payload 构造
    // ----------------------------------------------------------------------
    function summarizeOption(option) {
      const text = String(option?.text ?? option?.value ?? "").trim();
      const value = String(option?.value ?? "").trim();
      if (!text && !value) return null;
      return value && value !== text ? `${text}(${value})` : text || value;
    }

    function descriptorForPrompt(descriptor) {
      const out = {
        id: descriptor.pageFieldId,
        kind: descriptor.kind,
        label: descriptor.labelText || descriptor.ariaLabel || "",
        required: descriptor.required || undefined,
      };

      if (descriptor.placeholder) out.placeholder = descriptor.placeholder;
      if (descriptor.maxLength > 0) out.maxLength = descriptor.maxLength;
      if (descriptor.attrTokens.length) out.attrHints = descriptor.attrTokens;
      if (descriptor.sectionTexts.length) out.section = descriptor.sectionTexts;
      if (descriptor.nearbyText) out.nearby = descriptor.nearbyText;

      // options 对所有带选项的字段下发（曾只对 select 类下发，Moka 分体日期下拉是
      // input 载体被标成 text，模型因此看不到"选项是年份还是月份"）
      const optionSummaries = (descriptor.options || []).map(summarizeOption).filter(Boolean);
      if (optionSummaries.length) out.options = optionSummaries;

      // 卡片序号 + 同名序号：多卡同构区块 / 同名 label 字段的槽位对应信号。
      // card 取最近的上方区块标题——词汇表扫描的 sectionTexts[0] 就是它
      // （旧祖先链实现里区块标题在最远端，取 [0] 是词汇表扫描后的正确端）
      const sectionList = descriptor.sectionTexts || [];
      const blockTitle = sectionList[0] || "";
      if (blockTitle) {
        out.card = blockTitle + " #" + (descriptor.blockIndex || 1);
      }
      if ((descriptor.sameLabelCount || 1) > 1) {
        out.order = descriptor.order;
      }

      return out;
    }

    // catalogEntries: OneCVSchema.getCatalogWithValues(profile) 的输出
    function buildResumeDirectory(catalogEntries) {
      const list = Array.isArray(catalogEntries) ? catalogEntries : [];
      return list
        .filter((entry) => entry.hasValue)
        .map((entry) => ({
          path: entry.path,
          label: entry.label,
          section: entry.sectionLabel,
          preview: String(entry.valuePreview || "").slice(0, 100),
          options: Array.isArray(entry.options) && entry.options.length
            ? entry.options.filter(Boolean)
            : undefined,
        }));
    }

    function buildMappingPayload(descriptors, catalogEntries, pageMeta) {
      // readOnly 控件保留：自定义下拉/日历常以 readonly input 为载体，由填充执行器处理
      const fields = (Array.isArray(descriptors) ? descriptors : [])
        .filter((descriptor) => descriptor.kind !== "unknown")
        .map(descriptorForPrompt);

      return {
        page: {
          url: String(pageMeta?.url || "").slice(0, 200),
          title: String(pageMeta?.title || "").slice(0, 120),
        },
        fields,
        resume: buildResumeDirectory(catalogEntries),
        transformRules: TRANSFORM_RULES,
      };
    }

    return {
      TRANSFORM_RULES,
      KINDS,
      normalizeLabelText,
      normalizeForSignature,
      extractAttrTokens,
      inferKind,
      optionSignature,
      baseFingerprint,
      buildFieldDescriptors,
      fnv1aHash,
      computeStructureSignature,
      descriptorForPrompt,
      buildResumeDirectory,
      buildMappingPayload,
    };
  }
);
