# Traders Tracker — one container serving the API and the built client.
#
#   gcloud run deploy traders-tracker --source . --region <region>   (see docs/DEPLOY.md)
#
# Storage is SQLite under /app/data. On Cloud Run that disk is per-instance and temporary: the
# bundled review dataset is reloaded on every start, and anything collected is lost on restart.
# See docs/DEPLOY.md for keeping data across restarts.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Dev dependencies are needed: the client is built here (vite) and the server runs through tsx.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npx vite build

# Listen on every interface inside the container; Cloud Run sets PORT.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server/index.ts"]
