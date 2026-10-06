# MavenHost Next.js migration

Migration in progress; this repository is not a production replacement yet.

Reference: [maven-host-v1](https://github.com/micahondiwa/maven-host-v1), commit 58e0bb2540fd1376d45495ad8ad6c74a2dd6a6b7.

`npm ci`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

No deployment workflow is enabled. Source inventory and the functional parity checklist are in `docs/`. No development operation should access production data or credentials. API operations are being ported server-side; unfinished operations must fail closed rather than proxy to Django or simulate success.
