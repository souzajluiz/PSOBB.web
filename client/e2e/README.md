# End-to-end tests (Playwright)

They drive the classic client (`classic.html`) in Chrome against a local
newserv. The page is one canvas, so the tests press keys and read the screens
through the development hooks `classic/main.ts` puts on `window`
(`classicTitle`, `classicSelect`, `classicShip`, `classicLobby`).

Before running:

1. newserv: `cd vendor/newserv && ./build/newserv`
2. the bridge: `cd bridge && node bridge.mjs` (ws://127.0.0.1:8080)
3. the client data under `~/Downloads/psobb-client/data` (served at `/psobb-data/`)

Vite is started by the config when it is not already running. Run with Node 24:

```
cd client && npx playwright test
```

The tests log in with the local test account of `tests/login.live.ts`
(`webtest` / `webtest`; override with `PSO_USER` / `PSO_PASSWORD`). They use the
installed Google Chrome (`channel: 'chrome'`), so no browser download is needed.

- `party-create.spec.ts`: counter -> Organize PARTY -> Create a PARTY ->
  EPISODE 1; checks the Play Mode / Difficulty texts at the exe's indices,
  registers a Normal party and expects the client to leave it and show the
  lobby again (there is no classic field scene yet).
