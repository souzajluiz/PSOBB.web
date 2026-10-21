#!/bin/sh
# Decompile PsoBB.exe functions with Ghidra headless.
#   tools/ghidra/decomp.sh import          # once: import + full auto-analysis
#   tools/ghidra/decomp.sh 0x0041fa7b ...  # decompile the functions holding these addresses
# The project lives outside the repo (GHIDRA_PROJ, default ../ghidra next to web/)
# and is opened read-only, so several agents can decompile at the same time.
set -e
GHIDRA_INSTALL_DIR=${GHIDRA_INSTALL_DIR:-/Users/junior/Applications/ghidra_12.1.4_PUBLIC}
PSOBB_EXE=${PSOBB_EXE:-/Users/junior/Downloads/psobb-client/PsoBB.exe}
HERE=$(cd "$(dirname "$0")" && pwd)
GHIDRA_PROJ=${GHIDRA_PROJ:-$(cd "$HERE/../../.." && pwd)/ghidra}
HEADLESS="$GHIDRA_INSTALL_DIR/support/analyzeHeadless"
mkdir -p "$GHIDRA_PROJ"

if [ "$1" = "import" ]; then
  exec "$HEADLESS" "$GHIDRA_PROJ" psobb -import "$PSOBB_EXE" -overwrite \
    -analysisTimeoutPerFile 7200
fi

[ $# -gt 0 ] || { echo "usage: $0 import | <address>..." >&2; exit 2; }
"$HEADLESS" "$GHIDRA_PROJ" psobb -process PsoBB.exe -noanalysis -readOnly \
  -scriptPath "$HERE" -postScript Decompile.java "$@" 2>/dev/null |
  awk '/^=== /{on=1} on && !/^(INFO|WARN|ERROR) /{print}'
