# Legal notes

- **Phantasy Star Online** and all game assets (models, textures, sounds, text, executables) are owned by SEGA. This repository **does not contain or distribute** any of them. `.gitignore` blocks the client file extensions (`.gsl`, `.afs`, `.xvm`, `.nj`, `.xj`, `.rel`, `.prs`, `.exe`).
- The project page (`site/`, published with GitHub Pages) shows screenshots of this client running with a user's own game files, for illustration. They are not game files and are not usable as game data.
- The favicon (`client/public/favicon.ico`, `site/favicon.ico`) is the application icon of `PsoBB.exe` (32x32), extracted with `tools/exeicon.py`. It is the only SEGA asset committed here, used as the site's icon.
- The web client reads files from the **user's own installation**, locally in the browser.
- Code ported from **newserv** is under the MIT license, and each file states its origin.
- The decompilations are used as **behavioral references** for interoperability. No pseudo-code or binaries from them are copied here.
- **Do not expose newserv or the bridge to the internet without a security review:**
  - newserv's HTTP API has `POST /y/shell-exec`.
  - The bridge relies on its port allowlist.
  - The local setup binds newserv's game ports on all interfaces, so use a firewall on untrusted networks.
