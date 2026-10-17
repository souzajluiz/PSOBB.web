#!/bin/sh
# Starts newserv and the web server (bridge/server.mjs) in one container and
# stops the container when either exits. tini (the image's init) reaps them.
set -eu

SYSTEM=/app/newserv/system
STATE=/data/newserv

# Keep newserv's accounts, characters and teams on the volume: the first run
# copies the image's (empty or default) folders there, later runs reuse them.
mkdir -p "$STATE"
for d in players licenses teams; do
  if [ ! -L "$SYSTEM/$d" ]; then
    if [ ! -d "$STATE/$d" ]; then
      if [ -d "$SYSTEM/$d" ]; then cp -a "$SYSTEM/$d" "$STATE/$d"; else mkdir -p "$STATE/$d"; fi
    fi
    rm -rf "${SYSTEM:?}/$d"
    ln -s "$STATE/$d" "$SYSTEM/$d"
  fi
done

cd /app/newserv
./newserv &
NEWSERV=$!

node /app/bridge/server.mjs &
WEB=$!

# Exit (and let the orchestrator restart the container) as soon as one dies.
while kill -0 "$NEWSERV" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do
  sleep 2
done
kill "$NEWSERV" "$WEB" 2>/dev/null || true
wait || true
exit 1
