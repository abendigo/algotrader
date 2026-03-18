# TODO

## Testing
- [ ] Automated tests for live service failure scenarios (error isolation, idle auto-exit, session file recovery, stream reconnect, stop targeting, log tagging)
- [ ] Refactor SessionManager to accept injectable factories for broker/strategy creation (needed for testability)
- [ ] Manual verification: Docker networking — web app reaching service HTTP API across containers

## API & Validation
- [ ] Adopt zod for request/response schema validation across all API endpoints
- [ ] Generate OpenAPI spec from zod schemas (build-time)
- [ ] API docs page rendered from generated OpenAPI spec (or Swagger UI / Scalar)
- [ ] Add zod validation to SvelteKit API routes (`web/src/routes/api/`)
- [ ] Add zod validation to service HTTP API (`src/live/service-api.ts`)

## Live Trading Service
- [ ] Test backfill recovery mode end-to-end (restart a strategy with indicator buffers, verify warmup from candles)
- [ ] Test checkpoint recovery mode end-to-end
- [ ] Test custom recovery mode end-to-end
- [ ] Docker deployment: ensure service discovery works across containers (may need host/port config instead of localhost)
- [ ] Consider per-session log files vs current shared-log-with-tagging approach if log files get large

## Docker Deployment
- [x] Multi-stage Dockerfile (one image, two entrypoints: web app + live service)
- [x] docker-compose with web container, shared data volume, Docker socket mount
- [x] Web app manages live service containers via Docker API (create/start/stop)
- [x] Service discovery via Docker network hostnames + fixed port (no discovery files)
- [x] Remove `caffeinate` usage in processes.ts, replace with Docker API calls
- [ ] Docker socket proxy (tecnativa/docker-socket-proxy) for restricted API access
- [ ] GitHub Action to build and push image to registry
- [ ] Test full Docker deployment end-to-end

### Backtest container strategy
Currently backtests run as child processes in the web container. This is fine for now.
If backtests start competing for CPU with the web server, consider these upgrades:
- **Option A (current):** Keep in web container — simple, no networking, fast for short backtests
- **Option B:** Spin up a container per backtest — clean isolation, but container startup overhead for short runs
- **Option C:** Dedicated backtest worker container — always-running, accepts jobs via HTTP, can queue/parallelize. Best for multi-user scenarios.

## Strategy Docs
- [ ] Run `npm run gen-docs` as a pre-build step (or git pre-commit hook) so docs never go stale
- [ ] Add more example strategies to `src/docs/examples/` for the docs page
