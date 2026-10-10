# 部署到 Google Cloud Run

一个容器同时提供 API 和前端（`Dockerfile`）。不需要本地 Docker：`gcloud run deploy --source .`
会把代码上传到 Cloud Build，在云端构建镜像。

## 一次性准备

```bash
gcloud auth login
gcloud config set project <你的项目 ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

项目需要已经开通 billing。

## 部署 demo

```bash
gcloud run deploy traders-tracker \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 1Gi \
  --set-env-vars "TEAM_WRITE_TOKEN=<团队口令>,TRACKER_NO_AUTO_REFRESH=1,SEC_USER_AGENT=TradersTracker <联系邮箱>"
```

- `--max-instances 1`：SQLite 是单文件数据库，必须只有一个实例在写。
- `TEAM_WRITE_TOKEN`：公开只读，团队口令写入。口令不要写进代码或 git。
- `TRACKER_NO_AUTO_REFRESH=1`：War Tracker 那一侧不自动抓新闻和市场数据。去掉这个变量就会开始实时采集。
- 打分、Amazon 采集用到的 key（`TYPESAFE_API_KEY`、`RAINFOREST_API_KEY` 等）建议放进 Secret Manager，再用 `--set-secrets` 挂载，不要用明文环境变量。

## 必须知道的限制

Cloud Run 的磁盘是**临时**的，实例重启或缩容到 0 之后：

- Reviews 的内置 demo 数据会自动重新加载；
- 团队添加的公司、采集到的评论、读取的财报都会**丢失**；
- 后台调度器只有在实例运行时才会跑（默认空闲时会缩容到 0）。

所以这个部署适合展示。要长期追踪，可以选下面任意一种：

1. **Cloud Run + Litestream → GCS**：SQLite 持续复制到 Cloud Storage，启动时自动恢复。改动小，推荐作为下一步。
2. **一台小 VM**（Compute Engine e2-small / Fly.io 加持久卷）：直接 `npm start`，数据就在磁盘上。
3. 加 `--min-instances 1 --no-cpu-throttling`，让调度器一直运行（每月会多出几十美元），仍然需要配合 1 或 2 才能保住数据。
