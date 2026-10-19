# PSOBB.web in one image: newserv (the game server), the built browser client
# and bridge/server.mjs, which serves the client and relays its WebSockets to
# newserv on a single HTTP port. See docs/DEPLOY.md (Dokploy).
#
# No Sega client data is built into the image: mount the PSOBB data/ folder at
# /data/psobb-client, or set PSOBB_DATA_URL to a .zip (Google Drive link) that
# docker/fetch-data.mjs downloads there at start (optional; without either the
# page asks for the folder).

# Where the runtime stage takes newserv from. The default is the stage below
# that compiles it inside this build (slow: tens of minutes, GBs of RAM). Set it
# to a prebuilt image (ghcr.io/<owner>/psobb-newserv:latest, built by
# .github/workflows/newserv-image.yml) to skip the compile: only the small
# client stage is then built on the server. See docs/DEPLOY.md.
ARG NEWSERV_IMAGE=newserv-artifacts

# newserv and its libraries, pinned to the commits the project is tested with.
ARG PHOSG_REF=66f8c363362e3a0d946e46ae895de337e535aa3e
ARG RESOURCE_DASM_REF=8930baa5ae99bf41e8d70b2d21ae8423dd38e429
ARG NEWSERV_REF=ce2273a8e48c5c6fec9e21d85c490028498d8682
# Parallel compiler jobs. Each C++ job of resource_dasm / newserv can take
# 1.5-2 GB of RAM, so the default is small: raise it only on a big builder.
ARG BUILD_JOBS=2

# --- newserv ----------------------------------------------------------------
FROM ubuntu:24.04 AS newserv-built
ARG BUILD_JOBS
ARG PHOSG_REF
ARG RESOURCE_DASM_REF
ARG NEWSERV_REF
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates libasio-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN set -eux; \
    fetch() { git init -q "$1"; git -C "$1" fetch -q --depth 1 "https://github.com/fuzziqersoftware/$1.git" "$2"; git -C "$1" checkout -q FETCH_HEAD; }; \
    fetch phosg "$PHOSG_REF"; \
    fetch resource_dasm "$RESOURCE_DASM_REF"; \
    fetch newserv "$NEWSERV_REF"
RUN set -eux; \
    for repo in phosg resource_dasm; do \
      cmake -S "$repo" -B "$repo/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/newserv-deps -DCMAKE_PREFIX_PATH=/opt/newserv-deps; \
      cmake --build "$repo/build" -j"${BUILD_JOBS}"; \
      cmake --install "$repo/build"; \
    done; \
    cmake -S newserv -B newserv/build -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=/opt/newserv-deps; \
    cmake --build newserv/build -j"${BUILD_JOBS}"
# Local-only config, as scripts/setup-newserv.sh writes it: newserv listens on
# loopback, no DNS server, no IP/PPP stacks. Only the HTTP port leaves the
# container; players reach newserv through the relay.
RUN sed -e 's/"LocalAddress": "en0"/"LocalAddress": "127.0.0.1"/' \
        -e 's/"ExternalAddress": "10.0.1.5"/"ExternalAddress": "127.0.0.1"/' \
        -e 's/"DNSServerPort": 53/"DNSServerPort": 0/' \
        -e 's/"IPStackListen": \[5059\]/"IPStackListen": []/' \
        -e 's/"PPPStackListen": \[5058\]/"PPPStackListen": []/' \
        newserv/system/config.example.json > newserv/system/config.json

# Just what the runtime needs from the compile, so a prebuilt image is small
# (the build tree and sources stay behind). The workflow publishes this target.
FROM scratch AS newserv-artifacts
COPY --from=newserv-built /opt/newserv-deps/lib /opt/newserv-deps/lib
COPY --from=newserv-built /src/newserv/build/newserv /src/newserv/build/newserv
COPY --from=newserv-built /src/newserv/system /src/newserv/system

# The stage the runtime copies from: the local compile (default) or the prebuilt
# image named by NEWSERV_IMAGE.
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
COPY --from=newserv /opt/newserv-deps/lib /opt/newserv-deps/lib
COPY --from=newserv /src/newserv/build/newserv /app/newserv/newserv
COPY --from=newserv /src/newserv/system /app/newserv/system
COPY --from=client /app/client/dist /app/client/dist
COPY --from=client /app/bridge/node_modules /app/bridge/node_modules
COPY bridge/server.mjs bridge/package.json /app/bridge/
COPY docker/fetch-data.mjs /app/fetch-data.mjs
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV LD_LIBRARY_PATH=/opt/newserv-deps/lib \
    PORT=8080 \
    DIST=/app/client/dist \
    NEWSERV_SYSTEM=/app/newserv/system \
    PSOBB_DATA=/data/psobb-client
# newserv's accounts, characters and teams live in /data/newserv (a volume).
VOLUME ["/data/newserv"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
