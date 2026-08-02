import { buildApp } from "./app.js";
import { buildDbPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { PostgresNotificationRepository } from "./notification/postgres-repository.js";
import { HttpAuditLogClient } from "./admin/audit-log-client.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 3008);

// fail closed, same philosophy as JWT_SECRET in the gateway and every other service's
// INTERNAL_SERVICE_TOKEN check -- an unset internal token would otherwise mean this service
// silently accepts any request to /internal/*
if (!process.env.INTERNAL_SERVICE_TOKEN) {
  logger.fatal("INTERNAL_SERVICE_TOKEN is not set, refusing to start");
  process.exit(1);
}

const dbPool = buildDbPool();

runMigrations(dbPool)
  .then(() => {
    const app = buildApp(new PostgresNotificationRepository(dbPool), process.env.INTERNAL_SERVICE_TOKEN, new HttpAuditLogClient());
    return app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info({ port }, "notification-service listening"));
  })
  .catch((err) => {
    logger.error({ err }, "notification-service failed to start");
    process.exit(1);
  });
