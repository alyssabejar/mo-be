# Mama Mo backend

Seven services behind one gateway, built to the **Mama Mo — Requirements** doc
(https://claude.ai/artifact/GmQycpFozMEZfU9fxbYfGu). The PWA lives in
[mo-ui](https://github.com/alyssabejar/mo-ui).

| Service | Owns | Publishes | Consumes |
| --- | --- | --- | --- |
| identity | households, members, roles, `mama_calls_me`, notes, Better Auth (sessions, JWKS) | `identity.user.*`, `identity.household.updated`, `identity.note.changed` | — |
| meal | recipes, meal plan, grocery lists, Anong Ulam? | `meal.slot.*`, `meal.recipe.changed`, `meal.grocery_list.*` | identity, `supply.*` |
| errand | errands (RRULE + exception rows) | `errand.upserted/archived`, `errand.occurrence.*` | `identity.user.removed` |
| staff | helper profiles, leave requests, balances (RA 10361) | `staff.profile.upserted`, `staff.leave.*` | identity |
| reminder | supplies, bills + cycles, parcels, courier webhook, reconciler sweep | `reminder.due`, `supply.*`, `bill.*`, `parcel.*` | identity, errand, meal |
| notification | inbox, templates (mama voice, 4 locales), Web Push, delivery retries | `notification.inbox.changed` | `reminder.due`, `staff.leave.*`, `parcel.status.changed`, handled-thing events |
| calendar | calendar read model, leave impact, SSE | — | everything |

Services never share a database or call each other for data. Writes and their
events commit together through a transactional outbox, events travel over NATS
JetStream, and consumers apply each event once (by event id). The calendar is
rebuilt from those events and pushes changes to browsers over SSE (Postgres
`LISTEN/NOTIFY` fans out across replicas).

## Run it

Needs Node 22, pnpm 10 and Postgres 16.

```bash
pnpm install
```

All services in one process, in-memory event bus, gateway on :8080:

```bash
DATABASE_URL_BASE=postgres://postgres@localhost:5432 pnpm dev:all --fresh
```

```bash
API_URL=http://localhost:8080/api pnpm seed
```

The full stack with NATS and Traefik:

```bash
docker compose -f infra/docker-compose.yml up --build
```

Point mo-ui at the gateway with `VITE_API_MODE=http` and
`VITE_API_BASE_URL=http://localhost:8080/api`.

Demo logins after seeding: `archimedes@mamamo.app` / `mamamo123` (owner),
`bea@mamamo.app` / `mamamo123` (member), `lorna` / PIN `1234` and `joy` / PIN
`5678` (helpers).

## API

The gateway routes `/api/<service>/…` to each service with the prefix stripped.
Every route except login, refresh, logout, JWKS, bootstrap, health and the courier
webhook needs `Authorization: Bearer <access token>`. Errors are
`{ code, message, details? }` with the HTTP status.

| mo-ui call | Route |
| --- | --- |
| `auth.login` / `logout` / `me` | `POST /identity/auth/login` → `{ user, household, token, refreshToken }` · `POST /identity/auth/logout` · `GET /identity/me` |
| token refresh | `POST /identity/auth/refresh { refreshToken }` → `{ token }` (access tokens last 1 h) |
| first run | `POST /identity/households/bootstrap` |
| `profile.update`, `household.update` | `PATCH /identity/profile`, `PATCH /identity/household` |
| `members.*` | `GET/POST /identity/members`, `POST /identity/members/helpers`, `PATCH/DELETE /identity/members/:id`, `POST /identity/members/:id/pin`; helper fields: `GET /staff/profiles`, `PATCH /staff/profiles/:userId` |
| `notes.*` | `GET/POST /identity/notes`, `DELETE /identity/notes/:id`, `POST /identity/notes/:id/pin` |
| `recipes.*` | `GET/POST /meal/recipes`, `PUT/DELETE /meal/recipes/:id` |
| `meals.*` | `GET /meal/meals?weekStart=`, `PUT /meal/meals`, `DELETE /meal/meals?date=&slot=` |
| `ai.suggest` | `GET /meal/suggestions?slot=` |
| `grocery.*` | `GET /meal/grocery?weekStart=`, `POST /meal/grocery/regenerate`, `PATCH /meal/grocery/:listId/items/:itemId { checked?, actualPrice? }`, `POST /meal/grocery/:listId/items`, `DELETE /meal/grocery/:listId/items/:itemId` |
| `errands.*` | `GET /errand/errands`, `GET /errand/errands/instances?from=&to=`, `POST /errand/errands`, `PUT /errand/errands/:id`, `POST /errand/errands/:id/archive`, `PUT /errand/occurrences`, `DELETE /errand/occurrences?errandId=&date=` |
| `staff.*` | `GET /staff/leaves?helperId=`, `GET /staff/leaves/pending`, `POST /staff/leaves`, `POST /staff/leaves/:id/cancel`, `POST /staff/leaves/:id/decide`; impact: `GET /calendar/leave-impact/:leaveId` |
| `supplies.*` | `GET/POST /reminder/supplies`, `PUT/DELETE /reminder/supplies/:id`, `POST /reminder/supplies/:id/check { status }` |
| `bills.*` | `GET/POST /reminder/bills`, `PUT/DELETE /reminder/bills/:id`, `POST /reminder/bills/pay`, `POST /reminder/bills/cycles/:id/snooze { hours }` |
| `parcels.*` | `GET/POST /reminder/parcels`, `POST /reminder/parcels/:id/refresh`, `POST /reminder/parcels/:id/received`, `DELETE /reminder/parcels/:id`; courier webhook: `POST /reminder/webhooks/courier` (`x-webhook-secret`) |
| `inbox.*` | `GET /notification/inbox`, `POST /notification/inbox/:id/read`, `POST /notification/inbox/read-all`; Web Push: `GET /notification/push/vapid-public-key`, `POST/DELETE /notification/push/subscriptions` |
| `calendar.range` | `GET /calendar/calendar?from=&to=` |
| live sync | `GET /calendar/live?access_token=` (SSE, `event: change`, `data: { topics }`) |
| run reminders now | `POST /reminder/sweep` (owner) |

`act(item, action)` in mo-ui becomes two calls: mark the inbox item read, then the
matching action (`bills/cycles/:id/snooze`, `errand/occurrences`, …).

## Tests

```bash
pnpm test
```

```bash
TEST_DATABASE_URL_BASE=postgres://postgres@localhost:5432 pnpm test:e2e
```

The e2e suite boots all services on a real Postgres, seeds the demo household
through the gateway and checks roles, the calendar read model, supply → grocery,
reminder idempotency, leave rules, member removal and SSE.

## Layout

```
packages/contracts     Zod contracts, copied from mo-ui (pnpm contracts:sync ../mo-ui)
packages/service-kit   Fastify app, JWT checks, outbox + NATS/memory bus, dates, RRULE
services/*             one service each: src/schema.ts (Drizzle), src/service.ts, drizzle/ migrations
scripts/dev-all.ts     every service in one process + gateway
scripts/seed.ts        demo household through the API
infra/                 docker compose, Traefik routes, Postgres init
```

Schema changes: edit `src/schema.ts`, then `pnpm --filter @mamamo/<service>-service db:generate`.
Migrations run when a service starts.

## Not done yet

- Open decisions in the requirements doc: job queue (pg-boss or BullMQ). Today
  the 5-minute reconciler sweep fires reminders on its own; per-reminder delayed
  jobs come with the queue. Also open: the LLM provider (Anong Ulam? uses a
  built-in ranking, `provider: "sample"`), file storage for receipts (stored as
  data URLs for now) and the courier aggregator.
- Slack delivery and Slack buttons (needs the Slack app and signing secret).
- k3s manifests, CloudNativePG, ArgoCD, observability.
