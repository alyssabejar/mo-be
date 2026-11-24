#!/usr/bin/env bash
# Copy the shared Zod contracts from a mo-ui checkout into this repo.
# mo-ui owns packages/contracts; run this after changing them there.
set -euo pipefail
UI="${1:-../mo-ui}"
SRC="$UI/packages/contracts/src"
[ -d "$SRC" ] || { echo "No contracts at $SRC (pass the mo-ui path as the first argument)"; exit 1; }
rsync -a --delete "$SRC/" packages/contracts/src/
echo "Synced contracts from $SRC"
git diff --stat -- packages/contracts || true
