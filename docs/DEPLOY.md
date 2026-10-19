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
   - **Or download it at start:** set `PSOBB_DATA_URL` (below) to a `.zip` of
     the `data/` folder and mount a **Volume** at `/data/psobb-client`, so it
     is downloaded once and kept across redeploys.
4. **Deploy.** The first build compiles newserv and takes a few minutes. The
   container is healthy once `GET /` answers.

## What the image serves

Production serves only the classic client: `/` opens `classic.html` (the
original-style screens, from the title to the field). The development pages
(`index.html` with its protocol log and map viewer, `models.html`) are not
built into the image, and `bridge/server.mjs` answers 404 for any other
`.html`. To build every page anyway (local checks), set `PSOBB_DEV_PAGES=1`
for `npm run build`.

## newserv comes from its official image

Nothing is compiled during the build. The `Dockerfile` copies newserv from
fuzziqersoftware's public image `ghcr.io/fuzziqersoftware/newserv`, pinned to
the tag `sha-ce2273a` (the commit this project is tested with; the image has
linux/amd64 and arm64 builds, so the platform is picked automatically). It
takes the binary (`/usr/local/bin/newserv`) and the data (`/newserv/system`,
which holds the BB keys, text and maps) and writes the loopback-only config
from `config.example.json`. The build only runs the Vite build of the client
and installs the relay's dependencies, so it takes a minute or two and little
memory.

To use another newserv, set the build argument `NEWSERV_IMAGE` to another image
or tag with the same layout (for example another `sha-<commit>`); anything
newer than the pinned commit must be tested with this client first.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port of `bridge/server.mjs` |
| `PSOBB_DATA` | `/data/psobb-client` | client data served at `/psobb-data/`, if the folder exists |
| `PSOBB_DATA_URL` | (unset) | a Google Drive share link (or file id, or any direct URL) of one `.zip` / `.tar.gz` of the `data/` folder; downloaded into `PSOBB_DATA` at start |
| `TARGET_HOST` | `127.0.0.1` | where the relay finds newserv |
| `ALLOWED_PORTS` | `12000`..`12008` | newserv ports the relay may open |

## Client data from Google Drive

1. Zip the PSOBB `data/` folder into one file (`data.zip`; the files may be at
   the root or inside a single `data/` folder, which is unpacked in place).
2. Upload it to Google Drive and share it as **anyone with the link**; copy the
   link (or just its file id).
3. In Dokploy, set `PSOBB_DATA_URL` to that link and mount a volume at
   `/data/psobb-client`.

`docker/fetch-data.mjs` runs in the background at container start: the site is
up at once and `/psobb-data/` fills in when the download ends (the log shows
`[fetch-data]` lines). It handles Drive's large-file confirmation page, unpacks
the zip, drops macOS `__MACOSX` folders and a single top-level folder, and
writes `.fetched-from` with the URL, so a restart or redeploy with the same
URL downloads nothing and a new URL replaces the folder. A failure (link not
shared, quota exceeded, not a zip) is logged and the page falls back to asking
each player for a `data/` folder. Google may throttle many downloads of one
file for a day; a private object storage bucket is steadier if that happens.

`/psobb-data/` is public on the deployed site: anyone who knows the address can
read these files. Only serve data you have the right to serve (docs/LEGAL.md).

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
