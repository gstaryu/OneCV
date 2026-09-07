# OneCV · AI 简历填表助手

> Chrome / Edge（Manifest V3）浏览器扩展：网申季自动填写简历表单。字段由 AI 在运行时根据页面特征（label / placeholder / 属性语义 / 选项列表 / 字数限制）动态映射到标准简历 schema，所有 DOM 写入由本地确定性代码完成。

![编辑](/images/简历编辑.png)

![效果](/images/填充效果.png)

<p align="center">
  <img src="/images/AI填表.png" alt="AI 填表" width="49%" />
  <img src="/images/设置.png" alt="设置" width="47%" />
</p>

---

## ✨ 核心特性

- **AI 只做映射，本地做执行**：模型唯一职责是判断"页面字段 → 简历路径"；写值、日期/手机号拆分、选项匹配、事件触发全部本地确定性完成。
- **三模填充**：整页覆盖 / 增量填入（跳过已填）/ 选区填充（页面拖拽框选），低置信度字段橙色高亮待人工复查。
- **自定义下拉同步**：对以 input 为载体的过滤型下拉（Moka sd-Select 类），设值后自动"开面板 → 点击匹配选项 → 收起"，同步组件内部状态。
- **只读日期状态机**：日历接管控件按"开面板 → 翻年 → 点月/日 → 回读校验"逐步填充，组件库无关。
- **选项别名匹配**：28 组中英别名（本科↔大学本科、是↔yes…）+ 打分制匹配（精确 100 / 包含 75 / 及格 60）。
- **字数自适应**：扫描时抓取站点字数限制（maxlength / "限X字"提示），填充时自动选"不超限的最长描述版本"。
- **深扫描与同源 iframe**：扫描时有限点击"展开/更多"按钮发现折叠字段；递归扫描同源 iframe，映射缓存按结构签名两级复用。
- **简历编辑页**：schema 驱动 + PDF 导入 + 左侧导航 + 语言考试联动（英语→CET/TOEFL/IELTS…）+ 用户自定义字段。
- **隐私最小化**：API Key 与简历数据只存本地 chrome.storage，无任何后端。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 平台 | Chrome / Edge Manifest V3（Side Panel UI） |
| 语言 | 原生 JavaScript（ES2020+，无构建、零依赖） |
| 模块 | UMD shared 模块——浏览器全局加载与 Node 单测同一份源码 |
| 模型接入 | provider 抽象：OpenAI 兼容（DeepSeek / GLM / Doubao / 方舟）/ Anthropic |
| PDF 解析 | pdf.js 3.11（本地打包） |

---

## 📁 项目结构

```
OneCV/
├── manifest.json           # MV3；content_scripts all_frames 注入
├── background.js           # 模型调用代理（唯一持 Key）+ 日志汇聚
├── content.js              # 编排层：字段注册表 / 扫描与填充执行循环 / 选区 / 消息协议
├── shared/                 # UMD 纯逻辑模块（浏览器全局 + Node 同源码）
│   ├── one-alias-groups.js     # 中英选项别名词典
│   ├── one-schema.js           # 简历 schema（14 区块 + 自定义字段运行时扩展）
│   ├── one-scanner-dom.js      # DOM 扫描层（多轨 label 提取）
│   ├── one-scanner-core.js     # 特征包 / 稳定字段 id / 映射 payload
│   ├── one-fill-dom.js         # DOM 写值原语（native setter / 自定义下拉 开-点-收）
│   ├── one-fill-runtime.js     # 值规整 / transform / 字数限制 / 多值拆分
│   ├── one-deep-scan.js        # 深扫描（展开折叠字段，deps 注入可测）
│   ├── one-date-picker.js      # 只读日期控件填充状态机
│   ├── one-map-prompt.js       # 映射 prompt（纯 JSON + 置信度 + transform）
│   ├── one-map-parse.js        # 模型输出容错解析 + 路径白名单校验
│   ├── one-option-match.js     # 选项别名匹配（打分制）
│   ├── one-import-prompt.js    # 简历导入 prompt
│   ├── one-provider.js         # 模型接入抽象（OpenAI 兼容 / Anthropic）
│   ├── one-diagnostics.js      # 结构化日志
│   └── one-storage.js          # chrome.storage 封装
├── sidepanel/              # 侧边栏（扫描-映射-填充流水线 / 简历 / 设置 / 日志）
├── resume-editor/          # 简历编辑页（schema 驱动 + PDF 导入 + 自定义字段 + 导航）
├── tests/                  # node --test（75 用例）
├── test/ + tools/          # E2E 驱动页 / 本地静态服务 / CDP 驱动（开发用）
├── libs/                   # pdf.js 本地打包
└── docs/site-notes.md      # 网申系统表单实现调研笔记
```

---

## 🚀 快速开始

### 安装

1. 打开 `edge://extensions/`（或 `chrome://extensions/`）
2. 开启「开发人员模式」→「加载解压缩的扩展」→ 选择本项目根目录
3. 点击工具栏图标打开侧边栏

### 配置模型

侧边栏 →「设置」：

| 项 | 说明 |
|---|---|
| API 类型 | OpenAI 兼容（DeepSeek / GLM / Doubao / 方舟…）或 Anthropic |
| Base URL | 如 `https://ark.cn-beijing.volces.com/api/v3`（完整 endpoint 亦可，自动归一化） |
| 模型名 | 文本模型，如 `doubao-seed-2.0-lite` / `deepseek-v4-flash` / `glm-5.3-flash` |
| API Key | 只存本地 chrome.storage.local，经 background 直连厂商 |

### 使用

1. 「简历」→ 编辑页填写，或粘贴原文 / 上传有文字层的 PDF 让 AI 抽取
2. 打开网申页面 →「填表」→「扫描表单」→「AI 映射并填充」
3. 低置信度字段页面上橙色高亮，人工复查；「保守模式」可跳过不填

## 🤖 填充工作流

```
扫描（content，含深扫描 + 同源 iframe 递归）
  └─> 特征包 {label, placeholder, attrHints, options, maxLength, section}
        └─> 缓存查询（结构签名 → 特征指纹）──命中──┐
              └─未命中→ AI 映射（background 代理）──┘
                    └─> 解析校验（路径 / transform 白名单）
                          └─> 本地填充执行（按控件类型分派）
                                ├─ 原生 select/radio/checkbox：别名打分匹配
                                ├─ 过滤型自定义下拉：设值 → 开面板 → 点匹配选项 → 收起
                                ├─ 只读日历控件：日期面板状态机（翻年/点月/点日/回读）
                                └─ 文本/文本段：native setter + input/change 事件
结果渲染 + 低置信度/超限高亮
```

- **AI 的边界**：只产出 `pageFieldId → resumePath` 的映射（含置信度与 transform）。
- **本地护栏**：路径白名单校验；出生日期绝不填入起止时间；单字段 8 秒超时不拖垮整轮。

---

## 📚 文档索引

| 文档 | 内容 |
|---|---|
| [docs/site-notes.md](docs/site-notes.md) | 北森/Moka/Workday 等网申系统表单实现调研笔记 |

---

## ⚠️ 已知限制

- 部分网站日期无法填入
- 跨域 iframe 内字段无法扫描（浏览器同源策略）
- 纯 div 无输入框的自定义组件暂不支持（填充需要可写入的控件载体）
- 多层 Shadow DOM 内的字段暂不扫描
- 经历条数多于页面已有段落时，结果区会提示手动添加后用「增量填入」补齐
- 扫描版 PDF（无文字层）暂不支持导入

---

## 🔒 隐私与边界

| 项 | 说明 |
|---|---|
| API Key | 只存 chrome.storage.local，仅 background 持有并发往模型厂商 |
| 发送给模型的内容 | 字段 label/选项/附近文本、页面 URL 与标题、简历字段目录与值预览 |
| 数据归属 | 简历数据、映射缓存、日志全部本地存储，无任何后端服务 |
| 设计边界 | 每次填充前展示映射结果供确认，填充后高亮低置信度字段供复查 |

---

## 📄 许可

本项目基于 [GPL-3.0](LICENSE) 协议发布，在字段扫描、选项匹配、深扫描、日期状态机等模块上衍生自
[1lck/AI-Resume-Form-Filling-Assistant](https://github.com/1lck/AI-Resume-Form-Filling-Assistant)（GPL-3.0），
在此致谢原项目作者；衍生部分的源码同样以 GPL-3.0 开放。
