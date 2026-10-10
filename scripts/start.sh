#!/bin/sh
# Container entrypoint.
#
# With LITESTREAM_BUCKET set, both databases are restored from Cloud Storage before the server
# starts (only when the local file is missing, i.e. on a fresh instance), and then replicated
# continuously while it runs. Litestream starts the server as its child, forwards the shutdown
# signal, and makes a final sync after the server exits.
#
# Without it, the server runs on the container's own (temporary) disk.
set -e

SERVER="./node_modules/.bin/tsx server/index.ts"
mkdir -p /app/data

if [ -n "$LITESTREAM_BUCKET" ]; then
  for db in /app/data/tracker.sqlite /app/data/reviews.sqlite; do
    litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$db"
  done
  exec litestream replicate -config /etc/litestream.yml -exec "$SERVER"
fi

exec $SERVER
