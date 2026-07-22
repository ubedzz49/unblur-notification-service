-- Shares the same RDS instance and database as the other unblur services (see
-- ARCHITECTURE_DECISIONS.md's shared-infra decision) -- this service owns and only touches
-- the notifications table, never anyone else's.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- soft reference to user-service's users.id, same caveat as every prior cross-service table
  user_id UUID NOT NULL,
  -- free text, not a DB enum -- new event types get added over time without a migration each
  -- time (resolution_request_received, resolution_request_accepted, payment_confirmed, ...)
  type TEXT NOT NULL,
  -- soft reference to whatever this notification is about (a resolution request, booking,
  -- payment, etc.) -- same physical DB but a different service's table, so no cross-db FK
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the common "my unread notifications" query
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read_at);

-- the ordered list view
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
