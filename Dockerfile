# PSOBB.web in one image: newserv (the game server), the built browser client
# and bridge/server.mjs, which serves the client and relays its WebSockets to
# newserv on a single HTTP port. See docs/DEPLOY.md (Dokploy).
#
# No Sega client data is built into the image: mount the PSOBB data/ folder at
# /data/psobb-client, or set PSOBB_DATA_URL to a .zip (Google Drive link) that
# docker/fetch-data.mjs downloads there at start (optional; without either the
# page asks for the folder).

# newserv comes from fuzziqersoftware's official image, pinned to the commit the
# project is tested with (the sha-<commit> tag of ce2273a): nothing is compiled
# here. The image is public and has linux/amd64 and arm64 builds. It holds the
# binary at /usr/local/bin/newserv and the data at /newserv/system.
ARG NEWSERV_IMAGE=ghcr.io/fuzziqersoftware/newserv:sha-ce2273a
FROM ${NEWSERV_IMAGE} AS newserv

# --- browser client -----------------------------------------------------------
FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build
WORKDIR /app/bridge
COPY bridge/package.json bridge/package-lock.json* ./
RUN npm ci --omit=dev

# --- runtime -------------------------------------------------------------------
FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tini unzip \
 && rm -rf /var/lib/apt/lists/*
COPY --from=client /usr/local/bin/node /usr/local/bin/node
COPY --from=newserv /usr/local/bin/newserv /app/newserv/newserv
COPY --from=newserv /newserv/system /app/newserv/system
# Local-only config, as scripts/setup-newserv.sh writes it: newserv listens on
# loopback, no DNS server, no IP/PPP stacks. Only the HTTP port leaves the
# container; players reach newserv through the relay.
RUN sed -e 's/"LocalAddress": "en0"/"LocalAddress": "127.0.0.1"/' \
        -e 's/"ExternalAddress": "10.0.1.5"/"ExternalAddress": "127.0.0.1"/' \
        -e 's/"DNSServerPort": 53/"DNSServerPort": 0/' \
        -e 's/"IPStackListen": \[5059\]/"IPStackListen": []/' \
        -e 's/"PPPStackListen": \[5058\]/"PPPStackListen": []/' \
        -e 's/"HTTPListen": \[\]/"HTTPListen": ["127.0.0.1:5080"]/' \
        /app/newserv/system/config.example.json > /app/newserv/system/config.json
COPY --from=client /app/client/dist /app/client/dist
COPY --from=client /app/bridge/node_modules /app/bridge/node_modules
COPY bridge/server.mjs bridge/admin.mjs bridge/admin-chars.mjs bridge/admin-quests.mjs bridge/admin-hash.mjs bridge/package.json /app/bridge/
COPY bridge/admin-ui /app/bridge/admin-ui
# The quest upload validates files with the client's own parsers (Node strips the types).
COPY client/src/formats /app/client/src/formats
COPY docker/fetch-data.mjs /app/fetch-data.mjs
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV PORT=8080 \
    DIST=/app/client/dist \
    NEWSERV_SYSTEM=/app/newserv/system \
    PSOBB_DATA=/data/psobb-client \
    NEWSERV_HTTP=127.0.0.1:5080 \
    ADMIN_AUDIT_LOG=/data/newserv/admin-audit.log \
    ADMIN_CONFIG_MIRROR=/data/newserv/config.json \
    ADMIN_QUEST_BACKUP=/data/newserv/quest-backups \
    ADMIN_QUESTS_MIRROR=/data/newserv/quests-published
# The admin panel (docs/ADMIN.md) is off unless ADMIN_PASSWORD or
# ADMIN_PASSWORD_HASH is set. newserv's HTTP API (port 5080) listens on
# loopback only and is never published; EXPOSE stays 8080.
# newserv's accounts, characters and teams live in /data/newserv (a volume).
VOLUME ["/data/newserv"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
