# TODO

## Security (pre-public launch)

### Critical
- [ ] Move encryption key to environment variable — currently hardcoded in `auth.ts:11` and `system-config.ts:16` as `scryptSync("algotrader-encryption-key", "salt", 32)`. Anyone with source access can decrypt all stored API keys. Use a random per-deployment secret from env, re-encrypt existing keys on migration.
- [ ] Replace `new Function()` eval in strategy metadata extraction — `strategy-loader.ts:130` uses `new Function()` to parse `strategyMeta`, allowing code injection just by listing a strategy. Use static regex extraction or a proper TS parser instead.
- [ ] Rate limiting on auth endpoints — login/register have no rate limits. Add rate limiting (e.g., 5 attempts/15min per IP).
- [ ] Strategy execution sandboxing — strategy files run via `import()` with full Node.js access (fs, child_process, network). Either sandbox execution or restrict strategy creation to trusted/admin users only.

### High
- [ ] Rate limiting on backtest API — users can spawn unlimited CPU-intensive backtests. Limit concurrent backtests per user (e.g., max 2).
- [ ] Explicit auth checks in admin actions — `setRole` and `setApiKey` in `admin/+page.server.ts` rely on hooks middleware but don't check `locals.user.role` themselves. Add explicit checks.
- [ ] Auth check in `admin/data/+page.server.ts` load() — no `locals.user` validation before returning data.
- [ ] Docker socket proxy — restrict Docker API access (tecnativa/docker-socket-proxy) instead of raw socket mount.
- [ ] Validate userEmail before passing to Docker container Cmd — potential command injection in `docker.ts:100`.

### Medium
- [ ] Reduce session expiration from 30 days to something shorter (e.g., 7 days) for a financial app
- [ ] Per-user disk quota to prevent storage exhaustion
- [ ] Input validation on backtest parameters (negative balance, extreme values) — adopt zod schemas
- [ ] Add Content Security Policy headers

## Real-time Updates (SSE)
- [ ] Replace polling with Server-Sent Events for live session monitoring
- [ ] SSE for backtest progress updates
- [ ] SSE for data collection job progress
- [ ] Shared event bus on server side for broadcasting updates to connected clients

## UI/UX
- [x] Light/dark mode with system preference support
- [x] Web app redesign — strategy-centric layout with tabs (Editor, Backtests, Paper, Live)
- [ ] Extract reusable components: Button, Modal, Alert, Badge, StatusDot, ConfigFields, DataTable
- [ ] Extract global CSS utility classes (.pos, .neg, .muted, base table/form/button styles)
- [ ] Extract utilities: api fetch wrapper, formatDate, formatPnl
- [ ] Create STYLE.md documenting CSS variables, spacing, typography, component usage

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
- [x] RecordingBroker — uses actual OANDA fill prices and realized P&L instead of position diffing
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
- [ ] GitHub Action to build and push image to registry
- [ ] Test full Docker deployment end-to-end

### Backtest container strategy
Currently backtests run as child processes in the web container. This is fine for now.
If backtests start competing for CPU with the web server, consider these upgrades:
- **Option A (current):** Keep in web container — simple, no networking, fast for short backtests
- **Option B:** Spin up a container per backtest — clean isolation, but container startup overhead for short runs
- **Option C:** Dedicated backtest worker container — always-running, accepts jobs via HTTP, can queue/parallelize. Best for multi-user scenarios.

## Strategy Management
- [x] Monaco-based in-browser strategy editor on `/strategies/mine` (TypeScript IntelliSense with Strategy interface types)
- [x] Fork, delete, and revert actions for user strategies
- [x] Admin can share strategies to community
- [ ] File upload endpoint as fallback (multipart upload to user strategy directory)
- [ ] Validate uploaded/saved strategies (exports `strategyMeta` + `*Strategy` class, restrict dangerous imports)
- [ ] AI strategy assistant: users provide their own Claude API key, chat with an AI that can read/write strategies, run backtests, and interpret results
  - Store user API key encrypted (like OANDA keys)
  - System prompt with Strategy interface, available imports, example strategies
  - Tools: read/write strategy files, run backtest, read results, list instruments
  - Let users pick model (Sonnet vs Opus) for cost control
  - Conversation persistence
  - Budget/rate-limit backtests per user (server compute cost)

## Code Quality
- [ ] Convert all tabs to spaces (web/ uses tabs, src/ uses spaces — standardize on spaces)

## Strategy Docs
- [ ] Run `npm run gen-docs` as a pre-build step (or git pre-commit hook) so docs never go stale
- [ ] Add more example strategies to `src/docs/examples/` for the docs page
