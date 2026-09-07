# 网申/ATS 系统表单实现调研笔记

> 调研目的：为 OneCV（AI 简历自动填表 Chrome 扩展）提取"通用模式"，作为字段扫描启发式规则与 AI 映射 prompt few-shot 示例的依据。**不是**为某个网站写死适配代码。
>
> 调研日期：2026-09-06。调研方式：RivalSearchMCP 联网搜索 + GitHub 开源项目源码/README 第一手 DOM 观察。所有结论标注来源与可信度（高 = 源码/官方文档；中 = 产品页/社区帖/二手转述；低 = AI 生成内容或推测，需实机验证）。

---

## 1. 各系统一览表

| 系统 | 表单形态 | 自定义控件 | iframe | 资料来源可信度 |
|---|---|---|---|---|
| **Workday**（myworkdayjobs.com / wd1–wd103.myworkdaysite.com） | 强制多步 wizard（My Information → My Experience → Application Questions → 自我认同，5–8 屏），每家租户强制注册账号 | 高度自定义：`data-automation-id` 体系；下拉是 button 型 combobox；日期是分体月/年文本框 | 表单本体通常在顶层文档（求职站即 Workday 租户域）；部分企业把 careers 页嵌自家站 | **高**：开源 puppeteer 脚本 apply.js 全套 selector（[ubangura/Workday-Application-Automator](https://github.com/ubangura/Workday-Application-Automator)）；ProfVault 产品页佐证 |
| **Greenhouse**（boards.greenhouse.io / job-boards.greenhouse.io） | 单页表单 + 自定义筛选问题（work authorization、sponsorship 等）+ 链接字段 + EEO 自愿问卷 | 较少，以原生 input/select 为主；上传简历/cover letter | **是**：企业官网嵌入时用 iframe（grnhse 集成，指向 boards.greenhouse.io），相对企业站**跨域**；直开 job board 页则无 iframe | **高**：官方 support/developer 文档确认 iframe embed 方案；ProfVault 页佐证字段清单 |
| **Lever**（jobs.lever.co） | 单页表单，很规整 | 少，原生控件为主 | 无 iframe（表单在 posting 页内联） | **高**：开源 selenium 脚本 lever.py 用纯 `name` 属性定位（[ramos07/Python-Form-Filler-Script](https://github.com/ramos07/Python-Form-Filler-Script)） |
| **iCIMS**（*.icims.com） | 多页/多 tab 候选人档案式 | 自定义 input 组件较多；iForms 可配置任意问卷 | **是**：遗留 iframe 结构 + 多 tab（VeloApply 产品页描述） | **中**：第三方产品页 + 社区反馈，未见公开源码 |
| **Taleo**（*.taleo.net careersection） | 老牌遗留系统，多步、页面重、大量 postback | 遗留自定义组件、字段结构专有 | 普遍 iframe/careersection 嵌套（社区自动化普遍需 switch frame） | **低-中**：仅有社区二手说法，本次未找到公开 selector 源码 |
| **SmartRecruiters** | 现代单页 + 多步问卷 | **多层 Shadow DOM**，`<input>` 的 label 渲染在 shadow 外部 | 一般无 iframe | **中**：来源为一篇 AI 生成综述（引用 jobfill.ai 博客与 simplify 社区帖），方向可信、细节需验证 |
| **SuccessFactors** | 模块化 career site，多步 | 混合 | 未见公开资料 | **低**：未找到公开资料，依据为同类企业级系统通用模式 |
| **北森 iTalent/Beisen**（企业校招官网域，非统一域名） | 校招网申主力系统之一，多步 wizard，企业可自定义字段 | 自研组件库；企业租户自定义字段多 | 未见公开资料（产品"速申"宣称适配北森 iTalent，说明存在稳定 DOM 模式） | **低**：DOM 细节未找到公开资料，依据为同类系统通用模式 + 速申产品页佐证 |
| **Moka / MokaHR**（app.mokahr.com、企业自定义域 *.mokahr.com） | 单页或分节（createFormSection），支持重复经历段落 | **高**：自研 `atsx-*` 组件库（select/cascader/date-picker），React 栈 | 无 iframe（SPA 单文档）；有 WAF cookie + 隐藏 API + AES 响应（vescloud/moka-job-scraper） | **高**：开源扩展全套 selector + 中文别名表（[ZZDDD/mokahr-autofill-extension](https://github.com/ZZDDD/mokahr-autofill-extension)，5 星、持续维护） |
| **飞书招聘**（jobs.feishu.cn、企业自定义域 *.jobs.feishu.cn） | 与 Moka 同构（该开源扩展同一套代码适配两者） | 同 Moka（atsx 风格组件） | 无 | **高**：同上，manifest 同时声明 feishu.cn 域 |
| **大易（用友大易）**（招聘站常见域名 `*.hotjob.cn/wt/{公司代码}/...`） | 多步网申，企业自定义字段多 | 未确认 | 未确认 | **低**：仅域名模式（hotjob.cn/wt/dayeezp 示例）有实证，表单 DOM 无公开资料 |
| **用友 / 金蝶 / 自研企业官网 ATS** | 参差：老站服务端渲染原生 form，新站 React/Vue SPA | 混合 | 少 | **低**：未找到公开资料，依据为同类系统通用模式 |
| **牛客网**（nowcoder.com） | 自身站是 Vue SSR（`__VUE_SSR_CONTEXT__`、static.nowcoder.com/fe）；其"网申助手"插件是官方 AI 填表产品，填**企业官网**网申表单 | 站内表单未逐项确认 | 未确认 | **中**：官方产品页（quick-fill/show-introduce）证实产品定位，未公开 DOM 细节 |
| **前程无忧 / 智联 / BOSS直聘 / 实习僧** | 平台内投递走"平台简历/在线简历"模型（BOSS 为聊天流），非经典长表单 | 未确认 | 未确认 | **低**：未找到公开 DOM 资料，依据为同类平台通用模式；建议实机抓取 |

---

## 2. 字段命名习惯汇总

### 2.1 英文命名风格（真实例子，全部来自开源源码）

**Workday：`data-automation-id`，camelCase + 下划线分区**（来源：ubangura/Workday-Application-Automator/apply.js，高可信）

| data-automation-id | 含义 |
|---|---|
| `legalNameSection_firstName` / `legalNameSection_lastName` | 法定姓名 |
| `addressSection_addressLine1` / `addressSection_city` / `addressSection_countryRegion` / `addressSection_postalCode` | 地址四件套 |
| `phone-number` / `phone-device-type` | 电话号码/类型 |
| `email` / `password` / `verifyPassword` | 账号注册 |
| `jobTitle` / `company` / `location` / `description` | 工作经历行内字段 |
| `dateSectionMonth-input` / `dateSectionYear-input` | 分体月/年输入 |
| `degree` / `gradeAverage` / `gpa` / `firstYearAttended` / `lastYearAttended` / `field-of-study` / `schoolItem` | 教育经历 |
| `skillsPrompt` / `linkedinQuestion` | 技能搜索框 / LinkedIn 专属框 |
| `gender` / `hispanicOrLatino` / `ethnicityDropdown` / `veteranStatus` / `agreementCheckbox` | EEO/合规 |
| `file-upload-input-ref` | 简历上传（隐藏 file input） |
| 页面容器：`contactInformationPage` / `myExperiencePage` / `voluntaryDisclosuresPage` / `selfIdentificationPage`；按钮：`bottom-navigation-next-button` / `applyManually` / `adventureButton` | wizard 步骤与导航 |

**Moka/飞书：`data-cy` + `data-test` + id 三轨，camelCase，Input 后缀**（来源：ZZDDD/mokahr-autofill-extension/content.js，高可信）

| data-cy | 含义 |
|---|---|
| `nameInput` / `mobileInput` / `emailInput` | 姓名/手机/邮箱 |
| `experienceYearsInput` / `ageInput` / `genderInput` | 工作年限/年龄/性别 |
| `nationalityInput` / `currentCityInput` / `hometownCityInput` | 国籍/当前城市/家乡 |
| `identification_type` / `identification_numberInput` / `idNumberInput` / `identityTypeInput` | 证件类型/号码（拼写多变！） |
| `preferredCityInput` / `expectedLocationInput` / `expectCityInput` | 期望地点（同义多写法） |
| `birthdayInput` / `maritalStatusInput` / `currentHomeAddressInput` | 生日/婚姻状况/住址 |
| `intentionCityInput` / `field-referral-code` | 意向城市/内推码 |
| 重复行：`{prefix}[{index}].{field}` 如 `workExperiences[0].companyInput` | 经历段落第 N 行 |
| 段落：`createFormSection__*`，行：`resumeEditForm-*`，起止：`periodInput` + `InputBegin`/`InputEnd` | 分节与起止时间 |

**Lever：朴素 `name` 属性**（来源：ramos07 lever.py，高可信）：`name`、`email`、`phone`、`org`（当前公司）、`resume`（file）、`urls[LinkedIn]`、`urls[Twitter]`、`urls[GitHub]`、`urls[Portfolio]`、`urls[Other]`。

### 2.2 中文 label 风格（真实例子，来自 Moka 扩展别名表 core.js，高可信）

- 基本信息：`姓名`、`手机号码`/`手机号`、`邮箱`、`工作年限`、`年龄`、`性别`、`国籍（地区）`、`所在地点`/`当前城市`、`家乡`/`籍贯`、`证件类型`、`证件号码`、`期望工作地点`/`期望地点`、`出生日期`、`婚姻状况`、`家庭住址`、`内推码`、`意向城市`/`意向地点`
- 教育经历：`学校名称`、`学历`、`学位`、`专业`、`学历类型`、`成绩排名`
- 经历：`公司名称`、`职位名称`/`岗位`、`担任角色`、`项目名称`、`描述`/`项目描述`/`工作描述`/`实习描述`、`链接`（写作 `url / id`）
- 其他：`熟练程度`/`精通程度`/`掌握程度`（同义三写法）、`自我评价`、`社交平台`
- 段落标题：`教育经历`/`教育背景`、`工作经历`、`实习经历`、`项目经历`/`项目经验`、`作品`、`获奖`/`荣誉`、`语言能力`、`社交账号`
- 特殊开关：`没有工作经历`/`无工作经历`（复选框，勾选即清空段落）；`至今`/`现在`（时间范围按钮）

**中文校招特有字段**：`政治面貌`、`学制`、`培养方式`、`期望薪资`、`高考省份` 等为校招网申常见 label 写法，但**本次未在公开源码中找到完整字段与选项清单**（见第 7 节缺口）。它们的共同特征：label 短（2–4 字）、常带全角冒号或 `*` 必填标记、值域为有限枚举（下拉）。

**风格小结**：
- 英文命名三类主流：camelCase（Workday/Moka）、snake_case（老系统）、平铺短名（Lever）。
- 同义变体极多（`identification_number` vs `idNumber`；`preferredCity` vs `expectCity`），**精确匹配必败，必须做归一化 + 包含匹配**。
- Moka 的 data-cy 值常带 `Input` 后缀，且 `field-*` 前缀版本与裸名版本并存。

---

## 3. 自定义控件模式（DOM 特征）

### 3.1 自定义下拉（div 模拟 select）

- **Workday**：`<button data-automation-id="degree">` 这类 button 即下拉触发器；点击后弹出列表，**用键盘输入过滤再按 Enter 选中**是社区通行做法（apply.js：click → type → Enter）。没有原生 `<select>`。
- **Moka/飞书（atsx）**：容器带 `role="combobox"` + `aria-controls` 指向 listbox；选项为 `[role=option]` 或 `.atsx-select-dropdown-menu-item`；搜索框类下拉内嵌 `input.atsx-select-search__field`；下拉浮层可能**不在触发器子树内**（挂在 body），需用 `aria-controls` / `data-cy="{name}Dropdown"` / "当前可见的 option 归属"三种回退定位（content.js 的 selectOptionScope 函数即此策略）。
- **级联选择（城市等）**：Moka 用 `.atsx-cascader-menu` + `.atsx-cascader-menu-item`，多列面板逐级点选。

### 3.2 日期控件

- **Workday**：分体式——`formField-startDate` 容器内两个独立文本框 `dateSectionMonth-input`、`dateSectionYear-input`（月/年分开，直接键盘输入）；完整日期另有日历图标 `dateIcon` + 面板 `datePickerSelectedToday`。
- **Moka/飞书**：年月面板选择器 `.atsx-date-picker-period-month-panel`，**年份、月份两列**（`.atsx-date-picker-period-month-panel-list`，item 带 data-cy）；起止时间是 `periodInput` 包裹的两个 `*InputBegin` / `*InputEnd` 子控件；"至今"是一个按钮/label（文本匹配 `至今|现在|present`）。
- **通用启发**：国内年-月（YYYY-MM）多用于经历起止；出生日期多为完整日期或分开的年/月/日下拉。**永远不要假设只有一个 input**。

### 3.3 重复段落（多条经历）

- Moka：点击"添加"按钮（`.formOperate-addBtn` / `.addMore` / 文本匹配 `添加|add`）后 React 异步插入新行，新行 data-cy 带 `[index]` 递增；扩展实现里专门做了"等行结构连续两次采样稳定"再填（waitForRowStructureStable）。
- Workday：`workExperienceSection` 内 `button[data-automation-id*="Add"]`，行容器 `workExperience-{n}`。

### 3.4 其他

- 简历上传：Moka/Workday 都用隐藏 `<input type="file">`（Workday 为 `file-upload-input-ref`），扩展可对隐藏 input 直接 `uploadFile`/派发 DataTransfer。
- "无经历"开关：Moka 的 `没有工作经历` 复选框会联动清空段落，自动填写前需检测。

---

## 4. label 关联模式与"无 label"场景的定位线索

| 模式 | 出现系统 | 定位策略 |
|---|---|---|
| `<label for>` 正向关联 | Moka（部分字段）、Greenhouse/Lever | 标准做法：`label[for=id]` → 控件 |
| label 与控件同容器（`for` 缺失） | Moka：`.atsx-form-item` 内含 label + 控件；Workday：`div[data-automation-id="formField-*"]` 容器内 label 文本 + 控件 | 向上找最近的 form-item 容器，取容器内 label/标题文本 |
| 专有字段名 class | Moka 企业自定义简历表单用 `.customResumeForm-fieldName` 渲染 label | 把这类 class 当 label 处理 |
| label 在 Shadow DOM 外 | SmartRecruiters | 需跨 shadow 边界按视觉相邻关系反查 |
| 仅 placeholder / aria-label | 各系统均见 | 作为兜底信号；placeholder 常是示例值（"如：张三"），AI 映射时要区分 |
| 无任何语义（纯视觉排版） | 老自研站 | 取控件前方兄弟节点的文本，或表格布局中同行前一列文本 |

Moka 扩展的取 label 优先级（content.js `labelOf`，可直接借鉴）：`label[for]` → form-item 容器内 `label` → `.customResumeForm-fieldName` → 容器文本。

---

## 5. 对 OneCV 字段扫描器的设计建议

1. **URL/域名指纹先行判平台**：`myworkdayjobs.com`、`wd*.myworkdaysite.com`、`boards.greenhouse.io`/`job-boards.greenhouse.io`、`jobs.lever.co`、`*.icims.com`、`app.mokahr.com`、`*.mokahr.com`、`*.jobs.feishu.cn`、`hotjob.cn/wt/`。命中则启用该平台的 selector 加速路径，未命中走通用扫描。
2. **语义属性三轨探测**：对每个控件依次看 `data-cy` / `data-test` / `data-automation-id` / `id` / `name`，camelCase/snake_case 拆词后与标准字段词典匹配（如 `identification_numberInput` → 拆出 identification + number → 证件号码）。
3. **递归穿透 Shadow DOM**：SmartRecruiters 等系统用多层 shadow root，扫描器必须沿 `element.shadowRoot` 递归收集 input/textarea/select/[role=combobox]。
4. **label 归一化匹配**：去除空白、全半角冒号、`*`/必填星标、括号内容后做 contains 匹配；准备中英双语别名词典（可直接参考 Moka core.js 的 FIELD_ALIASES 作为种子）。同义词族要成组：证件号码≈身份证号≈idNumber；籍贯≈家乡；意向城市≈期望地点。
5. **iframe 全 frames 注入**：Greenhouse embed、iCIMS、Taleo 都可能在跨域 iframe 里。manifest host_permissions 覆盖上述平台域，`all_frames: true` 注入；popup 与各 frame 的 content script 通信需按 frame 索引聚合结果。
6. **动态渲染等待**：SPA（Moka/Workday/牛客）表单异步渲染。用 MutationObserver 等"表单就绪信号"（如 Moka 的 `.atsx-form-item input` 出现），找到目标后 **disconnect**，避免 Simplify 式的性能灾难（MutationObserver 全量常驻 + 轮询是被用户痛骂的坑）。
7. **React 安全写值**：一律用原生 value setter + 派发 `input`/`change`（冒泡），必要时 blur；只改 `.value` 会被 React 状态回滚（Moka 扩展专门修过"React 延迟覆盖"bug）。
8. **下拉/级联统一走 combobox 协议**：识别 `role=combobox` + `aria-controls`/aria-expanded；选项浮层在 body 下时用 aria-controls 或"可见 option 的共同祖先"回退；匹配先精确后包含（normalize 后），命中即 click，不要模拟 Enter 提交猜测值。
9. **日期字段按"分体"设计**：输出结构给 AI 时同时保留 `YYYY-MM` 规范值与"月/年分体""年月面板""起止 periodInput + 至今按钮"三种落点策略；扫描时把同一 `formField-*`/`periodInput` 容器内的多个 date input 归组为一个逻辑字段。
10. **重复段落按 data-cy 索引模式识别**：`{prefix}[{i}].{field}` 正则可直接判段落数与行内字段；无此模式时按"添加按钮 + 结构克隆"识别。填行前等 DOM 稳定（两次采样一致），防止填进被 React 重建丢弃的节点。

---

## 6. 对 AI 映射 prompt 的 few-shot 示例建议

建议给模型 4–5 个覆盖不同 DOM 风格的例子，每个都展示"控件标识 + label 线索 → 输出标准字段 + 置信度"。示例骨架（输入 → 期望输出）：

**例 1：Workday 风格（data-automation-id + formField 容器）**
输入：`<div data-automation-id="formField-startDate"><label>Start Date</label><input data-automation-id="dateSectionMonth-input"/><input data-automation-id="dateSectionYear-input"/></div>`
输出：字段=工作开始时间，格式=分体月/年，值 `2024-07` 拆为 month=07、year=2024。教会模型：**同一容器内多个 input 归并为一个逻辑字段**。

**例 2：Moka 风格（data-cy + 中文 label）**
输入：`<div class="atsx-form-item"><label>证件号码</label><input data-cy="identification_numberInput"/></div>`
输出：字段=证件号（身份证号）。教会模型：中文 label 是主信号、data-cy 拆词是辅信号，两者冲突时 label 优先。

**例 3：Lever 风格（纯 name 属性）**
输入：`<input name="urls[LinkedIn]"/>`
输出：字段=LinkedIn 主页链接。教会模型：`urls[...]` 方括号参数化命名、`org`=当前公司这类平铺短名的映射。

**例 4：中文校招枚举字段**
输入：`<label>政治面貌</label>` + 自定义下拉（role=combobox，选项含 `中共党员/共青团员/群众`）
输出：字段=政治面貌，类型=单选枚举，值从用户档案取并按选项列表精确匹配，**不猜不在选项里的值**。同类：学制（四年制/三年制…）、培养方式（统分/定向…）、期望薪资。

**例 5：无 label / 弱语义**
输入：`<input placeholder="如：13800000000" aria-label="手机号"/>` 或 SmartRecruiters 式 label 在 shadow 外
输出：字段=手机号，置信度=中，标注依据为 placeholder+aria-label。教会模型：示例值（"如：xxx"）不是 label 本身；置信度低时宁可不填。

Prompt 里还应固定规则：缺失信息留空不猜测（Moka 扩展的 skill 文件也如此要求）；日期一律归一化为 `YYYY-MM`/`YYYY-MM-DD` 再按控件拆分；枚举值必须取自页面选项。

---

## 7. 未解决的问题 / 信息缺口

1. **北森 iTalent 网申表单 DOM**：无公开源码或博客级 DOM 记录。已知线索仅：速申/牛客网申助手等商业产品宣称适配（说明存在可识别的稳定结构）。缺口：组件库名、字段命名、分步结构。→ 需实机打开某北森校招站抓取。
2. **大易（hotjob.cn/wt/）表单内部结构**：仅域名模式有实证，控件/DOM 未知。→ 实机抓取。
3. **用友、金蝶、企业自研 ATS**：完全无公开资料；自研站差异最大，通用语义扫描是唯一路线。
4. **前程无忧/智联/BOSS直聘/实习僧**：平台内投递流程（在线简历模型、聊天流、验证码）无公开 DOM 资料。建议 OneCV 明确范围：先做"企业官网网申"（Moka/北森/大易/飞书招聘），平台内投递后置。
5. **SmartRecruiters 多层 Shadow DOM 的具体结构**：来自 AI 生成的二手综述，方向可信、细节未经源码验证。Taleo/SuccessFactors 同样只有零散二手信息。
6. **中文校招特有字段的完整选项清单**（政治面貌、学制、培养方式、期望薪资等各系统的实际枚举值）：未获得，few-shot 里只能给占位枚举。→ 需实机收集后维护枚举词典。
7. **牛客网申助手的具体实现**（它如何识别企业官网表单）未公开；其产品页仅确认"AI 识别匹配信息字段"的路线与 OneCV 相同，可作为竞品定位参考。

## 附：本次调研主要来源

- https://github.com/ubangura/Workday-Application-Automator （apply.js，Workday selector 第一手）
- https://github.com/ZZDDD/mokahr-autofill-extension （content.js / lib/core.js / manifest.json，Moka+飞书 selector 与中文别名词典第一手）
- https://github.com/ramos07/Python-Form-Filler-Script （lever.py，Lever name 属性第一手）
- https://github.com/adimalkar/Autofill-Extension （"Shortcomings of simplify and jobright" 文档：Shadow DOM/MutationObserver/React 事件等问题清单，注意为 AI 生成、中等可信）
- https://myprofvault.com/auto-fill/{workday,greenhouse,icims} （平台字段清单与 URL 指纹）
- https://support.greenhouse.io （Greenhouse iframe embed 官方文档）、https://developers.greenhouse.io/job-board.html
- https://apply.zalize.com/ （速申：宣称适配北森/Moka/大易的国内竞品，佐证可行性）
- https://www.nowcoder.com/quick-fill/show-introduce （牛客网申助手产品页）
- https://github.com/vescloud/moka-job-scraper （Moka SPA + WAF + 隐藏 API 佐证）
