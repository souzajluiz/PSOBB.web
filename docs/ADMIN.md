# Admin panel

A web panel to manage the server: accounts and logins, characters, connected
players, quests, teams, a few config settings and an audit log. It is served by
`bridge/server.mjs` at `/admin` (module `bridge/admin.mjs`, page in
`bridge/admin-ui/`, plain JavaScript, no framework, no external resources). The
classic client is untouched and `/` still serves only `classic.html`; the
quest editor page is served next to it (see Quest editor: open and publish).

The panel is **off** unless `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` is set:
without one, `/admin` answers 404 and no admin code path runs.

## How it works

newserv has its own admin surface and the panel is a thin, authenticated layer
over it (read from `vendor/newserv/src/HTTPServer.cc` and `ShellCommands.cc`):

- **HTTP API** (`HTTPListen` in newserv's `config.json`): read-only JSON routes
  `/y/summary`, `/y/clients`, `/y/lobbies`, `/y/accounts`, `/y/teams`,
  `/y/config`, `/y/server`, `/y/data/...`, and `POST /y/shell-exec`, which runs
  a shell command.
- **Shell commands** (`list-accounts`, `add-account`, `update-account`,
  `delete-account`, `add-license`, `delete-license`, `kick`, `announce`,
  `reload`, ...). Every change newserv has a command for goes through
  `shell-exec`.
- **Files**, only where newserv has no command: character files (`.psochar`),
  bank files (`.psobank`) and a short list of `config.json` keys.

The browser only talks to the panel; the panel talks to newserv on
`127.0.0.1`. The panel never forwards a request as is: each action builds its
newserv call from validated parts (see Security).

## Setup

1. **Let newserv listen for HTTP on loopback.** In newserv's `config.json`:

   ```json
   "HTTPListen": ["127.0.0.1:5080"],
   ```

   A bare number (`5080`) makes newserv listen on **all interfaces**; always
   write the address. The Docker image and `scripts/setup-newserv.sh` already
   set this. newserv's HTTP API has no authentication and a shell
   (`POST /y/shell-exec`): its port must never be published or proxied. The
   panel refuses to start if `NEWSERV_HTTP` is not a loopback address or its
   port is in `ALLOWED_PORTS` (the public WebSocket relay).
2. **Set a password** (environment of the web process):
   - `ADMIN_PASSWORD`: simplest; use a long random one (12+ characters; a
     shorter one logs a warning).
   - or `ADMIN_PASSWORD_HASH`: an scrypt hash, so the secret is not in the
     environment in clear text:
     `printf '%s' 'a long password' | node bridge/admin-hash.mjs`
3. **Serve it over HTTPS.** The login refuses plain HTTP unless the host is
   `localhost` / `127.x`. Behind a TLS proxy (Traefik in Dokploy) also set
   `ADMIN_TRUST_PROXY=1` so the panel trusts `X-Forwarded-Proto` / `-For`
   (set it only when the proxy overwrites those headers and nothing else can
   reach port 8080). Without it, every visitor looks like the proxy: the
   login lockout then applies to everybody at once.
4. Open `https://your-host/admin`.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | (unset: panel off) | the admin password (clear / scrypt) |
| `ADMIN_USER` | `admin` | the login name |
| `NEWSERV_HTTP` | `127.0.0.1:5080` | where newserv's HTTP API is (loopback only) |
| `ADMIN_TRUST_PROXY` | off | `1`: trust `X-Forwarded-Proto` and the last `X-Forwarded-For` entry |
| `ADMIN_REQUIRE_HTTPS` | on | `0` allows the login over plain HTTP on a public host (do not) |
| `ADMIN_COOKIE_SECURE` | off | `1`: always set the `Secure` flag |
| `ADMIN_ALLOWED_ORIGINS` | the request's own host | comma list of allowed `Origin` values for POSTs |
| `ADMIN_ALLOWED_HOSTS` | any | comma list of `Host` values the panel answers to (others get 404) |
| `ADMIN_AUDIT_LOG` | `<system>/../admin-audit.log` (`/data/newserv/admin-audit.log` in Docker) | audit log file |
| `ADMIN_CONFIG_MIRROR` | (unset; `/data/newserv/config.json` in Docker) | copy of `config.json` written after a panel edit; the entrypoint puts it back at start, so edits survive a redeploy |
| `NEWSERV_SYSTEM` | as `server.mjs` | newserv's `system/` folder (characters, `config.json`, `quests`) |
| `ADMIN_QUEST_BACKUP` | `<system>/../quest-backups` (`/data/newserv/quest-backups` in Docker) | where the previous version of a published quest file is copied (outside `system/quests`) |
| `ADMIN_QUESTS_MIRROR` | (unset; `/data/newserv/quests-published` in Docker) | copy of every published quest file; the entrypoint copies it back over `system/quests` at start, so published quests survive a redeploy |
| `ADMIN_FORMATS_DIR` | `<repo>/client/src/formats` (`/app/client/src/formats` in Docker) | the client's quest parsers, used to validate uploads |

## Security model

- **Authentication.** One admin login. The password is compared in constant
  time (HMAC of both sides with a random key, or scrypt with `timingSafeEqual`).
  Failed logins: 5 per IP in 15 minutes lock that IP for 15 minutes (the right
  password is refused while locked, with `Retry-After`); 50 failures overall in
  15 minutes lock every IP for 5 minutes. Every attempt is in the audit log.
- **Session.** A random 256-bit id in the cookie `psobb_admin`: `HttpOnly`,
  `SameSite=Strict`, `Path=/admin`, `Secure` behind HTTPS. Sessions expire
  after 30 minutes idle and 8 hours in total, at most 20 live; logout deletes
  the session on the server.
- **CSRF.** Every POST needs the per-session `X-CSRF-Token` header (a custom
  header a cross-site form cannot set), a same-origin `Origin` header (a
  missing, `null` or foreign one is refused) and no cross-site `Sec-Fetch-Site`.
  The login POST has the Origin check too. Bodies must be `application/json`,
  at most 64 KB.
- **No CORS.** `bridge/server.mjs` sends `Access-Control-Allow-Origin: *` for
  its public files (the native app needs it); the admin routes are dispatched
  before that and never send any CORS header. Preflights get 405. Pages and
  answers carry a strict CSP (`default-src 'none'`, scripts and styles from
  self only), `X-Frame-Options: DENY`, `nosniff`, `no-store`, and
  `Cross-Origin-Resource-Policy: same-origin`.
- **Input validation.** newserv's shell takes one text line. Nothing from the
  browser is pasted into it: usernames, passwords, ids, flags, durations,
  reload items and config keys are checked against allow-lists or regexes, and
  every command line must be printable ASCII on one line without quotes, `` ` ``,
  backslash, `;`, `|`, `&`, `<` or `>`. Passwords: 1-16 of
  `A-Z a-z 0-9 ! @ # % ^ * ( ) _ + = . , : ? ~ / [ ] { } -` (no spaces).
  Announcements are 1-200 printable ASCII characters with the same exclusions.
  File names for characters are built only from `player_<user>_<0-15>` with a
  checked username (`[A-Za-z0-9_][A-Za-z0-9_.-]{0,15}`), and re-checked to stay
  inside `system/players`. Config values are typed and range-checked.
- **Confirmation.** Delete account, ban, change flags, kick, edit character,
  edit bank and change config need an explicit confirmation: the UI asks you to
  type the account id (or key / target), and **the server enforces it** (the
  request must carry `confirm` equal to that value, otherwise 409).
- **Audit log.** Every login, denied login, logout and state-changing action
  is appended (who = session prefix and IP, when, action, details, result) to a
  JSON-lines file (mode 0600, rotated at 5 MB) and shown in the Audit tab.
  Passwords are never written there, never returned by the API (newserv's
  account JSON includes them; the panel strips `Password` / `AccessKey` from
  everything it passes on) and never shown. Read-only requests are not logged.
- **XSS.** The page builds all text with `textContent`; player names and other
  server data are never inserted as HTML, and the CSP forbids inline script.
- **Secrets** come from the environment only. Nothing secret is in the repo.
- **Limits you should know.** The panel is a single admin account behind one
  password, so keep it long. The lockout is in memory (a restart resets it).
  Credentials are stored by newserv in clear text (its design); the panel
  cannot change that.

## Languages

The panel is available in English (the source language), Brazilian Portuguese
(`pt-BR`) and Latin-American Spanish (`es`). A language `<select>` sits in the
top bar and on the login card. The choice is kept in `localStorage`
(`psobb-admin-lang`); without one the browser language is used (`pt*` ->
pt-BR, `es*` -> es, anything else English). `<html lang>` follows the choice,
and changing it re-renders the current tab without ending the session (an open
dialog or an unsaved edit in the form is lost).

How it works: `bridge/admin-ui/i18n.js` (served as `/admin/static/i18n.js`)
looks up the exact English source string in a dictionary (`DICT`) and then in
a list of regex patterns (`PATTERNS`, for text with numbers or names such as
`Quests (12)` and for the error messages `bridge/admin.mjs` returns, which stay
English on the wire). `admin.js` keeps its English literals; `tr()` is called
only in the `h()` DOM helper (text nodes and `placeholder` / `title` /
`aria-label` / `alt`), so toasts, dialogs and table empty text are covered, and
for `document.title`. A string with no entry is shown in English. To translate
new text, add a row to `DICT` (`[english, pt-BR, es]`) or a pattern.

Never translated: the text to type in a confirmation (account id, config key),
anything inside an element with class `mono`, account / file / quest names,
config keys, class / section id / technique names (they come from newserv),
and the audit log entries (a record, written by the server in English).

## Tabs

| Tab | What it does | newserv route / command |
| --- | --- | --- |
| Dashboard | server name, uptime, players, games, lobbies, account counts, connected players | `GET /y/summary`, `GET /y/accounts` |
| Accounts | list; create (BB username + password + flags); edit flags; change password; ban (30m ... permanent) / unban; delete; kick | `GET /y/accounts`, `GET /y/clients`; `add-account flags=HEX`, `add-license ID BB USER PASS`, `update-account ID flags=HEX`, `update-account ID ban-duration=Nd` / `unban`, `delete-license` + `add-license` (no change-password command exists), `delete-account ID`, `kick 0xID` |
| Characters | per account and slot: name, class, section id, level, EXP, meseta, 7 stats, 19 technique levels, inventory (add / remove / see equipped), bank and shared bank (meseta, add / remove items) | files: `system/players/player_<user>_<n>.psochar`, `.psobank`, `shared_bank_<user>.psobank` (online accounts refused: `GET /y/clients`) |
| Online | players with account, class, lobby, address; kick; announcement to everyone; games | `GET /y/summary`, `GET /y/clients`, `GET /y/client/:id`, `kick`, `announce` |
| Quests | quests by category, category listed / hidden, enabled expression, versions; **Open in editor** per quest, **New quest**; reload | `GET /y/data/quests`, `reload quests`; files: `GET /quests/files`, `GET /quests/file/<folder>/<name>`, `POST /quests/publish` (see Quest editor) |
| Teams | list (read-only); reload | `GET /y/teams`, `reload teams` |
| Data | read-only drop tables, shop tables, level / mag tables, stack limits; reload tables | `GET /y/data/...`, `reload drop-tables level-tables item-definitions` |
| Config | view the effective config; change a few keys | `GET /y/config`, edit of `config.json` + `reload config` |
| Audit log | the last actions | the audit file |

Editable config keys: `ServerName`, `WelcomeMessage`, `AllowUnregisteredUsers`
(true lets anyone create an account by logging in), `AllowSameAccountConcurrentLogins`,
`EnableChatCommands`, `CheatModeBehavior`, `EnableSwitchAssistByDefault`,
`UseGameCreatorSectionID`, `NotifyServerForMaxLevelAchieved`,
`BBGlobalEXPMultiplier` (0-100), `BBEXPShareMultiplier` (0-10) and
`ServerGlobalDropRateMultiplier` (0-100). Each is a single-line value of
`config.json`; the panel replaces the value in place (comments stay), keeps a
`.admin-backup`, runs `reload config` and restores the file if the reload
fails. Ports, addresses, `HTTPListen` and the long lists are not editable.

### Character and bank editing

newserv has no command that changes a character, so the panel edits the files
(format in `src/SaveFileFormats.hh`: header `0x399C` / `0x00E7`, then the
inventory at `+0x0`, the player stats at `+0x34C`, the bank at `+0x6F8`). Rules:

- only while the account is **offline** (`GET /y/clients` is checked; if it
  fails the edit is refused). newserv reads the file at the next login;
- a **backup copy** goes to `system/players/_admin-backups/` before each write
  (the newest 30 per file are kept); writes are atomic (temp file + rename);
- values are range-checked (level 1-200, meseta 0-999999, stats 0-9999,
  technique levels 1-30, section 0-9, class 0-11, 30 inventory / 200 bank
  slots); item data is 12 + 4 hex bytes and is not checked against the item
  tables, so wrong data can make a client reject the character;
- stats are **not** recomputed from the level: edit them together;
- the bank is written to the `.psobank` file, which newserv prefers over the
  bank inside the `.psochar` (`Client::bank_file`);
- the technique levels above 15 use the extension byte of the matching
  inventory slot; removing an inventory item never moves those bytes.

`tests/admin.live.ts` proves this against a real newserv: the edited
character is read back by a real BB login (level, EXP, meseta, stats and
technique level).

## Quest editor: open and publish

The Quests tab has **Open in editor** on every quest that has Blue Burst files
(`q058-bb-e.bin` + `q058-bb.dat`, or a `.qst`, found by the quest number in
the file name) and a **New quest (editor)** link. They open
`/questeditor.html` in a new tab (`?qst=<url>&dat=<url>`), which fetches the
files from the panel with the admin cookie (same origin; the cookie's
`Path=/admin` is sent to `/admin/api/...`). The editor itself is a static
page, served publicly by `bridge/server.mjs` next to `/` (no secrets in it, it
edits files in the browser); only its **Publish to server** button needs the
admin session, and the button shows only when `/admin/api/session` says there
is one.

Routes (all behind the session; no CORS):

| Route | What it does |
| --- | --- |
| `GET /api/quests/files` | per existing category folder of `system/quests`, the `.bin` / `.dat` / `.qst` files (name, size). Symlinks and odd names are left out |
| `GET /api/quests/file/<folder>/<name>` | the bytes of one such file (at most 8 MB), `application/octet-stream`, `nosniff`, attachment |
| `POST /api/quests/publish` | `{ category, name, bin, dat }` or `{ category, name, qst }` (base64), plus `confirm`. See below |

Publishing, in order:

1. The usual POST rules (session, `X-CSRF-Token`, same-origin `Origin`, JSON).
   The body may be up to 6 MB (each file at most 2 MB decoded).
2. `category` must be the name of an **existing** directory directly under
   `system/quests` (`[A-Za-z0-9_-]{1,48}`, not a symlink; never created).
   `name` must match `^[A-Za-z0-9_.-]{1,64}$`, not start with `.` or contain
   `..`, end in `.bin` or `.qst`, and carry the Blue Burst tag newserv reads
   (`q9001-bb-e.bin`, `q9001-bb.qst`). For a `.bin` the server names the `.dat`
   itself (`q9001-bb.dat`), so the pair always matches. A name for another
   version (`-gc`, `-dc`) is refused: the panel cannot overwrite those.
3. `confirm` must equal `<category>/<name>` (409 otherwise, like the other
   destructive actions; the editor asks you to type it).
4. The bytes are validated before anything is written: base64 check, size
   limit, PRS decompression with a 4 MB output cap (a PRS stream can expand
   about 100x), then the client's own parsers (`parseQuestBin`, `parseQuestDat`,
   `parseQst`, loaded from `client/src/formats` through Node's type stripping):
   a Blue Burst `.bin` with the full header, a header size that fits the file,
   a `.dat` that parses, and a write-and-parse round trip. Failure is 422 and is
   audit-logged as `denied`.
5. Existing files are copied to the backup folder (outside `system/quests`;
   newest 30 per file kept), the new files are written to `<name>.admin-tmp`
   and renamed into place. The resolved path is checked to be a direct child of
   the real category folder, and an existing symlink at the target is refused.
6. `reload quests` goes through the shell proxy. If it fails, the previous
   files are put back (new ones removed) and the error is returned.
7. The audit log gets `quest.publish` with the target, file names and sizes,
   quest number and name. File contents are never logged.

What it does not do: delete quests, edit the quest's `.json` (category flags,
enabled expressions) or write other game versions. Quests already loaded by
players in a game are not changed; the menu shows the new version after the
reload. The quest number newserv shows is the one in the file name
(`q9001`), not the header's.

## What newserv cannot manage (so the panel does not)

- **Characters** online (no command), character creation / deletion, names,
  appearance, materials, quest progress; item names for offline characters.
- **Per-player messages** (only `announce` to everyone; `chat` / `warp` /
  `create-item` work on proxy sessions only).
- **Teams** (no team commands: read-only).
- **Quests**: no enable / disable switch; they are files under
  `system/quests` (and a quest is shown by its category flags and its
  `EnabledExpression` in the quest's `.json`). The panel can publish a Blue
  Burst quest from the editor (above); removing one, or changing its flags,
  is still done on the server, then reload.
- **Drop and item tables** and shops: files (`system/tables`);
  the panel only reads them and reloads. EXP and drop-rate multipliers are
  in Config.
- **IP bans** (`BannedIPV4Ranges` is a config list; edit `config.json` by hand).
- Licenses of other platforms (DC / PC / GC / XB) are counted, not edited;
  the panel manages BB licenses.
- Ep3 tournaments (`create-tournament` ...) are not in the panel.

## Tests

`node tests/admin.test.ts` starts the module against a fake newserv and checks
authentication, lockout, session expiry, CSRF, the absence of CORS, input
validation, the mapping to newserv routes / commands, the audit log,
character / bank / config editing, and the quest routes (listing, reading,
publishing: bad names and categories, path traversal, symlinks, oversize,
PRS bomb, invalid quests, CSRF, confirmation, backup, rollback, mirror). `node tests/admin.live.ts` runs everything
validation, the mapping to newserv routes / commands, the audit log, and
character / bank / config editing. `node tests/admin.i18n.test.ts` checks the
translation dictionary (no empty or placeholder-breaking entry, pattern samples,
English fallback, language detection) and prints a report of English literals in
`admin.js` / `admin.mjs` that have no entry. `node tests/admin.live.ts` runs everything
against a real `vendor/newserv/build/newserv` started on random loopback ports
in a temporary copy of its system folder (it never touches `system/players`).
