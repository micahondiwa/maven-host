#!/usr/bin/env bash
# Server-side deployment for the cPanel Node.js app, run over SSH by .github/workflows/deploy.yml.
#
#   deploy.sh <sha> <archive> <app-root>
#
# Layout under ~/<app-root> (the cPanel "Application root"):
#   .env                 private environment (mode 600), created once by the owner
#   app.js               Passenger startup file (installed from the release)
#   current -> releases/<sha>
#   releases/<sha>/      unpacked releases; the last three are kept
#   logs/                cron job logs
set -Eeuo pipefail
umask 077

sha="${1:?Supply the commit SHA}"
archive="${2:?Supply the release archive}"
app_name="${3:?Supply the application root name}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
[[ "$app_name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid application root'; exit 1; }
app="$HOME/$app_name"
[[ "$archive" == "$HOME/deploy-incoming/$sha.tar.gz" ]] || { echo 'Invalid archive path'; exit 1; }
test -d "$app" || { echo "Create the Node.js application with application root '$app_name' in cPanel first."; exit 1; }
test -f "$app/.env" || { echo "Create the private environment file $app/.env (mode 600) first."; exit 1; }
chmod 600 "$app/.env"

exec 9>"$HOME/.maven-host-app-deploy.lock"
flock -w 300 9

# Node.js from the app's CloudLinux virtual environment (Setup Node.js App), 20.12 or newer.
node_bin="$(ls -d "$HOME/nodevenv/$app_name"/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
test -x "$node_bin" || { echo "No Node.js environment found under ~/nodevenv/$app_name; select Node.js 22 for the app in cPanel."; exit 1; }
"$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a < 20 || (a === 20 && b < 12)) process.exit(1)' \
  || { echo "Node.js 20.12+ is required (found $("$node_bin" -v)); select Node.js 22 in cPanel."; exit 1; }

releases="$app/releases"
target="$releases/$sha"
mkdir -p "$releases" "$app/logs" "$HOME/deploy-backups"
rm -rf "$target.tmp" && mkdir -p "$target.tmp"
tar -xzf "$archive" -C "$target.tmp" --strip-components=1
[[ "$(cat "$target.tmp/RELEASE")" == "$sha" ]] || { echo 'Archive does not match the commit'; exit 1; }
rm -rf "$target" && mv "$target.tmp" "$target"
chmod -R u+rwX,go+rX "$target"
chmod go-rwx "$target/tools" "$target/server/db"

run() { (cd "$target" && "$node_bin" --env-file="$app/.env" "$@"); }

# Back up the database before any migration. pg_dump must be able to reach DATABASE_URL from this account.
database_url="$(run -e 'process.stdout.write(process.env.DATABASE_URL || "")')"
test -n "$database_url" || { echo 'DATABASE_URL is not set in .env'; exit 1; }
command -v pg_dump >/dev/null || { echo 'pg_dump is not available on this account; cannot take the pre-deployment backup.'; exit 1; }
pg_dump --format=custom --no-owner --no-acl --file="$HOME/deploy-backups/$sha.dump" "$database_url"
test -s "$HOME/deploy-backups/$sha.dump"
echo 'Pre-deployment database backup created.'

# Schema migrations, then idempotent reference data (permissions, roles, currencies). Content seeds are run by hand.
run tools/migrate.mjs
run tools/manage.mjs sync_permissions
run tools/manage.mjs seed_roles
run tools/manage.mjs seed_currencies

# Switch the release atomically, install the startup file and restart Passenger.
previous="$(readlink "$app/current" 2>/dev/null || true)"
ln -sfn "$target" "$app/current.new" && mv -Tf "$app/current.new" "$app/current"
install -m 644 "$target/deploy/cpanel/app.js" "$app/app.js"
mkdir -p "$app/tmp" && touch "$app/tmp/restart.txt"
if command -v cloudlinux-selector >/dev/null; then
  cloudlinux-selector restart --json --interpreter nodejs --app-root "$app_name" >/dev/null || echo 'cloudlinux-selector restart failed; Passenger will restart via tmp/restart.txt.'
fi

# Scheduled jobs (replaces only the block managed here; other crontab entries such as certificate renewal stay).
marker="# maven-host-app:$app_name"
manage="cd $app/current && $node_bin --env-file=$app/.env tools/manage.mjs"
{
  crontab -l 2>/dev/null | sed "/^$marker begin\$/,/^$marker end\$/d" || true
  echo "$marker begin"
  echo "* * * * * $manage process_outbox --limit 50 >> $app/logs/outbox.log 2>&1"
  echo "17 * * * * $manage enqueue_expired_trials >> $app/logs/trials.log 2>&1"
  echo "23 * * * * $manage cleanup_public_generations >> $app/logs/ai.log 2>&1"
  echo "41 3 * * * $manage sync_exchange_rates >> $app/logs/rates.log 2>&1"
  echo "53 3 * * * $manage flushexpiredtokens >> $app/logs/tokens.log 2>&1"
  echo "7 4 * * * $manage sync_domain_catalog >> $app/logs/catalog.log 2>&1"
  echo "15 6 * * * $manage process_domain_renewals >> $app/logs/renewals.log 2>&1"
  echo "$marker end"
} | crontab -

# Keep the three newest releases (and never the one now live).
ls -1dt "$releases"/*/ 2>/dev/null | tail -n +4 | while read -r old; do [[ "${old%/}" != "$target" ]] && rm -rf "${old%/}"; done
rm -f "$archive"
printf '%s\n' "$sha" > "$app/DEPLOYED"
echo "Deployed $sha (previous release: ${previous:-none})."
