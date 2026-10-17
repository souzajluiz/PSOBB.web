#!/bin/sh
# Looks things up in the original-psobb-client-source reference repository
# (gitlab.psobb.io/psobb/original-psobb-client-source): a Ghidra dump of
# PsoBB.exe whose functions carry community-curated names with the address as a
# suffix (InitializeItemBML_005d7ccc), plus headers/ and notes/.
#
# This is the first place to look for any value, layout or rule that must come
# from the client; running Ghidra headless (tools/ghidra/run_any.sh) is the
# fallback for what the dump does not name or resolve.
#
# The repository is not part of this one. Clone it anywhere and point REFSRC at
# it (default: ../refsrc/original-psobb-client-source):
#   git clone --depth 1 https://gitlab.psobb.io/psobb/original-psobb-client-source.git
#
# Usage:
#   tools/refsrc.sh addr 005d7ccc      the function at that address, with its body
#   tools/refsrc.sh name ItemBML       every declaration whose name matches
#   tools/refsrc.sh grep "6x5F"        every hit in headers/ and notes/
#   tools/refsrc.sh body FunctionName  one function body by name
#   tools/refsrc.sh files              what the repository holds

set -e
REFSRC=${REFSRC:-$(cd "$(dirname "$0")/../.." && pwd)/refsrc/original-psobb-client-source}
[ -d "$REFSRC" ] || { echo "no reference checkout at $REFSRC (set REFSRC)" >&2; exit 1; }
# src/ holds a few dated dumps of the same binary; the largest is the one with
# the most functions named. Override with REFSRC_DUMP.
DUMP=${REFSRC_DUMP:-$(ls -S "$REFSRC"/src/*.c 2>/dev/null | head -1)}
[ -n "$DUMP" ] || { echo "no src/*.c dump in $REFSRC" >&2; exit 1; }

cmd=${1:-files}
arg=$2

# Prints the function body that starts at line $1.
body() {
  awk -v start="$1" 'NR >= start { print NR "\t" $0; if (NR > start && $0 == "}") exit }' "$DUMP"
}

case "$cmd" in
  addr)
    a=$(printf '%s' "$arg" | sed 's/^0x//' | tr 'A-Z' 'a-z')
    echo "# $DUMP"
    grep -n "_$a\b" "$DUMP" | head -20
    line=$(grep -n "^[A-Za-z_].*_$a(" "$DUMP" | head -1 | cut -d: -f1)
    [ -n "$line" ] && { echo; body "$line"; }
    ;;
  name)
    grep -n "^[A-Za-z_].*$arg[A-Za-z0-9_]*_[0-9a-f]\{8\}(" "$DUMP" | head -40
    ;;
  body)
    line=$(grep -n "^[A-Za-z_].*[ \*]$arg(" "$DUMP" | head -1 | cut -d: -f1)
    [ -n "$line" ] || { echo "no definition of $arg" >&2; exit 1; }
    body "$line"
    ;;
  grep)
    grep -rn "$arg" "$REFSRC/headers" "$REFSRC/notes" | head -40
    ;;
  files)
    echo "$REFSRC"
    ls "$REFSRC/headers" "$REFSRC/notes"
    echo "dump: $DUMP"
    ;;
  *)
    sed -n '20,26p' "$0"
    exit 1
    ;;
esac
