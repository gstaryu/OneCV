# OneCV · AI 简历填表助手

> Chrome / Edge（Manifest V3）浏览器扩展：网申季自动填写简历表单。不写死任何网站的 DOM 规则——字段由 AI 在运行时根据"特征包"（label / placeholder / 属性语义 token / 区块语义 / 选项列表 / 字数限制）动态映射到标准简历 schema，所有 DOM 写入由本地确定性代码完成。

---

## ✨ 核心特性

- **AI 只做映射，本地只做执行**：模型唯一职责是判断"页面字段 → 简历路径"；写值、日期/手机号拆分、选项匹配、事件触发全部本地确定性完成，可测试、可回滚。
- **三模填充**：整页覆盖 / 增量填入（跳过已填）/ 选区填充（页面拖拽框选）；低置信度字段橙色高亮待人工复查。
- **选项别名匹配**：28 组中英别名（本科↔大学本科、是↔yes…）+ 打分制匹配（精确 100 / 包含 75 / 及格 60）。
- **自定义下拉同步**：对以 input 为载体的自定义下拉（Moka sd-Select 类），设值后自动"开面板 → 点击精确匹配选项 → 收起"，同步组件内部状态、不残留展开面板。
- **只读日期状态机**：日历接管控件 → 点击开面板 → 几何定位翻年 → 点选月/日 → 回读校验，分步打点进诊断日志；不依赖任何组件库 class。
- **描述多版本字数自适应**：站点字数限制（maxlength / "限X字"提示）扫描时抓取；填充时本地自动选"不超限的最长版本"，无适配版本高亮提醒。
- **用户自定义字段**：任意列表区可新增字段（文本行/文本段/日期，名称自定义，如"描述（200字版本）"），动态并入 schema，AI 结合站点字数限制自动选版。
- **奖项/竞赛/论文条目化**：结构化字段（名称/级别/时间/详情；论文含期刊、级别 SCI一区~四区/SSCI/EI/CSSCI/北大核心/CSCD、作者次序）。
- **编辑页体验**：左侧导航（区块名 + 填写统计 + 已填高亮 + 点击跳转 + 折叠展开）、语言考试联动（英语→CET/TOEFL/IELTS…，日语→JLPT，韩语→TOPIK…）、下拉自定义值、保存即时刷新。
- **深扫描**：扫描时有限点击"展开/更多"类按钮发现折叠字段（排除提交/添加类，按简历已填内容过滤）。
- **同源 iframe**：top 递归扫描同源 iframe；映射缓存按"结构签名 → 字段特征指纹"两级复用（增量合并 + LRU 淘汰）。
- **隐私最小化**：API Key 与简历数据只存本地 chrome.storage；无任何后端；发送内容（字段 label/选项/简历目录）在 UI 明示。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 平台 | Chrome / Edge Manifest V3（Side Panel UI） |
| 语言 | 原生 JavaScript（ES2020+，无构建、无依赖） |
| 模块 | UMD 模式 shared 模块——浏览器全局加载与 Node 单测同一份源码 |
| 模型接入 | provider 抽象：OpenAI 兼容（DeepSeek / GLM / Doubao / 方舟）/ Anthropic，视觉消息构造 |
| PDF 解析 | pdf.js 3.11（本地打包，无远程脚本） |
| 测试 | Node 原生 test runner（53 用例，纯逻辑模块 + manifest 清单守护） |
| E2E | 扩展内驱动页 + CDP（tools/），五个高仿真表单页 + 真实网站回归 |

---

## 📁 项目结构

```
OneCV/
├── manifest.json           # MV3；content_scripts all_frames 注入
├── background.js           # 模型调用代理（唯一持 Key）+ 日志汇聚（单一消息路由）
├── content.js              # 编排层：字段注册表 / 扫描与填充执行循环 / 选区 / 消息协议
├── shared/                 # UMD 纯逻辑模块（浏览器全局 + Node 同源码）
│   ├── one-alias-groups.js     # 中英选项别名词典（schema 与 option-match 共用）
│   ├── one-schema.js           # 简历 schema（14 区块 + 自定义字段运行时扩展 + 导入合并）
│   ├── one-scanner-dom.js      # DOM 扫描层（多轨 label 提取 / RawFieldInfo 构造）
│   ├── one-scanner-core.js     # 特征包 / 稳定字段 id / 页面结构签名 / 映射 payload
│   ├── one-fill-dom.js         # DOM 写值原语（native setter / 自定义下拉 开-点-收）
│   ├── one-fill-runtime.js     # 值规整 / transform / 字数限制 / 多值拆分
│   ├── one-deep-scan.js        # 深扫描（展开按钮发现折叠字段，deps 注入可测）
│   ├── one-date-picker.js      # 只读日期控件填充状态机
│   ├── one-map-prompt.js       # 映射 prompt（纯 JSON + 置信度 + transform）
│   ├── one-map-parse.js        # 模型输出容错解析（含截断修复）+ 路径白名单校验
│   ├── one-option-match.js     # 选项别名匹配（打分制）
│   ├── one-import-prompt.js    # 简历导入 prompt（模板瘦身 + 选项规则去重）
│   ├── one-provider.js         # 模型接入抽象（OpenAI 兼容 / Anthropic，HTTPS 校验）
│   ├── one-diagnostics.js      # 结构化日志
│   └── one-storage.js          # chrome.storage 封装
├── sidepanel/              # 侧边栏（扫描-映射-填充流水线 / 简历 / 设置 / 日志）
├── resume-editor/          # 简历编辑页（schema 驱动 + PDF 导入 + 自定义字段 + 导航）
├── tests/                  # node --test（75 用例）
├── tools/                  # 开发辅助：本地静态服务 + CDP 驱动
├── test/                   # E2E 驱动页 + 简历 fixture（开发用）
├── libs/                   # pdf.js 本地打包
└── docs/site-notes.md      # 网申系统表单实现调研笔记
```

---

## 🚀 快速开始

### 安装

1. 打开 `edge://extensions/`（或 `chrome://extensions/`）
2. 开启「开发人员模式」→「加载解压缩的扩展」→ 选择本项目根目录
3. 点击工具栏图标打开侧边栏

> Chrome 137+ Stable 已移除 `--load-extension` 启动参数支持，开发调试推荐 Edge。

### 配置模型

侧边栏 →「设置」：

| 项 | 说明 |
|---|---|
| API 类型 | OpenAI 兼容（DeepSeek / GLM / Doubao / 方舟…）或 Anthropic |
| Base URL | 如 `https://ark.cn-beijing.volces.com/api/v3`（完整 endpoint 亦可，自动归一化） |
| 模型名 | 文本模型；视觉模型可配，留空复用文本模型（视觉兜底 UI 暂隐藏，见下文） |
| API Key | 只存本地 chrome.storage.local，经 background 直连厂商，无后端 |

已实测：`doubao-seed-2.0-lite` / `deepseek-v4-flash` / `glm-5.3-flash`（方舟端点；doubao 支持视觉输入）。

### 使用

1. 「简历」→ 编辑页填写，或粘贴原文 / 上传有文字层的 PDF 让 AI 抽取
2. 打开网申页面 →「填表」→「扫描表单」→「AI 映射并填充」
3. 低置信度字段页面上橙色高亮，人工复查；「保守模式」可跳过不填

### 测试

```bash
npm test                    # 纯逻辑单测
node tools/serve.js         # 本地 8123：五个高仿真表单页（含 test-form-sd 回归页 __runSdTests）
```

---

## 🤖 填充工作流

```
扫描（content，含深扫描 + 同源 iframe 递归）
  └─> 特征包 {label, placeholder, attrHints, options, maxLength, section, nearby}
        └─> 缓存查询（结构签名 → 特征指纹）──命中──┐
              └─未命中→ AI 映射（background 代理）──┘
                    └─> 解析校验（路径白名单 + transform 白名单）
                          └─> 本地填充执行（按控件类型分派）
                                ├─ 原生 select/radio/checkbox：别名打分匹配
                                ├─ 自定义下拉：设值 → 开面板 → 点匹配选项 → 收起
                                ├─ 只读日历控件：日期面板状态机（翻年/点月/点日/回读）
                                └─ 文本/文本段：native setter + input/change 事件
                                      └─ 字数限制 → 自动选描述变体
结果渲染 + 低置信度/超限高亮
```

- **AI 的边界**：只产出 `pageFieldId → resumePath` 的映射（含置信度与 transform），不产出任何最终填入值。
- **本地护栏**：路径白名单校验防幻觉；出生日期绝不填入起止时间；单字段 8 秒超时不拖垮整轮。

---

## 📚 文档索引

| 文档 | 内容 |
|---|---|
| [docs/site-notes.md](docs/site-notes.md) | 北森/Moka/Workday 等网申系统表单实现调研笔记 |

---

## ⚠️ 已知限制

- 跨域 iframe 内字段无法扫描（同源策略）；同源 iframe 已支持
- 纯 div 无输入框的自定义组件不支持（填充需要可写入的控件载体）
- 多层 Shadow DOM 内的字段暂不扫描（调研笔记 §5.3 已列为方向，未实现）
- Moka sd-Select 类过滤型下拉（显示层 span + 过滤 input 分离、菜单只认 pointer 事件、Escape/外部点击校验 `isTrusted`）：已通过"pointer 开面板 → 过滤/清词点选项 → toggle 收起"的合成事件流程支持（`test-form-sd.html` 为高仿真回归页，`__runSdTests()` 应 8/8 全过）；仅当组件连**选项点击**都校验 `isTrusted` 时才需要强力填充
- 个别组件库若对收起动作校验 `isTrusted` 且不接受 pointer toggle，合成事件无法自动收起其下拉/日历面板——填充结果区会提示"面板未自动收起，请手动点击页面空白处"
- 经历类段落条数多于页面已有段落数时不自动点「添加」——结果区会提示手动添加后用「增量填入」补齐
- 扫描版 PDF（无文字层）不支持导入；不自动提交表单、不处理文件上传、不做验证码

## 💪 强力填充与视觉兜底（内置，UI 暂隐藏）

两个功能代码完整保留，仅设置页暂不展示（`sidepanel.html` 各有一处注释，删掉对应
`<div hidden>` 即可重新显示）。sd-Select 类过滤型下拉的年份/月份选择普通模式已可
完整提交（见"已知限制"），两者默认都用不上：

- **强力填充**：`chrome.debugger` 派发**真实鼠标/滚轮/键盘事件**，自动选中合成事件
  搞不定的下拉（如连选项点击都校验 `isTrusted` 的组件）。仅补常规填充未同步的年框，
  默认关闭；填充期间页面顶部会短暂出现"正在调试"横幅，填完自动断开。
- **视觉兜底**：低置信度字段截图后交视觉模型重映射再补填（与 DOM 写入问题正交，
  针对映射不置信的场景），默认关闭。视觉模型名留空则复用文本模型配置。

`debugger` 权限随扩展声明（Chromium 不允许它作为可选权限）。

## 📄 许可

本项目基于 [GPL-3.0](LICENSE) 协议发布。项目在字段扫描、选项匹配、深扫描、
日期状态机等模块上衍生自
[1lck/AI-Resume-Form-Filling-Assistant](https://github.com/1lck/AI-Resume-Form-Filling-Assistant)（GPL-3.0），
在此致谢原项目作者；衍生部分的源码同样以 GPL-3.0 开放。

---

## 🔒 隐私与安全

| 项 | 说明 |
|---|---|
| API Key | 只存 chrome.storage.local，仅 background 持有并发往模型厂商 |
| 发送给模型的内容 | 字段 label/选项/附近文本、页面 URL 与标题、已填简历字段目录与值预览；视觉模式下含页面截图 |
| 数据归属 | 简历数据、映射缓存、日志全部本地存储；项目无任何后端服务 |
| 明确不做 | 自动提交表单、文件上传、验证码/滑块绕过 |
