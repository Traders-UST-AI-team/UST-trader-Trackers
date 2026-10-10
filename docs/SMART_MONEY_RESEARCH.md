# Smart money / 大户与资金活动：数据资源与实施边界

核查日期：2026-10-09。只作规划，不执行交易，不实现跟单。优先接入 **Polymarket 公开钱包与持仓观察**；产品可以使用“Smart Money”页名，但每条记录只称“观察钱包”“大额成交”“持仓变化”，不预先认定这些钱包有信息优势。X 不在范围内。

## 最适合当前看板的资源

| 资源 | 能读取什么 | 当前建议 |
|---|---|---|
| **Polymarket Data API** | 公开交易、钱包活动、持仓、holder、排行榜、PnL 等；官方提供 PublicClient 读取路径与无凭证 HTTP 示例。 | 第一阶段核心数据源；先监控本项目相关市场及有限钱包名单。没有查到这些公开读数按帖收费的说明，可以先按不购买额外数据服务的路径试接；服务器、存储与维护仍有成本，不承诺永久免费或无限访问。[API 概览](https://docs.polymarket.com/getting-started/api)、[公开 Analytics](https://docs.polymarket.com/market-data/public-analytics) |
| **Gamma public profile** | 根据 wallet/user address 查询公开名字、proxy wallet、头像、badge 等，可出现 null/404。 | 补充展示信息和地址映射；名字与 badge 不证明真实身份，未知归属显示 unknown。即使响应含 X username，也不抓取 X。[公开 profile schema](https://docs.polymarket.com/api-reference/profiles/get-public-profile-by-wallet-address) |
| **Kalshi 公开市场成交** | 成交 ID、合约、数量、价格、时间、taker 方向和 block 标记，cursor 分页。 | 可做匿名大额成交活动。当前公开 trade schema 没有参与者身份，因此不能据此构造“Kalshi 钱包跟踪”。[Get Trades](https://docs.kalshi.com/api-reference/market/get-trades) |
| **CFTC COT** | 分类大户的汇总持仓；PRE 支持下载及 API。 | 后续用于能源市场周度资金背景；不是逐钱包数据，也不是实时流。通常周五发布上周二截面，节假日可调整。[PRE 官方指南](https://publicreporting.cftc.gov/stories/s/COT-Help/p2fg-u73y/)、[发布日历](https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm) |
| **SEC 13F / EDGAR** | 管理人的季度 Section 13(f) 证券持仓。 | 后续观察能源、航运、军工相关上市证券。通常季末后 45 天内申报，短头寸不报；不能称为机构最新交易或完整组合。[SEC FAQ](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f) |

## Polymarket：必须按当前 v2 合约实施

官方要求新接入从 v2 开始，文档称 v1 于 **2026-10-24** 退休。v2 使用 `/v2` 前缀、snake_case 字段及 `{ data, pagination }` 返回结构；旧资料里的 offset 上限、camelCase 与分离的 closed-position 路由不可直接套用。保留 `sourceApiVersion` 并把上游原始响应缓存到可重放层。[官方迁移说明](https://docs.polymarket.com/migrate/data-api-v1-to-v2)

| 读取路径 | 目的与必要语义 |
|---|---|
| `/v2/leaderboard` | 按时期与类别发现候选钱包；榜单 PnL 是上游口径，不等于已独立核算的全账户净收益。保存发现时期、筛选规则和原始值。[Analytics](https://docs.polymarket.com/market-data/public-analytics) |
| `/v2/trades` | 市场大额成交及钱包买卖。默认 `taker_only=true`，每个 fill 只返回 taker 一侧；观察钱包时须评估 `taker_only=false`，避免漏看 maker 成交。cursor 内含排序锚点和页大小。用户形状时间界限与市场/global 形状不同；官方当前文档写 user 默认三年、`start=1` 全历史，condition/event 固定三年、裸全局 feed 当前加前一月。不要承诺无限历史全市场。[List trades](https://docs.polymarket.com/api-reference/feeds/list-trades) |
| `/v2/activity` | 区分 trade、split、merge、redeem、奖励等；存入不同活动类别。默认排除 deposit/withdrawal，若要读取需明确关闭该过滤。[Wallet Activity](https://docs.polymarket.com/trading/wallet-activity) |
| `/v2/positions` | 当前风险敞口及 closed/redeemable 等生命周期；已实现与未实现 PnL 分开。持仓余额变化不能单凭两次快照归因为买入/卖出。[positions schema](https://docs.polymarket.com/api-reference/wallet/list-positions-for-a-user-or-market) |
| `/v2/holders` | 按 outcome 获取大持仓者，逐 cursor 合并各 token；数据不完整时只显示返回名单内集中度，不能伪称全部持仓集中度。[Analytics](https://docs.polymarket.com/market-data/public-analytics) |
| `/v2/status` | 上游数据新鲜度；与抓取时间同时展示。[迁移说明](https://docs.polymarket.com/migrate/data-api-v1-to-v2) |

请求限额按 IP 控制；当前官方写 v2 总体 800 req/10s，trades 300/10s，positions/activity 各 200/10s。实现应远低于上限，设共享队列、超时、指数退避、抖动和采集预算；云服务器实际可达性及限额仍需 smoke test。[官方 Rate Limits](https://docs.polymarket.com/api-reference/rate-limits)

## 建议第一版显示什么

下面是本项目的设计建议，不是对任何钱包获利能力的结论。

1. **市场大额成交流**：只监控关注市场，显示 outcome、买卖、价格、shares、成交金额与时间。金额阈值同时用绝对值及本市场历史分位数配置。称“已观察成交”，没有完整回补时显示缺口。
2. **观察钱包名单**：从用户指定地址及排行榜候选发现；保存候选发现时间，禁止今天入榜后再把过去表现当成当时已知信号。身份为公开 profile / 用户备注 / 未知，并保留依据。
3. **钱包详情**：持仓、已实现/未实现收益、观察起始时间、当前快照时间、已覆盖市场数量，以及买卖/split/merge/redeem 时间线。区分上游 PnL 与本地重算结果，手续费、奖励及结算口径各自记录。
4. **资金指标**：单 outcome 观察成交净买入额、观察钱包持仓变化、多钱包同时活动次数。每次显示钱包数、市场范围和时间窗口。交易双方不能双重计入全市场成交量；全市场每笔都有买卖双方，不能把买方成交总额称作“新资金净流入”。
5. **新闻叠加**：将大额成交时间和新闻发布时间画在现有概率图上。文案只描述前后时间，不能因发生在新闻前就标记“内幕交易”。
6. **站内提示**：大额成交、关注钱包新建仓/减仓、持仓集中度变化，均有去重、冷却、原始来源链接与规则解释。第一阶段不生成自动跟单或买卖建议。

## 不应从数据自动推断的东西

- Wallet 是地址而非自然人；一个人可能有多个地址，多人/机构也可能共用策略或托管结构。只凭名字、资金往来或同时交易，不合并为已确认实体。
- 排行榜筛出的是历史表现好的样本，存在选择偏差；绝对 PnL 易受资金规模与单次事件影响。不能把“大户”“赚钱”直接等同“有信息优势”。
- 持仓市值和未实现 PnL 不等于已经兑现的利润；高胜率不等于高收益，稀疏已结算样本应显示样本数，不计算伪精确能力分数。
- 转账、split、merge、redeem、迁移、奖励与对冲会改变持仓/余额；不作为单边方向交易计算。怀疑刷量、关联钱包、自成交等只标待核查，不武断归因。
- 当前持仓快照或上游“full history”参数不自动证明本地完整；须完成分页、校验时间范围、回补缺口和与余额抽样对账，再标注完整覆盖。

## 交给 implementation agent 的验收条件

先完成 **官方接口 smoke test → 版本化 adapter → raw cache → 有界历史回补 → 连续监控 → UI**。初期范围建议 10–20 个关注市场、最多 20 个观察钱包，市场 trades 每 1–5 分钟、持仓每 10–15 分钟、榜单每天更新；这是试运行配置，测真实延迟后再调整。

新增存储至少分开 wallet/profile mapping、trade rows、activity rows、position snapshots、leaderboard snapshots、sync cursors 和 coverage gaps。时间统一 UTC 存储；UI 用用户时区。不要把 transaction hash 单独当成交唯一键，一笔链上交易可能有多个 fill；优先上游唯一 ID，否则用经过多 fill 实测的复合键并保留原始记录。

验证 maker/taker 覆盖、分页期间新增成交、同 tx 多 fill、重试重复、时间秒/毫秒差、大小写地址、未知 profile、关闭仓位、零/缺失 PnL、停止重启补抓、上游延迟及部分失败。两次持仓变化须能连到观察活动或标记原因未知。市场外部对冲、地址归属与完整历史未知时，UI 不生成确定性的 Smart Money 评分。

COT 与 13F 作为后续批次资源，必须同时保存“持仓所属日期”和“首次公开日期”；回测或新闻对齐只能使用当时已公开的数据，不把季末快照放回季末当作已知信息。
