# Customer Reviews Tracker：设计与路线图

第二个 workspace（顶栏切换到 **Customer Reviews**）。思路来自 Jin (2023)《More than words》：
**负面评论情绪的突然下拐，往往领先营收 1–2 个财季**。这个 tracker 把这件事做成一个团队可以
一起维护、会自己更新、并且诚实记录命中与失误的观察列表。

## 1. 它现在能做什么

| 能力 | 怎么做到的 |
|---|---|
| 团队共建观察列表 | 任何有团队口令的人都可以添加公司（输入 ticker → 自动从 SEC EDGAR 带出公司名、CIK、财年截止月、行业）和产品（粘贴 Amazon 链接或 ASIN）。每条记录都会写上是谁加的。 |
| 自动更新 | 后台调度器每 15 分钟检查一次：到期的产品（默认每天一次）去拉最新评论，到期的公司（每 24 小时）重读财报。已经存过的评论**不会再打分**，所以只为新评论付打分费用。 |
| 低成本情绪打分 | 打分链：JEV (`TYPESAFE_API_KEY`) → Gemini → Claude Haiku → 本地规则兜底。整条链有统一的时间上限，CSV 导入时并发 4 路打分、每 25 条提交一次。 |
| 财报自动对齐 | 季度营收、经营利润、毛利率全部来自 EDGAR XBRL（免费、无需 key）。Q4 用 10-K 全年数减去 Q1–Q3 推出来；财季按公司自己的财年划分（包括 52/53 周财年）。 |
| 诚实回测 | 每个 Negative Swing 都会去看之后 2 个已披露季度：营收同比增速**放缓**算 Hit，没有放缓算 Miss（保留，不删），还没披露算 Pending。命中率旁边总是显示基准率（任意季度之后增速放缓的频率），命中率不比基准率高，就说明这个信号没用。 |
| 采集日志 | 每次采集（定时或手动、成功或失败、"未连接"）都有记录，可以回答"这个季度为什么样本这么少"。 |
| 公开只读 + 团队口令写入 | 设置 `TEAM_WRITE_TOKEN` 之后，所有人都能看，只有输入口令的人能添加、采集、导入。 |

## 2. 信号规则（全部在 `shared/review-signals.ts`，前后端共用）

- 每条评论打分 −2…+2。**卖家/物流/包装类**投诉（`is_product_related = false`）和 **Amazon Vine 免费试用评论**都保留，但不计入情绪均值。
- 公司下所有在追踪的产品**合并**按季度计算（品牌级聚合，缓解单个 ASIN 样本太少的问题），也可以切到单个产品看。
- `Δ = 本季均值 − 前 4 季均值`。**Negative Swing = Δ < −0.15 且比上季下降**（环比下拐）。
- 有情绪分的评论少于 20 条的季度标记为 `sparse`。
- 渠道敞口（high / medium / low）记录这家公司有多少销售走 Amazon / DTC；敞口低的公司信号天然偏弱（例如 P&G、Colgate）。

## 3. 数据从哪里来

| 来源 | 状态 | 需要的配置 |
|---|---|---|
| SEC EDGAR 财报 | 默认开启 | 生产环境建议设置 `SEC_USER_AGENT="TradersTracker 你的邮箱"`（SEC 公平访问政策要求） |
| Amazon 评论 | 需要数据供应商 | `RAINFOREST_API_KEY`，或 `APIFY_TOKEN` + `APIFY_AMAZON_REVIEWS_ACTOR`（可选 `APIFY_AMAZON_REVIEWS_INPUT` 模板） |
| Best Buy 评论 | 可选 | `BESTBUY_API_KEY`，并在产品上填 Best Buy SKU |
| CSV 导入 | 一直可用 | 任意评论导出文件（浏览器插件、Helium 10、Jungle Scout…），列会自动识别；同一个文件重复导入只会更新、不会重复 |
| Reddit | 不可用 | Reddit 对本项目的脚本请求返回 403，不做规避 |
| 打分 | 有 key 就用 | `TYPESAFE_API_KEY`（JEV），`GEMINI_API_KEY`，`ANTHROPIC_API_KEY` |

> Amazon 没有公开的评论 API，而且禁止直接爬取。这里只通过你有账号的数据供应商读取，不绕过封锁。
> 使用前请确认供应商条款和你们的合规要求。

## 4. 团队怎么用

1. 打开 Customer Reviews → 右上角 **🔒 输入团队口令**（第一次需要，填上自己的名字）。
2. **+ Add company**：输入 ticker，确认 EDGAR 带出的信息，选择渠道敞口，写一句为什么追踪。财报会立刻读取。
3. 在公司页 **+ Track a product**：粘贴 2–5 个最畅销的 Amazon 链接。
4. 有 Amazon 供应商时：点 **Collect now** 先拉一次，之后每天自动更新。没有供应商时：用 **Import CSV**。
5. 日常查看：观察列表首页按信号排序扫一遍；某家公司出现 ▼ Negative swing，就进公司页看 *vs Revenue* 和 *Reviews*（按负面、缺陷过滤），判断是不是真的产品问题。

## 5. 路线图

**第 2 阶段：让数据长期保存、让团队及时知道**
- 持久化存储：Cloud Run 的磁盘是临时的。可以用 Litestream 把 SQLite 持续备份到 GCS，或者迁移到一台小型 VM（见 `docs/DEPLOY.md`）。
- 新的 Negative Swing 出现时推送到 Slack / 邮件（可以复用 War Tracker 已有的 alerts 机制）。
- 每周自动生成一份简报：哪些公司情绪下拐、对应的典型差评原文。

**第 3 阶段：让信号更可靠**
- 稀疏季度用贝叶斯收缩（向品牌长期均值收缩），而不是只打 `sparse` 标签。
- 按评论数或销量排名给各 ASIN 加权，而不是简单合并。
- 把同一个 rubric 跑在历史评论上，做 8–12 个季度的 hold-out 回测，按渠道敞口分组报告命中率。
- 在打分结构里加上 `summary` 和更细的缺陷标签，方便在 Reviews 页按问题聚类。
