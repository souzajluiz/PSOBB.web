#!/usr/bin/env bash
# Clones and builds newserv (plus phosg and resource_dasm) into vendor/.
# macOS: needs Homebrew. Linux: install cmake + libasio-dev first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
PREFIX="$VENDOR/_install"
mkdir -p "$VENDOR"
cd "$VENDOR"

if [[ "$(uname)" == "Darwin" ]]; then
  brew install cmake asio libiconv
fi

for repo in phosg resource_dasm newserv; do
  [[ -d "$repo" ]] || git clone --depth 1 "https://github.com/fuzziqersoftware/$repo.git"
done

for repo in phosg resource_dasm; do
  cmake -S "$repo" -B "$repo/build" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX"
  cmake --build "$repo/build" -j8
  cmake --install "$repo/build"
done

cmake -S newserv -B newserv/build -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$PREFIX;/opt/homebrew" -DCMAKE_INCLUDE_PATH=/opt/homebrew/include
cmake --build newserv/build -j8

# Local-only config: loopback addresses, no DNS server, no IP/PPP stack.
CONFIG="newserv/system/config.json"
if [[ ! -f "$CONFIG" ]]; then
  sed -e 's/"LocalAddress": "en0"/"LocalAddress": "127.0.0.1"/' \
      -e 's/"ExternalAddress": "10.0.1.5"/"ExternalAddress": "127.0.0.1"/' \
      -e 's/"DNSServerPort": 53/"DNSServerPort": 0/' \
      -e 's/"IPStackListen": \[5059\]/"IPStackListen": []/' \
      -e 's/"PPPStackListen": \[5058\]/"PPPStackListen": []/' \
      newserv/system/config.example.json > "$CONFIG"
fi
echo "newserv built: $VENDOR/newserv/build/newserv (run it from $VENDOR/newserv)"
