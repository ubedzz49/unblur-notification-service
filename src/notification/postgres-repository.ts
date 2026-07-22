import { Pool } from "pg";
import {
  CreateNotificationInput,
  ListNotificationsFilters,
  Notification,
  NotificationRepository,
} from "./repository.js";

function rowToNotification(row: any): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const { rows } = await this.pool.query(
      `INSERT INTO notifications (user_id, type, reference_type, reference_id, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.userId, input.type, input.referenceType, input.referenceId, input.title, input.body ?? null],
    );
    return rowToNotification(rows[0]);
  }

  async listByUser(userId: string, filters: ListNotificationsFilters): Promise<Notification[]> {
    const conditions = ["user_id = $1"];
    const params: unknown[] = [userId];
    if (filters.unreadOnly) {
      conditions.push("read_at IS NULL");
    }
    params.push(filters.limit);
    const { rows } = await this.pool.query(
      `SELECT * FROM notifications WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToNotification);
  }

  async getById(id: string): Promise<Notification | null> {
    const { rows } = await this.pool.query("SELECT * FROM notifications WHERE id = $1", [id]);
    return rows[0] ? rowToNotification(rows[0]) : null;
  }

  async countUnread(userId: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [userId],
    );
    return rows[0].count;
  }

  async markRead(id: string): Promise<Notification> {
    const { rows } = await this.pool.query(
      `UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 RETURNING *`,
      [id],
    );
    return rowToNotification(rows[0]);
  }

  async markAllReadForUser(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  }
}
