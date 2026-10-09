#!/usr/bin/env bash
# Builds a self-contained release archive for the cPanel Node.js app (run in CI after `npm ci`).
#
#   release/
#     server.js, .next/, node_modules/   Next.js standalone server (traced runtime dependencies only)
#     public/, .next/static/              static assets
#     server/auth/common-passwords.txt.gz password validator list (read from the working directory)
#     server/db/migrations/*.sql          schema migrations
#     tools/migrate.mjs                   bundled migration runner
#     tools/manage.mjs                    bundled management commands (cron jobs, seeds)
#     deploy/cpanel/                      server-side deployment script and startup file
#     RELEASE                             commit SHA
set -Eeuo pipefail

sha="${1:?Supply the commit SHA}"
out="${2:?Supply the output archive path}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npx next build

release="$(mktemp -d)/release"
mkdir -p "$release/tools" "$release/server/auth" "$release/server/db" "$release/deploy"
cp -a .next/standalone/. "$release/"
mkdir -p "$release/.next"
cp -a .next/static "$release/.next/static"
cp -a public "$release/public"
cp server/auth/common-passwords.txt.gz "$release/server/auth/"
cp -a server/db/migrations "$release/server/db/migrations"
cp -a deploy/cpanel "$release/deploy/cpanel"

# Management commands and the migration runner run outside Next.js (cron, deployment), so they are bundled with
# their dependencies. `react-server` resolves the `server-only` guard to its no-op entry, as under Next.js.
bundle=(--bundle --platform=node --format=esm --target=node20 --conditions=react-server --external:pg-native --log-level=warning
  "--banner:js=import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);")
npx esbuild server/commands/manage.ts "${bundle[@]}" --outfile="$release/tools/manage.mjs"
npx esbuild scripts/migrate.mjs "${bundle[@]}" --outfile="$release/tools/migrate.mjs"

printf '%s\n' "$sha" > "$release/RELEASE"
tar -czf "$out" -C "$(dirname "$release")" release
echo "Release $sha packaged at $out ($(du -h "$out" | cut -f1))."
