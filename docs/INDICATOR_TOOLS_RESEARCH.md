# Indicators 开源工具核查

核查日期：2026-10-09。用于交给 implementation agent；本文件只做选型，不安装依赖、不实施功能。X 接入明确排除。依据是项目当前 `package.json` 及下面链接的官方仓库、README、许可证、release 页面；不是对第三方项目运行正确性的认证。

## 结论

第一阶段继续使用现有 ECharts，增加可解释的统计指标、变化提示和来源状态。推荐新增 `simple-statistics`（若统计需求确实超过几个简单公式）和 `lucide-react`（统一图标）。不为了“有 indicator”直接更换图表引擎。技术分析功能需要单独的等间隔价格序列、明确计算参数和足够历史数据。

下表“建议”是结合本项目的工程判断；工具能力、许可证由所附官方来源支持。所有新增包都须在实施时选定并锁定具体版本，核对该版本的 LICENSE/NOTICE、依赖许可证和 Node/React 兼容性。

## 8 个候选的实际用途

| 工具 | 本项目用途与建议 | 官方能力 / 许可证 | 可观察维护证据 |
|---|---|---|---|
| **Apache ECharts** | **第一阶段保留。** 用来绘制当前值、历史基线、移动平均、异常点和小趋势图；计算放在后端，不由绘图组件决定规则。 | JavaScript 交互图表；Apache-2.0。[仓库](https://github.com/apache/echarts) | 官方仓库有测试目录、类型检查流程、贡献和安全说明。项目本身已依赖它，继续使用的迁移成本最低。 |
| **simple-statistics** | **优先统计候选。** 中位数、分位数、MAD 等适合船舶通行、消息计数的历史基线；百分点差、更新时间无需库。 | Node 和浏览器均可运行，无运行依赖；ISC。[仓库](https://github.com/simple-statistics/simple-statistics)、[统计 API](https://simple-statistics.github.io/docs/) | 仓库提供测试、类型声明和 changesets，release 页面有持续版本记录。[Releases](https://github.com/simple-statistics/simple-statistics/releases) |
| **Lucide React** | **优先 UI 候选。** 船舶、油价、网络、时钟、警报、来源等采用统一图标。图标旁必须保留名称/单位，异常状态必须同时用文字表达。 | 官方提供 `lucide-react`；ISC，部分 Feather 派生图标保留 MIT 通知。[仓库](https://github.com/lucide-icons/lucide)、[License](https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE) | Release 页面近期有图标、集成测试和依赖维护记录。[Releases](https://github.com/lucide-icons/lucide/releases) |
| **KLineChart** | **第二阶段 OHLCV 图表候选。** 若需要蜡烛图、叠加指标、画线，可局部加入金融资产详情页；不用替换传感器/概率图。 | 内置多种指标、画线模型、TypeScript 类型，README 声明零第三方依赖；Apache-2.0。[仓库](https://github.com/klinecharts/KLineChart) | 有 release 列表、源码、调试目录和安全政策；实施前区分稳定版与预发布版。[Releases](https://github.com/klinecharts/KLineChart/releases) |
| **TradingView Lightweight Charts** | **与 KLineChart 二选一。** 适合金融资产图表；本身是绘图层，不能假设安装后自动获得全部指标。 | Canvas 金融图表；Apache-2.0，README 额外明确要求 TradingView attribution notice 和网站链接。[仓库及授权说明](https://github.com/tradingview/lightweight-charts#license) | 官方 release 页面持续记录功能和修复。[Releases](https://github.com/tradingview/lightweight-charts/releases) |
| **deepentropy/lightweight-charts-indicators** | **后续实验候选。** 只有选用 Lightweight Charts 后再试；先验证 SMA/EMA/RSI/MACD/BB 小白名单，勿整库直接开放或因指标数多认定可靠。 | MIT；README 安装示例需要 `oakscriptjs`，绘图 renderer 使用 Lightweight Charts 5；以 OHLCV bars 计算。[仓库](https://github.com/deepentropy/lightweight-charts-indicators) | 可观察到 tests、Vitest reference/regression 配置及 release 记录；这些不能证明每个社区指标都经过独立验证。[Releases](https://github.com/deepentropy/lightweight-charts-indicators/releases) |
| **LuxAlgo/PineTS** | **暂缓。** 只有确定需要导入 Pine 脚本时才有必要；第一阶段基本指标不用脚本运行时。 | TypeScript Pine Script runtime；README 将 native v6 标为 experimental。当前为 AGPL-3.0 / 商业双授权，不能沿用旧资料的宽松授权假设。[仓库](https://github.com/LuxAlgo/PineTS)、[License](https://github.com/LuxAlgo/PineTS/blob/main/LICENSE) | Release 页面有近期版本；活跃开发不等于所有 Pine 特性兼容。[Releases](https://github.com/LuxAlgo/PineTS/releases) |
| **cinar/indicator** | **暂缓。** 当前是 Go 库，对 Node/TypeScript 项目增加跨语言边界；不为几个技术指标引入独立服务。 | 技术分析与回测；官方明确 v2+ AGPLv3 / 商业双授权，v1 为 MIT。不能把 v1 授权当成 v2 授权。[仓库及 License](https://github.com/cinar/indicator#license) | 仓库有源码、贡献指南及 release 记录。[Releases](https://github.com/cinar/indicator/releases) |

AGPL 候选暂缓属于当前选型决定：如果后续要用，再依据固定版本许可、部署方式和源码公开策略解决适用条件；这里没有把“开源”解释为“无条件适用于闭源服务器”。

## 可以交给 agent 的实施要求

1. **复用图表。** 当前 ECharts 继续负责传感器和预测市场曲线。指标 API 输出数值、单位、计算窗口、样本数、数据截至时间、规则版本和缺失原因。所有卡片使用同一结果结构。
2. **先做无额外算法依赖的指标。** 预测概率变化用 `100 × (p_now - p_then)` 个百分点；没有足够近的历史点时返回 unavailable，附真实比较时长。实际价格变化用百分比；基数为零不计算。不要混用概率百分点和收益率百分比。
3. **新鲜度分开表示。** `observedAt` 是数据所属时间，`fetchedAt` 是抓取时间。每日数据不按五分钟流数据的标准判定过期；每个来源配置频率与容许延迟。
4. **统计基线再接 simple-statistics。** 原始 observations → 按来源频率归一化 → 基线 → 指标。历史窗口不得包含当前待判断点。可提供 median、p10/p90、MAD；MAD 为零或样本不足时停止异常评分，不除以零。跨来源单位和频率不同的序列不得直接相加。
5. **消息计数体现监控覆盖。** 只统计实际启用的新闻/Telegram 来源，展示有效来源数量和采集成功率。频道新增、失联或补抓造成的计数跳变，不应标成事件升级。
6. **技术指标放在资产详情的可选面板。** SMA/EMA 可基于明确规则整理的价格序列；RSI/MACD/BB 等只在数据长度与频率满足条件时启用。ATR 等要求真实 OHLC，不能由稀疏概率快照伪造高低价或成交量。不会从指标生成自动交易建议。
7. **只选一个后续金融绘图引擎。** 实施 agent 先比较 KLineChart / Lightweight Charts 的样例、移动端表现、事件标记和主题适配；除非有明确功能差距，不同时增加两者。任何新增库都不提供免费行情数据，数据源需另行接入。
8. **最低验收。** 已知样例验证百分点/百分比、时间对齐、暖机期、缺失点、零基数、MAD=0、重复观察、失联来源和重启补抓；异常提示展示来源与规则，可重现计算。图标/颜色不能成为唯一含义载体。

## 简单技术分析备选

`technicalindicators` 是 TypeScript 技术分析库，MIT，提供 SMA、EMA、RSI、MACD、Bollinger Bands 等。可作为不需要 Pine 脚本时的计算层备选；README 仍包含旧 Node/Webpack/ES5 路径，实施前需验证当前 ESM/TypeScript 构建与数值定义。不要同时安装多个覆盖同一公式的计算库。[官方仓库](https://github.com/anandanand84/technicalindicators)

第一阶段不用另加通用规则引擎、任务队列或布局终端框架。简单阈值、去重键、冷却时间与规则版本可由现有 Node/SQLite 实现；有具体瓶颈再引入额外基础设施。
