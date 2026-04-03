#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

rm -f ./*.xpi

name="$(basename "$(pwd)")"
zip -r "${name}.xpi" . \
  -x "*.git*" \
  -x "*.DS_Store" \
  -x "__MACOSX/*" \
  -x "node_modules/*" \
  -x ".qodo/*"

echo "Built: ${name}.xpi"
