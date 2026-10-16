#!/usr/bin/env bash
# Compares a render of the classic UI with a capture of the original client.
# Usage: tools/compare.sh <ours.png> <reference.png> <out-prefix> [crop w:h:x:y in 1440x900 space]
# Writes <out-prefix>_diff.png (amplified absolute difference) and
# <out-prefix>_side.png (ours | reference), and prints SSIM / PSNR.
set -euo pipefail
ours=$1 ref=$2 out=$3 crop=${4:-}
scale="scale=1440:900:flags=area"
[[ -n $crop ]] && scale="$scale,crop=$crop"
ffmpeg -v error -y -i "$ours" -i "$ref" -lavfi "[0]$scale,format=rgb24[a];[1]$scale,format=rgb24[b];[a][b]blend=all_mode=difference,curves=all='0/0 0.25/1 1/1'" "${out}_diff.png"
ffmpeg -v error -y -i "$ours" -i "$ref" -lavfi "[0]$scale[a];[1]$scale[b];[a][b]hstack" "${out}_side.png"
ffmpeg -v info -i "$ours" -i "$ref" -lavfi "[0]$scale,format=gray[a];[1]$scale,format=gray[b];[a][b]ssim" -f null - 2>&1 | grep -o 'All:[0-9.]*' | sed 's/^/SSIM /'
ffmpeg -v info -i "$ours" -i "$ref" -lavfi "[0]$scale[a];[1]$scale[b];[a][b]psnr" -f null - 2>&1 | grep -o 'average:[0-9.inf]*' | sed 's/^/PSNR /'
