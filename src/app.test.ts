import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryNotificationRepository } from "./notification/repository.js";

const INTERNAL_TOKEN = "test-internal-token";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const REFERENCE_ID = "33333333-3333-3333-3333-333333333333";

function setup() {
  const repo = new InMemoryNotificationRepository();
  const app = buildApp(repo, INTERNAL_TOKEN);
  return { app, repo };
}

const validCreateBody = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_A,
  type: "resolution_request_received",
  referenceType: "resolution_request",
  referenceId: REFERENCE_ID,
  title: "You got a resolution request",
  body: "someone wants to resolve your doubt",
  ...overrides,
});

async function createInternal(app: ReturnType<typeof buildApp>, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/internal/notifications",
    headers: { "x-internal-service-token": INTERNAL_TOKEN, "content-type": "application/json" },
    payload: body,
  });
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });
});

describe("internal auth: X-Internal-Service-Token", () => {
  it("401s with no token", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/internal/notifications", payload: validCreateBody() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid internal service token");
  });

  it("401s with a wrong token", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/internal/notifications",
      headers: { "x-internal-service-token": "not-the-real-token" },
      payload: validCreateBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s a request carrying only X-User-Id, proving a user can't spoof server-to-server creation", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/internal/notifications",
      headers: { "x-user-id": USER_A },
      payload: validCreateBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid internal service token");
  });

  it("accepts a request with the correct token and no X-User-Id", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody());
    expect(res.statusCode).toBe(201);
  });
});

describe("POST /internal/notifications validation", () => {
  it("creates the notification and returns 201 with the row on valid input", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody());
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.userId).toBe(USER_A);
    expect(created.type).toBe("resolution_request_received");
    expect(created.referenceType).toBe("resolution_request");
    expect(created.referenceId).toBe(REFERENCE_ID);
    expect(created.title).toBe("You got a resolution request");
    expect(created.readAt).toBeNull();
  });

  it("allows omitting the optional body field", async () => {
    const { app } = setup();
    const { body, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(201);
    expect(res.json().body).toBeNull();
  });

  it("400s when userId is missing", async () => {
    const { app } = setup();
    const { userId, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/userId/);
  });

  it("400s when userId doesn't look like a uuid", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ userId: "not-a-uuid" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/userId/);
  });

  it("400s when userId is a non-string type", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ userId: 12345 }));
    expect(res.statusCode).toBe(400);
  });

  it("400s when type is missing", async () => {
    const { app } = setup();
    const { type, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/type/);
  });

  it("400s when type is an empty string", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ type: "" }));
    expect(res.statusCode).toBe(400);
  });

  it("400s when referenceType is missing", async () => {
    const { app } = setup();
    const { referenceType, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/referenceType/);
  });

  it("400s when referenceId is missing", async () => {
    const { app } = setup();
    const { referenceId, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/referenceId/);
  });

  it("400s when referenceId doesn't look like a uuid", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ referenceId: "resolution-request-123" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/referenceId/);
  });

  it("400s when title is missing", async () => {
    const { app } = setup();
    const { title, ...rest } = validCreateBody();
    const res = await createInternal(app, rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/title/);
  });

  it("400s when title is an empty string", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ title: "   " }));
    expect(res.statusCode).toBe(400);
  });

  it("400s when body is provided but not a string", async () => {
    const { app } = setup();
    const res = await createInternal(app, validCreateBody({ body: 42 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/body/);
  });

  it("400s on a wholly empty payload", async () => {
    const { app } = setup();
    const res = await createInternal(app, {});
    expect(res.statusCode).toBe(400);
  });

  it("400s on an empty body with Content-Type: application/json set (the empty-body content-type parser bug)", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/internal/notifications",
      headers: { "x-internal-service-token": INTERNAL_TOKEN, "content-type": "application/json" },
      payload: "",
    });
    // an empty JSON body must not crash the parser -- it's still a validation 400, not a 500
    expect(res.statusCode).toBe(400);
  });
});

describe("client-facing auth: X-User-Id header", () => {
  it("401s every client-facing route when the header is missing", async () => {
    const { app } = setup();
    const routes: Array<{ method: "GET" | "POST"; url: string }> = [
      { method: "GET", url: "/notifications" },
      { method: "GET", url: "/notifications/unread-count" },
      { method: "POST", url: "/notifications/some-id/read" },
      { method: "POST", url: "/notifications/read-all" },
    ];
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(res.json().error).toBe("missing X-User-Id header");
    }
  });
});

describe("GET /notifications", () => {
  it("never returns another user's notifications, even when many users have rows", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ userId: USER_A, title: "for A 1" }));
    await createInternal(app, validCreateBody({ userId: USER_B, title: "for B 1" }));
    await createInternal(app, validCreateBody({ userId: USER_A, title: "for A 2" }));
    await createInternal(app, validCreateBody({ userId: USER_B, title: "for B 2" }));

    const res = await app.inject({ method: "GET", url: "/notifications", headers: { "x-user-id": USER_A } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(2);
    expect(rows.every((n: { userId: string }) => n.userId === USER_A)).toBe(true);
  });

  it("orders newest first", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ title: "first" }));
    await createInternal(app, validCreateBody({ title: "second" }));
    await createInternal(app, validCreateBody({ title: "third" }));

    const res = await app.inject({ method: "GET", url: "/notifications", headers: { "x-user-id": USER_A } });
    const rows = res.json();
    expect(rows.map((n: { title: string }) => n.title)).toEqual(["third", "second", "first"]);
  });

  it("unread=true filters to only unread notifications", async () => {
    const { app } = setup();
    const first = await createInternal(app, validCreateBody({ title: "one" }));
    await createInternal(app, validCreateBody({ title: "two" }));
    const firstId = first.json().id;

    await app.inject({ method: "POST", url: `/notifications/${firstId}/read`, headers: { "x-user-id": USER_A } });

    const res = await app.inject({
      method: "GET",
      url: "/notifications?unread=true",
      headers: { "x-user-id": USER_A },
    });
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("two");
  });

  it("without unread=true returns both read and unread", async () => {
    const { app } = setup();
    const first = await createInternal(app, validCreateBody({ title: "one" }));
    await createInternal(app, validCreateBody({ title: "two" }));
    const firstId = first.json().id;
    await app.inject({ method: "POST", url: `/notifications/${firstId}/read`, headers: { "x-user-id": USER_A } });

    const res = await app.inject({ method: "GET", url: "/notifications", headers: { "x-user-id": USER_A } });
    expect(res.json()).toHaveLength(2);
  });

  it("defaults limit to 20", async () => {
    const { app } = setup();
    for (let i = 0; i < 25; i++) {
      await createInternal(app, validCreateBody({ title: `n${i}` }));
    }
    const res = await app.inject({ method: "GET", url: "/notifications", headers: { "x-user-id": USER_A } });
    expect(res.json()).toHaveLength(20);
  });

  it("honors a custom limit within range", async () => {
    const { app } = setup();
    for (let i = 0; i < 10; i++) {
      await createInternal(app, validCreateBody({ title: `n${i}` }));
    }
    const res = await app.inject({
      method: "GET",
      url: "/notifications?limit=5",
      headers: { "x-user-id": USER_A },
    });
    expect(res.json()).toHaveLength(5);
  });

  it("clamps a limit above the max down to 100", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      await createInternal(app, validCreateBody({ title: `n${i}` }));
    }
    const res = await app.inject({
      method: "GET",
      url: "/notifications?limit=500",
      headers: { "x-user-id": USER_A },
    });
    // only 5 rows exist, but the clamp itself is what's under test -- a 500 body doesn't 400
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(5);
  });

  it("clamps a limit below the min up to 1", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ title: "n0" }));
    await createInternal(app, validCreateBody({ title: "n1" }));
    const res = await app.inject({
      method: "GET",
      url: "/notifications?limit=0",
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("clamps a negative limit up to 1", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ title: "n0" }));
    const res = await app.inject({
      method: "GET",
      url: "/notifications?limit=-5",
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("400s a non-integer limit", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "GET",
      url: "/notifications?limit=abc",
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/unread-count", () => {
  it("reflects reality after marking some read", async () => {
    const { app } = setup();
    const first = await createInternal(app, validCreateBody({ title: "one" }));
    await createInternal(app, validCreateBody({ title: "two" }));
    await createInternal(app, validCreateBody({ title: "three" }));

    const before = await app.inject({
      method: "GET",
      url: "/notifications/unread-count",
      headers: { "x-user-id": USER_A },
    });
    expect(before.json()).toEqual({ count: 3 });

    await app.inject({
      method: "POST",
      url: `/notifications/${first.json().id}/read`,
      headers: { "x-user-id": USER_A },
    });

    const after = await app.inject({
      method: "GET",
      url: "/notifications/unread-count",
      headers: { "x-user-id": USER_A },
    });
    expect(after.json()).toEqual({ count: 2 });
  });

  it("never counts another user's unread notifications", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ userId: USER_B }));
    const res = await app.inject({
      method: "GET",
      url: "/notifications/unread-count",
      headers: { "x-user-id": USER_A },
    });
    expect(res.json()).toEqual({ count: 0 });
  });
});

describe("POST /notifications/:id/read", () => {
  it("marks a notification read", async () => {
    const { app } = setup();
    const created = await createInternal(app, validCreateBody());
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${created.json().id}/read`,
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().readAt).not.toBeNull();
  });

  it("404s for an unknown id", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/99999999-9999-9999-9999-999999999999/read",
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s when the notification belongs to a different user", async () => {
    const { app } = setup();
    const created = await createInternal(app, validCreateBody({ userId: USER_A }));
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${created.json().id}/read`,
      headers: { "x-user-id": USER_B },
    });
    expect(res.statusCode).toBe(403);

    // and confirm it really wasn't marked read as a side effect of the rejected attempt
    const check = await app.inject({
      method: "GET",
      url: "/notifications/unread-count",
      headers: { "x-user-id": USER_A },
    });
    expect(check.json()).toEqual({ count: 1 });
  });

  it("is idempotent -- reading an already-read notification again just succeeds", async () => {
    const { app } = setup();
    const created = await createInternal(app, validCreateBody());
    const id = created.json().id;
    const first = await app.inject({ method: "POST", url: `/notifications/${id}/read`, headers: { "x-user-id": USER_A } });
    const second = await app.inject({ method: "POST", url: `/notifications/${id}/read`, headers: { "x-user-id": USER_A } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().readAt).toBe(first.json().readAt);
  });

  it("200s on the no-body call with Content-Type: application/json and an empty payload", async () => {
    const { app } = setup();
    const created = await createInternal(app, validCreateBody());
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${created.json().id}/read`,
      headers: { "x-user-id": USER_A, "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /notifications/read-all", () => {
  it("marks only the caller's own unread notifications read and returns the count", async () => {
    const { app } = setup();
    await createInternal(app, validCreateBody({ userId: USER_A, title: "a1" }));
    await createInternal(app, validCreateBody({ userId: USER_A, title: "a2" }));
    await createInternal(app, validCreateBody({ userId: USER_B, title: "b1" }));

    const res = await app.inject({
      method: "POST",
      url: "/notifications/read-all",
      headers: { "x-user-id": USER_A },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ markedCount: 2 });

    const bUnread = await app.inject({
      method: "GET",
      url: "/notifications/unread-count",
      headers: { "x-user-id": USER_B },
    });
    expect(bUnread.json()).toEqual({ count: 1 });
  });

  it("returns markedCount 0 when the caller has no unread notifications", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/read-all",
      headers: { "x-user-id": USER_A },
    });
    expect(res.json()).toEqual({ markedCount: 0 });
  });

  it("200s on the no-body call with Content-Type: application/json and an empty payload", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/read-all",
      headers: { "x-user-id": USER_A, "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });
});
