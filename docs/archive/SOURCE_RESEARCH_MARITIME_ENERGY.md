# 海运、能源与公司关系：数据源研究与三天接入建议

研究日期：2026-10-08（香港）。用途：交给实现 agent 的候选来源、验证任务和数据解释约束；不是当前中东局势报告。

本轮核实了下列官方网页及其可见内容。**网页可读取不等于连接器已实现、批量抓取许可已确认或数据 API 已通过测试。** 尚未运行端到端定时采集；发布频率与项目每天采集一次是两个概念。除明确说明外，不能承诺来源每天发布。

## 1. 核心结论

三天 demo 应同时拥有“事件证据”“实际运营变化”“静态设施/公司关系”三层。多元来源应覆盖不同观察渠道，而不只是增加媒体域名：UKMTO/JMIC 的海事报告、船公司的自有运营公告、港口通告、官方制裁动作、运营商资产资料分别回答不同问题。

最优先验证 UKMTO、一个船公司公告页、OFAC Recent Actions 三个动态源；同时从 EIA、Aramco、ADNOC、QatarEnergy LNG 手动建立少量带出处的静态关系。IMO 用于补充核验与官方背景。具体 connector 数量取决于 Day 1 实测，不能因列入候选表就显示为已接入。

## 2. 候选来源与接入状态

优先级：P0=三天内优先验证；P1=可替换/补充；P2=后续增强。以下 15 个来源入口中，OFAC 的两个入口属于同一机构，不计为独立证据。

| 优先级 / 来源 | 提供什么 | 本轮证据与建议接法 | 必须保留的区别 |
|---|---|---|---|
| P0 [UKMTO](https://www.ukmto.org/) | 船舶安全事件、报告编号、事发时间和区域、后续更新 | 首页、事件与产品导航已读取；后续 agent 实测事件列表与附件。不要假设 RSS/API 存在；HTML/PDF 可做低频发现和解析 | “收到船长报告”不是所有细节已独立确认。保留 UKMTO 编号、版本、原始措辞和调查状态 |
| P1 [JMIC Products](https://www.ukmto.org/partner-products/jmic-products) | 海事风险评估、事件摘要、每周仪表板、月度统计 | 页面明确列出 Info Notes、Weekly Dashboard、Monthly Statistics、Advisories；附件解析待测 | JMIC 可复用 UKMTO/军事或公开来源；两者不能自动算两条独立佐证。威胁评估与已发生事件分开 |
| P0/P1 [IMO Middle East](https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-strait-of-hormuz.aspx) 与 [Red Sea](https://www.imo.org/en/mediacentre/hottopics/pages/red-sea.aspx) | 官方声明、确认事件列表、海事背景、带日期的通行图表 | 主页面已读取，有事件列表/报告链接；具体 PDF 抽取待测。IMODOCS 部分文件需注册，三天不以这些为依赖 | 红海报告与霍尔木兹页面覆盖和口径不同；IMO 汇总也可能来自同一底层报告。图表注明其参考用途，不伪装原始实时 AIS |
| P0 [Maersk News & Advisories](https://www.maersk.com/news) | 订舱暂停、航线调整、货种限制、操作恢复、附加费用公告 | 索引已读取；[示例运营公告](https://www.maersk.com/news/articles/2026/03/02/middle-east-operational-update-2)可说明字段需求，不代表今天状态；列表增量发现和正文抽取待测 | 单一承运人暂停订舱 ≠ 港口关闭；集装箱航线变化 ≠ 油轮/LNG 流量同比例变化 |
| P1 [Hapag-Lloyd Operational Updates](https://www.hapag-lloyd.com/en/services-information/operational-updates/overview.html) | 自有网络、港口/航线服务和订舱变化 | 索引可读取，但可见页面包含动态 Newsstream 配置；不把页面内部 JSON 路径当承诺稳定 API。HTML/PDF 回退需实测 | 与 Maersk 的独立运营公告能证明各自行动，不能仅因二者同向就确认整个港口关闭 |
| P1 [Fujairah Notice to Mariners](https://fujairahport.ae/marine-centre/notice-to-mariner/) / [New](https://fujairahport.ae/marine-centre/notice-to-mariner-new/) | 港内作业限制、航标变化、船舶/手续限制、通告修订 | 官方搜索结果已发现表格和 PDF；本轮未逐份读取附件，标记为候选待测 | 通告编号和撤销/替代关系关键；施工或手续修订不能自动标为战争影响 |
| P1 [MARAD U.S. Maritime Advisories](https://www.maritime.dot.gov/msci-advisories) | 美国官方海事风险与适用船舶指导 | 官方结果可见 Active/Cancelled、Effective/Expire Date。接入前读取具体条款与适用范围 | 美国机构的评估须保留归属；并非独立事件全量数据库。到期/被替代的通知不能仍显示“当前有效” |
| P0 [OFAC Recent Actions](https://ofac.treasury.gov/recent-actions) | 制裁指定、移除、许可、更新等公告 | 列表 HTML 已读取，适合日更发现；逐条提取实体、动作类型、生效时间和原文 | 指定/撤销/许可不是同一种动作。仅做信息展示和关系定位，不据此输出自动合规结论 |
| P2 [OFAC Sanctions List Service](https://sanctionslist.ofac.treas.gov/) | 结构化制裁名单、实体别名及可用标识符 | 官方搜索资料描述可用 GET；直接网页读取只返回 JS 应用错误，**本轮未测试任何 API**。三天先 Recent Actions，后续再按官方文档验证列表接口 | 名单快照不是新增事件；船名会变，优先使用文件实际提供的 IMO 等标识，不通过近似名称直接合并 |
| P0 静态 [EIA World Oil Transit Chokepoints](https://www.eia.gov/international/analysis/special-topics/World_Oil_Transit_Chokepoints) | 霍尔木兹、曼德海峡、苏伊士等背景，历史通行量、绕行和管线背景 | 页面和表格已读取。每个值必须保留统计期和单位；demo 小量人工摘录/校验 | 表格历史流量、设计能力、备用能力、当前实际可用运力是不同量。底层含第三方分析，不意味着得到其原始 AIS 授权 |
| P0 静态 [Aramco Annual Report](https://www.aramco.com/en/investors/annual-report) | 设施、生产/运输网络和权益关系的官方资料 | 年报入口已读取；[2024 年报](https://www.aramco.com/-/media/publications/corporate-reports/annual-reports/saudi-aramco-ara-2024-english.pdf)明确描述 East-West Pipeline 连接东部生产设施和 Yanbu。最终录入应核对最新报告版本及页码 | 年报资产资料不是当前运营状态；不能用旧年报证明目前没有受损或能够立即满负荷替代海运 |
| P0 静态 [ADNOC / ADCOP](https://adnoc.ae/en/adnoc-pipelines/about-us/who-we-are) | Abu Dhabi–Fujairah 管道、所有权与终端关系 | 官方介绍已读取，可建立管道—终端—集团关系；[ADCOP 2024 财报](https://www.adnoc.ae/-/media/adnoc-v2/sub-brands/adnoc-pipeline/files/abu-dhabi-crude-oil-pipeline-2024final-145.ashx)提供运营与所有权区别，使用前核对页码 | ADNOC 集团、ADCOP、ADNOC Onshore、各上市子公司不能混为同一个证券；未知上市敞口保留 unknown |
| P0 静态 [QatarEnergy LNG Corporate Structure](https://www.qatarenergylng.qa/AboutUs/Corporate-Structure) | 具体 LNG venture 的股东、产能及项目状态 | HTML 已读取，适合人工核实少量 venture—股东边 | venture 股权 ≠ 全部 Ras Laffan 股权；已投产与建设中分开；股东关系不等于已量化盈利/股价敏感度 |
| P0 地图 [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | 国界、海岸线等低精度底图 | 条款已读取，数据为 public domain；可下载静态地理文件并本地渲染，下载/渲染待实现 | 仅底图，不是设施数据库或精确导航资料；争议边界采用底图原有标识并记录版本 |
| P1 地图 [OpenStreetMap](https://www.openstreetmap.org/copyright) | 地理定位和可能存在的港口/设施点位 | 条款已读取，ODbL 与署名要求明确；查询服务及瓦片另有政策，尚未验证 | 有位置不证明所有权、容量或运营；不能将免费数据误解为无限制免费瓦片/API。三天可使用静态底图+手工核实点位 |

## 3. 三天交付内的具体任务

### Day 1：取得可复现证据，不先写漂亮图表

1. 来源 agent 为每个 P0 动态源记录：`exact_url, access_method, sample_item_url, checked_at, http_result, extraction_result, terms_url, auth_required, newest_visible_item_at, expected_fields, limitations`。
2. 每个候选源限时 20–30 分钟实测。失败就记录失败并切换，不使用隐藏 API 猜测、登录绕过或反爬规避；保留手工带来源导入作为显式回退。
3. 至少得到海事/运营、官方政策两个不同角色的可用动态源；父计划中的区域新闻/官方声明补上第三类。不用仅靠两个英文机构宣称“多元覆盖”。
4. 从静态来源建立 8–12 个重点地点/设施、5–10 条关系；每条保存出处和资料日期。数量是 demo 目标，不是完整数据库承诺。关注 Hormuz、Bab el-Mandeb、Suez、Fujairah、Yanbu、Ras Laffan 等，精度不明时只用城市/区域标记。

### Day 2：连接证据，不制造影响

1. 将报告与事件分表。UKMTO 新版本应更新已有事件的证据链，不每天新建相同事件。
2. 事件—设施候选关联必须记录关系类型：`explicitly_named`、`same_reported_location`、`nearby_context`、`analyst_inferred`。前两者也不能直接转成 confirmed operational disruption。
3. 公司关系使用 `owns / operates / equity_in_venture / uses_route / serves_port`；每条必须有 `valid_as_of, source_url, supporting_excerpt, verified_by`。`uses_route` 不可从公司国籍或名称猜测。
4. 图上三类样式区分：设施背景、已报告事件位置、已证实运营变更。未知坐标不填国家中心点伪装精确位置；可显示区域和 location precision。

### Day 3：校验并演示日更

1. 跑两次相同采集验证幂等；跑一次带新版本/撤销的更新验证修订可见。
2. 核查至少 10 条真实或有明确 fixture 标识的案例：转载去重、官方单方声明、区域位置、公司更名/别名、过期公告、恢复运营、无独立核验、PDF 无文本、日期缺失、连接失败。
3. 每张资产卡显示参考资料截至日期；每张事件卡显示事发时间、发布时间、采集时间；顶部按源显示成功/失败与最近成功时间。
4. 没有新增 ≠ 源抓取失败；没有事故报告 ≠ 航线安全或设施正常。旧数据保留并明显标 stale，不清空成零。

## 4. 可靠性与 nuance 规则

- **按 claim 判断，不给整家来源一个“可靠=真”的总标签。** 官方机构可以可靠地证明“该机构公开这么说”，不一定独立证明攻击归属。
- 记录原始来源与引用链：`publisher, originating_source, quoted_actor, report_id, cited_urls, independence_group`。转载、翻译、同一通稿、同一船长报告不增加独立证据数。
- UKMTO→JMIC→IMO→新闻媒体可能只是一条底层证据链。显示“4 个发布者 / 1 条已知底层报告”，不要自动“4 源证实”。独立性不明记 unknown。
- 以 `claim_status = reported / corroborated / disputed / corrected / withdrawn` 等描述证据状态；`official_statement` 是来源/声明类型，不与 confirmed 混用。状态变化保留理由和旧版本。
- 避免三种偷换：威胁→已执行；单船/单承运人措施→全航道关闭；静态产能→当前供给损失。
- 波斯湾与阿拉伯湾、霍尔木兹与邻近海域的名称需要别名映射，但保留原文地名。事件位置区间与设施精确坐标不能混在同一精度字段。
- 对海运同时标明船型/货种；集装箱、油轮、LNG、散货的事件不能默认对油价产生相同含义。
- 预测市场与价格变化只可并列展示时间关系；本数据源研究不支持“事件造成价格变化”的因果结论。

## 5. 建议改进的优先顺序

**先做：** 转载来源链、修订和撤销、单项 claim 引用、运营公告适用范围、数据新鲜度、实体别名。这些对可信度的帮助通常大于增加第二套图表引擎。

**然后做：** 多港口主管机关、更多船公司实际运营公告；增加 API/Feed 接入覆盖与 parser 回归样本；静态关系变更检查；针对断供/绕行/恢复不同事件显示不同影响机制。

**后续研究：** 免费/可授权海运指标、历史 AIS 或港口停靠汇总的覆盖与延迟；任何新指标须说明供应商口径、数据缺口、转发条件，不承诺三天内获得全球实时船舶跟踪。公开汇总或地图不等于可下载可商用原始位置流。

## 6. 交给研究 agent 的验收要求

交付 `source_registry` 与 `access_smoke_test_results`，每条来源必须标 `candidate / page_verified / fetch_verified / parse_verified / operational / blocked`。本文件大部分只达到 page_verified，不能被实现 agent 批量升级为 operational。

每项来源至少给一个真实样本链接与解析输出；每个动态 adapter 至少通过重新运行去重和失败处理检查。交付中列出仍缺少的地区、语言、事件类型与商业覆盖，不将“本次抓不到”写成“该来源没有消息”。
