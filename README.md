# unblur-notification-service

In-app notifications only for Version 4 (no push/SMS yet — see `VERSION_PLAN.md`'s Version 4
entry). Owns the `notifications` table. Called by Resolution/Payment/User Service whenever
something notification-worthy happens (a resolution request received/accepted/rejected, a
payment confirmed, a booking completed, a rating received), and by the frontend to list/read a
user's own notifications.

## Auth

Two separate trust paths, same as every other Unblur backend service:

- **`/internal/*`** — requires `X-Internal-Service-Token` matching the `INTERNAL_SERVICE_TOKEN`
  env var, checked in a `preHandler` hook. The service fails to start (fatal log, non-zero exit)
  if that env var is unset — fail-closed, same as `JWT_SECRET` in the gateway. Only other backend
  services call these routes, never the frontend directly. A valid `X-User-Id` header alone does
  not satisfy this check — a user cannot spoof server-to-server notification creation.
- **Everything else** — trusts the gateway-verified `X-User-Id` header (see
  `ARCHITECTURE_DECISIONS.md`'s gateway-trust decision). This service never verifies JWTs itself.

## Caller expectation: `POST /internal/notifications` is fire-and-forget for callers

Resolution/Payment/User Service should treat a failure calling this endpoint as non-fatal to
their own primary action (the same graceful-degradation shape as Resolution Service's stats
update to User Service) — a resolution request being accepted, or a payment being confirmed,
should not fail just because the notification write failed. That degradation is the caller's
responsibility, not something faked here: this service itself validates its input properly and
returns real errors (400/401) when something is actually wrong.

## Endpoints

Internal (require `X-Internal-Service-Token`):

- `POST /internal/notifications` — body `{ userId, type, referenceType, referenceId, title, body? }`.
  `userId`/`referenceId` must look like real UUIDs; `type`/`referenceType`/`title` must be
  non-empty strings. Returns `201` with the created notification.

Client-facing (require `X-User-Id`):

- `GET /notifications?unread=true&limit=20` — the caller's own notifications, newest first.
  `limit` defaults to 20, clamped to 1–100.
- `GET /notifications/unread-count` — `{ count }` for the caller.
- `POST /notifications/:id/read` — marks one of the caller's own notifications read. `404` if
  unknown, `403` if it belongs to someone else. Idempotent — reading an already-read notification
  again just returns `200`.
- `POST /notifications/read-all` — marks every one of the caller's own unread notifications read.
  Returns `{ markedCount }`.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run migrate` — run pending migrations
- `npm test` — unit tests (Vitest)
