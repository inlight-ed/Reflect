# Reflect

AI commerce intelligence for Kaspi sellers and brands. The MVP turns marketplace sales, advertising, external media, competitor, and content signals into transparent next actions with estimated impact and confidence.

## Run & Operate

- Self-hosting without Replit: see `DEPLOY.md` (Docker image + compose with PostgreSQL 18, Caddy HTTPS and nightly backups; `deploy/*.sh` for install, update, restore and moving the database). With `STATIC_DIR` set, the API also serves the built web app; `/api/readyz` checks the database.

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + translation check + unit tests + build all packages
- `pnpm run test` — unit tests (analytics formulas, import parsing, statuses, encryption, log scrubbing, SSRF guard)
- `TEST_API_URL=http://localhost:8080/api pnpm --filter @workspace/api-server run test` — also runs API tests against a live server with a database: seller data isolation, sign-up race, single sync per click, sign out everywhere
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run migrate` — apply versioned SQL migrations from `lib/db/migrations`; after changing the schema run `pnpm --filter @workspace/db run generate` first and commit the new file. `push` remains for throwaway local databases only
- Required env:
  - `DATABASE_URL` — Postgres. Accounts, imports, campaigns and connections need it; without it the app runs as a demo only.
  - `ENCRYPTION_KEY` — any long random string (Secrets). Encrypts Kaspi / MoySklad / MCP keys at rest. In production the API refuses to start without it (or `SESSION_SECRET`).
  - To rotate it: put the old value in `ENCRYPTION_KEY_PREVIOUS` (comma-separated for several) and the new one in `ENCRYPTION_KEY`; saved keys keep working and are re-encrypted when next read.
- After schema changes run `generate`, review the SQL file, commit it, then `migrate` (post-merge does it for dev; production gets it through `docker compose run --rm migrate`).
- Optional env:
  - `ANTHROPIC_API_KEY` (or Replit AI integration `AI_INTEGRATIONS_ANTHROPIC_API_KEY` + `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`) — turns on model answers in "Ask Reflect"; without it the assistant answers with data-driven rules
  - `ASSISTANT_MODEL` — defaults to `claude-sonnet-5-5`
  - `ALLOWED_ORIGINS` — comma-separated origins allowed to call the API cross-origin (default: none, same-origin only)
  - `DEMO_SNAPSHOT_DATE=2026-08-18` — pins demo dates to the authored snapshot (used by e2e tests); unset, the demo follows today's date
  - `KASPI_API_BASE`, `MOYSKLAD_API_BASE` — override API hosts (tests/mocks only)
  - `MCP_ALLOW_PRIVATE=1` — allow http and private addresses for MCP servers (local development only; never in production)
- `pnpm --filter @workspace/shift-market run test:e2e` — Playwright tests (`SHIFT_MARKET_TEST_BASE_URL`, optional `PLAYWRIGHT_CHROMIUM_PATH`)
- `pnpm --filter @workspace/shift-market run typecheck` — check the web app

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/shift-market/src/App.tsx` — providers and routes (pages are lazy-loaded)
- `artifacts/shift-market/src/pages/*` — one file per route; `components/common.tsx` shared cards, `Hint` glossary tooltips, confidence explanation; `components/shell.tsx` navigation
- `artifacts/shift-market/src/locales/` — the only translation catalog: one file per area (ui, account, data, analytics, cards, integrations, source), each entry a `[ru, kk, en]` triple, so a missing language is a type error. `source.ts` is typed against the API's `SourceMessageKey`. `lib/i18n.ts` holds the provider and number/date formatting.
- `pnpm --filter @workspace/scripts run check:i18n` — fails on duplicate keys, empty texts, mismatched `{placeholders}` and literal `t('…')` keys missing from the catalog; runs as part of `pnpm run build`
- `artifacts/shift-market/src/lib/import-parse.ts` + `import.worker.ts` — CSV/Excel parsing runs in a Web Worker (falls back to the main thread if workers are unavailable); `importer.ts` does column detection and mapping
- `artifacts/shift-market/src/lib/sales-report.ts` — CSV/XLSX orders report parser (partners read from the file; runs in the browser)
- `artifacts/shift-market/src/index.css` — Reflect dark analytics theme
- `artifacts/api-server/src/lib/shift-market.ts` — demo endpoints, recommendation engine, connector interfaces
- `artifacts/api-server/src/lib/demo-products.ts` — consistent demo catalogue (revenue, spend, ROAS, stock cover derived from one profile per family)
- `artifacts/api-server/src/lib/confidence.ts` — confidence = share of supporting signals, mapped to 50–90%
- `artifacts/api-server/src/lib/demo-clock.ts` — shifts demo dates so the snapshot is always "today"
- `artifacts/api-server/src/lib/assistant.ts` — "Ask Reflect": rule-based answers from app data, optional Claude answers grounded in the same data
- `artifacts/api-server/src/lib/campaign-store.ts` — Postgres-backed campaigns with in-memory fallback
- `artifacts/api-server/src/middlewares/rate-limit.ts` — per-IP limits (API 300/min, writes 20/h, assistant 10/min)
- `artifacts/api-server/src/routes/shift-market.ts` — demo intelligence API routes
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `attached_assets/` — uploaded product brief and future source materials

## Architecture decisions

- Demo data is marked as `DATA / DEMO` and `SOURCE: DEMO DATA`; the UI never presents mock data as a live connector.
- Recommendation scoring is deterministic and lives outside React components so placement decisions can later use normalized persisted data.
- External media impact is labeled as estimated incremental sales with confidence, not exact causal attribution.
- Kaspi and Redstat are represented by connector interfaces first; live methods are not claimed until endpoint availability is confirmed.
- The app uses OpenAPI-generated client hooks so a persistent backend can replace the demo adapter without changing the route-level UI contract.

## Product

- Guests see the landing page (`/`) and can open the demo; `/login` and `/register` use email + password (scrypt hashes, httpOnly session cookie, sessions stored hashed).
- Signed-in sellers get their own data everywhere: `/data` imports Kaspi exports, the template (Товары / Продажи / Реклама) and 1C / MoySklad files; columns are auto-detected and can be remapped before import.
- Analytics on seller data (`artifacts/api-server/src/lib/analytics.ts`): 7/30/90-day periods vs previous period or last year, margin after Kaspi commission, stock-out forecast and reorder quantity, recommendations with confidence from supporting signals, "Worked / Didn't work / Too early" outcomes with revenue before and after.
- Integrations (`lib/integrations/*`): Kaspi Merchant API orders (X-Auth-Token), MoySklad stock report with cost price, RedStat and any MCP server (Streamable HTTP with SSE fallback; private addresses blocked).
- Card analysis (`lib/cards.ts`): reviews and sellers from RedStat, return rate and trend from orders, review themes (Claude when configured, keywords otherwise), and sales before/after logged card edits.

- `/overview` answers what the operator should do today.
- `/advertising` answers where to buy attention.
- `/products` surfaces SKU opportunities and decision categories.
- `/external-media` compares campaign windows and estimated impact.
- `/competitors` shows competitive pressure and tactical recommendations.
- `/content` provides AI-assessment-style content scoring and hypotheses.
- `/assistant` answers questions only from app data and says when data is insufficient.
- `/settings` distinguishes demo connectors from future live integrations; Kaspi is shown as "coming soon" with a path to upload a report.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep `lib/api-spec/openapi.yaml` and generated client/Zod files in sync by running codegen after contract changes.
- Campaigns persist only when `DATABASE_URL` is set and the migrations have created `external_campaigns`.
- Campaigns, imports, feedback and connections belong to a user; guests cannot write anything.
- Server-side imports cap at 5000 rows per request; the web app sends larger files in chunks.
- The Kaspi export column names are matched by aliases in `artifacts/shift-market/src/lib/importer.ts`. If a real export uses a different header, add it there — the mapping UI covers it meanwhile.
- MoySklad money values are in minor units (divided by 100). Its stock report rows are matched to Kaspi orders by article, then code.
- Limits for sign-in, AI questions, imports and syncs live in Postgres (`rate_limits`) so they hold across instances; the general per-request limit stays in memory per process.
- Syncs run in the background. `sync_runs` is both the run log and the lock (a partial unique index allows one RUNNING sync per user and source). Transient source errors are retried twice (2 s, 6 s). A run older than 15 minutes is treated as interrupted.
- MCP requests go through `pinnedFetch` (`lib/integrations/net.ts`): the address is checked in the socket's own DNS lookup, so DNS rebinding cannot reach internal hosts, and redirects are refused. IPv4 and IPv6 block lists must stay separate (`BlockList` matches IPv4 against IPv6 rules like `::/96`).
- Logs never contain request bodies, SQL parameters, tokens or keys (`lib/logger.ts` scrubs error messages). Each AI call logs token usage (`AI usage`).
- Kazakh numbers/dates are formatted with ru-RU grouping and hand-written kk month/weekday names, because some browsers lack kk-KZ locale data.
- Do not send or store Kaspi tokens in browser storage; the test endpoint accepts them server-side and does not log them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
