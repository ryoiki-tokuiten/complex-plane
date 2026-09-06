The domain reference engine links FLINT 3.3.1 (including Arb), licensed under
LGPL-3.0-or-later. Source: https://github.com/flintlib/flint/releases/tag/v3.3.1

The repository's `scripts/ensure-wasm.mjs` downloads the pinned source with a
SHA-256 check and builds the static library. It also supplies the complete
application WASM build command so the combined module can be rebuilt/relinked
with modified library sources. FLINT's license texts are included alongside
this notice. GMP and MPFR continue to use the pinned sources in that script.
