# 部署到 Google Cloud Run（实时采集 + Litestream 持久化）

一个容器同时提供 API 和前端（`Dockerfile`）。不需要本地 Docker：`gcloud run deploy --source .`
会把代码上传到 Cloud Build，在云端构建镜像。

数据是 SQLite（`data/tracker.sqlite` 和 `data/reviews.sqlite`）。设置了 `LITESTREAM_BUCKET` 后，
容器启动时会先从 Cloud Storage 恢复这两个库，运行期间持续复制回去（`scripts/start.sh`、
`litestream.yml`），所以重启、缩容、重新部署都不会丢数据，并保留 7 天的时间点历史。

## 一次性准备

```bash
PROJECT=<项目 ID>
REGION=asia-east1
BUCKET=$PROJECT-traders-tracker-db

gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com

# 源码部署由默认 compute 服务账号构建。项目在组织下、且组织关闭了默认服务账号的自动授权时，
# 它没有任何权限，需要补上构建角色：
NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role=roles/run.builder --condition=None

# 运行时用专用服务账号，只能读写这一个 bucket
gcloud iam service-accounts create traders-tracker --display-name="Traders Tracker runtime"
RUN_SA=traders-tracker@$PROJECT.iam.gserviceaccount.com

# 存数据库副本的 bucket（禁止公开访问）
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://$BUCKET --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member="serviceAccount:$RUN_SA" --role=roles/storage.objectAdmin

# 团队口令：随机生成，只存在本机 .env.deploy（已被 git 忽略）
echo "TEAM_WRITE_TOKEN=$(openssl rand -base64 18 | tr -d '/+=')" > .env.deploy
```

## 部署

```bash
source .env.deploy
gcloud run deploy traders-tracker \
  --source . --region $REGION --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --cpu 1 --memory 1Gi \
  --service-account $RUN_SA \
  --set-env-vars "LITESTREAM_BUCKET=$BUCKET,TEAM_WRITE_TOKEN=$TEAM_WRITE_TOKEN,SEC_USER_AGENT=TradersTracker <联系邮箱>"
```

为什么是这些参数：

- `--min-instances 1 --no-cpu-throttling`：War Tracker 的实时采集和 Reviews 的定时采集都是后台任务，需要实例一直在、CPU 一直可用；Litestream 也需要持续复制。
- `--max-instances 1`：SQLite 只能有一个写入者。
- 没有设置 `TRACKER_NO_AUTO_REFRESH`，所以 War Tracker 会实时采集新闻、预测市场和传感器数据。
- 打分和 Amazon 采集的 key（`TYPESAFE_API_KEY`、`RAINFOREST_API_KEY` 等）建议放进 Secret Manager，再用 `--set-secrets` 挂载。

费用（参考价，以账单为准）：1 vCPU + 1 GiB、常驻、CPU 一直分配，大约每月 50 美元；GCS 存储和请求费用通常不到 1 美元。

## 已知限制

- 部署新版本时，新旧两个实例会短暂同时运行几秒。Litestream 会为新实例开一个新的 generation，恢复时取最新的那个，所以旧实例在这几秒里的写入可能丢失。对这个 tracker 影响很小。
- 某些新闻或数据源可能会拒绝来自云服务器 IP 的请求，在 Sources 页面会显示为失败，不会被绕过。

## 常用操作

```bash
# 查看日志
gcloud run services logs read traders-tracker --region $REGION --limit 100
# 确认副本在写
gcloud storage ls -r gs://$BUCKET | head
# 更新 key 或口令（会触发新 revision）
gcloud run services update traders-tracker --region $REGION --update-env-vars "TYPESAFE_API_KEY=..."
```
