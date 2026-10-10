# Traders Tracker — one container serving the API and the built client.
#
#   gcloud run deploy traders-tracker --source . --region <region>   (see docs/DEPLOY.md)
#
# Storage is SQLite under /app/data. With LITESTREAM_BUCKET set, both databases are restored from
# and continuously replicated to Cloud Storage (scripts/start.sh), so data survives restarts and
# redeploys. Without it the disk is temporary.
FROM node:24-slim

ARG LITESTREAM_VERSION=v0.3.13
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
     | tar -xz -C /usr/local/bin litestream \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Dev dependencies are needed: the client is built here (vite) and the server runs through tsx.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npx vite build
COPY litestream.yml /etc/litestream.yml
RUN chmod +x scripts/start.sh

# Listen on every interface inside the container; Cloud Run sets PORT.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["scripts/start.sh"]
