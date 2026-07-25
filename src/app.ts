import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CreateNotificationInput,
  InMemoryNotificationRepository,
  NotificationRepository,
} from "./notification/repository.js";

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

// loose UUID shape check -- good enough to catch obviously-wrong callers (empty string, a
// doubt title pasted in by mistake, etc.) without re-implementing a full RFC4122 validator
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface InternalCreateBody {
  userId?: string;
  type?: string;
  referenceType?: string;
  referenceId?: string;
  title?: string;
  body?: string;
}

interface ListNotificationsQuery {
  unread?: string;
  limit?: string;
}

interface AdminSendNotificationBody {
  userId?: string;
  title?: string;
  body?: string;
}

export function buildApp(
  notificationRepository: NotificationRepository = new InMemoryNotificationRepository(),
  internalServiceToken: string | undefined = process.env.INTERNAL_SERVICE_TOKEN,
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" },
  });

  // Fastify's default JSON parser rejects an empty body when Content-Type: application/json is
  // set, even for no-body action routes (read, read-all) -- real clients send that header
  // unconditionally, so this bites every no-body call otherwise. same fix as every sibling
  // service, see ARCHITECTURE_DECISIONS.md.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  // internal routes are only ever called by other backend services (Resolution/Payment/User),
  // never the frontend directly -- gated on a shared secret, not the end-user identity header,
  // same pattern as payment-service's /internal/payments/collect
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith("/internal/")) return;
    const token = request.headers["x-internal-service-token"];
    if (!token || token !== internalServiceToken) {
      request.log.warn("rejected internal request with missing/invalid service token");
      return reply.code(401).send({ error: "invalid internal service token" });
    }
  });

  // client-facing routes trust the gateway-verified X-User-Id header, same pattern every other
  // service in this project uses -- this service never verifies JWTs itself
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith("/internal/") || request.url === "/healthz") return;
    const userId = request.headers["x-user-id"];
    if (!userId || Array.isArray(userId)) {
      return reply.code(401).send({ error: "missing X-User-Id header" });
    }
  });

  function requireUserId(request: FastifyRequest): string {
    // preHandler above already rejected anything missing/malformed -- this just narrows the type
    return request.headers["x-user-id"] as string;
  }

  app.post<{ Body: InternalCreateBody }>("/internal/notifications", async (request, reply) => {
    const { userId, type, referenceType, referenceId, title, body } = request.body ?? {};

    if (!isUuidLike(userId)) {
      return reply.code(400).send({ error: "userId must be a valid uuid" });
    }
    if (!isNonEmptyString(type)) {
      return reply.code(400).send({ error: "type is required" });
    }
    if (!isNonEmptyString(referenceType)) {
      return reply.code(400).send({ error: "referenceType is required" });
    }
    if (!isUuidLike(referenceId)) {
      return reply.code(400).send({ error: "referenceId must be a valid uuid" });
    }
    if (!isNonEmptyString(title)) {
      return reply.code(400).send({ error: "title is required" });
    }
    if (body !== undefined && typeof body !== "string") {
      return reply.code(400).send({ error: "body must be a string" });
    }

    const input: CreateNotificationInput = { userId, type, referenceType, referenceId, title, body };
    const created = await notificationRepository.create(input);
    request.log.info({ notificationId: created.id, userId, type }, "notification created");
    return reply.code(201).send(created);
  });

  app.get<{ Querystring: ListNotificationsQuery }>("/notifications", async (request, reply) => {
    const callerUserId = requireUserId(request);
    const { unread, limit } = request.query;

    let parsedLimit = DEFAULT_LIMIT;
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isInteger(n)) {
        return reply.code(400).send({ error: "limit must be an integer" });
      }
      parsedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
    }

    const notifications = await notificationRepository.listByUser(callerUserId, {
      unreadOnly: unread === "true",
      limit: parsedLimit,
    });
    return reply.send(notifications);
  });

  app.get("/notifications/unread-count", async (request, reply) => {
    const callerUserId = requireUserId(request);
    const count = await notificationRepository.countUnread(callerUserId);
    return reply.send({ count });
  });

  app.post<{ Params: { id: string } }>("/notifications/:id/read", async (request, reply) => {
    const callerUserId = requireUserId(request);

    const notification = await notificationRepository.getById(request.params.id);
    if (!notification) {
      return reply.code(404).send({ error: "notification not found" });
    }

    if (notification.userId !== callerUserId) {
      return reply.code(403).send({ error: "not authorized to read this notification" });
    }

    // markRead is idempotent -- an already-read notification just succeeds again rather than
    // erroring, no need to branch on notification.readAt here
    const updated = await notificationRepository.markRead(notification.id);
    return reply.send(updated);
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const callerUserId = requireUserId(request);
    const markedCount = await notificationRepository.markAllReadForUser(callerUserId);
    return reply.send({ markedCount });
  });

  // admin dashboard: send an arbitrary message to any user, not tied to a real event elsewhere
  // in the system -- referenceType "admin" / referenceId the admin message's own id marks it as
  // such, distinct from every other notification type here which always references a real
  // booking/payment/doubt/etc.
  app.post<{ Body: AdminSendNotificationBody }>("/admin/notifications", async (request, reply) => {
    if (request.headers["x-user-role"] !== "admin") {
      return reply.code(403).send({ error: "admin access required" });
    }

    const { userId, title, body } = request.body ?? {};
    if (!isUuidLike(userId)) {
      return reply.code(400).send({ error: "userId must be a valid uuid" });
    }
    if (!isNonEmptyString(title)) {
      return reply.code(400).send({ error: "title is required" });
    }
    if (body !== undefined && typeof body !== "string") {
      return reply.code(400).send({ error: "body must be a string" });
    }

    const created = await notificationRepository.create({
      userId,
      type: "admin_message",
      referenceType: "admin",
      referenceId: userId,
      title,
      body,
    });
    request.log.info({ notificationId: created.id, userId }, "admin notification sent");
    return reply.code(201).send(created);
  });

  return app;
}
