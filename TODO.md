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

## Strategy Docs
- [ ] Run `npm run gen-docs` as a pre-build step (or git pre-commit hook) so docs never go stale
- [ ] Add more example strategies to `src/docs/examples/` for the docs page
