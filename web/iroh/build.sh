#!/bin/sh
# Build the browser's Iroh endpoint (web/iroh) to WebAssembly and its bindings into web/iroh/pkg, which is committed:
# the app's builds and Vercel need no Rust. Run it after any change here; test/iroh-web.test.ts fails while pkg/ is
# older than its source (pkg/SOURCE is the hash it was built from).
# Needs: rustup's wasm32-unknown-unknown target, a clang that targets wasm32 (ring's C; Apple's does not: Homebrew's
# llvm does), and wasm-bindgen-cli at the version Cargo.lock names:
#   cargo install wasm-bindgen-cli --version 0.2.130 --locked --root web/iroh/target/tools
set -eu
cd "$(dirname "$0")"
LLVM="${LLVM:-/opt/homebrew/opt/llvm/bin}"
export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-$LLVM/clang}"
export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-$LLVM/llvm-ar}"
PATH="$PWD/target/tools/bin:$PATH"
cargo build --release --locked
rm -rf pkg
wasm-bindgen target/wasm32-unknown-unknown/release/banda_iroh_web.wasm --out-dir pkg --target web --weak-refs
if command -v wasm-opt >/dev/null; then
	wasm-opt --enable-nontrapping-float-to-int --enable-bulk-memory -Os -o pkg/banda_iroh_web_bg.wasm pkg/banda_iroh_web_bg.wasm
fi
node ../../scripts/iroh-web-source.ts > pkg/SOURCE
ls -l pkg
