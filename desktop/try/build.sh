#!/bin/bash
# Inside the builder (builder.Dockerfile), in a copy of the checkout: what `npm run desktop:pack` does, with the
# release's own smoke run between staging and packaging. Dependencies are installed again only when a lockfile changed.
set -euo pipefail
installed() {
	local sum
	sum=$(sha256sum "$1/package-lock.json" | cut -d' ' -f1)
	if [ "$(cat "$1/node_modules/.lock-sha256" 2>/dev/null)" != "$sum" ]; then
		npm --prefix "$1" ci --no-audit --no-fund
		echo "$sum" >"$1/node_modules/.lock-sha256"
	fi
}
installed .
npm run build
node scripts/stage.ts
node scripts/smoke-release.ts
installed desktop
npm --prefix desktop run dist
