# Deploying (Docker / Dokploy)

The `Dockerfile` at the repository root builds one image that runs the whole
stack on a single HTTP port:

- **newserv**, the game server, built from source at pinned commits
  (`PHOSG_REF`, `RESOURCE_DASM_REF`, `NEWSERV_REF` build args) with the
  loopback-only config of `scripts/setup-newserv.sh`. Its ports never leave
  the container.
- **the browser client**, built with Vite (`client/dist`).
- **`bridge/server.mjs`**, which serves the client and everything the Vite dev
  server serves in development: `/keys/*.nsk`, `/newserv-text/`,
  `/newserv-maps/` and `/psobb-data/`. It also relays the client's WebSockets
  to newserv at `/bridge?port=N`, only for newserv's own BB ports. A build of
  the client connects to `/bridge` on its own origin (`ws://` or `wss://`), so
  it works behind a TLS proxy with no extra settings.

No Sega client data is in the image or in this repository.

## Dokploy

1. **Create an Application** whose source is this Git repository (branch
   `main`). Set **Build Type** to **Dockerfile** with path `Dockerfile` and
   context `.`.
2. **Domain:** add a domain pointing at container port **8080** and enable
   HTTPS. Traefik passes WebSocket upgrades through, so nothing else is needed
   for `/bridge`.
3. **Volumes** (Advanced -> Mounts):
   - **Volume** `psobb-newserv` -> `/data/newserv`: newserv's accounts,
     characters and teams (`players`, `licenses`, `teams`). Without it every
     redeploy starts from an empty server.
   - **Bind mount** (optional) of a PSOBB client `data/` folder ->
     `/data/psobb-client`. With it the game loads its models, maps and
     textures from the server. Without it each player picks their own `data/`
     folder in the browser (Chrome / Edge, File System Access API). Only mount
     data you have the right to serve.
4. **Deploy.** The first build compiles newserv and takes a few minutes. The
   container is healthy once `GET /` answers.

## What the image serves

Production serves only the classic client: `/` opens `classic.html` (the
original-style screens, from the title to the field). The development pages
(`index.html` with its protocol log and map viewer, `models.html`) are not
built into the image, and `bridge/server.mjs` answers 404 for any other
`.html`. To build every page anyway (local checks), set `PSOBB_DEV_PAGES=1`
for `npm run build`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port of `bridge/server.mjs` |
| `PSOBB_DATA` | `/data/psobb-client` | client data served at `/psobb-data/`, if the folder exists |
| `TARGET_HOST` | `127.0.0.1` | where the relay finds newserv |
| `ALLOWED_PORTS` | `12000`..`12008` | newserv ports the relay may open |

## Without Dokploy

```sh
docker build -t psobb-web .
docker run -d -p 8080:8080 \
  -v psobb-newserv:/data/newserv \
  -v /path/to/psobb-client/data:/data/psobb-client:ro \
  psobb-web
```

Then open `http://localhost:8080/`.

## Locally without Docker

`node bridge/server.mjs` serves a `client/dist` build (`cd client && npm run
build`) against a newserv started from `vendor/newserv`, with the same
endpoints; `PSOBB_DATA` points it at a data folder.
