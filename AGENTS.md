# MavenHost migration instructions

Read `docs/FUNCTIONAL_PARITY.md` and `docs/MIGRATION_STATUS.md` before changes. The original reference is `D:/maven-host`, repository `micahondiwa/maven-host-v1`, commit 58e0bb2540fd1376d45495ad8ad6c74a2dd6a6b7. Do not modify the original project or its uncommitted work.

This is a full backend migration. UI preservation is not functional parity. Do not declare completion while auth, payments, provider workflows, staff access, content or migration tooling are unfinished. Do not proxy API operations to production Django. Fail closed for unported endpoints.

Do not deploy or begin deployment preparation until local acceptance passes. GitHub Actions are disabled in both repositories during migration. Never read/copy production environment values or customer data for local tests. Use synthetic data and isolated PostgreSQL databases; `.local/` and `.env.local` must remain ignored.

Read the relevant installed Next.js guides under `node_modules/next/dist/docs/` for framework changes. Use native server APIs with parameterized SQL and server-side authorization. Respect existing provider activation restrictions and exact financial rules. All schema changes must pass on both local PostgreSQL 18.6 and isolated 10.23; compatibility of existing migrations does not establish compatibility of future migrations or hosting configuration.

Local commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run db:migrate`, `npm run db:seed`. Set `TEST_DATABASE_URL` to an isolated loopback `mavenhost_` database for database tests. Run the production build with `next start` for browser acceptance.
