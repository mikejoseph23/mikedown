#!/usr/bin/env bash
# Publish @mikedown/core, or pack it when npm is not logged in.
# Run this BEFORE `npm run vsix` is shipped (see CLAUDE.md, Releasing).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./packages/core/package.json').version")
SHARE="/Volumes/Storage/LymeStack/packages/npm"
FALLBACK=".orchestrator/angular-core-extraction-plan/artifacts"

TAG_ARGS=()
if [[ "$VERSION" == *-* ]]; then
  TAG_ARGS=(--tag rc)
fi

npm run build:core

if npm whoami >/dev/null 2>&1; then
  echo "npm user: $(npm whoami). Publishing @mikedown/core@$VERSION ${TAG_ARGS[*]:-}"
  npm publish -w packages/core --access public "${TAG_ARGS[@]}"
  echo "Done: published @mikedown/core@$VERSION."
  exit 0
fi

echo "npm whoami failed (not logged in). Packing instead of publishing."
PACK_DIR=$(mktemp -d)
npm pack -w packages/core --pack-destination "$PACK_DIR" >/dev/null
TARBALL=$(ls "$PACK_DIR"/*.tgz)
NAME=$(basename "$TARBALL")

if [[ -d "$SHARE" && -w "$SHARE" ]]; then
  DEST="$SHARE"
else
  DEST="$FALLBACK"
  mkdir -p "$DEST"
  echo "Share $SHARE is not writable. Using $DEST."
fi
cp "$TARBALL" "$DEST/$NAME"
rm -rf "$PACK_DIR"
echo "Done: packed $NAME to $DEST/ (not published). Run 'npm login', then 'npm run release:core'."
