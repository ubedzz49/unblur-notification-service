export interface Notification {
  id: string;
  userId: string;
  type: string;
  referenceType: string;
  referenceId: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  referenceType: string;
  referenceId: string;
  title: string;
  body?: string | null;
}

export interface ListNotificationsFilters {
  unreadOnly?: boolean;
  limit: number;
}

export interface NotificationRepository {
  create(input: CreateNotificationInput): Promise<Notification>;
  listByUser(userId: string, filters: ListNotificationsFilters): Promise<Notification[]>;
  getById(id: string): Promise<Notification | null>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string): Promise<Notification>;
  markAllReadForUser(userId: string): Promise<number>;
}

// test-only, also the default for buildApp() so tests/dev don't need a real DB
export class InMemoryNotificationRepository implements NotificationRepository {
  private notifications = new Map<string, Notification>();
  private seq = 0;

  async create(input: CreateNotificationInput): Promise<Notification> {
    this.seq += 1;
    const now = new Date(Date.now() + this.seq).toISOString();
    const notification: Notification = {
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
      userId: input.userId,
      type: input.type,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      title: input.title,
      body: input.body ?? null,
      readAt: null,
      createdAt: now,
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async listByUser(userId: string, filters: ListNotificationsFilters): Promise<Notification[]> {
    let rows = [...this.notifications.values()].filter((n) => n.userId === userId);
    if (filters.unreadOnly) {
      rows = rows.filter((n) => n.readAt === null);
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.slice(0, filters.limit);
  }

  async getById(id: string): Promise<Notification | null> {
    return this.notifications.get(id) ?? null;
  }

  async countUnread(userId: string): Promise<number> {
    return [...this.notifications.values()].filter((n) => n.userId === userId && n.readAt === null).length;
  }

  async markRead(id: string): Promise<Notification> {
    const existing = this.notifications.get(id);
    if (!existing) {
      throw new Error(`notification ${id} not found`);
    }
    const updated = { ...existing, readAt: existing.readAt ?? new Date().toISOString() };
    this.notifications.set(id, updated);
    return updated;
  }

  async markAllReadForUser(userId: string): Promise<number> {
    let count = 0;
    const now = new Date().toISOString();
    for (const [id, notification] of this.notifications) {
      if (notification.userId === userId && notification.readAt === null) {
        this.notifications.set(id, { ...notification, readAt: now });
        count += 1;
      }
    }
    return count;
  }
}
