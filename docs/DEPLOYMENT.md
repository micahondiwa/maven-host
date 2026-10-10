# Deployment (cPanel Node.js app, automated by `git push`)

Every push to `main` runs `.github/workflows/deploy.yml`:

1. **Test** on PostgreSQL 10 and 18 (lint, typecheck, migrations on an empty database, full test suite).
2. **Build** a self-contained release (`deploy/build-release.sh`): the Next.js standalone server, static assets,
   migrations, and bundled `tools/migrate.mjs` and `tools/manage.mjs`.
3. **Deploy** over SSH (`deploy/cpanel/deploy.sh`): back up the database with `pg_dump`, apply migrations, refresh
   permissions/roles/currencies, switch `current` to the new release, restart Passenger, install the cron jobs, and
   keep the last three releases.
4. **Verify** the site, `/api/v1/currencies/` and `/api/v1/hosting/plans/` respond.

Pull requests run the tests only. Deployment is skipped until the repository variable `APP_ROOT` exists, and a failed
test, build, backup or migration stops the deployment with the previous release still serving.

## One-time server setup (cPanel)

1. **Database:** create a PostgreSQL database and user (cPanel → PostgreSQL Databases) and grant the user all
   privileges. Use a new database for this app. Do not point it at the live v1 database while v1 is running: both apps
   would process the same orders and outbox events. `pg_dump` must work from the account (it does for cPanel
   PostgreSQL; an external database needs a compatible `pg_dump` and outbound access).
2. **Node.js app:** cPanel → Setup Node.js App → Create Application.
   - Node.js version: **22** (20.12 or newer is required)
   - Application mode: Production
   - Application root: e.g. `maven-host-app` (this is `APP_ROOT`)
   - Application URL: the domain or subdomain to serve (a staging subdomain such as `next.maven-host.com` is
     recommended while v1 stays on `maven-host.com`)
   - Application startup file: `app.js`
   - Do not run "NPM Install"; releases ship their own dependencies.
3. **Environment:** copy `deploy/cpanel/env.production.example` to `~/maven-host-app/.env`, fill it in, and
   `chmod 600` it. The deploy script refuses to run without it. Use the file rather than the cPanel environment
   variables panel, because cron jobs and migrations read the same file.
4. **Deploy key:** create an SSH key pair for GitHub Actions and add the public key to `~/.ssh/authorized_keys`
   (cPanel → SSH Access), ideally prefixed with `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty`.
   The v1 deployment key on this account can be reused.
5. **SSL:** make sure the application URL has a valid certificate (AutoSSL or Let's Encrypt).

## GitHub settings (micahondiwa/maven-host → Settings → Secrets and variables → Actions)

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CPANEL_DEPLOY_KEY` | private key of the deploy key pair |
| Secret | `CPANEL_KNOWN_HOSTS` | output of `ssh-keyscan -p 21098 host46.registrar-servers.com` |
| Variable | `CPANEL_SSH_HOST` | `host46.registrar-servers.com` |
| Variable | `CPANEL_SSH_PORT` | `21098` |
| Variable | `CPANEL_SSH_USER` | `mavenhost` |
| Variable | `APP_ROOT` | the application root, e.g. `maven-host-app` |
| Variable | `APP_URL` | public URL, e.g. `https://next.maven-host.com` (used for the post-deploy check) |

Setting `APP_ROOT` enables deployment; the next push to `main` (or "Run workflow") deploys.

## After the first deployment

Run once over SSH (paths assume `APP_ROOT=maven-host-app` and Node.js 22):

```bash
cd ~/maven-host-app/current
NODE="$(ls -d ~/nodevenv/maven-host-app/*/bin/node | sort -V | tail -1)"
$NODE --env-file=../.env tools/manage.mjs createsuperuser --email you@example.com   # password from DJANGO_SUPERUSER_PASSWORD
$NODE --env-file=../.env tools/manage.mjs sync_exchange_rates
$NODE --env-file=../.env tools/manage.mjs seed_tlds
$NODE --env-file=../.env tools/manage.mjs seed_supplier_workflows
$NODE --env-file=../.env tools/manage.mjs seed_pricing_rules
$NODE --env-file=../.env tools/manage.mjs seed_blog --create-editorial-author
```

Remove `DJANGO_SUPERUSER_PASSWORD` from `.env` afterwards.

Then sign in at `/staff/login` and use **Administration** (`/staff/admin`) to configure, with every change audited:

- **Payment gateways** and **Gateway credentials** (Paystack `secret_key`, M-Pesa keys, `reconciliation_token`).
  Credentials are encrypted with `FIELD_ENCRYPTION_KEY` / `SECRET_KEY` and are never displayed again.
- **Hosting packages**: one 20i package type per plan, marked verified after checking it in the 20i account.
- **Hosting plans** and **prices**, **Domain extensions**, **Registrars** (activate Openprovider), **Pricing rules**.
- **Background jobs** (retry failed events) and the **Audit log**.

## Scheduled jobs (installed by every deployment)

| Schedule | Command | Log |
| --- | --- | --- |
| every minute | `process_outbox --limit 50` (fulfilment, provisioning, notifications) | `logs/outbox.log` |
| hourly | `enqueue_expired_trials` | `logs/trials.log` |
| hourly | `cleanup_public_generations` | `logs/ai.log` |
| daily 03:41 | `sync_exchange_rates` | `logs/rates.log` |
| daily 03:53 | `flushexpiredtokens` | `logs/tokens.log` |
| daily 04:07 | `sync_domain_catalog` (skipped while `OPENPROVIDER_ENABLED` is off) | `logs/catalog.log` |
| daily 06:15 | `process_domain_renewals` (auto-renew invoices, reminders, expiry notices) | `logs/renewals.log` |

Only the block marked `# maven-host-app:<APP_ROOT>` is managed; other crontab entries (certificate renewal) are kept.

## Operations

- **Change configuration:** edit `~/maven-host-app/.env`, then `touch ~/maven-host-app/tmp/restart.txt`.
- **Roll back code:** `ln -sfn ~/maven-host-app/releases/<previous-sha> ~/maven-host-app/current && touch ~/maven-host-app/tmp/restart.txt`.
  Migrations are not reversed automatically; restore `~/deploy-backups/<sha>.dump` with `pg_restore` if a schema
  change must be undone.
- **Backups:** `~/deploy-backups/<sha>.dump` before every deployment (private; prune old files periodically).
- **Deployed commit:** `cat ~/maven-host-app/DEPLOYED`.
