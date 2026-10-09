# Maven Web Host Trial Edge

This Worker serves the seven-day static Maven Web Host trials from R2.

The application uploads immutable artifacts under `trials/<trial-uuid>/<path>`.
The hostname is `maven-trial-<32-hex-uuid>.<trial-zone>`, so the Worker can
derive the storage prefix without a per-trial routing record.

## Infrastructure setup

1. Create the `maven-web-host-trials` R2 bucket.
2. Deploy this Worker with the R2 binding in `wrangler.toml.example`.
3. Configure a wildcard DNS record and Worker route for the dedicated
   `maven-trial` hostname zone.
4. Set backend `TRIAL_BASE_DOMAIN` to that zone.
5. Give the application a narrowly scoped R2 token for this bucket.

The Worker only accepts GET/HEAD, rejects traversal, and serves static objects.
It does not execute uploaded code.
