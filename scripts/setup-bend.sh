#!/usr/bin/env bash
# Sets up the Bend 2 toolchain required by this repo. Idempotent. Run from repo root.
# The agent/dev MUST get this passing before running dev/build/test/verify:bend.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.bend/bin:$PATH"

# 1. Install bend via the official installer if missing or broken (e.g. stale symlink)
if ! command -v bend >/dev/null 2>&1 || ! bend version >/dev/null 2>&1; then
  rm -f "$HOME/.bend/bin/bend"
  curl -fsSL https://bend-lang.com/install.sh | sh
  export PATH="$HOME/.bend/bin:$PATH"
fi
if [ -x "$HOME/.bend/bin/bend" ] && [ -w /usr/local/bin ]; then
  ln -sf "$HOME/.bend/bin/bend" /usr/local/bin/bend
fi
echo "$(bend version)"

# 2. Prove it works: all laws must check
bend public/bend_complex_plane/PROOF.bend | tail -3
echo "Bend OK. Now: npm install && npm run verify:bend && npm test"
