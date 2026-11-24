# Mama Mo backend (mo-be)

## Read the requirements first

Before any work in this repo, read **Mama Mo — Requirements**:
https://claude.ai/artifact/GmQycpFozMEZfU9fxbYfGu (a Claude Doc; read it with the docs tools, not a web fetch).

Apply its backend requirements (architecture, services, tech stack, non-functional
requirements, roles). If code and the doc disagree, the doc wins; if the doc leaves
something open (its "Open decisions" list), ask instead of deciding silently.

## Repos

- `mo-be` (this repo): backend services only.
- `mo-ui` (github.com/alyssabejar/mo-ui): the PWA frontend. It owns
  `packages/contracts`; this repo keeps a copy. After contracts change in mo-ui,
  run `pnpm contracts:sync ../mo-ui` and commit the result. Don't edit
  `packages/contracts` here without making the same change in mo-ui.

## Rules that come from the requirements

- 7 services (identity, meal, errand, staff, reminder, notification, calendar) + ai later.
  Node.js + TypeScript + Fastify, Drizzle, Postgres with one database per service.
- Services never share a database or call each other for data. They exchange events
  over NATS JetStream (subjects in `packages/contracts/src/events.ts`). Events go
  through the transactional outbox in `packages/service-kit`.
- Every service enforces roles from JWT claims (`sub`, `householdId`, `role`) with
  `can()` from the contracts. Every table carries `household_id`.
- Timestamps are UTC `timestamptz`, shown in Asia/Manila; all-day items are plain dates.
- RRULE stored once plus exception rows; occurrences expanded on read.
- Reminders: Postgres is the source of truth, reconciler sweep every 5 min,
  idempotent delivery per reminder + occurrence + level + user + channel.
- Service names stay neutral; the mama voice lives in notification templates.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev          # all services with tsx watch; needs Postgres (+ NATS unless EVENT_BUS=memory)
pnpm seed         # demo household through the gateway
```
