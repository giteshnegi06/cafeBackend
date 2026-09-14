-- Table-side assistance requests ("Need Water", "Call Server") raised from the
-- customer's order-tracking screen. One row per request; staff resolve it
-- from the Kitchen display or the Admin dashboard.
--
-- Only 'pending' rows are ever shown to staff. Resolved rows are kept so the
-- history can be looked at later, but nothing in the app reads them today.
CREATE TABLE IF NOT EXISTS service_requests (
  id            text PRIMARY KEY,
  cafe_id       text NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  table_id      text NOT NULL,
  table_number  text NOT NULL,
  -- 'water' | 'server'
  request_type  text NOT NULL,
  -- 'pending' | 'resolved'
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_service_requests_pending
  ON service_requests (cafe_id, created_at)
  WHERE status = 'pending';
