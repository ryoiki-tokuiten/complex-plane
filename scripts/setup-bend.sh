#!/usr/bin/env bash
# Sets up the Bend 2 toolchain required by this repo. Idempotent. Run from repo root.
# The agent/dev MUST get this passing before running dev/build/test/verify:bend.
set -euo pipefail
BEND_VERSION="2.0.39"
cd "$(dirname "$0")/.."

# 1. bun (runs public/bend/bend2/main.ts)
command -v bun >/dev/null 2>&1 || { curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"; }
echo "bun $(bun --version)"

# 2. Bend runtime sources -> public/bend/bend2 (+ LICENSE)
if [ ! -f public/bend/bend2/main.ts ]; then
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/bendlang/bend.git "$tmp/bend"
  mkdir -p public/bend
  cp -r "$tmp/bend/bend2" public/bend/
  rm -rf public/bend/bend2/docs public/bend/bend2/bendtt.lean   # not needed to check proofs
  cp "$tmp/bend/LICENSE" public/bend/
  rm -rf "$tmp"
fi
grep -q "VERSION = \"$BEND_VERSION\"" public/bend/bend2/main.ts \
  || echo "WARNING: Bend version differs from $BEND_VERSION; proofs were checked on $BEND_VERSION"

# 3. Prove it works: all 65 laws must check
bun public/bend/bend2/main.ts public/bend_complex_plane/PROOF.bend | tail -3
echo "Bend OK. Now: npm install && npm run verify:bend && npm test"
