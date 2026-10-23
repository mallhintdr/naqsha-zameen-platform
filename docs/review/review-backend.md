# Backend review — scale 100x + payment gateway (2026-10-23, read-only)

Scope: D:\temp-repo\backend, cloudflare-worker, deploy.sh. Evidence is cited as file:line. This was a time-boxed pass: the points marked "verify" were not traced end to end.

## Critical
1. **The PMTiles worker deployed in production has no authentication.** `cloudflare-worker/wrangler.toml` sets `main = "pmtiles-worker-simple.js"`. That file says on line 4 that it serves R2 "without authentication". It only checks the Origin header (lines 182-187), and any non-browser client can fake that header. The paid map data can be scraped in full, which undermines the subscription model. A `PMTILES_SIGNING_KEY` already exists in `backend/utils/.env`, so the signing work was started. **Fix:** deploy the HMAC-signed worker, have the API issue short-lived signed URLs (about 5-15 min) per subscribed user, and add Cloudflare rate limiting.
2. **Background jobs run on every pm2 cluster worker.** `server.js:576` (`setInterval(purge)`, hourly), `services/multiUseWarning.js:94` (every 10 min), `services/subAdminExpiryNotice.js:51` (every 15 min) and `services/subAdminJobs.js:188` (every 60 s when Redis is off) all start inside each API process. With N workers, every job runs N times, so warning and expiry emails and notifications are duplicated, and the deletes race each other. This gets worse with every node added. Renewal and payment reconciliation must not be built on this pattern, or customers get double-charged or double-notified. **Fix:** move all scheduling to BullMQ repeatable jobs in a separate `worker` process, or at minimum guard with `NODE_APP_INSTANCE==='0'` plus a Redis lock. Payment jobs must be idempotent (idempotency keys, unique index on the gateway transaction ID).
3. > **Correction (verified after review):** this finding is wrong as stated. `services/socketService.js:43` does call `io.adapter(createAdapter(...))` whenever Redis is reachable. The real risk is smaller: if Redis is down at start-up the adapter is silently skipped and cross-worker delivery degrades. See REVIEW.md item M3. Original text kept below for reference.

   **Socket.io has no Redis adapter.** `@socket.io/redis-adapter` is in `package.json:43`, but `createAdapter` appears nowhere in the codebase. Under pm2 cluster, rooms are per process, so an emit only reaches sockets on the same worker. Real-time notifications already fail silently, and the problem will grow with more nodes. **Fix:** wire the adapter (the Redis client already exists) and use sticky sessions or websocket-only transport behind nginx.

## High
4. **Every authenticated request costs one DB read.** `middleware/authMiddleware.js:45-48` calls `User.findById(...).select(...tokenVersion...)` on each request. At 100x traffic this read dominates Mongo load. **Fix:** cache `{tokenVersion,status,endDate}` per user in Redis with a 60 s TTL, and bust the cache on logout, password change or admin edit.
5. **JWTs last 30 days, and one path signs a token without `tokenVersion`.** `authController.js:192` and `:742` (impersonation) issue 30-day tokens. `authController.js:849` signs `{userId}` with no tokenVersion, and `authMiddleware.js:48` accepts `decoded.tokenVersion === undefined`. Such a token cannot be revoked by bumping the version. **Fix:** require tokenVersion on every token, use short access tokens plus a rotating refresh token, cap impersonation tokens at about 1 h, and audit-log their use.
6. **13 production dependency vulnerabilities** (`npm audit --omit=dev`: 11 high, 2 moderate). **Fix:** run `npm audit fix`, triage what remains, and add Dependabot or Renovate.
7. **Map data is served from local disk through Node, with a case-insensitive directory walk.** `server.js:320-360` tries `stat` on the exact path, then calls `readdir` on each path segment for every miss. A burst of misses (404 probes) becomes a disk-I/O denial-of-service vector, and the data is tied to a single VPS. **Fix:** normalise file names to lowercase once with a migration, upload them to R2/S3 behind a CDN, or at least let nginx `try_files` serve them with a precomputed lowercase map.
8. **Payment-proof uploads are stored on local disk.** `paymentProofController.js:15` writes to `uploads/payment-proofs`. Each node has its own disk, nothing is in a backup set (verify), and the files cannot be used across horizontal nodes. **Fix:** private object storage with pre-signed GET URLs. Once a gateway is in place, proofs become a fallback flow only.
9. **Puppeteer runs inside the API process.** `services/pdfReportService.js:10-11` launches Chromium in-process, using hundreds of MB per launch, and it competes with request handling. **Fix:** move PDF generation to the worker queue.
10. **No tests.** `package.json:12` still has the default `"test": "echo Error: no test specified"`. Adding a payment gateway without tests on renewal, webhook and idempotency logic is high risk. **Fix:** Jest + supertest + mongodb-memory-server, starting with auth and renewal.
11. **Deploys are destructive and not zero-downtime.** `deploy.sh:15` runs `git reset --hard origin/$BRANCH` on the server, which silently discards hotfixes and any untracked state. There is no build artefact and no rollback. **Fix:** build immutable releases (CI tarball or container), keep releases in timestamped directories with a symlink switch, run `pm2 reload` (rolling), and roll back by re-pointing the symlink.

## Medium
12. **Stats endpoints scan whole collections on each call.** `statsController.js:67-219` runs `User.countDocuments()` plus roughly 8 `User` and `Session` aggregations per request. **Fix:** precompute them in the worker every few minutes into a `stats` collection or Redis, and check `explain()` on each pipeline.
13. **User-list search uses unanchored case-insensitive regex.** `userController.js:101-105`: the input is escaped, so there is no ReDoS, but `/x/i` cannot use an index, so every search is a full collection scan. `adminSubAdminController.js:212` has the same pattern, and `:283` keeps a regex fallback. **Fix:** prefix-anchored search on the lowercased mirror fields, or a Mongo text index or Atlas Search. Enforce pagination limits.
14. **Heartbeat write every 60 s per user** (`routes/locationRoutes.js:9`, which updates `lastActive`, indexed twice: `User.js:134,138`). At 100x users this is a large stream of index-maintaining writes to the hottest collection. **Fix:** write presence to a Redis ZSET, then flush to Mongo every 5-10 min or only on a change of more than 5 min.
15. **Notification polling every 12 s per tab** (frontend). Sockets already exist, so polling should be replaced by push through the Redis adapter, with a 60 s polling fallback.
16. **Cross-worker cache invalidation polls Mongo every 5 s per worker** (`utils/cacheBus.js:15`). The node-cache data is per-process. **Fix:** Redis pub/sub, or keep the shared cache in Redis.
17. **Rate limiting may fall back to memory** (`middleware/rateLimiters`, `server.js:267`). With an in-memory store, each worker has its own limit, so the real limit is N times the configured one (verify which store is active in production). **Fix:** make Redis required in production and fail closed.
18. **Secrets sit in plain `.env` files on disk,** including two copies (`backend/.env` and `backend/utils/.env`, 16 keys including SECRET_KEY, MONGO_URI, SMTP, PMTILES_SIGNING_KEY). Neither is git-tracked (good). The duplicate copy is a drift and leak risk. **Fix:** keep a single source, read-only to the app user (chmod 600), rotate SECRET_KEY before launch, and move to a secret manager later.
19. **Observability is minimal:** winston to local `logs/`, no metrics, no tracing, no error tracker. `/api/health` returns 404 and only `/health` exists (200). Verify that the health check covers Mongo and Redis. **Fix:** Sentry, pino with JSON logs shipped off-box, prom-client metrics or Better Stack, and an uptime check on `/health` with a DB ping.
20. **Backups:** DEPLOYMENT.md has no mongodump or backup procedure (grep found none). **Fix:** use managed Mongo point-in-time recovery, or a nightly mongodump sent to R2 with a tested restore.

## Low
21. **Controller sprawl:** `adminSubAdminController.js` 55 KB, `subAdminController.js` 52 KB, `userController.js` 47 KB, `authController.js` 40 KB. Business logic (billing, expiry, pricing) lives in controllers. **Fix:** extract service modules, starting with `billing/subscription`, before adding the gateway.
22. **No API versioning** and mixed `/stats` and `/api` prefixes. `routes/locationRoutes.js:9` even registers both `/heartbeat` and `/api/heartbeat`. **Fix:** mount new routes under `/api/v1` and keep the old aliases until the frontend cutover.
23. **No TypeScript or schema validation layer.** Add zod (or celebrate) validation at the edge, especially for the webhook and renewal payloads.
24. `geoController.js:747` runs `deleteMany` with an unanchored regex (an admin path, so acceptable).

Positive: login and geo lookups already moved to indexed lowercase mirrors (SCALE-01 comments), search input is regex-escaped, helmet is enabled, there is a SIGTERM handler (`server.js:633`), and `passwordPlain` was removed (`User.js:53`), with bcrypt run in the pre-save hook.

## Payment-gateway prerequisites
- A webhook endpoint that skips CSRF, verifies the gateway signature, stores the raw event, and processes it through an idempotent queue job. Add a unique index on `gatewayTxnId`.
- A `Payment` or `Invoice` model, with the subscription state machine in a single service (not split across 4 controllers).
- Renewal must run only in the singleton worker (finding 2).
- No card data handled on our side: use a hosted checkout from JazzCash, Easypaisa, Stripe or Safepay, which keeps PCI scope at SAQ-A.

## Target architecture for 100x
- **Edge:** Cloudflare (DNS, WAF, CDN). The SPA is served from Cloudflare Pages or R2. PMTiles and map data come from R2 through the **signed** worker.
- **API:** 2+ stateless Node nodes (containers or VPS) behind a load balancer (Cloudflare LB or the provider's LB). JWT checks are cached in Redis. Socket.io uses the Redis adapter.
- **Worker:** a separate process or node for the BullMQ consumer, scheduler, PDF and email work, and payment webhooks and renewals.
- **Data:** managed MongoDB (Atlas M10/M20, 3-node replica set, PITR backups). Managed Redis (Upstash, Redis Cloud or a provider-managed instance) becomes required.
- **Files:** R2 for uploads (private, pre-signed URLs) and for data files.
- **Ops:** CI builds an image, then rolling deploys. Sentry, centralised logs and an uptime monitor.

### Staged migration
1. **Week 1-2: fixes on the current VPS.** Signed worker, singleton jobs, Socket.io Redis adapter, Redis auth cache, `npm audit fix`, nightly backup to R2, release-directory deploys.
2. **Week 3-4: move state off the box.** Mongo to Atlas, data files and uploads to R2, PDF and jobs to a separate pm2 app (`worker`). Precomputed stats, Redis presence.
3. **Month 2: horizontal scale.** Second API node plus a load balancer, managed Redis, Sentry and metrics, tests on the billing service, payment gateway behind a feature flag.
4. **Month 3+:** if needed, split billing and notifications into separate services. Add TypeScript incrementally.

### Rough monthly cost tiers (USD)
| Stage | Components | ~Cost |
|---|---|---|
| Now (1x) | Single Hostinger VPS + R2 | $10-25 |
| Stage 1-2 (10x) | VPS (API+worker) + Atlas M10 + Upstash Redis + R2/CF free/Pro | $90-150 |
| Stage 3 (100x) | 2-3 API nodes (4 GB) + 1 worker + Atlas M20/M30 + managed Redis + LB + Sentry + R2 egress-free | $300-700 |
